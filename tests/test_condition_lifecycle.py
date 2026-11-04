from dataclasses import replace
import pytest
from cinema_ai.providers import AgentTurn, ProviderError
from test_agent import scripted, tool


def unrated(app):
    repo = app.extensions["cinema_ai"]["catalog"].repository
    repo._films = [replace(f, rating=None, rating_count=0) for f in repo.films()]


def choose(client, result, option="include_unrated_movies", locale="zh"):
    token = client.get("/api/ai/session").json["csrf_token"]
    return client.post("/api/ai/recovery", headers={"X-CSRF-Token": token}, json={
        "token": result["recovery"]["token"], "option_id": option, "locale": locale})


def test_soft_score_empty_then_generic_recovers_without_model_threshold(app, chat):
    unrated(app)
    first = chat("推荐一个评分高的电影")
    assert first["filters"]["min_rating"] is None and not first["filters"]["rated_only"]
    assert first["reason"] == "no_rated_movies" and first["recovery"]
    assert first["conditions"]["sort_by_rating"]["strength"] == "soft"
    second = chat("推荐一部电影")
    assert second["status"] == "ok" and len(second["films"]) == 1
    assert second["films"][0]["rating"] is None and "放下评分偏好" in second["reply"]
    assert second["conditions"]["sort_by_rating"]["status"] == "relaxed"
    assert second["task"]["action"] == "relax"


def test_explicit_numeric_requirement_survives_generic_and_random_request(app, chat, client):
    unrated(app)
    first = chat("推荐评分至少4分的电影")
    assert first["filters"]["min_rating"] == 4
    assert first["conditions"]["min_rating"]["strength"] == "hard"
    for text in ("推荐一部电影", "那随便推荐一部电影吧"):
        next_result = chat(text)
        assert next_result["filters"]["min_rating"] == 4 and not next_result["films"]
        assert next_result["recovery"]["token"] == first["recovery"]["token"]
    result = choose(client, first).json
    assert result["films"] and result["filters"]["min_rating"] is None
    assert all(f["rating"] is None and f["rating_count"] == 0 for f in result["films"])


def test_recovery_click_uses_fresh_data_and_does_not_call_model(app, chat, client):
    unrated(app)
    first = chat("推荐高分电影")
    repo = app.extensions["cinema_ai"]["catalog"].repository
    repo._films = [replace(repo.films()[-1], titles={"zh": "更新后的片名", "en": "Updated title"})]
    def fail(**kwargs):
        pytest.fail("Recovery button must not call a model")
    app.extensions["cinema_ai"]["provider"].turn = fail
    result = choose(client, first).json
    assert [f["title"] for f in result["films"]] == ["更新后的片名"]
    assert result["tool_calls"] == ["recover_search"]


def test_recovery_options_are_session_bound_single_use_and_csrf_protected(app, chat, client):
    unrated(app)
    first = chat("推荐高分电影")
    assert client.post("/api/ai/recovery", json={"token": first["recovery"]["token"], "option_id": "include_unrated_movies"}).status_code == 403
    stranger = app.test_client()
    assert choose(stranger, first).json["error_code"] == "stale_recovery"
    assert choose(client, first, "invented").status_code == 400
    assert choose(client, first).json["films"]
    assert choose(client, first).json["error_code"] == "stale_recovery"


def test_old_recovery_cannot_override_new_filters(app, chat, client):
    unrated(app)
    first = chat("推荐高分电影")
    token = client.get("/api/ai/session").json["csrf_token"]
    client.patch("/api/ai/preferences", json={"district": "haidian"}, headers={"X-CSRF-Token": token})
    result = choose(client, first).json
    assert result["error_code"] == "stale_recovery" and result["filters"]["district"] == "haidian"


def test_explicit_text_recovery_and_genre_choice(app, chat, client):
    unrated(app)
    first = chat("推荐评分至少4分的电影")
    genre = choose(client, first, "choose_genre").json
    assert genre["status"] == "needs_clarification" and genre["filters"]["min_rating"] is None
    assert not genre["films"]
    result = chat("科幻电影")
    assert result["films"] and all("Science Fiction" in f["genres"] for f in result["films"])
    chat("推荐评分至少4分的电影")
    result = chat("不限评分了")
    assert result["films"] and result["filters"]["min_rating"] is None


def test_keep_requirement_does_not_mutate_filters(app, chat, client):
    unrated(app)
    first = chat("推荐评分至少4分的电影")
    result = choose(client, first, "keep_requirements").json
    assert result["filters"] == first["filters"] and not result["films"]


