from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier

import pytest

from cinema_ai.domain import BEIJING
from cinema_ai.limits import MessageLimits


@pytest.mark.parametrize("method,path", [
    ("get", "/api/ai/session"), ("delete", "/api/ai/session"), ("patch", "/api/ai/preferences"),
    ("post", "/api/ai/recovery"), ("post", "/api/assistant/chat"), ("post", "/api/ai/chat"),
])
def test_guest_is_stopped_before_session_or_provider(app, method, path):
    guest = app.test_client()
    app.extensions["cinema_ai"]["provider"].turn = lambda **_: pytest.fail("guest reached planner")
    response = getattr(guest, method)(path, json={"message": "Recommend a film", "user_id": 1})
    assert response.status_code == 401 and response.json["error_code"] == "assistant_login"
    assert not app.extensions["cinema_ai"]["sessions"].items
    assert guest.get("/api/catalog/screenings").status_code == 200


def test_aliases_share_account_quota_across_sessions(app, signed_client):
    service = app.extensions["cinema_ai"]
    service["limits"].per_minute = 1
    first, same_account, different_account = signed_client(), signed_client(), signed_client(2)

    def post(client, route):
        csrf = client.get("/api/ai/session").json["csrf_token"]
        return client.post(route, headers={"X-CSRF-Token": csrf}, json={"message": "Recommend a film"})

    assert post(first, "/api/ai/chat").json["films"]
    token = first.get("/api/ai/session").json["csrf_token"]
    assert first.delete("/api/ai/session", headers={"X-CSRF-Token": token}).status_code == 200
    assert post(different_account, "/api/assistant/chat").json["films"]
    service["provider"].turn = lambda **_: pytest.fail("throttled request reached planner")
    response = post(same_account, "/api/assistant/chat")
    assert response.status_code == 429 and "seconds" in response.json["reply"]
    assert 0 < int(response.headers["Retry-After"]) <= 60


def test_pause_is_live_and_catalog_remains_public(app, client, tmp_path):
    service = app.extensions["cinema_ai"]
    service["pause_file"] = tmp_path / "assistant.paused"
    token = client.get("/api/ai/session").json["csrf_token"]
    service["provider"].turn = lambda **_: pytest.fail("paused request reached planner")
    service["pause_file"].touch()
    response = client.post("/api/assistant/chat", json={"message": "推荐电影"}, headers={"X-CSRF-Token": token})
    assert response.status_code == 503 and response.json["error_code"] == "assistant_paused"
    assert app.test_client().get("/api/catalog/screenings").status_code == 200
    service["pause_file"].unlink()
    assert client.get("/api/ai/session").status_code == 200


def test_limits_persist_and_roll_over_at_beijing_midnight(tmp_path):
    path = tmp_path / "limits.sqlite3"
    before = datetime(2026, 11, 23, 23, 58, tzinfo=BEIJING)
    assert MessageLimits(path, 6, 1, 60).admit(1, "ip", before) == 0
    reopened = MessageLimits(path, 6, 1, 60)
    assert reopened.admit(1, "ip", before + timedelta(seconds=61)) == 59
    assert reopened.admit(1, "ip", before + timedelta(minutes=2)) == 0


def test_concurrent_sessions_share_rolling_minute(tmp_path):
    path = tmp_path / "limits.sqlite3"
    workers = [MessageLimits(path, 6, 50, 60) for _ in range(10)]
    now = datetime(2026, 11, 23, 23, 59, 50, tzinfo=BEIJING)
    barrier = Barrier(len(workers))
    def send(worker):
        barrier.wait()
        return worker.admit(1, "ip", now)
    with ThreadPoolExecutor(len(workers)) as pool:
        assert sorted(pool.map(send, workers)) == [0] * 6 + [60] * 4
    assert workers[0].admit(1, "ip", now + timedelta(seconds=10)) == 50
    assert workers[0].admit(1, "ip", now + timedelta(minutes=1)) == 0
