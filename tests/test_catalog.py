from dataclasses import replace
from datetime import timedelta

import pytest

from cinema_ai.catalog import CatalogService, row_zones, select_seats
from cinema_ai.domain import Allocation, Filters, Seat
from cinema_ai.repository import MockCinemaRepository


def filters(**updates):
    return Filters.model_validate({"date": "2026-10-23", "party_size": 3, **updates})


@pytest.mark.parametrize("rows,counts", [(10, [3, 4, 3]), (12, [4, 5, 3]), (1, [0, 1, 0]), (2, [1, 1, 0])])
def test_largest_remainder(rows, counts):
    zones = row_zones(rows)
    assert [zones.count(zone) for zone in ("front", "middle", "back")] == counts


def test_together_beats_preferred_scattered():
    seats = [Seat(i, 4, n, 0, "middle") for i, n in enumerate([1, 3, 5], 1)]
    seats += [Seat(i, 8, n, 0, "back") for i, n in enumerate([1, 2, 3], 4)]
    chosen, together, score = select_seats(seats, 3, "middle")
    assert together and score == 0
    assert [s.row for s in chosen] == [8, 8, 8]


def test_aisle_is_not_contiguous():
    seats = [Seat(1, 1, 1, 0, "front"), Seat(2, 1, 2, 1, "front"), Seat(3, 1, 3, 1, "front")]
    chosen, together, score = select_seats(seats, 3, "front")
    assert len(chosen) == 3 and not together and score == 3


def test_scattered_prefers_zone_then_row_number():
    seats = [Seat(1, 1, 1, 0, "front"), Seat(2, 4, 3, 0, "middle"), Seat(3, 4, 1, 0, "middle"), Seat(4, 9, 1, 0, "back")]
    chosen, together, score = select_seats(seats, 3, "middle")
    assert not together and score == 2
    assert [s.id for s in chosen] == [3, 2, 1]


def test_tie_breaks_by_row_seat_and_missing_seat_breaks_block():
    seats = [Seat(1, 2, 1, 0, "front"), Seat(2, 2, 2, 0, "front"),
             Seat(3, 1, 1, 0, "front"), Seat(4, 1, 2, 0, "front"), Seat(5, 1, 4, 0, "front")]
    assert [s.id for s in select_seats(seats, 2, None)[0]] == [3, 4]
    assert not select_seats(seats, 3, None)[1]
    assert select_seats(seats, 6, None) is None


def test_hold_expiry_and_sold_excluded(clock):
    repo = MockCinemaRepository(clock)
    catalog = CatalogService(repo, clock)
    show = next(s for s in repo.screenings() if len(s.allocations) == 4)
    ids = {s.id for s in catalog.available(show, clock())}
    assert 101 not in ids and 501 not in ids and 502 in ids
    assert 501 in {s.id for s in catalog.available(show, clock() + timedelta(minutes=5))}


def test_ranking_across_screenings_and_hard_conditions(clock):
    repo = MockCinemaRepository(clock)
    catalog = CatalogService(repo, clock)
    cards = catalog.recommend(filters(district="chaoyang", film_query="电影 A", zone="middle"), limit=20)
    assert cards and all(c["cinema"]["district"] == "chaoyang" and c["film"]["id"] == 1 for c in cards)
    assert not cards[-1]["contiguous"]
    assert all(c["contiguous"] for c in cards[:-1])
    assert catalog.recommend(filters(district="chaoyang", film_query="电影 A", hall_type="dolby")) == []
    assert catalog.recommend(filters(city="shanghai")) == []
    assert catalog.recommend(filters(film_query="not a real film")) == []
    assert catalog.recommend(filters(date="2026-10-22")) == []


def test_preview_rechecks_changes_and_never_reserves(clock):
    repo = MockCinemaRepository(clock)
    catalog = CatalogService(repo, clock)
    card = catalog.recommend(filters())[0]
    sid = card["screening_id"]
    original = repo.get_screening(sid)
    seat_id = card["suggested_seats"][0]["id"]
    repo._screenings[sid] = replace(original, allocations={**original.allocations, seat_id: Allocation("sold")}, version=2)
    preview = catalog.preview(sid)
    assert next(s for s in preview["seats"] if s["id"] == seat_id)["state"] == "sold"
    assert not preview["reserved"] and preview["version"] == 2
    repo._screenings[sid] = replace(repo.get_screening(sid), status="cancelled", fares={"regular": 9000, "student": 7000})
    assert not catalog.preview(sid)["saleable"]
    assert catalog.preview(sid)["fares"]["regular"] == 9000
    assert sid not in {c["screening_id"] for c in catalog.recommend(filters())}


def test_screening_at_start_is_not_for_sale(clock):
    repo = MockCinemaRepository(clock)
    show = repo.screenings()[0]
    repo._screenings[show.id] = replace(show, starts_at=clock())
    catalog = CatalogService(repo, clock)
    assert not catalog.preview(show.id)["saleable"]
    assert show.id not in {c["screening_id"] for c in catalog.recommend(filters(), limit=100)}
