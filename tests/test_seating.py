from collections import defaultdict
import pytest
from cinema.seating import auditorium_layout
from cinema.catalog import choose_seats


@pytest.mark.parametrize("kind,nrows,total,counts", [
    ("STANDARD", 10, 168, {14, 16, 18}), ("IMAX", 12, 300, {22, 24, 26}),
    ("DOLBY_CINEMA", 8, 92, {10, 12}),
])
def test_realistic_profiles_have_tapered_rows_and_separate_aisles(kind, nrows, total, counts):
    plan = auditorium_layout(kind)
    seats = plan["seats"]
    assert plan["row_count"] == nrows and len(seats) == total
    assert len({(s["map_x"], s["map_y"]) for s in seats}) == total
    by_row = defaultdict(list)
    for s in seats:
        by_row[s["row_no"]].append(s)
    assert set(by_row) == set(range(1, nrows + 1))
    assert {len(group) for group in by_row.values()} == counts
    for group in by_row.values():
        assert [s["seat_no"] for s in group] == list(range(1, len(group) + 1))
        for a, b in zip(group, group[1:]):
            assert (b["map_x"] - a["map_x"] == 1) == (a["aisle_segment"] == b["aisle_segment"])
    if kind != "DOLBY_CINEMA":
        assert by_row[5][0]["map_y"] - by_row[4][0]["map_y"] == 2


@pytest.mark.parametrize("kind", ["STANDARD", "IMAX", "DOLBY_CINEMA"])
def test_adjacent_seat_suggestions_cannot_jump_across_an_aisle(kind):
    plan = auditorium_layout(kind)
    # Only the two seats on opposite edges of an aisle are available.
    row = [dict(s, id=i) for i, s in enumerate(plan["seats"], 1) if s["row_no"] == 5]
    edge = next(i for i in range(1, len(row)) if row[i]["aisle_segment"] != row[i-1]["aisle_segment"])
    result = choose_seats(row[edge-1:edge+1], 2, plan["row_count"])
    assert result["adjacent"] is False
