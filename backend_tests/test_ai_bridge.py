"""Real MySQL bridge tests. Each fixture owns and drops a fresh random schema."""
from datetime import timedelta
import secrets

from cinema import booking
from cinema.core import db, execute, one, get


def start(env):
    client = env["app"].test_client()
    response = client.get("/api/ai/session")
    assert response.status_code == 200
    return client, response.json["data"]


def send(client, token, message, path="/api/assistant/chat", locale="zh"):
    response = client.post(path, json=dict(message=message, locale=locale), headers={"X-CSRF-Token": token})
    assert response.status_code == 200, response.json
    return response.json["data"]


def test_shared_search_ids_multiturn_and_readonly(env):
    client, session = start(env)
    assert session["data_source"] == "backend"
    assert isinstance(session["films"][0]["id"], str)
    first = send(client, session["csrf_token"], '今晚朝阳区三个人看《Journey Beyond the City》，尽量坐中间')
    assert first["cards"]
    args = {k: v for k, v in first["filters"].items() if v is not None}
    ordinary = client.get("/api/catalog/screenings", query_string=args).json["data"]
    assert first["cards"] == ordinary["cards"]
    native = client.get("/api/screenings", query_string=dict(
        cinema_id=str(env["ids"]["cinemas"][0]), date=first["filters"]["date"],
        start_from="18:00", party_size=3, zone="MIDDLE")).json["data"]["items"]
    assert [c["screening_id"] for c in first["cards"]] == [s["id"] for s in native[:3]]
    for card, show in zip(first["cards"], native):
        assert [s["id"] for s in card["suggested_seats"]] == show["suggestion"]["seat_ids"]
        assert isinstance(card["film"]["id"], str) and isinstance(card["screening_id"], str)
        assert not card["reserved"]
    second = send(client, session["csrf_token"], "改成两个人，其他不变", path="/api/ai/chat")
    assert second["filters"] == {**first["filters"], "party_size": 2}
    assert all(len(c["suggested_seats"]) == 2 for c in second["cards"])
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) AS n FROM seat_holds")["n"] == 0
        assert one(c, "SELECT COUNT(*) AS n FROM bookings")["n"] == 0


def test_csrf_auth_rotation_isolation_and_validation(env):
    client, session = start(env)
    token = session["csrf_token"]
    assert client.get("/api/auth/csrf").json["data"]["csrf_token"] == token
    assert client.post("/api/assistant/chat", json={"message": "hello"}).status_code == 403
    send(client, token, "明天三个人")
    other, second = start(env)
    assert second["filters"]["party_size"] is None
    login = client.post("/api/auth/login", json={"email": "customer@cinema.test", "password": "CinemaTest2026!"}, headers={"X-CSRF-Token": token})
    assert login.status_code == 200
    fresh = login.json["data"]["csrf_token"]
    assert fresh != token
    assert client.post("/api/ai/chat", json={"message": "hello"}, headers={"X-CSRF-Token": token}).status_code == 403
    assert client.get("/api/ai/session").json["data"]["filters"]["party_size"] is None
    assert send(client, fresh, "明天两个人")["cards"]
    headers = {"X-CSRF-Token": fresh}
    for body in ({"message": "hello", "messages": []}, {"message": "a" * 2001}):
        r = client.post("/api/assistant/chat", json=body, headers=headers)
        assert r.status_code == 400 and "error" in r.json
    assert client.get("/api/catalog/screenings?party_size=13").status_code == 400
    assert client.get("/api/catalog/screenings?party_size=12").status_code == 200
    assert "script-src 'self'" in client.get("/").headers["Content-Security-Policy"]
    assert client.delete("/api/ai/session", headers=headers).json["data"]["cleared"]


def test_hard_conditions_and_english_facts(env):
    client, session = start(env)
    token = session["csrf_token"]
    cn = send(client, token, "明天朝阳区三个人，尽量坐中间")
    other, second = start(env)
    en = send(other, second["csrf_token"], "Chaoyang tomorrow for three people, middle seats", locale="en")
    assert [{k: v for k, v in card.items() if k != "hall_label"} for card in cn["cards"]] == [
        {k: v for k, v in card.items() if k != "hall_label"} for card in en["cards"]]
    assert not send(client, token, "Dolby Cinema")["cards"]
    assert not send(client, token, "上海，三个人")["cards"]
    assert not send(client, token, "不限厅型")["cards"]
    assert not send(client, token, "延庆区")["cards"]  # District absent from DB stays a hard constraint.
    assert not send(client, token, "《不存在的影片》")["cards"]
    film = send(other, second["csrf_token"], '《Journey Beyond the City》评分多少？')
    assert film["films"][0]["rating"] is None and "暂无评分" in film["reply"]


