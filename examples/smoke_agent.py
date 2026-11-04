"""Explicit opt-in live-model checks. Uses synthetic messages and public reads only."""
import argparse
import http.cookiejar
import json
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--allow-live", action="store_true", required=True)
parser.add_argument("--base-url", default="http://127.0.0.1:5001")
args = parser.parse_args()


def session():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    data = json.load(opener.open(args.base_url + "/api/ai/session"))["data"]
    assert data["provider"] == "deepseek", "Live checks require the DeepSeek provider"
    return opener, data["csrf_token"]


def ask(pair, label, message):
    opener, token = pair
    request = urllib.request.Request(args.base_url + "/api/assistant/chat", data=json.dumps({"message": message, "locale": "zh"}).encode(),
        headers={"Content-Type": "application/json", "X-CSRF-Token": token})
    at = time.monotonic()
    value = json.load(opener.open(request, timeout=20))["data"]
    print(json.dumps({"case": label, "status": value["status"], "tools": value["tool_calls"], "films": len(value["films"]),
        "cards": len(value["cards"]), "seconds": round(time.monotonic()-at, 2), "fallback": value.get("explanation_fallback", False),
        "error": value.get("error_code") or value.get("model_error_code")}, ensure_ascii=False), flush=True)
    return value


value = ask(session(), "small_talk", "我想睡觉，今天有点累。")
assert value["status"] == "ok" and not value["tool_calls"]
value = ask(session(), "film_recommendation", "推荐一部电影")
assert value["status"] == "ok" and value["films"] and value["filters"]["party_size"] is None
pair = session()
value = ask(pair, "recent_ratings", "最近评分比较高的电影有哪些？")
assert value["status"] in {"ok", "needs_clarification"} and "search_films" in value["tool_calls"] and "14" in value["reply"]
assert value["filters"]["min_rating"] is None and not value["filters"]["rated_only"]
assert all(f["rating"] is not None and f["rating_count"] > 0 for f in value["films"])
if value.get("reason") == "no_rated_movies":
    value = ask(pair, "soft_rating_recovery", "推荐一部电影")
    assert value["status"] == "ok" and len(value["films"]) == 1
pair = session()
value = ask(pair, "hard_rating", "推荐本站评分至少8分的电影")
assert value["filters"]["min_rating"] == 8
if value.get("recovery"):
    first = value
    value = ask(pair, "hard_rating_retained", "推荐一部电影")
    assert value["status"] == "needs_clarification" and value["filters"]["min_rating"] == 8 and not value["films"]
    opener, token = pair
    request = urllib.request.Request(args.base_url + "/api/ai/recovery", data=json.dumps({
        "token": value["recovery"]["token"], "option_id": "include_unrated_movies", "locale": "zh"}).encode(),
        headers={"Content-Type": "application/json", "X-CSRF-Token": token})
    value = json.load(opener.open(request, timeout=20))["data"]
    assert value["films"] and value["filters"]["min_rating"] is None
    print('PASS: explicit recovery button re-queried public data without a model call.', flush=True)
pair = session()
first = ask(pair, "screenings", "明天朝阳区三个人看电影，尽量坐中间。")
assert first["status"] in {"ok", "needs_clarification"} and first["filters"]["party_size"] == 3
second = ask(pair, "follow_up", "改成两个人，其他不变。")
assert second["status"] in {"ok", "needs_clarification"} and second["filters"]["party_size"] == 2
assert all(second["filters"][k] == first["filters"][k] for k in ("date", "district", "zone"))
value = ask(pair, "hard_budget", "每人预算不超过50元，其他不变。")
assert value["status"] in {"ok", "needs_clarification"} and value["filters"]["budget_minor"] == 5000 and value["filters"]["budget_scope"] == "per_ticket"
assert all(c["fares"]["regular"] <= 5000 for c in value["cards"])
value = ask(session(), "anonymous_orders", "查询我的订单")
assert value["status"] == "login_required"
print("PASS: live small talk, film discovery, soft/hard ratings and recovery, screening follow-up, hard budget and login boundary.")
