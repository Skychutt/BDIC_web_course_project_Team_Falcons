import json
import time
from dataclasses import replace
from types import SimpleNamespace
import pytest
from cinema_ai.providers import AgentTurn, ToolCall, ProviderError, DeepSeekProvider


def tool(name, **args):
    return AgentTurn(calls=[ToolCall(id="call-1", name=name, arguments=args)])


def scripted(app, *turns):
    queue = iter(turns)
    requests = []
    def run(**kwargs):
        requests.append(kwargs)
        value = next(queue)
        if isinstance(value, Exception):
            raise value
        return value
    app.extensions["cinema_ai"]["provider"].turn = run
    return requests


def test_smalltalk_needs_no_business_tools(app, chat):
    def fail(*args, **kwargs):
        pytest.fail("Small talk queried the catalog")
    app.extensions["cinema_ai"]["catalog"].recommend = fail
    answer = chat("我想睡觉")
    assert answer["tool_calls"] == [] and not answer["cards"]
    assert "休息" in answer["reply"] and answer["filters"]["party_size"] is None


def test_film_discovery_needs_no_party_or_district(chat):
    answer = chat("推荐一部电影")
    assert answer["status"] == "ok" and len(answer["films"]) == 1
    assert answer["tool_calls"] == ["search_films"]
    assert answer["filters"]["party_size"] is None and not answer["cards"]
    assert answer["films"][0]["rating_source"] == "platform"


def test_recent_high_rated_is_metadata_based_and_qualified(chat):
    result = chat("最近评分比较高的科幻电影")
    assert [f["id"] for f in result["films"]] == [1]
    assert result["films"][0]["rating_count"] == 128
    assert "14" in result["reply"] and "没有上映日期" in result["reply"]
    assert result["filters"]["party_size"] is None


def test_combined_budget_and_film_conditions_precede_top_three(chat, client):
    result = chat("今晚朝阳区三个人看科幻电影，每人不超过50元，评分高，尽量坐中间")
    assert result["cards"]
    assert all(c["fares"]["regular"] <= 5000 and c["film"]["rating"] >= 4 and c["film"]["id"] == 1 for c in result["cards"])
    same = client.get("/api/catalog/screenings", query_string={k: v for k, v in result["filters"].items() if v is not None}).json
    assert same["cards"] == result["cards"]
    smaller = chat("预算改为整单不超过50元")
    assert not smaller["cards"] and smaller["filters"]["party_size"] == 3


def test_unspecified_budget_scope_asks_and_keeps_other_fields(chat):
    first = chat("今晚两个人，预算50元")
    assert first["status"] == "needs_clarification" and not first["cards"]
    assert first["filters"]["budget_minor"] == 5000
    result = chat("每人")
    assert result["cards"] and result["filters"]["budget_scope"] == "per_ticket"


def test_second_film_resolves_server_candidates(chat):
    films = chat("推荐电影")
    assert len(films["films"]) == 3
    result = chat("第二个，明天两个人")
    assert result["cards"] and result["filters"]["film_id"] == films["films"][1]["id"]
    assert all(c["film"]["id"] == films["films"][1]["id"] for c in result["cards"])


def test_selection_rechecks_cancelled_screening(app, chat):
    result = chat("今晚三个人")
    selected = result["cards"][1]
    show = app.extensions["cinema_ai"]["catalog"].repository.get_screening(selected["screening_id"])
    app.extensions["cinema_ai"]["catalog"].repository._screenings[show.id] = replace(show, status="cancelled")
    reread = chat("第二场，还是三个人")
    assert not reread["cards"]
    assert reread["filters"]["screening_id"] == selected["screening_id"]


def test_native_agent_can_chain_tools_before_answer(app, chat):
    first = tool("search_films", updates={"genre": "Science Fiction"})
    second = tool("search_screenings", film_index=1, updates={"party_size": 2, "date": "tomorrow"})
    second.calls[0].id = "call-2"
    requests = scripted(app, first, second, AgentTurn(content="已找到匹配的场次，具体票价和座位见卡片。"))
    result = chat("明天两个人看科幻电影")
    assert result["tool_calls"] == ["search_films", "search_screenings"]
    assert result["films"] and result["cards"] and len(requests) == 3
    assert requests[1]["messages"][-1]["role"] == "tool"


@pytest.mark.parametrize("name,args", [("execute_sql", {"sql": "SELECT 1"}),
    ("search_screenings", {"updates": {"party_size": 2, "owner_id": 123}}),
    ("get_my_orders", {"user_id": 123}), ("search_screenings", {"screening_index": 3})])
