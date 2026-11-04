"""Deterministic read-only search shared by the assistant and ordinary filters."""
from collections import defaultdict
from datetime import datetime

from .domain import CinemaRepository, Filters, Seat

DISTRICTS = {
    "chaoyang": ("朝阳区", "Chaoyang"), "haidian": ("海淀区", "Haidian"),
    "dongcheng": ("东城区", "Dongcheng"), "xicheng": ("西城区", "Xicheng"),
    "fengtai": ("丰台区", "Fengtai"), "shijingshan": ("石景山区", "Shijingshan"),
    "tongzhou": ("通州区", "Tongzhou"), "shunyi": ("顺义区", "Shunyi"),
    "changping": ("昌平区", "Changping"), "daxing": ("大兴区", "Daxing"),
    "fangshan": ("房山区", "Fangshan"), "mentougou": ("门头沟区", "Mentougou"),
    "huairou": ("怀柔区", "Huairou"), "pinggu": ("平谷区", "Pinggu"),
    "miyun": ("密云区", "Miyun"), "yanqing": ("延庆区", "Yanqing"),
}
HALL_LABELS = {"standard": {"zh": "普通厅", "en": "Standard"},
               "imax": {"zh": "IMAX", "en": "IMAX"},
               "dolby": {"zh": "Dolby Cinema", "en": "Dolby Cinema"}}


