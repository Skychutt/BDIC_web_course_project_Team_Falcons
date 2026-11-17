"""Representative demo auditoriums, not surveyed plans of the named venues.

Coordinates are seat-sized grid cells. Empty columns are real aisle breaks;
empty rows are cross aisles. Logical row numbers always count from the screen.
"""
from .core import ins, one, require

SEAT_FIELDS = ("row_no", "seat_no", "aisle_segment", "segment_position", "map_x", "map_y")


def auditorium_layout(screen_type):
    profiles = {
        "STANDARD": dict(blocks=[4, 10, 4], rows=[[2, 10, 2]] * 2 + [[3, 10, 3]] * 2 + [[4, 10, 4]] * 6,
                         aisle=2, cross_after=4),
        "IMAX": dict(blocks=[6, 14, 6], rows=[[4, 14, 4]] * 2 + [[5, 14, 5]] * 2 + [[6, 14, 6]] * 8,
                     aisle=2, cross_after=4),
        "DOLBY_CINEMA": dict(blocks=[6, 6], rows=[[5, 5]] * 2 + [[6, 6]] * 6,
                             aisle=3, cross_after=None),
    }
    require(screen_type in profiles, "SCREEN_TYPE", "Unsupported auditorium format")
    profile = profiles[screen_type]
    seats = []
    for row_no, counts in enumerate(profile["rows"], 1):
        x = 0
        seat_no = 0
        for segment, (capacity, count) in enumerate(zip(profile["blocks"], counts), 1):
            # Trim outer front corners while keeping longitudinal aisles aligned.
            inset = capacity - count if segment == 1 else 0
            for position in range(1, count + 1):
                seat_no += 1
                seats.append(dict(row_no=row_no, seat_no=seat_no, aisle_segment=segment,
                                  segment_position=position, map_x=x + inset + position - 1,
                                  map_y=row_no - 1 + int(bool(profile["cross_after"] and row_no > profile["cross_after"]))))
            x += capacity + profile["aisle"]
    return dict(row_count=len(profile["rows"]), screen_direction="TOP", seats=seats)


def insert_auditorium(c, screen_id, screen_type, at):
    """Caller holds the physical screen lock (or just inserted that screen)."""
    plan = auditorium_layout(screen_type)
    version = one(c, "SELECT COALESCE(MAX(version_no),0)+1 n FROM layouts WHERE screen_id=:s", s=screen_id)["n"]
    lid = ins(c, "layouts", screen_id=screen_id, version_no=version,
              screen_direction=plan["screen_direction"], row_count=plan["row_count"], created_at=at)
    ids = [ins(c, "seats", layout_id=lid, **seat) for seat in plan["seats"]]
    return lid, ids


def same_layout(layout, seats, plan):
    return (layout["row_count"] == plan["row_count"] and
            layout["screen_direction"] == plan["screen_direction"] and
            sorted(tuple(s[k] for k in SEAT_FIELDS) for s in seats) ==
            sorted(tuple(s[k] for k in SEAT_FIELDS) for s in plan["seats"]))


def legacy_layout(layout, seats):
    """Only the original 12 × 6 fixture is eligible for automatic replacement."""
    return same_layout(layout, seats, dict(row_count=12, screen_direction="TOP", seats=[
        dict(row_no=r, seat_no=n, aisle_segment=1, segment_position=n, map_x=n-1, map_y=r-1)
        for r in range(1, 13) for n in range(1, 7)
    ]))
