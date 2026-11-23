// Run with scripts/browser_fixture.py. Its SMTP transport points only to this test mailbox.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openMailbox } from "./mailbox.mjs";
import { chromium } from "playwright";

const fixture = JSON.parse(await readFile("instance/browser-fixture.json", "utf8"));
assert.equal(fixture.base_url, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]{16}$/);
assert.equal(fixture.status, "running");
const inbox = await openMailbox();
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  const staff = await browser.newPage();
  const customer = await browser.newPage();
  const errors = [];
  for (const page of [staff, customer]) page.on("pageerror", e => errors.push(e.message));
  const email = `counter-${Date.now()}@cinema.test`;
  await customer.goto(fixture.base_url + "/#/register?next=%23%2Faccount");
  await customer.locator("[name=display_name]").fill("Counter customer");
  await customer.locator("[name=email]").fill(email);
  await customer.locator("[name=password]").fill(fixture.password);
  const requested = customer.waitForResponse(r => r.url().endsWith("/api/auth/register/code"));
  await customer.locator("[data-registration-code]").click();
  assert.equal((await requested).status(), 201);
  const registration = inbox.mail.shift();
  assert.ok(registration.recipient.includes(email));
  await customer.locator("[name=code]").fill(registration.body.match(/Code: (\d{6})/)[1]);
  await customer.locator("#auth-form button[type=submit]").click();
  await customer.locator("#logout").waitFor();
  const wallet = () => customer.evaluate(async () => (await (await fetch("/api/me/wallet")).json()).data.balance_minor);
  const initial = await wallet();

  for (const name of ["manager1", "staff1"]) {
    await staff.goto(fixture.base_url + "/#/login");
    await staff.locator("[name=email]").fill(name + "@cinema.test");
    await staff.locator("[name=password]").fill(fixture.password);
    await staff.locator("#auth-form button[type=submit]").click();
    await staff.locator("[data-operations-nav]").waitFor();
    assert.deepEqual(await staff.locator(".main-nav a").evaluateAll(links => links.map(el => el.hash)), ["#/operations"]);
    await staff.goto(fixture.base_url + "/#/reviews");
    await staff.locator("[data-operations-nav]").waitFor();
    assert.match(staff.url(), /#\/operations/);
    if (name === "manager1") {
      await staff.locator("#logout").click();
      await staff.locator("[data-sign-in-label]").waitFor();
    }
  }
  await staff.locator('[data-tab="counter"]').click();
  await staff.locator('[name="screening"]').selectOption({ index: 1 });
  await staff.locator("[data-seat]:enabled").first().click();
  await staff.locator("[data-fare]").selectOption("STUDENT");
  await staff.locator("[name=email]").fill(email);
  const sending = staff.waitForResponse(r => r.url().endsWith("/api/counter/codes"));
  await staff.locator("[data-sale] button[type=submit]").click();
  const response = await sending;
  assert.equal(response.status(), 201, await response.text());
  const quote = (await response.json()).data;
  const message = inbox.mail.find(m => m.recipient.includes(email));
  assert.ok(message);
  const code = message.body.match(/Code: (\d{6})/)[1];
  assert.ok(message.body.includes((quote.amount_due_minor / 100).toFixed(2)));
  assert.equal(await wallet(), initial);
  await staff.reload();
  await staff.locator("[name=code]").fill(code);
  await staff.locator("[data-confirm] button[type=submit]").click();
  await staff.getByText(/Tickets issued/).waitFor();
  assert.equal(await wallet(), initial - quote.amount_due_minor);
  await staff.locator("[data-booking]").click();
  await staff.getByRole("dialog").waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS branch landing, customer mailbox, refresh, counter ticket and wallet debit");
} finally {
  await browser?.close();
  inbox.close();
}
