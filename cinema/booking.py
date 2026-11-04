"""Atomic holds, quotes, purchases, repeated rescheduling, and wallet postings."""

from collections import Counter
from datetime import timedelta

from flask import current_app
from itsdangerous import BadData, URLSafeTimedSerializer

from .core import *


def signer(salt):
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=salt)


def decode(token, salt, max_age=300):
    try:
        require(isinstance(token, str), "TOKEN", "Signed token is required")
        return signer(salt).loads(token, max_age=max_age)
    except BadData:
        raise Problem(
            "TOKEN_EXPIRED", "Token is invalid or expired; request a new quote", 409
        )


def fee_rate(starts_at, current):
    remaining = (starts_at - current).total_seconds()
    require(
        remaining >= 1800,
        "RESCHEDULE_CLOSED",
        "Rescheduling closes 30 minutes before the current screening",
        409,
    )
    return 0 if remaining >= 43200 else 500 if remaining >= 21600 else 2000


def rounded(amount, bps):
    return (amount * bps + 5000) // 10000


def salable(c, s):
    require(
        s["status"] == "PUBLISHED" and s["starts_at"] > now(),
        "SALE_CLOSED",
        "Screening is no longer on sale",
        409,
    )
    require(
        get(c, "cinemas", s["cinema_id"])["is_active"],
        "SALE_CLOSED",
        "Cinema is inactive",
        409,
    )


def source_ok(c, h, source):
    require(
        source["status"] == "CONFIRMED",
        "BOOKING_STATE",
        "Original booking is not active",
        409,
    )
    require(
        source["owner_id"] == h["owner_id"]
        and source["cinema_id"] == h["cinema_id"]
        and source["film_id"] == h["film_id"]
        and source["screening_id"] != h["screening_id"],
        "RESCHEDULE_TARGET",
        "Choose a different screening of the same film at the same cinema",
        409,
    )
    return fee_rate(get(c, "screenings", source["screening_id"])["starts_at"], now())


def hold_selection(body):
    sid = integer(body.get("screening_id"), "screening_id")
    raw = body.get("seat_ids")
    require(
        isinstance(raw, list) and 1 <= len(raw) <= 12,
        "VALIDATION",
        "Choose 1..12 seats",
    )
    seat_ids = sorted(integer(v, "seat_id") for v in raw)
    require(
        len(set(seat_ids)) == len(seat_ids), "VALIDATION", "Seat IDs must be distinct"
    )
    source_id = (
        integer(body["source_booking_id"], "source_booking_id")
        if body.get("source_booking_id")
        else None
    )
    return sid, seat_ids, source_id


def counter_hold_consent(actor, body):
    role(actor, "CUSTOMER")
    sid, seats, source_id = hold_selection(body)
    staff_id = integer(body.get("staff_id"), "staff_id")
    with db().connect() as c:
        screening = get(c, "screenings", sid)
        salable(c, screening)
        staff = get(c, "users", staff_id)
        branch(staff, screening["cinema_id"], c=c)
        if source_id:
            owner(actor, get(c, "bookings", source_id))
    value = dict(
        owner_id=actor["id"],
        staff_id=staff_id,
        screening_id=sid,
        seat_ids=seats,
        source_booking_id=source_id,
        request_key="counter-hold-" + secrets.token_hex(16),
    )
    return {
        "hold_consent_token": signer("counter-hold").dumps(wire(value)),
        "request_key": value["request_key"],
        "valid_for_seconds": 300,
        "message": "Authorizes this seat selection only. Payment requires a separate quote confirmation.",
    }


