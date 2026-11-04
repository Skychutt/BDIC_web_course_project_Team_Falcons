"""Resolve simple ordinal follow-ups without asking a model to invent arguments.

Only an entire, unambiguous film-to-showtimes request matches. Compound requests
with dates, people, negation or multiple choices still go through the planner.
The returned ordinal is never a film ID; the server checks its own candidate list.
"""
import re

ZH_SCREENINGS = re.compile(
    r"(?:请|请帮我|帮我)?\s*(?:查询|查看|查一下|查|看看)?\s*"
    r"第\s*(?P<index>[0-9]{1,2}|[一二三四五六七八九十])\s*部\s*(?:电影|影片)?\s*"
    r"(?:的|有(?:什么|哪些))?\s*(?:场次|排片|放映时间)(?:有哪些|是什么)?[。！？?!\s]*"
)
EN_SCREENINGS = re.compile(
    r"(?:please\s+)?(?:(?:show|check|find|list)(?:\s+me)?\s+)?"
    r"(?:showtimes|screenings)\s+for\s+(?:the\s+)?"
    r"(?P<index>first|second|third|fourth|fifth|[0-9]{1,2}(?:st|nd|rd|th)?)\s+"
    r"(?:film|movie)[.!?\s]*", re.I
)
EN_NUMBERED_SCREENINGS = re.compile(
    r"(?:please\s+)?(?:(?:show|check|find|list)(?:\s+me)?\s+)?"
    r"(?:showtimes|screenings)\s+for\s+(?:the\s+)?(?:film|movie)\s+(?:number\s+)?"
    r"(?P<index>[0-9]{1,2})[.!?\s]*", re.I
)


def screening_film_index(message):
    match = (ZH_SCREENINGS.fullmatch(message.strip()) or EN_SCREENINGS.fullmatch(message.strip())
             or EN_NUMBERED_SCREENINGS.fullmatch(message.strip()))
    if not match:
        return None
    value = match["index"].lower()
    words = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7,
             "八": 8, "九": 9, "十": 10, "first": 1, "second": 2, "third": 3,
             "fourth": 4, "fifth": 5}
    return words[value] if value in words else int(re.match(r"[0-9]+", value)[0])
