"""Customer ticket refunds: one atomic wallet credit and whole-party seat release."""
from datetime import timedelta
from importlib.resources import files

from .core import *
from .booking import decode, rounded, settlement, signer, wallet_post


def initialize_cancellations(engine):
    """Idempotent, additive upgrade for both existing and newly initialized databases."""
    extensions = (
        ('bookings', 'status', 'CUSTOMER_CANCELLED',
         "status IN ('CONFIRMED','RESCHEDULED','CINEMA_CANCELLED','CUSTOMER_CANCELLED')"),
        ('operations', 'operation_type', 'CANCEL_BOOKING',
         "operation_type IN ('REGISTER','HOLD','PURCHASE','RESCHEDULE','CANCEL_SCREENING','REPLACE_SCREENING','CANCEL_BOOKING')"),
        ('refunds', 'reason', 'CUSTOMER_CANCELLATION',
         "reason IN ('RESCHEDULE_DIFFERENCE','CINEMA_CANCELLATION','CUSTOMER_CANCELLATION')"),
    )
    with engine.begin() as c:
        for table, column, value, clause in extensions:
            checks = rows(c, """SELECT tc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS clause
                FROM information_schema.TABLE_CONSTRAINTS tc
                JOIN information_schema.CHECK_CONSTRAINTS cc
                  ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
                WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=:t AND tc.CONSTRAINT_TYPE='CHECK'""", t=table)
            matches = [r for r in checks if f'`{column}`' in r['clause'] and ' in ' in r['clause'].lower()]
            require(len(matches) == 1, 'SCHEMA_VERSION', f'Unexpected {table}.{column} constraint', 409)
            check = matches[0]
            if value not in check['clause']:
                name = check['name'].replace('`', '``')
                # One ALTER atomically replaces the check; other constraints stay enforced.
                c.exec_driver_sql(f'ALTER TABLE {table} DROP CHECK `{name}`, ADD CONSTRAINT `{name}` CHECK ({clause})')
        script = files('cinema').joinpath('sql/006_customer_cancellations.sql').read_text(encoding='utf-8')
        for statement in script.split(';'):
            if statement.strip():
                c.exec_driver_sql(statement)


REFUND_NOTICE_BY_RATE = {0: timedelta(hours=12), 500: timedelta(hours=6), 2000: timedelta(minutes=30)}


def refund_rate(starts_at, current):
    for rate, notice in REFUND_NOTICE_BY_RATE.items():
        if starts_at - current >= notice:
            return rate
    raise Problem('REFUND_CLOSED', 'Refunds close 30 minutes before the screening.', 409)


def preview_value(c, b, at):
    require(b['status'] == 'CONFIRMED', 'BOOKING_STATE', 'Only a confirmed booking can be refunded.', 409)
    show = get(c, 'screenings', b['screening_id'])
    require(show['status'] == 'PUBLISHED', 'BOOKING_STATE', 'This screening has already been cancelled.', 409)
    rate = refund_rate(show['starts_at'], at)
    fee = rounded(b['net_ticket_minor'], rate)
    return dict(booking_id=b['id'], screening_id=show['id'], starts_at=show['starts_at'],
                ticket_value_minor=b['net_ticket_minor'], fee_rate_bps=rate, fee_minor=fee,
                refund_minor=b['net_ticket_minor'] - fee,
                previous_fees_minor=b['cumulative_fee_minor'], coupon_used=bool(b['original_coupon_id']))


def refund_preview(actor, bid):
    role(actor, 'CUSTOMER')
    def work(c):
        b = get(c, 'bookings', bid)
        owner(actor, b)
        scope(c, booking_ids=[bid], customer_ids=[actor['id']])
        b = get(c, 'bookings', bid)
        at = now()
        value = preview_value(c, b, at)
        token = signer('customer-refund').dumps(dict(actor_id=actor['id'], booking_id=bid, fingerprint=digest(value)))
        labels = one(c, """SELECT f.title AS film_title,ci.name AS cinema_name,sc.name AS screen_name
            FROM screenings s JOIN films f ON f.id=s.film_id JOIN cinemas ci ON ci.id=s.cinema_id
            JOIN screens sc ON sc.id=s.screen_id WHERE s.id=:id""", id=b['screening_id'])
        tickets = rows(c, """SELECT s.row_no,s.seat_no FROM tickets t JOIN seats s ON s.id=t.seat_id
            WHERE t.booking_id=:id ORDER BY s.row_no,s.seat_no""", id=bid)
        valid_through = value['starts_at'] - REFUND_NOTICE_BY_RATE[value['fee_rate_bps']]
        return dict(**value, **labels, seats=tickets, preview_token=token, server_time=at,
                    fee_valid_through=valid_through)
    return transaction(work)


