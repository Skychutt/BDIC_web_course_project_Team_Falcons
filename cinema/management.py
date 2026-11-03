"""Branch-scoped programme management, disruption workflow, and settlements."""

from datetime import timedelta
from .core import *
from .booking import decode, signer, settlement, wallet_post


def valid_fares(value):
    require(
        isinstance(value, dict) and set(value) == {"STANDARD", "STUDENT"},
        "VALIDATION",
        "fares requires STANDARD and STUDENT prices in fen",
    )
    return {k: integer(v, k, 1, 10000000) for k, v in value.items()}


def validate_programme(c, actor, data, excluded=None):
    layout = get(c, "layouts", integer(data.get("layout_id"), "layout_id"))
    screen = get(c, "screens", layout["screen_id"])
    branch(actor, screen["cinema_id"], c=c)
    require(
        get(c, "cinemas", screen["cinema_id"])["is_active"],
        "CINEMA_INACTIVE",
        "Activate cinema before publishing",
        409,
    )
    film = get(c, "films", integer(data.get("film_id"), "film_id"), True)
    require(
        not film["archived"],
        "FILM_ARCHIVED",
        "Archived films cannot receive new screenings",
        409,
    )
    start = moment(data.get("starts_at"))
    require(start > now(), "VALIDATION", "Screening must start in the future")
    end = start + timedelta(minutes=film["duration_minutes"])
    occupied = end + timedelta(minutes=15)
    overlapping = one(
        c,
        "SELECT id FROM screenings WHERE screen_id=:s AND status='PUBLISHED' AND starts_at<:end AND occupied_until>:start AND (:excluded IS NULL OR id<>:excluded) LIMIT 1",
        s=screen["id"],
        end=occupied,
        start=start,
        excluded=excluded,
    )
    require(
        not overlapping,
        "SCHEDULE_OVERLAP",
        "Physical screen is occupied, including the 15-minute turnaround",
        409,
    )
    return dict(
        cinema_id=screen["cinema_id"],
        film_id=film["id"],
        screen_id=screen["id"],
        layout_id=layout["id"],
        starts_at=start,
        ends_at=end,
        occupied_until=occupied,
        duration_minutes_snapshot=film["duration_minutes"],
        turnaround_minutes=15,
        status="PUBLISHED",
        revision_no=1,
        created_at=now(),
    ), valid_fares(data.get("fares"))


def insert_programme(c, values, fares):
    sid = ins(c, "screenings", **values)
    for kind, amount in fares.items():
        ins(c, "fares", screening_id=sid, fare_type=kind, price_minor=amount)
    return sid


def publish(actor, data):
    role(actor, "STAFF")

    def work(c):
        layout = get(c, "layouts", integer(data.get("layout_id"), "layout_id"))
        get(c, "screens", layout["screen_id"], True)
        get(c, "users", actor["id"], True)
        values, fares = validate_programme(c, actor, data)
        return get(c, "screenings", insert_programme(c, values, fares))

    return transaction(work)


def update_fares(actor, sid, data):
    fares = valid_fares(data.get("fares"))

    def work(c):
        scope(c, [sid], customer_ids=[actor["id"]])
        s = get(c, "screenings", sid)
        branch(actor, s["cinema_id"], c=c)
        require(
            s["status"] == "PUBLISHED" and s["starts_at"] > now(),
            "SALE_CLOSED",
            "Screening is closed",
            409,
        )
        require(
            integer(data.get("revision_no"), "revision_no") == s["revision_no"],
            "REVISION_CHANGED",
            "Reload the screening",
            409,
        )
        for kind, amount in fares.items():
            execute(
                c,
                "UPDATE fares SET price_minor=:p WHERE screening_id=:s AND fare_type=:k",
                p=amount,
                s=sid,
                k=kind,
            )
        upd(c, "screenings", sid, revision_no=s["revision_no"] + 1)
        return {
            "screening_id": sid,
            "revision_no": s["revision_no"] + 1,
            "fares": fares,
        }

    return transaction(work)


def create_screen(actor, data):
    role(actor, "STAFF")
    kind = data.get("screen_type")
    require(
        kind in ("STANDARD", "IMAX", "DOLBY_CINEMA"),
        "VALIDATION",
        "Invalid screen type",
    )

    def work(c):
        current = get(c, "users", actor["id"], True)
        role(current, "STAFF")
        sid = ins(
            c,
            "screens",
            cinema_id=current["staff_cinema_id"],
            name=string(data.get("name"), "name", 80),
            screen_type=kind,
        )
        return {"screen_id": sid}

    return transaction(work)


