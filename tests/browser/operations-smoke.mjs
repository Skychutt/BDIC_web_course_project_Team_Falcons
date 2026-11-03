import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE || "playwright",
);
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// This test deliberately accepts only the isolated browser fixture, never the demo service.
const backend = fileURLToPath(new URL("../..", import.meta.url));
const fixture = JSON.parse(
  await readFile(path.join(backend, "instance/browser-fixture.json"), "utf8"),
);
assert.equal(fixture.base_url, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]+$/);
await readFile(path.join(backend, "cinema/static/js/seats.js")); // App module must be complete.
const out = path.join(backend, "docs/browser-operations");
await mkdir(out, { recursive: true });
const gates = path.join(backend, "tests/browser/results");
await mkdir(gates, { recursive: true });
const suffix = Date.now().toString(36);
const labels = {
  district: `QA District ${suffix}`,
  cinema: `QA Cinema ${suffix}`,
  film: `QA Film ${suffix}`,
  genre: `QA Genre ${suffix}`,
  screen: `QA Auditorium ${suffix}`,
  staff: `QA Staff ${suffix}`,
  replacement: `QA Deputy ${suffix}`,
};
const result = {
  base_url: fixture.base_url,
  schema: fixture.schema,
  started_at: new Date().toISOString(),
  steps: [],
  errors: [],
  created: {},
  screenshots: [],
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "en-GB",
  timezoneId: "Asia/Shanghai",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => result.errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") result.errors.push(message.text());
});
const dialog = () => page.getByRole("dialog");
async function gate(name) {
  console.log("WAIT", name);
  const until = Date.now() + 300000;
  while (Date.now() < until) {
    try {
      const value = JSON.parse(await readFile(path.join(gates, name), "utf8"));
      if (value.run_id === suffix) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for " + name);
}
async function signal(name, value) {
  await writeFile(
    path.join(gates, name),
    JSON.stringify({ run_id: suffix, ...value }, null, 2),
  );
  console.log("SIGNAL", name);
}
async function step(name, work) {
  const started = Date.now();
  await work();
  result.steps.push({
    name,
    status: "passed",
    duration_ms: Date.now() - started,
  });
  console.log("PASS", name);
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(result, null, 2),
  );
}
async function snapshot(name) {
  await writeFile(
    path.join(out, `${name}.aria.txt`),
    await page.locator("body").ariaSnapshot(),
  );
}
async function shot(name) {
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(out, filename), fullPage: true });
  result.screenshots.push(filename);
}
async function writeResponse(method, pathname, click) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api${pathname}` &&
      response.request().method() === method,
  );
  await click();
  const response = await pending;
  const json = await response.json();
  assert.ok(response.ok(), JSON.stringify(json));
  return json.data;
}
async function login(email) {
  if (
    await page.getByRole("button", { name: "Sign out", exact: true }).count()
  ) {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("link", { name: /Sign in/ }).waitFor();
  }
  await page.goto(
    fixture.base_url + "/#/login?next=" + encodeURIComponent("#/operations"),
  );
  await page.getByRole("heading", { name: "Sign in to Falcons" }).waitFor();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Operations navigation" })
    .waitFor();
}
async function tab(name) {
  await page
    .getByRole("navigation", { name: "Operations navigation" })
    .getByRole("button", { name, exact: true })
    .click();
  await page.locator(".operations-body .panel").first().waitFor();
}
async function closeDialog() {
  await dialog().getByRole("button", { name: "Close dialog" }).click();
  await dialog().waitFor({ state: "hidden" });
}
const row = (text) => page.getByRole("row").filter({ hasText: text });
try {
  await step("Administrator login and rendered navigation", async () => {
    await login("admin@cinema.test");
    await page
      .getByRole("heading", { name: "Cinema locations", exact: true })
      .waitFor();
    await snapshot("admin-initial");
  });
  await step("Create and update a district", async () => {
    const existing = await page.locator(".operations-body").innerText();
    const districtCode = Array.from(
      { length: 20 },
      (_, i) => "1101" + String(80 + i),
    ).find((code) => !existing.includes(code));
    assert.ok(districtCode);
    await page
      .getByRole("button", { name: "＋ Add district", exact: true })
      .click();
    await dialog()
      .getByLabel("District name", { exact: true })
      .fill(labels.district);
    await dialog()
      .getByLabel("Six-digit administrative code", { exact: true })
      .fill(districtCode);
    const d = await writeResponse("POST", "/admin/districts", () =>
      dialog()
        .getByRole("button", { name: "Save district", exact: true })
        .click(),
    );
    result.created.district = d.district_id;
    await row(labels.district)
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await dialog()
      .getByLabel("District name", { exact: true })
      .fill(labels.district + " Updated");
    await writeResponse("PUT", `/admin/districts/${d.district_id}`, () =>
      dialog()
        .getByRole("button", { name: "Save district", exact: true })
        .click(),
    );
    labels.district += " Updated";
    await row(labels.district).waitFor();
  });
  await step("Create and update a cinema", async () => {
    await page
      .getByRole("button", { name: "＋ Add cinema", exact: true })
      .click();
    await dialog()
      .getByLabel("Cinema name", { exact: true })
      .fill(labels.cinema);
    await dialog().getByLabel("Brand", { exact: true }).fill("Falcons QA");
    await dialog()
      .getByLabel("District", { exact: true })
      .selectOption({ label: labels.district });
    await dialog()
      .getByLabel("Street address", { exact: true })
      .fill("Isolated QA campus, Beijing");
    const c = await writeResponse("POST", "/admin/cinemas", () =>
      dialog()
        .getByRole("button", { name: "Save cinema", exact: true })
        .click(),
    );
    result.created.cinema = c.id;
    await row(labels.cinema)
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await dialog()
      .getByLabel("Street address", { exact: true })
      .fill("Updated QA campus address, Beijing");
    await dialog()
      .getByText("Map coordinates (optional)", { exact: true })
      .click();
    await dialog().getByLabel("Latitude", { exact: true }).fill("39.9");
    await dialog().getByLabel("Longitude", { exact: true }).fill("116.4");
    await writeResponse("PUT", `/admin/cinemas/${c.id}`, () =>
      dialog()
        .getByRole("button", { name: "Save cinema", exact: true })
        .click(),
    );
    await row(labels.cinema)
      .getByText("Updated QA campus address, Beijing", { exact: true })
      .waitFor();
  });
  await step(
    "Create employees and activate cinema with a manager",
    async () => {
      await tab("Staff & managers");
      await page
        .getByRole("heading", { name: "Staff & managers", exact: true })
        .waitFor();
      for (const [key, name] of [
        ["staff", labels.staff],
        ["replacement", labels.replacement],
      ]) {
        await page
          .getByRole("button", { name: "＋ Create staff", exact: true })
          .click();
        await dialog().getByLabel("Name", { exact: true }).fill(name);
        await dialog()
          .getByLabel("Email", { exact: true })
          .fill(`${key}-${suffix}@cinema.test`);
        await dialog()
          .getByLabel("Initial password", { exact: true })
          .fill(fixture.password);
        await dialog()
          .getByLabel("Assigned cinema", { exact: true })
          .selectOption({ label: labels.cinema });
        const person = await writeResponse("POST", "/admin/staff", () =>
          dialog()
            .getByRole("button", { name: "Create staff", exact: true })
            .click(),
        );
        result.created[key] = person.id;
        await row(name).waitFor();
      }
      await tab("Cinemas");
      await row(labels.cinema)
        .getByRole("button", { name: "Assign manager", exact: true })
        .click();
      await dialog()
        .getByLabel("Cinema employee", { exact: true })
        .selectOption(result.created.staff);
      await writeResponse(
        "PUT",
        `/admin/cinemas/${result.created.cinema}/manager`,
        () =>
          dialog()
            .getByRole("button", { name: "Confirm manager", exact: true })
            .click(),
      );
      await row(labels.cinema).getByText("Active", { exact: true }).waitFor();
    },
  );
  await step("Transfer a manager with original-cinema handover", async () => {
    await tab("Staff & managers");
    await row(labels.staff)
      .getByRole("button", { name: "Transfer", exact: true })
      .click();
    const destinations = await dialog()
      .getByLabel("Destination cinema", { exact: true })
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => ({ value: o.value, text: o.textContent })),
      );
    assert.ok(destinations.length > 0);
    await dialog()
      .getByLabel("Destination cinema", { exact: true })
      .selectOption(destinations[0].value);
    await dialog()
      .getByLabel("Replacement manager at original cinema", { exact: true })
      .selectOption(result.created.replacement);
    await writeResponse(
      "PUT",
      `/admin/staff/${result.created.staff}/cinema`,
      () =>
        dialog()
          .getByRole("button", { name: "Confirm transfer", exact: true })
          .click(),
    );
    await row(labels.staff)
      .getByText(destinations[0].text, { exact: true })
      .waitFor();
    await tab("Cinemas");
    await row(labels.cinema)
      .getByText(labels.replacement, { exact: true })
      .waitFor();
  });
  await step("Create and update genre and film", async () => {
    await tab("Films & genres");
    await page
      .getByRole("button", { name: "＋ Add genre", exact: true })
      .click();
    await dialog().getByLabel("Genre name", { exact: true }).fill(labels.genre);
    const genre = await writeResponse("POST", "/admin/genres", () =>
      dialog().getByRole("button", { name: "Save genre", exact: true }).click(),
    );
    result.created.genre = genre.genre_id;
    await row(labels.genre)
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await dialog()
      .getByLabel("Genre name", { exact: true })
      .fill(labels.genre + " Updated");
    await writeResponse("PUT", `/admin/genres/${genre.genre_id}`, () =>
      dialog().getByRole("button", { name: "Save genre", exact: true }).click(),
    );
    labels.genre += " Updated";
    await page
      .getByRole("button", { name: "＋ Add film", exact: true })
      .click();
    await dialog().getByLabel("Film title", { exact: true }).fill(labels.film);
    await dialog().getByLabel("Runtime (minutes)", { exact: true }).fill("95");
    await dialog()
      .getByLabel("Synopsis", { exact: true })
      .fill(
        "A browser-test film, created only inside the isolated QA database.",
      );
    await dialog().getByLabel(labels.genre, { exact: true }).check();
    const film = await writeResponse("POST", "/admin/films", () =>
      dialog().getByRole("button", { name: "Save film", exact: true }).click(),
    );
    result.created.film = film.id;
    await row(labels.film)
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await dialog().getByLabel("Runtime (minutes)", { exact: true }).fill("100");
    await writeResponse("PUT", `/admin/films/${film.id}`, () =>
      dialog().getByRole("button", { name: "Save film", exact: true }).click(),
    );
    await row(labels.film).getByText("100 min", { exact: true }).waitFor();
    await shot("admin-catalogue");
  });
  await step("Administrator selects a cinema for turnover", async () => {
    await tab("Turnover");
    await page
      .getByLabel("Cinema", { exact: true })
      .selectOption(result.created.cinema);
    await page
      .getByRole("button", { name: "View turnover", exact: true })
      .click();
    await page.locator("[data-turnover-result] .metric").first().waitFor();
    assert.equal(
      await page.locator("[data-turnover-result] .metric").count(),
      6,
    );
    await shot("admin-turnover");
  });
  await step(
    "Manager creates auditorium and directional aisle layout",
    async () => {
      await login("manager1@cinema.test");
      await tab("Auditoriums & seats");
      await page
        .getByRole("button", { name: "＋ Add auditorium", exact: true })
        .click();
      await dialog()
        .getByLabel("Auditorium name", { exact: true })
        .fill(labels.screen);
      await dialog()
        .getByLabel("Screen type", { exact: true })
        .selectOption("STANDARD");
      const screen = await writeResponse("POST", "/staff/screens", () =>
        dialog()
          .getByRole("button", { name: "Add auditorium", exact: true })
          .click(),
      );
      result.created.screen = screen.screen_id;
      await row(labels.screen)
        .getByRole("button", { name: "Create layout version", exact: true })
        .click();
      await dialog().getByLabel("Number of rows", { exact: true }).fill("4");
      await dialog()
        .getByLabel("Seats per aisle segment", { exact: true })
        .fill("2,2");
      await dialog()
        .getByLabel("Screen position", { exact: true })
        .selectOption("LEFT");
      await shot("manager-layout-preview");
      const layout = await writeResponse(
        "POST",
        `/staff/screens/${screen.screen_id}/layouts`,
        () =>
          dialog()
            .getByRole("button", { name: "Save new version", exact: true })
            .click(),
      );
      result.created.layout = layout.layout_id;
      assert.equal(layout.seat_count, 16);
      await row(labels.screen)
        .getByRole("button", { name: "v1 · 4 rows", exact: true })
        .waitFor();
    },
  );
  await step("Publish screening and update fares", async () => {
    await tab("Screenings & fares");
    await page
      .getByRole("button", { name: "＋ Publish screening", exact: true })
      .click();
    await dialog()
      .getByLabel("Film", { exact: true })
      .selectOption(result.created.film);
    await dialog()
      .getByLabel("Auditorium / layout version", { exact: true })
      .selectOption(result.created.layout);
    const date = new Date(Date.now() + 8 * 3600000 + 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    await dialog()
      .getByLabel("Starts at (Beijing time)", { exact: true })
      .fill(date + "T19:30");
    await dialog()
      .getByLabel("Standard fare (CNY)", { exact: true })
      .fill("60.00");
    await dialog()
      .getByLabel("Student fare (CNY)", { exact: true })
      .fill("40.00");
    const screening = await writeResponse("POST", "/staff/screenings", () =>
      dialog()
        .getByRole("button", { name: "Publish screening", exact: true })
        .click(),
    );
    result.created.screening = screening.id;
    result.created.screening_cinema = screening.cinema_id;
    await row(labels.film)
      .getByRole("button", { name: "Fares", exact: true })
      .click();
    await dialog()
      .getByLabel("Standard fare (CNY)", { exact: true })
      .fill("65.00");
    await writeResponse("PUT", `/staff/screenings/${screening.id}/fares`, () =>
      dialog().getByRole("button", { name: "Save fares", exact: true }).click(),
    );
    await row(labels.film).getByText("v2", { exact: true }).waitFor();
  });
  await step(
    "Coordinate customer booking on the isolated screening",
    async () => {
      await signal("operations-screening.json", {
        screening_id: result.created.screening,
        film_id: result.created.film,
        cinema_id: result.created.screening_cinema,
      });
      const booking = await gate("account-booked.json");
      result.created.booking = booking.booking_id;
    },
  );
  await step(
    "Preview and confirm cancellation of own QA screening",
    async () => {
      await row(labels.film)
        .getByRole("button", { name: "Cancel / replace", exact: true })
        .click();
      await dialog()
        .getByLabel("Reason shown to customers", { exact: true })
        .fill("Isolated browser test cancellation.");
      const preview = await writeResponse(
        "POST",
        `/staff/screenings/${result.created.screening}/cancellation-preview`,
        () =>
          dialog()
            .getByRole("button", { name: "Preview impact", exact: true })
            .click(),
      );
      assert.equal(preview.booking_count, 1);
      assert.equal(preview.refund_total_minor, 6500);
      await dialog()
        .getByRole("heading", { name: "Confirm cancellation", exact: true })
        .waitFor();
      await dialog().getByText(labels.film, { exact: true }).waitFor();
      await shot("manager-cancellation-preview");
      const cancelled = await writeResponse(
        "POST",
        `/staff/screenings/${result.created.screening}/cancel`,
        () =>
          dialog()
            .getByRole("button", {
              name: "Confirm cancellation & refunds",
              exact: true,
            })
            .click(),
      );
      assert.equal(cancelled.booking_count, 1);
      await row(labels.film).getByText("Cancelled", { exact: true }).waitFor();
      await signal("operations-cancelled.json", {
        booking_id: result.created.booking,
        screening_id: result.created.screening,
        refund_status: "PENDING",
      });
      await gate("account-cancelled-checked.json");
    },
  );
  await step(
    "Process the pending cancellation refund through staff UI",
    async () => {
      await tab("Refunds");
      const refundRow = row(labels.film);
      await refundRow
        .getByRole("button", { name: "Process refund", exact: true })
        .waitFor();
      const refundId = await refundRow
        .getByRole("button", { name: "Process refund", exact: true })
        .getAttribute("data-id");
      await refundRow
        .getByRole("button", { name: "Process refund", exact: true })
        .click();
      await dialog()
        .getByRole("heading", { name: "Confirm refund", exact: true })
        .waitFor();
      const refund = await writeResponse(
        "POST",
        `/staff/refunds/${refundId}/retry`,
        () =>
          dialog()
            .getByRole("button", { name: "Confirm refund", exact: true })
            .click(),
      );
      assert.equal(refund.status, "SUCCEEDED");
      await row(labels.film).getByText("Completed", { exact: true }).waitFor();
      await shot("manager-refund-completed");
      await signal("operations-refunded.json", {
        booking_id: result.created.booking,
        refund_id: refundId,
        status: "SUCCEEDED",
      });
    },
  );
  await step("Manager turnover and mobile layout", async () => {
    await tab("Turnover");
    await page
      .getByRole("button", { name: "View turnover", exact: true })
      .click();
    await page.locator("[data-turnover-result] .metric").first().waitFor();
    assert.equal(
      await page.locator("[data-turnover-result] .metric").count(),
      6,
    );
    await shot("manager-turnover");
    await context.setDefaultNavigationTimeout(15000);
    await page.setViewportSize({ width: 390, height: 844 });
    await tab("Auditoriums & seats");
    await row(labels.screen)
      .getByRole("button", { name: "Create layout version", exact: true })
      .click();
    await shot("mobile-layout-dialog");
    const dimensions = await dialog().boundingBox();
    assert.ok(dimensions.width <= 390);
    await closeDialog();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
  });
  await step("Ordinary staff cannot access turnover navigation", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login("staff1@cinema.test");
    assert.equal(
      await page
        .getByRole("navigation", { name: "Operations navigation" })
        .getByRole("button", { name: "Turnover", exact: true })
        .count(),
      0,
    );
    await tab("Branch bookings");
    await page
      .getByRole("heading", { name: "Branch bookings", exact: true })
      .waitFor();
    await tab("Refunds");
    await page.getByRole("heading", { name: "Refunds", exact: true }).waitFor();
    await tab("Counter sales");
    await page
      .getByRole("heading", {
        name: "1 · Receive reservation approval",
        exact: true,
      })
      .waitFor();
    await shot("staff-counter");
  });
  assert.deepEqual(result.errors, []);
  result.status = "passed";
  result.finished_at = new Date().toISOString();
} catch (error) {
  result.status = "failed";
  result.failure = { message: error.message, stack: error.stack };
  await snapshot("failure").catch(() => {});
  await shot("failure").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(result, null, 2),
  );
  await browser.close();
}
