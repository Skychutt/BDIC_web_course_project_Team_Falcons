"""Branch counter sales authorized by an emailed, single-transaction code."""
import hmac
import json
import re
import secrets
from datetime import timedelta
from importlib.resources import files

from flask import Blueprint, current_app, g

from .mail import deliver
from . import booking
from .api import body, logged, output
from .core import (Problem, branch, db, digest, execute, get, in_ids, ins, integer,
                   new_id, now, one, require, role, rows, scope, string, transaction, upd)

counter = Blueprint("counter", __name__, url_prefix="/api/counter")


def initialize_counter(engine):
    sql = files("cinema").joinpath("sql/007_counter_email.sql").read_text(encoding="utf-8")
    with engine.begin() as c:
        c.exec_driver_sql(sql.strip().rstrip(";"))


def send_email(address, message):
    deliver(address, "Falcons Cinema · 柜台交易验证码", message)


def code_hash(sale_id, code):
    return hmac.digest(current_app.secret_key.encode(), f"counter:{sale_id}:{code}".encode(), "sha256").hex()


@counter.get("/screenings")
@logged
def screenings():
    role(g.actor, "STAFF")
    with db().connect() as c:
        return output(rows(c, """SELECT s.id,f.title AS film_title,sc.name AS screen_name,s.starts_at
            FROM screenings s JOIN films f ON f.id=s.film_id JOIN cinemas ci ON ci.id=s.cinema_id
            JOIN screens sc ON sc.id=s.screen_id WHERE s.cinema_id=:cid AND ci.is_active=1
            AND s.status='PUBLISHED' AND s.starts_at>:at AND f.archived=0 ORDER BY s.starts_at,s.id""",
            cid=g.actor["staff_cinema_id"], at=now()))


def sale_quote(c, actor, sale, tickets):
    sid, uid, source = sale["screening_id"], sale["owner_id"], sale["source_booking_id"]
    screening = get(c, "screenings", sid)
    branch(actor, screening["cinema_id"], c=c)
    booking.salable(c, screening)
    ids = in_ids(t["seat_id"] for t in tickets)
    seats = rows(c, f"""SELECT s.id,s.row_no,s.seat_no,a.id AS allocation FROM seats s
        LEFT JOIN seat_allocations a ON a.seat_id=s.id AND a.screening_id=:sid
        WHERE s.layout_id=:layout AND s.id IN ({ids}) ORDER BY s.row_no,s.seat_no""",
        sid=sid, layout=screening["layout_id"])
    require(len(seats) == len(tickets), "SEAT_LAYOUT", "Choose seats from this screening")
    require(all(s["allocation"] is None for s in seats), "SEAT_UNAVAILABLE", "Seats are no longer available", 409)
    h = dict(id=None, owner_id=uid, screening_id=sid, cinema_id=screening["cinema_id"],
             layout_id=screening["layout_id"], film_id=screening["film_id"],
             source_booking_id=source, expires_at=sale["expires_at"])
    q = booking.price_selection(c, h, tickets, sale["coupon_id"], lock_coupon=True)
    return h, q, seats


@counter.post("/codes")
@logged
def request_code():
    actor = g.actor
    role(actor, "STAFF")
    data = body()
    return issue_code(actor, data)


@counter.post("/sales/<int:sale_id>/resend")
@logged
def resend(sale_id):
    role(g.actor, "STAFF")
    with db().connect() as c:
        old = get(c, "counter_email_sales", sale_id)
        require(old["staff_id"] == g.actor["id"], "FORBIDDEN", "This sale belongs to another cashier", 403)
        email = get(c, "users", old["owner_id"])["email_normalized"]
    return issue_code(g.actor, dict(email=email, screening_id=old["screening_id"],
        source_booking_id=old["source_booking_id"], tickets=json.loads(old["tickets"])), previous=old)