def create_layout(actor, screen_id, data):
    count = integer(data.get("row_count"), "row_count", 1, 100)
    direction = data.get("screen_direction")
    require(
        direction in ("TOP", "BOTTOM", "LEFT", "RIGHT"),
        "VALIDATION",
        "Invalid screen direction",
    )
    seats = data.get("seats")
    require(
        isinstance(seats, list) and 1 <= len(seats) <= 5000,
        "VALIDATION",
        "Provide 1..5000 seats",
    )
    normalized = []
    for s in seats:
        require(isinstance(s, dict), "VALIDATION", "Each seat must be an object")
        normalized.append(
            {
                f: integer(s.get(f), f, 0 if f in ("map_x", "map_y") else 1, 10000)
                for f in (
                    "row_no",
                    "seat_no",
                    "aisle_segment",
                    "segment_position",
                    "map_x",
                    "map_y",
                )
            }
        )
    require(
        set(s["row_no"] for s in normalized) == set(range(1, count + 1)),
        "LAYOUT_ROWS",
        "Rows must be contiguous 1..row_count",
    )
    for fields in [
        ("row_no", "seat_no"),
        ("row_no", "aisle_segment", "segment_position"),
        ("map_x", "map_y"),
    ]:
        require(
            len({tuple(s[f] for f in fields) for s in normalized}) == len(seats),
            "LAYOUT_DUPLICATE",
            "Duplicate seat label, segment position or map coordinate",
        )
    segments = {}
    for s in normalized:
        segments.setdefault((s["row_no"], s["aisle_segment"]), []).append(
            s["segment_position"]
        )
    require(
        all(sorted(v) == list(range(1, len(v) + 1)) for v in segments.values()),
        "LAYOUT_SEGMENT",
        "Each aisle segment must have contiguous positions starting at 1",
    )

    def work(c):
        screen = get(c, "screens", screen_id, True)
        get(c, "users", actor["id"], True)
        branch(actor, screen["cinema_id"], c=c)
        version = one(
            c,
            "SELECT COALESCE(MAX(version_no),0)+1 AS n FROM layouts WHERE screen_id=:s",
            s=screen_id,
        )["n"]
        lid = ins(
            c,
            "layouts",
            screen_id=screen_id,
            version_no=version,
            screen_direction=direction,
            row_count=count,
            created_at=now(),
        )
        for seat in normalized:
            ins(c, "seats", layout_id=lid, **seat)
        return {"layout_id": lid, "version_no": version, "seat_count": len(seats)}

    return transaction(work)


def preview_value(c, sid, replacement, reason):
    s = get(c, "screenings", sid)
    require(
        s["status"] == "PUBLISHED" and s["starts_at"] > now(),
        "SCREENING_STATE",
        "Only a future published screening may be cancelled",
        409,
    )
    bs = rows(
        c,
        "SELECT id,owner_id,net_ticket_minor,cumulative_fee_minor FROM bookings WHERE screening_id=:s AND status='CONFIRMED' ORDER BY id",
        s=sid,
    )
    return dict(
        screening_id=sid,
        revision_no=s["revision_no"],
        bookings=bs,
        booking_count=len(bs),
        coupon_count=len(bs),
        refund_total_minor=sum(
            b["net_ticket_minor"] + b["cumulative_fee_minor"] for b in bs
        ),
        replacement=replacement,
        reason=reason,
    )


def cancel_preview(actor, sid, data):
    reason = string(data.get("reason"), "reason", 500)
    replacement = data.get("replacement")
    require(
        replacement is None or isinstance(replacement, dict),
        "VALIDATION",
        "replacement must be an object",
    )

    def work(c):
        s = get(c, "screenings", sid)
        branch(actor, s["cinema_id"], c=c)
        extra = []
        if replacement:
            extra = [
                get(c, "layouts", integer(replacement.get("layout_id"), "layout_id"))[
                    "screen_id"
                ]
            ]
        scope(c, [sid], customer_ids=[actor["id"]], physical_screen_ids=extra)
        branch(actor, s["cinema_id"], c=c)
        if replacement:
            values, _ = validate_programme(c, actor, replacement, excluded=sid)
            require(
                values["cinema_id"] == s["cinema_id"],
                "REPLACEMENT_BRANCH",
                "Replacement must stay in the same cinema",
            )
        value = preview_value(c, sid, replacement, reason)
        value["preview_token"] = signer("cancel").dumps(
            wire(
                dict(
                    screening_id=sid,
                    hash=digest(value),
                    replacement=replacement,
                    reason=reason,
                )
            )
        )
        return value

    return transaction(work)


