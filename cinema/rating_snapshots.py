"""Verified external rating snapshots, kept separate from Falcons customer votes."""
from datetime import date
from decimal import Decimal, InvalidOperation
from importlib.resources import files
import re

from .core import execute, one, rows


def initialize_rating_snapshots(engine):
    sql = files("cinema").joinpath("sql/005_rating_snapshots.sql").read_text(encoding="utf-8")
    with engine.begin() as c:
        for statement in sql.split(";"):
            if statement.strip():
                c.exec_driver_sql(statement)


def validate_snapshot(item):
    """Keep the provider's displayed precision; do not infer exact bucket counts."""
    try:
        if item["source_name"] != "Douban" or not re.fullmatch(
            r"https://movie\.douban\.com/subject/[0-9]+/", item["source_url"]
        ):
            raise ValueError("Expected a canonical Douban subject URL")
        checked = date.fromisoformat(item["checked_on"])
        if checked > date.today():
            raise ValueError("Verification date cannot be in the future")
        score = Decimal(str(item["score"]))
        percentages = [Decimal(str(item[f"star_{n}"])) for n in range(1, 6)]
        if not all(p.is_finite() and 0 <= p <= 100 and p == p.quantize(Decimal("0.1")) for p in percentages):
            raise ValueError("Expected published percentages with one decimal place")
        if abs(sum(percentages) - 100) > Decimal("0.3"):
            raise ValueError("Star percentages must total approximately 100%")
        if not score.is_finite() or not 0 <= score <= 10 or score != score.quantize(Decimal("0.1")):
            raise ValueError("Invalid source score")
        if type(item["vote_count"]) is not int or item["vote_count"] <= 0:
            raise ValueError("Expected a positive source vote count")
        for field in ("film_title", "source_title"):
            if not isinstance(item[field], str) or not 1 <= len(item[field]) <= 255:
                raise ValueError("A matching film title is required")
    except (KeyError, TypeError, InvalidOperation) as error:
        raise ValueError("Incomplete or invalid rating snapshot") from error


def import_snapshots(c, items):
    """Resolve exact catalogue titles and validate the entire batch before writing."""
    prepared = []
    seen = set()
    for item in items:
        validate_snapshot(item)
        matches = rows(c, "SELECT id FROM films WHERE title=:t", t=item["film_title"])
        if len(matches) != 1:
            raise ValueError(f"Expected one matching film: {item['film_title']}")
        fid = matches[0]["id"]
        if fid in seen:
            raise ValueError("Duplicate film in rating snapshots")
        seen.add(fid)
        previous = one(c, "SELECT checked_on FROM film_rating_snapshots WHERE film_id=:f", f=fid)
        if previous and previous["checked_on"] > date.fromisoformat(item["checked_on"]):
            raise ValueError("Refusing to replace a newer rating snapshot")
        prepared.append(dict(item, film_id=fid))
    fields = ["source_name", "source_url", "source_title", "checked_on", "score", "vote_count",
              "star_5", "star_4", "star_3", "star_2", "star_1"]
    for item in prepared:
        execute(c, f"""INSERT INTO film_rating_snapshots(film_id,{','.join(fields)})
            VALUES(:film_id,{','.join(':' + f for f in fields)})
            ON DUPLICATE KEY UPDATE {','.join(f + '=:' + f for f in fields)}""", **item)
    return len(prepared)


def get_snapshot(c, fid):
    snapshot = one(c, "SELECT * FROM film_rating_snapshots WHERE film_id=:f", f=fid)
    if snapshot:
        snapshot.pop("film_id")
        snapshot["distribution"] = [dict(stars=n, percent=snapshot.pop(f"star_{n}")) for n in range(5, 0, -1)]
    return snapshot
