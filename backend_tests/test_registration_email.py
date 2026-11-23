import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest

from cinema import registration
from cinema.core import Problem, db, one


@pytest.fixture
def inbox(monkeypatch):
    messages = []
    def receive(email, subject, message):
        assert "注册" in subject
        messages.append((email, re.search(r"Code: ([0-9]{6})", message)[1]))
    monkeypatch.setattr(registration, "deliver", receive)
    return messages


EMAIL = "new@cinema.test"
PROFILE = {"email": EMAIL, "display_name": "New customer", "password": "CinemaTest2026!"}


def session(app):
    client = app.test_client()
    token = client.get("/api/auth/csrf").json["data"]["csrf_token"]
    return client, {"X-CSRF-Token": token, "Idempotency-Key": uuid4().hex}


def issue(client, headers, email=EMAIL, source="127.0.0.1"):
    return client.post("/api/auth/register/code", json={"email": email}, headers=headers,
                       environ_overrides={"REMOTE_ADDR": source})


def complete(client, headers, **values):
    return client.post("/api/auth/register", json={**PROFILE, **values}, headers=headers)


def test_new_registration_verifies_email_then_logs_in_and_credits_once(env, inbox):
    app = env["app"]
    client, headers = session(app)
    assert complete(client, headers).json["error"]["code"] == "REGISTRATION_CODE_REQUIRED"
    assert client.post("/api/auth/register/code", json={"email": EMAIL}).status_code == 403
    issued = issue(client, headers, EMAIL.upper()).json["data"]
    address, code = inbox.pop()
    assert address == EMAIL and set(issued) == {"challenge_id", "resend_after_seconds"}
    with db().connect() as c:
        assert not one(c, "SELECT id FROM users WHERE email_normalized=:email", email=EMAIL)
    proof = {"challenge_id": issued["challenge_id"], "code": code}
    assert complete(client, headers, email="different@cinema.test", **proof).status_code == 409
    assert complete(client, headers, role="STAFF", **proof).status_code == 400

    def submit(_):
        other, csrf = session(app)
        response = complete(other, {**csrf, "Idempotency-Key": headers["Idempotency-Key"]}, **proof)
        assert response.status_code == 201
        assert other.get("/api/auth/me").json["data"]["role"] == "CUSTOMER"
        data = response.json["data"]
        assert data["csrf_token"] != csrf["X-CSRF-Token"]
        return data["user"]["id"]

    with ThreadPoolExecutor(2) as pool:
        first, replayed = pool.map(submit, range(2))
    assert first == replayed
    assert complete(client, {**headers, "Idempotency-Key": uuid4().hex}, **proof).status_code == 409
    with db().connect() as c:
        assert one(c, "SELECT balance_minor FROM wallets WHERE customer_id=:u", u=first)["balance_minor"] == 100000
        assert one(c, "SELECT COUNT(*) AS n FROM wallet_entries WHERE owner_id=:u", u=first)["n"] == 1
    env["clock"][0] += timedelta(minutes=5)
    assert complete(client, headers, **proof).status_code == 409
    assert client.post("/api/auth/login", json=PROFILE, headers=headers).status_code == 200


def test_resend_expiry_attempt_budget_and_existing_customer(env, inbox):
    client, headers = session(env["app"])
    def request():
        return issue(client, headers).json["data"]["challenge_id"], inbox.pop()[1]
    first, old_code = request()
    assert issue(client, headers, EMAIL.upper()).json["error"]["details"]["retry_after_seconds"] == 60
    env["clock"][0] += timedelta(seconds=60)
    second, code = request()
    assert complete(client, headers, challenge_id=first, code=old_code).status_code == 409
    wrong = "000000" if code != "000000" else "000001"
    for _ in range(5):
        assert complete(client, headers, challenge_id=second, code=wrong).json["error"]["code"] == "CODE_INVALID"
    assert complete(client, headers, challenge_id=second, code=code).json["error"]["code"] == "CODE_EXPIRED"
    env["clock"][0] += timedelta(minutes=1)
    third, code = request()
    env["clock"][0] += timedelta(minutes=5)
    assert complete(client, headers, challenge_id=third, code=code).status_code == 409
    assert client.get("/api/auth/me").status_code == 401
    assert issue(client, headers, "customer@cinema.test").status_code == 201 and not inbox
    assert client.post("/api/auth/login", json={**PROFILE, "email": "customer@cinema.test"}, headers=headers).status_code == 200


def test_rolling_email_and_source_limits(env, inbox):
    client, headers = session(env["app"])
    for i in range(registration.EMAIL_LIMIT):
        assert issue(client, headers, source=f"192.0.2.{i}").status_code == 201
        env["clock"][0] += timedelta(minutes=1)
    assert issue(client, headers).status_code == 429
    assert len(inbox) == registration.EMAIL_LIMIT
    for i in range(registration.SOURCE_LIMIT):
        assert issue(client, headers, email=f"new{i}@cinema.test").status_code == 201
    assert issue(client, headers, email="another@cinema.test").status_code == 429
    env["clock"][0] += timedelta(hours=1)
    assert issue(client, headers).status_code == 201


def test_concurrent_send_and_failed_delivery(env, inbox, monkeypatch):
    app = env["app"]
    def send(_):
        return issue(*session(app)).status_code
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(send, range(2))) == [201, 429]
    assert len(inbox) == 1
    client, headers = session(app)
    def fail(*args):
        raise Problem("EMAIL_UNAVAILABLE", "Email temporarily unavailable", 503)
    monkeypatch.setattr(registration, "deliver", fail)
    assert issue(client, headers, "offline@cinema.test").status_code == 503
    with db().connect() as c:
        assert one(c, "SELECT attempts_left FROM registration_codes WHERE email_key=:e",
                   e=registration.keyed("email", "offline@cinema.test"))["attempts_left"] == 0
