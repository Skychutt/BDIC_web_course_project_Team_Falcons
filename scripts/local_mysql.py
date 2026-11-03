#!/usr/bin/env python3
"""Isolated macOS/Homebrew demo MySQL; never touches an existing server or database."""

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
BASE = ROOT / "instance" / "mysql"
SOCKET = BASE / "mysql.sock"
ENV = ROOT / ".env"


def run(*args):
    return subprocess.run(
        [str(x) for x in args], check=True, capture_output=True, text=True
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["init", "start", "stop", "status"])
    args = parser.parse_args()
    mysql = shutil.which("mysql")
    mysqld = shutil.which("mysqld")
    admin = shutil.which("mysqladmin")
    if not all([mysql, mysqld, admin]):
        parser.error("MySQL command-line tools must already be installed (target 8.4).")
    if args.action == "stop":
        run(
            admin,
            "--no-defaults",
            "--protocol=socket",
            f"--socket={SOCKET}",
            "-uroot",
            "shutdown",
        )
        print("Isolated demo MySQL stopped.")
        return
    if args.action == "status":
        result = run(
            admin,
            "--no-defaults",
            "--protocol=socket",
            f"--socket={SOCKET}",
            "-uroot",
            "ping",
        )
        print(result.stdout.strip())
        return
    if args.action == "init":
        if BASE.exists() or ENV.exists():
            parser.error(
                "Refusing to overwrite instance/mysql or .env. Use start for an existing demo."
            )
        BASE.mkdir(parents=True, mode=0o700)
        os.chmod(BASE, 0o700)
        run(
            mysqld,
            "--no-defaults",
            "--initialize-insecure",
            f"--datadir={BASE / 'data'}",
        )
    elif not (BASE / "data").exists():
        parser.error("Initialize the demo first.")
    run(
        mysqld,
        "--no-defaults",
        f"--datadir={BASE / 'data'}",
        f"--socket={SOCKET}",
        f"--pid-file={BASE / 'mysql.pid'}",
        f"--log-error={BASE / 'server.log'}",
        "--skip-networking",
        "--mysqlx=0",
        "--daemonize",
    )
    if args.action == "start":
        print("Isolated demo MySQL started.")
        return
    run(
        mysql,
        "--no-defaults",
        "--protocol=socket",
        f"--socket={SOCKET}",
        "-uroot",
        "-e",
        "CREATE DATABASE cinema_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs",
    )
    secret = secrets.token_urlsafe(48)
    password = secrets.token_urlsafe(24)
    demo_password = "Demo-" + secrets.token_urlsafe(12)
    root_url = (
        "mysql+pymysql://root@localhost/cinema_demo?charset=utf8mb4&unix_socket="
        + quote(str(SOCKET), safe="")
    )
    from cinema import create_app
    from cinema.cli import initialize
    from cinema.seed import seed

    app = create_app({"SECRET_KEY": secret, "DATABASE_URL": root_url, "ENABLE_AI": False})
    with app.app_context():
        initialize(app.extensions["db"])
        ids = seed(demo_password)
    app.extensions["db"].dispose()
    # App runtime receives DML only. root remains socket-only inside a private directory.
    sql = f"CREATE USER 'cinema_app'@'localhost' IDENTIFIED BY '{password}'; GRANT SELECT,INSERT,UPDATE,DELETE ON cinema_demo.* TO 'cinema_app'@'localhost';"
    subprocess.run(
        [mysql, "--no-defaults", "--protocol=socket", f"--socket={SOCKET}", "-uroot"],
        input=sql,
        text=True,
        check=True,
        capture_output=True,
    )
    url = (
        "mysql+pymysql://cinema_app:"
        + password
        + "@localhost/cinema_demo?charset=utf8mb4&unix_socket="
        + quote(str(SOCKET), safe="")
    )
    ENV.write_text(f"DATABASE_URL={url}\nSECRET_KEY={secret}\nCOOKIE_SECURE=false\nDATA_SOURCE=backend\nAI_PROVIDER=stub\nDEEPSEEK_API_KEY=\nDEEPSEEK_MODEL=deepseek-flash\nAI_TIMEOUT_SECONDS=10\n")
    os.chmod(ENV, 0o600)

    def export_ids(value):
        if isinstance(value, dict):
            return {key: export_ids(item) for key, item in value.items()}
        if isinstance(value, list):
            return [export_ids(item) for item in value]
        return str(value) if isinstance(value, int) else value

    (ROOT / "instance" / "demo-ids.json").write_text(
        json.dumps(export_ids(ids), indent=2)
    )
    accounts = ROOT / "instance" / "DEMO-ACCOUNTS.txt"
    accounts.write_text(
        "Local demo only. All seeded accounts share this password:\n"
        + demo_password
        + "\n\n"
        + "\n".join(ids["accounts"])
        + "\n"
    )
    os.chmod(accounts, 0o600)
    print(
        "Demo initialized. Credentials: instance/DEMO-ACCOUNTS.txt. App: .venv/bin/python main.py (http://127.0.0.1:5001)"
    )
    print(
        run(
            mysql,
            "--no-defaults",
            "--protocol=socket",
            f"--socket={SOCKET}",
            "-uroot",
            "-N",
            "-e",
            "SELECT VERSION()",
        ).stdout.strip()
    )


if __name__ == "__main__":
    main()
