"""Read models for the browser; all money mutations remain in booking services."""

from collections import defaultdict
from datetime import timedelta

from flask import Blueprint, g, request

from . import auth, booking, catalog
from .ratings import attach_ratings
from .api import body, logged, output
from .core import (
    branch, db, digest, get, in_ids, integer, now, one, require, role, rows, scope,
    transaction,
)

ui_api = Blueprint("ui_api", __name__, url_prefix="/api")


def pagination():
    return (
        integer(request.args.get("page", 1), "page", 1, 10000),
        integer(request.args.get("page_size", 20), "page_size", 1, 100),
    )


def film_metadata(c, films):
    """Attach metadata in bounded queries rather than one query per film."""
    ids = in_ids(f["id"] for f in films)
    genres = defaultdict(list)
    for item in rows(
        c,
        f"""SELECT fg.film_id,g.id,g.name FROM film_genres fg
        JOIN genres g ON g.id=fg.genre_id WHERE fg.film_id IN ({ids}) ORDER BY g.name""",
    ):
        genres[item.pop("film_id")].append(item)
    for film in films:
        film["genres"] = genres[film["id"]]
    return attach_ratings(c, films)


@ui_api.get("/ui/bootstrap")
def bootstrap():
    with db().connect() as c:
        actor = g.actor
        admin = bool(actor and actor["role"] == "PLATFORM_ADMIN")
        cinema_where = "" if admin else " WHERE c.is_active=1"
        cinemas = rows(
            c,
            """SELECT c.id,c.district_id,c.name,c.brand,c.address,c.latitude,c.longitude,
            c.coordinate_system,c.is_active,d.name AS district_name FROM cinemas c
            JOIN districts d ON d.id=c.district_id""" + cinema_where + " ORDER BY c.name,c.id",
        )
        user = None
        if actor:
            user = auth.public_user(actor)
            user["is_manager"] = False
            user["owncinema_label"] = None
            if actor["role"] == "STAFF":
                own = get(c, "cinemas", actor["staff_cinema_id"])
                user["is_manager"] = own["manager_user_id"] == actor["id"]
                user["owncinema_label"] = own["name"]
        at = now()
        end = (at + timedelta(days=14)).replace(hour=0, minute=0, second=0, microsecond=0)
        dates = rows(
            c,
            """SELECT DISTINCT DATE(s.starts_at) AS date FROM screenings s
            JOIN cinemas c ON c.id=s.cinema_id WHERE s.status='PUBLISHED'
            AND c.is_active=1 AND s.starts_at>:at AND s.starts_at<:end ORDER BY date""",
            at=at, end=end,
        )
        return output({
            "districts": rows(c, "SELECT id,admin_code,name FROM districts ORDER BY admin_code"),
            "genres": rows(c, "SELECT id,name FROM genres ORDER BY name"),
            "cinemas": cinemas,
            "films": film_metadata(c, rows(c, "SELECT * FROM films WHERE archived=0 ORDER BY title,id")),
            "user": user,
            "available_dates": [item["date"] for item in dates],
            "server_time": at,
        })


BOOKING_JOIN = """FROM bookings b JOIN films f ON f.id=b.film_id
JOIN cinemas c ON c.id=b.cinema_id JOIN screenings s ON s.id=b.screening_id
JOIN screens sc ON sc.id=s.screen_id"""
BOOKING_SELECT = """SELECT b.*,f.title AS film_title,c.name AS cinema_name,
sc.name AS screen_name,sc.screen_type,s.starts_at,s.ends_at,
(SELECT COUNT(*) FROM tickets t WHERE t.booking_id=b.id) AS ticket_count """


def booking_page(c, where, params, page, size):
    total = one(c, "SELECT COUNT(*) AS n " + BOOKING_JOIN + " WHERE " + where, **params)["n"]
    items = rows(
        c, BOOKING_SELECT + BOOKING_JOIN + " WHERE " + where
        + " ORDER BY b.created_at DESC,b.id DESC LIMIT :limit OFFSET :offset",
        **params, limit=size, offset=(page - 1) * size,
    )
    return {"items": items, "page": page, "page_size": size, "total": total}


@ui_api.get("/ui/bookings")
@logged
def customer_bookings():
    role(g.actor, "CUSTOMER")
    page, size = pagination()
    status = request.args.get("status")
    require(status in (None, "", "CONFIRMED", "HISTORY"), "VALIDATION", "Unknown booking status filter")
    where = "b.owner_id=:owner"
    if status == "CONFIRMED":
        where += " AND b.status='CONFIRMED'"
    elif status == "HISTORY":
        where += " AND b.status IN ('RESCHEDULED','CINEMA_CANCELLED')"
    with db().connect() as c:
        return output(booking_page(c, where, {"owner": g.actor["id"]}, page, size))


@ui_api.get("/ui/bookings/<int:bid>")
@logged
def booking_detail(bid):
    with db().connect() as c:
        result = catalog.booking_detail(c, bid, g.actor)
        labels = one(c, BOOKING_SELECT + BOOKING_JOIN + " WHERE b.id=:bid", bid=bid)
        for field in ("film_title", "cinema_name", "screen_name", "screen_type", "starts_at", "ends_at", "ticket_count"):
            result[field] = labels[field]
        for ticket in result["tickets"]:
            ticket["seat_label"] = f'{ticket["row_no"]} 排 {ticket["seat_no"]} 座'
        return output(result)