def create_hold(actor, body, key):
    role(actor, "CUSTOMER", "STAFF")
    payload = dict(action="HOLD", body=body)

    def work(c):
        old = replay(c, actor["id"], key, payload)
        if old:
            return old
        if actor["role"] == "STAFF":
            consent = decode(body.get("hold_consent_token"), "counter-hold")
            require(
                integer(consent["staff_id"], "staff_id") == actor["id"],
                "CONSENT",
                "Hold approval belongs to another staff member",
                403,
            )
            require(
                consent["request_key"] == key,
                "CONSENT",
                "Use the request key issued with this single-action hold approval",
                403,
            )
            uid = integer(consent["owner_id"], "owner_id")
            sid, seat_ids, source_id = hold_selection(consent)
        else:
            uid = actor["id"]
            sid, seat_ids, source_id = hold_selection(body)
        scope(c, [sid], [uid, actor["id"]], [source_id] if source_id else [])
        old = replay(c, actor["id"], key, payload)
        if old:
            return old
        s = get(c, "screenings", sid)
        salable(c, s)
        if actor["role"] == "STAFF":
            branch(actor, s["cinema_id"], c=c)
        role(get(c, "users", uid), "CUSTOMER")
        context = dict(
            owner_id=uid,
            cinema_id=s["cinema_id"],
            film_id=s["film_id"],
            screening_id=sid,
        )
        if source_id:
            source = get(c, "bookings", source_id)
            require(
                source["owner_id"] == uid,
                "FORBIDDEN",
                "Original booking belongs to another customer",
                403,
            )
            source_ok(c, context, source)
            count = one(
                c, "SELECT COUNT(*) AS n FROM tickets WHERE booking_id=:b", b=source_id
            )["n"]
            require(
                count == len(seat_ids),
                "PARTY_SIZE",
                "Reschedule must include every original ticket",
            )
        seats = rows(
            c,
            f"SELECT id FROM seats WHERE layout_id=:l AND id IN ({in_ids(seat_ids)})",
            l=s["layout_id"],
        )
        require(
            len(seats) == len(seat_ids),
            "SEAT_LAYOUT",
            "Seats must belong to this screening layout",
        )
        previous = one(
            c, "SELECT * FROM seat_holds WHERE owner_id=:u AND status='ACTIVE'", u=uid
        )
        if previous:
            execute(
                c, "DELETE FROM seat_allocations WHERE hold_id=:h", h=previous["id"]
            )
            upd(c, "seat_holds", previous["id"], status="CANCELLED")
        occupied = rows(
            c,
            f"SELECT seat_id FROM seat_allocations WHERE screening_id=:s AND seat_id IN ({in_ids(seat_ids)})",
            s=sid,
        )
        require(
            not occupied,
            "SEAT_UNAVAILABLE",
            "One or more seats were taken; previous hold is unchanged",
            409,
            seat_ids=[x["seat_id"] for x in occupied],
        )
        created = now()
        expiry = min(created + timedelta(minutes=5), s["starts_at"])
        hid = ins(
            c,
            "seat_holds",
            **context,
            creator_id=actor["id"],
            layout_id=s["layout_id"],
            source_booking_id=source_id,
            status="ACTIVE",
            created_at=created,
            expires_at=expiry,
            quote_revision=s["revision_no"],
        )
        for seat in seat_ids:
            ins(
                c,
                "seat_allocations",
                screening_id=sid,
                layout_id=s["layout_id"],
                seat_id=seat,
                state="HELD",
                hold_id=hid,
            )
        result = dict(
            hold_id=hid,
            screening_id=sid,
            seat_ids=seat_ids,
            expires_at=expiry,
            status="ACTIVE",
        )
        operation(
            c,
            actor,
            key,
            payload,
            "HOLD",
            result,
            result_hold_id=hid,
            source_booking_id=source_id,
        )
        return result

    return transaction(work)


def active_hold(c, hid):
    h = get(c, "seat_holds", hid)
    require(
        h["status"] == "ACTIVE" and h["expires_at"] > now(),
        "HOLD_EXPIRED",
        "Hold is no longer active",
        409,
    )
    salable(c, get(c, "screenings", h["screening_id"]))
    return h


def release_hold(actor, hid):
    def work(c):
        h = get(c, "seat_holds", hid)
        owner(actor, h)
        scope(c, hold_ids=[hid], customer_ids=[actor["id"]])
        h = get(c, "seat_holds", hid)
        if h["status"] == "ACTIVE":
            execute(c, "DELETE FROM seat_allocations WHERE hold_id=:h", h=hid)
            upd(c, "seat_holds", hid, status="CANCELLED")
        return {"hold_id": hid, "status": get(c, "seat_holds", hid)["status"]}

    return transaction(work)


def price(c, h, choices, coupon_id):
    s = get(c, "screenings", h["screening_id"])
    held = rows(c, "SELECT seat_id FROM seat_allocations WHERE hold_id=:h", h=h["id"])
    require(
        isinstance(choices, list) and len(choices) == len(held) and len(held) > 0,
        "FARE_SELECTION",
        "Provide one fare for every held seat",
    )
    require(
        all(isinstance(x, dict) for x in choices),
        "FARE_SELECTION",
        "Invalid fare selection",
    )
    normalized = sorted(
        [
            dict(
                seat_id=integer(x.get("seat_id"), "seat_id"),
                fare_type=x.get("fare_type"),
            )
            for x in choices
        ],
        key=lambda x: x["seat_id"],
    )
    require(
        [x["seat_id"] for x in normalized] == sorted(x["seat_id"] for x in held),
        "FARE_SELECTION",
        "Seat set does not match hold",
    )
    return price_selection(c, h, normalized, coupon_id, lock_coupon=True)


