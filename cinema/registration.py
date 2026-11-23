"""Short-lived registration codes and shared, rolling send quotas."""
import hmac
import math
import re
import secrets
from datetime import timedelta
from email.errors import HeaderParseError
from email.headerregistry import Address
from importlib.resources import files

from flask import current_app

from .core import Problem, execute, now, one, require, string, transaction
from .mail import deliver

CODE_LIFETIME = timedelta(minutes=5)
RESEND_DELAY = timedelta(minutes=1)
WINDOW = timedelta(hours=1)
EMAIL_LIMIT, SOURCE_LIMIT = 5, 20


def initialize_registration(engine):
    script = files("cinema").joinpath("sql/008_registration_email.sql").read_text(encoding="utf-8")
    with engine.begin() as c:
        for statement in script.split(";"):
            if statement.strip():
                c.exec_driver_sql(statement)


def keyed(label, value):
    return hmac.digest(current_app.secret_key.encode(), f"registration:{label}:{value}".encode(), "sha256").hex()


def normalized_email(value):
    email = string(value, "email", 254).casefold()
    require(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email), "VALIDATION", "Invalid email")
    return email


def send_code(data, source):
    require(set(data) == {"email"}, "VALIDATION", "Supply the registration email address")
    email = normalized_email(data["email"])
    try:
        address = Address(addr_spec=email)
        require(address.addr_spec == email, "VALIDATION", "Invalid email")
    except (HeaderParseError, ValueError):
        raise Problem("VALIDATION", "Invalid email") from None
    email_key, source_key = keyed("email", email), keyed("source", source)
    challenge, code = secrets.token_hex(16), f"{secrets.randbelow(1_000_000):06d}"

    def reserve(c):
        at = now()
        # Bounded pruning keeps inactive mailboxes and sources out of the database.
        execute(c, "DELETE FROM registration_codes WHERE created_at<:cutoff ORDER BY created_at LIMIT 32", cutoff=at-WINDOW)
        execute(c, "DELETE FROM registration_send_locks WHERE touched_at<:cutoff ORDER BY touched_at LIMIT 64", cutoff=at-WINDOW)
        # Lock both buckets even on their first send, across all application workers.
        for bucket in sorted((email_key, source_key)):
            execute(c, """INSERT INTO registration_send_locks (bucket,touched_at) VALUES (:bucket,:at)
                ON DUPLICATE KEY UPDATE touched_at=:at""", bucket=bucket, at=at)
        for column, bucket, limit in (("email_key", email_key, EMAIL_LIMIT), ("source_key", source_key, SOURCE_LIMIT)):
            recent = one(c, f"""SELECT COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
                FROM registration_codes WHERE {column}=:bucket AND created_at>:since""", bucket=bucket, since=at-WINDOW)
            retry_at = at
            if column == "email_key" and recent["last_at"]:
                retry_at = max(retry_at, recent["last_at"] + RESEND_DELAY)
            if recent["n"] >= limit:
                retry_at = max(retry_at, recent["first_at"] + WINDOW)
            require(retry_at <= at, "REGISTRATION_RATE_LIMIT", "Please wait before requesting another email", 429,
                    retry_after_seconds=math.ceil((retry_at-at).total_seconds()))
        existing = one(c, "SELECT id FROM users WHERE email_normalized=:email", email=email)
        execute(c, "UPDATE registration_codes SET attempts_left=0 WHERE email_key=:e AND attempts_left>0", e=email_key)
        execute(c, """INSERT INTO registration_codes (challenge,email_key,source_key,code_hash,created_at,attempts_left)
            VALUES (:id,:email,:source,:proof,:at,:tries)""", id=challenge, email=email_key,
            source=source_key, proof=keyed(challenge, code), at=at, tries=0 if existing else 5)
        return existing is None

    if transaction(reserve):
        try:
            deliver(email, "Falcons Cinema · 注册验证码 / Verify your email",
                    f"注册验证码 / Code: {code}\n请在 5 分钟内在注册页面填写。请勿转发或发到聊天中。\n"
                    "Enter this code on the registration page within 5 minutes. Keep it private.")
        except Exception:
            transaction(lambda c: execute(c, "UPDATE registration_codes SET attempts_left=0 WHERE challenge=:id", id=challenge))
            raise
    return {"challenge_id": challenge, "resend_after_seconds": int(RESEND_DELAY.total_seconds())}


def read_proof(data):
    challenge, code = data.get("challenge_id"), data.get("code")
    require(isinstance(challenge, str) and re.fullmatch(r"[0-9a-f]{32}", challenge),
            "REGISTRATION_CODE_REQUIRED", "Request a verification code for this email")
    require(isinstance(code, str) and re.fullmatch(r"[0-9]{6}", code),
            "CODE_INVALID", "Enter the six-digit email code")
    return challenge, keyed(challenge, code)


def lock_challenge(c, email, challenge):
    return one(c, """SELECT created_at,code_hash,attempts_left FROM registration_codes
        WHERE challenge=:id AND email_key=:email FOR UPDATE""", id=challenge, email=keyed("email", email))


def consume(c, row, challenge, proof):
    require(row and row["attempts_left"] and row["created_at"] + CODE_LIFETIME > now(),
            "CODE_EXPIRED", "Code expired or replaced. Request a new code", 409)
    matches = hmac.compare_digest(row["code_hash"], proof)
    execute(c, "UPDATE registration_codes SET attempts_left=:n WHERE challenge=:id",
            n=0 if matches else row["attempts_left"]-1, id=challenge)
    return matches
