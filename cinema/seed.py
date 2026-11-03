"""Explicit local fixtures, with real password hashes and relative future dates."""

from datetime import timedelta
from werkzeug.security import generate_password_hash
from .core import *


def seed(password):
    require(
        isinstance(password, str) and 10 <= len(password) <= 128,
        "VALIDATION",
        "Demo password must contain 10..128 characters",
    )
    password_hash = generate_password_hash(password)

    def work(c):
        require(
            one(c, "SELECT COUNT(*) AS n FROM users")["n"] == 0
            and one(c, "SELECT COUNT(*) AS n FROM districts")["n"] == 0,
            "SEED_NOT_EMPTY",
            "Demo seeding requires an empty schema; it never overwrites existing data",
            409,
        )
        at = now()
        result = {
            "accounts": {},
            "cinemas": [],
            "screenings": [],
            "layouts": [],
            "seats": {},
        }

        def user(email, name, role, branch=None):
            uid = ins(
                c,
                "users",
                display_name=name,
                email_normalized=email,
                password_hash=password_hash,
                role=role,
                staff_cinema_id=branch,
                created_at=at,
            )
            result["accounts"][email] = uid
            if role == "CUSTOMER":
                wid = ins(
                    c, "wallets", customer_id=uid, balance_minor=100000, updated_at=at
                )
                op = operation(
                    c,
                    {"id": uid},
                    "demo-register",
                    {"action": "DEMO_REGISTER"},
                    "REGISTER",
                    {"user_id": uid},
                )
                ins(
                    c,
                    "wallet_entries",
                    wallet_id=wid,
                    owner_id=uid,
                    operation_id=op,
                    entry_type="INITIAL_CREDIT",
                    amount_minor=100000,
                    balance_after_minor=100000,
                    created_at=at,
                )
            return uid

        result["admin_id"] = user(
            "admin@cinema.test", "Platform Admin", "PLATFORM_ADMIN"
        )
        result["customer_id"] = user(
            "customer@cinema.test", "Demo Customer", "CUSTOMER"
        )
        result["second_customer_id"] = user(
            "customer2@cinema.test", "Second Customer", "CUSTOMER"
        )
        genre = ins(c, "genres", name="Adventure")
        fid = ins(
            c,
            "films",
            title="Journey Beyond the City",
            synopsis="A fictional student-project film about friends exploring a hidden city.",
            duration_minutes=100,
            archived=False,
        )
        execute(
            c, "INSERT INTO film_genres(film_id,genre_id) VALUES(:f,:g)", f=fid, g=genre
        )
        result["film_id"] = fid
        result["genre_id"] = genre
        for index, (code, name) in enumerate(
            [("110105", "Chaoyang"), ("110108", "Haidian"), ("110101", "Dongcheng")], 1
        ):
            did = ins(c, "districts", admin_code=code, name=name)
            cid = ins(
                c,
                "cinemas",
                district_id=did,
                name=f"Falcons {name}",
                brand="Falcons",
                address=f"Demo campus venue {index}, Beijing",
                is_active=False,
            )
            manager = user(
                f"manager{index}@cinema.test", f"{name} Manager", "STAFF", cid
            )
            user(f"staff{index}@cinema.test", f"{name} Staff", "STAFF", cid)
            upd(c, "cinemas", cid, manager_user_id=manager, is_active=True)
            result["cinemas"].append(cid)
            screen = ins(
                c,
                "screens",
                cinema_id=cid,
                name="Screen 1",
                screen_type=["STANDARD", "IMAX", "DOLBY_CINEMA"][index - 1],
            )
            lid = ins(
                c,
                "layouts",
                screen_id=screen,
                version_no=1,
                screen_direction="TOP",
                row_count=12,
                created_at=at,
            )
            result["layouts"].append(lid)
            seats = []
            for row in range(1, 13):
                for number in range(1, 7):
                    seats.append(
                        ins(
                            c,
                            "seats",
                            layout_id=lid,
                            row_no=row,
                            seat_no=number,
                            aisle_segment=1,
                            segment_position=number,
                            map_x=number - 1,
                            map_y=row - 1,
                        )
                    )
            result["seats"][str(lid)] = seats
            for offset, price in [(3, 10000), (8, 10000), (25, 8000)]:
                starts = at + timedelta(hours=offset)
                sid = ins(
                    c,
                    "screenings",
                    cinema_id=cid,
                    film_id=fid,
                    screen_id=screen,
                    layout_id=lid,
                    starts_at=starts,
                    ends_at=starts + timedelta(minutes=100),
                    occupied_until=starts + timedelta(minutes=115),
                    duration_minutes_snapshot=100,
                    turnaround_minutes=15,
                    status="PUBLISHED",
                    revision_no=1,
                    created_at=at,
                )
                for kind, amount in [("STANDARD", price), ("STUDENT", price // 2)]:
                    ins(
                        c, "fares", screening_id=sid, fare_type=kind, price_minor=amount
                    )
                result["screenings"].append(sid)
        return result

    return transaction(work)