def price_selection(c, h, choices, coupon_id, *, lock_coupon=False):
    """Shared arithmetic for a validated hold or a read-only availability preview.

    Callers validate seat ownership/availability and ticket mix before entering.
    This function never updates inventory, signs a quote or consumes a coupon.
    """
    s = get(c, "screenings", h["screening_id"])
    normalized = [dict(x) for x in choices]
    fares = {
        f["fare_type"]: f["price_minor"]
        for f in rows(c, "SELECT * FROM fares WHERE screening_id=:s", s=s["id"])
    }
    for x in normalized:
        require(
            isinstance(x["fare_type"], str) and x["fare_type"] in fares,
            "FARE_SELECTION",
            "Unknown fare type",
        )
        x["face_price_minor"] = fares[x["fare_type"]]
    factor, old_net, fee, rate, cumulative, coupon = 10000, 0, 0, 0, 0, coupon_id
    if h["source_booking_id"]:
        require(
            coupon_id is None,
            "COUPON_INHERITED",
            "Rescheduling inherits the original discount; do not select another coupon",
        )
        source = get(c, "bookings", h["source_booking_id"])
        rate = source_ok(c, h, source)
        old_types = [
            t["fare_type"]
            for t in rows(
                c, "SELECT fare_type FROM tickets WHERE booking_id=:b", b=source["id"]
            )
        ]
        require(
            Counter(old_types) == Counter(x["fare_type"] for x in normalized),
            "FARE_MIX",
            "Keep original party size and fare mix",
        )
        factor, old_net, cumulative, coupon = (
            source["price_factor_bps"],
            source["net_ticket_minor"],
            source["cumulative_fee_minor"],
            source["original_coupon_id"],
        )
        fee = rounded(old_net, rate)
    elif coupon_id:
        cp = get(c, "coupons", coupon_id, lock_coupon)
        require(
            cp["owner_id"] == h["owner_id"]
            and cp["cinema_id"] == h["cinema_id"]
            and cp["status"] == "AVAILABLE",
            "COUPON_INVALID",
            "Coupon is unavailable or belongs to another customer/cinema",
            409,
        )
        factor = cp["price_factor_bps"]
    gross = sum(x["face_price_minor"] for x in normalized)
    net = rounded(gross, factor)
    return dict(
        hold_id=h["id"],
        screening_id=h["screening_id"],
        source_booking_id=h["source_booking_id"],
        owner_id=h["owner_id"],
        expires_at=h["expires_at"],
        revision_no=s["revision_no"],
        tickets=normalized,
        gross_ticket_minor=gross,
        price_factor_bps=factor,
        net_ticket_minor=net,
        fee_rate_bps=rate,
        current_fee_minor=fee,
        cumulative_fee_minor=cumulative + fee,
        original_coupon_id=coupon,
        ticket_delta_minor=net - old_net,
        amount_due_minor=net - old_net + fee,
    )


def quote(actor, hid, body):
    coupon_id = (
        integer(body["coupon_id"], "coupon_id") if body.get("coupon_id") else None
    )

    def work(c):
        h = get(c, "seat_holds", hid)
        owner(actor, h)
        scope(c, hold_ids=[hid], customer_ids=[actor["id"]])
        h = active_hold(c, hid)
        q = price(c, h, body.get("tickets"), coupon_id)
        qhash = digest(q)
        upd(c, "seat_holds", hid, quote_hash=qhash, quote_revision=q["revision_no"])
        token = signer("quote").dumps(
            wire(
                dict(
                    hold_id=hid,
                    tickets=body.get("tickets"),
                    coupon_id=coupon_id,
                    quote_hash=qhash,
                )
            )
        )
        return dict(**q, quote_hash=qhash, quote_token=token)

    return transaction(work)


