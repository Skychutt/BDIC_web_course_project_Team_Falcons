import os
import secrets
from datetime import datetime
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from cinema import create_app
from cinema.cli import initialize
from cinema.seed import seed
from cinema.core import get, db


@pytest.fixture
def env():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip(
            "Set TEST_DATABASE_URL to an explicit disposable-schema-capable MySQL account"
        )
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    schema = "cinema_test_" + secrets.token_hex(8)
    with admin.connect() as c:
        c.execute(
            text(
                f"CREATE DATABASE {schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs"
            )
        )
    clock = [datetime(2026, 10, 23, 10, 0, 0)]
    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret-" * 5,
            "DATABASE_URL": make_url(url)
            .set(database=schema)
            .render_as_string(hide_password=False),
            "CLOCK": lambda: clock[0],
        }
    )
    try:
        with app.app_context():
            initialize(db())
            ids = seed("CinemaTest2026!")
            with db().connect() as c:
                users = {
                    email: get(c, "users", uid)
                    for email, uid in ids["accounts"].items()
                }
            yield dict(app=app, ids=ids, users=users, clock=clock)
    finally:
        app.extensions["cinema_ai"]["runner"].pool.shutdown(wait=True, cancel_futures=True)
        app.extensions["db"].dispose()
        with admin.connect() as c:
            c.execute(text(f"DROP DATABASE {schema}"))
        admin.dispose()
