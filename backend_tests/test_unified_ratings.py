from importlib.resources import files
import json
import stat

import pytest
from sqlalchemy.exc import OperationalError
from cinema import catalog
from cinema.core import db, execute, ins, one, Problem
from cinema.ratings import VERSION
from scripts.migrate_ratings import migrate, table_exists


def user(env, name="customer"):
    return env["users"][name + "@cinema.test"]


def old_schema(env):
    with db().begin() as c:
        execute(c, "DELETE FROM rating_schema_versions WHERE version=:v", v=VERSION)
        c.exec_driver_sql("ALTER TABLE ratings DROP CHECK ck_ratings_ten_point, ADD CONSTRAINT ck_legacy_rating CHECK(stars BETWEEN 1 AND 5)")
        ddl = files("cinema").joinpath("sql/002_reference_ratings.sql").read_text()
        c.exec_driver_sql(ddl)
        ins(c, "ratings", customer_id=user(env)["id"], film_id=env["ids"]["film_id"], stars=4,
            created_at=env["clock"][0], updated_at=env["clock"][0])
        execute(c, """INSERT INTO film_reference_ratings VALUES
            (:f,'Douban',7.3,10,2,'2026-10-24','migration test')""", f=env["ids"]["film_id"])


def test_migration_preserves_existing_votes_with_backup_and_is_repeatable(env, tmp_path):
    old_schema(env)
    result = migrate(db(), tmp_path)
    assert result["converted_votes"] == 1 and result["initial_ratings"] == 1
    backup = next(tmp_path.glob("*.json"))
    assert stat.S_IMODE(backup.stat().st_mode) == 0o600
    assert json.loads(backup.read_text())["ratings"][0]["stars"] == 4
    with db().connect() as c:
        assert one(c, "SELECT stars FROM ratings")["stars"] == 8
        assert not table_exists(c, "film_reference_ratings")
        value = catalog.film_detail(c, env["ids"]["film_id"])
        assert str(value["rating"]["average"]) == "7.5" and value["rating"]["count"] == 3
        assert "reference_rating" not in value
    assert migrate(db(), tmp_path)["status"] == "already_applied"
    with db().connect() as c:
        assert one(c, "SELECT stars FROM ratings")["stars"] == 8


def test_customer_edits_join_initial_totals_without_duplicate_votes(env):
    fid = env["ids"]["film_id"]
    with db().begin() as c:
        execute(c, "INSERT INTO film_rating_baselines VALUES(:f,7.3,2)", f=fid)
    catalog.rate(user(env), fid, {"stars": 8})
    updated = catalog.rate(user(env), fid, {"stars": 10})
    assert str(updated["average"]) == "8.2" and updated["count"] == 3 and updated["scale"] == 10
    updated = catalog.rate(user(env, "customer2"), fid, {"stars": 6})
    assert str(updated["average"]) == "7.7" and updated["count"] == 4


@pytest.mark.parametrize("score", [0, 11, -1, 8.5, True])
def test_score_range_checked_by_api_and_database(env, score):
    with pytest.raises(Problem):
        catalog.rate(user(env), env["ids"]["film_id"], {"stars": score})
    if score in (0, 11, -1):
        with pytest.raises(OperationalError, match="ck_ratings_ten_point"), db().begin() as c:
            ins(c, "ratings", customer_id=user(env)["id"], film_id=env["ids"]["film_id"], stars=score,
                created_at=env["clock"][0], updated_at=env["clock"][0])


def test_catalogue_ai_and_screenings_read_the_same_initial_score(env):
    fid = env["ids"]["film_id"]
    with db().begin() as c:
        execute(c, "INSERT INTO film_rating_baselines VALUES(:f,9.7,3352918)", f=fid)
    client = env["app"].test_client()
    film = client.get("/api/ui/bootstrap").json["data"]["films"][0]
    assert film["rating"] == {"average": "9.7", "count": 3352918, "scale": 10}
    token = client.get("/api/ai/session").json["data"]["csrf_token"]
    answer = client.post("/api/ai/chat", headers={"X-CSRF-Token": token}, json={"message": "推荐至少9分的电影"}).json["data"]
    assert answer["status"] == "ok" and answer["filters"]["min_rating"] == 9
    assert answer["films"][0]["rating"] == 9.7 and answer["films"][0]["rating_scale"] == 10
    assert "/10" in answer["reply"] and "豆瓣" not in answer["reply"]
    result = client.get("/api/screenings", query_string={"date": "2026-10-23", "party_size": 1, "min_rating": 9}).json["data"]
    assert result["items"] and all(s["rating"] == film["rating"] for s in result["items"])
    assert not client.get("/api/screenings", query_string={"date": "2026-10-23", "min_rating": 10}).json["data"]["items"]
    assert client.get("/api/screenings?min_rating=11").status_code == 400


def test_ten_is_not_parsed_as_one_by_offline_agent(env):
    client = env["app"].test_client()
    token = client.get("/api/ai/session").json["data"]["csrf_token"]
    result = client.post("/api/ai/chat", headers={"X-CSRF-Token": token}, json={"message": "推荐评分10分的电影"}).json["data"]
    assert result["filters"]["min_rating"] == 10 and not result["films"]
