"""Replace the unused seed film and publish a repeatable seven-day demo programme.

Dry-run by default. No application factory, AI calls, DDL, or cinema/location writes.
Uses the same programme validation and insertion functions as the staff interface.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter
from datetime import date, datetime, time, timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import dotenv_values
from flask import Flask
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from cinema.core import (
    BEIJING, Problem, execute, get, in_ids, ins, make_engine, one, require, rows, wire,
)
from cinema.management import insert_programme, validate_programme
from cinema.ratings import import_rating_baselines

DATA = ROOT / "data/film-programme-oct2026.json"
HALLS = {"STANDARD": (0, 0), "IMAX": (20, 2000), "DOLBY_CINEMA": (40, 1600)}
SLOTS = [(10, 0, "niu-lai"), (12, 0, "tenzing"),
         (14, 40, "love-hypothesis"), (17, 15, "shawshank-redemption"),
         (20, 0, "resident-evil-2026")]


def load_programme():
    return json.loads(DATA.read_text(encoding="utf-8"))


def read_halls(c, lock=False):
    # Resolve the original fixture or the user's six-cinema directory by name.
    # IDs remain database-owned; later renames must be reflected in the manifest.
    directory = ROOT / "data/beijing-cinemas-oct2026.json"
    names = {"Falcons Chaoyang", "Falcons Haidian", "Falcons Dongcheng"}
    if directory.exists():
        names.update(x["name"] for x in json.loads(directory.read_text(encoding="utf-8"))["cinemas"])
    params = {f"name{i}": name for i, name in enumerate(sorted(names))}
    placeholders = ",".join(":" + key for key in params)
    halls = rows(c, """
        SELECT s.id AS screen_id, s.screen_type, s.name AS screen_name,
               c.id AS cinema_id, c.name AS cinema_name, c.manager_user_id,
               l.id AS layout_id
        FROM screens s JOIN cinemas c ON c.id=s.cinema_id
        JOIN layouts l ON l.screen_id=s.id
        WHERE c.is_active=1 AND c.name IN (""" + placeholders + """)
        AND l.version_no=(SELECT MAX(l2.version_no) FROM layouts l2 WHERE l2.screen_id=s.id)
        ORDER BY s.id
    """, **params)
    require(bool(halls) and all(h["screen_type"] in HALLS for h in halls),
            "HALLS_CHANGED", "No supported programme halls found; review the cinema directory first")
    if lock:
        # Same physical-screen lock as staff publishing; consistent order prevents interleaving.
        for hall in halls:
            get(c, "screens", hall["screen_id"], True)
    return halls


def plan_programme(programme, halls, start_date, days, at):
    """All datetimes here are naive Beijing local time, matching the DB convention."""
    require(1 <= days <= 14, "VALIDATION", "days must be 1..14")
    require(at.tzinfo is None, "VALIDATION", "Clock must be Beijing local time")
    films = {f["key"]: f for f in programme["films"]}
    planned = []
    for day in range(days):
        on = start_date + timedelta(days=day)
        for hall in halls:
            offset, premium = HALLS[hall["screen_type"]]
            # Calendar-based rotation remains stable when the same date is imported again.
            late = ("love-hypothesis", "resident-evil-2026")[(on.toordinal() + offset // 20) % 2]
            for hour, minute, key in [*SLOTS, (22, 0, late)]:
                starts = datetime.combine(on, time(hour, minute)) + timedelta(minutes=offset)
                if starts < at + timedelta(minutes=45):
                    continue
                film = films[key]
                price = film["base_price_minor"] + premium + (600 if on.weekday() >= 5 else 0)
                price += 400 if 17 <= hour < 22 else -600 if hour >= 22 else 0
                ends = starts + timedelta(minutes=film["duration_minutes"])
                planned.append(dict(
                    **hall, key=key, title=film["title"], starts_at=starts, ends_at=ends,
                    occupied_until=ends + timedelta(minutes=15),
                    fares={"STANDARD": price, "STUDENT": price // 2},
                ))
    return sorted(planned, key=lambda s: (s["starts_at"], s["screen_id"]))


def write_private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as f:
        os.chmod(path, 0o600)
        json.dump(wire(value), f, ensure_ascii=False, indent=2)
        f.write("\n")


def remove_unused_seed(c, title, backup_dir):
    old = rows(c, "SELECT * FROM films WHERE title=:title FOR UPDATE", title=title)
    require(len(old) <= 1, "AMBIGUOUS_FILM", "More than one seed film matches; refusing deletion")
    if not old:
        return dict(removed_films=0, removed_screenings=0, backup=None)
    fid = old[0]["id"]
    shows = rows(c, "SELECT * FROM screenings WHERE film_id=:f ORDER BY id FOR UPDATE", f=fid)
    ids = in_ids([s["id"] for s in shows])
    # Never erase purchases, even expired holds, ratings, allocation or operation history.
    guards = [
        ("bookings", "film_id=:f"), ("seat_holds", "film_id=:f"),
        ("ratings", "film_id=:f"), ("seat_allocations", f"screening_id IN ({ids})"),
        ("operations", f"source_screening_id IN ({ids}) OR result_screening_id IN ({ids})"),
    ]
    for table, condition in guards:
        count = one(c, f"SELECT COUNT(*) AS n FROM {table} WHERE {condition}", f=fid)["n"]
        require(count == 0, "SEED_IN_USE", f"Seed film has {table} references; replacement was rolled back")
    snapshot = dict(
        version=1, database=c.engine.url.database, films=old, screenings=shows,
        film_genres=rows(c, "SELECT * FROM film_genres WHERE film_id=:f", f=fid),
        fares=rows(c, f"SELECT * FROM fares WHERE screening_id IN ({ids})"),
    )
    stamp = datetime.now(BEIJING).strftime("%Y%m%d-%H%M%S-%f")
    backup = backup_dir / f"removed-seed-{stamp}.json"
    write_private_json(backup, snapshot)
    execute(c, f"DELETE FROM fares WHERE screening_id IN ({ids})")
    execute(c, "DELETE FROM screenings WHERE film_id=:f", f=fid)
    execute(c, "DELETE FROM film_genres WHERE film_id=:f", f=fid)
    execute(c, "DELETE FROM films WHERE id=:f", f=fid)
    return dict(removed_films=1, removed_screenings=len(shows), backup=str(backup))


def ensure_films(c, programme):
    film_ids = {}
    for film in programme["films"]:
        existing = rows(c, "SELECT * FROM films WHERE title=:title FOR UPDATE", title=film["title"])
        require(len(existing) <= 1, "AMBIGUOUS_FILM", f"Duplicate title: {film['title']}")
        if existing:
            require(not existing[0]["archived"] and
                    existing[0]["duration_minutes"] == film["duration_minutes"],
                    "FILM_CHANGED", f"Review modified film before importing: {film['title']}")
            film_ids[film["key"]] = existing[0]["id"]
            continue
        fid = ins(c, "films", title=film["title"], synopsis=film["synopsis"],
                  duration_minutes=film["duration_minutes"], archived=False)
        film_ids[film["key"]] = fid
        for name in film["genres"]:
            genre = one(c, "SELECT id FROM genres WHERE name=:n", n=name)
            gid = genre["id"] if genre else ins(c, "genres", name=name)
            execute(c, "INSERT INTO film_genres(film_id,genre_id) VALUES(:f,:g)", f=fid, g=gid)
    return film_ids


def import_programme(engine, programme, start_date, days, at, backup_dir):
    # The caller supplies a minimal Flask context for now()/branch validation, never an AI app.
    with engine.begin() as c:
        halls = read_halls(c, lock=True)
        plan = plan_programme(programme, halls, start_date, days, at)
        require(bool(plan), "EMPTY_PLAN", "No future slots; choose a current/future start date")
        removed = remove_unused_seed(c, programme["replace_title"], backup_dir)
        film_ids = ensure_films(c, programme)
        import_rating_baselines(c, programme, film_ids)
        created = skipped = 0
        for slot in plan:
            fid = film_ids[slot["key"]]
            match = rows(c, """SELECT * FROM screenings WHERE screen_id=:s AND starts_at=:t
                            ORDER BY id FOR UPDATE""", s=slot["screen_id"], t=slot["starts_at"])
            if match:
                require(len(match) == 1 and match[0]["film_id"] == fid and
                        match[0]["layout_id"] == slot["layout_id"] and
                        match[0]["status"] == "PUBLISHED" and
                        match[0]["ends_at"] == slot["ends_at"] and
                        match[0]["occupied_until"] == slot["occupied_until"],
                        "SLOT_CHANGED", "A planned slot was modified; no changes applied")
                sid = match[0]["id"]
                current_fares = {r["fare_type"]: r["price_minor"] for r in
                                 rows(c, "SELECT * FROM fares WHERE screening_id=:s", s=sid)}
                require(current_fares == slot["fares"], "FARES_CHANGED",
                        "An existing slot has different fares; no changes applied")
                skipped += 1
            else:
                actor = get(c, "users", slot["manager_user_id"])
                values, fares = validate_programme(c, actor, dict(
                    film_id=fid, layout_id=slot["layout_id"], fares=slot["fares"],
                    starts_at=slot["starts_at"].replace(tzinfo=BEIJING).isoformat(),
                ))
                sid = insert_programme(c, values, fares)
                created += 1
            slot.update(screening_id=sid, film_id=fid)
        return dict(**removed, created=created, skipped=skipped, film_ids=film_ids, screenings=plan)


def summary(plan):
    return dict(
        screening_count=len(plan), by_film=dict(Counter(s["title"] for s in plan)),
        by_cinema=dict(Counter(s["cinema_name"] for s in plan)),
        first_start=min(s["starts_at"] for s in plan) if plan else None,
        last_start=max(s["starts_at"] for s in plan) if plan else None,
        price_ranges_minor={kind: [min(s["fares"][kind] for s in plan),
                                   max(s["fares"][kind] for s in plan)]
                            for kind in ("STANDARD", "STUDENT")} if plan else {},
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Commit the validated replacement")
    parser.add_argument("--start-date", type=date.fromisoformat)
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()
    url = os.environ.get("DATABASE_URL") or dotenv_values(ROOT / ".env").get("DATABASE_URL")
    require(bool(url) and make_url(url).database == "cinema_demo", "WRONG_DATABASE",
            "This CLI only writes cinema_demo; tests call import_programme with disposable schemas")
    at = datetime.now(BEIJING).replace(tzinfo=None)
    start = args.start_date or at.date()
    engine = make_engine(url)
    try:
        programme = load_programme()
        with engine.connect() as c:
            plan = plan_programme(programme, read_halls(c), start, args.days, at)
        if not args.apply:
            print(json.dumps(wire(dict(mode="dry-run", **summary(plan))), ensure_ascii=False, indent=2))
            return
        app = Flask("film-programme-import")
        app.config["CLOCK"] = lambda: datetime.now(BEIJING).replace(tzinfo=None)
        with app.app_context():
            result = import_programme(engine, programme, start, args.days, at,
                                      ROOT / "instance/film-programme/backups")
        stamp = at.strftime("%Y%m%d-%H%M%S-%f")
        report = ROOT / f"output/film-programme/{stamp}.json"
        # Internal manager IDs are not needed in the published programme report.
        for slot in result["screenings"]:
            slot.pop("manager_user_id", None)
        result["film_ids"] = {k: str(v) for k, v in result["film_ids"].items()}
        write_private_json(report, dict(start_date=start, days=args.days, **result))
        csv_path = report.with_suffix(".csv")
        with csv_path.open("x", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["Film", "Cinema", "Hall", "Starts (Beijing)", "Ends (Beijing)",
                             "Standard CNY", "Student CNY", "Screening ID"])
            for s in result["screenings"]:
                writer.writerow([s["title"], s["cinema_name"], s["screen_type"], s["starts_at"],
                                 s["ends_at"], f'{s["fares"]["STANDARD"] / 100:.2f}',
                                 f'{s["fares"]["STUDENT"] / 100:.2f}', str(s["screening_id"])])
        print(json.dumps(wire(dict(
            mode="applied", created=result["created"], skipped=result["skipped"],
            removed_films=result["removed_films"], removed_screenings=result["removed_screenings"],
            backup=result["backup"], report=str(report), csv=str(csv_path),
            **summary(result["screenings"]),
        )), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Problem as error:
        raise SystemExit(f"{error.code}: {error.message}")
    except SQLAlchemyError:
        # Do not print connection strings, passwords or SQL parameters on failure.
        raise SystemExit("DATABASE_ERROR: transaction rolled back; inspect the database connection/constraints")
