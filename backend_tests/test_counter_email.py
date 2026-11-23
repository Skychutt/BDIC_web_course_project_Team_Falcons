import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from cinema import counter
from cinema.core import db, execute, get, one, rows
from test_frontend_api import actor, client, purchase


def sale_request(env, index=0):
    return dict(screening_id=str(env["ids"]["screenings"][index]),
                email="customer@cinema.test", tickets=[dict(
                    seat_id=str(env["ids"]["seats"][str(env["ids"]["layouts"][index // 3])][0]),
                    fare_type="STUDENT")])


def post(client, path, data):
    return client.post("/api/counter/" + path, json=data, headers={"X-CSRF-Token": "frontend-test-csrf"})


def issue(env, monkeypatch, **updates):
    inbox = []
    monkeypatch.setattr(counter, "send_email", lambda to, message: inbox.append((to, message)))
    staff = client(env, "staff1")
    response = post(staff, "codes", {**sale_request(env), **updates})
    assert response.status_code == 201, response.json
    to, message = inbox.pop()
    assert to == "customer@cinema.test" and "Falcons Chaoyang" in message
    code = re.search(r'Code: ([0-9]{6})', message)[1]
    assert "code" not in response.json["data"]
    return staff, f'sales/{response.json["data"]["sale_id"]}/confirm', code, response.json["data"]


def test_branch_scope_and_concurrent_email_sale(env, monkeypatch):
    for account in ("manager1", "staff1"):
        staff = client(env, account)
        data = staff.get("/api/ui/bootstrap").json["data"]
        assert [c["id"] for c in data["cinemas"]] == [str(env["ids"]["cinemas"][0])]
        assert {s["id"] for s in staff.get("/api/counter/screenings").json["data"]} == set(map(str, env["ids"]["screenings"][:3]))
        assert staff.get(f'/api/screenings/{env["ids"]["screenings"][3]}/seats').status_code == 403
        assert post(staff, "codes", sale_request(env, 3)).status_code == 403
    assert post(client(env, "customer"), "codes", sale_request(env)).status_code == 403
    staff, path, code, quote = issue(env, monkeypatch)
    assert quote["amount_due_minor"] == 5000
    assert post(staff, "codes", sale_request(env)).status_code == 429
    assert post(client(env, "manager1"), path, {"code": code}).status_code == 403
    assert post(staff, path, {"code": f"{(int(code)+1)%1000000:06}"}).status_code == 403
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) n FROM payments")["n"] == 0
        assert one(c, "SELECT COUNT(*) n FROM seat_allocations")["n"] == 0
    def confirm(_):
        response = post(client(env, "staff1"), path, {"code": code})
        assert response.status_code == 200, response.json
        return response.json["data"]["booking_id"]
    with ThreadPoolExecutor(2) as pool:
        first, second = pool.map(confirm, range(2))
    assert first == second
    with db().connect() as c:
        booking = get(c, "bookings", first)
        assert booking["channel"] == "COUNTER" and booking["creator_id"] == actor(env, "staff1")["id"]
        assert booking["owner_id"] == actor(env)["id"]
        assert one(c, "SELECT balance_minor FROM wallets WHERE customer_id=:u", u=booking["owner_id"])["balance_minor"] == 95000
        assert len(rows(c, "SELECT id FROM payments")) == len(rows(c, "SELECT id FROM tickets")) == 1


def test_resend_attempt_limit_expiry_and_price_change(env, monkeypatch):
    staff, old, first_code, _ = issue(env, monkeypatch)
    env["clock"][0] += timedelta(seconds=61)
    inbox = []
    monkeypatch.setattr(counter, "send_email", lambda to, message: inbox.append(message))
    resent = post(staff, old.replace("/confirm", "/resend"), {})
    assert resent.status_code == 201
    path = f'sales/{resent.json["data"]["sale_id"]}/confirm'
    code = re.search(r"Code: ([0-9]{6})", inbox.pop())[1]
    assert post(staff, old, {"code": first_code}).json["error"]["code"] == "CODE_EXPIRED"
    for _ in range(5):
        assert post(staff, path, {"code": f"{(int(code)+1)%1000000:06}"}).status_code == 403
    assert post(staff, path, {"code": code}).json["error"]["code"] == "CODE_EXPIRED"
    env["clock"][0] += timedelta(minutes=1)
    _, path, code, _ = issue(env, monkeypatch)
    with db().begin() as c:
        execute(c, "UPDATE fares SET price_minor=100 WHERE screening_id=:s AND fare_type='STUDENT'", s=env["ids"]["screenings"][0])
    assert post(staff, path, {"code": code}).json["error"]["code"] == "QUOTE_CHANGED"
    env["clock"][0] += timedelta(minutes=5)
    assert post(staff, path, {"code": code}).json["error"]["code"] == "CODE_EXPIRED"
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) n FROM payments")["n"] == 0


def test_balance_and_seat_rechecked_before_charge(env, monkeypatch):
    staff, path, code, _ = issue(env, monkeypatch)
    with db().begin() as c:
        execute(c, "UPDATE wallets SET balance_minor=0 WHERE customer_id=:u", u=actor(env)["id"])
    assert post(staff, path, {"code": code}).json["error"]["code"] == "INSUFFICIENT_BALANCE"
    with db().begin() as c:
        assert one(c, "SELECT COUNT(*) n FROM bookings")["n"] == 0
        execute(c, "UPDATE wallets SET balance_minor=100000 WHERE customer_id=:u", u=actor(env)["id"])
    purchase(env)
    assert post(staff, path, {"code": code}).json["error"]["code"] == "SEAT_UNAVAILABLE"
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) n FROM payments")["n"] == 1


def test_counter_change_refund_and_failed_email(env, monkeypatch):
    receipt = purchase(env, index=1)
    request = sale_request(env, index=2)
    request["tickets"][0]["fare_type"] = "STANDARD"
    staff, path, code, quote = issue(env, monkeypatch, **request, source_booking_id=receipt["booking_id"])
    # An 8-hour lead incurs a ¥5 change fee on the ¥20 fare reduction.
    assert quote["amount_due_minor"] == -1500
    assert post(staff, path, {"code": code}).status_code == 200
    with db().connect() as c:
        assert get(c, "bookings", receipt["booking_id"])["status"] == "RESCHEDULED"
        assert one(c, "SELECT COUNT(*) n FROM payments")["n"] == 1

    def offline(to, message):
        raise counter.Problem("EMAIL_UNAVAILABLE", "Mail unavailable", 503)
    monkeypatch.setattr(counter, "send_email", offline)
    env["clock"][0] += timedelta(minutes=1)
    response = post(staff, "codes", sale_request(env))
    assert response.status_code == 503
    with db().connect() as c:
        challenge = one(c, "SELECT * FROM counter_email_sales ORDER BY created_at DESC LIMIT 1")
        assert challenge["attempts_left"] == 0 and challenge["booking_id"] is None
