"""Real MySQL refund/seat/ledger integration; every case uses a disposable schema."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest

from cinema import booking, cancellations, management
from cinema.catalog import booking_detail, seatmap
from cinema.core import Problem, db, get, one, rows, wire
from backend_tests.test_frontend_api import actor, client, key


def buy(env, index=2, name='customer', seats=None, source=None, coupon=None):
    sid = env['ids']['screenings'][index]
    seats = seats or env['ids']['seats'][str(env['ids']['layouts'][index // 3])][:2]
    body = dict(screening_id=sid, seat_ids=seats)
    if source:
        body['source_booking_id'] = source
    hold = booking.create_hold(actor(env, name), body, key())
    quote = booking.quote(actor(env, name), hold['hold_id'], dict(
        tickets=[dict(seat_id=s, fare_type='STANDARD') for s in seats], coupon_id=coupon))
    receipt = booking.checkout(actor(env, name), dict(quote_token=quote['quote_token']), key())
    return receipt, hold


def refund(env, bid, name='customer', preview=None, request_key=None):
    p = preview or cancellations.refund_preview(actor(env, name), bid)
    return cancellations.cancel_booking(actor(env, name), bid, dict(preview_token=p['preview_token']), request_key or key())


def count(c, table):
    return one(c, f'SELECT COUNT(*) n FROM {table}')['n']


@pytest.mark.parametrize('minutes,rate', [(720,0),(719,500),(360,500),(359,2000),(30,2000)])
def test_refund_amount_release_and_resale(env, minutes, rate):
    purchase, hold = buy(env)
    bid = purchase['booking_id']
    with db().connect() as c:
        start = get(c, 'screenings', hold['screening_id'])['starts_at']
    env['clock'][0] = start - timedelta(minutes=minutes)
    preview = cancellations.refund_preview(actor(env), bid)
    assert preview['fee_rate_bps'] == rate
    assert preview['fee_valid_through'] == start - timedelta(minutes={0: 720, 500: 360, 2000: 30}[rate])
    result = refund(env, bid, preview=preview)
    fee = booking.rounded(purchase['net_ticket_minor'], rate)
    assert result['refund_minor'] == purchase['net_ticket_minor'] - fee
    with db().connect() as c:
        assert get(c, 'bookings', bid)['status'] == 'CUSTOMER_CANCELLED'
        assert count(c, 'tickets') == 2  # immutable ticket history is retained
        assert count(c, 'seat_allocations') == 0
        assert count(c, 'refunds') == count(c, 'booking_cancellations') == 1
        assert count(c, 'coupons') == 0
        assert one(c, 'SELECT balance_minor FROM wallets WHERE customer_id=:u', u=actor(env)['id'])['balance_minor'] == 100000-fee
        assert one(c, 'SELECT SUM(amount_minor) n FROM settlement_entries')['n'] == fee
        detail = booking_detail(c, bid, actor(env))
        assert detail['cancellation']['fee_minor'] == fee
        assert detail['refunds'][0]['status'] == 'SUCCEEDED'
    # A different real customer can buy exactly the released seats.
    replacement, _ = buy(env, name='customer2', seats=hold['seat_ids'])
    assert replacement['status'] == 'CONFIRMED'


def test_owner_csrf_preview_binding_and_history_api(env):
    purchase, _ = buy(env)
    bid = purchase['booking_id']
    path = f'/api/bookings/{bid}/refund-preview'
    assert client(env).post(path).status_code in (401,403)
    assert client(env, 'customer').post(path).status_code == 403  # missing CSRF
    headers = {'X-CSRF-Token':'frontend-test-csrf'}
    assert client(env, 'customer2').post(path, headers=headers).status_code == 403
    assert client(env, 'manager1').post(path, headers=headers).status_code == 403
    preview = client(env, 'customer').post(path, headers=headers).json['data']
    with pytest.raises(Problem) as error:
        refund(env, bid, 'customer2', preview=preview)
    assert error.value.code == 'FORBIDDEN'
    change_map = f"/api/screenings/{env['ids']['screenings'][1]}/seats?source_booking_id={bid}"
    assert client(env).get(change_map).status_code == 401
    assert client(env, 'customer2').get(change_map).status_code == 404
    customer = client(env, 'customer')
    assert customer.get(change_map).json['data']['source_booking_status'] == 'CONFIRMED'
    response = customer.post(f'/api/bookings/{bid}/refund', json={'preview_token': preview['preview_token']},
                             headers={**headers, 'Idempotency-Key':key()})
    assert response.status_code == 200
    assert customer.get(change_map).json['data']['source_booking_status'] == 'CUSTOMER_CANCELLED'
    history = customer.get('/api/ui/bookings?status=HISTORY').json['data']['items']
    assert history[0]['status'] == 'CUSTOMER_CANCELLED'
    assert customer.get('/api/ui/bookings?status=CONFIRMED').json['data']['total'] == 0
    assert customer.get(f'/api/ui/bookings/{bid}').json['data']['cancellation']['refund_minor'] > 0


def test_replay_after_expired_token_and_no_second_refund(env, monkeypatch):
    purchase, hold = buy(env)
    bid, request_key = purchase['booking_id'], key()
    preview = cancellations.refund_preview(actor(env), bid)
    first = refund(env, bid, preview=preview, request_key=request_key)
    with monkeypatch.context() as patch:
        patch.setattr(cancellations, 'decode', lambda *args: pytest.fail('Successful replay must precede token expiry validation'))
        second = refund(env, bid, preview=preview, request_key=request_key)
    assert wire(first) == wire(second)
    with pytest.raises(Problem) as error:
        refund(env, bid, preview=preview)
    assert error.value.code == 'BOOKING_STATE'
    with db().connect() as c:
        assert count(c, 'refunds') == 1
        assert one(c, "SELECT COUNT(*) n FROM wallet_entries WHERE entry_type='REFUND'")['n'] == 1
    recovered = booking.payment_result(actor(env), hold['hold_id'])
    assert recovered['receipt']['status'] == 'CUSTOMER_CANCELLED'


def test_cutoff_and_changed_fee_require_fresh_confirmation(env):
    purchase, hold = buy(env)
    bid = purchase['booking_id']
    with db().connect() as c:
        start = get(c, 'screenings', hold['screening_id'])['starts_at']
    env['clock'][0] = start - timedelta(hours=12)
    preview = cancellations.refund_preview(actor(env), bid)
    env['clock'][0] += timedelta(seconds=1)
    with pytest.raises(Problem) as error:
        refund(env, bid, preview=preview)
    assert error.value.code == 'PREVIEW_CHANGED'
    preview = cancellations.refund_preview(actor(env), bid)
    env['clock'][0] = start - timedelta(seconds=1799)
    with pytest.raises(Problem) as error:
        refund(env, bid, preview=preview)
    assert error.value.code == 'REFUND_CLOSED'
    with db().connect() as c:
        assert get(c, 'bookings', bid)['status'] == 'CONFIRMED'
        assert count(c, 'seat_allocations') == 2
        assert count(c, 'refunds') == 0


def test_pending_reschedule_hold_released_and_previous_fees_kept(env):
    original, _ = buy(env, index=0)  # 3h -> 20% change fee
    changed, _ = buy(env, index=1, source=original['booking_id'])
    bid = changed['booking_id']
    other = booking.create_hold(actor(env), dict(screening_id=env['ids']['screenings'][2],
        seat_ids=env['ids']['seats'][str(env['ids']['layouts'][0])][:2], source_booking_id=bid), key())
    result = refund(env, bid)
    with db().connect() as c:
        assert get(c, 'bookings', original['booking_id'])['status'] == 'RESCHEDULED'
        assert get(c, 'seat_holds', other['hold_id'])['status'] == 'CANCELLED'
        assert count(c, 'seat_allocations') == 0
        assert count(c, 'tickets') == 4
        assert one(c, 'SELECT SUM(amount_minor) n FROM settlement_entries')['n'] == changed['cumulative_fee_minor'] + result['fee_minor']
        assert one(c, 'SELECT balance_minor FROM wallets WHERE customer_id=:u', u=actor(env)['id'])['balance_minor'] == 100000 - changed['cumulative_fee_minor'] - result['fee_minor']


@pytest.mark.parametrize("past_cutoff", [False, True])
def test_reschedule_hold_at_original_screening_cutoff(env, past_cutoff):
    original, first_hold = buy(env, index=0)
    buyer = actor(env)
    target = env["ids"]["screenings"][1]
    seats = first_hold["seat_ids"]
    with db().connect() as c:
        cutoff = get(c, "screenings", first_hold["screening_id"])["starts_at"] - timedelta(minutes=30)
    env["clock"][0] = cutoff - timedelta(seconds=15)
    hold = booking.create_hold(buyer, dict(screening_id=target, seat_ids=seats,
                                            source_booking_id=original["booking_id"]), key())
    env["clock"][0] = cutoff
    quote = booking.quote(buyer, hold["hold_id"], dict(tickets=[dict(seat_id=s, fare_type="STANDARD") for s in seats]))
    if not past_cutoff:
        changed = booking.checkout(buyer, dict(quote_token=quote["quote_token"]), key())
        with db().connect() as c:
            assert get(c, "bookings", changed["booking_id"])["predecessor_id"] == original["booking_id"]
        return

    env["clock"][0] += timedelta(microseconds=1)
    assert booking.payment_result(buyer, hold["hold_id"])["status"] == "EXPIRED"
    with db().connect() as c:
        available = {s["id"] for s in seatmap(c, target)["seats"] if s["state"] == "AVAILABLE"}
        assert set(seats) <= available
    with pytest.raises(Problem) as error:
        booking.checkout(buyer, dict(quote_token=quote["quote_token"]), key())
    assert error.value.code == "HOLD_EXPIRED"
    rival = booking.create_hold(actor(env, "customer2"), dict(screening_id=target, seat_ids=seats), key())
    assert set(rival["seat_ids"]) == set(seats)
    assert rival["expires_at"] == env["clock"][0] + timedelta(minutes=5)
    with db().connect() as c:
        assert get(c, "bookings", original["booking_id"])["status"] == "CONFIRMED"
        assert one(c, "SELECT balance_minor FROM wallets WHERE customer_id=:u", u=buyer["id"])["balance_minor"] == original["balance_minor"]


def test_failure_rolls_back_money_seats_and_order(env, monkeypatch):
    purchase, _ = buy(env)
    bid = purchase['booking_id']
    original = cancellations.wallet_post
    def fail_after_credit(*args):
        original(*args)
        raise RuntimeError('injected wallet failure')
    monkeypatch.setattr(cancellations, 'wallet_post', fail_after_credit)
    with pytest.raises(RuntimeError):
        refund(env, bid)
    with db().connect() as c:
        assert get(c, 'bookings', bid)['status'] == 'CONFIRMED'
        assert count(c, 'refunds') == count(c, 'booking_cancellations') == 0
        assert count(c, 'seat_allocations') == 2
        assert one(c, 'SELECT balance_minor FROM wallets WHERE customer_id=:u', u=actor(env)['id'])['balance_minor'] == 100000-purchase['net_ticket_minor']


def test_concurrent_requests_credit_once(env):
    purchase, _ = buy(env)
    bid = purchase['booking_id']
    p = cancellations.refund_preview(actor(env), bid)
    barrier = Barrier(2)
    def run():
        with env['app'].app_context():
            barrier.wait(timeout=5)
            try:
                return refund(env, bid, preview=p)
            except Problem as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(), range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 'BOOKING_STATE' in results
    with db().connect() as c:
        assert count(c, 'refunds') == 1
        assert count(c, 'seat_allocations') == 0


def test_coupon_refunds_net_value_without_restoring_or_issuing_coupon(env):
    purchase, hold = buy(env, index=0)
    manager = actor(env, 'manager1')
    p = management.cancel_preview(manager, hold['screening_id'], {'reason':'test cancellation'})
    management.cancel_confirm(manager, hold['screening_id'], {'preview_token':p['preview_token']}, key())
    management.process_pending_refunds()
    with db().connect() as c:
        coupon = one(c, 'SELECT id FROM coupons WHERE owner_id=:u', u=actor(env)['id'])['id']
    discounted, _ = buy(env, coupon=coupon)
    with db().connect() as c:
        b = get(c, 'bookings', discounted['booking_id'])
        assert discounted['net_ticket_minor'] == booking.rounded(b['gross_ticket_minor'], 5000)
    result = refund(env, discounted['booking_id'])
    assert result['refund_minor'] == discounted['net_ticket_minor']
    with db().connect() as c:
        assert get(c, 'coupons', coupon)['status'] == 'USED'
        assert count(c, 'coupons') == 1


def test_cinema_cancellation_reports_missing_wallet_without_partial_changes(env):
    purchase, hold = buy(env, index=0)
    manager = actor(env, 'manager1')
    preview = management.cancel_preview(
        manager,
        hold['screening_id'],
        {'reason': 'test missing wallet'},
    )
    with db().begin() as c:
        wallet = one(c, 'SELECT id FROM wallets WHERE customer_id=:u', u=actor(env)['id'])
        c.exec_driver_sql('DELETE FROM settlement_entries')
        c.exec_driver_sql('DELETE FROM wallet_entries WHERE wallet_id=%s', (wallet['id'],))
        c.exec_driver_sql('DELETE FROM payments WHERE wallet_id=%s', (wallet['id'],))
        c.exec_driver_sql('DELETE FROM wallets WHERE id=%s', (wallet['id'],))

    with pytest.raises(Problem) as error:
        management.cancel_confirm(
            manager,
            hold['screening_id'],
            {'preview_token': preview['preview_token']},
            key(),
        )

    assert error.value.code == 'WALLET_MISSING'
    assert error.value.status == 409
    with db().connect() as c:
        assert get(c, 'screenings', hold['screening_id'])['status'] == 'PUBLISHED'
        assert get(c, 'bookings', purchase['booking_id'])['status'] == 'CONFIRMED'
        assert count(c, 'refunds') == 0


def test_migration_repeat_preserves_transactions(env):
    purchase, _ = buy(env)
    refund(env, purchase['booking_id'])
    tables = ['bookings','tickets','payments','refunds','wallets','wallet_entries','settlement_entries','booking_cancellations']
    with db().connect() as c:
        before = {t: rows(c, f'SELECT * FROM {t} ORDER BY id') for t in tables}
    cancellations.initialize_cancellations(db())
    cancellations.initialize_cancellations(db())
    with db().connect() as c:
        assert before == {t: rows(c, f'SELECT * FROM {t} ORDER BY id') for t in tables}
        clauses = ' '.join(
            row['CHECK_CLAUSE']
            for row in rows(
                c,
                """SELECT cc.CHECK_CLAUSE
                   FROM information_schema.CHECK_CONSTRAINTS cc
                   JOIN information_schema.TABLE_CONSTRAINTS tc
                     ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA
                    AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME
                   WHERE cc.CONSTRAINT_SCHEMA=DATABASE()
                     AND tc.TABLE_NAME IN ('bookings','operations','refunds')""",
            )
        )
        assert 'CUSTOMER_CANCELLED' in clauses
        assert 'CANCEL_BOOKING' in clauses
        assert 'CUSTOMER_CANCELLATION' in clauses


def test_customer_refund_invalidates_cinema_preview_without_double_refund(env):
    purchase, hold = buy(env)
    manager = actor(env, 'manager1')
    cp = management.cancel_preview(manager, hold['screening_id'], {'reason':'Screen maintenance'})
    refund(env, purchase['booking_id'])
    with pytest.raises(Problem) as error:
        management.cancel_confirm(manager, hold['screening_id'], {'preview_token':cp['preview_token']}, key())
    assert error.value.code == 'PREVIEW_CHANGED'
    cp = management.cancel_preview(manager, hold['screening_id'], {'reason':'Screen maintenance'})
    management.cancel_confirm(manager, hold['screening_id'], {'preview_token':cp['preview_token']}, key())
    management.process_pending_refunds()
    with db().connect() as c:
        assert count(c, 'refunds') == 1
        assert count(c, 'coupons') == 0


def test_cinema_cancellation_invalidates_customer_preview(env):
    purchase, hold = buy(env)
    p = cancellations.refund_preview(actor(env), purchase['booking_id'])
    manager = actor(env, 'manager1')
    cp = management.cancel_preview(manager, hold['screening_id'], {'reason':'Screen maintenance'})
    management.cancel_confirm(manager, hold['screening_id'], {'preview_token':cp['preview_token']}, key())
    with pytest.raises(Problem) as error:
        refund(env, purchase['booking_id'], preview=p)
    assert error.value.code == 'BOOKING_STATE'
    with db().connect() as c:
        assert count(c, 'refunds') == 1
        assert count(c, 'booking_cancellations') == 0


def test_unrelated_hold_survives_refund(env):
    purchase, _ = buy(env)
    pending = booking.create_hold(actor(env), dict(screening_id=env['ids']['screenings'][0],
        seat_ids=env['ids']['seats'][str(env['ids']['layouts'][0])][:1]), key())
    refund(env, purchase['booking_id'])
    with db().connect() as c:
        assert get(c, 'seat_holds', pending['hold_id'])['status'] == 'ACTIVE'
        assert count(c, 'seat_allocations') == 1
    from cinema.assistant_reads import orders
    assert orders(actor(env), 'CUSTOMER_CANCELLED')[0]['status'] == 'CUSTOMER_CANCELLED'
