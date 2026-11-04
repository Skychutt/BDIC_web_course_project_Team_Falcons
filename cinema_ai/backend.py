"""Read-only bridge to the team's v1 services; no booking tools reach the model."""
from types import SimpleNamespace

from cinema import catalog as backend
from cinema.core import db, get, now, rows, Problem

from .catalog import CatalogService, HALL_LABELS
from .domain import BEIJING, Cinema, Film
from .localization import film_text, cinema_text

DISTRICT_CODES = dict(zip(
    ("dongcheng", "xicheng", "chaoyang", "fengtai", "shijingshan", "haidian",
     "mentougou", "fangshan", "tongzhou", "shunyi", "changping", "daxing",
     "huairou", "pinggu", "miyun", "yanqing"),
    ("110101", "110102", "110105", "110106", "110107", "110108", "110109", "110111",
     "110112", "110113", "110114", "110115", "110116", "110117", "110118", "110119"),
))
SLUGS = {code: slug for slug, code in DISTRICT_CODES.items()}
HALLS = {"standard": "STANDARD", "imax": "IMAX", "dolby": "DOLBY_CINEMA"}
ZONES = {"front": "FRONT", "middle": "MIDDLE", "back": "REAR"}


def backend_clock():
    # v1 stores Beijing local DATETIME, without tzinfo.
    return now().replace(tzinfo=BEIJING)


def film_record(value):
    rating = value["rating"]
    titles, synopses = film_text(value["title"], value["synopsis"])
    return Film(value["id"], titles, (value["title"],), synopses,
                value["duration_minutes"], float(rating["average"]) if rating["average"] is not None else None,
                rating["count"], tuple(g["name"] for g in value.get("genres", [])),
                bool(value.get("showing", False)))


def cinema_record(value):
    names, addresses = cinema_text(value["name"], value["address"])
    return Cinema(value["id"], names, SLUGS.get(value["admin_code"], value["admin_code"]), addresses)


class BackendRepository:
    source_name = "backend"

    def films(self):
        from cinema.frontend_api import film_metadata
        with db().connect() as c:
            values = rows(c, """SELECT f.*,EXISTS(SELECT 1 FROM screenings s
                JOIN cinemas ci ON ci.id=s.cinema_id WHERE s.film_id=f.id AND s.status='PUBLISHED'
                AND ci.is_active=1 AND s.starts_at>:at AND s.starts_at<DATE_ADD(:at, INTERVAL 14 DAY)) AS showing
                FROM films f WHERE f.archived=0 ORDER BY f.title,f.id""", at=now())
            return [film_record(v) for v in film_metadata(c, values)]

    def cinemas(self):
        with db().connect() as c:
            return [cinema_record(v) for v in rows(c, """SELECT c.id,c.name,c.address,d.admin_code
                FROM cinemas c JOIN districts d ON d.id=c.district_id WHERE c.is_active=1 ORDER BY c.name,c.id""")]

    def snapshot(self):
        """Copy public facts before entering a model worker, releasing DB connections."""
        films, cinemas = self.films(), self.cinemas()
        return SimpleNamespace(films=lambda: films, cinemas=lambda: cinemas)


