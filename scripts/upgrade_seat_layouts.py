"""Version the legacy 72-seat demo halls without changing any booked seats.

Dry-run by default. Only future, published, unreferenced screenings are moved.
All old layouts and seats remain available to historical orders and holds.
"""
from datetime import datetime
from pathlib import Path
import argparse
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import dotenv_values
from sqlalchemy.engine import make_url
from cinema.core import BEIJING, make_engine, one, require, rows, upd, wire
from cinema.seating import auditorium_layout, insert_auditorium, legacy_layout, same_layout
from scripts.import_film_programme import write_private_json


def upgrade_layouts(engine, at, backup_dir, apply=False):
    result = dict(mode="applied" if apply else "dry-run", halls=[], new_layouts=0, moved_screenings=0,
                  protected_screenings=0)
    with engine.begin() as c:
        # Same lock order as booking.scope and staff publishing. A concurrent hold
        # either finishes before this inspection or validates against the new layout.
        screens = rows(c, "SELECT * FROM screens ORDER BY id FOR UPDATE")
        plans = []
        for screen in screens:
            versions = rows(c, "SELECT * FROM layouts WHERE screen_id=:s ORDER BY version_no", s=screen["id"])
            if not versions:
                continue
            latest = versions[-1]
            target = auditorium_layout(screen["screen_type"])
            seats = rows(c, "SELECT * FROM seats WHERE layout_id=:l", l=latest["id"])
            is_current = same_layout(latest, seats, target)
            if not is_current and not legacy_layout(latest, seats):
                result["halls"].append(dict(screen_id=screen["id"], action="custom layout preserved"))
                continue
            legacy_ids = {l["id"] for l in versions if legacy_layout(l, rows(c, "SELECT * FROM seats WHERE layout_id=:l", l=l["id"]))}
            shows = rows(c, """SELECT * FROM screenings WHERE screen_id=:s
                AND starts_at>:at AND status='PUBLISHED' ORDER BY id FOR UPDATE""", s=screen["id"], at=at)
            movable = []
            protected = 0
            for show in shows:
                if show["layout_id"] not in legacy_ids:
                    continue
                # Even expired/cancelled holds have composite foreign keys and
                # historical seat references. Never rewrite any of these records.
                referenced = any(one(c, f"SELECT id FROM {table} WHERE screening_id=:s LIMIT 1", s=show["id"])
                                 for table in ("bookings", "seat_holds", "seat_allocations"))
                if referenced:
                    protected += 1
                else:
                    movable.append(show)
            result["halls"].append(dict(screen_id=screen["id"], screen_type=screen["screen_type"],
                rows=target["row_count"], seats=len(target["seats"]), new_version=not is_current,
                move=len(movable), protected=protected))
            result["new_layouts"] += int(not is_current)
            result["moved_screenings"] += len(movable)
            result["protected_screenings"] += protected
            plans.append((screen, latest, is_current, movable))
        if apply and (result["new_layouts"] or result["moved_screenings"]):
            backup = backup_dir / f"before-{datetime.now(BEIJING).strftime('%Y%m%d-%H%M%S-%f')}.json"
            write_private_json(backup, dict(database=engine.url.database, tables={
                t: rows(c, f"SELECT * FROM {t}") for t in ("layouts", "seats", "screenings")
            }))
            result["backup"] = str(backup)
            for screen, latest, is_current, movable in plans:
                lid = latest["id"] if is_current else insert_auditorium(c, screen["id"], screen["screen_type"], at)[0]
                for show in movable:
                    upd(c, "screenings", show["id"], layout_id=lid, revision_no=show["revision_no"] + 1)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    url = os.getenv("DATABASE_URL") or dotenv_values(ROOT / ".env").get("DATABASE_URL")
    require(bool(url) and make_url(url).database == "cinema_demo", "WRONG_DATABASE", "CLI only supports cinema_demo")
    engine = make_engine(url)
    try:
        result = upgrade_layouts(engine, datetime.now(BEIJING).replace(tzinfo=None),
                                 ROOT / "instance/seat-layouts", args.apply)
        print(json.dumps(wire(result), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
