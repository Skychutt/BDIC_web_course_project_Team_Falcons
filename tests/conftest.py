from datetime import datetime

import pytest
from flask import g, session

from cinema_ai import create_app
from cinema_ai.domain import BEIJING


@pytest.fixture
def clock():
    return lambda: datetime(2026, 10, 23, 17, 0, tzinfo=BEIJING)


@pytest.fixture
def app(clock, tmp_path):
    app = create_app({"TESTING": True, "SECRET_KEY": "test-only", "AI_PROVIDER": "stub", "DATA_SOURCE": "mock",
                      "AI_LIMITS_PATH": tmp_path / "limits.sqlite3", "AI_MESSAGES_PER_MINUTE": 50}, clock=clock)
    @app.url_value_preprocessor
    def simulated_host_login(endpoint, values):
        if session.get("test_account"):
            g.actor = {"id": session["test_account"], "role": "CUSTOMER"}

    yield app
    app.extensions["cinema_ai"]["runner"].pool.shutdown(wait=True, cancel_futures=True)


@pytest.fixture
def signed_client(app):
    def make(account=1):
        client = app.test_client()
        with client.session_transaction() as session:
            session["test_account"] = account
        return client
    return make


@pytest.fixture
def client(signed_client):
    return signed_client()


@pytest.fixture
def chat(client):
    token = client.get("/api/ai/session").json["csrf_token"]

    def send(message, locale="zh"):
        result = client.post("/api/ai/chat", json={"message": message, "locale": locale}, headers={"X-CSRF-Token": token})
        assert result.status_code == 200, result.text
        return result.json
    return send
