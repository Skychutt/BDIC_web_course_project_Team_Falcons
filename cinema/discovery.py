"""Film discovery uses catalog metadata, never model knowledge or external scores."""
def normalized(value):
    return "".join(value.lower().split())

GENRES = {
    "science fiction": ("science fiction", "sci-fi", "scifi", "科幻"),
    "comedy": ("comedy", "喜剧"), "drama": ("drama", "剧情"),
    "adventure": ("adventure", "冒险"), "romance": ("romance", "爱情"),
    "animation": ("animation", "动画"), "thriller": ("thriller", "惊悚"),
    "mystery": ("mystery", "悬疑"), "action": ("action", "动作"),
    "horror": ("horror", "恐怖"), "documentary": ("documentary", "纪录片"),
    "biography": ("biography", "传记"), "crime": ("crime", "犯罪"),
    "fantasy": ("fantasy", "奇幻"), "family": ("family", "家庭"),
}
KEYWORDS = {
    "lighthearted": ("轻松", "轻快", "喜剧", "欢乐", "搞笑", "comedy", "lighthearted", "light-hearted", "funny"),
    "轻松": ("轻松", "轻快", "喜剧", "欢乐", "搞笑", "comedy", "lighthearted", "light-hearted", "funny"),
}


def genre_key(value):
    value = normalized(value)
    return next((key for key, words in GENRES.items() if value in map(normalized, words)), value)


def match_film(film, filters):
    if filters.film_id and film.id != filters.film_id:
        return False
    if filters.genre and genre_key(filters.genre) not in {genre_key(g) for g in film.genres}:
        return False
    if filters.keyword:
        corpus = normalized(" ".join((*film.titles.values(), *film.synopsis.values(), *film.genres)))
        words = KEYWORDS.get(filters.keyword.lower(), (filters.keyword,))
        if not any(normalized(w) in corpus for w in words):
            return False
    if filters.min_rating is not None and (film.rating is None or film.rating < filters.min_rating):
        return False
    if filters.rated_only and (film.rating is None or film.rating_count == 0):
        return False
    if (filters.showing_only or filters.recent) and not film.showing:
        return False
    return True


def film_order(film):
    return (film.rating is None, -(film.rating or 0), -film.rating_count, film.id)
