from dataclasses import replace
import re

import pytest

from cinema_ai.localization import TRANSLATIONS, film_text, cinema_text, reply_locale
from cinema_ai.backend import film_record
from cinema_ai.references import screening_film_index


@pytest.mark.parametrize("message,stale_locale,expected_locale,expected", [
    ("我想睡觉", "en", "zh", "休息"), ("I'm tired", "zh", "en", "Get some rest"),
    ("学生票有什么要求", "en", "zh", "学生"), ("student ticket rules", "zh", "en", "student"),
    ("我的订单", "en", "zh", "登录"), ("my orders", "zh", "en", "Sign in"),
])
def test_question_language_overrides_stale_client_locale(chat, message, stale_locale, expected_locale, expected):
    result = chat(message, stale_locale)
    assert result["locale"] == expected_locale and expected.lower() in result["reply"].lower()


@pytest.mark.parametrize("message,previous,expected", [
    ("Resident Evil 有哪些场次？", "en", "zh"),
    ("Show screenings for 肖申克的救赎", "zh", "en"),
    ("请推荐一部 IMAX 电影", "en", "zh"),
    ("Recommend a highly rated film", "zh", "en"),
    ("2", "en", "en"), ("2", "zh", "zh"), ("👍", "en", "en"),
])
def test_mixed_names_and_language_neutral_followups(message, previous, expected):
    assert reply_locale(message, previous) == expected


def test_number_only_followup_uses_server_session_language(chat):
    chat("Recommend a film", "zh")
    assert chat("2", "zh")["locale"] == "en"
    chat("我想睡觉", "en")
    assert chat("2", "en")["locale"] == "zh"


def test_switch_language_keeps_selection_and_queries_same_film(app, chat):
    first = chat("推荐电影", "zh")
    result = chat("Show screenings for film number 2", "en")
    fid = first["films"][1]["id"]
    assert result["filters"]["film_id"] == fid and result["locale"] == "en"
    assert first["films"][1]["titles"]["en"] in result["reply"]
    assert "How many people" in result["reply"]
    last = chat("两个人", "en")
    assert last["cards"] and last["filters"]["film_id"] == fid and last["filters"]["party_size"] == 2
    assert last["locale"] == "zh"
    assert all(c["film"]["title"] == first["films"][1]["titles"]["zh"] for c in last["cards"])
    assert re.search(r"[\u4e00-\u9fff]", last["reply"])


def test_pending_recovery_is_localized_without_relaxing_hard_requirement(app, chat):
    repo = app.extensions["cinema_ai"]["catalog"].repository
    repo._films = [replace(f, rating=None, rating_count=0) for f in repo.films()]
    first = chat("推荐至少8分的电影", "zh")
    result = chat("Recommend a film", "zh")
    assert result["status"] == "needs_clarification" and "rating requirement" in result["reply"]
    assert result["filters"]["min_rating"] == 8 and result["recovery"]["token"] == first["recovery"]["token"]


def test_api_validation_errors_follow_question_language_or_fallback(client):
    token = client.get("/api/ai/session").json["csrf_token"]
    bad = client.post("/api/ai/chat", json={"message":"", "locale":"en"}, headers={"X-CSRF-Token":token})
    assert bad.status_code == 400 and bad.json["reply"].startswith("Invalid input")
    bad = client.post("/api/ai/chat", json={"message":"我的订单", "locale":"en"})
    assert bad.status_code == 403 and re.search(r"[\u4e00-\u9fff]", bad.json["reply"])
    bad = client.post("/api/ai/chat?locale=en", json={"message":"Hello"})
    assert bad.status_code == 403 and "session" in bad.json["reply"]
    bad = client.post("/api/ai/recovery", json={"locale":"en","token":"x","option_id":12}, headers={"X-CSRF-Token":token})
    assert bad.status_code == 400 and bad.json["reply"].startswith("Invalid input")
    bad = client.post("/api/ai/chat?locale=en", json={"message":"a"*17000,"locale":"en"}, headers={"X-CSRF-Token":token})
    assert bad.status_code == 400 and bad.json["reply"].startswith("Invalid input")


def test_reviewed_translations_preserve_source_and_fallback_on_edits():
    for title, entry in TRANSLATIONS["films"].items():
        titles, synopses = film_text(title, entry["source_synopsis"])
        assert re.search(r"[\u4e00-\u9fff]", titles["zh"])
        assert re.search(r"[\u4e00-\u9fff]", synopses["zh"])
        assert not re.search(r"[\u4e00-\u9fff]", titles["en"] + synopses["en"])
        assert synopses["en"] == entry["source_synopsis"]
        film = film_record({"id":123,"title":title,"synopsis":entry["source_synopsis"],"duration_minutes":94,
            "rating":{"average":7.3,"count":42},"genres":[]})
        assert film.id == 123 and film.rating == 7.3 and film.rating_count == 42
        assert title in film.aliases
        assert film_text(title, "Updated plot")[1] == {"zh":"Updated plot", "en":"Updated plot"}
    for name, entry in TRANSLATIONS["cinemas"].items():
        names, addresses = cinema_text(name, entry["source_address"])
        assert names["zh"] == name and not re.search(r"[\u4e00-\u9fff]", names["en"] + addresses["en"])
        assert cinema_text(name, "New address")[1] == {"zh":"New address", "en":"New address"}
    assert film_text("Unknown film", "Original plot") == ({"zh":"Unknown film","en":"Unknown film"}, {"zh":"Original plot","en":"Original plot"})


def test_english_card_action_matches_server_reference_parser():
    assert screening_film_index("Show screenings for film number 3") == 3
