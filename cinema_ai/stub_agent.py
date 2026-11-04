"""Deterministic offline tool planner for tests/demo; not a substitute for DeepSeek."""
import json
import re
from .providers import AgentTurn, ToolCall, ProviderError
from .domain import Intent
from .messages import tr


def turn(provider, messages, state, history, today, timeout, locale, context, **_):
    if messages[-1]["role"] == "tool":
        value = json.loads(messages[-1]["content"])
        if value.get("cards"):
            facts = {}
            if any(not c["contiguous"] for c in value["cards"]):
                facts["split"] = "split"
            if any("preferred_zone" in c["unmet_preferences"] for c in value["cards"]):
                facts["zone"] = "zone"
            explained = provider.explain(facts=facts, locale=locale, timeout=timeout)
            if any(key not in facts for key in explained.fact_ids):
                raise ProviderError("invalid_output")
        return AgentTurn(content=value["reply"])
    text = messages[-1]["content"]
    lowered = text.lower()
    def call(tool_name, **args):
        return AgentTurn(calls=[ToolCall(id="offline_call", name=tool_name, arguments=args)])
    if re.search(r"想睡觉|好累|累了|晚安|不想看了|tired|sleep|good night|don't want to watch", lowered):
        return AgentTurn(content="那就先休息一下吧，想看电影时再来找我。" if locale == "zh" else "Get some rest. I'm here when you feel like a film.")
    if re.search(r"我的订单|本人订单|my (?:orders?|bookings?)", lowered):
        return call("get_my_orders")
    if re.search(r"我的.*券|我有.*券|my coupons", lowered):
        return call("get_my_coupons")
    index_match = re.search(r"第\s*([一二三123])|\b(first|second|third)\b", lowered)
    index = ({"一": 1, "二": 2, "三": 3, "1": 1, "2": 2, "3": 3}.get(index_match[1]) or
             {"first": 1, "second": 2, "third": 3}.get(index_match[2])) if index_match else None
    if "改签" in lowered and index and context.get("candidates", {}).get("orders"):
        return call("check_reschedule", order_index=index)
    if re.search(r"最近的影院|最近的电影院|离我最近|nearest|near me", lowered):
        return call("resolve_location", nearest=True)
    recovery = context.get("pending_recovery")
    if recovery:
        choice = None
        if re.search(r"保留.*要求|暂.*不推荐|keep.*requirement", lowered):
            choice = "keep_requirements"
        elif re.search(r"按类型|choose.*genre", lowered):
            choice = "choose_genre"
        elif re.search(r"不限评分|不看评分|看看全部|包括.*(?:未评分|无评分)|include unrated|any rating|all films", lowered):
            choice = "include_unrated_movies"
        if choice and choice in {o["id"] for o in recovery["options"]}:
            return call("recover_search", token=recovery["token"], option_id=choice)
    intent = Intent.model_validate(provider.interpret(message=text, state=state, history=history, today=today, timeout=timeout))
    if intent.intent in {"help", "unsupported"}:
        # Generic movie discovery and small talk get their own treatment below.
        if not re.search(r"推荐|电影|films?|movies?|高分|rating|预算|每人|整单|per person|total|budget|每张", lowered):
            return AgentTurn(content=tr(intent.intent, locale))
    patch = intent.updates.model_dump(exclude_unset=True)
    for word, genre in [("科幻", "Science Fiction"), ("sci-fi", "Science Fiction"), ("science fiction", "Science Fiction"),
                         ("喜剧", "Comedy"), ("comedy", "Comedy"), ("冒险", "Adventure"), ("adventure", "Adventure"),
                         ("悬疑", "Mystery"), ("mystery", "Mystery")]:
        if word in lowered:
            patch["genre"] = genre
    from cinema.discovery import GENRES
    for genre, names in GENRES.items():
        if any(word in lowered for word in names):
            patch["genre"] = genre.title()
    if re.search(r"轻松|lighthearted|light-hearted|something light", lowered):
        patch["keyword"] = "lighthearted"
    if re.search(r"高分|评分.*高|high(?:ly)?[ -]?rated|highest|top.rated", lowered):
        patch.update(sort_by_rating=True)
    rating = re.search(r"(?:评分|rating|rated|score)[^，。!?！？]{0,12}?(10|\d(?:\.\d+)?)|(?<!\d)(10|\d(?:\.\d+)?)\s*(?:分|星|stars?|/10)", lowered)
    if rating:
        patch.update(min_rating=float(rating[1] or rating[2]), sort_by_rating=True)
    if re.search(r"最近|近期|recent|now showing", lowered):
        patch["recent"] = True
    if re.search(r"不限类型|any genre", lowered):
        patch["genre"] = None
    if re.search(r"不限评分|不看评分|any rating", lowered):
        patch.update(min_rating=None, rated_only=False, sort_by_rating=False)
    if re.search(r"不限预算|预算不限|no budget", lowered):
        patch.update(budget_minor=None, budget_scope=None)
    budget = re.search(r"(?:不超过|最多|预算|以内|under|budget|up to)\s*(?:[¥￥]|rmb)?\s*(\d+(?:\.\d{1,2})?)", lowered)
    if budget:
        from decimal import Decimal
        patch["budget_minor"] = int(Decimal(budget[1]) * 100)
    if re.search(r"每人|每张|per person|per ticket|each", lowered):
        patch["budget_scope"] = "per_ticket"
    elif re.search(r"整单|总共|一共.*元|total|whole group", lowered):
        patch["budget_scope"] = "total"
    if "学生票" in lowered and intent.intent != "rules":
        patch["fare_type"] = "student"
    if re.search(r"必须.*连座|一定.*连座|must.*together", lowered):
        patch["require_contiguous"] = True
    if re.search(r"可以分开|不用连座|split is fine", lowered):
        patch["require_contiguous"] = False
    action = "new" if re.search(r"换个话题|新任务|重新开始|new task|change.*topic|start over", lowered) else "relax" if re.search(r"不限|不看评分|取消.*限制|any rating|any genre|no budget", lowered) else "modify" if re.search(r"改成|换成|改为|其他不变|change|instead", lowered) else "continue"
    evidence = []
    soft_words = {"district": r"区|district|chaoyang|haidian|dongcheng|xicheng|changping",
                  "hall_type": r"厅|imax|dolby|standard", "genre": r"科幻|喜剧|悬疑|冒险|genre|comedy|science fiction|sci-fi|mystery",
                  "keyword": r"轻松|lighthearted|funny|keyword"}
    for key in patch:
        terms = soft_words.get(key)
        soft = key in {"zone", "sort_by_rating"} or terms and bool(re.search(r"(?:最好|尽量|prefer)[^，。,.!?！？]{0,18}(?:" + terms + r")", lowered))
        evidence.append({"field": key, "source": "user_explicit", "strength": "soft" if soft else "hard", "original_text": text})
    common = {"updates": patch, "task_action": action, "evidence": evidence}
    if action == "new":
        common["task_text"] = text
    if intent.clarification:
        common["clarification"] = intent.clarification
    if intent.intent == "rules":
        return call("get_rules", topic=intent.rule_topic or "all")
    if intent.intent == "cinema":
        return call("search_cinemas", name=intent.cinema_query, **common)
    discovery_rating = bool(rating) or bool(re.search(r"高分|评分.*高|high(?:ly)?[ -]?rated|highest|top.rated", lowered))
    if intent.intent == "film" and not discovery_rating and (patch.get("film_query") or state.get("film_query")):
        return call("search_films", detail=True, **common)
    scheduling = bool(re.search(r"今晚|明天|今天|后天|\d{1,2}:\d{2}|个人|[一二三两四五六]人|场次|座位|连座|people|tonight|tomorrow|seats?|screenings?", lowered))
    discovery = bool(rating) or bool(re.search(r"推荐.*电影|高分|评分.*高|recommend.*(?:film|movie)|films?|movies?", lowered))
    if not scheduling and (discovery or context.get("last_task") == "films"):
        if index:
            common["film_index"] = index
            common["detail"] = True
        if re.search(r"一部|one (?:film|movie)", lowered):
            common["limit"] = 1
        return call("search_films", **common)
    if index:
        kind = context.get("last_task")
        if kind in {"films", "cards", "cinemas"}:
            common[{"films": "film_index", "cards": "screening_index", "cinemas": "cinema_index"}[kind]] = index
    return call("search_screenings", **common)
