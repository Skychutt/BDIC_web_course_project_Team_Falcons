"""Replace the unused Shaun programme with Niu Lai and import initial platform ratings.

Dry-run by default; only the local cinema_demo schema is writable from this CLI.
The 10-point rating schema must be initialized/migrated before this import.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import dotenv_values
from flask import Flask
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from cinema.core import BEIJING, Problem, execute, get, in_ids, make_engine, now, one, require, rows, upd, wire
from cinema.management import validate_programme
from cinema.ratings import import_rating_baselines
from scripts.import_film_programme import ensure_films, load_programme, write_private_json

OLD_TITLE = "Shaun the Sheep: The Beast of Mossy Bottom"


def update_featured_films(engine, programme, backup_dir):
    with engine.begin() as c:
        # Same lock order as staff publishing: physical screens before films/showtimes.
        for screen in rows(c, """SELECT DISTINCT s.screen_id AS id FROM screenings s
            JOIN films f ON f.id=s.film_id WHERE f.title=:title ORDER BY s.screen_id""", title=OLD_TITLE):
            get(c, "screens", screen["id"], True)
        old = rows(c, "SELECT * FROM films WHERE title=:title FOR UPDATE", title=OLD_TITLE)
        require(len(old) <= 1, "AMBIGUOUS_FILM", "More than one Shaun film matches")
        shows = []
        if old:
            fid = old[0]["id"]
            shows = rows(c, "SELECT * FROM screenings WHERE film_id=:f ORDER BY id FOR UPDATE", f=fid)
            ids = in_ids(s["id"] for s in shows)
            for table, condition in [
                ("bookings", "film_id=:f"), ("seat_holds", "film_id=:f"),
                ("ratings", "film_id=:f"), ("seat_allocations", f"screening_id IN ({ids})"),
                ("operations", f"source_screening_id IN ({ids}) OR result_screening_id IN ({ids})"),
            ]:
                require(one(c, f"SELECT COUNT(*) AS n FROM {table} WHERE {condition}", f=fid)["n"] == 0,
                        "FILM_IN_USE", f"Shaun has {table} history; no films or scores changed")
            require(all(s["starts_at"] > now() and s["status"] == "PUBLISHED" for s in shows),
                    "PROGRAMME_CHANGED", "Shaun screenings are no longer unused future screenings")
        backup = backup_dir / ("before-" + datetime.now(BEIJING).strftime("%Y%m%d-%H%M%S-%f") + ".json")
        write_private_json(backup, dict(database=engine.url.database,
            films=rows(c, "SELECT * FROM films ORDER BY id"),
            film_genres=rows(c, "SELECT * FROM film_genres ORDER BY film_id,genre_id"),
            initial_ratings=rows(c, "SELECT * FROM film_rating_baselines ORDER BY film_id"),
            screenings=shows,
            fares=rows(c, f"SELECT * FROM fares WHERE screening_id IN ({in_ids(s['id'] for s in shows)})")))
        film_ids = ensure_films(c, programme)
        for screening in shows:
            cinema = get(c, "cinemas", screening["cinema_id"])
            actor = get(c, "users", cinema["manager_user_id"])
            fares = {r["fare_type"]: r["price_minor"] for r in rows(c,
                "SELECT * FROM fares WHERE screening_id=:s", s=screening["id"])}
            values, _ = validate_programme(c, actor, dict(
                film_id=film_ids["niu-lai"], layout_id=screening["layout_id"], fares=fares,
                starts_at=screening["starts_at"].replace(tzinfo=BEIJING).isoformat()), excluded=screening["id"])
            upd(c, "screenings", screening["id"], **{k: values[k] for k in
                ("film_id", "ends_at", "occupied_until", "duration_minutes_snapshot", "turnaround_minutes")},
                revision_no=screening["revision_no"] + 1)
        if old:
            execute(c, "DELETE FROM film_genres WHERE film_id=:f", f=old[0]["id"])
            execute(c, "DELETE FROM films WHERE id=:f", f=old[0]["id"])
        import_rating_baselines(c, programme, film_ids)
        return dict(replaced_screenings=len(shows), film_ids={k: str(v) for k, v in film_ids.items()},
                    initial_ratings=len(programme["films"]), backup=str(backup))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    programme = load_programme()
    url = os.environ.get("DATABASE_URL") or dotenv_values(ROOT / ".env").get("DATABASE_URL")
    require(bool(url) and make_url(url).database == "cinema_demo", "WRONG_DATABASE", "Only cinema_demo is allowed")
    engine = make_engine(url)
    try:
        if not args.apply:
            with engine.connect() as c:
                shows = one(c, """SELECT COUNT(*) AS n FROM screenings s JOIN films f ON f.id=s.film_id
                    WHERE f.title=:title""", title=OLD_TITLE)["n"]
            print(json.dumps(dict(mode="dry-run", replacement="牛来 (Niu Lai)", screenings=shows,
                ratings={f["title"]: f["rating_seed"]["score"] for f in programme["films"]}), ensure_ascii=False, indent=2))
            return
        app = Flask("featured-films-update")
        with app.app_context():
            result = update_featured_films(engine, programme, ROOT / "instance/featured-films")
        print(json.dumps(wire(dict(mode="applied", **result)), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Problem as exc:
        raise SystemExit(f"{exc.code}: {exc.message}") from None
    except SQLAlchemyError:
        raise SystemExit("Database operation failed; film/rating data changes were rolled back.") from None
