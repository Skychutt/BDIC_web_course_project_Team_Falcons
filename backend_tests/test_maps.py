from contextlib import contextmanager

import httpx
import pytest

from cinema import create_app


@pytest.fixture
def map_app():
    app = create_app({"TESTING": True, "SECRET_KEY": "map-test-secret-" * 3,
                      "DATABASE_URL": "mysql+pymysql://unused@127.0.0.1/unused", "ENABLE_AI": False,
                      "AMAP_JS_KEY": "public-js-key", "AMAP_SECURITY_CODE": "private-map-code"})
    yield app
    app.extensions["db"].dispose()


def test_map_config_exposes_only_public_key_and_scopes_csp(map_app):
    client = map_app.test_client()
    config = client.get("/api/maps/config")
    assert config.json["data"]["enabled"]
    assert config.json["data"]["key"] == "public-js-key"
    assert "private-map-code" not in config.text
    assert "webapi.amap.com" not in client.get("/").headers["Content-Security-Policy"]
    frame = client.get("/maps/embed")
    assert "webapi.amap.com" in frame.headers["Content-Security-Policy"]
    assert "'unsafe-eval'" in frame.headers["Content-Security-Policy"]
    assert "frame-ancestors 'self'" in frame.headers["Content-Security-Policy"]
    assert frame.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert "unsafe-eval" not in config.headers["Content-Security-Policy"]
    assert config.headers["Cache-Control"] == "no-store"
    map_app.config["AMAP_SECURITY_CODE"] = ""
    disabled = client.get("/api/maps/config").json["data"]
    assert not disabled["enabled"] and disabled["key"] is None
    assert "amap.com" not in client.get("/").headers["Content-Security-Policy"]
    assert client.get("/_AMapService/v4/maps").status_code == 503


def test_proxy_fixed_upstream_replaces_credentials_and_hides_secret(map_app, monkeypatch):
    seen = []
    @contextmanager
    def stream(method, url, **kwargs):
        seen.append((method, url, kwargs))
        yield httpx.Response(200, content=b'cb({"ok":true,"unexpected":"private-map-code"})')
    monkeypatch.setattr("cinema.maps.httpx.stream", stream)
    response = map_app.test_client().get("/_AMapService/v3/geocode/regeo?key=attacker&jscode=attacker&callback=cb",
                                         headers={"Cookie": "private-cookie", "Authorization": "private-token"})
    assert response.status_code == 200 and response.mimetype == "application/javascript"
    assert "private-map-code" not in response.text
    method, url, kwargs = seen[0]
    assert method == "GET" and url == "https://restapi.amap.com/v3/geocode/regeo"
    assert kwargs["params"]["key"] == "public-js-key" and kwargs["params"]["jscode"] == "private-map-code"
    assert kwargs["follow_redirects"] is False and "headers" not in kwargs


@pytest.mark.parametrize("url,headers,status", [
    ("/_AMapService/https://evil.example", {}, 404),
    ("/_AMapService/v3/place/text", {}, 404),
    ("/_AMapService/v4/maps?callback=alert(1)", {}, 400),
    ("/_AMapService/v4/maps?output=xml", {}, 400),
    ("/_AMapService/v4/maps", {"Sec-Fetch-Site": "cross-site"}, 403),
    ("/_AMapService/v4/maps?x=" + "a" * 8193, {}, 400),
])
def test_proxy_rejects_unsupported_requests_before_network(map_app, monkeypatch, url, headers, status):
    def forbidden(*args, **kwargs):
        pytest.fail("Rejected requests must not reach AMap")
    monkeypatch.setattr("cinema.maps.httpx.stream", forbidden)
    assert map_app.test_client().get(url, headers=headers).status_code == status


@pytest.mark.parametrize("mode", ["timeout", "redirect", "oversize", "html"])
def test_proxy_bounded_failures(map_app, monkeypatch, mode):
    @contextmanager
    def stream(*args, **kwargs):
        if mode == "timeout": raise httpx.ReadTimeout("URL with secret must not be logged")
        yield httpx.Response(302 if mode == "redirect" else 200,
                             content=b"x" * (2 * 1024 * 1024 + 1) if mode == "oversize" else b"<html>bad gateway</html>")
    monkeypatch.setattr("cinema.maps.httpx.stream", stream)
    response = map_app.test_client().get("/_AMapService/v4/maps")
    assert response.status_code == 502
    assert "private-map-code" not in response.text


def test_proxy_throttles_before_network(map_app, monkeypatch):
    import time
    from collections import deque
    map_app.extensions["amap_limiter"][1]["127.0.0.1"] = deque([time.monotonic()] * 90)
    def forbidden(*args, **kwargs): pytest.fail("Throttled request reached network")
    monkeypatch.setattr("cinema.maps.httpx.stream", forbidden)
    assert map_app.test_client().get("/_AMapService/v4/maps").status_code == 429