def cancel_confirm(actor, sid, data, key):
    payload = dict(
        action="CANCEL_SCREENING",
        screening_id=sid,
        preview_token=data.get("preview_token"),
    )

    def work(c):
        previous = replay(c, actor["id"], key, payload)
        if previous:
            return previous
        token = decode(data.get("preview_token"), "cancel", 900)
        require(
            integer(token["screening_id"], "screening_id") == sid,
            "TOKEN",
            "Preview is for another screening",
        )
        s = get(c, "screenings", sid)
        branch(actor, s["cinema_id"], c=c)
        bs = rows(
            c,
            "SELECT id FROM bookings WHERE screening_id=:s AND status='CONFIRMED'",
            s=sid,
        )
        replacement = token["replacement"]
        extra = []
        if replacement:
            extra = [
                get(c, "layouts", integer(replacement.get("layout_id"), "layout_id"))[
                    "screen_id"
                ]
            ]
        scope(
            c,
            [sid],
            customer_ids=[actor["id"]],
            booking_ids=[b["id"] for b in bs],
            physical_screen_ids=extra,
        )
        previous = replay(c, actor["id"], key, payload)
        if previous:
            return previous
        branch(actor, s["cinema_id"], c=c)
        value = preview_value(c, sid, replacement, token["reason"])
        require(
            digest(value) == token["hash"],
            "PREVIEW_CHANGED",
            "Bookings or prices changed; review a fresh cancellation preview",
            409,
        )
        repl_values, repl_fares = (
            validate_programme(c, actor, replacement, excluded=sid)
            if replacement
            else (None, None)
        )
        if replacement:
            require(
                repl_values["cinema_id"] == s["cinema_id"],
                "REPLACEMENT_BRANCH",
                "Replacement must stay in the same cinema",
            )
        upd(
            c,
            "screenings",
            sid,
            status="CANCELLED",
            revision_no=value["revision_no"] + 1,
        )
        replacement_id = (
            insert_programme(c, repl_values, repl_fares) if replacement else None
        )
        result = dict(
            screening_id=sid,
            replacement_screening_id=replacement_id,
            booking_count=value["booking_count"],
            refund_total_minor=value["refund_total_minor"],
            refund_status="PENDING" if value["bookings"] else "NONE",
            coupon_count=value["coupon_count"],
        )
        op = operation(
            c,
            actor,
            key,
            payload,
            "REPLACE_SCREENING" if replacement else "CANCEL_SCREENING",
            result,
            source_screening_id=sid,
            result_screening_id=replacement_id,
            reason=token["reason"],
        )
        ids = [b["id"] for b in value["bookings"]]
        holds = rows(
            c,
            f"SELECT * FROM seat_holds WHERE status='ACTIVE' AND (screening_id=:s OR source_booking_id IN ({in_ids(ids)}))",
            s=sid,
        )
        for h in holds:
            execute(c, "DELETE FROM seat_allocations WHERE hold_id=:h", h=h["id"])
            upd(c, "seat_holds", h["id"], status="CANCELLED")
        execute(c, "DELETE FROM seat_allocations WHERE screening_id=:s", s=sid)
        at = now()
        for b in value["bookings"]:
            upd(c, "bookings", b["id"], status="CINEMA_CANCELLED")
            w = one(c, "SELECT id FROM wallets WHERE customer_id=:u", u=b["owner_id"])
            amount = b["net_ticket_minor"] + b["cumulative_fee_minor"]
            if amount:
                ins(
                    c,
                    "refunds",
                    booking_id=b["id"],
                    operation_id=op,
                    owner_id=b["owner_id"],
                    cinema_id=s["cinema_id"],
                    wallet_id=w["id"],
                    reason="CINEMA_CANCELLATION",
                    amount_minor=amount,
                    status="PENDING",
                    attempt_count=0,
                    created_at=at,
                )
            ins(
                c,
                "coupons",
                owner_id=b["owner_id"],
                cinema_id=s["cinema_id"],
                source_booking_id=b["id"],
                price_factor_bps=5000,
                status="AVAILABLE",
                issued_at=at,
            )
            ins(
                c,
                "notices",
                owner_id=b["owner_id"],
                cinema_id=s["cinema_id"],
                booking_id=b["id"],
                operation_id=op,
                body="Screening cancelled: "
                + token["reason"]
                + ". Refund pending; a same-cinema 50% coupon is available. No automatic rebooking.",
                created_at=at,
            )
        return result

    return transaction(work)


