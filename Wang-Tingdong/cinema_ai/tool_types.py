"""Allowlisted read-tool contracts; identity and SQL are never model arguments."""
from typing import Literal
from pydantic import Field
from .domain import InputModel, FilterPatch


class ConditionEvidence(InputModel):
    field: str = Field(max_length=40, description="A field changed in updates only. Never film_index, cinema_index or screening_index; selections are validated separately by the server.")
    source: Literal["user_explicit", "model_inferred"] = "user_explicit"
    strength: Literal["hard", "soft"] = "hard"
    original_text: str = Field(min_length=1, max_length=2000, description="Exact substring of the current user message, never invented evidence.")


class Query(InputModel):
    updates: FilterPatch = Field(default_factory=FilterPatch)
    clarification: Literal["time", "region"] | None = None
    task_action: Literal["continue", "modify", "relax", "new"] = "continue"
    task_text: str | None = Field(default=None, max_length=2000, description="Exact user quote explaining a new task. Generic recommendations after no results continue the task.")
    evidence: list[ConditionEvidence] = Field(default_factory=list, max_length=25)


class RecoveryQuery(InputModel):
    token: str = Field(min_length=1, max_length=100)
    option_id: str = Field(min_length=1, max_length=60)


class FilmQuery(Query):
    limit: int = Field(default=3, ge=1, le=3)
    detail: bool = False
    film_index: int | None = Field(default=None, ge=1, le=3)


class ScreeningQuery(Query):
    film_index: int | None = Field(default=None, ge=1, le=3, description="ONLY for explicit selection from previous films list, e.g. second film. Never use an index from cards here. Omit for ordinary filter updates.")
    cinema_index: int | None = Field(default=None, ge=1, le=3, description="ONLY for explicit selection from previous cinemas list. Omit when just changing preferences.")
    screening_index: int | None = Field(default=None, ge=1, le=3, description="ONLY when user selects a specific previous screening card, e.g. second screening. Omit for date/budget/person changes; these should search all matching screenings.")


class CinemaQuery(Query):
    name: str | None = Field(default=None, max_length=100)
    film_index: int | None = Field(default=None, ge=1, le=3)


class RulesQuery(InputModel):
    topic: Literal["student", "reschedule", "coupon", "hold", "payment", "cancellation", "rating", "all"] = "all"


class OrderQuery(InputModel):
    status: Literal["CONFIRMED", "RESCHEDULED", "CINEMA_CANCELLED"] | None = None


class CouponQuery(InputModel):
    screening_index: int | None = Field(default=None, ge=1, le=3)


class ChangeQuery(InputModel):
    order_index: int = Field(ge=1, le=3)
    date: str | None = Field(default=None, max_length=20)


class PriceQuery(InputModel):
    screening_index: int = Field(ge=1, le=3)
    regular_count: int | None = Field(default=None, ge=0, le=12)
    student_count: int | None = Field(default=None, ge=0, le=12)
    coupon_index: int | None = Field(default=None, ge=1, le=3)
    order_index: int | None = Field(default=None, ge=1, le=3)


class LocationQuery(InputModel):
    place: str | None = Field(default=None, max_length=100)
    nearest: bool = False


DEFINITIONS = {
    "recover_search": (RecoveryQuery, "Apply ONE of the server-provided recovery options only when the user chooses it. Use its exact token and option_id from pending_recovery. Never invent an option or choose it merely because results are empty. Hard conditions require explicit user consent."),
    "search_films": (FilmQuery, "Find or recommend platform films by name/genre/keyword/score. No party size or location needed. Ratings are /10 with vote counts. recent means future 14-day listings, NOT release dates. Use detail for a specific film question. film_index resolves a previous candidate."),
    "search_screenings": (ScreeningQuery, "Find saleable screenings and seats with hard filters. Needs party_size, asks if missing. A budget needs explicit per_ticket or total scope; yuan must be converted to integer fen. Default regular fare, before coupons. Select prior film/cinema/screening by 1-based index, never invent IDs. A specific screening is re-read."),
    "search_cinemas": (CinemaQuery, "Read cinemas by district, name or film. No party size needed. Does not know distance to user."),
    "get_rules": (RulesQuery, "Read authoritative platform policies. No login required. Never guess rules."),
    "get_my_orders": (OrderQuery, "Read up to 3 bookings owned by the logged-in customer. Server derives identity; cannot read another person's orders. Returns login_required if anonymous."),
    "get_my_coupons": (CouponQuery, "Read logged-in customer's coupons and optional applicability to a previously returned screening. Does not consume coupons."),
    "check_reschedule": (ChangeQuery, "Check a previously listed own order's reschedule eligibility, fee and optional alternative date. Same cinema/film and original ticket mix required. Read only."),
    "preview_price": (PriceQuery, "Preview price of a previous screening, with explicitly confirmed regular/student counts and optional own coupon. Ask ticket mix if missing. For rescheduling, original fare mix is inherited. Does NOT reserve seats or issue a payable quote."),
    "resolve_location": (LocationQuery, "Resolve a manually entered Beijing district or known cinema address. Set nearest=true for nearby/nearest requests: the server may offer the website map page. This tool cannot access device location or calculate distance; never invent a distance."),
}


def tool_schemas():
    return [{"type": "function", "function": {"name": name, "description": description,
             "parameters": schema.model_json_schema()}} for name, (schema, description) in DEFINITIONS.items()]