def issue_code(actor, data, previous=None):
    email = string(data.get("email"), "email", 254).casefold()
    tickets = data.get("tickets")
    require(isinstance(tickets, list) and all(isinstance(t, dict) for t in tickets),
            "FARE_SELECTION", "Select seats and ticket types")
    sid, _, source = booking.hold_selection(dict(screening_id=data.get("screening_id"),
        seat_ids=[t.get("seat_id") for t in tickets], source_booking_id=data.get("source_booking_id")))
    tickets = sorted((dict(seat_id=integer(t["seat_id"], "seat_id"), fare_type=t.get("fare_type"))
                      for t in tickets), key=lambda t: t["seat_id"])
    sale_id, code = new_id(), f"{secrets.randbelow(1_000_000):06d}"

    def prepare(c):
        screening = get(c, "screenings", sid)
        branch(actor, screening["cinema_id"], c=c)
        customer = one(c, "SELECT id,email_normalized FROM users WHERE email_normalized=:e AND role='CUSTOMER'", e=email)
        require(customer, "CUSTOMER_EMAIL", "Enter a registered customer email address", 404)
        uid = customer["id"]
        if source:
            original = get(c, "bookings", source)
            require(original["owner_id"] == uid and original["cinema_id"] == screening["cinema_id"],
                    "RESCHEDULE_TARGET", "Original booking must belong to this customer and branch", 403)
        scope(c, [sid], [uid, actor["id"]], [source] if source else [])
        if previous:
            old = get(c, "counter_email_sales", previous["id"], lock=True)
            require(old["booking_id"] is None, "BOOKING_STATE", "Tickets already issued", 409)
        at = now()
        recent = one(c, """SELECT COUNT(*) AS n,MAX(created_at) AS last_sent FROM counter_email_sales
            WHERE owner_id=:uid AND created_at>:since""", uid=uid, since=at-timedelta(hours=1))
        require(recent["n"] < 10 and (not recent["last_sent"] or recent["last_sent"] <= at-timedelta(seconds=60)),
                "CODE_RATE_LIMIT", "Please wait before requesting another code", 429)
        coupon = None
        if not source and data.get("use_coupon") is True:
            coupon = one(c, """SELECT id FROM coupons WHERE owner_id=:u AND cinema_id=:c
                AND status='AVAILABLE' ORDER BY issued_at,id LIMIT 1""", u=uid, c=screening["cinema_id"])
        sale = dict(id=sale_id, owner_id=uid, staff_id=actor["id"], screening_id=sid,
                    source_booking_id=source, coupon_id=coupon["id"] if coupon else None,
                    expires_at=min(at+timedelta(minutes=5), screening["starts_at"]))
        if previous:
            sale["coupon_id"] = previous["coupon_id"]
        h, quote, seats = sale_quote(c, actor, sale, tickets)
        execute(c, """UPDATE counter_email_sales SET attempts_left=0
            WHERE owner_id=:u AND booking_id IS NULL AND attempts_left>0 AND expires_at>:at""", u=uid, at=at)
        ins(c, "counter_email_sales", **sale, tickets=tickets, attempts_left=5,
            code_hash=code_hash(sale_id, code), quote_hash=digest(quote), created_at=at)
        labels = "、".join(f'{s["row_no"]}排{s["seat_no"]}座' for s in seats)
        amount = quote["amount_due_minor"]
        action = "退回余额 / Wallet credit" if amount < 0 else "余额扣款 / Wallet charge"
        change_details = ""
        if source:
            old_show = get(c, "screenings", original["screening_id"])
            change_details = (
                f'改签 / Booking change\n原订单 / Original booking: {source}\n'
                f'原场次 / Original screening: {old_show["starts_at"]:%Y-%m-%d %H:%M} (北京时间 / Beijing time)\n'
                f'票价差额（新票减原票） / Fare difference (new minus original): CNY {quote["ticket_delta_minor"]/100:+.2f}\n'
                f'本次改签手续费 / Change fee: ¥{quote["current_fee_minor"]/100:.2f}\n'
                '改签成功后原票失效。Your original tickets become invalid when this change is completed.\n'
                '新场次 / New screening:\n'
            )
        message = (f'{change_details}{get(c, "cinemas", h["cinema_id"])["name"]} · {get(c, "films", h["film_id"])["title"]}\n'
                   f'{get(c, "screens", screening["screen_id"])["name"]} · {screening["starts_at"]:%Y-%m-%d %H:%M} (北京时间)\n'
                   f'座位 / Seats: {labels}\n{action}: ¥{abs(amount)/100:.2f}\n'
                   f'验证码 / Code: {code}\n有效至 / Expires: {sale["expires_at"]:%H:%M:%S} (北京时间)\n'
                   '核对场次、座位和金额后，将验证码交给柜台员工即表示同意本次交易。\n'
                   'Share this code with the cashier only to approve the transaction shown above.')
        return customer["email_normalized"], message, dict(sale_id=sale_id, amount_due_minor=amount,
            expires_at=sale["expires_at"])

    address, message, result = transaction(prepare)
    try:
        send_email(address, message)
    except Exception:
        transaction(lambda c: upd(c, "counter_email_sales", sale_id, attempts_left=0))
        raise
    return output(result, 201)


@counter.post("/sales/<int:sale_id>/confirm")
@logged
def confirm(sale_id):
    actor = g.actor
    role(actor, "STAFF")
    code = body().get("code")
    require(isinstance(code, str) and re.fullmatch(r"[0-9]{6}", code), "CODE_INVALID", "Enter the six-digit email code")

    def purchase(c):
        sale = get(c, "counter_email_sales", sale_id)
        require(sale["staff_id"] == actor["id"], "FORBIDDEN", "This sale belongs to another cashier", 403)
        sid, uid, source = sale["screening_id"], sale["owner_id"], sale["source_booking_id"]
        scope(c, [sid], [uid, actor["id"]], [source] if source else [])
        branch(actor, get(c, "screenings", sid)["cinema_id"], c=c)
        sale = get(c, "counter_email_sales", sale_id, lock=True)
        # A lost success response can be retried without another debit.
        correct = hmac.compare_digest(sale["code_hash"], code_hash(sale_id, code))
        if sale["booking_id"]:
            require(correct, "CODE_EXPIRED", "This sale is already complete", 409)
            booking_record = get(c, "bookings", sale["booking_id"])
            return dict(booking_id=booking_record["id"], status=booking_record["status"])
        require(sale["expires_at"] > now() and sale["attempts_left"] > 0,
                "CODE_EXPIRED", "Code expired or replaced. Request a new code", 409)
        if not correct:
            upd(c, "counter_email_sales", sale_id, attempts_left=sale["attempts_left"]-1)
            return None  # Commit the failed attempt before reporting the error.
        tickets = json.loads(sale["tickets"])
        h, quote, _ = sale_quote(c, actor, sale, tickets)
        require(digest(quote) == sale["quote_hash"], "QUOTE_CHANGED", "Sale details changed. Request a new code", 409)
        receipt = booking.settle_purchase(c, actor, f"counter-email-{sale_id}", {"sale_id": sale_id}, h, quote)
        upd(c, "counter_email_sales", sale_id, booking_id=receipt["booking_id"], attempts_left=0)
        return dict(booking_id=receipt["booking_id"], status=receipt["status"])

    result = transaction(purchase)
    require(result is not None, "CODE_INVALID", "Incorrect verification code", 403)
    return output(result)
