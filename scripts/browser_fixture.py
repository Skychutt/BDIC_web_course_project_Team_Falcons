#!/usr/bin/env python3
"""Serve browser QA against one disposable schema; never mutate the demo schema.

Run with an explicit TEST_DATABASE_URL whose account can create/drop schemas.
Ctrl-C or SIGTERM stops the server and drops only this process's random schema.
SIGUSR1 preserves the schema for a subsequent --resume restart.
The predictable fixture password is for this isolated localhost test server only.
"""

import argparse
import json
import os
from pathlib import Path
import secrets
import re
import signal
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from waitress import create_server

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from cinema import create_app
from cinema.cli import initialize
from cinema.core import db, now, rows, wire
from cinema.seed import seed

HOST = "127.0.0.1"
PORT = 5002
PASSWORD = "CinemaBrowser2026!"
METADATA = ROOT / "instance" / "browser-fixture.json"
PRIVATE_STATE = ROOT / "instance" / ".browser-fixture-state.json"


def id_strings(value):
    if isinstance(value, dict):
        return {key: id_strings(item) for key, item in value.items()}
    if isinstance(value, list):
        return [id_strings(item) for item in value]
    return str(value) if isinstance(value, int) else value


def stop(_signum, _frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resume", action="store_true", help="Resume the stopped fixture schema recorded in metadata; do not seed it again")
    args = parser.parse_args()
    source_url = os.getenv("TEST_DATABASE_URL")
    if not source_url or not source_url.startswith("mysql+pymysql://"):
        raise SystemExit("Set explicit TEST_DATABASE_URL using MySQL + PyMySQL; no default database is used.")
    previous = None
    if args.resume:
        previous = json.loads(METADATA.read_text(encoding="utf-8"))
        schema = previous.get("schema", "")
        if not re.fullmatch(r"cinema_browser_[0-9a-f]{16}", schema):
            raise SystemExit("Refusing to resume metadata outside the owned browser-fixture schema pattern.")
        try:
            os.kill(int(previous["pid"]), 0)
        except ProcessLookupError:
            pass
        else:
            raise SystemExit("The recorded fixture process is still running; stop it with SIGUSR1 first.")
    else:
        schema = "cinema_browser_" + secrets.token_hex(8)
    admin = create_engine(source_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    app = None
    server = None
    created = False
    metadata = None
    preserve = False
    def preserve_stop(_signum, _frame):
        nonlocal preserve
        preserve = True
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGUSR1, preserve_stop)
    try:
        with admin.connect() as connection:
            if args.resume:
                exists = connection.execute(text("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=:schema"), {"schema": schema}).scalar()
                if exists is None:
                    raise SystemExit("The recorded fixture schema no longer exists.")
            else:
                connection.execute(text(f"CREATE DATABASE {schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs"))
                created = True
        private = json.loads(PRIVATE_STATE.read_text()) if args.resume and PRIVATE_STATE.exists() else {}
        secret = private.get("secret") if private.get("schema") == schema else None
        secret = secret or secrets.token_urlsafe(48)
        app = create_app({
            "TESTING": True,
            "SECRET_KEY": secret,
            "DATABASE_URL": make_url(source_url).set(database=schema).render_as_string(hide_password=False),
            "SESSION_COOKIE_NAME": "cinema_browser_fixture",
            "AI_PROVIDER": "stub",
        })
        with app.app_context():
            if args.resume:
                ids = previous["ids"]
            else:
                initialize(db())
                ids = seed(PASSWORD)
            with db().connect() as connection:
                screenings = rows(connection, "SELECT id,cinema_id,film_id,starts_at FROM screenings ORDER BY starts_at,id")
            metadata = wire({
                "status": "running",
                "schema": schema,
                "pid": os.getpid(),
                "base_url": f"http://{HOST}:{PORT}",
                "created_at": previous["created_at"] if previous else now(),
                "resumed_at": now() if previous else None,
                "password": PASSWORD,
                "ids": id_strings(ids),
                "screenings": screenings,
                "available_dates": sorted({screening["starts_at"].date() for screening in screenings}),
            })
        # Separate cookie name keeps the existing :5001 demo session isolated too.
        server = create_server(app, host=HOST, port=PORT, threads=4)
        # A resume acquires cleanup responsibility only after binding succeeds.
        created = True
        METADATA.parent.mkdir(parents=True, exist_ok=True)
        PRIVATE_STATE.write_text(json.dumps({"schema": schema, "secret": secret}) + "\n", encoding="utf-8")
        os.chmod(PRIVATE_STATE, 0o600)
        METADATA.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(METADATA, 0o600)
        print(f"Browser fixture ready: http://{HOST}:{PORT} (PID {os.getpid()}, schema {schema})", flush=True)
        print(f"Fixture metadata: {METADATA}", flush=True)
        server.run()
    except KeyboardInterrupt:
        print("Stopping isolated browser fixture.", flush=True)
    finally:
        if server is not None:
            server.close()
        if app is not None:
            app.extensions["cinema_ai"]["runner"].pool.shutdown(wait=True, cancel_futures=True)
            app.extensions["db"].dispose()
        if created and not preserve:
            with admin.connect() as connection:
                connection.execute(text(f"DROP DATABASE {schema}"))
            print(f"Removed owned browser fixture schema {schema}.", flush=True)
            if PRIVATE_STATE.exists():
                private = json.loads(PRIVATE_STATE.read_text())
                if private.get("schema") == schema:
                    PRIVATE_STATE.unlink()
        elif created:
            print(f"Preserved browser fixture schema {schema} for --resume.", flush=True)
        admin.dispose()
        if created and metadata and METADATA.exists():
            current = json.loads(METADATA.read_text(encoding="utf-8"))
            if current.get("schema") == schema:
                metadata["status"] = "preserved" if preserve else "stopped"
                METADATA.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                os.chmod(METADATA, 0o600)


if __name__ == "__main__":
    main()
