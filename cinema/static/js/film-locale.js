import translations from "../assets/film-translations.json" with { type: "json" };
import { genreLabel } from "./assistant-locale.js";
import { getLanguage } from "./locale.js";

export function filmTitle(film, language = getLanguage()) {
  const title = typeof film === "string" ? film : film?.title;
  return language === "zh" ? translations[title]?.titles?.zh ?? title : title;
}

export function filmSynopsis(film) {
  const entry = translations[film.title];
  if (getLanguage() === "zh" && entry?.synopses && entry.source_synopsis === film.synopsis) {
    return entry.synopses.zh;
  }
  return film.synopsis;
}

export function genreName(genre) {
  const name = typeof genre === "string" ? genre : genre.name;
  return getLanguage() === "zh" ? genreLabel(name, "zh") : name;
}