def counter_consent(actor, hid, body):
    staff_id = integer(body.get("staff_id"), "staff_id")
    token = decode(body.get("quote_token"), "quote")
    require(
        integer(token["hold_id"], "hold_id") == hid,
        "TOKEN",
        "Quote belongs to another hold",
    )

    def work(c):
        h = get(c, "seat_holds", hid)
        owner(actor, h)
        scope(c, hold_ids=[hid], customer_ids=[actor["id"]])
        h = active_hold(c, hid)
        staff = get(c, "users", staff_id)
        branch(staff, h["cinema_id"])
        q = price(
            c,
            h,
            token["tickets"],
            integer(token["coupon_id"], "coupon_id") if token["coupon_id"] else None,
        )
        require(
            digest(q) == token["quote_hash"] == h["quote_hash"],
            "QUOTE_CHANGED",
            "Please confirm a fresh quote",
            409,
        )
        consent = signer("counter").dumps(
            dict(
                hold_id=str(hid),
                owner_id=str(actor["id"]),
                staff_id=str(staff_id),
                quote_hash=h["quote_hash"],
            )
        )
        return {
            "consent_token": consent,
            "expires_at": h["expires_at"],
            "amount_due_minor": q["amount_due_minor"],
        }

    return transaction(work)


def settlement(c, booking, opid, ticket_delta, fee_delta, cash_kind, cash_id, at):
    for component, amount in [("TICKET", ticket_delta), ("FEE", fee_delta)]:
        if amount:
            ins(
                c,
                "settlement_entries",
                operation_id=opid,
                booking_id=booking["id"],
                owner_id=booking["owner_id"],
                cinema_id=booking["cinema_id"],
                component=component,
                amount_minor=amount,
                cash_kind=cash_kind,
                payment_id=cash_id if cash_kind == "PAYMENT" else None,
                refund_id=cash_id if cash_kind == "REFUND" else None,
                settled_at=at,
            )


def wallet_post(c, w, booking, opid, amount, kind, cash_id, at):
    balance = w["balance_minor"] + amount
    require(balance >= 0, "INSUFFICIENT_BALANCE", "Wallet balance is insufficient", 409)
    upd(c, "wallets", w["id"], balance_minor=balance, updated_at=at)
    ins(
        c,
        "wallet_entries",
        wallet_id=w["id"],
        owner_id=booking["owner_id"],
        operation_id=opid,
        entry_type=kind,
        amount_minor=amount,
        balance_after_minor=balance,
        payment_id=cash_id if kind == "PAYMENT" else None,
        refund_id=cash_id if kind == "REFUND" else None,
        created_at=at,
    )


