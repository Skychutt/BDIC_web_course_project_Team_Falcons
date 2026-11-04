"""Provider-neutral catalog records and validated public inputs."""
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal, Protocol
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator

BEIJING = ZoneInfo("Asia/Shanghai")
Locale = Literal["zh", "en"]
Zone = Literal["front", "middle", "back"]
Hall = Literal["standard", "imax", "dolby"]


def now_beijing() -> datetime:
    return datetime.now(BEIJING)


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Filters(InputModel):
    city: str = Field(default="beijing", min_length=1, max_length=80)
    district: str | None = Field(default=None, max_length=40)
    film_query: str | None = Field(default=None, max_length=100)
    date: str
    time_start: str | None = None
    time_end: str | None = None
    party_size: int | None = Field(default=None, ge=1, le=12)
    hall_type: Hall | None = None
    zone: Zone | None = None
    genre: str | None = Field(default=None, max_length=60)
    keyword: str | None = Field(default=None, max_length=100)
    min_rating: float | None = Field(default=None, ge=1, le=10)
    rated_only: bool = False
    sort_by_rating: bool = False
    showing_only: bool = False
    recent: bool = False
    budget_minor: int | None = Field(default=None, ge=0, le=10000000)
    budget_scope: Literal["per_ticket", "total"] | None = None
    fare_type: Literal["regular", "student"] = "regular"
    require_contiguous: bool = False
    # Server-resolved selections; these are deliberately absent from FilterPatch.
    film_id: int | None = Field(default=None, gt=0)
    cinema_id: int | None = Field(default=None, gt=0)
    screening_id: int | None = Field(default=None, gt=0)

    @field_validator("date")
    @classmethod
    def valid_date(cls, value):
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError("Use YYYY-MM-DD")
        return value

    @field_validator("time_start", "time_end")
    @classmethod
    def valid_time(cls, value):
        if value is None or value == "24:00":
            return value
        import re
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("Use HH:MM")
        return value


class FilterPatch(InputModel):
    """Only fields present in model_fields_set change the current conversation."""
    city: str | None = Field(default=None, min_length=1, max_length=80)
    district: str | None = Field(default=None, max_length=40)
    film_query: str | None = Field(default=None, max_length=100)
    date: str | None = Field(default=None, max_length=20)
    time_start: str | None = Field(default=None, max_length=5)
    time_end: str | None = Field(default=None, max_length=5)
    party_size: int | None = Field(default=None, ge=1, le=12)
    hall_type: Hall | None = None
    zone: Zone | None = None
    genre: str | None = Field(default=None, max_length=60)
    keyword: str | None = Field(default=None, max_length=100)
    min_rating: float | None = Field(default=None, ge=1, le=10)
    rated_only: bool = False
    sort_by_rating: bool = False
    showing_only: bool = False
    recent: bool = False
    budget_minor: int | None = Field(default=None, ge=0, le=10000000)
    budget_scope: Literal["per_ticket", "total"] | None = None
    fare_type: Literal["regular", "student"] = "regular"
    require_contiguous: bool = False


class Intent(InputModel):
    intent: Literal["recommend", "film", "cinema", "rules", "help", "unsupported"]
    updates: FilterPatch = Field(default_factory=FilterPatch)
    cinema_query: str | None = Field(default=None, max_length=100)
    rule_topic: Literal["student", "reschedule", "coupon", "hold", "payment", "cancellation", "all"] | None = None
    clarification: Literal["time", "film", "region"] | None = None


class ChatInput(InputModel):
    message: str = Field(min_length=1, max_length=2000)
    locale: Locale = "zh"

    @field_validator("message")
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Message cannot be blank")
        return value


@dataclass(frozen=True)
class Film:
    id: int
    titles: dict[str, str]
    aliases: tuple[str, ...]
    synopsis: dict[str, str]
    duration_minutes: int
    rating: float | None
    rating_count: int
    genres: tuple[str, ...] = ()
    showing: bool = False
    release_date: str | None = None


@dataclass(frozen=True)
class Cinema:
    id: int
    names: dict[str, str]
    district: str
    address: dict[str, str]


@dataclass(frozen=True)
class Seat:
    id: int
    row: int
    number: int
    segment: int
    zone: Zone


@dataclass(frozen=True)
class Allocation:
    state: Literal["sold", "held"]
    expires_at: datetime | None = None

    def active(self, now: datetime) -> bool:
        return self.state == "sold" or self.expires_at is None or self.expires_at > now


@dataclass(frozen=True)
class Screening:
    id: int
    film_id: int
    cinema_id: int
    hall_type: Hall
    starts_at: datetime
    status: Literal["published", "cancelled", "draft"]
    seats: tuple[Seat, ...]
    fares: dict[str, int]
    allocations: dict[int, Allocation] = field(default_factory=dict)
    version: int = 1


class CinemaRepository(Protocol):
    """Implement these reads against SQLAlchemy; do not expose ORM objects to AI."""
    source_name: str

    def films(self) -> list[Film]: ...
    def cinemas(self) -> list[Cinema]: ...
    def screenings(self) -> list[Screening]: ...
    def get_screening(self, screening_id: int) -> Screening | None: ...