def test_preview_hold_expiry_sale_cancellation_fares_layout(env):
    client, session = start(env)
    card = send(client, session["csrf_token"], "今天朝阳区两个人")["cards"][0]
    sid = int(card["screening_id"])
    seats = [int(s["id"]) for s in card["suggested_seats"]]
    actor = env["users"]["customer@cinema.test"]
    hold = booking.create_hold(actor, {"screening_id": sid, "seat_ids": seats}, secrets.token_hex(16))
    preview = lambda: client.get(f"/api/catalog/screenings/{sid}").json["data"]
    held = preview()
    assert all(s["state"] == "held" for s in held["seats"] if int(s["id"]) in seats)
    assert held["reserved"] is False
    env["clock"][0] += timedelta(minutes=6)
    assert all(s["state"] == "available" for s in preview()["seats"] if int(s["id"]) in seats)
    hold = booking.create_hold(actor, {"screening_id": sid, "seat_ids": seats}, secrets.token_hex(16))
    quote = booking.quote(actor, int(hold["hold_id"]), {"tickets": [{"seat_id": s, "fare_type": "STANDARD"} for s in seats]})
    booking.checkout(actor, {"quote_token": quote["quote_token"]}, secrets.token_hex(16))
    assert all(s["state"] == "sold" for s in preview()["seats"] if int(s["id"]) in seats)
    with db().begin() as c:
        show = get(c, "screenings", sid)
        execute(c, "UPDATE screenings SET status='CANCELLED', revision_no=revision_no+1 WHERE id=:id", id=sid)
        execute(c, "UPDATE fares SET price_minor=7777 WHERE screening_id=:id AND fare_type='STANDARD'", id=sid)
        execute(c, "UPDATE layouts SET screen_direction='LEFT' WHERE id=:id", id=show["layout_id"])
    latest = preview()
    assert latest["status"] == "cancelled" and not latest["saleable"]
    assert latest["fares"]["regular"] == 7777 and latest["layout"]["screen_direction"] == "LEFT"
    assert all("map_x" in s and "segment_position" in s for s in latest["seats"])
    assert client.get("/api/catalog/screenings/9223372036854775807").status_code == 404


def test_exclusive_end_and_midnight_preserve_v1_contract(env):
    client, _ = start(env)
    # Seed at 10:00 gives Chaoyang screenings at 13:00 and 18:00 today.
    native = client.get("/api/screenings?date=2026-10-23&start_from=18:00&start_to=18:00").json["data"]
    assert len(native["items"]) == 3
    ai = client.get("/api/catalog/screenings?date=2026-10-23&time_start=13:00&time_end=18:00").json["data"]
    assert len(ai["cards"]) == 3 and all("T13:00:" in c["starts_at"] for c in ai["cards"])
    night = client.get("/api/catalog/screenings?date=2026-10-23&time_start=18:00&time_end=24:00").json["data"]
    assert len(night["cards"]) == 3 and all("T18:00:" in c["starts_at"] for c in night["cards"])


def test_private_messages_no_model_and_no_sql_writes(env, monkeypatch):
    client, session = start(env)
    def fail(**_):
        raise AssertionError("Private request reached model")
    monkeypatch.setattr(env["app"].extensions["cinema_ai"]["provider"], "interpret", fail)
    for text in ("查他人订单", "影院营业额", "SELECT * FROM users", "DROP TABLE films"):
        assert send(client, session["csrf_token"], text)["intent"] == "unsupported"
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) AS n FROM films")["n"] == 1
        assert one(c, "SELECT COUNT(*) AS n FROM seat_holds")["n"] == 0


def test_model_fallback_releases_connections_and_keeps_cards(env, monkeypatch):
    from cinema_ai.domain import Intent
    from cinema_ai.providers import ProviderError
    client, session = start(env)
    provider = env["app"].extensions["cinema_ai"]["provider"]
    engine = env["app"].extensions["db"]
    def interpret(**_):
        assert engine.pool.checkedout() == 0
        return Intent.model_validate({"intent": "recommend", "updates": {"party_size": 3}})
    def explain(**_):
        assert engine.pool.checkedout() == 0
        raise ProviderError("timeout")
    monkeypatch.setattr(provider, "interpret", interpret)
    monkeypatch.setattr(provider, "explain", explain)
    result = send(client, session["csrf_token"], "三个人看电影")
    assert result["cards"] and result["explanation_fallback"]
    monkeypatch.setattr(provider, "interpret", explain)
    result = send(client, session["csrf_token"], "改成两个人")
    assert result["status"] == "unavailable" and result["filters"]["party_size"] == 3
