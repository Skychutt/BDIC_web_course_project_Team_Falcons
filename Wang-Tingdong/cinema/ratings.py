"""One 10-point rating aggregate for catalogue, screenings and the assistant."""
from importlib.resources import files

from .core import execute, in_ids, rows

VERSION = "ten_point_v1"


def initialize_ratings(engine):
    """Used after creating a fresh 10-point schema, never to upgrade old votes."""
    create_rating_tables(engine)
    with engine.begin() as c:
        execute(c, "INSERT IGNORE INTO rating_schema_versions(version) VALUES(:v)", v=VERSION)


def create_rating_tables(engine):
    script = files("cinema").joinpath("sql/003_rating_baselines.sql").read_text(encoding="utf-8")
    script = "\n".join(line for line in script.splitlines() if not line.lstrip().startswith("--"))
    with engine.begin() as c:
        for statement in script.split(";"):
            if statement.strip():
                c.exec_driver_sql(statement)


def attach_ratings(c, films):
    if not films:
        return films
    ids = in_ids(f["id"] for f in films)
    values = {item.pop("film_id"): item for item in rows(c, f"""
        SELECT f.id AS film_id,
          ROUND((COALESCE(b.score*b.vote_count,0)+COALESCE(v.total,0)) /
                NULLIF(COALESCE(b.vote_count,0)+COALESCE(v.votes,0),0),1) AS average,
          COALESCE(b.vote_count,0)+COALESCE(v.votes,0) AS count
        FROM films f LEFT JOIN film_rating_baselines b ON b.film_id=f.id
        LEFT JOIN (SELECT film_id,SUM(stars) AS total,COUNT(*) AS votes
                   FROM ratings WHERE film_id IN ({ids}) GROUP BY film_id) v ON v.film_id=f.id
        WHERE f.id IN ({ids})""")}
    for film in films:
        film["rating"] = {**values[film["id"]], "scale": 10}
    return films


def import_rating_baselines(c, programme, film_ids):
    for film in programme["films"]:
        rating = film.get("rating_seed")
        if rating is not None:
            execute(c, """INSERT INTO film_rating_baselines(film_id,score,vote_count)
                VALUES(:film_id,:score,:vote_count)
                ON DUPLICATE KEY UPDATE score=:score,vote_count=:vote_count""",
                film_id=film_ids[film["key"]], **rating)
