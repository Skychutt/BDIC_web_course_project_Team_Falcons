"""Customer-scoped read services. No mutation or signed checkout token is exposed."""
from collections import Counter
from . import booking, catalog
from .core import db, get, now, owner, role, rows, require, Problem
from .frontend_api import booking_page


def orders(actor, status=None):
    role(actor, "CUSTOMER")
    where, params = "b.owner_id=:owner", {"owner": actor["id"]}
    if status:
        require(status in ("CONFIRMED", "RESCHEDULED", "CINEMA_CANCELLED"), "VALIDATION", "Invalid status")
        where += " AND b.status=:status"
        params["status"] = status
    with db().connect() as c:
        data = booking_page(c, where, params, 1, 3)
        values = []
        for b in data["items"]:
            detail = catalog.booking_detail(c, b["id"], actor)
            values.append({**{k: b[k] for k in ("id", "film_title", "cinema_name", "screening_id", "status", "starts_at", "ticket_count")},
                "seats": [f'{t["row_no"]}-{t["seat_no"]}' for t in detail["tickets"]]})
        return values


def coupons(actor, screening_id=None):
    role(actor, "CUSTOMER")
    with db().connect() as c:
        screening = get(c, "screenings", screening_id) if screening_id else None
        values = rows(c, """SELECT cp.id,cp.cinema_id,cp.status,cp.price_factor_bps,c.name AS cinema_name
            FROM coupons cp JOIN cinemas c ON c.id=cp.cinema_id
            WHERE cp.owner_id=:uid ORDER BY cp.issued_at DESC,cp.id DESC LIMIT 3""", uid=actor["id"])
        for cp in values:
            cp["applicable"] = cp["status"] == "AVAILABLE" and (screening is None or cp["cinema_id"] == screening["cinema_id"])
            cp["reason"] = "available" if cp["applicable"] else "used" if cp["status"] != "AVAILABLE" else "different_cinema"
            cp["scope_checked"] = screening is not None
        return values


def reschedule(actor, bid):
    role(actor, "CUSTOMER")
    with db().connect() as c:
        source = get(c, "bookings", bid)
        owner(actor, source)
        try:
            require(source["status"] == "CONFIRMED", "BOOKING_STATE", "Original booking is not active", 409)
            rate = booking.fee_rate(get(c, "screenings", source["screening_id"])["starts_at"], now())
        except Problem as exc:
            return {"order_id": bid, "eligible": False, "reason": exc.code}
        fares = Counter(t["fare_type"] for t in rows(c, "SELECT fare_type FROM tickets WHERE booking_id=:b", b=bid))
        return dict(order_id=bid, eligible=True, fee_rate_bps=rate,
                    fee_minor=booking.rounded(source["net_ticket_minor"], rate),
                    film_id=source["film_id"], cinema_id=source["cinema_id"], screening_id=source["screening_id"],
                    party_size=sum(fares.values()), fare_mix=dict(fares), same_cinema=True, same_film=True)


def preview(actor, sid, regular_count, student_count, coupon_id=None, source_id=None, zone=None):
    role(actor, "CUSTOMER")
    with db().connect() as c:
        s = get(c, "screenings", sid)
        booking.salable(c, s)
        context = dict(id=None, owner_id=actor["id"], cinema_id=s["cinema_id"], film_id=s["film_id"],
                       screening_id=sid, source_booking_id=source_id, expires_at=None)
        if source_id:
            source = get(c, "bookings", source_id)
            owner(actor, source)
            booking.source_ok(c, context, source)
            mix = Counter(t["fare_type"] for t in rows(c, "SELECT fare_type FROM tickets WHERE booking_id=:b", b=source_id))
            regular_count, student_count = mix["STANDARD"], mix["STUDENT"]
        require(regular_count is not None and student_count is not None, "FARE_SELECTION", "Confirm regular and student ticket counts")
        count = regular_count + student_count
        require(1 <= count <= 12, "PARTY_SIZE", "Choose 1 to 12 tickets")
        available = catalog.available_seats(c, s)
        require(len(available) >= count, "SEAT_UNAVAILABLE", "Not enough seats remain", 409)
        layout = get(c, "layouts", s["layout_id"])
        suggestion = catalog.choose_seats(available, count, layout["row_count"], zone)
        choices = [dict(seat_id=seat, fare_type="STANDARD" if i < regular_count else "STUDENT")
                   for i, seat in enumerate(suggestion["seat_ids"])]
        value = booking.price_selection(c, context, choices, coupon_id)
        keys = ("screening_id", "gross_ticket_minor", "price_factor_bps", "net_ticket_minor", "current_fee_minor", "ticket_delta_minor", "amount_due_minor")
        return {**{k: value[k] for k in keys}, "regular_count": regular_count, "student_count": student_count,
                "reserved": False, "preview_only": True, "coupon_applied": coupon_id is not None,
                "checked_at": now(), "source_order_id": source_id}
