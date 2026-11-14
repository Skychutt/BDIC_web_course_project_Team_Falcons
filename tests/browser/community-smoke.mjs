/** End-to-end community checks, confined to the disposable :5002 fixture. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const fixture = JSON.parse(await fs.readFile("instance/browser-fixture.json", "utf8"));
assert.equal(fixture.base_url, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]+$/);
const base = fixture.base_url, fid = fixture.ids.film_id;
const out = "output/community-qa";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.setDefaultTimeout(10000);
const report = [];
async function check(name, fn) { await fn(); report.push(name); console.log("PASS", name); }
async function api(path) {
  const response = await context.request.get(base + "/api" + path);
  assert.ok(response.ok(), await response.text());
  return (await response.json()).data;
}
async function noOverflow() {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert.ok(sizes.width <= sizes.viewport + 1, JSON.stringify(sizes));
}
try {
  await check("Header entry, film search and guest community access", async () => {
    await page.goto(base + "/#/reviews");
    await page.locator(".review-film-card").first().waitFor();
    assert.equal(await page.locator('.main-nav a[aria-current="page"]').textContent(), "Reviews");
    await page.getByRole("textbox", { name: "Search films" }).fill("NO SUCH FILM 123");
    await page.getByRole("heading", { name: "No films found" }).waitFor();
    await page.getByRole("textbox", { name: "Search films" }).fill("");
    await page.locator(".review-film-card").first().click();
    await page.getByRole("link", { name: "Sign in to rate and review" }).waitFor();
    await noOverflow();
  });
  await check("Sign-in returns to film; five stars upsert the shared rating", async () => {
    await page.getByRole("link", { name: "Sign in to rate and review" }).click();
    await page.getByLabel("Email address").fill("customer@cinema.test");
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.locator('#auth-form button[type="submit"]').click();
    await page.getByRole("radio", { name: "4 stars", exact: true }).check();
    await page.locator('#community-review-form textarea').fill('A thoughtful film. <img src=x onerror="alert(1)">');
    await page.getByRole("button", { name: "Save my rating" }).click();
    await page.getByRole("button", { name: "Update my review" }).waitFor();
    assert.equal((await api(`/films/${fid}`)).rating.average, "8.0");
    assert.equal(await page.locator('.community-review-list img').count(), 0);
    await page.reload();
    await page.getByRole("radio", { name: "4 stars", exact: true }).waitFor();
    assert.ok(await page.getByRole("radio", { name: "4 stars", exact: true }).isChecked());
    await page.getByRole("radio", { name: "5 stars", exact: true }).check();
    await page.locator('#community-review-form textarea').fill("The story stayed with me long after the credits. A wonderful film.");
    await page.getByRole("button", { name: "Update my review" }).click();
    await page.locator('.community-score-number').filter({ hasText: "10.0" }).waitFor();
    const film = await api(`/films/${fid}`);
    assert.equal(film.rating.average, "10.0");
    assert.equal(film.rating.count, 1);
    assert.equal((await api(`/community/films/${fid}/reviews`)).total, 1);
    await page.screenshot({ path: out + "/film-review-desktop.png", fullPage: true });
  });
  let tid;
  await check("Discussion publishing, spoiler protection and replying", async () => {
    await page.getByRole("link", { name: "Discussions 0", exact: true }).click();
    await page.locator(".new-thread > summary").click();
    await page.getByLabel("Discussion title").fill("What did the final scene mean to you?");
    await page.getByLabel("Your thoughts").fill("I think the final journey is about finding a way home, rather than leaving it behind.");
    await page.locator('#community-thread-form input[name="spoiler"]').check();
    await page.getByRole("button", { name: "Publish discussion" }).click();
    await page.locator(".discussion-main").waitFor();
    tid = page.url().split("/thread/")[1];
    assert.equal(await page.locator('.discussion-main .community-text').isVisible(), false);
    await page.locator('.spoiler-block summary').click();
    assert.equal(await page.locator('.discussion-main .community-text').isVisible(), true);
    await page.getByLabel("Join the conversation").fill("Would love to hear another interpretation.");
    await page.getByRole("button", { name: "Post reply" }).click();
    await page.getByRole("heading", { name: "1 reply", exact: true, includeHidden: true }).waitFor({ state: "attached" });
    await page.locator('.spoiler-replies > summary').click();
    await page.getByText("Would love to hear another interpretation.", { exact: true }).waitFor();
    assert.equal((await api(`/community/threads/${tid}`)).replies.total, 1);
  });
  await check("Second customer can reply without editing someone else's post", async () => {
    const other = await browser.newContext();
    try {
      const csrf = (await (await other.request.get(base + "/api/auth/csrf")).json()).data.csrf_token;
      const response = await other.request.post(base + "/api/auth/login", { headers: { "X-CSRF-Token": csrf }, data: { email: "customer2@cinema.test", password: fixture.password } });
      const token = (await response.json()).data.csrf_token;
      const reply = await other.request.post(base + `/api/community/threads/${tid}/replies`, { headers: { "X-CSRF-Token": token, "Idempotency-Key": "browser-community-reply" }, data: { body: "For me it was a new beginning. I loved the ambiguity." } });
      assert.equal(reply.status(), 201);
      await page.reload();
      await page.locator('.spoiler-replies > summary').click();
      await page.getByText("For me it was a new beginning. I loved the ambiguity.", { exact: true }).waitFor();
      assert.equal(await page.locator('.discussion-replies .remove-post').count(), 1);
      await page.screenshot({ path: out + "/discussion-desktop.png", fullPage: true });
    } finally { await other.close(); }
  });
  await check("Film-detail links, showtimes and seat selection remain available", async () => {
    await page.goto(base + `/#/film/${fid}`);
    await page.getByRole("link", { name: "Reviews & discussions", exact: true }).click();
    await page.getByRole("link", { name: "Find showtimes", exact: true }).click();
    await page.locator('input[name="date"]').waitFor();
    const first = fixture.screenings.find(s => s.film_id === fid && new Date(s.starts_at).getTime() > Date.now());
    assert.ok(first);
    await page.locator('input[name="date"]').fill(first.starts_at.slice(0, 10));
    await page.getByRole("button", { name: "Find showtimes", exact: true }).click();
    await page.locator(`a[href^="#/seats/${first.id}"]`).first().click();
    await page.locator("button.seat").first().waitFor();
  });
  await check("Mobile layouts have no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [hash, selector, file] of [["#/reviews", ".review-film-card", "directory-mobile"], [`#/reviews/film/${fid}`, "#community-review-form", "film-mobile"], [`#/reviews/thread/${tid}`, ".discussion-main", "discussion-mobile"]]) {
      await page.goto(base + "/" + hash);
      await page.locator(selector).first().waitFor();
      await noOverflow();
      await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });
    }
  });
  assert.deepEqual(errors, []);
  await fs.writeFile(out + "/results.json", JSON.stringify({ passed: report, errors }, null, 2));
} finally { await browser.close(); }
