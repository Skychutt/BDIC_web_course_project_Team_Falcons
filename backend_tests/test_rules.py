from datetime import datetime, timedelta
import pytest
from cinema.booking import fee_rate, rounded
from cinema.catalog import zone_sizes, choose_seats
from cinema.core import Problem, moment, wire


@pytest.mark.parametrize(
    "minutes,expected", [(720, 0), (719, 500), (360, 500), (359, 2000), (30, 2000)]
)
def test_fee_boundaries(minutes, expected):
    now = datetime(2026, 1, 1)
    assert fee_rate(now + timedelta(minutes=minutes), now) == expected


def test_closed_fee_boundary():
    now = datetime(2026, 1, 1)
    with pytest.raises(Problem):
        fee_rate(now + timedelta(seconds=1799), now)


def test_half_up_integer_money():
    assert rounded(101, 5000) == 51
    assert rounded(10, 500) == 1
    assert rounded(100, 500) == 5


def test_zone_largest_remainder():
    assert zone_sizes(12) == [4, 5, 3]
    assert zone_sizes(1) == [0, 1, 0]
    for n in range(1, 100):
        assert sum(zone_sizes(n)) == n


def test_adjacency_never_crosses_aisle():
    seats = [
        dict(
            id=i,
            row_no=1,
            seat_no=i,
            aisle_segment=1 if i <= 2 else 2,
            segment_position=i if i <= 2 else i - 2,
        )
        for i in range(1, 5)
    ]
    assert choose_seats(seats, 3, 1)["separated"]
    assert choose_seats(seats, 2, 1)["adjacent"]


def test_zone_preference_does_not_override_adjacency():
    seats = [
        dict(id=i, row_no=1, seat_no=i, aisle_segment=1, segment_position=i)
        for i in range(1, 4)
    ]
    seats.append(dict(id=4, row_no=6, seat_no=1, aisle_segment=1, segment_position=1))
    result = choose_seats(seats, 2, 12, "MIDDLE")
    assert result["adjacent"] and result["seat_ids"] == [1, 2]


def test_json_id_precision_and_timezone():
    assert wire({"id": 2**60, "seat_ids": [2**60], "balance_minor": 100}) == {
        "id": str(2**60),
        "seat_ids": [str(2**60)],
        "balance_minor": 100,
    }
    assert moment("2026-01-01T00:00:00Z") == datetime(2026, 1, 1, 8)
    with pytest.raises(Problem):
        moment("2026-01-01T08:00:00")
