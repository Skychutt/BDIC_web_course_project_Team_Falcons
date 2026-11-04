"""Rolling demo catalog. All titles, cinemas and ratings here are fictional."""
from datetime import datetime, time, timedelta
from dataclasses import replace
from threading import RLock

from .catalog import row_zones
from .domain import Allocation, BEIJING, Cinema, Film, Screening, Seat


def make_layout(rows=10, columns=10):
    zones = row_zones(rows)
    return tuple(Seat(row * 100 + number, row, number, 0 if number <= columns // 2 else 1, zones[row - 1])
                 for row in range(1, rows + 1) for number in range(1, columns + 1))


class MockCinemaRepository:
    source_name = "mock"

    def __init__(self, clock):
        self.clock = clock
        self._lock = RLock()
        self._days = set()
        self._screenings = {}
        self._films = [
            Film(1, {"zh": "星海来信", "en": "Letters from the Stars"},
                 ("电影A", "电影 A", "film A", "movie A", "Letters"),
                 {"zh": "一位年轻的天文学家收到一封来自未来的信，在星空与城市之间寻找答案。",
                  "en": "A young astronomer receives a letter from the future and searches for answers between the city and the stars."}, 118, 9.2, 128),
            Film(2, {"zh": "北京慢行", "en": "A Walk through Beijing"}, ("电影B", "film B", "movie B"),
                 {"zh": "三位老朋友穿过北京的街巷，在一天的旅程中重新发现彼此。",
                  "en": "Three old friends rediscover one another during a day wandering through Beijing."}, 103, 8.4, 64),
            Film(3, {"zh": "星海归途", "en": "The Journey Home"}, ("电影C", "film C", "movie C"),
                 {"zh": "一支远航小队踏上归途，学习如何共同面对未知。",
                  "en": "An expedition heads home, learning to face the unknown together."}, 126, None, 0),
        ]
        self._cinemas = [
            Cinema(1, {"zh": "Falcons 影城 · 朝阳", "en": "Falcons Cinema · Chaoyang"}, "chaoyang",
                   {"zh": "北京市朝阳区示例路 18 号（演示地址）", "en": "18 Example Road, Chaoyang, Beijing (demo address)"}),
            Cinema(2, {"zh": "Falcons 影城 · 海淀", "en": "Falcons Cinema · Haidian"}, "haidian",
                   {"zh": "北京市海淀区示例路 26 号（演示地址）", "en": "26 Example Road, Haidian, Beijing (demo address)"}),
            Cinema(3, {"zh": "Falcons 影城 · 东城", "en": "Falcons Cinema · Dongcheng"}, "dongcheng",
                   {"zh": "北京市东城区示例路 8 号（演示地址）", "en": "8 Example Road, Dongcheng, Beijing (demo address)"}),
        ]
        self._films = [replace(f, genres=genres, showing=True) for f, genres in zip(
            self._films, [("Science Fiction",), ("Drama",), ("Adventure", "Science Fiction")])]

    def films(self):
        return list(self._films)

    def cinemas(self):
        return list(self._cinemas)

    def _ensure_days(self):
        now = self.clock()
        with self._lock:
            for offset in range(4):
                day = now.date() + timedelta(days=offset)
                if day in self._days:
                    continue
                self._days.add(day)
                for index, (hour, minute, film, cinema, hall, scenario) in enumerate([
                    (10, 30, 2, 1, "standard", "normal"),
                    (14, 0, 1, 1, "imax", "normal"),
                    (18, 30, 1, 1, "standard", "back"),
                    (19, 0, 1, 1, "imax", "scattered"),
                    (20, 30, 1, 1, "imax", "normal"),
                    (22, 0, 1, 1, "standard", "back"),
                    (23, 45, 1, 1, "standard", "normal"),
                    (19, 30, 2, 2, "dolby", "normal"),
                    (21, 0, 3, 3, "standard", "normal"),
                    (20, 0, 1, 1, "dolby", "cancelled"),
                    (20, 15, 1, 1, "standard", "draft"),
                    (21, 15, 1, 2, "imax", "normal"),
                ], start=1):
                    sid = day.toordinal() * 100 + index
                    start = datetime.combine(day, time(hour, minute), BEIJING)
                    seats = make_layout()
                    allocations = {}
                    if scenario in {"back", "scattered"}:
                        free = {801, 802, 803, 804, 805} if scenario == "back" else {401, 403, 405, 407, 409}
                        allocations = {s.id: Allocation("sold") for s in seats if s.id not in free}
                    else:
                        allocations = {101: Allocation("sold"), 102: Allocation("sold"),
                                       501: Allocation("held", now + timedelta(minutes=5)),
                                       502: Allocation("held", now - timedelta(seconds=1))}
                    status = scenario if scenario in {"cancelled", "draft"} else "published"
                    price = {"standard": 4800, "imax": 6800, "dolby": 7800}[hall]
                    self._screenings[sid] = Screening(sid, film, cinema, hall, start, status, seats,
                                                      {"regular": price, "student": price - 1200}, allocations)

    def screenings(self):
        self._ensure_days()
        with self._lock:
            return list(self._screenings.values())

    def get_screening(self, screening_id):
        self._ensure_days()
        with self._lock:
            return self._screenings.get(screening_id)
