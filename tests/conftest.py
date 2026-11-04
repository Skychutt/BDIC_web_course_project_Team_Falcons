from datetime import datetime

import pytest

from cinema_ai import create_app
from cinema_ai.domain import BEIJING


@pytest.fixture
def clock():
    return lambda: datetime(2026, 10, 23, 17, 0, tzinfo=BEIJING)


@pytest.fixture
def app(clock):
    app = create_app({"TESTING": True, "SECRET_KEY": "test-only", "AI_PROVIDER": "stub", "DATA_SOURCE": "mock"}, clock=clock)
    yield app
    app.extensions["cinema_ai"]["runner"].pool.shutdown(wait=True, cancel_futures=True)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def chat(client):
    token = client.get("/api/ai/session").json["csrf_token"]

    def send(message, locale="zh"):
        result = client.post("/api/ai/chat", json={"message": message, "locale": locale}, headers={"X-CSRF-Token": token})
        assert result.status_code == 200, result.text
        return result.json
    return send
