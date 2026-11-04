"""Read-tool integration against an isolated MySQL schema, never the demo database."""
import secrets
import json
import copy
from datetime import timedelta
import pytest
from cinema import assistant_reads, booking, management, catalog
from cinema.core import db, get, ins, now, one, Problem
from cinema_ai.providers import AgentTurn, ToolCall


def actor(e, name="customer"):
    return e["users"][name + "@cinema.test"]


def key():
    return "agent-test-" + secrets.token_hex(12)


def purchase(e, index=0, name="customer"):
    user = actor(e, name)
    sid = e["ids"]["screenings"][index]
    seat = e["ids"]["seats"][str(e["ids"]["layouts"][index // 3])][0]
    hold = booking.create_hold(user, {"screening_id": sid, "seat_ids": [seat]}, key())
    quote = booking.quote(user, hold["hold_id"], {"tickets": [{"seat_id": seat, "fare_type": "STANDARD"}]})
    return booking.checkout(user, {"quote_token": quote["quote_token"]}, key())


def snapshot():
    with db().connect() as c:
        return {table: one(c, f"SELECT COUNT(*) AS n FROM {table}")["n"] for table in
                ("bookings", "seat_holds", "seat_allocations", "coupons", "payments", "wallet_entries", "settlement_entries")}


def test_customer_orders_scope_and_model_data_minimization(env):
    purchase(env, 0)
    second = purchase(env, 3, "customer2")
    before = snapshot()
    mine = assistant_reads.orders(actor(env))
    other = assistant_reads.orders(actor(env, "customer2"))
    assert len(mine) == len(other) == 1 and mine[0]["id"] != other[0]["id"]
    assert "owner_id" not in mine[0] and "email" not in mine[0] and "net_ticket_minor" not in mine[0]
    assert snapshot() == before
    client = env["app"].test_client()
    with client.session_transaction() as session:
        session["user_id"], session["csrf"] = str(actor(env)["id"]), "test-csrf"
    response = client.post("/api/assistant/chat", json={"message": "我的订单", "locale": "zh"}, headers={"X-CSRF-Token": "test-csrf"}).json["data"]
    assert len(response["orders"]) == 1 and response["orders"][0]["id"] == str(mine[0]["id"])
    assert str(second["booking_id"]) not in str(response)
    assert "tool_calls" in response and snapshot() == before


def test_read_only_price_matches_real_quote(env):
    user = actor(env)
    sid = env["ids"]["screenings"][0]
    before = snapshot()
    preview = assistant_reads.preview(user, sid, 1, 1)
    assert preview["preview_only"] and preview["reserved"] is False
    assert snapshot() == before
    with db().connect() as c:
        s = get(c, "screenings", sid)
        chosen = catalog.choose_seats(catalog.available_seats(c, s), 2, get(c, "layouts", s["layout_id"])["row_count"])["seat_ids"]
    hold = booking.create_hold(user, {"screening_id": sid, "seat_ids": chosen}, key())
    actual = booking.quote(user, hold["hold_id"], {"tickets": [dict(seat_id=seat, fare_type=fare) for seat, fare in zip(chosen, ("STANDARD", "STUDENT"))]})
    for name in ("gross_ticket_minor", "net_ticket_minor", "current_fee_minor", "amount_due_minor"):
        assert preview[name] == actual[name]
    assert "quote_token" not in preview and "hold_id" not in preview


def test_coupon_scope_discount_and_no_consumption(env):
    receipt = purchase(env)
    sid = env["ids"]["screenings"][0]
    staff = actor(env, "manager1")
    change = management.cancel_preview(staff, sid, {"reason": "test"})
    management.cancel_confirm(staff, sid, {"preview_token": change["preview_token"]}, key())
    cp = assistant_reads.coupons(actor(env), env["ids"]["screenings"][1])[0]
    assert cp["applicable"]
    assert not assistant_reads.coupons(actor(env), env["ids"]["screenings"][3])[0]["applicable"]
    before = snapshot()
    quote = assistant_reads.preview(actor(env), env["ids"]["screenings"][1], 1, 0, cp["id"])
    assert quote["net_ticket_minor"] == booking.rounded(quote["gross_ticket_minor"], 5000)
    assert snapshot() == before and assistant_reads.coupons(actor(env))[0]["status"] == "AVAILABLE"
    with pytest.raises(Problem) as caught:
        assistant_reads.preview(actor(env, "customer2"), env["ids"]["screenings"][1], 1, 0, cp["id"])
    assert caught.value.code == "COUPON_INVALID"


def test_reschedule_scope_and_fee_preview_read_only(env):
    receipt = purchase(env, 1)
    bid = int(receipt["booking_id"])
    before = snapshot()
    eligibility = assistant_reads.reschedule(actor(env), bid)
    assert eligibility["eligible"] and eligibility["same_cinema"] and eligibility["same_film"]
    preview = assistant_reads.preview(actor(env), env["ids"]["screenings"][2], None, None, source_id=bid)
    assert preview["regular_count"] == 1 and preview["student_count"] == 0
    assert preview["current_fee_minor"] == eligibility["fee_minor"] and snapshot() == before
    with pytest.raises(Problem):
        assistant_reads.reschedule(actor(env, "customer2"), bid)
    with pytest.raises(Problem) as caught:
        assistant_reads.preview(actor(env), env["ids"]["screenings"][3], None, None, source_id=bid)
    assert caught.value.code == "RESCHEDULE_TARGET"


def test_movie_ratings_types_and_budget_share_ordinary_search(env):
    with db().begin() as c:
        fid = env["ids"]["film"] if "film" in env["ids"] else one(c, "SELECT id FROM films LIMIT 1")["id"]
        ins(c, "ratings", customer_id=actor(env)["id"], film_id=fid, stars=5, created_at=now(), updated_at=now())
    client = env["app"].test_client()
    token = client.get("/api/ai/session").json["data"]["csrf_token"]
    response = client.post("/api/assistant/chat", json={"message": "最近评分高的冒险电影", "locale": "zh"}, headers={"X-CSRF-Token": token}).json["data"]
    assert response["status"] == "ok" and len(response["films"]) == 1 and response["films"][0]["rating_count"] == 1
    assert "14" in response["reply"]
    request = dict(date="2026-10-23", party_size=2, budget_minor=1, budget_scope="per_ticket", min_rating=4, genre="Adventure")
    assert client.get("/api/screenings", query_string=request).json["data"]["total"] == 0
    request["budget_minor"] = 100000
    native = client.get("/api/screenings", query_string=request).json["data"]
    assert native["items"] and all(s["rating"]["average"] == "5.0" for s in native["items"])


def test_personal_reference_rechecks_owner_even_if_server_cache_is_stale(env):
    other = purchase(env, 3, "customer2")
    client = env["app"].test_client()
    with client.session_transaction() as session:
        session["user_id"], session["csrf"] = str(actor(env)["id"]), "test-csrf"
    client.get("/api/ai/session")
    conversation = next(iter(env["app"].extensions["cinema_ai"]["sessions"].items.values()))
    conversation.candidates["orders"] = [{"id": other["booking_id"]}]
    env["app"].extensions["cinema_ai"]["provider"].turn = lambda **_: AgentTurn(calls=[ToolCall(id="t1", name="check_reschedule", arguments={"order_index": 1})])
    result = client.post("/api/assistant/chat", json={"message": "查第一个订单能否改签"}, headers={"X-CSRF-Token": "test-csrf"}).json["data"]
    assert result["status"] == "unavailable" and result["error_code"] == "FORBIDDEN"
    assert "reschedule" not in result and not result["orders"]


def test_private_tool_chaining_sends_only_indices_to_model(env):
    receipt = purchase(env, 1)
    client = env["app"].test_client()
    with client.session_transaction() as session:
        session["user_id"], session["csrf"] = str(actor(env)["id"]), "test-csrf"
    requests = []
    turns = iter([
        AgentTurn(calls=[ToolCall(id="a", name="get_my_orders", arguments={})]),
        AgentTurn(calls=[ToolCall(id="b", name="check_reschedule", arguments={"order_index": 1})]),
        AgentTurn(content="已完成查询，请查看下方详情。"),
    ])
    def run(**kwargs):
        requests.append(copy.deepcopy(kwargs["messages"]))
        return next(turns)
    env["app"].extensions["cinema_ai"]["provider"].turn = run
    before = snapshot()
    result = client.post("/api/assistant/chat", json={"message": "我的最近订单能改签吗", "locale": "zh"}, headers={"X-CSRF-Token": "test-csrf"}).json["data"]
    assert result["reschedule"]["eligible"] and result["orders"] and snapshot() == before
    outbound = json.dumps(requests, ensure_ascii=False)
    assert str(receipt["booking_id"]) not in outbound and str(actor(env)["id"]) not in outbound
    assert "owner_id" not in outbound and "net_ticket_minor" not in outbound
    assert len(requests) == 3