class BackendCatalog(CatalogService):
    """Use v1 search/choose_seats and seatmap unchanged for every live recommendation."""

    def _facts(self, c, show, locale):
        film = film_record(backend.film_detail(c, show["film_id"]))
        cinema = get(c, "cinemas", show["cinema_id"])
        cinema["admin_code"] = get(c, "districts", cinema["district_id"])["admin_code"]
        screen = get(c, "screens", show["screen_id"])
        hall = next(k for k, v in HALLS.items() if v == screen["screen_type"])
        return dict(screening_id=show["id"], film=self.film_data(film, locale),
                    cinema=self.cinema_data(cinema_record(cinema), locale),
                    starts_at=show["starts_at"].replace(tzinfo=BEIJING).isoformat(),
                    hall_type=hall, hall_label=HALL_LABELS[hall][locale],
                    reserved=False, version=show["revision_no"])

    @staticmethod
    def _seat(seat, row_count):
        return dict(id=seat["id"], row=seat["row_no"], number=seat["seat_no"],
                    segment=seat["aisle_segment"], segment_position=seat["segment_position"],
                    map_x=seat["map_x"], map_y=seat["map_y"],
                    zone=next(k for k, v in ZONES.items() if v == backend.seat_zone(seat["row_no"], row_count)),
                    label=f'{seat["row_no"]}-{seat["seat_no"]}')

    @staticmethod
    def _fares(fares):
        return {"regular" if f["fare_type"] == "STANDARD" else "student": f["price_minor"] for f in fares}

    def recommend(self, filters, locale="zh", limit=3):
        if filters.city != "beijing" or not filters.party_size:
            return []
        films = self.find_films(filters.film_query)
        if filters.film_query and len(films) != 1:
            return []
        query = dict(date=filters.date, party_size=filters.party_size, page_size=min(limit, 100))
        if filters.film_query:
            query["film_id"] = films[0].id
        for field, value in (("start_from", filters.time_start), ("start_to", filters.time_end),
                             ("screen_type", HALLS.get(filters.hall_type)), ("zone", ZONES.get(filters.zone)),
                             ("film_id", filters.film_id), ("cinema_id", filters.cinema_id),
                             ("screening_id", filters.screening_id), ("genre", filters.genre), ("keyword", filters.keyword),
                             ("min_rating", filters.min_rating), ("budget_minor", filters.budget_minor),
                             ("budget_scope", filters.budget_scope)):
            if value is not None:
                query[field] = value
        query.update(rated_only=filters.rated_only, sort_by_rating=filters.sort_by_rating,
                     require_contiguous=filters.require_contiguous, fare_type=filters.fare_type)
        with db().connect() as c:
            if filters.district:
                district = rows(c, "SELECT id FROM districts WHERE admin_code=:code", code=DISTRICT_CODES.get(filters.district))
                if not district:
                    return []  # Never drop an unresolvable hard constraint.
                query["district_id"] = district[0]["id"]
            result = backend.search(c, query, end_exclusive=True)
            cards = []
            for show in result["items"]:
                suggestion = show["suggestion"]
                seats = {s["id"]: s for s in rows(c, "SELECT * FROM seats WHERE layout_id=:l", l=show["layout_id"])}
                unmet = []
                if not suggestion["adjacent"]:
                    unmet.append("split_seats")
                if filters.zone and suggestion["preferred_seat_count"] < filters.party_size:
                    unmet.append("preferred_zone")
                cards.append({**self._facts(c, show, locale),
                              "suggested_seats": [self._seat(seats[sid], show["row_count"]) for sid in suggestion["seat_ids"]],
                              "contiguous": suggestion["adjacent"], "preferred_zone_count": suggestion["preferred_seat_count"],
                              "unmet_preferences": unmet, "fares": self._fares(show["fares"]),
                              "currency": "CNY", "price_basis": "per_ticket_before_coupons",
                              "checked_at": result["as_of"].replace(tzinfo=BEIJING).isoformat()})
            return cards

    def preview(self, screening_id, locale="zh"):
        with db().connect() as c:
            try:
                result = backend.seatmap(c, screening_id)
            except Problem as error:
                if error.status == 404:
                    return None
                raise
            show, layout = result["screening"], result["layout"]
            cinema = get(c, "cinemas", show["cinema_id"])
            return {**self._facts(c, show, locale), "status": show["status"].lower(),
                    "saleable": show["status"] == "PUBLISHED" and show["starts_at"] > now() and bool(cinema["is_active"]),
                    "fares": self._fares(result["fares"]),
                    "seats": [{**self._seat(s, layout["row_count"]), "state": s["state"].lower()} for s in result["seats"]],
                    "layout": {"screen_direction": layout["screen_direction"], "row_count": layout["row_count"]},
                    "checked_at": result["as_of"].replace(tzinfo=BEIJING).isoformat()}
