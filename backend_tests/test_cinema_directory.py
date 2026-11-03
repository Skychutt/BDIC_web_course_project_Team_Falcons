from datetime import date
import json
from pathlib import Path

import pytest

from cinema.core import Problem, db, in_ids, one, rows
from scripts.import_cinema_directory import import_directory, load_directory
from scripts.import_film_programme import import_programme, load_programme, read_halls


def apply_directory(env, tmp_path):
    return import_directory(db(), load_directory(), date(2026, 10, 24), 7,
                            env["clock"][0], tmp_path)


def test_six_cinemas_keep_identifiers_and_existing_programme(env, tmp_path):
    import_programme(db(), load_programme(), date(2026, 10, 24), 7,
                     env["clock"][0], tmp_path / "films")
    with db().connect() as c:
        previous = {t: rows(c, f"SELECT * FROM {t} ORDER BY id") for t in
                    ("screenings", "fares", "screens", "layouts", "seats", "users", "wallets", "films")}
        old_cinema_ids = {x["name"]: x["id"] for x in rows(c, "SELECT * FROM cinemas")}
    result = apply_directory(env, tmp_path / "directory")
    assert result["added_cinemas"] == 3 and result["added_screenings"] == 126
    assert Path(result["private_accounts_file"]).stat().st_mode & 0o777 == 0o600
    assert len(json.loads(Path(result["private_accounts_file"]).read_text())["accounts"]) == 3
    with db().connect() as c:
        current = rows(c, "SELECT c.*,d.admin_code FROM cinemas c JOIN districts d ON d.id=c.district_id")
        assert len(current) == 6
        for item in load_directory()["cinemas"]:
            cinema = next(x for x in current if x["name"] == item["name"])
            assert cinema["admin_code"] == item["district_code"]
            assert cinema["coordinate_system"] == "GCJ02"
            assert str(cinema["latitude"]) == item["latitude"]
            assert str(cinema["longitude"]) == item["longitude"]
            if item["legacy_name"]:
                assert cinema["id"] == old_cinema_ids[item["legacy_name"]]
            assert one(c, "SELECT COUNT(*) n FROM screenings WHERE cinema_id=:cid", cid=cinema["id"])["n"] == 42
        for table, before in previous.items():
            ids = in_ids([x["id"] for x in before])
            assert rows(c, f"SELECT * FROM {table} WHERE id IN ({ids}) ORDER BY id") == before
        assert len(read_halls(c)) == 6
        assert one(c, "SELECT COUNT(*) n FROM seats")["n"] == 432
        assert one(c, "SELECT COUNT(*) n FROM screenings")["n"] == 252
        assert one(c, "SELECT COUNT(*) n FROM screenings a JOIN screenings b ON a.screen_id=b.screen_id AND a.id<b.id AND a.starts_at<b.occupied_until AND b.starts_at<a.occupied_until")["n"] == 0
    repeated = apply_directory(env, tmp_path / "repeat")
    assert repeated["added_cinemas"] == 0 and repeated["added_screenings"] == 0
    assert repeated["private_accounts_file"] is None
    client = env["app"].test_client()
    catalogue = client.get("/api/ui/bootstrap").get_json()["data"]
    assert len(catalogue["cinemas"]) == 6
    assert {x["name"] for x in catalogue["cinemas"]} == {x["name"] for x in load_directory()["cinemas"]}
    assert all(x["coordinate_system"] == "GCJ02" and x["latitude"] and x["longitude"] for x in catalogue["cinemas"])


def test_missing_films_roll_back_directory_managers_and_seats(env, tmp_path):
    with db().connect() as c:
        before = {t: rows(c, f"SELECT * FROM {t} ORDER BY id") for t in
                  ("cinemas", "districts", "users", "screens", "layouts", "seats", "screenings")}
    with pytest.raises(Problem) as error:
        apply_directory(env, tmp_path)
    assert error.value.code == "FILMS_CHANGED"
    with db().connect() as c:
        for table, original in before.items():
            assert rows(c, f"SELECT * FROM {table} ORDER BY id") == original
    assert not list(tmp_path.glob("new-manager-accounts-*.json"))
