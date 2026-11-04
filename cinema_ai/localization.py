"""Reviewed translations of existing catalog facts, separate from business values.

Unknown records keep their original names/text. If source prose changes, its old
translation is not reused. This layer never changes IDs, rankings, prices or seats.
"""
import json
import re
from importlib.resources import files

TRANSLATIONS = json.loads(files("cinema_ai").joinpath("data/translations.json").read_text(encoding="utf-8"))


def reply_locale(message, previous="zh"):
    """Follow the question's language; bare numbers/punctuation keep the last one.

    English question/command openings permit Chinese film or cinema names without
    turning the whole reply Chinese. Chinese questions with English titles remain Chinese.
    """
    text = message.strip()
    if re.match(r"(?:please\s+)?(?:what|where|when|how|which|can you|could you|would you|show|recommend|find|list|tell me|check)\b", text, re.I):
        return "en"
    if re.search(r"[\u4e00-\u9fff]", text):
        return "zh"
    if re.search(r"[A-Za-z]", text):
        return "en"
    return previous if previous in {"zh", "en"} else "zh"


def bilingual(value):
    return {"zh": value, "en": value}


def film_text(title, synopsis=None):
    entry = TRANSLATIONS["films"].get(title, {})
    titles = entry.get("titles", bilingual(title))
    synopses = entry.get("synopses") if synopsis == entry.get("source_synopsis") else None
    return titles, synopses or bilingual(synopsis or "")


def cinema_text(name, address=None):
    entry = TRANSLATIONS["cinemas"].get(name, {})
    names = entry.get("names", bilingual(name))
    addresses = entry.get("addresses") if address == entry.get("source_address") else None
    return names, addresses or bilingual(address or "")


def private_card_labels(values):
    """Add display alternatives locally; personal result details never go to the model."""
    for item in values:
        if "film_title" in item:
            item["film_titles"] = film_text(item["film_title"])[0]
        if "cinema_name" in item:
            item["cinema_names"] = cinema_text(item["cinema_name"])[0]
    return values
