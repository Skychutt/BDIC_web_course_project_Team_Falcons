import hmac
import secrets

from flask import Blueprint, current_app, jsonify, render_template, request, session
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge, UnsupportedMediaType

from .catalog import DISTRICTS
from .domain import ChatInput, Filters
from .messages import tr
from .localization import reply_locale
from .providers import ProviderError
from .conversation import public_state, record_conditions
from .tool_types import RecoveryQuery

blueprint = Blueprint("cinema_ai", __name__, template_folder="templates", static_folder="static", static_url_path="/assistant-static")


def services():
    return current_app.extensions["cinema_ai"]


def current_conversation():
    sid, conversation = services()["sessions"].get(session.get("cinema_ai_sid"))
    session["cinema_ai_sid"] = sid
    return conversation


def locale():
    try:
        body = request.get_json(silent=True) if request.is_json else None
    except (BadRequest, RequestEntityTooLarge, UnsupportedMediaType):
        body = None
    language = body.get("locale") if isinstance(body, dict) else None
    fallback = "en" if (language or request.args.get("locale")) == "en" else "zh"
    if isinstance(body, dict) and isinstance(body.get("message"), str):
        return reply_locale(body["message"], fallback)
    return fallback


def error(key, status, code=None):
    if current_app.config.get("AI_ENVELOPE"):
        return jsonify(error={"code": code or key, "message": tr(key, locale())}), status
    return jsonify(error_code=code or key, reply=tr(key, locale())), status


def output(value=None, **kwargs):
    value = value if value is not None else kwargs
    if current_app.config.get("AI_ENVELOPE"):
        from cinema.core import wire
        return jsonify(data=wire(value))
    return jsonify(value)


def csrf_token(conversation):
    if current_app.config.get("AI_USE_HOST_CSRF"):
        return session.setdefault("csrf", secrets.token_urlsafe(32))
    return conversation.csrf


def csrf_valid(conversation):
    supplied = request.headers.get("X-CSRF-Token", "")
    return supplied.isascii() and hmac.compare_digest(supplied, csrf_token(conversation))


@blueprint.get("/assistant")
def index():
    return render_template("assistant.html")


@blueprint.get("/api/ai/session")
def bootstrap():
    conversation = current_conversation()
    catalog = services()["catalog"]
    return output(csrf_token=csrf_token(conversation), **public_state(conversation),
                   provider=services()["provider"].name, data_source=catalog.repository.source_name,
                   districts=[{"id": code, "zh": labels[0], "en": labels[1]} for code, labels in DISTRICTS.items()],
                   films=[{"id": f.id, "titles": f.titles} for f in catalog.repository.films()],
                   today=services()["clock"]().date().isoformat())


@blueprint.post("/api/ai/chat")
@blueprint.post("/api/assistant/chat")
def chat():
    request.max_content_length = 16 * 1024
    if request.content_length and request.content_length > 16 * 1024:
        return error("invalid_input", 400)
    conversation = current_conversation()
    if not csrf_valid(conversation):
        return error("csrf", 403)
    body = ChatInput.model_validate(request.get_json())
    if not conversation.lock.acquire(blocking=False):
        return error("busy", 409)
    try:
        from flask import g
        return output(services()["chat"].chat(conversation, body.message, body.locale, actor=getattr(g, "actor", None)))
    finally:
        conversation.lock.release()


@blueprint.delete("/api/ai/session")
def reset():
    conversation = current_conversation()
    if not csrf_valid(conversation):
        return error("csrf", 403)
    if not conversation.lock.acquire(blocking=False):
        return error("busy", 409)
    try:
        conversation.conditions.clear()
        conversation.new_task(services()["clock"]().date())
        conversation.history.clear()
        conversation.candidates.clear()
        conversation.last_task = None
        return output(**public_state(conversation), cleared=True)
    finally:
        conversation.lock.release()


