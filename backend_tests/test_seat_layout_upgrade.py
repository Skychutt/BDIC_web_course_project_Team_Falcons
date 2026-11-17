from datetime import timedelta
import pytest

from cinema import booking
from cinema.core import db, get, ins, one, rows, upd, Problem
from cinema.management import create_layout
from cinema.seating import auditorium_layout
from scripts.upgrade_seat_layouts import upgrade_layouts


def install_legacy(env):
    """Give each test screen the actual old fixture, without editing production."""
    result = []
    with db().begin() as c:
        for screen in rows(c, "SELECT * FROM screens ORDER BY screen_type"):
            lid = ins(c, "layouts", screen_id=screen["id"], version_no=2, screen_direction="TOP",
                      row_count=12, created_at=env["clock"][0])
            ids = [ins(c, "seats", layout_id=lid, row_no=r, seat_no=n, aisle_segment=1,
                       segment_position=n, map_x=n-1, map_y=r-1) for r in range(1, 13) for n in range(1, 7)]
            shows = rows(c, "SELECT * FROM screenings WHERE screen_id=:s ORDER BY starts_at", s=screen["id"])
            for show in shows:
                upd(c, "screenings", show["id"], layout_id=lid)
            result.append((screen, lid, ids, shows))
    return result


def test_upgrade_is_repeatable_and_preserves_purchases_holds_and_past_shows(env, tmp_path):
    halls = install_legacy(env)
    customer = env["users"]["customer@cinema.test"]
    screen, lid, seats, shows = halls[0]
    hold = booking.create_hold(customer, dict(screening_id=shows[0]["id"], seat_ids=[seats[0]]), "legacy-hold")
    quote = booking.quote(customer, hold["hold_id"], dict(tickets=[dict(seat_id=seats[0], fare_type="STANDARD")]))
    booking.checkout(customer, dict(quote_token=quote["quote_token"]), "legacy-checkout")
    booking.create_hold(customer, dict(screening_id=shows[1]["id"], seat_ids=[seats[1]]), "preserve-hold")
    with db().begin() as c:
        past = halls[1][3][0]
        upd(c, "screenings", past["id"], starts_at=env["clock"][0] - timedelta(hours=2),
            ends_at=env["clock"][0] - timedelta(minutes=20), occupied_until=env["clock"][0] - timedelta(minutes=5))
        history = {t: rows(c, f"SELECT * FROM {t} ORDER BY id") for t in
                   ("bookings", "tickets", "seat_holds", "seat_allocations", "layouts", "seats")}
    preview = upgrade_layouts(db(), env["clock"][0], tmp_path)
    assert preview["new_layouts"] == 3 and preview["moved_screenings"] == 6
    assert preview["protected_screenings"] == 2
    assert not list(tmp_path.iterdir())
    result = upgrade_layouts(db(), env["clock"][0], tmp_path, apply=True)
    assert result["moved_screenings"] == 6
    with db().connect() as c:
        for t, original in history.items():
            current = {r["id"]: r for r in rows(c, f"SELECT * FROM {t}")}
            assert all(current[r["id"]] == r for r in original)
        for show in shows[:2]:
            assert get(c, "screenings", show["id"])["layout_id"] == lid
        assert get(c, "screenings", past["id"])["layout_id"] == halls[1][1]
        changed = get(c, "screenings", shows[2]["id"])
        assert changed["revision_no"] == shows[2]["revision_no"] + 1
        assert one(c, "SELECT COUNT(*) n FROM seats WHERE layout_id=:l", l=changed["layout_id"])["n"] == 92
        new_seat = one(c, "SELECT id FROM seats WHERE layout_id=:l LIMIT 1", l=changed["layout_id"])["id"]
    repeat = upgrade_layouts(db(), env["clock"][0], tmp_path, apply=True)
    assert repeat["new_layouts"] == repeat["moved_screenings"] == 0
    with pytest.raises(Problem, match="belong"):
        booking.create_hold(customer, dict(screening_id=changed["id"], seat_ids=[seats[0]]), "stale-seat")
    booking.create_hold(customer, dict(screening_id=changed["id"], seat_ids=[new_seat]), "new-layout-seat")


def test_custom_layout_is_not_replaced_and_templates_obey_branch_access(env, tmp_path):
    install_legacy(env)
    actor = env["users"]["manager1@cinema.test"]
    with db().connect() as c:
        screen = one(c, "SELECT * FROM screens WHERE cinema_id=:cid", cid=actor["staff_cinema_id"])
    plan = auditorium_layout("STANDARD")
    plan["seats"][-1]["map_x"] += 1
    custom = create_layout(actor, screen["id"], plan)
    result = upgrade_layouts(db(), env["clock"][0], tmp_path, apply=True)
    assert result["new_layouts"] == 2
    assert any(h.get("action") == "custom layout preserved" for h in result["halls"])
    with db().connect() as c:
        assert get(c, "layouts", custom["layout_id"])["version_no"] == 3
    client = env["app"].test_client()
    with client.session_transaction() as session:
        session["user_id"] = actor["id"]
    assert client.get(f'/api/staff/screens/{screen["id"]}/layout-template').status_code == 200
    with db().connect() as c:
        other = one(c, "SELECT id FROM screens WHERE cinema_id<>:cid LIMIT 1", cid=actor["staff_cinema_id"])
    assert client.get(f'/api/staff/screens/{other["id"]}/layout-template').status_code == 403
