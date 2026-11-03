"""Small SQLAlchemy Core access layer; every business write owns one transaction."""

import hashlib
import json
import re
import secrets
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from flask import current_app
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DBAPIError, IntegrityError

BEIJING = ZoneInfo("Asia/Shanghai")


class Problem(Exception):
    def __init__(self, code, message, status=400, **details):
        self.code, self.message, self.status, self.details = (
            code,
            message,
            status,
            details,
        )
        super().__init__(message)


class Retry(Exception):
    """Lock discovery changed: roll back and collect the complete set again."""


def require(condition, code, message, status=400, **details):
    if not condition:
        raise Problem(code, message, status, **details)


def now():
    clock = current_app.config.get("CLOCK")
    return clock() if clock else datetime.now(BEIJING).replace(tzinfo=None)


def new_id():
    return secrets.randbits(62) + 1


def wire(value, key=""):
    if isinstance(value, dict):
        return {k: wire(v, k) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [wire(v, key[:-1] if key.endswith("_ids") else "") for v in value]
    if isinstance(value, datetime):
        return value.isoformat(timespec="microseconds") + "+08:00"
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, int) and (key == "id" or key.endswith("_id")):
        return str(value)
    return value


def canonical(value):
    return json.dumps(
        wire(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def integer(value, field, lo=1, hi=2**63 - 1):
    require(
        not isinstance(value, bool)
        and isinstance(value, (int, str))
        and re.fullmatch(r"[0-9]+", str(value)) is not None,
        "VALIDATION",
        f"{field} must be an integer",
    )
    result = int(value)
    require(lo <= result <= hi, "VALIDATION", f"{field} must be between {lo} and {hi}")
    return result


def string(value, field, maximum, minimum=1):
    require(
        isinstance(value, str) and minimum <= len(value.strip()) <= maximum,
        "VALIDATION",
        f"{field} length must be {minimum}..{maximum}",
    )
    return value.strip()


def moment(value, field="starts_at"):
    try:
        result = datetime.fromisoformat(value)
        require(
            result.tzinfo is not None,
            "VALIDATION",
            f"{field} requires an explicit timezone",
        )
        return result.astimezone(BEIJING).replace(tzinfo=None)
    except (TypeError, ValueError):
        raise Problem(
            "VALIDATION", f"{field} must be an ISO 8601 timestamp with timezone"
        )


def make_engine(url):
    require(
        url and url.startswith("mysql+pymysql://"),
        "CONFIG",
        "DATABASE_URL must use MySQL + PyMySQL",
    )
    engine = create_engine(
        url,
        pool_pre_ping=True,
        isolation_level="READ COMMITTED",
        pool_size=10,
        max_overflow=10,
        pool_recycle=1800,
    )

    @event.listens_for(engine, "connect")
    def setup(connection, _):
        with connection.cursor() as cursor:
            cursor.execute("SET time_zone = '+08:00'")
            cursor.execute("SET SESSION innodb_lock_wait_timeout = 5")

    return engine


def db():
    return current_app.extensions["db"]


def rows(c, sql, **params):
    return [dict(r) for r in c.execute(text(sql), params).mappings()]


def one(c, sql, **params):
    row = c.execute(text(sql), params).mappings().first()
    return dict(row) if row else None


def execute(c, sql, **params):
    return c.execute(text(sql), params)


def get(c, table, ident, lock=False):
    row = one(
        c,
        f"SELECT * FROM {table} WHERE id=:id" + (" FOR UPDATE" if lock else ""),
        id=ident,
    )
    require(row is not None, "NOT_FOUND", f"{table} record not found", 404)
    return row


def ins(c, table, **values):
    values.setdefault("id", new_id())
    params = {
        k: canonical(v) if isinstance(v, (dict, list)) else v for k, v in values.items()
    }
    execute(
        c,
        f"INSERT INTO {table} ({','.join(values)}) VALUES ({','.join(':' + k for k in values)})",
        **params,
    )
    return values["id"]


def upd(c, table, ident, **values):
    execute(
        c,
        f"UPDATE {table} SET {','.join(k + '=:' + k for k in values)} WHERE id=:_id",
        _id=ident,
        **values,
    )


def in_ids(values):
    # Only internal integer identifiers enter SQL structure. User values remain bound parameters.
    return ",".join(str(int(x)) for x in sorted(set(values))) or "NULL"


def role(actor, *roles):
    require(
        actor["role"] in roles, "FORBIDDEN", "Role does not permit this action", 403
    )


def branch(actor, cinema_id, admin=False, c=None):
    if c is not None:
        actor = get(c, "users", actor["id"])
    allowed = actor["role"] == "STAFF" and actor["staff_cinema_id"] == cinema_id
    require(
        allowed or (admin and actor["role"] == "PLATFORM_ADMIN"),
        "FORBIDDEN",
        "Cinema permission required",
        403,
    )


def owner(actor, row):
    role(actor, "CUSTOMER")
    require(
        actor["id"] == row["owner_id"],
        "FORBIDDEN",
        "This resource belongs to another customer",
        403,
    )


def transaction(fn):
    """Bounded whole-transaction retry; never retry a partial debit."""
    for attempt in range(4):
        try:
            with db().begin() as c:
                return fn(c)
        except Retry:
            if attempt == 3:
                raise Problem(
                    "BUSY", "State changed concurrently; retry the same request", 409
                )
        except DBAPIError as exc:
            number = exc.orig.args[0] if exc.orig.args else None
            if number in (1205, 1213) and attempt < 3:
                continue
            # Unique-key races are reread in a new transaction, including the winner's receipt.
            if isinstance(exc, IntegrityError) and number == 1062 and attempt < 3:
                continue
            if isinstance(exc, IntegrityError):
                raise Problem(
                    "CONFLICT",
                    "A unique or relational constraint conflicts with this request",
                    409,
                ) from exc
            if number in (1205, 1213):
                raise Problem(
                    "BUSY", "Database busy; retry the same request key", 409
                ) from exc
            raise


def request_key(value):
    require(
        isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{8,80}", value),
        "IDEMPOTENCY_KEY",
        "Idempotency-Key must contain 8..80 ASCII letters, digits, _, ., :, or -",
    )
    return value


def replay(c, actor_id, key, payload):
    row = one(
        c,
        "SELECT * FROM operations WHERE actor_id=:a AND request_key=:k",
        a=actor_id,
        k=key,
    )
    if row:
        require(
            row["payload_hash"] == digest(payload),
            "IDEMPOTENCY_CONFLICT",
            "Key was used for different input",
            409,
        )
        return (
            json.loads(row["result_json"])
            if isinstance(row["result_json"], str)
            else row["result_json"]
        )
    return None


def operation(c, actor, key, payload, kind, result, **refs):
    return ins(
        c,
        "operations",
        actor_id=actor["id"],
        request_key=key,
        payload_hash=digest(payload),
        operation_type=kind,
        result_json=result,
        created_at=now(),
        **refs,
    )


def scope(
    c,
    screening_ids=(),
    customer_ids=(),
    booking_ids=(),
    hold_ids=(),
    physical_screen_ids=(),
):
    """Lock screens -> screenings -> user guards -> holds -> bookings, IDs sorted.

    Discover before locking; if a customer's active hold moved to an unlocked screen,
    roll back instead of acquiring an earlier lock class out of order.
    All seat/programme writers must enter through this boundary.
    """
    sids, uids, bids, hids = map(
        set, (screening_ids, customer_ids, booking_ids, hold_ids)
    )
    for h in rows(c, f"SELECT * FROM seat_holds WHERE id IN ({in_ids(hids)})"):
        sids.add(h["screening_id"])
        uids.add(h["owner_id"])
        if h["source_booking_id"]:
            bids.add(h["source_booking_id"])
    for b in rows(c, f"SELECT * FROM bookings WHERE id IN ({in_ids(bids)})"):
        sids.add(b["screening_id"])
        uids.add(b["owner_id"])
    guard_customers = set(uids)
    for h in rows(
        c,
        f"SELECT * FROM seat_holds WHERE owner_id IN ({in_ids(uids)}) AND status='ACTIVE'",
    ):
        sids.add(h["screening_id"])
    screenings = rows(c, f"SELECT * FROM screenings WHERE id IN ({in_ids(sids)})")
    screen_ids = {s["screen_id"] for s in screenings} | set(physical_screen_ids)
    for i in sorted(screen_ids):
        get(c, "screens", i, True)
    for i in sorted(sids):
        get(c, "screenings", i, True)
    hs = rows(
        c,
        f"SELECT * FROM seat_holds WHERE (screening_id IN ({in_ids(sids)}) AND status='ACTIVE') OR id IN ({in_ids(hids)})",
    )
    uids.update(h["owner_id"] for h in hs)
    bs = rows(
        c,
        f"SELECT * FROM bookings WHERE (screening_id IN ({in_ids(sids)}) AND status='CONFIRMED') OR id IN ({in_ids(bids)})",
    )
    uids.update(b["owner_id"] for b in bs)
    for i in sorted(uids):
        get(c, "users", i, True)
    # Only the requested customers may have a hold on an unrelated screen that we must replace.
    actual = rows(
        c,
        f"SELECT * FROM seat_holds WHERE owner_id IN ({in_ids(guard_customers)}) AND status='ACTIVE'",
    )
    if any(h["screening_id"] not in sids for h in actual):
        raise Retry()
    for i in sorted({h["id"] for h in hs} | {h["id"] for h in actual}):
        get(c, "seat_holds", i, True)
    for i in sorted({b["id"] for b in bs}):
        get(c, "bookings", i, True)
    # Expiry cleanup shares exactly the same locking protocol as purchase/cancellation.
    for h in hs:
        if h["status"] == "ACTIVE" and h["expires_at"] <= now():
            execute(c, "DELETE FROM seat_allocations WHERE hold_id=:h", h=h["id"])
            upd(c, "seat_holds", h["id"], status="EXPIRED")
