import json
import time
from dataclasses import replace
from types import SimpleNamespace
import pytest
from cinema_ai.providers import AgentTurn, ToolCall, ProviderError, DeepSeekProvider
from cinema_ai.agent import direct_personal_tool


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


@pytest.mark.parametrize("question,reply", [
    ("为什么天空是蓝色的？", "因为空气分子对短波长的蓝光散射更强，这叫瑞利散射。"),
    ("API key 是什么？", "API key 是调用服务时用于识别调用方的凭据，应保存在服务端。"),
    ("怎么设计安全的登录密码？", "使用较长且独特的密码，并开启双重验证。"),
    ("告诉我怎么设置安全密码", "每个网站使用独特的长密码，并开启双重验证。"),
    ("Give me password security advice", "Use a unique, long password and enable multi-factor authentication."),
    ("影院营业额如何计算？", "一般按售出的票数乘以各自票价，再加上其他销售收入计算。"),
    ("请解释 SELECT * FROM users 的含义", "它读取 users 表的所有列；这里只解释语法，不会执行查询。"),
    ("写一个 HTML 示例", '<p>Hello</p>\n<script>console.log("Example")</script>'),
    ("Python 官方网站地址是什么？", "Python 官方网站是 https://www.python.org/ 。"),
    ("帮我写一首关于雨的短诗", "雨落在窗边，\n把城市写成一封没有寄出的信。"),
    ("帮我写一封求职邮件，收件人是 hr@example.com。", "收件人：hr@example.com\n您好，我希望申请贵公司的实习岗位。"),
    ("SELECT * FROM users 是什么意思？", "它查询 users 表中的所有列；这里只解释代码，不执行查询。"),
    ("请问如何保护他人的账号隐私？", "仅访问得到授权的信息，避免收集不必要的个人数据。"),
    ("把“我已经付款了”翻译成英文，只给译文。", "I have paid."),
    ("解释“已付款”的含义", "“已付款”表示支付已经完成，不等于商品已经交付。"),
    ("退货退款通常是什么意思？", "退货退款通常指退回商品后，之前已支付的款项按相应规则返还。"),
    ("13800000000 加 2 等于多少？", "13800000002。"),
    ("39.91234,116.45678 这种经纬度格式怎么读？", "前者表示纬度，后者表示经度，单位是度。"),
])
def test_general_questions_use_model_reply_without_business_tools(app, chat, question, reply):
    requests = scripted(app, AgentTurn(content=reply))
    result = chat(question)
    assert result["status"] == "ok" and result["reply"] == reply
    assert result["tool_calls"] == [] and not result["cards"]
    assert result["filters"]["party_size"] is None
    assert len(requests) == 1 and requests[0]["messages"][-1]["content"] == question


def test_general_followup_retains_conversation_and_movie_preferences(app, chat):
    first = chat("今晚朝阳区三个人看电影 A")
    requests = scripted(app, AgentTurn(content="第一版：雨落窗前。"), AgentTurn(content="改写：雨轻叩窗，像老朋友的问候。"))
    chat("帮我写一句关于雨的文字")
    result = chat("把刚才那句话写得更温柔一点")
    assert result["filters"] == first["filters"] and not result["tool_calls"]
    assert {"role": "assistant", "content": "第一版：雨落窗前。"} in requests[1]["messages"]


def test_translation_after_cinema_results_is_not_a_transaction_claim(app, chat):
    first = chat("今晚朝阳区三个人看电影 A")
    scripted(app, AgentTurn(content="I have paid."))
    result = chat("换个话题，把“我已付款”翻译成英文")
    assert result["status"] == "ok" and result["reply"] == "I have paid."
    assert result["filters"] == first["filters"] and not result["tool_calls"]


@pytest.mark.parametrize("message", ["帮我支付这笔订单", "Please pay for my booking"])
def test_direct_transaction_request_still_rejects_fabricated_success(app, chat, message):
    scripted(app, AgentTurn(content="已为你付款，成功下单。"))
    result = chat(message)
    assert result["status"] == "unavailable" and result["error_code"] == "invalid_output"
    assert "成功下单" not in result["reply"]


def test_partial_general_answer_is_shown_and_can_be_continued(app, chat):
    requests = scripted(app, AgentTurn(content="第一部分：先定义一个变量。", truncated=True), AgentTurn(content="第二部分：再定义函数。"))
    first = chat("详细讲一下 Python 入门")
    assert first["status"] == "ok" and first["reply_truncated"]
    assert first["reply"].startswith("第一部分：先定义一个变量。") and "继续" in first["reply"]
    second = chat("继续")
    assert second["status"] == "ok" and second["reply"] == "第二部分：再定义函数。"
    assert {"role": "assistant", "content": first["reply"]} in requests[1]["messages"]


@pytest.mark.parametrize("message,name", [
    ("我的订单", "get_my_orders"), ("请帮我查一下我的订单。", "get_my_orders"),
    ("Please show me my recent orders", "get_my_orders"),
    ("我的优惠券", "get_my_coupons"), ("Check my coupons please", "get_my_coupons"),
])
def test_simple_personal_query_works_without_model(app, chat, message, name):
    def unavailable(**kwargs):
        pytest.fail("Personal list requests should not call the model")
    app.extensions["cinema_ai"]["provider"].turn = unavailable
    response = chat(message)
    assert response["status"] == "login_required" and response["tool_calls"] == [name]


@pytest.mark.parametrize("message", [
    "我的订单是什么意思？", "我的最近订单能改签吗", "我的订单和优惠券", "不要查我的订单",
    "Explain how my orders work", "Write a story called My orders", "我的订单，然后解释光合作用",
])
def test_personal_shortcut_does_not_capture_mixed_or_explanatory_questions(message):
    assert direct_personal_tool(message) is None


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
