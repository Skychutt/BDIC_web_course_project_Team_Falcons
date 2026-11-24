"""Catalogue, seat map, deterministic recommendations and customer reads."""

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from .core import *


def zone_sizes(row_count):
    weights = [30, 40, 30]
    sizes = [row_count * w // 100 for w in weights]
    order = sorted(range(3), key=lambda i: (-(row_count * weights[i] % 100), i))
    for i in order[: row_count - sum(sizes)]:
        sizes[i] += 1
    return sizes


def seat_zone(row_no, row_count):
    front, middle, _ = zone_sizes(row_count)
    return (
        "FRONT" if row_no <= front else "MIDDLE" if row_no <= front + middle else "REAR"
    )


def available_seats_by_screening(c, screenings):
    """Reuse each layout's seats, but exclude allocations only from their own show."""
    layout_ids = in_ids(s["layout_id"] for s in screenings)
    seats_by_layout = defaultdict(list)
    for seat in rows(
        c, f"SELECT * FROM seats WHERE layout_id IN ({layout_ids}) ORDER BY layout_id,row_no,seat_no"
    ):
        seats_by_layout[seat["layout_id"]].append(seat)

    screening_ids = in_ids(s["id"] for s in screenings)
    occupied = defaultdict(set)
    for allocation in rows(
        c,
        f"""SELECT a.screening_id,a.seat_id FROM seat_allocations a
            LEFT JOIN seat_holds h ON h.id=a.hold_id
            WHERE a.screening_id IN ({screening_ids})
            AND (a.state='SOLD' OR (h.status='ACTIVE' AND h.expires_at>:at))""",
        at=now(),
    ):
        occupied[allocation["screening_id"]].add(allocation["seat_id"])

    available = {}
    for show in screenings:
        seats = seats_by_layout[show["layout_id"]]
        taken = occupied[show["id"]]
        if taken:
            seats = [seat for seat in seats if seat["id"] not in taken]
        available[show["id"]] = seats
    return available


def available_seats(c, s):
    return available_seats_by_screening(c, [s])[s["id"]]


def contiguous_blocks(seats, size):
    groups = defaultdict(list)
    for st in seats:
        groups[(st["row_no"], st["aisle_segment"])].append(st)
    for group in groups.values():
        group.sort(key=lambda st: st["segment_position"])
        for i in range(len(group) - size + 1):
            block = group[i : i + size]
            if block[-1]["segment_position"] - block[0]["segment_position"] == size - 1:
                yield block


def next_adjacent_seat_ids(seats, size, selected_ids):
    selectable = (seat for seat in seats if seat["state"] == "AVAILABLE" or seat["held_by_me"])
    blocks = sorted(contiguous_blocks(selectable, size),
                    key=lambda block: (block[0]["row_no"], block[0]["seat_no"]))
    if not blocks:
        return []
    options = [[seat["id"] for seat in block] for block in blocks]
    for i, option in enumerate(options):
        if selected_ids == set(option):
            return options[(i + 1) % len(options)]
    # After a conflict, keep as many of the customer's remaining choices as possible.
    return max(options, key=lambda option: len(selected_ids.intersection(option)))


def choose_seats(seats, size, row_count, preference=None):
    preferred = lambda st: int(
        preference is not None and seat_zone(st["row_no"], row_count) == preference
    )
    blocks = list(contiguous_blocks(seats, size))
    if blocks:
        chosen = min(
            blocks,
            key=lambda b: (
                -sum(preferred(s) for s in b),
                b[0]["row_no"],
                b[0]["seat_no"],
            ),
        )
        adjacent = True
    else:
        chosen = sorted(
            seats, key=lambda st: (-preferred(st), st["row_no"], st["seat_no"])
        )[:size]
        adjacent = False
    return dict(
        seat_ids=[s["id"] for s in chosen],
        adjacent=adjacent,
        separated=not adjacent,
        preferred_seat_count=sum(preferred(s) for s in chosen),
    )


def search(c, filters, *, end_exclusive=False):
    """Shared ranking; the assistant uses an exclusive end, the v1 API stays inclusive."""
    allowed = {
        "district_id",
        "cinema_id",
        "film_id",
        "genre_id",
        "date",
        "start_from",
        "start_to",
        "party_size",
        "screen_type",
        "zone",
        "page",
        "page_size",
        "exclude_screening_id",
        "screening_id", "genre", "keyword", "min_rating", "rated_only", "sort_by_rating",
        "budget_minor", "budget_scope", "fare_type", "require_contiguous",
    }
    require(
        not set(filters) - allowed,
        "VALIDATION",
        "Unknown search filter",
        fields=sorted(set(filters) - allowed),
    )
    size = integer(filters.get("party_size", 1), "party_size", 1, 12)
    def flag(name):
        value = filters.get(name, False)
        require(value in (True, False, "true", "false", "1", "0"), "VALIDATION", "Invalid boolean filter")
        return value in (True, "true", "1")
    rated_only, rank_rating, contiguous_only = (flag(k) for k in ("rated_only", "sort_by_rating", "require_contiguous"))
    minimum = filters.get("min_rating")
    if minimum is not None:
        try:
            minimum = float(minimum)
        except (ValueError, TypeError):
            raise Problem("VALIDATION", "Rating must be 1 to 10")
        require(1 <= minimum <= 10, "VALIDATION", "Rating must be 1 to 10")
    budget = filters.get("budget_minor")
    if budget is not None:
        budget = integer(budget, "budget_minor", 0, 10000000)
        require(filters.get("budget_scope") in ("per_ticket", "total"), "VALIDATION", "Specify budget per ticket or total")
    fare_type = filters.get("fare_type", "regular")
    require(fare_type in ("regular", "student"), "VALIDATION", "Unknown fare type")
    for field in ("genre", "keyword"):
        require(isinstance(filters.get(field, ""), str) and len(filters.get(field, "")) <= 100,
                "VALIDATION", "Invalid film filter")
    zone = filters.get("zone")
    require(
        zone in (None, "FRONT", "MIDDLE", "REAR"),
        "VALIDATION",
        "zone must be FRONT, MIDDLE or REAR",
    )
    try:
        day = (
            date.fromisoformat(filters["date"]) if filters.get("date") else now().date()
        )
    except (TypeError, ValueError):
        raise Problem("VALIDATION", "date must be YYYY-MM-DD")
    require(day < date.max, "VALIDATION", "Choose a screening date on or before 9999-12-30.")
    lo = datetime.combine(day, time.min)
    hi = lo + timedelta(days=1)
    clauses = [
        "s.status='PUBLISHED'",
        "c.is_active=1",
        "f.archived=0",
        "s.starts_at>:now",
        "s.starts_at>=:lo",
        "s.starts_at<:hi",
    ]
    params = dict(now=now(), lo=lo, hi=hi)
    for field, column in [
        ("district_id", "c.district_id"),
        ("cinema_id", "s.cinema_id"),
        ("film_id", "s.film_id"),
        ("screening_id", "s.id"),
    ]:
        if filters.get(field):
            clauses.append(f"{column}=:{field}")
            params[field] = integer(filters[field], field)
    if "exclude_screening_id" in filters:
        clauses.append("s.id <> :exclude_screening_id")
        params["exclude_screening_id"] = integer(filters["exclude_screening_id"], "exclude_screening_id")
    if filters.get("genre_id"):
        clauses.append(
            "EXISTS(SELECT 1 FROM film_genres fg WHERE fg.film_id=s.film_id AND fg.genre_id=:g)"
        )
        params["g"] = integer(filters["genre_id"], "genre_id")
    if filters.get("screen_type"):
        require(
            filters["screen_type"] in ("STANDARD", "IMAX", "DOLBY_CINEMA"),
            "VALIDATION",
            "Invalid screen_type",
        )
        clauses.append("sc.screen_type=:type")
        params["type"] = filters["screen_type"]
    lower, upper = None, None
    for field, op in [("start_from", ">="), ("start_to", "<=")]:
        if filters.get(field):
            if end_exclusive and field == "start_to":
                op = "<"
                if filters[field] == "24:00":
                    continue  # The date bound already excludes the next midnight.
            try:
                t = time.fromisoformat(filters[field])
                require(
                    t.tzinfo is None,
                    "VALIDATION",
                    "Time range uses Beijing local HH:MM",
                )
            except (TypeError, ValueError):
                raise Problem("VALIDATION", "Time range must be HH:MM")
            params[field] = datetime.combine(day, t)
            clauses.append(f"s.starts_at{op}:{field}")
            if field == "start_from":
                lower = t
            else:
                upper = t
    require(
        not (lower and upper) or lower <= upper,
        "VALIDATION",
        "start_from must not be after start_to",
    )
    candidates = rows(
        c,
        """SELECT s.*,f.title,c.name AS cinema_name,c.district_id,sc.name AS screen_name,sc.screen_type,l.row_count
        FROM screenings s JOIN films f ON f.id=s.film_id JOIN cinemas c ON c.id=s.cinema_id
        JOIN screens sc ON sc.id=s.screen_id JOIN layouts l ON l.id=s.layout_id WHERE """
        + " AND ".join(clauses),
        **params,
    )
    result = []
    if candidates:
        from .frontend_api import film_metadata
        from .discovery import match_film
        from types import SimpleNamespace
        film_ids = in_ids(s["film_id"] for s in candidates)
        films = film_metadata(c, rows(c, f"SELECT * FROM films WHERE id IN ({film_ids})"))
        film_filters = SimpleNamespace(film_id=None, genre=filters.get("genre"), keyword=filters.get("keyword"),
            min_rating=minimum, rated_only=rated_only, showing_only=False, recent=False)
        ratings = {}
        for film in films:
            record = SimpleNamespace(id=film["id"], titles={"title": film["title"]}, synopsis={"text": film["synopsis"]},
                genres=[g["name"] for g in film["genres"]], rating=film["rating"]["average"], rating_count=film["rating"]["count"])
            if match_film(record, film_filters):
                ratings[film["id"]] = film["rating"]
        candidates = [s for s in candidates if s["film_id"] in ratings]

    if candidates:
        seats_by_screening = available_seats_by_screening(c, candidates)
        screening_ids = in_ids(s["id"] for s in candidates)
        fares_by_screening = defaultdict(list)
        for fare in rows(
            c,
            f"""SELECT screening_id,fare_type,price_minor FROM fares
                WHERE screening_id IN ({screening_ids}) ORDER BY screening_id,fare_type""",
        ):
            fares_by_screening[fare.pop("screening_id")].append(fare)

    for s in candidates:
        seats = seats_by_screening[s["id"]]
        if len(seats) < size:
            continue
        s["suggestion"] = choose_seats(seats, size, s["row_count"], zone)
        if contiguous_only and not s["suggestion"]["adjacent"]:
            continue
        s["available_count"] = len(seats)
        s["fares"] = fares_by_screening[s["id"]]
        if budget is not None:
            fare = next((f["price_minor"] for f in s["fares"] if f["fare_type"] == ("STANDARD" if fare_type == "regular" else "STUDENT")), None)
            if fare is None or fare * (size if filters["budget_scope"] == "total" else 1) > budget:
                continue
        s["rating"] = ratings[s["film_id"]]
        result.append(s)
    result.sort(
        key=lambda s: (
            not s["suggestion"]["adjacent"],
            -s["suggestion"]["preferred_seat_count"],
            -(s["rating"]["average"] or 0) if rank_rating else 0,
            s["starts_at"],
            s["id"],
        )
    )
    page = integer(filters.get("page", 1), "page", 1, 10000)
    limit = integer(filters.get("page_size", 20), "page_size", 1, 100)
    return dict(
        items=result[(page - 1) * limit : page * limit],
        total=len(result),
        page=page,
        page_size=limit,
        as_of=now(),
        hard_filters_relaxed=False,
    )


def sale_closed_reason(c, sid):
    # A sale and an administrative film update must agree on their commit order.
    show = one(c, """SELECT s.status,s.starts_at,f.archived,ci.is_active
        FROM screenings s JOIN films f ON f.id=s.film_id
        JOIN cinemas ci ON ci.id=s.cinema_id WHERE s.id=:sid FOR SHARE OF f""", sid=sid)
    require(show is not None, "NOT_FOUND", "screenings record not found", 404)
    if show["status"] != "PUBLISHED" or show["starts_at"] <= now():
        return "Screening is no longer on sale"
    if show["archived"]:
        return "This film has been archived"
    if not show["is_active"]:
        return "Cinema is inactive"
    return None


def seatmap(c, sid, actor=None):
    # A checkout can pass its deadline check just before expiry and still be committing.
    # All allocation writers lock the screening. Wait to read their outcome at the boundary.
    s = one(c, "SELECT * FROM screenings WHERE id=:id FOR SHARE", id=sid)
    require(s is not None, "NOT_FOUND", "screenings record not found", 404)
    if actor and actor["role"] == "STAFF":
        branch(actor, s["cinema_id"], c=c)
    as_of = now()
    screen = get(c, "screens", s["screen_id"])
    s["screen_name"] = screen["name"]
    s["screen_type"] = screen["screen_type"]
    layout = get(c, "layouts", s["layout_id"])
    seats = rows(
        c,
        """SELECT st.*,a.state,h.owner_id AS hold_owner_id,h.expires_at,h.status AS hold_status
        FROM seats st LEFT JOIN seat_allocations a ON a.seat_id=st.id AND a.screening_id=:s
        LEFT JOIN seat_holds h ON h.id=a.hold_id WHERE st.layout_id=:l ORDER BY st.row_no,st.seat_no""",
        s=sid,
        l=s["layout_id"],
    )
    for seat in seats:
        owned = bool(actor and seat["hold_owner_id"] == actor["id"])
        status = seat.pop("hold_status")
        expires = seat.pop("expires_at")
        seat.pop("hold_owner_id")
        if seat["state"] == "HELD" and (status != "ACTIVE" or expires <= as_of):
            seat["state"] = None
        seat["state"] = seat["state"] or "AVAILABLE"
        seat["held_by_me"] = owned and seat["state"] == "HELD"
        seat["zone"] = seat_zone(seat["row_no"], layout["row_count"])
    return dict(
        screening=s,
        saleable=sale_closed_reason(c, sid) is None,
        layout=layout,
        seats=seats,
        fares=rows(
            c,
            "SELECT fare_type,price_minor FROM fares WHERE screening_id=:s ORDER BY fare_type",
            s=sid,
        ),
        as_of=as_of,
    )


def film_detail(c, fid):
    from .ratings import attach_ratings
    f = get(c, "films", fid)
    f["genres"] = rows(
        c,
        "SELECT g.* FROM genres g JOIN film_genres fg ON fg.genre_id=g.id WHERE fg.film_id=:f ORDER BY g.name",
        f=fid,
    )
    return attach_ratings(c, [f])[0]


def save_rating(c, uid, fid, stars):
    execute(
        c,
        """INSERT INTO ratings(id,customer_id,film_id,stars,created_at,updated_at) VALUES(:id,:u,:f,:s,:n,:n)
        ON DUPLICATE KEY UPDATE stars=:s,updated_at=:n""",
        id=new_id(), u=uid, f=fid, s=stars, n=now(),
    )


def rate(actor, fid, body):
    role(actor, "CUSTOMER")
    stars = integer(body.get("stars"), "stars", 1, 10)

    def work(c):
        get(c, "users", actor["id"], True)
        get(c, "films", fid)
        save_rating(c, actor["id"], fid, stars)
        return film_detail(c, fid)["rating"]

    return transaction(work)


def booking_detail(c, bid, actor):
    b = get(c, "bookings", bid)
    if actor["role"] == "CUSTOMER":
        owner(actor, b)
    else:
        branch(actor, b["cinema_id"], c=c)
    b["tickets"] = rows(
        c,
        """SELECT t.*,s.row_no,s.seat_no FROM tickets t JOIN seats s ON s.id=t.seat_id
        WHERE t.booking_id=:b ORDER BY s.row_no,s.seat_no""",
        b=bid,
    )
    b["refunds"] = rows(
        c,
        "SELECT id,reason,amount_minor,status,attempt_count,created_at,settled_at FROM refunds WHERE booking_id=:b",
        b=bid,
    )
    b["cancellation"] = one(c, "SELECT * FROM booking_cancellations WHERE booking_id=:b", b=bid)
    b["compensation_coupon"] = one(
        c, "SELECT id,status FROM coupons WHERE source_booking_id=:b", b=bid
    )
    return b