def test_reject_unknown_tools_identity_and_fabricated_reference(app, chat, name, args):
    first = chat("今晚三个人")
    if name == "search_screenings" and args.get("screening_index"):
        args["screening_index"] = 99
    scripted(app, tool(name, **args))
    response = chat("帮我查一下")
    assert response["status"] == "unavailable" and response["filters"] == first["filters"]


def test_loop_is_bounded_even_if_model_keeps_requesting(app, chat):
    turns = []
    for n in range(4):
        step = tool("get_rules", topic="student")
        step.calls[0].id = f"call-{n}"
        turns.append(step)
    scripted(app, *turns)
    answer = chat("学生票规则")
    assert len(answer["tool_calls"]) <= 4 and answer["explanation_fallback"]
    assert answer["rules"] and answer["model_error_code"] in {"tool_limit", "repeated_tool"}


def test_generic_recommendation_ignores_invented_hard_constraints(app, chat):
    scripted(app, tool("search_films", updates={"min_rating": 5, "genre": "Horror"}, limit=3), AgentTurn(content="这部影片供你参考。"))
    answer = chat("推荐一部电影")
    assert len(answer["films"]) == 1 and answer["filters"]["min_rating"] is None and answer["filters"]["genre"] is None


def test_model_cannot_relax_hard_conditions_inside_tool_loop(app, chat):
    first = tool("search_films", updates={"min_rating": 5.0, "genre": "Horror"})
    second = tool("search_films", updates={"min_rating": None, "genre": None})
    second.calls[0].id = "second"
    requests = scripted(app, first, second)
    answer = chat("找5分恐怖电影")
    # Empty queries now stop the model loop before it can invent a relaxation.
    assert answer["status"] == "needs_clarification" and not answer["films"]
    assert len(requests) == 1
    assert answer["filters"]["min_rating"] == 5 and answer["filters"]["genre"] == "Horror"


def test_failed_final_explanation_keeps_verified_films(app, chat):
    scripted(app, tool("search_films"), ProviderError("timeout"))
    answer = chat("推荐电影")
    assert answer["films"] and answer["explanation_fallback"] and answer["error_code"] is None


def test_model_cannot_claim_a_successful_transaction(app, chat):
    scripted(app, tool("search_films"), AgentTurn(content="已为你付款，成功下单。"))
    answer = chat("推荐电影")
    assert answer["explanation_fallback"] and "成功下单" not in answer["reply"]


def test_own_orders_request_requires_login(chat):
    result = chat("我的订单")
    assert result["status"] == "login_required" and result["tool_calls"] == ["get_my_orders"]


def test_manual_region_updates_state_without_model(client, app):
    token = client.get("/api/ai/session").json["csrf_token"]
    response = client.patch("/api/ai/preferences", json={"district": "haidian"}, headers={"X-CSRF-Token": token})
    assert response.status_code == 200 and response.json["filters"]["district"] == "haidian"
    assert client.patch("/api/ai/preferences", json={"district": "chaoyang"}).status_code == 403
    assert not next(iter(app.extensions["cinema_ai"]["sessions"].items.values())).history


def test_location_without_provider_does_not_invent_distance(chat):
    result = chat("离我最近的电影院")
    assert result["status"] == "needs_clarification" and "未配置地图" in result["reply"]
    assert not result["cinemas"]


def test_location_with_map_offers_fixed_entry_without_reading_coordinates(app, chat):
    app.config.update(AMAP_JS_KEY="public-key", AMAP_SECURITY_CODE="private-code")
    result = chat("离我最近的电影院")
    assert result["status"] == "needs_clarification"
    assert result["location"] == {"action": "open_cinema_map", "distance_available": False}
    assert not result["cinemas"] and not result["cards"]
    assert result["filters"]["district"] is None


def test_native_deepseek_tool_wire_and_validation():
    seen = []
    def create(**kwargs):
        seen.append(kwargs)
        return SimpleNamespace(usage=None, choices=[SimpleNamespace(finish_reason="tool_calls", message=SimpleNamespace(content=None,
            tool_calls=[SimpleNamespace(type="function", id="tool1", function=SimpleNamespace(name="search_films", arguments='{"updates":{"min_rating":4}}'))]))])
    provider = DeepSeekProvider("unused", client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))))
    result = provider.turn(messages=[{"role": "user", "content": "high rated films"}], tool_definitions=[], timeout=2)
    assert result.calls[0].name == "search_films" and result.calls[0].arguments["updates"]["min_rating"] == 4
    assert seen[0]["extra_body"] == {"thinking": {"type": "disabled"}}
    assert seen[0]["tool_choice"] == "auto" and not seen[0]["stream"]
