import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_PACKAGE || "playwright",
);
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const backend = fileURLToPath(new URL("../..", import.meta.url));
const fixture = JSON.parse(
  await readFile(path.join(backend, "instance/browser-fixture.json"), "utf8"),
);
assert.equal(fixture.base_url, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]+$/);
const previous = JSON.parse(
  await readFile(
    path.join(backend, "docs/browser-operations/results.json"),
    "utf8",
  ),
);
assert.equal(previous.status, "passed");
assert.equal(previous.schema, fixture.schema);
const out = path.join(backend, "docs/browser-operations");
let prior;
try {
  prior = JSON.parse(
    await readFile(path.join(out, "counter-results.json"), "utf8"),
  );
} catch {}
const reuse =
  prior?.schema === fixture.schema ? prior.created?.screening : null;
const result = {
  status: "running",
  base_url: fixture.base_url,
  schema: fixture.schema,
  started_at: new Date().toISOString(),
  steps: [],
  errors: [],
  created: {},
  screenshots: [],
};
const browser = await chromium.launch({ headless: true });
const staffContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "Asia/Shanghai",
});
const customerContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "Asia/Shanghai",
});
const staff = await staffContext.newPage(),
  customer = await customerContext.newPage();
for (const page of [staff, customer]) {
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") result.errors.push(message.text());
  });
}
async function step(name, action) {
  const started = Date.now();
  await action();
  result.steps.push({
    name,
    status: "passed",
    duration_ms: Date.now() - started,
  });
  console.log("PASS", name);
  await save();
}
async function save() {
  await writeFile(
    path.join(out, "counter-results.json"),
    JSON.stringify(result, null, 2),
  );
}
async function screenshot(page, name) {
  const filename = name + ".png";
  await page.screenshot({ path: path.join(out, filename), fullPage: true });
  result.screenshots.push(filename);
}
async function response(page, method, url, click) {
  const pending = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api" + url &&
      r.request().method() === method,
  );
  await click();
  const r = await pending;
  const json = await r.json();
  assert.ok(r.ok(), JSON.stringify(json));
  return json.data;
}
async function staffLogin(email) {
  if (
    await staff.getByRole("button", { name: "Sign out", exact: true }).count()
  ) {
    await staff.getByRole("button", { name: "Sign out", exact: true }).click();
    await staff.getByRole("link", { name: /Sign in/ }).waitFor();
  }
  await staff.goto(
    fixture.base_url + "/#/login?next=" + encodeURIComponent("#/operations"),
  );
  await staff.getByLabel("Email address", { exact: true }).fill(email);
  await staff.getByLabel("Password", { exact: true }).fill(fixture.password);
  await staff.getByRole("button", { name: "Sign in", exact: true }).click();
  await staff
    .getByRole("navigation", { name: "Operations navigation" })
    .waitFor();
}
try {
  if (
    !(
      prior?.schema === fixture.schema &&
      prior.status === "failed" &&
      prior.created?.booking
    )
  ) {
    await step(
      reuse
        ? "Reuse the screening already published through manager UI"
        : "Publish a separate screening through manager UI",
      async () => {
        if (reuse) {
          result.created.screening = reuse;
        } else {
          await staffLogin("manager1@cinema.test");
          await staff
            .getByRole("button", { name: "＋ Publish screening", exact: true })
            .click();
          const d = staff.getByRole("dialog");
          await d
            .getByLabel("Film", { exact: true })
            .selectOption(previous.created.film);
          await d
            .getByLabel("Auditorium / layout version", { exact: true })
            .selectOption(previous.created.layout);
          const date = new Date(Date.now() + 8 * 3600000 + 9 * 86400000)
            .toISOString()
            .slice(0, 10);
          await d
            .getByLabel("Starts at (Beijing time)", { exact: true })
            .fill(date + "T19:30");
          await d
            .getByLabel("Standard fare (CNY)", { exact: true })
            .fill("65.00");
          await d
            .getByLabel("Student fare (CNY)", { exact: true })
            .fill("40.00");
          const screening = await response(
            staff,
            "POST",
            "/staff/screenings",
            () =>
              d
                .getByRole("button", { name: "Publish screening", exact: true })
                .click(),
          );
          result.created.screening = screening.id;
        }
        await staffLogin("staff1@cinema.test");
        await staff
          .getByRole("navigation", { name: "Operations navigation" })
          .getByRole("button", { name: "Counter sales", exact: true })
          .click();
        await staff
          .getByRole("heading", {
            name: "1 · Receive reservation approval",
            exact: true,
          })
          .waitFor();
      },
    );
    await step("Register a new isolated customer in the browser", async () => {
      await customer.goto(
        fixture.base_url +
          "/#/register?next=" +
          encodeURIComponent(`#/seats/${result.created.screening}`),
      );
      await customer
        .getByLabel("Your name", { exact: true })
        .fill("Counter QA Customer");
      result.created.email = `counter-${Date.now().toString(36)}@cinema.test`;
      await customer
        .getByLabel("Email address", { exact: true })
        .fill(result.created.email);
      await customer.getByLabel(/^Password/).fill(fixture.password);
      await customer
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await customer
        .getByRole("heading", { name: "Choose your seats.", exact: true })
        .waitFor();
      await writeFile(
        path.join(out, "counter-customer-initial.aria.txt"),
        await customer.locator("body").ariaSnapshot(),
      );
    });
    let holdBundle, paymentBundle;
    await step(
      "Customer approves a precise seat selection for one staff member",
      async () => {
        await customer
          .getByRole("button", {
            name: /^Row [0-9]+ · Seat [0-9]+, available,/,
          })
          .first()
          .click();
        await customer
          .getByText("Booking at a cinema counter?", { exact: true })
          .click();
        await customer
          .getByLabel("Staff ID provided at the counter", { exact: true })
          .fill(fixture.ids.accounts["staff1@cinema.test"]);
        await response(customer, "POST", "/counter-hold-consents", () =>
          customer
            .getByRole("button", { name: "Approve seat hold", exact: true })
            .click(),
        );
        holdBundle = await customer
          .getByLabel("Seat-hold approval", { exact: true })
          .inputValue();
        assert.ok(JSON.parse(holdBundle).request_key);
        await screenshot(customer, "counter-customer-hold-approval");
      },
    );
    await step("Staff reserves only the customer-approved seats", async () => {
      await staff
        .getByLabel("Reservation approval", { exact: true })
        .fill(holdBundle);
      const hold = await response(staff, "POST", "/holds", () =>
        staff
          .getByRole("button", { name: "Verify & reserve seats", exact: true })
          .click(),
      );
      result.created.hold = hold.hold_id;
      await staff.getByText("Seats reserved", { exact: true }).waitFor();
      const balance = (
        await (
          await customer.request.get(fixture.base_url + "/api/me/wallet")
        ).json()
      ).data.balance_minor;
      assert.equal(balance, 100000);
    });
    await step(
      "Customer resumes that hold and approves the actual quote",
      async () => {
        await customer.goto(fixture.base_url + "/#/account?tab=holds");
        await customer
          .getByRole("link", { name: "Continue to payment →", exact: true })
          .click();
        await customer
          .getByRole("heading", {
            name: "Your seats are on hold.",
            exact: true,
          })
          .waitFor();
        const quote = await response(
          customer,
          "POST",
          `/holds/${result.created.hold}/quote`,
          () =>
            customer
              .getByRole("button", { name: "Review final price", exact: true })
              .click(),
        );
        assert.equal(quote.amount_due_minor, 6500);
        await customer
          .getByText("Let counter staff complete this purchase", {
            exact: true,
          })
          .click();
        await customer
          .getByLabel("Staff ID", { exact: true })
          .fill(fixture.ids.accounts["staff1@cinema.test"]);
        await response(
          customer,
          "POST",
          `/holds/${result.created.hold}/counter-consent`,
          () =>
            customer
              .getByRole("button", {
                name: "Approve payment at counter",
                exact: true,
              })
              .click(),
        );
        paymentBundle = await customer
          .getByLabel("Payment approval", { exact: true })
          .inputValue();
        assert.ok(JSON.parse(paymentBundle).quote_token);
        await screenshot(customer, "counter-customer-payment-approval");
      },
    );
    await step(
      "Staff reviews trusted current price before completing payment",
      async () => {
        await staff
          .getByLabel("Payment approval", { exact: true })
          .fill(paymentBundle);
        const quote = await response(staff, "POST", "/counter/preview", () =>
          staff
            .getByRole("button", { name: "Review quote", exact: true })
            .click(),
        );
        assert.equal(quote.amount_due_minor, 6500);
        assert.equal(quote.tickets.length, 1);
        await staff
          .getByRole("dialog")
          .getByRole("heading", { name: "Review counter sale", exact: true })
          .waitFor();
        await screenshot(staff, "counter-staff-quote-preview");
        const receipt = await response(staff, "POST", "/bookings", () =>
          staff
            .getByRole("dialog")
            .getByRole("button", { name: "Confirm counter sale", exact: true })
            .click(),
        );
        assert.equal(receipt.amount_due_minor, 6500);
        assert.equal(receipt.balance_minor, 93500);
        result.created.booking = receipt.booking_id;
        await staff
          .getByRole("button", { name: "View booking", exact: true })
          .click();
        await staff
          .getByRole("dialog")
          .getByRole("heading", { name: "Booking details", exact: true })
          .waitFor();
        assert.match(await staff.getByRole("dialog").innerText(), /Counter/);
        await screenshot(staff, "counter-staff-receipt");
      },
    );
  } else {
    result.created = { ...prior.created };
    result.steps = [...prior.steps];
    result.screenshots = [...prior.screenshots];
    result.resumed_after_selector_fix = true;
    await customer.goto(fixture.base_url + "/#/login");
    await customer
      .getByLabel("Email address", { exact: true })
      .fill(result.created.email);
    await customer.getByLabel(/^Password/).fill(fixture.password);
    await customer
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await customer
      .getByRole("button", { name: "Sign out", exact: true })
      .waitFor();
  }
  await step(
    "Customer sees issued counter ticket and exact wallet debit",
    async () => {
      await customer.goto(
        fixture.base_url +
          `/#/account?tab=orders&booking=${result.created.booking}`,
      );
      await customer
        .getByRole("heading", { name: "Your cinema journal", exact: true })
        .waitFor();
      await customer
        .getByText("Booking ID: " + result.created.booking, { exact: true })
        .waitFor();
      assert.match(
        await customer.locator("main").innerText(),
        /Counter purchase/i,
      );
      const wallet = (
        await (
          await customer.request.get(fixture.base_url + "/api/me/wallet")
        ).json()
      ).data;
      assert.equal(wallet.balance_minor, 93500);
      const b = (
        await (
          await customer.request.get(
            fixture.base_url + "/api/bookings/" + result.created.booking,
          )
        ).json()
      ).data;
      assert.equal(b.channel, "COUNTER");
      assert.equal(b.creator_id, fixture.ids.accounts["staff1@cinema.test"]);
      assert.equal(b.tickets.length, 1);
      assert.equal(b.net_ticket_minor, 6500);
      await screenshot(customer, "counter-customer-ticket");
    },
  );
  assert.deepEqual(result.errors, []);
  result.status = "passed";
  result.finished_at = new Date().toISOString();
} catch (error) {
  result.status = "failed";
  result.failure = { message: error.message, stack: error.stack };
  console.error(error);
  await screenshot(staff, "counter-staff-failure").catch(() => {});
  await screenshot(customer, "counter-customer-failure").catch(() => {});
  await writeFile(
    path.join(out, "counter-customer-failure.aria.txt"),
    await customer.locator("body").ariaSnapshot(),
  ).catch(() => {});
  process.exitCode = 1;
} finally {
  await save();
  await browser.close();
}