def checkout(actor, body, key):
    role(actor, "CUSTOMER", "STAFF")
    # Look for a committed receipt before token expiry: a lost response can be recovered later.
    payload = dict(
        action="CHECKOUT",
        quote_token=body.get("quote_token"),
        consent_token=body.get("consent_token"),
    )

    def work(c):
        old = replay(c, actor["id"], key, payload)
        if old:
            return old
        token = decode(body.get("quote_token"), "quote")
        hid = integer(token["hold_id"], "hold_id")
        initial = get(c, "seat_holds", hid)
        scope(c, hold_ids=[hid], customer_ids=[initial["owner_id"], actor["id"]])
        old = replay(c, actor["id"], key, payload)
        if old:
            return old
        h = active_hold(c, hid)
        if actor["role"] == "CUSTOMER":
            owner(actor, h)
        else:
            branch(actor, h["cinema_id"], c=c)
            consent = decode(body.get("consent_token"), "counter")
            require(
                consent
                == dict(
                    hold_id=str(hid),
                    owner_id=str(h["owner_id"]),
                    staff_id=str(actor["id"]),
                    quote_hash=token["quote_hash"],
                ),
                "CONSENT",
                "Customer approval must bind this staff member, hold, and quote",
                403,
            )
        cp = integer(token["coupon_id"], "coupon_id") if token["coupon_id"] else None
        q = price(c, h, token["tickets"], cp)
        require(
            digest(q) == token["quote_hash"] == h["quote_hash"],
            "QUOTE_CHANGED",
            "Price, fee or selection changed; request and confirm a new quote",
            409,
        )
        w = one(
            c, "SELECT * FROM wallets WHERE customer_id=:u FOR UPDATE", u=h["owner_id"]
        )
        require(
            w["balance_minor"] >= q["amount_due_minor"],
            "INSUFFICIENT_BALANCE",
            "Wallet balance is insufficient",
            409,
        )
        bid = new_id()
        source = (
            get(c, "bookings", h["source_booking_id"])
            if h["source_booking_id"]
            else None
        )
        # A wallet lock may have waited: recheck time-dependent conditions at settlement.
        active_hold(c, hid)
        if source:
            require(
                source_ok(c, h, source) == q["fee_rate_bps"],
                "QUOTE_CHANGED",
                "Fee band changed; confirm a fresh quote",
                409,
            )
        at = now()
        ins(
            c,
            "bookings",
            id=bid,
            owner_id=h["owner_id"],
            creator_id=actor["id"],
            cinema_id=h["cinema_id"],
            film_id=h["film_id"],
            screening_id=h["screening_id"],
            layout_id=h["layout_id"],
            channel="COUNTER" if actor["role"] == "STAFF" else "ONLINE",
            status="CONFIRMED",
            gross_ticket_minor=q["gross_ticket_minor"],
            price_factor_bps=q["price_factor_bps"],
            net_ticket_minor=q["net_ticket_minor"],
            current_fee_minor=q["current_fee_minor"],
            cumulative_fee_minor=q["cumulative_fee_minor"],
            original_coupon_id=q["original_coupon_id"],
            root_booking_id=source["root_booking_id"] if source else bid,
            predecessor_id=source["id"] if source else None,
            change_no=source["change_no"] + 1 if source else 0,
            created_at=at,
        )
        for t in q["tickets"]:
            tid = ins(
                c,
                "tickets",
                booking_id=bid,
                screening_id=h["screening_id"],
                layout_id=h["layout_id"],
                **t,
            )
            execute(
                c,
                "UPDATE seat_allocations SET state='SOLD', hold_id=NULL, ticket_id=:t WHERE hold_id=:h AND seat_id=:s",
                t=tid,
                h=hid,
                s=t["seat_id"],
            )
        upd(c, "seat_holds", hid, status="CONVERTED")
        if source:
            upd(c, "bookings", source["id"], status="RESCHEDULED")
            execute(
                c,
                "DELETE FROM seat_allocations WHERE ticket_id IN (SELECT id FROM tickets WHERE booking_id=:b)",
                b=source["id"],
            )
        elif cp:
            upd(
                c, "coupons", cp, status="USED", redeemed_booking_id=bid, redeemed_at=at
            )
        amount = q["amount_due_minor"]
        result = dict(
            booking_id=bid,
            status="CONFIRMED",
            amount_due_minor=amount,
            net_ticket_minor=q["net_ticket_minor"],
            current_fee_minor=q["current_fee_minor"],
            cumulative_fee_minor=q["cumulative_fee_minor"],
            balance_minor=w["balance_minor"] - amount,
        )
        opid = operation(
            c,
            actor,
            key,
            payload,
            "RESCHEDULE" if source else "PURCHASE",
            result,
            source_booking_id=source["id"] if source else None,
            result_booking_id=bid,
            result_hold_id=hid,
        )
        booking = get(c, "bookings", bid)
        cash_id = None
        kind = "ZERO"
        if amount > 0:
            cash_id = ins(
                c,
                "payments",
                booking_id=bid,
                operation_id=opid,
                owner_id=h["owner_id"],
                cinema_id=h["cinema_id"],
                wallet_id=w["id"],
                amount_minor=amount,
                status="SUCCEEDED",
                settled_at=at,
            )
            wallet_post(c, w, booking, opid, -amount, "PAYMENT", cash_id, at)
            kind = "PAYMENT"
        elif amount < 0:
            cash_id = ins(
                c,
                "refunds",
                booking_id=bid,
                operation_id=opid,
                owner_id=h["owner_id"],
                cinema_id=h["cinema_id"],
                wallet_id=w["id"],
                reason="RESCHEDULE_DIFFERENCE",
                amount_minor=-amount,
                status="SUCCEEDED",
                attempt_count=1,
                created_at=at,
                settled_at=at,
            )
            wallet_post(c, w, booking, opid, -amount, "REFUND", cash_id, at)
            kind = "REFUND"
        settlement(
            c,
            booking,
            opid,
            q["ticket_delta_minor"],
            q["current_fee_minor"],
            kind,
            cash_id,
            at,
        )
        return result

    return transaction(work)


def expire_holds():
    with db().connect() as c:
        ids = [
            r["id"]
            for r in rows(
                c,
                "SELECT id FROM seat_holds WHERE status='ACTIVE' AND expires_at<=:n ORDER BY expires_at LIMIT 500",
                n=now(),
            )
        ]
    for hid in ids:
        transaction(lambda c: scope(c, hold_ids=[hid]))
    return {"processed": len(ids)}
