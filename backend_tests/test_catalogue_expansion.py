from datetime import date
from decimal import Decimal
import json
from pathlib import Path

import pytest

from cinema import booking, catalog
from cinema.core import Problem, db, get, in_ids, one, rows, upd
from cinema.seating import insert_auditorium
from cinema_ai.backend import BackendCatalog, BackendRepository, backend_clock
from cinema_ai.domain import Filters
from backend_tests.test_community import client_for
from scripts.expand_demo_catalogue import expand_catalogue, load_expansion, plan_expansion
from scripts.import_cinema_directory import import_directory, load_directory
from scripts.import_film_programme import import_programme, load_programme


def prepare(env, tmp_path):
    import_programme(db(), load_programme(), date(2026, 10, 24), 1, env["clock"][0], tmp_path / "films")
    import_directory(db(), load_directory(), date(2026, 10, 24), 1, env["clock"][0], tmp_path / "cinemas")


def test_expansion_is_additive_repeatable_and_reaches_public_features(env, tmp_path):
    prepare(env, tmp_path)
    # An actual existing purchase must survive the catalogue import.
    customer = env["users"]["customer@cinema.test"]
    with db().connect() as c:
        old_show = one(c, "SELECT * FROM screenings ORDER BY starts_at,id LIMIT 1")
        old_seat = one(c, "SELECT id FROM seats WHERE layout_id=:l LIMIT 1", l=old_show["layout_id"])
    hold = booking.create_hold(customer, dict(screening_id=old_show["id"], seat_ids=[old_seat["id"]]), "before-expansion")
    quote = booking.quote(customer, hold["hold_id"], dict(tickets=[dict(seat_id=old_seat["id"], fare_type="STANDARD")]))
    booking.checkout(customer, dict(quote_token=quote["quote_token"]), "purchase-before-expansion")
    with db().connect() as c:
        before = {t: rows(c, f"SELECT * FROM {t} ORDER BY id") for t in
                  ("films", "cinemas", "screens", "layouts", "seats", "users", "wallets", "screenings", "fares", "bookings", "tickets")}
    manifest = load_expansion()
    result = expand_catalogue(db(), manifest, date(2026, 10, 24), 2, env["clock"][0], tmp_path / "expansion")
    assert result["added"] == dict(films=5, cinemas=3, screens=12, seats=2204, screenings=120)
    assert Path(result["private_accounts_file"]).stat().st_mode & 0o777 == 0o600
    assert len(json.loads(Path(result["private_accounts_file"]).read_text())["accounts"]) == 3
    with db().connect() as c:
        for table, original in before.items():
            assert rows(c, f"SELECT * FROM {table} WHERE id IN ({in_ids(x['id'] for x in original)}) ORDER BY id") == original
        assert one(c, """SELECT COUNT(*) n FROM screenings a JOIN screenings b
            ON a.screen_id=b.screen_id AND a.id<b.id AND a.starts_at<b.occupied_until
            AND b.starts_at<a.occupied_until WHERE a.status='PUBLISHED' AND b.status='PUBLISHED'""")["n"] == 0
        new_ids = {x["title"]: x["id"] for x in rows(c, "SELECT id,title FROM films")}
        for cinema in rows(c, "SELECT id,name FROM cinemas"):
            film_list = manifest["films"]
            if cinema["name"] in {x["name"] for x in manifest["cinemas"]}:
                film_list = load_programme()["films"] + film_list
            for film in film_list:
                shows = catalog.search(c, dict(date="2026-10-24", cinema_id=cinema["id"], film_id=new_ids[film["title"]], party_size=2))
                assert shows["items"], (cinema["name"], film["title"])
        new_show = one(c, "SELECT * FROM screenings WHERE film_id=:f ORDER BY starts_at LIMIT 1", f=new_ids["Interstellar"])
        seats = catalog.available_seats(c, new_show)
        assert len(seats) in {168, 300, 92}
    # New-room inventory supports the same signed hold/quote/checkout flow.
    held = booking.create_hold(customer, dict(screening_id=new_show["id"], seat_ids=[seats[0]["id"]]), "new-film-hold")
    quoted = booking.quote(customer, held["hold_id"], dict(tickets=[dict(seat_id=seats[0]["id"], fare_type="STANDARD")]))
    booking.checkout(customer, dict(quote_token=quoted["quote_token"]), "new-film-checkout")
    client = env["app"].test_client()
    bootstrap = client.get("/api/ui/bootstrap").json["data"]
    assert len(bootstrap["films"]) == 10 and len(bootstrap["cinemas"]) == 9
    assert len(client.get("/api/community/films").json["data"]) == 10
    for film in manifest["films"]:
        detail = client.get(f"/api/community/films/{new_ids[film['title']]}").json["data"]
        assert Decimal(detail["film"]["rating"]["average"]) == Decimal(str(film["rating_seed"]["score"]))
        assert len(detail["rating_snapshot"]["distribution"]) == 5
        assert detail["votes"] == [] and detail["counts"] == dict(reviews=0, threads=0)
    ai_catalog = BackendCatalog(BackendRepository(), backend_clock)
    for film in manifest["films"]:
        assert ai_catalog.find_films(film["title_zh"])[0].id == new_ids[film["title"]]
        assert ai_catalog.recommend(Filters(date="2026-10-24", film_query=film["title_zh"], party_size=2))
    customer_client, headers = client_for(env)
    community_path = f"/api/community/films/{new_ids['Interstellar']}"
    assert customer_client.put(community_path + "/review", headers=headers,
                               json=dict(stars=10, body="A thoughtful journey.")).status_code == 200
    assert customer_client.post(community_path + "/threads", headers={**headers, "Idempotency-Key": "new-film-discussion"},
                                json=dict(title="The ending", body="What did you think?")).status_code == 201
    # Keep a staff cancellation instead of resurrecting a cancelled screening.
    with db().begin() as c:
        other = one(c, "SELECT id FROM screenings WHERE screen_id=:s AND id<>:id LIMIT 1", s=new_show["screen_id"], id=new_show["id"])
        upd(c, "screenings", other["id"], status="CANCELLED")
    # A newer layout must not invalidate an already booked slot on its old version.
    with db().begin() as c:
        screen = get(c, "screens", new_show["screen_id"], True)
        insert_auditorium(c, screen["id"], screen["screen_type"], env["clock"][0])
    repeat = expand_catalogue(db(), manifest, date(2026, 10, 24), 2, env["clock"][0], tmp_path / "repeat")
    assert all(n == 0 for n in repeat["added"].values())
    assert repeat["private_accounts_file"] is None
    detail = customer_client.get(community_path).json["data"]
    assert detail["counts"] == dict(reviews=1, threads=1)
    assert detail["votes"] == [dict(stars=10, count=1)]
    assert detail["rating_snapshot"]["vote_count"] == manifest["films"][0]["rating_seed"]["vote_count"]
    with db().connect() as c:
        assert get(c, "screenings", other["id"])["status"] == "CANCELLED"
        assert one(c, "SELECT COUNT(*) n FROM bookings")["n"] == 2


