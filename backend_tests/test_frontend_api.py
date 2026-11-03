"""Real-MySQL checks for browser read models and the signed counter preview."""

from datetime import timedelta
import secrets

from cinema import booking, management
from cinema.core import db, get, ins, one, now, upd


def actor(env, name="customer"):
    return env["users"][name + "@cinema.test"]


def client(env, name=None):
    result = env["app"].test_client()
    if name:
        with result.session_transaction() as session:
            session["user_id"] = str(actor(env, name)["id"])
            session["csrf"] = "frontend-test-csrf"
    return result


def key():
    return "frontend-test-" + secrets.token_hex(10)


def prepare_quote(env, index=0, name="customer"):
    customer = actor(env, name)
    seat = env["ids"]["seats"][str(env["ids"]["layouts"][index // 3])][0]
    hold = booking.create_hold(customer, {"screening_id": env["ids"]["screenings"][index], "seat_ids": [seat]}, key())
    quote = booking.quote(customer, hold["hold_id"], {"tickets": [{"seat_id": seat, "fare_type": "STANDARD"}]})
    return hold, quote


def purchase(env, index=0, name="customer"):
    _, quote = prepare_quote(env, index, name)
    return booking.checkout(actor(env, name), {"quote_token": quote["quote_token"]}, key())


def cancellation(env, index):
    staff = actor(env, "manager" + str(index // 3 + 1))
    sid = env["ids"]["screenings"][index]
    preview = management.cancel_preview(staff, sid, {"reason": "Test disruption"})
    return management.cancel_confirm(staff, sid, {"preview_token": preview["preview_token"]}, key())


def test_bootstrap_public_scope_and_no_secrets(env):
    with db().begin() as c:
        ins(c, "cinemas", district_id=get(c, "cinemas", env["ids"]["cinemas"][0])["district_id"], name="Hidden cinema", brand="Test", address="Not public", is_active=False)
        ins(c, "films", title="Archived film", synopsis="hidden", duration_minutes=100, archived=True)
    result = client(env).get("/api/ui/bootstrap")
    assert result.status_code == 200
    data = result.json["data"]
    assert data["user"] is None
    assert len(data["cinemas"]) == 3 and len(data["films"]) == 1
    assert data["available_dates"] == ["2026-10-23", "2026-10-24"]
    assert data["films"][0]["genres"][0]["name"] == "Adventure"
    assert data["films"][0]["rating"] == {"average": None, "count": 0, "scale": 10}
    assert isinstance(data["films"][0]["id"], str)
    assert "manager_user_id" not in result.text and "password_hash" not in result.text
    assert "email_normalized" not in result.text
    admin = client(env, "admin").get("/api/ui/bootstrap").json["data"]
    assert len(admin["cinemas"]) == 4
    assert len(admin["films"]) == 1  # Archived films have a dedicated admin endpoint.


def test_bootstrap_manager_and_date_window(env):
    manager = client(env, "manager1").get("/api/ui/bootstrap").json["data"]["user"]
    assert manager["is_manager"] is True and manager["owncinema_label"] == "Falcons Chaoyang"
    staff = client(env, "staff1").get("/api/ui/bootstrap").json["data"]["user"]
    assert staff["is_manager"] is False
    assert "password_hash" not in manager
    with db().begin() as c:
        s = get(c, "screenings", env["ids"]["screenings"][8])
        start = now() + timedelta(days=15)
        upd(c, "screenings", s["id"], starts_at=start, ends_at=start + timedelta(minutes=100), occupied_until=start + timedelta(minutes=115))
    dates = client(env).get("/api/ui/bootstrap").json["data"]["available_dates"]
    assert "2026-11-07" not in dates


def test_booking_detail_enrichment_and_private_scope(env):
    receipt = purchase(env)
    path = "/api/ui/bookings/" + str(receipt["booking_id"])
    assert client(env).get(path).status_code == 401
    assert client(env, "customer2").get(path).status_code == 403
    assert client(env, "staff2").get(path).status_code == 403
    assert client(env, "admin").get(path).status_code == 403
    for who in ("customer", "staff1"):
        response = client(env, who).get(path)
        assert response.status_code == 200
        detail = response.json["data"]
        assert detail["film_title"] == "Journey Beyond the City"
        assert detail["cinema_name"] == "Falcons Chaoyang"
        assert detail["screen_type"] == "STANDARD"
        assert detail["starts_at"].endswith("+08:00")
        assert detail["tickets"][0]["seat_label"] == "1 排 1 座"
        assert isinstance(detail["tickets"][0]["id"], str)


def test_booking_pages_filters_totals_and_own_branch(env):
    first = purchase(env, 0)
    purchase(env, 1)
    purchase(env, 3, "customer2")
    cancellation(env, 0)
    customer = client(env, "customer")
    current = customer.get("/api/ui/bookings?status=CONFIRMED&page_size=1").json["data"]
    history = customer.get("/api/ui/bookings?status=HISTORY&page_size=1").json["data"]
    assert current["total"] == 1 and history["total"] == 1
    assert history["items"][0]["id"] == str(first["booking_id"])
    assert customer.get("/api/ui/bookings?page_size=1&page=2").json["data"]["total"] == 2
    assert customer.get("/api/ui/bookings?status=INVALID").status_code == 400
    staff = client(env, "staff1")
    own = staff.get("/api/staff/bookings?page_size=1").json["data"]
    assert own["total"] == 2 and len(own["items"]) == 1
    assert own["items"][0]["ticket_count"] == 1
    exact = staff.get("/api/staff/bookings", query_string={"q": str(first["booking_id"])}).json["data"]
    assert exact["total"] == 1
    title = staff.get("/api/staff/bookings?q=Journey").json["data"]
    assert title["total"] == 2
    assert staff.get("/api/staff/bookings?q=%25%25").json["data"]["total"] == 0
    assert staff.get("/api/staff/bookings?page_size=101").status_code == 400
    assert staff.get("/api/staff/bookings?page=0").status_code == 400
    assert customer.get("/api/staff/bookings").status_code == 403
    assert client(env, "admin").get("/api/staff/bookings").status_code == 403
    assert staff.get("/api/ui/bookings").status_code == 403


def test_refund_list_scoped_enriched_and_paginated(env):
    purchase(env, 0)
    purchase(env, 3, "customer2")
    cancellation(env, 0)
    cancellation(env, 3)
    staff = client(env, "staff1")
    data = staff.get("/api/staff/refunds?page_size=1").json["data"]
    assert data["total"] == 1 and len(data["items"]) == 1
    refund = data["items"][0]
    assert refund["cinema_id"] == str(env["ids"]["cinemas"][0])
    assert refund["amount_minor"] == 10000 and refund["status"] == "PENDING"
    assert refund["film_title"] == "Journey Beyond the City"
    assert "last_error" not in refund and "owner_id" not in refund
    assert staff.get("/api/staff/refunds?page_size=0").status_code == 400
    assert client(env, "customer").get("/api/staff/refunds").status_code == 403
    assert client(env, "admin").get("/api/staff/refunds").status_code == 403


def test_admin_films_includes_archived_and_metadata(env):
    with db().begin() as c:
        ins(c, "films", title="Archived", synopsis="Unlisted", duration_minutes=90, archived=True)
        ins(c, "ratings", customer_id=actor(env)["id"], film_id=env["ids"]["film_id"], stars=4, created_at=now(), updated_at=now())
    admin = client(env, "admin")
    page = admin.get("/api/admin/films?page_size=1").json["data"]
    assert page["total"] == 2 and page["items"][0]["archived"] == 1
    next_page = admin.get("/api/admin/films?page_size=1&page=2").json["data"]
    assert next_page["items"][0]["rating"] == {"average": "4.0", "count": 1, "scale": 10}
    assert next_page["items"][0]["genres"][0]["name"] == "Adventure"
    assert admin.get("/api/admin/films?page_size=101").status_code == 400
    assert client(env, "staff1").get("/api/admin/films").status_code == 403
    assert client(env).get("/api/admin/films").status_code == 401


def approved_counter_quote(env):
    hold, quote = prepare_quote(env)
    consent = booking.counter_consent(actor(env), hold["hold_id"], {"staff_id": actor(env, "staff1")["id"], "quote_token": quote["quote_token"]})
    return hold, {"quote_token": quote["quote_token"], "consent_token": consent["consent_token"]}


def preview(client, body):
    return client.post("/api/counter/preview", json=body, headers={"X-CSRF-Token": "frontend-test-csrf"})


def test_counter_preview_verifies_consent_and_does_not_charge(env):
    hold, body = approved_counter_quote(env)
    response = preview(client(env, "staff1"), body)
    assert response.status_code == 200
    data = response.json["data"]
    assert data["amount_due_minor"] == 10000
    assert data["film_title"] == "Journey Beyond the City"
    assert data["tickets"][0]["seat_label"] == "1 排 1 座"
    assert "owner_id" not in data and "consent_token" not in data
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) AS n FROM payments")["n"] == 0
        assert get(c, "seat_holds", hold["hold_id"])["status"] == "ACTIVE"
    assert preview(client(env, "manager1"), body).status_code == 403
    assert preview(client(env, "staff2"), body).status_code == 403
    assert preview(client(env, "customer"), body).status_code == 403
    assert preview(client(env, "staff1"), {"quote_token": body["quote_token"], "consent_token": "tampered"}).status_code == 409


def test_counter_preview_rejects_changed_price_and_expiry(env):
    _, body = approved_counter_quote(env)
    management.update_fares(actor(env, "manager1"), env["ids"]["screenings"][0], {"revision_no": 1, "fares": {"STANDARD": 11000, "STUDENT": 5500}})
    changed = preview(client(env, "staff1"), body)
    assert changed.status_code == 409 and changed.json["error"]["code"] == "QUOTE_CHANGED"
    env["clock"][0] += timedelta(minutes=6)
    expired = preview(client(env, "staff1"), body)
    assert expired.status_code == 409 and expired.json["error"]["code"] == "HOLD_EXPIRED"
    with db().connect() as c:
        assert one(c, "SELECT COUNT(*) AS n FROM payments")["n"] == 0


def test_personal_pages_follow_creation_time_not_random_ids(env):
    # Deliberately put the oldest wallet entry first in numeric-ID order.
    with db().begin() as c:
        initial = one(c, "SELECT id FROM wallet_entries WHERE owner_id=:u", u=actor(env)["id"])
        upd(c, "wallet_entries", initial["id"], id=1)
    env["clock"][0] += timedelta(minutes=1)
    purchase(env, 0)
    customer = client(env, "customer")
    newest = customer.get("/api/me/wallet-entries?page_size=1").json["data"]
    oldest = customer.get("/api/me/wallet-entries?page_size=1&page=2").json["data"]
    assert newest["total"] == 2
    assert newest["items"][0]["entry_type"] == "PAYMENT"
    assert oldest["items"][0]["entry_type"] == "INITIAL_CREDIT"
    cancellation(env, 0)
    with db().begin() as c:
        coupon = one(c, "SELECT id FROM coupons WHERE owner_id=:u", u=actor(env)["id"])
        upd(c, "coupons", coupon["id"], id=1)
    env["clock"][0] += timedelta(minutes=1)
    purchase(env, 1)
    cancellation(env, 1)
    coupons = customer.get("/api/me/coupons?page_size=1").json["data"]
    assert coupons["total"] == 2
    assert coupons["items"][0]["id"] != "1"
    assert coupons["items"][0]["issued_at"].startswith("2026-10-23T10:02:00")


def test_seatmap_names_the_actual_imax_screen(env):
    public = client(env)
    standard = public.get(f"/api/screenings/{env['ids']['screenings'][0]}/seats").json["data"]["screening"]
    imax = public.get(f"/api/screenings/{env['ids']['screenings'][3]}/seats").json["data"]["screening"]
    dolby = public.get(f"/api/screenings/{env['ids']['screenings'][6]}/seats").json["data"]["screening"]
    assert standard["screen_type"] == "STANDARD"
    assert imax["screen_type"] == "IMAX"
    assert dolby["screen_type"] == "DOLBY_CINEMA"
    assert imax["screen_name"] == "Screen 1"


def test_staff_programme_uses_bound_cinema_without_argument_collision(env):
    own = client(env, "staff1").get("/api/staff/screenings")
    assert own.status_code == 200
    data = own.json["data"]
    assert len(data["items"]) == 3
    assert {item["cinema_id"] for item in data["items"]} == {str(env["ids"]["cinemas"][0])}
    assert client(env, "staff1").get("/api/staff/screenings?page=2").json["data"]["items"] == []
    assert client(env, "customer").get("/api/staff/screenings").status_code == 403
    assert client(env, "admin").get("/api/staff/screenings").status_code == 403
