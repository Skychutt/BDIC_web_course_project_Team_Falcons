from werkzeug.security import generate_password_hash
from .core import *
from .auth import credentials, public_user


def create_district(actor, data):
    role(actor, "PLATFORM_ADMIN")
    code = string(data.get("admin_code"), "admin_code", 6, 6)
    require(
        re.fullmatch(r"1101[0-9]{2}", code) is not None,
        "VALIDATION",
        "Use a Beijing district code",
    )
    return transaction(
        lambda c: {
            "district_id": ins(
                c,
                "districts",
                admin_code=code,
                name=string(data.get("name"), "name", 80),
            )
        }
    )


def create_cinema(actor, data):
    role(actor, "PLATFORM_ADMIN")

    def work(c):
        did = integer(data.get("district_id"), "district_id")
        get(c, "districts", did)
        cid = ins(
            c,
            "cinemas",
            district_id=did,
            name=string(data.get("name"), "name", 120),
            brand=string(data.get("brand"), "brand", 80),
            address=string(data.get("address"), "address", 255),
            is_active=False,
        )
        return get(c, "cinemas", cid)

    return transaction(work)


def create_staff(actor, data):
    role(actor, "PLATFORM_ADMIN")
    email, password = credentials(data)

    def work(c):
        cid = integer(data.get("cinema_id"), "cinema_id")
        get(c, "cinemas", cid)
        uid = ins(
            c,
            "users",
            display_name=string(data.get("display_name"), "display_name", 80),
            email_normalized=email,
            password_hash=generate_password_hash(password),
            role="STAFF",
            staff_cinema_id=cid,
            created_at=now(),
        )
        return public_user(get(c, "users", uid))

    return transaction(work)


def manager(actor, cid, data):
    role(actor, "PLATFORM_ADMIN")
    uid = integer(data.get("staff_id"), "staff_id")

    def work(c):
        get(c, "cinemas", cid, True)
        user = get(c, "users", uid, True)
        require(
            user["role"] == "STAFF" and user["staff_cinema_id"] == cid,
            "MANAGER_BRANCH",
            "Manager must be an employee of this cinema",
        )
        upd(c, "cinemas", cid, manager_user_id=uid, is_active=True)
        return {"cinema_id": cid, "manager_user_id": uid, "is_active": True}

    return transaction(work)


def transfer_staff(actor, uid, data):
    role(actor, "PLATFORM_ADMIN")
    target = integer(data.get("cinema_id"), "cinema_id")
    replacement = (
        integer(data["replacement_manager_id"], "replacement_manager_id")
        if data.get("replacement_manager_id")
        else None
    )

    def work(c):
        u = get(c, "users", uid)
        role(u, "STAFF")
        old = u["staff_cinema_id"]
        for i in sorted({old, target}):
            get(c, "cinemas", i, True)
        for i in sorted({uid} | ({replacement} if replacement else set())):
            get(c, "users", i, True)
        u = get(c, "users", uid)
        if u["staff_cinema_id"] != old:
            raise Retry()
        if old == target:
            return public_user(u)
        cinema = get(c, "cinemas", old)
        if cinema["manager_user_id"] == uid:
            require(
                replacement and replacement != uid,
                "MANAGER_REPLACEMENT",
                "Assign a different old-branch manager before transferring this manager",
            )
            r = get(c, "users", replacement)
            require(
                r["role"] == "STAFF" and r["staff_cinema_id"] == old,
                "MANAGER_BRANCH",
                "Replacement must belong to old cinema",
            )
            upd(c, "cinemas", old, manager_user_id=replacement)
        upd(c, "users", uid, staff_cinema_id=target)
        return public_user(get(c, "users", uid))

    return transaction(work)


def save_film(actor, data, fid=None):
    role(actor, "PLATFORM_ADMIN")
    title = string(data.get("title"), "title", 200)
    synopsis = string(data.get("synopsis"), "synopsis", 6000, 0)
    duration = integer(data.get("duration_minutes"), "duration_minutes", 1, 1000)
    archived = data.get("archived", False)
    require(isinstance(archived, bool), "VALIDATION", "archived must be boolean")
    raw = data.get("genre_ids", [])
    require(
        isinstance(raw, list) and len(raw) <= 30,
        "VALIDATION",
        "genre_ids must be a list with at most 30 entries",
    )
    genres = sorted({integer(i, "genre_id") for i in raw})

    def work(c):
        for gid in genres:
            get(c, "genres", gid)
        values = dict(
            title=title, synopsis=synopsis, duration_minutes=duration, archived=archived
        )
        film_id = fid
        if film_id:
            get(c, "films", film_id, True)
            upd(c, "films", film_id, **values)
        else:
            film_id = ins(c, "films", **values)
        execute(c, "DELETE FROM film_genres WHERE film_id=:f", f=film_id)
        for gid in genres:
            execute(
                c,
                "INSERT INTO film_genres(film_id,genre_id) VALUES(:f,:g)",
                f=film_id,
                g=gid,
            )
        return get(c, "films", film_id)

    return transaction(work)


def edit_cinema(actor, cid, data):
    role(actor, "PLATFORM_ADMIN")
    values = dict(
        name=string(data.get("name"), "name", 120),
        brand=string(data.get("brand"), "brand", 80),
        address=string(data.get("address"), "address", 255),
        district_id=integer(data.get("district_id"), "district_id"),
    )
    lat, lon = data.get("latitude"), data.get("longitude")
    if lat is None and lon is None:
        values.update(latitude=None, longitude=None, coordinate_system=None)
    else:
        try:
            require(
                lat is not None
                and lon is not None
                and data.get("coordinate_system") == "GCJ02",
                "VALIDATION",
                "Supply both coordinates in GCJ02",
            )
            latitude, longitude = Decimal(str(lat)), Decimal(str(lon))
            require(
                latitude.is_finite()
                and longitude.is_finite()
                and -90 <= latitude <= 90
                and -180 <= longitude <= 180,
                "VALIDATION",
                "Invalid coordinate range",
            )
        except (ValueError, ArithmeticError):
            raise Problem("VALIDATION", "Invalid coordinates")
        values.update(latitude=latitude, longitude=longitude, coordinate_system="GCJ02")

    def work(c):
        get(c, "districts", values["district_id"])
        get(c, "cinemas", cid, True)
        upd(c, "cinemas", cid, **values)
        return get(c, "cinemas", cid)

    return transaction(work)


def edit_district(actor, did, data):
    role(actor, "PLATFORM_ADMIN")
    code = string(data.get("admin_code"), "admin_code", 6, 6)
    require(
        re.fullmatch(r"1101[0-9]{2}", code) is not None,
        "VALIDATION",
        "Use a Beijing district code",
    )
    name = string(data.get("name"), "name", 80)

    def work(c):
        get(c, "districts", did, True)
        upd(c, "districts", did, admin_code=code, name=name)
        return get(c, "districts", did)

    return transaction(work)
