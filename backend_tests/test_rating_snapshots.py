import json
from pathlib import Path

import pytest

from cinema.core import db, execute, one
from cinema.rating_snapshots import initialize_rating_snapshots, import_snapshots, validate_snapshot
from backend_tests.test_community import client_for


def snapshot(title):
    return dict(film_title=title, source_name="Douban", source_title="Source title (2026)",
                source_url="https://movie.douban.com/subject/37365064/", checked_on="2026-11-14",
                score=6.6, vote_count=7456, star_5=10.6, star_4=27.6, star_3=47.1, star_2=12.6, star_1=2.1)


def test_snapshot_import_is_repeatable_and_keeps_customer_votes_separate(env):
    fid = env["ids"]["film_id"]
    client, headers = client_for(env)
    path = f"/api/community/films/{fid}"
    assert client.get(path).json["data"]["rating_snapshot"] is None
    assert client.put(path + "/review", headers=headers, json={"stars": 10}).status_code == 200
    with db().begin() as c:
        title = one(c, "SELECT title FROM films WHERE id=:f", f=fid)["title"]
        execute(c, "INSERT INTO film_rating_baselines VALUES(:f,6.6,6084)", f=fid)
        item = snapshot(title)
        assert import_snapshots(c, [item]) == 1
        assert import_snapshots(c, [item]) == 1
        assert one(c, "SELECT COUNT(*) n FROM ratings")["n"] == 1
        assert one(c, "SELECT vote_count FROM film_rating_baselines WHERE film_id=:f", f=fid)["vote_count"] == 6084
    initialize_rating_snapshots(db())
    data = client.get(path).json["data"]
    assert data["votes"] == [{"stars": 10, "count": 1}]
    assert data["rating_snapshot"]["vote_count"] == 7456
    assert data["rating_snapshot"]["score"] == "6.6"
    assert data["rating_snapshot"]["distribution"][0] == {"stars": 5, "percent": "10.6"}
    assert data["rating_snapshot"]["checked_on"] == "2026-11-14"
    assert "film_id" not in data["rating_snapshot"]


def test_invalid_batch_cannot_partially_import_or_replace_newer_snapshots(env):
    with db().begin() as c:
        title = one(c, "SELECT title FROM films WHERE id=:f", f=env["ids"]["film_id"])["title"]
        item = snapshot(title)
        with pytest.raises(ValueError):
            import_snapshots(c, [item, snapshot("Unknown film")])
        assert one(c, "SELECT COUNT(*) n FROM film_rating_snapshots")["n"] == 0
        import_snapshots(c, [item])
        with pytest.raises(ValueError):
            import_snapshots(c, [dict(item, checked_on="2026-11-13")])


@pytest.mark.parametrize("change", [
    {"star_1": None}, {"star_1": -1}, {"star_5": 90}, {"star_5": "NaN"},
    {"star_1": 2.123}, {"vote_count": True}, {"vote_count": 0},
    {"source_url": "javascript:alert(1)"}, {"checked_on": "2999-01-01"},
])
def test_source_snapshot_validation(change):
    with pytest.raises(ValueError):
        validate_snapshot(dict(snapshot("Film"), **change))


def test_checked_in_sources_have_complete_distributions():
    document = json.loads((Path(__file__).resolve().parents[1] / "data/film-rating-snapshots-20261114.json").read_text())
    assert len(document["films"]) == 5
    assert len({item["source_url"] for item in document["films"]}) == 5
    for item in document["films"]:
        validate_snapshot(item)
