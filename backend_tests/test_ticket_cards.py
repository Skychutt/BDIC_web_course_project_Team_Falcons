"""Signed ticket lookup must preserve order access and reflect subsequent changes."""
from datetime import timedelta

from cinema.core import db, get, one, upd
from backend_tests.test_frontend_api import actor, client
from backend_tests.test_customer_refunds import buy, refund


def issue(env, bid):
    response = client(env, "customer").get(f"/api/bookings/{bid}/ticket")
    assert response.status_code == 200
    return response.json["data"]


def lookup_path(card):
    return "/api/tickets/" + card["ticket_path"].split("/ticket/")[1]


def test_ticket_data_permissions_signature_and_read_only(env):
    purchase, _ = buy(env)
    bid = purchase["booking_id"]
    path = f"/api/bookings/{bid}/ticket"
    with db().connect() as c:
        before = {table: one(c, f"SELECT COUNT(*) n FROM {table}")["n"]
                  for table in ("bookings", "tickets", "seat_allocations", "wallet_entries")}
    card = issue(env, bid)
    assert card["booking_id"] == str(bid)
    assert card["holder_name"] == actor(env)["display_name"]
    assert card["is_demo_customer"] and "name_source_email" not in card
    assert len(card["seats"]) == 2
    assert card["status"] == "CONFIRMED"
    assert card["qr_matrix"] and all(len(row) == len(card["qr_matrix"]) for row in card["qr_matrix"])
    assert all(bit in (0, 1) for row in card["qr_matrix"] for bit in row)
    assert "email" not in card and "owner_id" not in card
    lookup = lookup_path(card)
    for url in (path, lookup):
        assert client(env).get(url).status_code == 401
        assert client(env, "customer2").get(url).status_code == 403
        assert client(env, "manager2").get(url).status_code == 403
        assert client(env, "manager1").get(url).status_code == 200
        assert client(env, "customer").get(url).json["data"]["booking_id"] == str(bid)
    # Changing the payload without signing, or supplying garbage, never resolves an order.
    token = lookup.rsplit("/", 1)[1]
    tampered = ("a" if token[0] != "a" else "b") + token[1:]
    assert client(env, "customer").get("/api/tickets/" + tampered).status_code == 400
    assert client(env, "customer").get("/api/tickets/not-a-ticket").status_code == 400
    with db().connect() as c:
        assert before == {table: one(c, f"SELECT COUNT(*) n FROM {table}")["n"] for table in before}


def test_saved_qr_reflects_refund_and_resold_seats(env):
    purchase, hold = buy(env)
    card = issue(env, purchase["booking_id"])
    refund(env, purchase["booking_id"])
    replacement, _ = buy(env, name="customer2", seats=hold["seat_ids"])
    looked_up = client(env, "customer").get(lookup_path(card)).json["data"]
    assert looked_up["status"] == "CUSTOMER_CANCELLED"
    assert looked_up["booking_id"] != str(replacement["booking_id"])
    assert looked_up["ticket_path"] == card["ticket_path"]
    assert looked_up["seats"] == card["seats"]  # historical seat labels survive release


def test_saved_qr_reflects_reschedule(env):
    purchase, _ = buy(env, index=1)
    card = issue(env, purchase["booking_id"])
    replacement, _ = buy(env, index=2, source=purchase["booking_id"])
    assert client(env, "customer").get(lookup_path(card)).json["data"]["status"] == "RESCHEDULED"
    assert issue(env, replacement["booking_id"])["status"] == "CONFIRMED"


def test_ticket_time_boundaries(env):
    purchase, hold = buy(env)
    card = issue(env, purchase["booking_id"])
    with db().connect() as c:
        screening = get(c, "screenings", hold["screening_id"])
    for at, state in ((screening["starts_at"] - timedelta(seconds=1), "CONFIRMED"),
                      (screening["starts_at"], "STARTED"), (screening["ends_at"], "ENDED")):
        env["clock"][0] = at
        assert client(env, "customer").get(lookup_path(card)).json["data"]["status"] == state


def test_cancelled_screening_never_looks_confirmed(env):
    purchase, hold = buy(env)
    with db().begin() as c:
        upd(c, "screenings", hold["screening_id"], status="CANCELLED")
    assert issue(env, purchase["booking_id"])["status"] == "CINEMA_CANCELLED"
