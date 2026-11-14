"""Add the November catalogue without resetting existing films, sales or reviews.

Dry-run by default; --apply publishes a repeatable, date-relative demo programme.
Real film/cinema facts and external ratings live in the versioned manifest.
All added rooms, seats, fares and showtimes are student demonstration data.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta
import json
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import dotenv_values
from flask import Flask
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.security import generate_password_hash

from cinema.core import BEIJING, Problem, get, ins, make_engine, one, require, rows, upd, wire
from cinema.management import insert_programme, validate_programme
from cinema.rating_snapshots import import_snapshots, validate_snapshot
from scripts.import_film_programme import ensure_films, load_programme, write_private_json


def load_expansion():
    return json.loads((ROOT / "data/catalogue-expansion-20261114.json").read_text())


def hall_specs(manifest):
    specs = []
    for cinema in manifest["existing_cinemas"]:
        specs.append(dict(cinema_name=cinema["name"], screen_name="Catalogue Demo 1",
                          screen_type=cinema["demo_screen_type"], new_cinema=False, lane=0))
    for cinema in manifest["cinemas"]:
        for lane, kind in enumerate(cinema["demo_screen_types"]):
            specs.append(dict(cinema_name=cinema["name"], screen_name=f"Catalogue Demo {lane + 1}",
                              screen_type=kind, new_cinema=True, lane=lane))
    return specs


def plan_expansion(manifest, start, days, at):
    require(type(days) is int and 1 <= days <= 14, "VALIDATION", "days must be 1..14")
    require(at.tzinfo is None and start >= at.date(), "VALIDATION", "Use current/future Beijing dates")
    new = manifest["films"]
    all_films = load_programme()["films"] + new
    plan = []
    # Calendar and cinema position, rather than invocation time or random DB IDs,
    # determine rotation. Re-importing an overlapping date window is stable.
    names = [c["name"] for c in manifest["existing_cinemas"] + manifest["cinemas"]]
    for day in range(days):
        on = start + timedelta(days=day)
        for hall in hall_specs(manifest):
            films = all_films if hall["new_cinema"] else new
            offset = (on.toordinal() + names.index(hall["cinema_name"])) % len(films)
            rotated = films[offset:] + films[:offset]
            selection = rotated[hall["lane"]::2] if hall["new_cinema"] else rotated
            starts = datetime.combine(on, time(10))
            for film in selection:
                ends = starts + timedelta(minutes=film["duration_minutes"])
                occupied = ends + timedelta(minutes=15)
                premium = {"STANDARD": 0, "IMAX": 2000, "DOLBY_CINEMA": 1600}[hall["screen_type"]]
                price = film["base_price_minor"] + premium + (600 if on.weekday() >= 5 else 0)
                if starts >= at + timedelta(minutes=45):
                    plan.append(dict(**hall, key=film["key"], title=film["title"], starts_at=starts,
                                     ends_at=ends, occupied_until=occupied,
                                     fares={"STANDARD": price, "STUDENT": price // 2}))
                starts = occupied
    require(bool(plan), "EMPTY_PLAN", "No future screenings; choose a later date")
    return plan


def unique(c, table, **criteria):
    matches = rows(c, f"SELECT * FROM {table} WHERE " + " AND ".join(f"{k}=:{k}" for k in criteria), **criteria)
    require(len(matches) <= 1, "AMBIGUOUS_DATA", f"Duplicate {table}; review before importing")
    return matches[0] if matches else None


def preflight(c, manifest):
    for film in manifest["films"]:
        validate_snapshot(film["rating_snapshot"])
        require(film["rating_seed"] == {k: film["rating_snapshot"][k] for k in ("score", "vote_count")},
                "RATING_MISMATCH", "Baseline must match the verified rating snapshot")
    for film in load_programme()["films"]:
        item = unique(c, "films", title=film["title"])
        require(item and not item["archived"] and item["duration_minutes"] == film["duration_minutes"],
                "BASE_CATALOGUE_MISSING", "Install/review the existing five-film programme first")
    for cinema in manifest["existing_cinemas"]:
        item = unique(c, "cinemas", name=cinema["name"])
        require(item and item["is_active"] and item["manager_user_id"],
                "BASE_CATALOGUE_MISSING", "Install/review the existing six-cinema directory first")


def create_cinema(c, item, at, accounts):
    existing = unique(c, "cinemas", name=item["name"])
    if existing:
        return existing
    district = unique(c, "districts", admin_code=item["district_code"])
    did = district["id"] if district else ins(c, "districts", admin_code=item["district_code"], name=item["district_name"])
    cid = ins(c, "cinemas", district_id=did, is_active=False,
              **{k: item[k] for k in ("name", "brand", "address", "latitude", "longitude", "coordinate_system")})
    email = f"manager.{item['key']}@cinema.test"
    require(not unique(c, "users", email_normalized=email), "ACCOUNT_EXISTS", "Review existing branch manager account")
    password = secrets.token_urlsafe(24)
    uid = ins(c, "users", display_name=item["name"] + " 演示店长", email_normalized=email,
              password_hash=generate_password_hash(password), role="STAFF", staff_cinema_id=cid, created_at=at)
    upd(c, "cinemas", cid, manager_user_id=uid, is_active=True)
    accounts.append(dict(cinema_id=cid, cinema_name=item["name"], email=email, password=password))
    return get(c, "cinemas", cid)


def ensure_hall(c, spec, at):
    cinema = unique(c, "cinemas", name=spec["cinema_name"])
    require(cinema and cinema["is_active"] and cinema["manager_user_id"], "CINEMA_CHANGED", "Cinema must be active with a manager")
    screen = unique(c, "screens", cinema_id=cinema["id"], name=spec["screen_name"])
    if screen:
        get(c, "screens", screen["id"], True)
        require(screen["screen_type"] == spec["screen_type"], "HALL_CHANGED", "Demo hall type changed; review before importing")
        layouts = rows(c, "SELECT * FROM layouts WHERE screen_id=:s ORDER BY version_no", s=screen["id"])
        require(len(layouts) == 1, "HALL_CHANGED", "Demo layout changed; review before importing")
        lid = layouts[0]["id"]
    else:
        sid = ins(c, "screens", cinema_id=cinema["id"], name=spec["screen_name"], screen_type=spec["screen_type"])
        screen = get(c, "screens", sid)
        lid = ins(c, "layouts", screen_id=sid, version_no=1, screen_direction="TOP", row_count=12, created_at=at)
        for row in range(1, 13):
            for seat in range(1, 7):
                ins(c, "seats", layout_id=lid, row_no=row, seat_no=seat, aisle_segment=1,
                    segment_position=seat, map_x=seat - 1, map_y=row - 1)
    return dict(screen_id=screen["id"], layout_id=lid, manager_user_id=cinema["manager_user_id"])


def expand_catalogue(engine, manifest, start, days, at, output_dir):
    plan = plan_expansion(manifest, start, days, at)
    stamp = datetime.now(BEIJING).strftime("%Y%m%d-%H%M%S-%f")
    accounts = []
    lock_name = f"{engine.url.database}:catalogue-expansion"[:64]
    with engine.connect() as c:
        require(one(c, "SELECT GET_LOCK(:name,5) acquired", name=lock_name)["acquired"] == 1,
                "IMPORT_BUSY", "Another catalogue import is running")
        c.commit()
        try:
            with c.begin():
                preflight(c, manifest)
                tables = ("films", "film_genres", "film_rating_baselines", "film_rating_snapshots",
                          "cinemas", "districts", "screens", "layouts", "seats", "screenings", "fares")
                before = {t: rows(c, f"SELECT * FROM {t}") for t in tables}
                backup = output_dir / f"before-{stamp}.json"
                write_private_json(backup, dict(database=engine.url.database, tables=before))
                film_ids = ensure_films(c, manifest)
                for film in manifest["films"]:
                    fid = film_ids[film["key"]]
                    # Reruns preserve later user activity and newer external snapshots.
                    if not one(c, "SELECT film_id FROM film_rating_baselines WHERE film_id=:f", f=fid):
                        c.exec_driver_sql("INSERT INTO film_rating_baselines(film_id,score,vote_count) VALUES(%s,%s,%s)",
                                          (fid, film["rating_seed"]["score"], film["rating_seed"]["vote_count"]))
                    if not one(c, "SELECT film_id FROM film_rating_snapshots WHERE film_id=:f", f=fid):
                        import_snapshots(c, [film["rating_snapshot"]])
                for film in load_programme()["films"]:
                    film_ids[film["key"]] = unique(c, "films", title=film["title"])["id"]
                for item in manifest["cinemas"]:
                    create_cinema(c, item, at, accounts)
                halls = {(s["cinema_name"], s["screen_name"]): ensure_hall(c, s, at)
                         for s in hall_specs(manifest)}
                created = skipped = 0
                for slot in plan:
                    hall = halls[slot["cinema_name"], slot["screen_name"]]
                    fid = film_ids[slot["key"]]
                    existing = unique(c, "screenings", screen_id=hall["screen_id"], starts_at=slot["starts_at"])
                    if existing:
                        require(existing["film_id"] == fid and existing["layout_id"] == hall["layout_id"]
                                and all(existing[k] == slot[k] for k in ("ends_at", "occupied_until")),
                                "SLOT_CHANGED", "A demo slot was changed; review before importing")
                        # Preserve staff cancellations, price edits and booking history.
                        skipped += 1
                        continue
                    values, fares = validate_programme(c, get(c, "users", hall["manager_user_id"]), dict(
                        film_id=fid, layout_id=hall["layout_id"], fares=slot["fares"],
                        starts_at=slot["starts_at"].replace(tzinfo=BEIJING).isoformat()))
                    insert_programme(c, values, fares)
                    created += 1
                accounts_file = output_dir / f"new-manager-accounts-{stamp}.json"
                if accounts:
                    write_private_json(accounts_file, dict(accounts=accounts))
                counts = {t: one(c, f"SELECT COUNT(*) n FROM {t}")["n"] for t in ("films", "cinemas", "screens", "seats", "screenings")}
                result = dict(added={t: counts[t] - len(before[t]) for t in counts}, totals=counts,
                              added_screenings=created, retained_screenings=skipped, backup=str(backup),
                              private_accounts_file=str(accounts_file) if accounts else None,
                              start_date=start, end_date=start + timedelta(days=days - 1))
        finally:
            c.execute(text("SELECT RELEASE_LOCK(:name)"), dict(name=lock_name))
            c.commit()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--start-date", type=date.fromisoformat)
    parser.add_argument("--days", type=int, default=14)
    args = parser.parse_args()
    url = os.getenv("DATABASE_URL") or dotenv_values(ROOT / ".env").get("DATABASE_URL")
    require(bool(url) and make_url(url).database == "cinema_demo", "WRONG_DATABASE", "CLI only supports cinema_demo")
    at = datetime.now(BEIJING).replace(tzinfo=None)
    start = args.start_date or at.date()
    manifest = load_expansion()
    engine = make_engine(url)
    try:
        if args.apply:
            app = Flask("catalogue-expansion")
            with app.app_context():
                result = expand_catalogue(engine, manifest, start, args.days, at, ROOT / "instance/catalogue-expansion")
        else:
            with engine.connect() as c:
                preflight(c, manifest)
                result = dict(mode="dry-run", films=[f["title"] for f in manifest["films"]],
                              cinemas=[x["name"] for x in manifest["cinemas"]],
                              planned_slots_including_existing=len(plan_expansion(manifest, start, args.days, at)),
                              note="Existing matching slots are retained; no database writes in dry-run.")
        print(json.dumps(wire(result), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Problem as error:
        raise SystemExit(f"{error.code}: {error.message}")
    except SQLAlchemyError:
        raise SystemExit("DATABASE_ERROR: changes rolled back; review the local database connection/constraints")
