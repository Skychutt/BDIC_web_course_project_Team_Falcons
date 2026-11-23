"""Reviewed catalogue translations shared by the booking UI and assistant."""
import json
from importlib.resources import files

_assets = files("cinema").joinpath("static/assets")
FILM_TRANSLATIONS = json.loads(_assets.joinpath("film-translations.json").read_text(encoding="utf-8"))
CINEMA_TRANSLATIONS = json.loads(_assets.joinpath("cinema-translations.json").read_text(encoding="utf-8"))["cinemas"]


def matching_film_titles(query):
    """Return stored titles whose translated titles contain the literal search text."""
    needle = query.casefold()
    return [title for title, entry in FILM_TRANSLATIONS.items()
            if any(needle in alias.casefold() for alias in entry["titles"].values())]