def process_refund(refund_id, actor=None):
    def work(c):
        initial = get(c, "refunds", refund_id)
        if actor:
            branch(actor, initial["cinema_id"], c=c)
        scope(
            c,
            booking_ids=[initial["booking_id"]],
            customer_ids=[actor["id"]] if actor else [],
        )
        if actor:
            branch(actor, initial["cinema_id"], c=c)
        r = get(c, "refunds", refund_id, True)
        if r["status"] == "SUCCEEDED":
            return {"refund_id": r["id"], "status": "SUCCEEDED"}
        require(
            r["reason"] == "CINEMA_CANCELLATION",
            "REFUND_STATE",
            "Only cancellation refunds may be pending",
            409,
        )
        b = get(c, "bookings", r["booking_id"])
        w = get(c, "wallets", r["wallet_id"], True)
        at = now()
        wallet_post(
            c, w, b, r["operation_id"], r["amount_minor"], "REFUND", r["id"], at
        )
        settlement(
            c,
            b,
            r["operation_id"],
            -b["net_ticket_minor"],
            -b["cumulative_fee_minor"],
            "REFUND",
            r["id"],
            at,
        )
        upd(
            c,
            "refunds",
            r["id"],
            status="SUCCEEDED",
            attempt_count=r["attempt_count"] + 1,
            last_error=None,
            settled_at=at,
        )
        return {
            "refund_id": r["id"],
            "status": "SUCCEEDED",
            "amount_minor": r["amount_minor"],
        }

    return transaction(work)


def process_pending_refunds():
    with db().connect() as c:
        pending = rows(
            c,
            "SELECT id FROM refunds WHERE status IN ('PENDING','FAILED') ORDER BY created_at LIMIT 100",
        )
    done = failed = 0
    for r in pending:
        try:
            process_refund(r["id"])
            done += 1
        except Exception:
            current_app.logger.exception("Refund worker failed for %s", r["id"])

            # No partial credit survives. Record failure separately only if still unsettled.
            def record(c):
                execute(
                    c,
                    "UPDATE refunds SET status='FAILED',attempt_count=attempt_count+1,last_error='Processing failed; inspect server logs' WHERE id=:id AND status<>'SUCCEEDED'",
                    id=r["id"],
                )

            transaction(record)
            failed += 1
    return {"succeeded": done, "failed": failed}


def turnover(actor, cinema_id, data):
    def work(c):
        current = get(c, "users", actor["id"])
        cinema = get(c, "cinemas", cinema_id)
        require(
            current["role"] == "PLATFORM_ADMIN"
            or (
                current["role"] == "STAFF"
                and current["staff_cinema_id"] == cinema_id
                and cinema["manager_user_id"] == current["id"]
            ),
            "FORBIDDEN",
            "Only this cinema manager or platform administrator can view turnover",
            403,
        )
        start = moment(data.get("from"), "from")
        end = moment(data.get("to"), "to")
        require(start < end, "VALIDATION", "from must precede to")
        params = dict(cid=cinema_id, start=start, end=end)
        components = rows(
            c,
            "SELECT component,COALESCE(SUM(amount_minor),0) AS amount FROM settlement_entries WHERE cinema_id=:cid AND settled_at>=:start AND settled_at<:end GROUP BY component",
            **params,
        )
        sums = {r["component"]: int(r["amount"]) for r in components}
        pay = one(
            c,
            "SELECT COALESCE(SUM(amount_minor),0) AS n FROM payments WHERE cinema_id=:cid AND settled_at>=:start AND settled_at<:end",
            **params,
        )["n"]
        refund = one(
            c,
            "SELECT COALESCE(SUM(amount_minor),0) AS n FROM refunds WHERE cinema_id=:cid AND status='SUCCEEDED' AND settled_at>=:start AND settled_at<:end",
            **params,
        )["n"]
        pending = one(
            c,
            "SELECT COALESCE(SUM(amount_minor),0) AS n FROM refunds WHERE cinema_id=:cid AND status<>'SUCCEEDED'",
            cid=cinema_id,
        )["n"]
        return dict(
            cinema_id=cinema_id,
            ticket_minor=sums.get("TICKET", 0),
            fee_minor=sums.get("FEE", 0),
            net_settled_minor=sum(sums.values()),
            payments_minor=int(pay),
            refunds_minor=int(refund),
            pending_refunds_now_minor=int(pending),
            as_of=now(),
            **{"from": start, "to": end},
        )

    # A read-only snapshot keeps separately aggregated figures mutually consistent.
    with db().connect().execution_options(isolation_level="REPEATABLE READ") as c:
        with c.begin():
            return work(c)
