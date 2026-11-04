/** Actual browser regression for hold/route/quote identity boundaries.
 * Uses one uniquely registered account and one unpaid hold in the isolated :5002
 * schema. Registration, hold creation and cleanup are explicit API fixtures.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const backend = fileURLToPath(new URL("../..", import.meta.url));
const fixture = JSON.parse(
  await fs.readFile(
    path.join(backend, "instance/browser-fixture.json"),
    "utf8",
  ),
);
const base = fixture.base_url;
assert.equal(base, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]{16}$/);
const password = process.env.CINEMA_QA_PASSWORD;
assert.ok(
  password,
  "Set CINEMA_QA_PASSWORD for the isolated test registration.",
);
const email = `hold-boundary-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@cinema.test`;
const out = path.join(backend, "docs/browser-hold-boundary");
await fs.mkdir(out, { recursive: true });
const report = {
  run_at: new Date().toISOString(),
  base,
  schema: fixture.schema,
  user: email,
  checks: [],
  page_errors: [],
  api_fixtures: [],
  screenshots: [],
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1380, height: 960 },
  locale: "en-GB",
  timezoneId: "Asia/Shanghai",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => report.page_errors.push(error.message));
const pageRequests = [];
page.on("request", (request) =>
  pageRequests.push({
    method: request.method(),
    pathname: new URL(request.url()).pathname,
  }),
);
let csrf, hold, user, screeningA, screeningB;

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
async function check(name, task) {
  await task();
  report.checks.push({ name, status: "passed" });
  console.log("PASS " + name);
}
async function screenshot(name) {
  const destination = path.join(out, name + ".png");
  await page.screenshot({ path: destination, fullPage: true });
  report.screenshots.push(path.basename(destination));
}

try {
  csrf = (await api("/auth/csrf")).csrf_token;
  await api(
    "/auth/register",
    "POST",
    { email, password, display_name: "Hold Boundary QA" },
    crypto.randomUUID(),
  );
  const login = await api("/auth/login", "POST", { email, password });
  csrf = login.csrf_token;
  user = login.user;
  report.api_fixtures.push({
    kind: "registered_unique_customer",
    user_id: user.id,
  });
  const bootstrap = await api("/ui/bootstrap");
  const screenings = [];
  for (const date of bootstrap.available_dates) {
    const result = await api(
      "/screenings?" + new URLSearchParams({ date, page_size: "100" }),
    );
    screenings.push(...result.items);
  }
  for (const candidate of screenings) {
    const sibling = screenings.find(
      (other) =>
        other.id !== candidate.id &&
        other.layout_id === candidate.layout_id &&
        other.film_id === candidate.film_id,
    );
    if (sibling) {
      screeningA = candidate;
      screeningB = sibling;
      break;
    }
  }
  assert.ok(
    screeningA && screeningB,
    "Need two future screenings sharing one film/layout.",
  );
  const map = await api(`/screenings/${screeningA.id}/seats`);
  const seat = map.seats.find(
    (item) => item.state === "AVAILABLE" && item.row_no >= 7,
  );
  assert.ok(seat, "Need an available fixture seat.");
  hold = await api(
    "/holds",
    "POST",
    { screening_id: screeningA.id, seat_ids: [seat.id] },
    crypto.randomUUID(),
  );
  report.api_fixtures.push({
    kind: "unpaid_hold",
    hold_id: hold.hold_id,
    screening_id: screeningA.id,
    other_screening_id: screeningB.id,
  });

  await check(
    "An owned hold cannot be presented as a different screening",
    async () => {
      await page.goto(
        `${base}/#/seats/${screeningB.id}?hold_id=${hold.hold_id}`,
      );
      await page
        .getByText(
          "This seat hold belongs to a different screening. Open the hold from My tickets to continue.",
          { exact: true },
        )
        .waitFor();
      assert.equal(await page.locator("#quote-form").count(), 0);
      assert.equal(await page.locator("#pay-now").count(), 0);
      await screenshot("wrong-screening-rejected");
    },
  );

  await check(
    "A plain purchase hold ignores an injected reschedule source in its URL",
    async () => {
      const requestStart = pageRequests.length;
      await page.goto(
        `${base}/#/seats/${screeningA.id}?hold_id=${hold.hold_id}&source_booking_id=1`,
      );
      await page.locator("#quote-form").waitFor();
      assert.equal(
        pageRequests
          .slice(requestStart)
          .filter((item) => item.pathname === "/api/ui/bookings/1").length,
        0,
      );
      assert.equal(
        await page
          .getByText("RESCHEDULE YOUR WHOLE BOOKING", { exact: true })
          .count(),
        0,
      );
      assert.ok(await page.locator("[data-fare]").isEnabled());
      await page
        .getByRole("button", { name: "Review final price", exact: true })
        .click();
      await page.locator("#pay-now").waitFor();
      assert.match(await page.locator("#pay-now").innerText(), /& book/);
      const draft = await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)),
        `falcons.checkout.${user.id}.${screeningA.id}`,
      );
      assert.equal(draft.quote.source_booking_id, null);
      assert.equal(draft.quote.screening_id, screeningA.id);
      await screenshot("plain-purchase-context-retained");
    },
  );

  await check(
    "Cached quotes with a mismatched hold, screening, owner or source are blocked",
    async () => {
      const draftKey = `falcons.checkout.${user.id}.${screeningA.id}`;
      const saved = await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key)),
        draftKey,
      );
      for (const [field, value] of [
        ["hold_id", "1"],
        ["screening_id", screeningB.id],
        ["owner_id", "1"],
        ["source_booking_id", "1"],
      ]) {
        const modified = structuredClone(saved);
        modified.quote[field] = value;
        await page.evaluate(
          ({ key, draft }) =>
            sessionStorage.setItem(key, JSON.stringify(draft)),
          { key: draftKey, draft: modified },
        );
        await page.reload();
        await page
          .getByText(
            "This quote does not match the displayed screening and booking. Open your seat hold from My tickets.",
            { exact: true },
          )
          .waitFor();
        assert.equal(await page.locator("#pay-now").count(), 0, field);
        assert.equal(await page.locator("#quote-form").count(), 0, field);
      }
      await screenshot("cached-quote-mismatch-rejected");
      await page.evaluate((key) => sessionStorage.removeItem(key), draftKey);
    },
  );

  assert.equal(
    pageRequests.filter(
      (item) => item.method === "POST" && item.pathname === "/api/bookings",
    ).length,
    0,
  );
  assert.equal((await api("/ui/bookings")).total, 0);
  assert.equal((await api("/me/wallet")).balance_minor, 100000);
  assert.deepEqual(report.page_errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await screenshot("failure").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  if (hold) {
    try {
      await api(`/holds/${hold.hold_id}`, "DELETE");
      report.api_fixtures.push({
        kind: "hold_released",
        hold_id: hold.hold_id,
      });
    } catch (error) {
      report.cleanup_error = error.message;
      process.exitCode = 1;
    }
  }
  await fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
