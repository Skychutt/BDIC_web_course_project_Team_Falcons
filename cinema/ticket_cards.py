"""Read-only electronic tickets. A signed reference never grants account access."""

from flask import current_app
from itsdangerous import BadData, URLSafeSerializer
import segno

from .catalog import booking_detail
from .core import Problem, integer, now, one


def signer():
    return URLSafeSerializer(current_app.config["SECRET_KEY"], salt="cinema-ticket-v1")


def booking_from_token(token):
    try:
        if len(token) > 256:
            raise ValueError
        value = signer().loads(token)
        if not isinstance(value, dict) or value.get("v") != 1:
            raise ValueError
        return integer(value.get("booking_id"), "booking_id")
    except (BadData, ValueError, TypeError, Problem):
        raise Problem("TICKET_INVALID", "This ticket link is invalid. Open the ticket from My tickets.", 400) from None


def ticket_card(c, bid, actor, base_url):
    # Reuse the order's ownership / cinema-staff boundary for BOTH routes.
    booking = booking_detail(c, bid, actor)
    details = one(c, """SELECT f.title AS film_title,s.duration_minutes_snapshot AS duration_minutes,
        c.name AS cinema_name,c.address AS cinema_address,sc.name AS screen_name,
        sc.screen_type,s.starts_at,s.ends_at,s.status AS screening_status,
        u.display_name AS holder_name
        FROM bookings b JOIN films f ON f.id=b.film_id
        JOIN screenings s ON s.id=b.screening_id JOIN screens sc ON sc.id=s.screen_id
        JOIN cinemas c ON c.id=b.cinema_id JOIN users u ON u.id=b.owner_id
        WHERE b.id=:bid""", bid=bid)
    at = now()
    state = booking["status"]
    if details["screening_status"] == "CANCELLED" and state == "CONFIRMED":
        state = "CINEMA_CANCELLED"
    if state == "CONFIRMED":
        if at >= details["ends_at"]:
            state = "ENDED"
        elif at >= details["starts_at"]:
            state = "STARTED"
    token = signer().dumps({"v": 1, "booking_id": str(bid)})
    path = "/#/ticket/" + token
    # Standard QR (not Micro QR) for compatibility with phone cameras.
    qr = segno.make(base_url.rstrip("/") + path, error="m", micro=False)
    return {
        "booking_id": bid, "film_id": booking["film_id"], **details,
        "status": state, "checked_at": at,
        "net_ticket_minor": booking["net_ticket_minor"],
        "seats": [{"ticket_id": t["id"], "row_no": t["row_no"], "seat_no": t["seat_no"],
                   "fare_type": t["fare_type"]} for t in booking["tickets"]],
        "ticket_path": path,
        "qr_matrix": [list(row) for row in qr.matrix],
    }
