import test from "node:test";
import assert from "node:assert/strict";
import { filmTitle, filmSynopsis, genreName } from "../../cinema/static/js/film-locale.js";
import { setLanguage } from "../../cinema/static/js/locale.js";

test("new films and edited synopses keep the current catalogue text", () => {
  setLanguage("zh");
  try {
    const newFilm = { title: "New film", synopsis: "New synopsis" };
    assert.equal(filmTitle(newFilm), newFilm.title);
    assert.equal(filmSynopsis(newFilm), newFilm.synopsis);
    assert.equal(genreName({ name: "New genre" }), "New genre");

    const edited = { title: "Interstellar", synopsis: "Updated synopsis" };
    assert.equal(filmTitle(edited), "星际穿越");
    assert.equal(filmSynopsis(edited), edited.synopsis);
  } finally {
    setLanguage("en");
  }
});
