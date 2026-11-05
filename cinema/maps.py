"""AMap JS API configuration and a bounded, fixed-upstream security proxy.

User coordinates are never stored or sent to the language model. This proxy only
supports the read services used by the browser map; it is not a general HTTP proxy.
"""
import re
import logging
import threading
import time
from collections import defaultdict, deque

import httpx
from flask import Blueprint, Response, current_app, jsonify, request, render_template

from .core import require

maps = Blueprint("maps", __name__)
ALLOWED_PATHS = frozenset({
    "v3/assistant/coordinate/convert", "v3/geocode/regeo", "v4/maps",
    "v4/map/styles", "v4/map/styles/list", "v3/direction/walking",
})


def configured():
    return bool(current_app.config.get("AMAP_JS_KEY") and current_app.config.get("AMAP_SECURITY_CODE"))


def init_app(app):
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    app.extensions["amap_limiter"] = (threading.Lock(), defaultdict(deque))
    app.register_blueprint(maps)


@maps.get("/maps/embed")
def embed():
    return render_template("map.html")


@maps.get("/api/maps/config")
def config():
    enabled = configured()
    return jsonify(data={"enabled": enabled, "key": current_app.config["AMAP_JS_KEY"] if enabled else None,
                         "service_host": "/_AMapService", "coordinate_system": "GCJ02"})


@maps.get("/_AMapService/<path:service>")
def proxy(service):
    require(configured(), "MAP_NOT_CONFIGURED", "Map service is not configured.", 503)
    require(service in ALLOWED_PATHS, "MAP_SERVICE_NOT_ALLOWED", "This map service is unavailable.", 404)
    require(request.headers.get("Sec-Fetch-Site") not in {"cross-site"}, "MAP_ORIGIN", "Use the map on this website.", 403)
    require(len(request.query_string) <= 8192, "MAP_QUERY", "Map request is too large.")
    params = request.args.to_dict()
    callback = params.get("callback")
    require(not callback or bool(re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*", callback, re.ASCII)),
            "MAP_QUERY", "Invalid map callback.")
    require(params.get("output", "json").lower() == "json", "MAP_QUERY", "Only JSON map responses are supported.")
    lock, buckets = current_app.extensions["amap_limiter"]
    with lock:
        now = time.monotonic()
        for ip in list(buckets):
            if not buckets[ip] or buckets[ip][-1] <= now - 60:
                del buckets[ip]
        bucket = buckets[request.remote_addr or "unknown"]
        while bucket and bucket[0] <= now - 60:
            bucket.popleft()
        require(len(buckets) <= 5000 and len(bucket) < 90, "MAP_RATE_LIMIT", "Too many map requests. Retry shortly.", 429)
        bucket.append(now)
    params["key"] = current_app.config["AMAP_JS_KEY"]
    secret = current_app.config["AMAP_SECURITY_CODE"]
    params["jscode"] = secret
    # Never forward browser cookies, auth headers, redirects, or arbitrary hosts.
    # Stream to enforce a real response cap, even if Content-Length is absent.
    try:
        with httpx.stream("GET", "https://restapi.amap.com/" + service, params=params,
                          timeout=6.0, follow_redirects=False) as upstream:
            if upstream.status_code != 200:
                return jsonify(error={"code": "MAP_UNAVAILABLE", "message": "AMap could not complete the request."}), 502
            chunks, size = [], 0
            for chunk in upstream.iter_bytes():
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    return jsonify(error={"code": "MAP_UNAVAILABLE", "message": "Map response exceeded the limit."}), 502
                chunks.append(chunk)
        content = b"".join(chunks).decode("utf-8").replace(secret, "[redacted]")
        # The SDK uses JSONP; reject HTML/redirect pages instead of executing them.
        stripped = content.lstrip()
        require(stripped.startswith(("{", "[", callback + "(" if callback else "{",
                                     callback + " (" if callback else "{")),
                "MAP_RESPONSE", "Invalid map service response.", 502)
        return Response(content, mimetype="application/javascript" if callback else "application/json")
    except (httpx.HTTPError, UnicodeError):
        # Do not log exceptions: upstream URLs contain jscode and coordinates.
        return jsonify(error={"code": "MAP_UNAVAILABLE", "message": "AMap is unavailable. Retry or choose a district manually."}), 502
