from copy import deepcopy
from datetime import date, timedelta

import pytest

from cinema.core import Problem, db, ins, one, rows
from scripts.import_film_programme import import_programme, load_programme
from scripts.update_featured_films import OLD_TITLE, update_featured_films


def old_programme(env, tmp_path):
    programme = deepcopy(load_programme())
    old = next(f for f in programme["films"] if f["key"] == "niu-lai")
    old.update(title=OLD_TITLE, duration_minutes=80, genres=["Animation", "Family", "Comedy"])
    old.pop("rating_seed")
    return import_programme(db(), programme, date(2026, 10, 24), 7, env["clock"][0], tmp_path)


def test_replace_keeps_show_ids_fares_and_seats_and_imports_unified_ratings(env, tmp_path):
    old_programme(env, tmp_path)
    with db().connect() as c:
        before = {t: rows(c, f"SELECT * FROM {t} ORDER BY id") for t in ("fares", "seats", "cinemas")}
        shows = rows(c, "SELECT id,starts_at,film_id FROM screenings ORDER BY id")
    result = update_featured_films(db(), load_programme(), tmp_path)
    assert result["replaced_screenings"] == 21
    assert update_featured_films(db(), load_programme(), tmp_path)["replaced_screenings"] == 0
    fid = int(result["film_ids"]["niu-lai"])
    with db().connect() as c:
        assert rows(c, "SELECT id,starts_at FROM screenings ORDER BY id") == [
            {k: s[k] for k in ("id", "starts_at")} for s in shows]
        assert one(c, "SELECT COUNT(*) n FROM films")["n"] == 5
        assert one(c, "SELECT COUNT(*) n FROM ratings")["n"] == 0
        assert one(c, "SELECT COUNT(*) n FROM film_rating_baselines")["n"] == 5
        for t, expected in before.items():
            assert rows(c, f"SELECT * FROM {t} ORDER BY id") == expected
        for s in rows(c, "SELECT * FROM screenings WHERE film_id=:f", f=fid):
            assert s["ends_at"] - s["starts_at"] == timedelta(minutes=86)
            assert s["occupied_until"] - s["ends_at"] == timedelta(minutes=15)
        assert not rows(c, """SELECT a.id FROM screenings a JOIN screenings b ON a.screen_id=b.screen_id
            AND a.id<b.id WHERE a.starts_at<b.occupied_until AND b.starts_at<a.occupied_until""")
    client = env["app"].test_client()
    films = client.get("/api/ui/bootstrap").get_json()["data"]["films"]
    expected = {f["title"]: f["rating_seed"] for f in load_programme()["films"]}
    for film in films:
        rating = film["rating"]
        assert float(rating["average"]) == expected[film["title"]]["score"]
        assert rating["count"] == expected[film["title"]]["vote_count"]
        assert rating["scale"] == 10 and "reference_rating" not in film
        detail = client.get("/api/films/" + film["id"]).get_json()["data"]
        assert detail["rating"] == rating and "reference_rating" not in detail
    with db().begin() as c:
        ins(c, "ratings", customer_id=env["ids"]["customer_id"], film_id=fid, stars=4,
            created_at=env["clock"][0], updated_at=env["clock"][0])
    detail = client.get(f"/api/films/{fid}").get_json()["data"]
    assert detail["rating"] == dict(average="6.0", count=53067, scale=10)
    assert "reference_rating" not in detail


def test_existing_user_history_blocks_replacement_atomically(env, tmp_path):
    result = old_programme(env, tmp_path)
    fid = result["film_ids"]["niu-lai"]
    with db().begin() as c:
        ins(c, "ratings", customer_id=env["ids"]["customer_id"], film_id=fid, stars=4,
            created_at=env["clock"][0], updated_at=env["clock"][0])
    with pytest.raises(Problem, match="ratings history"):
        update_featured_films(db(), load_programme(), tmp_path)
    with db().connect() as c:
        assert one(c, "SELECT title FROM films WHERE id=:id", id=fid)["title"] == OLD_TITLE
        assert one(c, "SELECT COUNT(*) n FROM films")["n"] == 5
        assert one(c, "SELECT COUNT(*) n FROM ratings")["n"] == 1


def test_longer_film_conflict_rolls_back_replacement(env, tmp_path):
    result = old_programme(env, tmp_path)
    fid = result["film_ids"]["niu-lai"]
    with db().begin() as c:
        show = one(c, "SELECT * FROM screenings WHERE film_id=:f ORDER BY starts_at,id LIMIT 1", f=fid)
        start = show["occupied_until"]
        ins(c, "screenings", film_id=result["film_ids"]["tenzing"], cinema_id=show["cinema_id"],
            screen_id=show["screen_id"], layout_id=show["layout_id"], starts_at=start,
            ends_at=start + timedelta(minutes=10), occupied_until=start + timedelta(minutes=25),
            duration_minutes_snapshot=10, turnaround_minutes=15, status="PUBLISHED", revision_no=1,
            created_at=env["clock"][0])
    with pytest.raises(Problem, match="Physical screen is occupied"):
        update_featured_films(db(), load_programme(), tmp_path)
    with db().connect() as c:
        assert one(c, "SELECT title FROM films WHERE id=:id", id=fid)["title"] == OLD_TITLE
        assert one(c, "SELECT COUNT(*) n FROM films")["n"] == 5
        assert one(c, "SELECT COUNT(*) n FROM film_rating_baselines")["n"] == 4