def test_modify_preserves_hard_task_and_default_sources(chat):
    first = chat("今晚朝阳区三个人看电影 A，尽量坐中间")
    second = chat("改成两个人，其他不变")
    for k in ("district", "date", "film_query", "time_start", "time_end", "zone"):
        assert second["filters"][k] == first["filters"][k]
    assert second["filters"]["party_size"] == 2
    assert second["conditions"]["party_size"]["source"] == "user_explicit"
    assert second["conditions"]["zone"]["strength"] == "soft"
    assert second["conditions"]["fare_type"]["source"] == "system_default"
    assert all(c["scope"] == "current_task" for c in second["conditions"].values())


def test_smalltalk_keeps_task_but_rules_and_explicit_new_task_clear_it(chat):
    first = chat("今晚朝阳区三个人看科幻电影")
    assert chat("我想睡觉")["filters"] == first["filters"]
    rules = chat("对了，怎么改签？")
    assert rules["task"]["kind"] == "rules"
    assert rules["filters"]["genre"] is None and rules["filters"]["party_size"] is None
    assert rules["conditions"]["genre"]["status"] == "cleared"
    chat("今晚朝阳区三个人看科幻电影")
    new = chat("换个话题，推荐喜剧电影")
    assert new["filters"]["genre"] == "Comedy" and new["filters"]["party_size"] is None
    assert new["filters"]["district"] is None


def test_model_invented_threshold_is_removed_even_if_old_prompt_is_used(app, chat):
    scripted(app, tool("search_films", updates={"min_rating": 4.0, "rated_only": True, "sort_by_rating": True}), AgentTurn(content="按本站评分排序，见卡片。"))
    result = chat("推荐评分高的电影")
    assert result["filters"]["min_rating"] is None and not result["filters"]["rated_only"]
    assert result["films"]


def test_evidence_validation_and_rollback_include_metadata(app, chat):
    first = chat("今晚朝阳区三个人")
    scripted(app, tool("search_films", task_action="new", task_text="这句是伪造的", updates={"genre": "Horror"}), AgentTurn(content="影片见卡片。"))
    result = chat("推荐电影")
    # A generic request ignores model-invented changes and cannot reset the task.
    assert result["filters"] == first["filters"]
    scripted(app, tool("search_screenings", updates={"party_size": 5}, evidence=[{"field": "party_size", "original_text": "伪造原文"}]))
    result = chat("改成两个人")
    assert result["status"] == "unavailable" and result["conditions"] == first["conditions"]


def test_model_cannot_choose_hard_recovery_for_generic_followup(app, chat):
    unrated(app)
    first = chat("评分至少4分的电影")
    scripted(app, tool("recover_search", token=first["recovery"]["token"], option_id="include_unrated_movies"))
    result = chat("推荐一部电影")
    assert result["status"] == "needs_clarification" and result["filters"]["min_rating"] == 4


def test_soft_region_can_fall_back_but_hard_region_budget_and_hall_cannot(app, chat):
    soft = chat("今晚两个人，最好在昌平区")
    assert soft["cards"] and "保留硬限制" in soft["reply"]
    assert soft["conditions"]["district"]["strength"] == "soft"
    hard = chat("必须在昌平区，今晚两个人，每人不超过50元，只要IMAX")
    assert not hard["cards"]
    assert hard["filters"]["district"] == "changping" and hard["filters"]["budget_minor"] == 5000
    assert hard["filters"]["hall_type"] == "imax"
    assert hard["conditions"]["district"]["strength"] == "hard"


def test_english_rating_flow_has_same_business_result(app, chat, client):
    unrated(app)
    first = chat("Recommend highly rated movies", "en")
    assert first["reason"] == "no_rated_movies"
    result = choose(client, first, locale="en").json
    assert result["locale"] == "en" and result["films"] and "current data" in result["reply"]


def test_no_result_does_not_drop_hard_fields_and_can_offer_one_field_recovery(chat, client):
    first = chat("今晚两个人，每人不超过1元")
    assert not first["cards"] and first["filters"]["budget_minor"] == 100
    assert "remove_budget_minor" in [o["id"] for o in first["recovery"]["options"]]
    result = choose(client, first, "remove_budget_minor").json
    assert result["cards"] and result["filters"]["party_size"] == 2
    assert result["filters"]["date"] == first["filters"]["date"]


def test_explanation_failure_preserves_metadata_and_verified_results(app, chat):
    scripted(app, tool("search_films", updates={"sort_by_rating": True}), ProviderError("timeout"))
    answer = chat("高分电影")
    assert answer["films"] and answer["explanation_fallback"]
    assert answer["conditions"]["sort_by_rating"]["strength"] == "soft"


def test_city_change_invalidates_district_without_later_implicit_switch_back(chat):
    chat("明天朝阳区三个人，尽量坐中间")
    chat("Dolby Cinema")
    outside = chat("上海，三个人")
    assert outside["filters"]["city"] != "beijing" and not outside["cards"]
    result = chat("不限厅型")
    assert result["filters"]["city"] == outside["filters"]["city"] and not result["cards"]