def cancel_booking(actor, bid, body, key):
    role(actor, 'CUSTOMER')
    payload = dict(action='CANCEL_BOOKING', booking_id=bid, preview_token=body.get('preview_token'))
    def work(c):
        prior = replay(c, actor['id'], key, payload)
        if prior is not None:
            return prior
        token = decode(payload['preview_token'], 'customer-refund')
        require(token.get('actor_id') == actor['id'] and token.get('booking_id') == bid,
                'FORBIDDEN', 'This refund confirmation belongs to another booking or customer.', 403)
        b = get(c, 'bookings', bid)
        owner(actor, b)
        scope(c, booking_ids=[bid], customer_ids=[actor['id']])
        prior = replay(c, actor['id'], key, payload)
        if prior is not None:
            return prior
        b = get(c, 'bookings', bid)
        wallet = one(c, 'SELECT * FROM wallets WHERE customer_id=:u FOR UPDATE', u=actor['id'])
        require(wallet is not None, 'WALLET_MISSING', 'Customer wallet is unavailable.', 409)
        at = now()
        # Recheck the cutoff and fee after all locks, never refund an unconfirmed amount.
        value = preview_value(c, b, at)
        require(digest(value) == token.get('fingerprint'), 'PREVIEW_CHANGED',
                'The refund amount changed. Review a fresh preview before confirming.', 409)
        result = dict(booking_id=bid, status='CUSTOMER_CANCELLED', **{
            k: value[k] for k in ('ticket_value_minor', 'fee_rate_bps', 'fee_minor', 'refund_minor')},
            balance_minor=wallet['balance_minor'] + value['refund_minor'], cancelled_at=at)
        opid = operation(c, actor, key, payload, 'CANCEL_BOOKING', result,
                         source_booking_id=bid, result_booking_id=bid, reason='Customer requested a whole-booking refund')
        rid = None
        if value['refund_minor']:
            rid = ins(c, 'refunds', booking_id=bid, operation_id=opid, owner_id=b['owner_id'],
                      cinema_id=b['cinema_id'], wallet_id=wallet['id'], reason='CUSTOMER_CANCELLATION',
                      amount_minor=value['refund_minor'], status='SUCCEEDED', attempt_count=1,
                      created_at=at, settled_at=at)
            wallet_post(c, wallet, b, opid, value['refund_minor'], 'REFUND', rid, at)
        settlement(c, b, opid, -value['ticket_value_minor'], value['fee_minor'],
                   'REFUND' if rid else 'ZERO', rid, at)
        ins(c, 'booking_cancellations', booking_id=bid, operation_id=opid, refund_id=rid,
            ticket_value_minor=value['ticket_value_minor'], fee_rate_bps=value['fee_rate_bps'],
            fee_minor=value['fee_minor'], refund_minor=value['refund_minor'], created_at=at)
        upd(c, 'bookings', bid, status='CUSTOMER_CANCELLED')
        execute(c, 'DELETE FROM seat_allocations WHERE ticket_id IN (SELECT id FROM tickets WHERE booking_id=:b)', b=bid)
        # A pending reschedule must not keep other seats held after its source ticket is invalidated.
        for hold in rows(c, "SELECT id FROM seat_holds WHERE source_booking_id=:b AND status='ACTIVE'", b=bid):
            execute(c, 'DELETE FROM seat_allocations WHERE hold_id=:h', h=hold['id'])
            upd(c, 'seat_holds', hold['id'], status='CANCELLED')
        ins(c, 'notices', owner_id=b['owner_id'], cinema_id=b['cinema_id'], booking_id=bid,
            operation_id=opid, created_at=at,
            body=f"Your tickets have been cancelled and all seats released. Refund: ¥{value['refund_minor']/100:.2f} to your demo wallet. Cancellation fee: ¥{value['fee_minor']/100:.2f}. These tickets are no longer valid.")
        return result
    return transaction(work)
