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
  const screening = await staff.locator('[name="screening"]').inputValue();
  const available = staff.locator("[data-seat]:enabled");
  await available.first().waitFor();
  const [first, student, third] = await available.evaluateAll(seats => seats.slice(0, 3).map(s => s.dataset.seat));
  const counterSeat = id => staff.locator(`[data-seat="${id}"]`);
  const studentFare = staff.locator(`[data-fare="${student}"]`);
  await counterSeat(first).click();
  await counterSeat(student).click();
  await studentFare.selectOption("STUDENT");
  await staff.locator("[name=email]").fill(email);
  await customer.goto(`${fixture.base_url}/#/seats/${screening}?seat_ids=${first}`);
  await customer.locator("#create-hold").click();
  await customer.locator("#quote-form").waitFor();
  await staff.locator(`[data-seat="${first}"]:disabled`).waitFor({ timeout: 12000 });
  assert.equal(await counterSeat(first).getAttribute("aria-pressed"), "false");
  assert.equal(await counterSeat(student).getAttribute("aria-pressed"), "true");
  assert.equal(await studentFare.inputValue(), "STUDENT");
  assert.match(await staff.locator("[data-seat-update]").innerText(), /Row \d+ · Seat \d+/);
  assert.ok(await staff.locator("[name=email]").evaluate(el => el === document.activeElement));
  assert.equal(await staff.locator("[name=email]").inputValue(), email);

  // A second conflict occurs after the cashier clicks Send but before the server checks the seats.
  await counterSeat(third).click();
  await staff.route("**/api/counter/codes", async route => {
    await customer.goto(`${fixture.base_url}/#/seats/${screening}?seat_ids=${third}`);
    await customer.locator("#create-hold").click();
    await customer.locator("#quote-form").waitFor();
    await route.continue();
  }, { times: 1 });
  const conflict = staff.waitForResponse(r => r.url().endsWith("/api/counter/codes"));
  await staff.locator("[data-sale] button[type=submit]").click();
  assert.equal((await conflict).status(), 409);
  await staff.locator(`[data-seat="${third}"]:disabled[aria-pressed="false"]`).waitFor();
  assert.ok(await counterSeat(first).isEnabled());
  assert.equal(await staff.locator("[data-fare]").count(), 1);
  assert.equal(await studentFare.inputValue(), "STUDENT");
  const sending = staff.waitForResponse(r => r.url().endsWith("/api/counter/codes"));
  await staff.locator("[data-sale] button[type=submit]").click();
  const response = await sending;
  assert.equal(response.status(), 201, await response.text());
  assert.deepEqual(response.request().postDataJSON().tickets, [{ seat_id: student, fare_type: "STUDENT" }]);
  const quote = (await response.json()).data;
  const message = inbox.mail.find(m => m.recipient.includes(email));
  assert.ok(message);
  const code = message.body.match(/Code: (\d{6})/)[1];
  assert.ok(message.body.includes((quote.amount_due_minor / 100).toFixed(2)));
  assert.equal(await wallet(), initial);
  await staff.reload();
  await staff.locator("[data-confirm]").waitFor();
  // A second cashier tab retains the pending sale if it missed the first receipt.
  const duplicate = staff.waitForEvent("popup");
  await staff.evaluate(() => { window.open(location.href); });
  const retryTab = await duplicate;
  await retryTab.locator("[data-confirm]").waitFor();
  const editing = staff.waitForEvent("popup");
  await staff.evaluate(() => { window.open(location.href); });
  const editTab = await editing;
  await editTab.locator("[data-edit]").click();
  const restoredFare = editTab.locator(`[data-fare="${student}"]`);
  await restoredFare.waitFor();
  assert.equal(await restoredFare.inputValue(), "STUDENT");
  await staff.locator("[name=code]").fill(code);
  const confirmation = staff.waitForResponse(r => r.url().endsWith("/confirm") && r.request().method() === "POST");
  await staff.locator("[data-confirm] button[type=submit]").click();
  await staff.getByText(/Tickets issued/).waitFor();
  const bookingId = (await (await confirmation).json()).data.booking_id;
  await editTab.locator(`[data-seat="${student}"].sold`).waitFor({ timeout: 12000 });
  assert.equal(await editTab.locator("[data-fare]").count(), 0);
  assert.ok(await editTab.locator("[data-sale] button[type=submit]").isDisabled());
  await editTab.close();
  assert.equal(await wallet(), initial - quote.amount_due_minor);
  await staff.locator("[data-booking]").click();
  await staff.getByRole("dialog").waitFor();
  await customer.goto(fixture.base_url + "/#/account?tab=orders&booking=" + bookingId);
  await customer.locator(`[data-action="refund-booking"][data-id="${bookingId}"]`).click();
  await customer.getByRole("button", { name: /Confirm refund ·/ }).click();
  await customer.getByRole("heading", { name: "Tickets cancelled · seats released" }).waitFor();
  const refundedBalance = await wallet();
  await retryTab.locator("[name=code]").fill(code);
  await retryTab.locator("[data-confirm] button[type=submit]").click();
  await retryTab.getByRole("status").filter({ hasText: "Customer refunded" }).waitFor();
  assert.equal(await wallet(), refundedBalance);
  assert.deepEqual(errors, []);
  console.log("PASS branch landing, counter ticket and wallet debit, refunded status on receipt retry");
} finally {
  await browser?.close();
  inbox.close();
}