@blueprint.patch("/api/ai/preferences")
def preferences():
    from .domain import FilterPatch
    from .conversation import merge_filters
    conversation = current_conversation()
    if not csrf_valid(conversation):
        return error("csrf", 403)
    patch = FilterPatch.model_validate(request.get_json())
    if not conversation.lock.acquire(blocking=False):
        return error("busy", 409)
    try:
        old = conversation.filters
        conversation.filters = merge_filters(conversation.filters, patch, services()["clock"]().date())
        record_conditions(conversation, old, patch.model_dump(exclude_unset=True), "手动筛选" if locale() == "zh" else "Manual filter selection", manual=True)
        conversation.task_action = "modify"
        conversation.candidates.pop("cards", None)
        return output(**public_state(conversation))
    finally:
        conversation.lock.release()


@blueprint.post("/api/ai/recovery")
def recovery():
    request.max_content_length = 4096
    conversation = current_conversation()
    if not csrf_valid(conversation):
        return error("csrf", 403)
    body = request.get_json()
    if not isinstance(body, dict):
        raise ValueError("Expected object")
    body = dict(body)  # Preserve the cached request locale for validation errors.
    language = body.pop("locale", "zh")
    if language not in {"zh", "en"}:
        raise ValueError("Invalid locale")
    args = RecoveryQuery.model_validate(body)
    if not conversation.lock.acquire(blocking=False):
        return error("busy", 409)
    try:
        from flask import g
        return output(services()["chat"].recover(conversation, args, language, actor=getattr(g, "actor", None)))
    finally:
        conversation.lock.release()


@blueprint.get("/api/catalog/screenings")
def screenings():
    raw = request.args.to_dict()
    raw.pop("locale", None)
    raw.setdefault("date", services()["clock"]().date().isoformat())
    raw.setdefault("party_size", "1")
    for key in list(raw):
        if raw[key] == "":
            raw.pop(key)
    raw["party_size"] = int(raw.get("party_size", "1"))
    for key in ("budget_minor", "film_id", "cinema_id", "screening_id"):
        if key in raw:
            raw[key] = int(raw[key])
    if "min_rating" in raw:
        raw["min_rating"] = float(raw["min_rating"])
    for key in ("rated_only", "sort_by_rating", "showing_only", "recent", "require_contiguous"):
        if key in raw:
            if raw[key].lower() not in {"true", "false", "1", "0"}:
                raise ValueError("Invalid boolean")
            raw[key] = raw[key].lower() in {"true", "1"}
    filters = Filters.model_validate(raw)
    if filters.district and filters.district not in DISTRICTS:
        return error("invalid_input", 400)
    if filters.time_start == "24:00" or (filters.time_start and filters.time_end and filters.time_start >= filters.time_end):
        return error("invalid_input", 400)
    catalog = services()["catalog"]
    films = catalog.find_films(filters.film_query)
    if filters.film_query and len(films) != 1:
        return output(cards=[], filters=filters.model_dump(), status="needs_clarification",
                       reply=tr("ambiguous_film" if films else "unknown_film", locale()),
                       films=[catalog.film_data(f, locale()) for f in films])
    cards = catalog.recommend(filters, locale())
    return output(cards=cards, filters=filters.model_dump(), status="ok",
                   reply=tr("outside" if filters.city != "beijing" else "results" if cards else "no_results", locale()))


@blueprint.get("/api/catalog/screenings/<int:screening_id>")
def screening(screening_id):
    result = services()["catalog"].preview(screening_id, locale())
    if result is None:
        return error("not_found", 404)
    return output(result)


@blueprint.after_request
def headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    return response


@blueprint.errorhandler(ValidationError)
@blueprint.errorhandler(ValueError)
@blueprint.errorhandler(BadRequest)
@blueprint.errorhandler(RequestEntityTooLarge)
@blueprint.errorhandler(UnsupportedMediaType)
def invalid_input(_error):
    return error("invalid_input", 400)


@blueprint.errorhandler(ProviderError)
def provider_failure(exc):
    return error("busy" if exc.code == "busy" else "fallback", 503, exc.code)
