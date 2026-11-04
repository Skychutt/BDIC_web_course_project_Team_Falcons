/** Browser-driven checkout, response-loss recovery, rescheduling and discovery.
 * Only operates on the disposable :5002 fixture; API reads verify actual state.
 * Usage: CINEMA_QA_PASSWORD=... node tests/browser/customer-smoke.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PACKAGE ||
    "playwright",
);
const fixture = JSON.parse(
  await fs.readFile("instance/browser-fixture.json", "utf8"),
);
const base = fixture.base_url;
assert.equal(base, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]+$/);
const password = process.env.CINEMA_QA_PASSWORD;
assert.ok(password);
const out = "docs/browser-customer";
await fs.mkdir(out, { recursive: true });
const report = {
  run_at: new Date().toISOString(),
  base,
  checks: [],
  page_errors: [],
  screenshots: [],
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (e) => report.page_errors.push(e.message));
async function api(path) {
  const r = await context.request.get(base + "/api" + path);
  const j = await r.json();
  assert.ok(r.ok(), JSON.stringify(j));
  return j.data;
}
async function check(name, fn) {
  await fn();
  report.checks.push({ name, status: "passed" });
  console.log("PASS " + name);
}
async function shot(name) {
  await page
    .locator(".toast")
    .waitFor({ state: "hidden", timeout: 7000 })
    .catch(() => {});
  await page.screenshot({ path: out + "/" + name + ".png", fullPage: true });
  report.screenshots.push(name + ".png");
}
async function noOverflow() {
  const d = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(d.width <= d.viewport + 1, JSON.stringify(d));
}
try {
  const cinemaId = fixture.ids.cinemas[0];
  const showings = fixture.screenings
    .filter((s) => s.cinema_id === cinemaId)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const first = showings[0],
    target = showings[1];
  assert.ok(first && target);
  await check(
    "Browser sign-in and server-provided discovery filters",
    async () => {
      await page.goto(base + "/#/login");
      await page.getByLabel("Email address").fill("customer@cinema.test");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.locator("#auth-form button[type=submit]").click();
      await page
        .getByRole("heading", { name: "Find your next screening", exact: true })
        .waitFor();
      await page.locator("input[name=date]").fill(first.starts_at.slice(0, 10));
      await page.locator("select[name=cinema_id]").selectOption(cinemaId);
      await page.locator("select[name=party_size]").selectOption("2");
      await page.getByRole("button", { name: "Find showtimes" }).click();
      await page
        .locator(`.session-button[href^="#/seats/${first.id}?"]`)
        .waitFor();
      await noOverflow();
      await shot("discovery-desktop");
    },
  );
  const map = await api("/screenings/" + first.id + "/seats");
  const seatIds = map.seats
    .filter((s) => s.state === "AVAILABLE" && Number(s.row_no) < 4)
    .slice(0, 2)
    .map((s) => s.id);
  assert.equal(seatIds.length, 2);
  await check(
    "Choose actual seats, hold them, preserve deadline on refresh",
    async () => {
      await page
        .locator(`.session-button[href^="#/seats/${first.id}?"]`)
        .click();
      await page.locator(".seat-grid").waitFor();
      while (await page.locator("[data-seat][aria-pressed=true]").count())
        await page.locator("[data-seat][aria-pressed=true]").first().click();
      for (const id of seatIds)
        await page.locator(`[data-seat="${id}"]`).click();
      await shot("seat-selection-desktop");
      await page.locator("#create-hold").click();
      await page.locator("#quote-form").waitFor();
      const holdId = new URLSearchParams(page.url().split("?")[1]).get(
        "hold_id",
      );
      assert.ok(holdId);
      report.hold_id = holdId;
      const before = (await api("/me/holds?page_size=100")).items.find(
        (h) => h.id === holdId,
      );
      await page.reload();
      await page.locator("#quote-form").waitFor();
      const after = (await api("/me/holds?page_size=100")).items.find(
        (h) => h.id === holdId,
      );
      assert.equal(after.expires_at, before.expires_at);
      await page.locator("[data-fare]").nth(1).selectOption("STUDENT");
      await page.locator("#quote-form button[type=submit]").click();
      await page.locator("#pay-now").waitFor();
      await shot("checkout-desktop");
    },
  );
  const walletBefore = await api("/me/wallet");
  const entriesBefore = await api("/me/wallet-entries?page_size=100");
  let receipt;
  await check(
    "Lost successful payment response recovers after reload with one debit",
    async () => {
      let locked = false;
      await page.route("**/api/bookings", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        const j = await response.json();
        assert.equal(response.status(), 201);
        receipt = j.data;
        locked =
          (await page.locator("[data-fare]").first().isDisabled()) &&
          (await page.locator("#coupon").isDisabled()) &&
          (await page.locator("#change-seats").isDisabled());
        await route.abort("failed");
      });
      await page.locator("#pay-now").click();
      await page
        .getByRole("button", { name: "Check payment result" })
        .waitFor();
      assert.ok(
        locked,
        "All checkout-changing controls must lock during payment",
      );
      await page.unroute("**/api/bookings");
      await page.reload();
      await page
        .getByRole("button", { name: "Check payment result" })
        .waitFor();
      assert.equal(await page.locator(".seat-tag").count(), 2);
      await page.getByRole("button", { name: "Check payment result" }).click();
      await page
        .getByRole("heading", { name: "See you at the cinema." })
        .waitFor();
      const walletAfter = await api("/me/wallet");
      assert.equal(
        walletBefore.balance_minor - walletAfter.balance_minor,
        receipt.amount_due_minor,
      );
      const entries = await api("/me/wallet-entries?page_size=100");
      const newEntries = entries.items.filter(
        (e) => !entriesBefore.items.some((old) => old.id === e.id),
      );
      assert.equal(newEntries.length, 1);
      assert.equal(newEntries[0].entry_type, "PAYMENT");
      assert.equal(newEntries[0].amount_minor, -receipt.amount_due_minor);
      report.booking_id = receipt.booking_id;
      await shot("purchase-success");
    },
  );
  await check(
    "Whole-booking reschedule keeps fare mix and replaces old tickets atomically",
    async () => {
      await page.getByRole("link", { name: "View my tickets" }).click();
      await page.locator(`[data-booking="${receipt.booking_id}"]`).waitFor();
      await page
        .locator(`[data-booking="${receipt.booking_id}"]`)
        .getByRole("link", { name: "Reschedule party" })
        .click();
      await page
        .getByRole("heading", { name: "Find your next screening." })
        .waitFor();
      await page
        .locator("input[name=date]")
        .fill(target.starts_at.slice(0, 10));
      await page.getByRole("button", { name: "Find showtimes" }).click();
      await page
        .locator(`.session-button[href^="#/seats/${target.id}?"]`)
        .click();
      await page.locator("#create-hold").click();
      await page.locator("#quote-form").waitFor();
      assert.equal(await page.locator("[data-fare]:disabled").count(), 2);
      assert.deepEqual(
        (
          await page
            .locator("[data-fare]")
            .evaluateAll((xs) => xs.map((x) => x.value))
        ).sort(),
        ["STANDARD", "STUDENT"],
      );
      await page.locator("#quote-form button[type=submit]").click();
      await page.locator("#pay-now").waitFor();
      await shot("reschedule-quote");
      await page.locator("#pay-now").click();
      await page
        .getByRole("heading", { name: "Your booking is changed." })
        .waitFor();
      const href = await page
        .getByRole("link", { name: "View my tickets" })
        .getAttribute("href");
      const newId = new URLSearchParams(href.split("?")[1]).get("booking");
      const original = await api("/ui/bookings/" + receipt.booking_id),
        current = await api("/ui/bookings/" + newId);
      assert.equal(original.status, "RESCHEDULED");
      assert.equal(current.status, "CONFIRMED");
      assert.equal(current.predecessor_id, receipt.booking_id);
      assert.equal(current.tickets.length, 2);
      assert.deepEqual(current.tickets.map((t) => t.fare_type).sort(), [
        "STANDARD",
        "STUDENT",
      ]);
      report.rescheduled_booking_id = newId;
    },
  );
  await check("Customer rating updates the real film aggregate", async () => {
    await page.goto(base + "/#/film/" + fixture.ids.film_id);
    await page.getByRole("radio", { name: "8 points", exact: true }).check();
    await page.getByRole("button", { name: "Save my rating" }).click();
    await page
      .getByText("Your rating has been saved.", { exact: true })
      .waitFor();
    const film = await api("/films/" + fixture.ids.film_id);
    assert.ok(film.rating.count >= 1);
    await shot("film-detail");
  });
  await check(
    "Floating assistant keeps conversation and draft across page navigation",
    async () => {
      await page.goto(base + "/#/assistant");
      await page.locator("#ai-message").waitFor();
      assert.ok(page.url().endsWith("#/discover"));
      assert.match(await page.locator("#ai-mode").innerText(), /offline parser/i);
      await page.locator("#ai-message").fill(`${target.starts_at.slice(0, 10)} for two people, middle seats`);
      await page.locator("#ai-send").click();
      await page.locator('.ai-widget-results .recommendation').first().waitFor();
      await page.locator('.ai-widget-preferences summary').click();
      assert.match(await page.locator("#ai-conditions").innerText(), /2 people/i);
      const bookingLink = await page.locator('.ai-widget-results a[href*="from=assistant"]').first().getAttribute("href");
      assert.match(bookingLink, /^#\/seats\/\d+\?/);
      await page.locator("#ai-message").fill("Keep this draft");
      await page.locator("#ai-close").click();
      await page.locator('.main-nav a[href="#/cinemas"]').click();
      await page.locator('.ai-launcher').click();
      assert.equal(await page.locator("#ai-message").inputValue(), "Keep this draft");
      assert.ok((await page.locator('.ai-widget-results .recommendation').count()) > 0);
      await page.locator('.ai-widget-results a[href*="from=assistant"]').first().click();
      await page.locator('.seat-grid').waitFor();
      assert.equal(await page.locator('#assistant-panel').isVisible(), false);
      await page.locator('.ai-launcher').click();
      assert.equal(await page.locator("#ai-message").inputValue(), "Keep this draft");
      await page.locator("#ai-message").press("Escape");
      assert.equal(await page.locator('#assistant-panel').isVisible(), false);
      await shot("assistant-desktop");
    },
  );
  await check(
    "390 px discovery and seat map remain usable without page overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(
        base + "/#/discover?date=" + target.starts_at.slice(0, 10),
      );
      await page.locator(".session-button").first().waitFor();
      await noOverflow();
      await shot("discovery-mobile");
      await page.goto(base + "/#/seats/" + target.id);
      await page.locator(".seat-grid").waitFor();
      await noOverflow();
      await shot("seat-selection-mobile");
    },
  );
  assert.deepEqual(report.page_errors, []);
  report.status = "passed";
} catch (e) {
  report.status = "failed";
  report.error = e.stack;
  await shot("failure").catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await fs.writeFile(out + "/results.json", JSON.stringify(report, null, 2));
  await browser.close();
}