def row_zones(rows: int) -> list[str]:
    """Largest remainder method; tie order front, middle, back (integer math)."""
    if rows < 1:
        raise ValueError("A layout needs at least one row")
    weights = [3, 4, 3]
    counts = [rows * w // 10 for w in weights]
    order = sorted(range(3), key=lambda i: (-(rows * weights[i] % 10), i))
    for i in order[:rows - sum(counts)]:
        counts[i] += 1
    return [zone for zone, count in zip(("front", "middle", "back"), counts) for _ in range(count)]


def select_seats(seats: list[Seat], size: int, zone: str | None):
    if len(seats) < size:
        return None
    groups = defaultdict(list)
    for seat in seats:
        groups[(seat.row, seat.segment)].append(seat)
    candidates = []
    for group in groups.values():
        group.sort(key=lambda s: s.number)
        for offset in range(len(group) - size + 1):
            block = group[offset:offset + size]
            if all(b.number == a.number + 1 for a, b in zip(block, block[1:])):
                score = sum(s.zone == zone for s in block) if zone else 0
                candidates.append((-score, tuple((s.row, s.number) for s in block), block))
    if candidates:
        _, _, selected = min(candidates, key=lambda item: item[:2])
        contiguous = True
    else:
        selected = sorted(seats, key=lambda s: (0 if not zone or s.zone == zone else 1, s.row, s.number))[:size]
        contiguous = False
    return selected, contiguous, sum(s.zone == zone for s in selected) if zone else 0


def normalized(text: str) -> str:
    return "".join(text.lower().split())


class CatalogService:
    def __init__(self, repository: CinemaRepository, clock):
        self.repository, self.clock = repository, clock

    def find_films(self, query: str | None):
        films = self.repository.films()
        if not query:
            return films
        needle = normalized(query)
        exact = [f for f in films if needle in [normalized(v) for v in (*f.titles.values(), *f.aliases)]]
        return exact or [f for f in films if any(needle in normalized(v) for v in (*f.titles.values(), *f.aliases))]

    def film_data(self, film, locale):
        return {"id": film.id, "title": film.titles[locale], "synopsis": film.synopsis[locale],
                "titles": film.titles, "synopses": film.synopsis,
                "duration_minutes": film.duration_minutes, "rating": film.rating,
                "rating_count": film.rating_count, "genres": list(film.genres),
                "showing": film.showing, "release_date": film.release_date, "rating_source": "platform", "rating_scale": 10}

    def discover_films(self, filters, locale="zh", limit=3):
        from cinema.discovery import match_film, film_order
        films = [f for f in self.find_films(filters.film_query) if match_film(f, filters)]
        if filters.sort_by_rating:
            films.sort(key=film_order)
        else:
            # Grounded, deterministic discovery: current listings first, then known
            # platform ratings/vote counts. ID is only the final tie breaker.
            films.sort(key=lambda f: (not f.showing, *film_order(f)))
        return [self.film_data(f, locale) for f in films[:limit]]

    def cinema_data(self, cinema, locale):
        return {"id": cinema.id, "name": cinema.names[locale], "district": cinema.district,
                "address": cinema.address[locale], "names": cinema.names, "addresses": cinema.address}

    def seat_data(self, seat):
        return {"id": seat.id, "row": seat.row, "number": seat.number, "segment": seat.segment,
                "zone": seat.zone, "label": f"{seat.row}-{seat.number}"}

    def available(self, screening, now):
        return [s for s in screening.seats if s.id not in screening.allocations
                or not screening.allocations[s.id].active(now)]

    def card(self, screening, selected, contiguous, score, filters, locale, now):
        film = next(f for f in self.repository.films() if f.id == screening.film_id)
        cinema = next(c for c in self.repository.cinemas() if c.id == screening.cinema_id)
        unmet = []
        if not contiguous:
            unmet.append("split_seats")
        if filters.zone and score < filters.party_size:
            unmet.append("preferred_zone")
        return {"screening_id": screening.id, "film": self.film_data(film, locale),
                "cinema": self.cinema_data(cinema, locale), "starts_at": screening.starts_at.isoformat(),
                "hall_type": screening.hall_type, "hall_label": HALL_LABELS[screening.hall_type][locale],
                "suggested_seats": [self.seat_data(s) for s in selected], "contiguous": contiguous,
                "preferred_zone_count": score, "unmet_preferences": unmet, "fares": screening.fares,
                "currency": "CNY", "price_basis": "per_ticket_before_coupons", "reserved": False,
                "checked_at": now.isoformat(), "version": screening.version}

    def recommend(self, filters: Filters, locale="zh", limit=3):
        now = self.clock()
        if filters.city != "beijing" or not filters.party_size:
            return []
        films = self.find_films(filters.film_query)
        if filters.film_query and len(films) != 1:
            return []
        from cinema.discovery import match_film
        film_ids = {f.id for f in films if match_film(f, filters)}
        cinemas = {c.id: c for c in self.repository.cinemas()}
        results = []
        for show in self.repository.screenings():
            if (show.status != "published" or show.starts_at <= now or show.film_id not in film_ids
                    or show.starts_at.date().isoformat() != filters.date):
                continue
            if filters.district and cinemas[show.cinema_id].district != filters.district:
                continue
            if filters.hall_type and show.hall_type != filters.hall_type:
                continue
            if filters.cinema_id and show.cinema_id != filters.cinema_id:
                continue
            if filters.screening_id and show.id != filters.screening_id:
                continue
            price = show.fares.get(filters.fare_type)
            if filters.budget_minor is not None:
                if filters.budget_scope is None or price is None:
                    continue
                cost = price * (filters.party_size if filters.budget_scope == "total" else 1)
                if cost > filters.budget_minor:
                    continue
            start = show.starts_at.strftime("%H:%M")
            if filters.time_start and start < filters.time_start:
                continue
            if filters.time_end and start >= filters.time_end:
                continue
            selection = select_seats(self.available(show, now), filters.party_size, filters.zone)
            if selection:
                selected, contiguous, score = selection
                if filters.require_contiguous and not contiguous:
                    continue
                results.append(self.card(show, selected, contiguous, score, filters, locale, now))
        results.sort(key=lambda r: (not r["contiguous"], -r["preferred_zone_count"],
                    -(r["film"]["rating"] or 0) if filters.sort_by_rating else 0, r["starts_at"], r["screening_id"]))
        return results[:limit]

    def preview(self, screening_id, locale="zh"):
        show = self.repository.get_screening(screening_id)
        if show is None:
            return None
        now = self.clock()
        saleable = show.status == "published" and show.starts_at > now
        film = next(f for f in self.repository.films() if f.id == show.film_id)
        cinema = next(c for c in self.repository.cinemas() if c.id == show.cinema_id)
        available_ids = {s.id for s in self.available(show, now)}
        seats = []
        for seat in show.seats:
            state = "available" if seat.id in available_ids else show.allocations[seat.id].state
            seats.append({**self.seat_data(seat), "state": state})
        return {"screening_id": show.id, "film": self.film_data(film, locale),
                "cinema": self.cinema_data(cinema, locale), "starts_at": show.starts_at.isoformat(),
                "hall_label": HALL_LABELS[show.hall_type][locale], "status": show.status,
                "saleable": saleable, "fares": show.fares, "seats": seats,
                "reserved": False, "checked_at": now.isoformat(), "version": show.version}
