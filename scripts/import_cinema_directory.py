"""Apply the user-supplied six-cinema directory without resetting films or bookings.

Dry-run by default. Existing cinema/screen/layout/seat/showtime IDs are preserved.
Only new cinemas receive new demo halls and the existing five-film programme.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime
import json
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import dotenv_values
from flask import Flask
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.security import generate_password_hash

from cinema.core import BEIJING, Problem, get, ins, make_engine, one, require, rows, upd, wire
from cinema.management import validate_programme, insert_programme
from scripts.import_film_programme import load_programme, plan_programme, write_private_json


def load_directory():
    return json.loads((ROOT / "data/beijing-cinemas-oct2026.json").read_text(encoding="utf-8"))


def resolve_cinema(c, item):
    found = rows(c, "SELECT * FROM cinemas WHERE name=:n OR name=:old ORDER BY id",
                 n=item["name"], old=item.get("legacy_name"))
    require(len(found) <= 1, "AMBIGUOUS_CINEMA", f"Review duplicate cinema: {item['name']}")
    require(bool(found) or not item.get("legacy_name"), "CINEMA_MISSING",
            f"Cannot locate original cinema for {item['name']}; no changes applied")
    return found[0] if found else None


def preview(c, directory):
    return [{"name": item["name"], "district": item["district_name"], "address": item["address"],
             "action": "update, retain IDs and programme" if resolve_cinema(c, item) else "add with demo programme",
             "coordinate_system": item["coordinate_system"]} for item in directory["cinemas"]]


def import_directory(engine, directory, start, days, at, output_dir):
    stamp = datetime.now(BEIJING).strftime("%Y%m%d-%H%M%S-%f")
    backup_path = output_dir / f"before-{stamp}.json"
    accounts_path = output_dir / f"new-manager-accounts-{stamp}.json"
    programme = load_programme()
    accounts, new_halls, updated = [], [], []
    with engine.begin() as c:
        resolved = [(item, resolve_cinema(c, item)) for item in directory["cinemas"]]
        # Serialize imports and staff publishing on existing physical halls first.
        for item, existing in sorted(resolved, key=lambda x: x[1]["id"] if x[1] else 2**63):
            if not existing:
                continue
            for screen in rows(c, "SELECT id FROM screens WHERE cinema_id=:id ORDER BY id", id=existing["id"]):
                get(c, "screens", screen["id"], True)
            fresh = get(c, "cinemas", existing["id"], True)
            require(fresh == existing, "CINEMA_CHANGED", "Cinema changed during planning; retry after reviewing")
        # A second import waiting on the locks must observe newly created cinemas.
        resolved = [(item, resolve_cinema(c, item)) for item in directory["cinemas"]]
        write_private_json(backup_path, dict(database=engine.url.database,
            cinemas=[existing for _, existing in resolved if existing],
            districts=rows(c, "SELECT * FROM districts ORDER BY id")))
        for item, existing in resolved:
            district = one(c, "SELECT * FROM districts WHERE admin_code=:code", code=item["district_code"])
            did = district["id"] if district else ins(c, "districts", admin_code=item["district_code"], name=item["district_name"])
            values = {k: item[k] for k in ("name", "brand", "address", "latitude", "longitude", "coordinate_system")}
            values["district_id"] = did
            if existing:
                cid = existing["id"]
                upd(c, "cinemas", cid, **values)
                # Never change credentials, roles, manager ownership, halls, or bookings.
            else:
                cid = ins(c, "cinemas", **values, is_active=False)
                password = secrets.token_urlsafe(24)
                email = f"manager.{item['key']}@cinema.test"
                require(not one(c, "SELECT id FROM users WHERE email_normalized=:e", e=email),
                        "ACCOUNT_EXISTS", "New branch account already exists; review before importing")
                uid = ins(c, "users", display_name=item["name"] + " 演示店长", email_normalized=email,
                          password_hash=generate_password_hash(password), role="STAFF",
                          staff_cinema_id=cid, created_at=at)
                upd(c, "cinemas", cid, manager_user_id=uid, is_active=True)
                accounts.append(dict(cinema_id=cid, cinema_name=item["name"], email=email, password=password))
                sid = ins(c, "screens", cinema_id=cid, name="Demo Screen 1", screen_type=item["demo_screen_type"])
                lid = ins(c, "layouts", screen_id=sid, version_no=1, screen_direction="TOP", row_count=12, created_at=at)
                # Same 72-seat demonstration layout as the retained halls.
                for row in range(1, 13):
                    for seat in range(1, 7):
                        ins(c, "seats", layout_id=lid, row_no=row, seat_no=seat, aisle_segment=1,
                            segment_position=seat, map_x=seat-1, map_y=row-1)
                new_halls.append(dict(screen_id=sid, layout_id=lid, cinema_id=cid,
                                      cinema_name=item["name"], screen_type=item["demo_screen_type"], manager_user_id=uid))
            updated.append(dict(cinema_id=cid, name=item["name"], district=item["district_name"], created=existing is None))
        # Only add schedules for newly created halls. Existing shows/prices remain untouched.
        plan = plan_programme(programme, new_halls, start, days, at)
        require(not new_halls or bool(plan), "EMPTY_PLAN", "No future shows; choose a current/future date")
        if new_halls:
            film_ids = {}
            for film in programme["films"]:
                matches = rows(c, "SELECT * FROM films WHERE title=:title", title=film["title"])
                require(len(matches) == 1 and not matches[0]["archived"] and
                        matches[0]["duration_minutes"] == film["duration_minutes"],
                        "FILMS_CHANGED", "Install/review the five-film programme before adding branches")
                film_ids[film["key"]] = matches[0]["id"]
            for slot in plan:
                values, fares = validate_programme(c, get(c, "users", slot["manager_user_id"]), dict(
                    film_id=film_ids[slot["key"]], layout_id=slot["layout_id"], fares=slot["fares"],
                    starts_at=slot["starts_at"].replace(tzinfo=BEIJING).isoformat()))
                slot["screening_id"] = insert_programme(c, values, fares)
        # Keep generated credentials private and durable before committing their accounts.
        if accounts:
            write_private_json(accounts_path, dict(note="Local demonstration accounts only", accounts=accounts))
        counts = rows(c, """SELECT c.id AS cinema_id,c.name,COUNT(s.id) AS screenings
                      FROM cinemas c LEFT JOIN screenings s ON s.cinema_id=c.id
                      GROUP BY c.id,c.name ORDER BY c.name,c.id""")
    return dict(cinemas=updated, added_cinemas=len(new_halls), added_screenings=len(plan),
                programme_counts=counts, backup=str(backup_path),
                private_accounts_file=str(accounts_path) if accounts else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--start-date", type=date.fromisoformat)
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()
    url = os.getenv("DATABASE_URL") or dotenv_values(ROOT / ".env").get("DATABASE_URL")
    require(bool(url) and make_url(url).database == "cinema_demo", "WRONG_DATABASE", "CLI only supports cinema_demo")
    at = datetime.now(BEIJING).replace(tzinfo=None)
    engine = make_engine(url)
    try:
        directory = load_directory()
        if not args.apply:
            with engine.connect() as c:
                result = dict(mode="dry-run", cinemas=preview(c, directory))
        else:
            app = Flask("cinema-directory-import")
            app.config["CLOCK"] = lambda: datetime.now(BEIJING).replace(tzinfo=None)
            with app.app_context():
                result = import_directory(engine, directory, args.start_date or at.date(), args.days, at,
                                          ROOT / "instance/cinema-directory")
            report = ROOT / f"output/cinema-directory/applied-{at.strftime('%Y%m%d-%H%M%S-%f')}.json"
            write_private_json(report, result)
            result.update(mode="applied", report=str(report))
        print(json.dumps(wire(result), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Problem as error:
        raise SystemExit(f"{error.code}: {error.message}")
    except SQLAlchemyError:
        raise SystemExit("DATABASE_ERROR: changes rolled back; inspect database constraints/connection")
