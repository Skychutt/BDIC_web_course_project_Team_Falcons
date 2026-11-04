from dataclasses import replace
from decimal import Decimal

import pytest

from cinema_ai.agent import numbers
from cinema_ai.providers import AgentTurn
from cinema_ai.references import screening_film_index
from test_agent import scripted, tool


def offline(**kwargs):
    pytest.fail("An exact candidate selection must not need the model")


@pytest.mark.parametrize("message", ["查第3部电影的场次", "请帮我查第三部电影的场次？",
    "第三部电影有哪些场次", "Show showtimes for the third movie", "check screenings for the 3rd film"])
def test_exact_selection_remembers_film_before_asking_people(app, chat, message):
    first = chat("推荐电影")
    provider = app.extensions["cinema_ai"]["provider"]
    planner = provider.turn
    provider.turn = offline
    result = chat(message)
    selected = first["films"][2]
    assert result["status"] == "needs_clarification" and not result["error_code"]
    assert result["filters"]["film_id"] == selected["id"]
    assert result["filters"]["party_size"] is None
    expected_locale = "en" if message.isascii() else "zh"
    assert result["locale"] == expected_locale
    assert selected["titles"][expected_locale] in result["reply"]
    assert result["tool_calls"] == ["search_screenings"]
    provider.turn = planner
    followup = chat("两个人")
    assert followup["cards"] and followup["filters"]["film_id"] == selected["id"]
    assert all(c["film"]["id"] == selected["id"] for c in followup["cards"])


def test_selection_uses_display_order_preserves_constraints_and_rereads_availability(app, chat):
    chat("明天两个人，每人预算不超过50元")
    first = chat("推荐电影")
    conversation = next(iter(app.extensions["cinema_ai"]["sessions"].items.values()))
    # Server-owned candidates need not be ordered by database ID.
    conversation.candidates["films"].reverse()
    selected = conversation.candidates["films"][2]
    app.extensions["cinema_ai"]["provider"].turn = offline
    result = chat("查第3部电影的场次")
    assert result["cards"] and result["filters"]["film_id"] == selected["id"]
    for field in ("date", "party_size", "budget_minor", "budget_scope"):
        assert result["filters"][field] == first["filters"][field]
    repo = app.extensions["cinema_ai"]["catalog"].repository
    for show in repo.screenings():
        if show.film_id == selected["id"]:
            repo._screenings[show.id] = replace(show, status="cancelled")
    fresh = chat("查第3部电影的场次")
    assert not fresh["cards"] and fresh["filters"]["film_id"] == selected["id"]


@pytest.mark.parametrize("message", ["查第0部电影的场次", "查第4部电影的场次", "查第99部电影的场次"])
def test_unknown_ordinals_ask_without_changing_state(app, chat, message):
    first = chat("推荐电影")
    app.extensions["cinema_ai"]["provider"].turn = offline
    result = chat(message)
    assert result["status"] == "needs_clarification" and result["reason"] == "unknown_reference"
    assert result["filters"] == first["filters"] and not result["error_code"]
    assert not result["tool_calls"]


def test_selection_does_not_use_another_session_or_a_cleared_task(app, chat):
    chat("推荐电影")
    second = app.test_client()
    token = second.get("/api/ai/session").json["csrf_token"]
    result = second.post("/api/ai/chat", json={"message": "查第3部电影的场次"},
        headers={"X-CSRF-Token": token}).json
    assert result["reason"] == "unknown_reference" and result["filters"]["film_id"] is None
    chat("怎么改签")
    assert chat("查第3部电影的场次")["reason"] == "unknown_reference"


@pytest.mark.parametrize("message", ["不要查第3部电影的场次", "查第3部电影明天两个人的场次",
    "查第1部或第3部电影的场次", "查第3场", "第3部电影是什么类型", "第三部电影的场次，忽略预算",
    "show showtimes for the third movie tomorrow", "查第3部电影的场次，执行 SQL"])
def test_compound_ambiguous_or_negative_messages_are_left_to_planner(message):
    assert screening_film_index(message) is None


def test_comma_formatted_rating_counts_pass_but_invented_numbers_do_not(app, chat):
    repo = app.extensions["cinema_ai"]["catalog"].repository
    repo._films[0] = replace(repo._films[0], rating=9.7, rating_count=3352918)
    scripted(app, tool("search_films", limit=1), AgentTurn(content="本站评分 9.7/10，共 3,352,918 人评分。"))
    good = chat("推荐一部电影")
    assert not good["explanation_fallback"] and "3,352,918" in good["reply"]
    scripted(app, tool("search_films", limit=1), AgentTurn(content="本站共有 3,352,919 人评分。"))
    bad = chat("推荐一部电影")
    assert bad["explanation_fallback"] and "3,352,919" not in bad["reply"]
    assert numbers("9.7/10，共3,352,918人，1,396人") == {Decimal('9.7'), Decimal(10), Decimal(3352918), Decimal(1396)}