@ui_api.get("/staff/bookings")
@logged
def staff_bookings():
    role(g.actor, "STAFF")
    page, size = pagination()
    q = request.args.get("q", "").strip()
    require(len(q) <= 100, "VALIDATION", "Search text must be at most 100 characters")
    params = {"cinema": g.actor["staff_cinema_id"]}
    where = "b.cinema_id=:cinema"
    if q:
        if q.isascii() and q.isdigit():
            params["bid"] = integer(q, "q")
            where += " AND b.id=:bid"
        else:
            require(len(q) >= 2, "VALIDATION", "Film title search needs at least two characters")
            # Treat %, _ and ! as literal input, never as caller-controlled wildcards.
            params["title"] = "%" + q.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
            where += " AND f.title LIKE :title ESCAPE '!'"
    with db().connect() as c:
        return output(booking_page(c, where, params, page, size))


@ui_api.get("/staff/refunds")
@logged
def staff_refunds():
    role(g.actor, "STAFF")
    page, size = pagination()
    with db().connect() as c:
        params = {"cinema": g.actor["staff_cinema_id"]}
        total = one(c, "SELECT COUNT(*) AS n FROM refunds WHERE cinema_id=:cinema", **params)["n"]
        items = rows(
            c,
            """SELECT r.id,r.booking_id,r.cinema_id,r.reason,r.amount_minor,r.status,
            r.attempt_count,r.created_at,r.settled_at,f.title AS film_title,
            c.name AS cinema_name,sc.name AS screen_name,sc.screen_type,s.starts_at
            FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN films f ON f.id=b.film_id
            JOIN cinemas c ON c.id=r.cinema_id JOIN screenings s ON s.id=b.screening_id
            JOIN screens sc ON sc.id=s.screen_id WHERE r.cinema_id=:cinema
            ORDER BY r.created_at DESC,r.id DESC LIMIT :limit OFFSET :offset""",
            **params, limit=size, offset=(page - 1) * size,
        )
        return output({"items": items, "page": page, "page_size": size, "total": total})


@ui_api.get("/admin/films")
@logged
def admin_films():
    role(g.actor, "PLATFORM_ADMIN")
    page, size = pagination()
    with db().connect() as c:
        total = one(c, "SELECT COUNT(*) AS n FROM films")["n"]
        films = rows(c, "SELECT * FROM films ORDER BY title,id LIMIT :limit OFFSET :offset", limit=size, offset=(page - 1) * size)
        return output({"items": film_metadata(c, films), "page": page, "page_size": size, "total": total})


@ui_api.post("/counter/preview")
@logged
def counter_preview():
    """Revalidate the customer-approved quote for its designated counter operator."""
    role(g.actor, "STAFF")
    data = body()
    token = booking.decode(data.get("quote_token"), "quote")
    consent = booking.decode(data.get("consent_token"), "counter")
    hid = integer(token["hold_id"], "hold_id")

    def work(c):
        initial = get(c, "seat_holds", hid)
        branch(g.actor, initial["cinema_id"], c=c)
        expected = dict(hold_id=str(hid), owner_id=str(initial["owner_id"]), staff_id=str(g.actor["id"]), quote_hash=token["quote_hash"])
        require(consent == expected, "CONSENT", "Customer approval must bind this staff member, hold, and quote", 403)
        scope(c, hold_ids=[hid], customer_ids=[initial["owner_id"], g.actor["id"]])
        h = booking.active_hold(c, hid)
        branch(g.actor, h["cinema_id"], c=c)
        coupon = integer(token["coupon_id"], "coupon_id") if token["coupon_id"] else None
        quote = booking.price(c, h, token["tickets"], coupon)
        require(digest(quote) == token["quote_hash"] == h["quote_hash"], "QUOTE_CHANGED", "Price, fee or selection changed; request and confirm a new quote", 409)
        labels = one(c, """SELECT f.title AS film_title,c.name AS cinema_name,
            sc.name AS screen_name,sc.screen_type,s.starts_at FROM screenings s
            JOIN films f ON f.id=s.film_id JOIN cinemas c ON c.id=s.cinema_id
            JOIN screens sc ON sc.id=s.screen_id WHERE s.id=:sid""", sid=h["screening_id"])
        seat_labels = {seat["id"]: seat for seat in rows(c, f"SELECT id,row_no,seat_no FROM seats WHERE id IN ({in_ids(t['seat_id'] for t in quote['tickets'])})")}
        for ticket in quote["tickets"]:
            seat = seat_labels[ticket["seat_id"]]
            ticket.update(row_no=seat["row_no"], seat_no=seat["seat_no"], seat_label=f'{seat["row_no"]} 排 {seat["seat_no"]} 座')
        # No account identity, balance or raw signed token needs to be echoed to the operator.
        quote.pop("owner_id", None)
        return dict(quote, **labels)

    return output(transaction(work))
