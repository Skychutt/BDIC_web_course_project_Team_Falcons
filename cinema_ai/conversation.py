"""Session-local dialogue state, response helpers and validated preference updates."""
import json
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import timedelta
from importlib.resources import files
from threading import Lock, RLock

from .catalog import DISTRICTS
from .domain import Filters
from .providers import ProviderError

RULES = json.loads(files("cinema_ai").joinpath("data/rules.json").read_text(encoding="utf-8"))


@dataclass
class Conversation:
    filters: Filters
    csrf: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    history: deque = field(default_factory=lambda: deque(maxlen=8))
    lock: Lock = field(default_factory=Lock)
    touched: float = 0
    candidates: dict = field(default_factory=dict)
    last_task: str | None = None
    conditions: dict = field(default_factory=dict)
    task_kind: str | None = None
    task_action: str = "continue"
    recovery: dict | None = None
    locale: str | None = None

    def __post_init__(self):
        self.set_defaults()

    def set_defaults(self):
        for name in ("city", "date", "fare_type"):
            self.conditions[name] = condition(getattr(self.filters, name), "system_default", "default", "")

    def new_task(self, today, kind=None):
        # Only current-task state is stored today. Long-term preference saving is separate.
        for item in self.conditions.values():
            item["status"] = "cleared"
        self.filters = Filters(date=today.isoformat())
        self.set_defaults()
        self.candidates.clear()
        self.last_task = None
        self.task_kind = kind
        self.recovery = None
        self.task_action = "new"


def condition(value, source, strength, original_text, status="active"):
    return {"value": value, "source": source, "strength": strength,
            "scope": "current_task", "status": status, "original_text": original_text}


def record_conditions(conversation, old, changes, message="", evidence=(), manual=False, relaxed=False):
    evidence = {item.field: item for item in evidence}
    actual = conversation.filters.model_dump()
    for name in set(changes) | {k for k, v in actual.items() if v != getattr(old, k)}:
        item = evidence.get(name)
        quote = item.original_text if item else message
        source = "user_explicit" if manual or item and item.source == "user_explicit" else "model_inferred"
        strength = item.strength if item else "soft" if name in {"zone", "sort_by_rating"} else "hard"
        # Sorting and preferred seat zones are preferences; they never exclude films/seats.
        if name in {"zone", "sort_by_rating"}:
            strength = "soft"
        value = actual[name]
        status = "relaxed" if relaxed else "cleared" if value is None or value is False else "active"
        conversation.conditions[name] = condition(value, source, strength, quote, status)
    conversation.recovery = None


def public_state(conversation):
    return {"filters": conversation.filters.model_dump(), "conditions": conversation.conditions,
            "task": {"kind": conversation.task_kind, "action": conversation.task_action}}


class SessionStore:
    def __init__(self, clock, ttl=1800, capacity=1000, monotonic=time.monotonic):
        self.clock, self.ttl, self.capacity, self.monotonic = clock, ttl, capacity, monotonic
        self.items = {}
        self.lock = RLock()

    def get(self, sid=None):
        now = self.monotonic()
        with self.lock:
            for key in list(self.items):
                item = self.items[key]
                if now - item.touched >= self.ttl and not item.lock.locked():
                    del self.items[key]
            if sid not in self.items:
                if len(self.items) >= self.capacity:
                    idle = [(v.touched, k) for k, v in self.items.items() if not v.lock.locked()]
                    if not idle:
                        raise ProviderError("busy")
                    del self.items[min(idle)[1]]
                sid = secrets.token_urlsafe(32)
                self.items[sid] = Conversation(filters=Filters(date=self.clock().date().isoformat()))
            item = self.items[sid]
            item.touched = now
            return sid, item


def merge_filters(current, patch, today):
    changes = patch.model_dump(exclude_unset=True)
    if "film_query" in changes:
        changes["film_id"] = None
        changes["screening_id"] = None
    if any(k in changes for k in ("city", "district")):
        changes["cinema_id"] = None
        changes["screening_id"] = None
    if any(k in changes for k in ("date", "time_start", "time_end", "hall_type")):
        changes["screening_id"] = None
    for name in ("city", "date", "party_size"):
        if name in changes and changes[name] is None:
            raise ValueError(f"Cannot clear {name}")
    if "date" in changes:
        offsets = {"today": 0, "tomorrow": 1, "day_after_tomorrow": 2}
        if changes["date"] in offsets:
            changes["date"] = (today + timedelta(days=offsets[changes["date"]])).isoformat()
    if "city" in changes:
        city = changes["city"].lower().strip()
        changes["city"] = "beijing" if city in {"beijing", "北京", "北京市"} else city
        if changes["city"] != current.city and "district" not in changes:
            changes["district"] = None
    if changes.get("district"):
        district = changes["district"].lower().strip()
        matches = [code for code, names in DISTRICTS.items() if district in (code, names[0], names[0][:-1], names[1].lower())]
        if not matches:
            raise ValueError("Unknown district")
        changes["district"] = matches[0]
        # A named Beijing district is an explicit user location choice.
        if changes.get("city", "beijing") != "beijing":
            raise ValueError("Conflicting city and district")
        changes["city"] = "beijing"
    candidate = Filters.model_validate({**current.model_dump(), **changes})
    if candidate.time_start == "24:00" or (candidate.time_start and candidate.time_end and candidate.time_start >= candidate.time_end):
        raise ValueError("Ambiguous or reversed time window")
    return candidate


PRIVATE_REQUEST = re.compile(
    r"他人|别人的|我的订单|订单号|营业额|密钥|密码|原始坐标|"
    r"\b(?:revenue|password|api[_ ]?key|my (?:orders?|balance)|other.*orders?|execute sql)\b|"
    r"\b(?:select\b.+\bfrom|drop\s+table|delete\s+from|insert\s+into)\b|"
    r"[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|"
    r"-?\d{1,3}\.\d{3,}\s*[,，]\s*-?\d{1,3}\.\d{3,}|sk-[a-z0-9_-]{12,}", re.I)


class ChatService:
    """Shared response shape; the bounded execution loop lives in AgentService."""
    def __init__(self, catalog, provider, runner, clock, timeout=10):
        self.catalog, self.provider, self.runner, self.clock = catalog, provider, runner, clock
        self.timeout = timeout

    def response(self, conversation, locale, reply, **overrides):
        return {"status": "ok", "reply": reply, "locale": locale,
                **public_state(conversation), "cards": [], "films": [], "cinemas": [],
                "rules": [], "provider": self.provider.name, "data_source": self.catalog.repository.source_name,
                "error_code": None, **overrides}

