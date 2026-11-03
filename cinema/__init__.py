import hmac
import os
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, session
from sqlalchemy.exc import DBAPIError
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash
from .core import Problem, make_engine, one, require, wire


def create_app(config=None):
    load_dotenv()
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY"),
        DATABASE_URL=os.getenv("DATABASE_URL"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        SESSION_REFRESH_EACH_REQUEST=False,
        MAX_CONTENT_LENGTH=1024 * 1024,
        JSON_SORT_KEYS=False,
        ENABLE_AI=True,
        DATA_SOURCE="backend",
        AI_USE_HOST_CSRF=True,
        AI_ENVELOPE=True,
        AI_PROVIDER=os.getenv("AI_PROVIDER", "stub"),
        DEEPSEEK_API_KEY=os.getenv("DEEPSEEK_API_KEY", ""),
        DEEPSEEK_MODEL=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
        AI_TIMEOUT_SECONDS=os.getenv("AI_TIMEOUT_SECONDS", "10"),
        AMAP_JS_KEY=os.getenv("AMAP_JS_KEY", ""),
        AMAP_SECURITY_CODE=os.getenv("AMAP_SECURITY_CODE", ""),
    )
    if config:
        app.config.update(config)
    require(
        isinstance(app.config["SECRET_KEY"], str)
        and len(app.config["SECRET_KEY"]) >= 32
        and not app.config["SECRET_KEY"].startswith("REPLACE_"),
        "CONFIG",
        "Set SECRET_KEY to at least 32 random characters",
    )
    app.extensions["db"] = make_engine(app.config["DATABASE_URL"])
    app.extensions["dummy_password_hash"] = generate_password_hash(
        "dummy-password-never-used"
    )
    rate_buckets = defaultdict(deque)
    rate_lock = threading.Lock()

    @app.before_request
    def security():
        g.actor = None
        if (
            request.path.startswith("/api/auth/")
            and request.method == "POST"
            and not app.testing
        ):
            # Single-process demo throttle; production multi-worker deployments need a shared limiter.
            with rate_lock:
                at = time.monotonic()
                ip = request.remote_addr or "unknown"
                if len(rate_buckets) > 10000:
                    for k in list(rate_buckets):
                        if not rate_buckets[k] or rate_buckets[k][-1] < at - 60:
                            del rate_buckets[k]
                bucket = rate_buckets[ip]
                while bucket and bucket[0] < at - 60:
                    bucket.popleft()
                require(
                    len(bucket) < 15,
                    "RATE_LIMIT",
                    "Too many authentication requests; retry in a minute",
                    429,
                )
                bucket.append(at)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            csrf = request.headers.get("X-CSRF-Token", "")
            expected = session.get("csrf", "")
            require(
                expected and csrf.isascii() and hmac.compare_digest(csrf, expected),
                "CSRF",
                "Obtain /api/auth/csrf and send X-CSRF-Token with this session",
                403,
            )
        uid = session.get("user_id")
        if uid:
            with app.extensions["db"].connect() as c:
                g.actor = one(c, "SELECT * FROM users WHERE id=:id", id=int(uid))
            if not g.actor:
                session.clear()

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Permissions-Policy"] = "geolocation=(self)"
        # AMap requires dynamic compilation. Confine this to the dedicated frame;
        # the booking/AI document retains its strict self-only script policy.
        if request.endpoint == "maps.embed":
            response.headers["X-Frame-Options"] = "SAMEORIGIN"
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'unsafe-eval' https://webapi.amap.com; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob: https://*.amap.com https://*.autonavi.com; "
                "font-src 'self' data:; connect-src 'self' https://*.amap.com https://*.autonavi.com; "
                "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
                "form-action 'none'; frame-ancestors 'self'"
            )
        response.headers.setdefault("Content-Security-Policy", (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self'; connect-src 'self'; "
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
            if not request.path.startswith("/api/")
            else "default-src 'none'; frame-ancestors 'none'"
        ))
        return response

    @app.errorhandler(Problem)
    def problem(exc):
        return jsonify(
            error=wire(dict(code=exc.code, message=exc.message, details=exc.details))
        ), exc.status

    @app.errorhandler(HTTPException)
    def http(exc):
        return jsonify(
            error=dict(code=exc.name.upper().replace(" ", "_"), message=exc.description)
        ), exc.code

    @app.errorhandler(DBAPIError)
    def database_error(exc):
        app.logger.exception("Database operation failed")
        return jsonify(
            error=dict(
                code="DATABASE_UNAVAILABLE",
                message="Database request failed; retry later with the same idempotency key",
            )
        ), 503

    @app.errorhandler(Exception)
    def unexpected(exc):
        app.logger.exception("Unexpected API error")
        return jsonify(
            error=dict(code="INTERNAL_ERROR", message="Unexpected server error")
        ), 500

    from .api import api

    app.register_blueprint(api)
    from .frontend_api import ui_api
    from .web import web
    app.register_blueprint(ui_api)
    app.register_blueprint(web)
    from .maps import init_app as init_maps
    init_maps(app)
    from .cli import register_cli

    register_cli(app)
    if app.config["ENABLE_AI"]:
        from cinema_ai import init_app
        init_app(app)
    return app
