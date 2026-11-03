import secrets
from functools import wraps
from flask import Blueprint, g, jsonify, request, session
from .core import *
from . import auth, booking, catalog, management, platform

api = Blueprint("api", __name__, url_prefix="/api")


def body():
    data = request.get_json(silent=True)
    require(isinstance(data, dict), "VALIDATION", "JSON object body is required")
    return data


def key():
    return request_key(request.headers.get("Idempotency-Key"))


def output(value, status=200):
    return jsonify(data=wire(value)), status


def logged(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        require(g.actor is not None, "LOGIN_REQUIRED", "Sign in to continue", 401)
        return fn(*args, **kwargs)

    return wrapped


@api.get("/health")
def health():
    with db().connect() as c:
        execute(c, "SELECT 1")
    return output(
        {
            "status": "ok",
            "timezone": "Asia/Shanghai",
            "currency": "CNY",
            "money_unit": "fen",
        }
    )


@api.get("/auth/csrf")
def csrf():
    session.setdefault("csrf", secrets.token_urlsafe(32))
    return output({"csrf_token": session["csrf"]})


@api.post("/auth/register")
def register():
    return output(auth.register(body(), key()), 201)


@api.post("/auth/login")
def login():
    user = auth.login(body())
    session.clear()
    session["user_id"] = str(user["id"])
    session["csrf"] = secrets.token_urlsafe(32)
    session.permanent = True
    return output({"user": user, "csrf_token": session["csrf"]})


@api.post("/auth/logout")
@logged
def logout():
    session.clear()
    return output({"logged_out": True})


@api.get("/auth/me")
@logged
def me():
    return output(auth.public_user(g.actor))


@api.get("/districts")
def districts():
    with db().connect() as c:
        return output(rows(c, "SELECT * FROM districts ORDER BY admin_code"))


@api.get("/genres")
def genres():
    with db().connect() as c:
        return output(rows(c, "SELECT * FROM genres ORDER BY name"))


@api.get("/cinemas")
def cinemas():
    with db().connect() as c:
        did = (
            integer(request.args["district_id"], "district_id")
            if request.args.get("district_id")
            else None
        )
        return output(
            rows(
                c,
                "SELECT id,district_id,name,brand,address,latitude,longitude,coordinate_system FROM cinemas WHERE is_active=1 AND (:d IS NULL OR district_id=:d) ORDER BY name",
                d=did,
            )
        )


@api.get("/films")
def films():
    page = integer(request.args.get("page", 1), "page", 1, 10000)
    limit = integer(request.args.get("page_size", 20), "page_size", 1, 100)
    title = request.args.get("q", "")
    require(len(title) <= 200, "VALIDATION", "Search text too long")
    with db().connect() as c:
        fs = rows(
            c,
            "SELECT id,title,duration_minutes FROM films WHERE archived=0 AND title LIKE :q ORDER BY title,id LIMIT :n OFFSET :o",
            q="%" + title + "%",
            n=limit,
            o=(page - 1) * limit,
        )
        total = one(
            c,
            "SELECT COUNT(*) AS n FROM films WHERE archived=0 AND title LIKE :q",
            q="%" + title + "%",
        )["n"]
        return output({"items": fs, "page": page, "page_size": limit, "total": total})


@api.get("/films/<int:fid>")
def film(fid):
    with db().connect() as c:
        return output(catalog.film_detail(c, fid))


@api.put("/films/<int:fid>/rating")
@logged
def rating(fid):
    return output(catalog.rate(g.actor, fid, body()))


@api.get("/screenings")
def screenings():
    with db().connect() as c:
        return output(catalog.search(c, request.args.to_dict()))


@api.get("/screenings/<int:sid>/seats")
def seatmap(sid):
    with db().connect() as c:
        return output(catalog.seatmap(c, sid, g.actor))


@api.post("/assistant/recommendations")
def recommend():
    data = body()
    require(
        isinstance(data.get("filters"), dict),
        "VALIDATION",
        "Provide structured filters",
    )
    with db().connect() as c:
        result = catalog.search(c, data["filters"])
        return output(
            dict(
                mode="RULE_BASED",
                ai_connected=bool(current_app.config.get("AI_PROVIDER") == "deepseek" and current_app.config.get("DEEPSEEK_API_KEY")),
                message="Structured recommendations use current cinema data and deterministic seat ranking. Natural-language chat is available at /api/assistant/chat when the assistant is enabled.",
                **result,
            )
        )


@api.post("/counter-hold-consents")
@logged
def hold_consent():
    return output(booking.counter_hold_consent(g.actor, body()))


@api.post("/holds")
@logged
def hold():
    return output(booking.create_hold(g.actor, body(), key()), 201)


@api.delete("/holds/<int:hid>")
@logged
def release(hid):
    return output(booking.release_hold(g.actor, hid))


@api.post("/holds/<int:hid>/quote")
@logged
def quote(hid):
    return output(booking.quote(g.actor, hid, body()))


@api.post("/holds/<int:hid>/counter-consent")
@logged
def consent(hid):
    return output(booking.counter_consent(g.actor, hid, body()))


@api.post("/bookings")
@logged
def purchase():
    return output(booking.checkout(g.actor, body(), key()), 201)


@api.get("/bookings/<int:bid>")
@logged
def booking_detail(bid):
    with db().connect() as c:
        return output(catalog.booking_detail(c, bid, g.actor))


@api.get("/me/<resource>")
@logged
def personal(resource):
    role(g.actor, "CUSTOMER")
    uid = g.actor["id"]
    limit = integer(request.args.get("page_size", 20), "page_size", 1, 100)
    page = integer(request.args.get("page", 1), "page", 1, 10000)
    tables = {
        "bookings": "bookings",
        "coupons": "coupons",
        "notices": "notices",
        "wallet-entries": "wallet_entries",
        "refunds": "refunds",
        "holds": "seat_holds",
    }
    with db().connect() as c:
        if resource == "wallet":
            return output(
                one(
                    c,
                    "SELECT id,balance_minor,updated_at FROM wallets WHERE customer_id=:u",
                    u=uid,
                )
            )
        require(resource in tables, "NOT_FOUND", "Unknown customer resource", 404)
        table = tables[resource]
        # Random IDs do not encode creation order. Show newest records first.
        timestamp = "issued_at" if resource == "coupons" else "created_at"
        items = rows(
            c,
            f"SELECT * FROM {table} WHERE owner_id=:u ORDER BY {timestamp} DESC,id DESC LIMIT :n OFFSET :o",
            u=uid,
            n=limit,
            o=(page - 1) * limit,
        )
        total = one(c, f"SELECT COUNT(*) AS n FROM {table} WHERE owner_id=:u", u=uid)[
            "n"
        ]
        if resource == "holds":
            for h in items:
                h.pop("quote_hash", None)
                h.pop("active_customer_id", None)
                h["seat_ids"] = [
                    s["seat_id"]
                    for s in rows(
                        c,
                        "SELECT seat_id FROM seat_allocations WHERE hold_id=:h ORDER BY seat_id",
                        h=h["id"],
                    )
                ]
                h["effective_status"] = (
                    "EXPIRED"
                    if h["status"] == "ACTIVE" and h["expires_at"] <= now()
                    else h["status"]
                )
        return output(
            {"items": items, "page": page, "page_size": limit, "total": total}
        )


@api.put("/notices/<int:nid>/read")
@logged
def read_notice(nid):
    def work(c):
        n = get(c, "notices", nid, True)
        owner(g.actor, n)
        if n["read_at"] is None:
            upd(c, "notices", nid, read_at=now())
        return {"notice_id": nid, "read": True}

    return output(transaction(work))


@api.get("/staff/screens")
@logged
def staff_screens():
    role(g.actor, "STAFF")
    with db().connect() as c:
        result = rows(
            c,
            "SELECT * FROM screens WHERE cinema_id=:cid ORDER BY name",
            cid=g.actor["staff_cinema_id"],
        )
        for s in result:
            s["layouts"] = rows(
                c,
                "SELECT * FROM layouts WHERE screen_id=:s ORDER BY version_no",
                s=s["id"],
            )
        return output(result)


@api.get("/staff/layouts/<int:lid>")
@logged
def staff_layout(lid):
    with db().connect() as c:
        l = get(c, "layouts", lid)
        s = get(c, "screens", l["screen_id"])
        branch(g.actor, s["cinema_id"])
        l["seats"] = rows(
            c, "SELECT * FROM seats WHERE layout_id=:l ORDER BY row_no,seat_no", l=lid
        )
        return output(l)


@api.get("/staff/screenings")
@logged
def staff_programme():
    role(g.actor, "STAFF")
    page = integer(request.args.get("page", 1), "page", 1, 10000)
    with db().connect() as c:
        result = rows(
            c,
            "SELECT * FROM screenings WHERE cinema_id=:cid ORDER BY starts_at DESC,id DESC LIMIT 100 OFFSET :o",
            cid=g.actor["staff_cinema_id"],
            o=(page - 1) * 100,
        )
        return output({"items": result, "page": page, "page_size": 100})


@api.post("/staff/screens")
@logged
def new_screen():
    return output(management.create_screen(g.actor, body()), 201)


@api.post("/staff/screens/<int:sid>/layouts")
@logged
def new_layout(sid):
    return output(management.create_layout(g.actor, sid, body()), 201)


@api.post("/staff/screenings")
@logged
def publish():
    return output(management.publish(g.actor, body()), 201)


@api.put("/staff/screenings/<int:sid>/fares")
@logged
def fares(sid):
    return output(management.update_fares(g.actor, sid, body()))


@api.post("/staff/screenings/<int:sid>/cancellation-preview")
@logged
def preview(sid):
    return output(management.cancel_preview(g.actor, sid, body()))


@api.post("/staff/screenings/<int:sid>/cancel")
@logged
def cancel(sid):
    return output(management.cancel_confirm(g.actor, sid, body(), key()))


@api.post("/staff/refunds/<int:rid>/retry")
@logged
def refund(rid):
    return output(management.process_refund(rid, g.actor))


@api.get("/cinemas/<int:cid>/turnover")
@logged
def turnover(cid):
    return output(management.turnover(g.actor, cid, request.args))


@api.post("/admin/districts")
@logged
def new_district():
    return output(platform.create_district(g.actor, body()), 201)


@api.post("/admin/cinemas")
@logged
def new_cinema():
    return output(platform.create_cinema(g.actor, body()), 201)


@api.post("/admin/staff")
@logged
def new_staff():
    return output(platform.create_staff(g.actor, body()), 201)


@api.put("/admin/cinemas/<int:cid>/manager")
@logged
def manager(cid):
    return output(platform.manager(g.actor, cid, body()))


@api.put("/admin/staff/<int:uid>/cinema")
@logged
def transfer(uid):
    return output(platform.transfer_staff(g.actor, uid, body()))


@api.post("/admin/films")
@logged
def new_film():
    return output(platform.save_film(g.actor, body()), 201)


@api.put("/admin/films/<int:fid>")
@logged
def update_film(fid):
    return output(platform.save_film(g.actor, body(), fid))


@api.post("/admin/genres")
@logged
def new_genre():
    role(g.actor, "PLATFORM_ADMIN")
    name = string(body().get("name"), "name", 60)
    return output(transaction(lambda c: {"genre_id": ins(c, "genres", name=name)}), 201)


@api.get("/admin/cinemas")
@logged
def admin_cinemas():
    role(g.actor, "PLATFORM_ADMIN")
    with db().connect() as c:
        return output(rows(c, "SELECT * FROM cinemas ORDER BY id"))


@api.get("/admin/staff")
@logged
def admin_staff():
    role(g.actor, "PLATFORM_ADMIN")
    with db().connect() as c:
        return output(
            rows(
                c,
                "SELECT id,display_name,email_normalized,staff_cinema_id FROM users WHERE role='STAFF' ORDER BY staff_cinema_id,id",
            )
        )


@api.put("/admin/cinemas/<int:cid>")
@logged
def edit_cinema(cid):
    return output(platform.edit_cinema(g.actor, cid, body()))


@api.put("/admin/districts/<int:did>")
@logged
def edit_district(did):
    return output(platform.edit_district(g.actor, did, body()))


@api.put("/admin/genres/<int:gid>")
@logged
def edit_genre(gid):
    role(g.actor, "PLATFORM_ADMIN")
    name = string(body().get("name"), "name", 60)

    def work(c):
        get(c, "genres", gid, True)
        upd(c, "genres", gid, name=name)
        return get(c, "genres", gid)

    return output(transaction(work))