def test_conflicting_slot_rolls_back_entire_expansion(env, tmp_path):
    prepare(env, tmp_path)
    manifest = load_expansion()
    expand_catalogue(db(), manifest, date(2026, 10, 24), 1, env["clock"][0], tmp_path / "first")
    with db().begin() as c:
        show = one(c, "SELECT s.id FROM screenings s JOIN screens sc ON sc.id=s.screen_id WHERE sc.name='Catalogue Demo 1' LIMIT 1")
        old_film = one(c, "SELECT id FROM films WHERE title='Tenzing'")
        upd(c, "screenings", show["id"], film_id=old_film["id"])
        count = one(c, "SELECT COUNT(*) n FROM screenings")["n"]
    with pytest.raises(Problem, match="planned|changed"):
        expand_catalogue(db(), manifest, date(2026, 10, 24), 2, env["clock"][0], tmp_path / "conflict")
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) n FROM screenings")["n"] == count


def test_calendar_rotation_is_stable_for_overlapping_import_windows():
    from datetime import datetime
    manifest = load_expansion()
    at = datetime(2026, 11, 14, 9)
    longer = plan_expansion(manifest, date(2026, 11, 14), 3, at)
    shifted = plan_expansion(manifest, date(2026, 11, 15), 2, at)
    assert [s for s in longer if s["starts_at"].date() >= date(2026, 11, 15)] == shifted
    assert len(shifted) == 120
