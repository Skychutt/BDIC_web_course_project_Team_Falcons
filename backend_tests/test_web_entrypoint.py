"""The rendered entry point must load a complete same-origin module graph."""

from html.parser import HTMLParser
import re
from urllib.parse import urljoin, urlparse

from cinema import create_app


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.modules = []
        self.stylesheets = []
        self.main_ids = []
        self.skip_targets = []
        self.language = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.language = attrs.get("lang")
        if tag == "script" and attrs.get("type") == "module":
            self.modules.append(attrs.get("src"))
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.stylesheets.append(attrs.get("href"))
        if tag == "main":
            self.main_ids.append(attrs.get("id"))
        if tag == "a" and "skip-link" in attrs.get("class", "").split():
            self.skip_targets.append(attrs.get("href"))


def test_html_csp_and_entire_static_module_graph_are_accessible():
    # The shell and assets do not require a live database connection.
    app = create_app({
        "TESTING": True,
        "SECRET_KEY": "web-entrypoint-fixture-secret-" * 3,
        "DATABASE_URL": "mysql+pymysql://unused@127.0.0.1/unused",
        "AMAP_JS_KEY": "", "AMAP_SECURITY_CODE": "",
    })
    try:
        client = app.test_client()
        response = client.get("/")
        assert response.status_code == 200 and response.mimetype == "text/html"
        csp = response.headers["Content-Security-Policy"]
        directives = {part.strip().split(" ", 1)[0]: part.strip().split(" ", 1)[1] for part in csp.split(";") if part.strip()}
        assert directives["script-src"] == "'self'"
        assert directives["connect-src"] == "'self'"
        assert directives["object-src"] == "'none'"
        assert directives["frame-ancestors"] == "'none'"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        parsed = Assets()
        parsed.feed(response.get_data(as_text=True))
        assert parsed.language and parsed.modules and parsed.stylesheets
        assert any(target == "#" + main_id for target in parsed.skip_targets for main_id in parsed.main_ids)
        # The map iframe has its own entry point and must also ship its full graph.
        map_assets = Assets()
        map_assets.feed(client.get("/maps/embed").get_data(as_text=True))
        parsed.modules.extend(map_assets.modules)
        parsed.stylesheets.extend(map_assets.stylesheets)
        seen = set()
        queue = list(parsed.modules)
        while queue:
            asset = queue.pop()
            if asset in seen:
                continue
            seen.add(asset)
            assert urlparse(asset).netloc == "" and asset.startswith("/static/")
            module = client.get(asset)
            assert module.status_code == 200, asset
            assert module.mimetype in ("text/javascript", "application/javascript"), asset
            source = module.get_data(as_text=True)
            imports = re.findall(r"(?m)^\s*import\s+(?:[^;\n]*?\s+from\s+)?['\"]([^'\"]+)['\"]", source)
            imports += re.findall(r"\bimport\s*\(\s*['\"]([^'\"]+)['\"]", source)
            queue.extend(urljoin(asset, imported) for imported in imports)
        assert len(seen) > 1  # Catch missing imports, not just a loadable root file.
        for asset in parsed.stylesheets:
            stylesheet = client.get(asset)
            assert stylesheet.status_code == 200 and stylesheet.mimetype == "text/css"
        api = client.get("/api/auth/csrf")
        assert api.status_code == 200 and api.is_json
        assert api.headers["Content-Security-Policy"] == "default-src 'none'; frame-ancestors 'none'"
    finally:
        app.extensions["cinema_ai"]["runner"].pool.shutdown(wait=True, cancel_futures=True)
        app.extensions["db"].dispose()
