/**
 * Customer personal-centre browser checks against an explicitly isolated server.
 * Login and account actions use the browser. Tickets/holds used as fixtures are
 * created through the authenticated API and are recorded separately in results.
 * Run from backend with CINEMA_QA_PASSWORD and, optionally,
 * CINEMA_QA_COMPENSATION=1 to coordinate the operations-smoke fixture.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_PACKAGE ||
    "playwright",
);
const base = process.env.CINEMA_QA_BASE || "http://127.0.0.1:5002";
const password = process.env.CINEMA_QA_PASSWORD;
assert.ok(password, "Set CINEMA_QA_PASSWORD for the isolated demo account.");
assert.equal(
  new URL(base).port,
  "5002",
  "This script must only target the isolated QA server on port 5002.",
);
const backend = fileURLToPath(new URL("../..", import.meta.url));
const fixtureIdentity = JSON.parse(
  await fs.readFile(
    path.join(backend, "instance/browser-fixture.json"),
    "utf8",
  ),
);
assert.equal(fixtureIdentity.base_url, base);
assert.match(fixtureIdentity.schema, /^cinema_browser_[a-f0-9]+$/);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");
await fs.mkdir(out, { recursive: true });
const report = {
  run_at: new Date().toISOString(),
  base,
  schema: fixtureIdentity.schema,
  user: "customer2@cinema.test",
  browser_checks: [],
  api_fixtures: [],
  page_errors: [],
  screenshots: [],
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1380, height: 1000 },
  locale: "en-GB",
  timezoneId: "Asia/Shanghai",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => report.page_errors.push(error.message));
let csrf;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(name, fn) {
  await fn();
  report.browser_checks.push({ name, status: "passed" });
  console.log(`PASS ${name}`);
}
async function api(endpoint, method = "GET", body, key) {
  const response = await context.request.fetch(base + "/api" + endpoint, {
    method,
    data: body,
    headers: {
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
  });
  const result = await response.json();
  assert.ok(response.ok(), `${method} ${endpoint}: ${JSON.stringify(result)}`);
  return result.data;
}
async function section(tab) {
  await page.goto(`${base}/#/account?tab=${tab}`);
  await page.locator("#account-balance").waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#account-content")
        ?.innerText.startsWith("Loading"),
  );
}
async function screenshot(name) {
  const destination = path.join(out, name);
  if (await page.locator(".toast").count())
    await page
      .locator(".toast")
      .last()
      .waitFor({ state: "hidden", timeout: 7500 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: destination, fullPage: true });
  report.screenshots.push(destination);
}
async function overflowCheck() {
  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  assert.ok(
    dimensions.content <= dimensions.viewport + 1,
    JSON.stringify(dimensions),
  );
}
async function holdSeats(screeningId, minRow = 10, partySize = 2) {
  const map = await api(`/screenings/${screeningId}/seats`);
  const seats = map.seats
    .filter((s) => s.state === "AVAILABLE" && Number(s.row_no) >= minRow)
    .slice(-partySize);
  assert.equal(
    seats.length,
    partySize,
    "Fixture requires available seats in the permitted rows.",
  );
  const hold = await api(
    "/holds",
    "POST",
    { screening_id: screeningId, seat_ids: seats.map((s) => s.id) },
    crypto.randomUUID(),
  );
  report.api_fixtures.push({
    kind: "hold",
    hold_id: hold.hold_id,
    screening_id: screeningId,
    seat_labels: seats.map((s) => `Row ${s.row_no}, Seat ${s.seat_no}`),
  });
  return hold;
}
async function purchaseFixture(screeningId, minRow = 10, partySize = 2) {
  const hold = await holdSeats(screeningId, minRow, partySize);
  const quote = await api(`/holds/${hold.hold_id}/quote`, "POST", {
    tickets: hold.seat_ids.map((seat_id, i) => ({
      seat_id,
      fare_type: i ? "STUDENT" : "STANDARD",
    })),
  });
  const receipt = await api(
    "/bookings",
    "POST",
    { quote_token: quote.quote_token },
    crypto.randomUUID(),
  );
  report.api_fixtures.push({
    kind: "purchase",
    booking_id: receipt.booking_id,
    amount_due_minor: receipt.amount_due_minor,
  });
  return api(`/ui/bookings/${receipt.booking_id}`);
}
async function waitJSON(filename, timeout = 900000, expectedRun = null) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const data = JSON.parse(
        await fs.readFile(path.join(out, filename), "utf8"),
      );
      if (!expectedRun || data.run_id === expectedRun) return data;
      await sleep(1000);
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
      await sleep(1000);
    }
  }
  throw new Error(`Timed out waiting for ${filename}`);
}

try {
  // Wait for the root-authored seat module before loading the static import graph.
  const begun = Date.now();
  while (!(await context.request.get(base + "/static/js/seats.js")).ok()) {
    assert.ok(Date.now() - begun < 180000, "seats.js did not become available");
    await sleep(1000);
  }
  await check("Browser sign-in and personal wallet load", async () => {
    await page.goto(`${base}/#/login?next=${encodeURIComponent("#/account")}`);
    await page.getByLabel("Email address").fill(report.user);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.locator("#auth-form button[type=submit]").click();
    await page.getByRole("heading", { name: "Your cinema journal" }).waitFor();
    await page.waitForFunction(() =>
      /\d/.test(document.querySelector("#account-balance")?.textContent || ""),
    );
    csrf = (await api("/auth/csrf")).csrf_token;
    const current = await api("/auth/me");
    assert.equal(current.email_normalized, report.user);
  });
  const bootstrap = await api("/ui/bootstrap");
  const list = await api(
    `/screenings?date=${bootstrap.available_dates[0]}&page_size=100`,
  );
  assert.ok(list.items.length, "Demo screenings are needed");
  let booking = (
    await api("/ui/bookings?status=CONFIRMED&page_size=100")
  ).items.find((b) => b.film_id === bootstrap.films[0].id);
  if (!booking) booking = await purchaseFixture(list.items[0].id);
  else {
    booking = await api(`/ui/bookings/${booking.id}`);
    report.api_fixtures.push({
      kind: "reused_booking",
      booking_id: booking.id,
      source:
        "Existing isolated customer fixture; this browser check does not claim checkout coverage.",
    });
  }

  await check(
    "Confirmed booking, ticket details and separate fee amounts",
    async () => {
      await section("orders");
      const card = page.locator(`[data-booking="${booking.id}"]`);
      await card
        .getByText("Seats, fees & compensation", { exact: true })
        .click();
      await card.getByRole("table").waitFor();
      assert.equal(
        await card.locator("tbody tr").count(),
        booking.tickets.length,
      );
      assert.match(await card.innerText(), /Row \d+ · Seat \d+/);
      assert.match(
        await card.innerText(),
        /Total fees across this booking chain/,
      );
      assert.match(await card.innerText(), /Compensation coupon/);
      await screenshot("account-desktop.png");
      await overflowCheck();
    },
  );
  await check(
    "Reschedule link preserves source ID and fixed party/cinema/film",
    async () => {
      await page
        .locator(`[data-booking="${booking.id}"]`)
        .getByRole("link", { name: "Reschedule party" })
        .click();
      await page
        .getByRole("heading", { name: "Find your next screening." })
        .waitFor();
      assert.equal(
        new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get(
          "source_booking_id",
        ),
        booking.id,
      );
      assert.equal(
        await page.locator("select[name=cinema_id]").inputValue(),
        booking.cinema_id,
      );
      assert.equal(
        await page.locator("select[name=film_id]").inputValue(),
        booking.film_id,
      );
      assert.equal(
        await page.locator("select[name=party_size]").inputValue(),
        String(booking.tickets.length),
      );
      assert.ok(await page.locator("select[name=cinema_id]").isDisabled());
      await page.getByRole("link", { name: "My tickets", exact: true }).click();
      await page
        .getByRole("heading", { name: "Your cinema journal" })
        .waitFor();
    },
  );
  await check(
    "Order status tabs use server-side status filtering",
    async () => {
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().includes("/api/ui/bookings?") &&
          r.url().includes("status=HISTORY"),
      );
      await page
        .getByRole("link", { name: "History & cancellations", exact: true })
        .click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#account-content")
            ?.innerText.startsWith("Loading"),
      );
      assert.equal(
        await page.locator(`[data-booking="${booking.id}"]`).count(),
        0,
      );
      await page
        .getByRole("link", { name: "All bookings", exact: true })
        .click();
      await page.locator(`[data-booking="${booking.id}"]`).waitFor();
    },
  );
  await check(
    "Wallet history reflects immutable payment and balance records",
    async () => {
      await section("wallet");
      await page.getByRole("table").waitFor();
      const entries = await api("/me/wallet-entries?page_size=100");
      assert.ok(
        entries.items.some(
          (e) => e.entry_type === "PAYMENT" && e.amount_minor < 0,
        ),
      );
      assert.match(
        await page.getByRole("table").innerText(),
        /Ticket \/ rescheduling payment/,
      );
      assert.match(await page.getByRole("table").innerText(), /Balance after/i);
    },
  );

  const activeHold = await holdSeats(booking.screening_id, 10);
  await check(
    "Hold list resumes the exact existing hold and keeps its deadline",
    async () => {
      await section("holds");
      const card = page.locator(`[data-hold="${activeHold.hold_id}"]`);
      await card.locator("[data-countdown]").waitFor();
      assert.equal(
        await card.getAttribute("data-expires"),
        activeHold.expires_at,
      );
      const href = await card.locator("[data-resume]").getAttribute("href");
      assert.equal(
        href,
        `#/seats/${booking.screening_id}?hold_id=${activeHold.hold_id}`,
      );
      await card
        .getByRole("button", { name: "Release hold", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Keep my seats" }).click();
      assert.equal(await page.getByRole("dialog").count(), 0);
      const holds = await api("/me/holds?page_size=100");
      assert.equal(
        holds.items.find((h) => h.id === activeHold.hold_id).expires_at,
        activeHold.expires_at,
      );
      await card.locator("[data-resume]").click();
      await page.waitForFunction(() => document.querySelector(".seat-layout"));
      assert.equal(
        new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get(
          "hold_id",
        ),
        activeHold.hold_id,
      );
    },
  );
  await check(
    "Customer releases an unpaid hold through confirmation dialog",
    async () => {
      await section("holds");
      const card = page.locator(`[data-hold="${activeHold.hold_id}"]`);
      await card
        .getByRole("button", { name: "Release hold", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Release seats", exact: true })
        .click();
      await page.getByText("Seat hold released", { exact: true }).waitFor();
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-hold="${id}"] [data-resume]`),
        activeHold.hold_id,
      );
      const latest = (await api("/me/holds?page_size=100")).items.find(
        (h) => h.id === activeHold.hold_id,
      );
      assert.equal(latest.effective_status, "CANCELLED");
      assert.equal(
        (await api(`/ui/bookings/${booking.id}`)).status,
        "CONFIRMED",
      );
    },
  );

  if (process.env.CINEMA_QA_COMPENSATION === "1") {
    console.log(
      "Waiting for independently created operations screening fixture…",
    );
    const fixture = await waitJSON("operations-screening.json");
    let affected;
    let prior;
    try {
      prior = JSON.parse(
        await fs.readFile(path.join(out, "account-booked.json"), "utf8"),
      );
    } catch {}
    if (
      prior?.run_id === fixture.run_id &&
      prior.screening_id === fixture.screening_id
    ) {
      affected = await api(`/ui/bookings/${prior.booking_id}`);
      report.api_fixtures.push({
        kind: "reused_compensation_booking",
        booking_id: affected.id,
        run_id: fixture.run_id,
      });
    } else affected = await purchaseFixture(fixture.screening_id, 1, 1);
    assert.equal(affected.net_ticket_minor, 6500);
    await fs.writeFile(
      path.join(out, "account-booked.json"),
      JSON.stringify({
        run_id: fixture.run_id,
        screening_id: fixture.screening_id,
        booking_id: affected.id,
      }),
    );
    console.log(
      `Customer fixture purchased; waiting for operations cancellation of ${fixture.screening_id}`,
    );
    const cancelled = await waitJSON(
      "operations-cancelled.json",
      900000,
      fixture.run_id,
    );
    assert.equal(cancelled.screening_id, fixture.screening_id);
    await check(
      "Cancelled order displays refund and compensation coupon independently",
      async () => {
        await page.goto(`${base}/#/account?tab=orders&booking=${affected.id}`);
        const card = page.locator(`[data-booking="${affected.id}"]`);
        await card.getByRole("table").waitFor();
        assert.match(await card.innerText(), /Cinema cancelled/i);
        assert.match(await card.innerText(), /Refund pending/i);
        assert.match(await card.innerText(), /Compensation coupon/);
        assert.match(await card.innerText(), /Available/i);
        assert.equal(
          await card.getByRole("link", { name: "Reschedule party" }).count(),
          0,
        );
        await screenshot("account-cancellation-pending.png");
      },
    );
    await fs.writeFile(
      path.join(out, "account-cancelled-checked.json"),
      JSON.stringify({ run_id: fixture.run_id }),
    );
    const refunded = await waitJSON(
      "operations-refunded.json",
      900000,
      fixture.run_id,
    );
    assert.equal(refunded.status, "SUCCEEDED");
    await check(
      "Refund list, coupon source link and notice read persistence",
      async () => {
        await section("refunds");
        assert.match(
          await page.locator("#account-content").innerText(),
          /Returned to wallet/i,
        );
        await section("coupons");
        await page
          .getByRole("heading", { name: "50% off your tickets" })
          .first()
          .waitFor();
        assert.ok(
          await page.getByRole("link", { name: "Source booking" }).count(),
        );
        await section("notices");
        const readButton = page
          .getByRole("button", { name: "Mark as read" })
          .first();
        await readButton.waitFor();
        await readButton.click();
        await page
          .getByText("Notice marked as read", { exact: true })
          .waitFor();
        await page.reload();
        await page.locator("#account-content [data-notice]").first().waitFor();
        assert.equal(
          await page
            .locator("#account-content [data-notice] [data-notice-state]")
            .first()
            .textContent(),
          "Read",
        );
      },
    );
  }

  await check(
    "Mobile account cards and ledger have no document overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await section("orders");
      const card = page.locator(`[data-booking="${booking.id}"]`);
      await card
        .getByText("Seats, fees & compensation", { exact: true })
        .click();
      await card.getByRole("table").waitFor();
      await overflowCheck();
      await screenshot("account-mobile-390.png");
      await section("wallet");
      await page.getByRole("table").waitFor();
      await overflowCheck();
      await page
        .getByText("Swipe across the table to see amounts and balances.", {
          exact: true,
        })
        .waitFor();
      const walletRegion = page.getByRole("region", {
        name: "Wallet transactions",
      });
      await walletRegion.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Wallet transactions"]')
            .scrollLeft > 0,
      );
      await page.waitForTimeout(300); // Let the native keyboard-scroll animation finish.
      await walletRegion.evaluate((element) => {
        element.scrollTo({ left: 0, behavior: "instant" });
        element.blur();
      });
      await screenshot("account-wallet-mobile-390.png");
    },
  );
  await check(
    "Navigation during a pending account read does not replace the destination",
    async () => {
      await page.route("**/api/ui/bookings?**", async (route) => {
        await sleep(700);
        try {
          await route.continue();
        } catch {}
      });
      await page.goto(base + "/#/account?tab=orders");
      await page
        .getByRole("heading", { name: "Your cinema journal" })
        .waitFor();
      await page.getByRole("link", { name: "Cinemas", exact: true }).click();
      await page
        .getByRole("heading", { name: "A big screen, near you." })
        .waitFor();
      await sleep(1000);
      assert.equal(
        await page
          .getByRole("heading", { name: "Your cinema journal" })
          .count(),
        0,
      );
      await page.unroute("**/api/ui/bookings?**");
    },
  );
  assert.deepEqual(
    report.page_errors,
    [],
    "No uncaught browser JavaScript errors expected",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = error.stack || String(error);
  await screenshot("account-failure.png").catch(() => {});
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    path.join(out, "account-results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
