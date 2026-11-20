/** The real discovery UI with two films from the demo programme. No database setup required. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const catalogue = JSON.parse(await readFile(new URL("../../data/catalogue-expansion-20261114.json", import.meta.url)));
const originals = ["Interstellar", "Inception"].map(title => catalogue.films.find(f => f.title === title));
const zhGenres = { Adventure: "冒险", Drama: "剧情", Mystery: "悬疑", "Sci-Fi": "科幻" };
const genres = Object.keys(zhGenres).map((name, index) => ({ id: String(index + 1), name }));
const films = originals.map((film, index) => ({
  id: String(index + 1), title: film.title, synopsis: film.synopsis,
  duration_minutes: film.duration_minutes, genres: film.genres.map(name => genres.find(g => g.name === name)),
  rating: { average: film.rating_seed.score, count: film.rating_seed.vote_count },
}));

const browser = await chromium.launch({
  headless: true, ...(process.env.CINEMA_QA_CHROME ? { channel: "chrome" } : {}),
});
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const respond = (route, data) => route.fulfill({ json: { data } });
  await page.route("**/api/auth/csrf", route => respond(route, { csrf_token: "test" }));
  await page.route("**/api/ui/bootstrap", route => respond(route, { films, genres, districts: [], cinemas: [], available_dates: [] }));
  await page.route("**/api/screenings?*", route => respond(route, { items: [], total: 0, page: 1, page_size: 20 }));
  await page.route("**/api/films/2", route => respond(route, films[1]));
  await page.goto((process.env.CINEMA_BASE_URL || "http://127.0.0.1:5002") + "/#/discover");

  const language = value => page.locator(`#site-header [data-lang="${value}"]`).click();
  const active = page.locator("[data-featured-slide].is-active");
  const filmFilter = page.locator("select[name=film_id]");
  const genreFilter = page.locator("select[name=genre_id]");
  const sciFi = genres.find(g => g.name === "Sci-Fi");
  await page.getByRole("button", { name: "Next film" }).click();
  await page.locator(".search-advanced summary").click();
  await filmFilter.selectOption(films[1].id);
  await genreFilter.selectOption(sciFi.id);

  for (const code of ["zh", "en"]) {
    await language(code);
    assert.equal(await filmFilter.inputValue(), films[1].id);
    assert.equal(await genreFilter.inputValue(), sciFi.id);
    assert.equal(await genreFilter.locator("option:checked").textContent(), code === "zh" ? "科幻" : "Sci-Fi");
    const expectedActive = code === "zh" ? "盗梦空间" : "Inception";
    assert.equal(await filmFilter.locator("option:checked").textContent(), expectedActive);
    assert.equal(await active.locator("h1").textContent(), expectedActive);
    for (const [index, film] of originals.entries()) {
      const title = code === "zh" ? film.title_zh : film.title;
      const synopsis = code === "zh" ? film.synopsis_zh : film.synopsis;
      const names = film.genres.map(name => code === "zh" ? zhGenres[name] : name);
      const slide = page.locator("[data-featured-slide]").nth(index);
      const card = page.locator(".catalogue-film").nth(index);
      assert.equal(await slide.locator("h1").textContent(), title);
      assert.equal(await slide.locator(".hero-description").textContent(), synopsis);
      assert.deepEqual((await slide.locator(".hero-metadata span").allTextContents()).slice(1), names);
      assert.equal(await card.locator("h3").textContent(), title);
      assert.equal(await card.locator(".catalogue-synopsis").textContent(), synopsis);
      assert.deepEqual((await card.locator(".catalogue-meta").textContent()).split(" · ").slice(1), names);
      for (const image of [card.locator("img"), slide.locator("img")]) {
        assert.equal(await image.getAttribute("src"), "/static/assets/" + film.poster);
        assert.ok((await image.getAttribute("alt")).includes(title));
      }
    }
  }

  await language("zh");
  await active.locator(".hero-details").click();
  assert.equal(await page.locator(".film-detail h1").textContent(), "盗梦空间");
  assert.equal(await page.locator(".film-detail .synopsis").textContent(), originals[1].synopsis_zh);
  assert.equal(await page.locator(".film-detail img").getAttribute("src"), "/static/assets/inception.jpg");
  await page.getByRole("link", { name: "查找场次" }).click();
  assert.equal(await filmFilter.inputValue(), films[1].id);
  assert.equal(await filmFilter.locator("option:checked").textContent(), "盗梦空间");
  console.log("PASS film metadata, posters, carousel selection and showtime filters switch languages together");
} finally {
  await browser.close();
}
