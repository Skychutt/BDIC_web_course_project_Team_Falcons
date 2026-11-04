"""Conservative policy around model-proposed task/condition changes.

The model supplies the relationship and evidence; Python owns validation, defaults,
hard-constraint protection and the small set of supported soft preferences.
"""
import re
from .domain import FilterPatch

SOFT_FIELDS = {"zone", "sort_by_rating", "district", "hall_type", "genre", "keyword"}
RATING_NUMBER = re.compile(r"(?:评分|rating|rated|score)[^，。,.!?！？]{0,16}\d(?:\.\d+)?|\d(?:\.\d+)?\s*(?:分|星|stars?|/\s*10)", re.I)
UNRATED_EXCLUSION = re.compile(r"只.*(?:有评分|已评分)|排除.*(?:未评分|无评分)|rated only|only rated|exclude unrated", re.I)
ANY_RATING = re.compile(r"不限评分|不看评分|取消评分|不限制评分|包括.*(?:无评分|未评分)|any rating|ignore ratings?|include unrated|remove.*rating", re.I)
GENERIC = re.compile(r"(?:(?:那|就|请|帮我|给我|随便|先|能不能|可以))*推荐(?:一部|一个|一些|几部)?(?:好看的)?(?:电影|片子)(?:给我)?(?:吧|吗)?", re.I)


def generic_film_request(message):
    plain = re.sub(r"[\s，。！？!?.,]", "", message).lower()
    return bool(GENERIC.fullmatch(plain) or plain in {
        "recommendafilm", "recommendamovie", "recommendonefilm", "recommendonemovie",
        "recommendmovies", "recommendfilms", "recommendanymovie", "anymoviewilldo"})


def normalize_query(args, message):
    changes = args.updates.model_dump(exclude_unset=True)
    if (changes.get("min_rating") is not None or changes.get("rated_only")) and not (
            RATING_NUMBER.search(message) or UNRATED_EXCLUSION.search(message)):
        # A model must not turn vague 'high rated' into a made-up threshold.
        changes.pop("min_rating", None)
        changes.pop("rated_only", None)
        changes["sort_by_rating"] = True
    if ANY_RATING.search(message):
        changes.update(min_rating=None, rated_only=False, sort_by_rating=False)
    evidence = [e for e in args.evidence if e.field in changes]
    if any(e.field not in FilterPatch.model_fields or e.original_text not in message for e in args.evidence):
        raise ValueError("Condition evidence must quote this user turn")
    if len({e.field for e in evidence}) != len(evidence):
        raise ValueError("Duplicate condition evidence")
    if any(e.strength == "soft" and e.field not in SOFT_FIELDS for e in evidence):
        raise ValueError("This field needs an explicit hard value or clarification")
    return args.model_copy(update={"updates": FilterPatch.model_validate(changes), "evidence": evidence})


def rating_is_hard(conversation):
    return any(conversation.conditions.get(k, {}).get("strength", "hard") == "hard"
               and conversation.conditions.get(k, {}).get("status", "active") == "active"
               and getattr(conversation.filters, k) for k in ("min_rating", "rated_only"))


def without_rating(filters):
    return filters.model_copy(update={"min_rating": None, "rated_only": False, "sort_by_rating": False})


def chosen_recovery(message, recovery):
    """Recognize explicit selection of the small set of offered recovery actions.

    Ambiguous agreement is not authorization to delete a hard requirement. Other
    wording can be clarified by the model or resolved by the visible buttons.
    """
    if re.search(r"不要|别取消|不取消|不包括|don't|do not|keep.*rating", message, re.I):
        return None
    selected = re.search(r"(?:选|第)\s*([一二三四1234])(?:个|项)?|(?:option|choice)\s*([1-4])", message, re.I)
    if selected:
        raw = selected[1] or selected[2]
        index = {"一": 1, "二": 2, "三": 3, "四": 4}.get(raw, int(raw) if raw.isdigit() else 0)
        return recovery["options"][index - 1]["id"] if 1 <= index <= len(recovery["options"]) else None
    if re.search(r"保留.*要求|暂.*不推荐|keep.*requirement", message, re.I):
        return "keep_requirements"
    if re.search(r"按类型|choose.*genre", message, re.I):
        return "choose_genre"
    if ANY_RATING.search(message) or re.search(r"看看全部|看全部电影|all (?:films|movies)", message, re.I):
        return "include_unrated_movies"
    for key, words in {"genre": "类型|genre", "hall_type": "厅型|hall", "district": "区域|地区|district|area", "budget_minor": "预算|budget", "keyword": "关键词|keyword"}.items():
        if re.search(r"不限|取消|去掉|remove|ignore|any", message, re.I) and re.search(words, message, re.I):
            return "remove_" + key
    return None
