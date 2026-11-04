"""Flask app factory and drop-in Blueprint registration."""
import logging
import os
import secrets

from flask import Flask

from .catalog import CatalogService
from .conversation import SessionStore
from .agent import AgentService
from .domain import now_beijing
from .providers import DeepSeekProvider, ModelRunner, StubProvider
from .repository import MockCinemaRepository


def init_app(app, repository=None, provider=None, clock=None):
    """Register inside an existing Flask application with injected read adapters."""
    if "cinema_ai" in app.extensions:
        raise RuntimeError("cinema_ai already registered")
    clock = clock or now_beijing
    catalog = None
    if repository is None:
        source = app.config.get("DATA_SOURCE", "mock")
        if source == "backend":
            from .backend import BackendCatalog, BackendRepository, backend_clock
            clock = backend_clock
            repository = BackendRepository()
            catalog = BackendCatalog(repository, clock)
        elif source == "mock":
            repository = MockCinemaRepository(clock)
        else:
            raise ValueError("DATA_SOURCE must be mock or backend")
    if provider is None:
        mode = app.config.get("AI_PROVIDER", "stub")
        if mode == "stub":
            provider = StubProvider(repository)
        elif mode == "deepseek":
            provider = DeepSeekProvider(app.config.get("DEEPSEEK_API_KEY"), app.config.get("DEEPSEEK_MODEL", "deepseek-flash"))
        else:
            raise ValueError("AI_PROVIDER must be stub or deepseek")
    timeout = float(app.config.get("AI_TIMEOUT_SECONDS", 10))
    if not 0 < timeout <= 10:
        raise ValueError("AI_TIMEOUT_SECONDS must be in (0, 10]")
    catalog = catalog or CatalogService(repository, clock)
    runner = ModelRunner()
    app.extensions["cinema_ai"] = {
        "catalog": catalog, "provider": provider, "runner": runner,
        "sessions": SessionStore(clock), "clock": clock,
        "chat": AgentService(catalog, provider, runner, clock, timeout),
    }
    from .routes import blueprint
    app.register_blueprint(blueprint)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    # Access URLs can contain user-supplied filter text; do not log them by default.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


def create_app(config=None, *, repository=None, provider=None, clock=None):
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.getenv("SECRET_KEY") or secrets.token_hex(32),
        AI_PROVIDER=os.getenv("AI_PROVIDER", "stub"),
        DATA_SOURCE=os.getenv("DATA_SOURCE", "mock"),
        DEEPSEEK_API_KEY=os.getenv("DEEPSEEK_API_KEY", ""),
        DEEPSEEK_MODEL=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
        AI_TIMEOUT_SECONDS=os.getenv("AI_TIMEOUT_SECONDS", "10"),
        MAX_CONTENT_LENGTH=16 * 1024,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
    )
    if config:
        app.config.update(config)
    init_app(app, repository, provider, clock)
    app.add_url_rule("/", "assistant_home", app.view_functions["cinema_ai.index"])
    return app
