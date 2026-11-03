"""Programme writes are tested only in the fixture's disposable MySQL schema."""
from datetime import date, datetime, timedelta

import pytest

from cinema.core import Problem, db, execute, get, ins, one, rows
from scripts.import_film_programme import (
    import_programme, load_programme, plan_programme, read_halls,
)


def test_calendar_has_turnaround_complete_fares_and_stable_rotation():
    halls = [dict(screen_id=i, screen_type=t) for i, t in enumerate(
        ["STANDARD", "IMAX", "DOLBY_CINEMA"], 1)]
    at = datetime(2026, 10, 24, 12, 22)
    plan = plan_programme(load_programme(), halls, at.date(), 7, at)
    assert len(plan) == 120
    assert {s["key"] for s in plan} == {f["key"] for f in load_programme()["films"]}
    for hall in halls:
        shows = [s for s in plan if s["screen_id"] == hall["screen_id"]]
        assert all(a["occupied_until"] <= b["starts_at"] for a, b in zip(shows, shows[1:]))
        assert all(s["occupied_until"] - s["ends_at"] == timedelta(minutes=15) for s in shows)
    assert all(s["starts_at"] >= at + timedelta(minutes=45) for s in plan)
    assert all(s["fares"]["STUDENT"] * 2 == s["fares"]["STANDARD"] > 0 for s in plan)
    # Regenerating a rolling week must not change late films/prices on overlapping dates.
    next_day = plan_programme(load_programme(), halls, at.date() + timedelta(days=1), 6, at)
    assert [s for s in plan if s["starts_at"].date() > at.date()] == next_day
    first_prices = {s["starts_at"].date(): s["fares"]["STANDARD"] for s in plan
                    if s["screen_type"] == "STANDARD" and s["key"] == "niu-lai"}
    assert first_prices[date(2026, 10, 25)] == 4200  # Weekend matinee
    assert first_prices[date(2026, 10, 26)] == 3600


def apply(env, tmp_path):
    return import_programme(db(), load_programme(), date(2026, 10, 24), 7,
                            env["clock"][0], tmp_path)


def test_replace_and_repeat_preserve_other_data(env, tmp_path):
    with db().connect() as c:
        before = {table: rows(c, f"SELECT * FROM {table} ORDER BY id")
                  for table in ("cinemas", "screens", "layouts", "seats", "users", "wallets")}
    result = apply(env, tmp_path)
    assert result["removed_films"] == 1 and result["removed_screenings"] == 9
    assert result["created"] == 126
    assert result["skipped"] == 0
    assert list(tmp_path.glob("removed-seed-*.json"))
    repeated = apply(env, tmp_path)
    assert repeated["created"] == 0 and repeated["skipped"] == 126
    assert repeated["removed_films"] == 0
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) AS n FROM films")["n"] == 5
        assert one(c, "SELECT COUNT(*) AS n FROM ratings")["n"] == 0
        assert one(c, "SELECT COUNT(*) AS n FROM fares")["n"] == 252
        assert one(c, "SELECT COUNT(*) AS n FROM screenings WHERE film_id=:f",
                   f=env["ids"]["film_id"])["n"] == 0
        for table, original in before.items():
            assert rows(c, f"SELECT * FROM {table} ORDER BY id") == original
    response = env["app"].test_client().get("/api/ui/bootstrap")
    assert response.status_code == 200
    data = response.get_json()["data"]
    assert {f["title"] for f in data["films"]} == {f["title"] for f in load_programme()["films"]}
    assert len(data["available_dates"]) == 7


def test_refuse_seed_with_user_history(env, tmp_path):
    with db().begin() as c:
        ins(c, "ratings", customer_id=env["ids"]["customer_id"],
            film_id=env["ids"]["film_id"], stars=4,
            created_at=env["clock"][0], updated_at=env["clock"][0])
    with pytest.raises(Problem, match="ratings references"):
        apply(env, tmp_path)
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) AS n FROM films")["n"] == 1
        assert one(c, "SELECT COUNT(*) AS n FROM screenings")["n"] == 9
        assert one(c, "SELECT COUNT(*) AS n FROM ratings")["n"] == 1


def test_conflict_rolls_back_seed_deletion_and_all_new_films(env, tmp_path):
    with db().begin() as c:
        # Independent programme entry, slightly overlapping the first planned slot.
        hall = read_halls(c)[0]
        fid = ins(c, "films", title="Keep this independent booking programme",
                  synopsis="Conflict fixture", duration_minutes=60, archived=False)
        start = datetime(2026, 10, 24, 10, 15)
        ins(c, "screenings", cinema_id=hall["cinema_id"], film_id=fid,
            screen_id=hall["screen_id"], layout_id=hall["layout_id"],
            starts_at=start, ends_at=start+timedelta(minutes=60),
            occupied_until=start+timedelta(minutes=75), duration_minutes_snapshot=60,
            turnaround_minutes=15, status="PUBLISHED", revision_no=1, created_at=env["clock"][0])
    with pytest.raises(Problem) as error:
        apply(env, tmp_path)
    assert error.value.code == "SCHEDULE_OVERLAP"
    with db().connect() as c:
        assert get(c, "films", env["ids"]["film_id"])["title"] == "Journey Beyond the City"
        assert one(c, "SELECT COUNT(*) AS n FROM films")["n"] == 2
        assert one(c, "SELECT COUNT(*) AS n FROM screenings")["n"] == 10
        assert one(c, "SELECT COUNT(*) AS n FROM fares")["n"] == 18


def test_reimport_refuses_to_overwrite_changed_fares(env, tmp_path):
    result = apply(env, tmp_path)
    sid = result["screenings"][0]["screening_id"]
    with db().begin() as c:
        execute(c, "UPDATE fares SET price_minor=1234 WHERE screening_id=:s AND fare_type='STANDARD'", s=sid)
    with pytest.raises(Problem) as error:
        apply(env, tmp_path)
    assert error.value.code == "FARES_CHANGED"
    with db().connect() as c:
        assert one(c, "SELECT price_minor FROM fares WHERE screening_id=:s AND fare_type='STANDARD'",
                   s=sid)["price_minor"] == 1234
