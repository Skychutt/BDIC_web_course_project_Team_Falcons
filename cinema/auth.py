import hashlib
import hmac
import re
from flask import current_app
from werkzeug.security import check_password_hash, generate_password_hash
from .core import *


def credentials(data):
    email = string(data.get("email"), "email", 254).casefold()
    require(
        re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) is not None,
        "VALIDATION",
        "Invalid email",
    )
    password = data.get("password")
    require(
        isinstance(password, str) and 10 <= len(password) <= 128,
        "VALIDATION",
        "Password must contain 10..128 characters",
    )
    return email, password


def public_user(user):
    return {
        k: user[k]
        for k in ("id", "display_name", "email_normalized", "role", "staff_cinema_id")
    }


def register(data, key):
    email, password = credentials(data)
    name = string(data.get("display_name"), "display_name", 80)
    require(
        set(data) <= {"email", "password", "display_name"},
        "VALIDATION",
        "Registration only accepts name, email and password",
    )
    # A keyed digest supports exact replay without storing plaintext or a fast password digest.
    proof = hmac.new(
        current_app.config["SECRET_KEY"].encode(), password.encode(), hashlib.sha256
    ).hexdigest()
    payload = dict(
        action="REGISTER", email=email, display_name=name, password_proof=proof
    )
    password_hash = generate_password_hash(password)

    def work(c):
        existing = one(c, "SELECT * FROM users WHERE email_normalized=:e", e=email)
        if existing:
            result = replay(c, existing["id"], key, payload)
            require(
                result is not None, "EMAIL_EXISTS", "Email is already registered", 409
            )
            return result
        at = now()
        uid = ins(
            c,
            "users",
            display_name=name,
            email_normalized=email,
            password_hash=password_hash,
            role="CUSTOMER",
            created_at=at,
        )
        wallet = ins(c, "wallets", customer_id=uid, balance_minor=0, updated_at=at)
        user = get(c, "users", uid)
        result = dict(user=public_user(user), balance_minor=100000)
        op = operation(c, user, key, payload, "REGISTER", result)
        ins(
            c,
            "wallet_entries",
            wallet_id=wallet,
            owner_id=uid,
            operation_id=op,
            entry_type="INITIAL_CREDIT",
            amount_minor=100000,
            balance_after_minor=100000,
            created_at=at,
        )
        upd(c, "wallets", wallet, balance_minor=100000)
        return result

    return transaction(work)


def login(data):
    email, password = credentials(data)
    with db().connect() as c:
        user = one(c, "SELECT * FROM users WHERE email_normalized=:e", e=email)
    # Match the expensive hash path even for unknown emails.
    target = (
        user["password_hash"] if user else current_app.extensions["dummy_password_hash"]
    )
    valid = check_password_hash(target, password)
    require(user and valid, "LOGIN_FAILED", "Email or password is incorrect", 401)
    return public_user(user)
