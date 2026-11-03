"""Upgrade the local demo to unified 10-point ratings. Stop the web server first.

Back up rating data/schema before changes. DDL is idempotent; vote conversion,
baseline import and the version marker commit atomically, so retries never double
an already converted vote. Remove the obsolete reference table only after commit.
"""
from datetime import datetime
import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy.engine import make_url
from cinema.core import BEIJING, execute, make_engine, one, require, rows, wire
from cinema.ratings import VERSION, create_rating_tables
from scripts.import_film_programme import write_private_json


def table_exists(c, name):
    return bool(one(c, "SELECT 1 AS found FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=:name", name=name))


def migrate(engine, backup_dir):
    lock = "rating_upgrade_" + hashlib.sha256(engine.url.database.encode()).hexdigest()[:24]
    with engine.connect() as c:
        require(one(c, "SELECT GET_LOCK(:name,10) AS acquired", name=lock)["acquired"] == 1,
                "BUSY", "Another rating migration is running")
        c.commit()
        try:
            done = table_exists(c, "rating_schema_versions") and one(c,
                "SELECT version FROM rating_schema_versions WHERE version=:v", v=VERSION)
            legacy = table_exists(c, "film_reference_ratings")
            if done:
                if legacy:
                    # Resume a migration interrupted after its data transaction.
                    c.exec_driver_sql("DROP TABLE film_reference_ratings")
                    c.commit()
                return {"status": "already_applied", "converted_votes": 0}
            votes = rows(c, "SELECT * FROM ratings ORDER BY id")
            references = rows(c, "SELECT * FROM film_reference_ratings ORDER BY film_id") if legacy else []
            require(all(1 <= r["stars"] <= 5 for r in votes), "UNEXPECTED_SCALE", "Unversioned ratings contain scores above 5; inspect before converting")
            require(all(r["scale"] == 10 and 1 <= r["score"] <= 10 and r["vote_count"] > 0 for r in references),
                    "INVALID_BASELINE", "Imported ratings must use the 10-point scale with a positive count")
            backup = Path(backup_dir) / ("before-" + datetime.now(BEIJING).strftime("%Y%m%d-%H%M%S-%f") + ".json")
            write_private_json(backup, {"database": engine.url.database, "ratings": votes, "reference_ratings": references,
                "ratings_ddl": c.exec_driver_sql("SHOW CREATE TABLE ratings").first()[1]})
            c.commit()
            create_rating_tables(engine)
            checks = rows(c, """SELECT tc.CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS tc
                JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
                AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
                WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='ratings' AND tc.CONSTRAINT_TYPE='CHECK'
                AND cc.CHECK_CLAUSE LIKE '%stars%'""")
            for check in checks:
                name = check["name"].replace("`", "``")
                c.exec_driver_sql(f"ALTER TABLE ratings DROP CHECK `{name}`")
            c.exec_driver_sql("ALTER TABLE ratings MODIFY stars TINYINT NOT NULL COMMENT '1 to 10 points, editable', ADD CONSTRAINT ck_ratings_ten_point CHECK (stars BETWEEN 1 AND 10)")
            c.commit()
            with c.begin():
                execute(c, "UPDATE ratings SET stars=stars*2")
                if legacy:
                    execute(c, """INSERT INTO film_rating_baselines(film_id,score,vote_count)
                        SELECT film_id,score,vote_count FROM film_reference_ratings""")
                execute(c, "INSERT INTO rating_schema_versions(version) VALUES(:v)", v=VERSION)
            if legacy:
                c.exec_driver_sql("DROP TABLE film_reference_ratings")
                c.commit()
            return {"status": "applied", "converted_votes": len(votes), "initial_ratings": len(references), "backup": str(backup)}
        finally:
            c.rollback()
            execute(c, "SELECT RELEASE_LOCK(:name)", name=lock)
            c.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    socket = ROOT / "instance/mysql/mysql.sock"
    require(socket.exists(), "DATABASE_UNAVAILABLE", "Start the project-local MySQL first")
    url = "mysql+pymysql://root@localhost/cinema_demo?charset=utf8mb4&unix_socket=" + quote(str(socket), safe="")
    require(make_url(url).database == "cinema_demo", "WRONG_DATABASE", "Only cinema_demo may be migrated")
    engine = make_engine(url)
    try:
        if args.apply:
            result = migrate(engine, ROOT / "instance/rating-migration")
        else:
            with engine.connect() as c:
                result = {"status": "dry_run", "customer_votes": one(c, "SELECT COUNT(*) AS n FROM ratings")["n"],
                          "legacy_scores": one(c, "SELECT COUNT(*) AS n FROM film_reference_ratings")["n"] if table_exists(c, "film_reference_ratings") else 0}
        print(json.dumps(wire(result), ensure_ascii=False, indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
