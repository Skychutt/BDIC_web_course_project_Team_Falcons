/** Customer flow regression using the disposable MySQL-backed browser fixture. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const fixture = JSON.parse(await readFile(new URL("../../instance/browser-fixture.json", import.meta.url)));
assert.equal(fixture.status, "running");
assert.equal(fixture.base_url, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]{16}$/);

const base = fixture.base_url;
const sid = fixture.ids.screenings[2];
const screening = fixture.screenings.find((s) => s.id === sid);
const date = screening.starts_at.slice(0, 10);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CINEMA_QA_CHROME ? { channel: "chrome" } : {}),
});
const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
const rival = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function api(ctx, path, method = "GET", data, csrf) {
  const response = await ctx.request.fetch(base + "/api" + path, {
    method,
    data,
    headers: csrf ? { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() } : {},
  });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()}`);
  return (await response.json()).data;
}

async function language(code, label) {
  await page.locator(`#site-header [data-lang="${code}"]`).click();
  await page.getByRole("heading", { name: label, exact: true }).waitFor();
}

try {
  const rivalInitial = await api(rival, "/auth/csrf");
  const rivalSession = await api(rival, "/auth/login", "POST", {
    email: "customer2@cinema.test", password: fixture.password,
  }, rivalInitial.csrf_token);
  const rivalCsrf = rivalSession.csrf_token;

  await page.goto(base + "/#/login");
  await page.getByLabel("Email address").fill("customer@cinema.test");
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.locator("#auth-form button[type=submit]").click();
  await page.locator("#search-form").waitFor();
  await page.locator('input[name="date"]').fill(date);
  await page.locator('select[name="party_size"]').selectOption("2");
  await page.locator(".search-advanced summary").click();
  await page.locator('input[name="budget_yuan"]').fill("260");
  const originalUrl = page.url();
  await language("zh", "找到下一场");
  assert.equal(page.url(), originalUrl);
  assert.equal(await page.locator('input[name="date"]').inputValue(), date);
  assert.equal(await page.locator('select[name="party_size"]').inputValue(), "2");
  assert.equal(await page.locator('input[name="budget_yuan"]').inputValue(), "260");
  assert.ok(await page.locator(".search-advanced").evaluate((node) => node.open));
  await language("en", "Find your next screening");
  await page.locator(".ai-launcher").click();
  await page.locator("#ai-message").fill("学生票有什么要求？");
  const reply = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/assistant/chat" && res.ok());
  await page.locator("#ai-send").click();
  assert.equal((await (await reply).json()).data.locale, "zh");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  assert.equal(await page.locator('input[name="budget_yuan"]').inputValue(), "260");
  await page.locator("#ai-close").click();
  console.log("PASS language switch preserves draft search; AI reply keeps the page language");

  const map = await api(context, `/screenings/${sid}/seats`);
  const [first, second, third] = map.seats.filter((seat) => seat.state === "AVAILABLE");
  await page.goto(`${base}/#/seats/${sid}`);
  await page.locator("#party-size").selectOption("2");
  await page.locator(`[data-seat="${first.id}"]`).click();
  await page.locator(`[data-seat="${second.id}"]`).click();
  await language("zh", "请选择座位");
  assert.equal(await page.locator("#party-size").inputValue(), "2");
  assert.equal(await page.locator('[data-seat][aria-pressed="true"]').count(), 2);
  const rivalHold = await api(rival, "/holds", "POST", {
    screening_id: sid, seat_ids: [first.id],
  }, rivalCsrf);
  await page.locator("#create-hold").click();
  await page.getByText("部分座位刚被占用。 请再选 1 个座位。", { exact: true }).waitFor();
  assert.equal(await page.locator(`[data-seat="${second.id}"]`).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(`[data-seat="${first.id}"]`).getAttribute("aria-pressed"), "false");

  // The competing hold is real. Restrict the refreshed seat map to exercise the sold-out UI.
  await page.locator(`[data-seat="${third.id}"]`).click();
  await api(rival, `/holds/${rivalHold.hold_id}`, "DELETE", undefined, rivalCsrf);
  await api(rival, "/holds", "POST", { screening_id: sid, seat_ids: [third.id] }, rivalCsrf);
  const mapUrl = `**/api/screenings/${sid}/seats`;
  await page.route(mapUrl, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    for (const seat of payload.data.seats) {
      if (seat.id !== second.id && seat.state === "AVAILABLE") seat.state = "SOLD";
    }
    await route.fulfill({ response, json: payload });
  });
  await page.locator("#create-hold").click();
  const alternatives = page.getByRole("link", { name: "查看其他场次" });
  const filters = new URLSearchParams((await alternatives.getAttribute("href")).split("?")[1]);
  assert.equal(filters.get("film_id"), screening.film_id);
  assert.equal(filters.get("date"), date);
  assert.equal(filters.get("party_size"), "2");
  await alternatives.click();
  await page.getByRole("button", { name: "查找场次", exact: true }).waitFor();
  assert.equal(await page.locator('input[name="date"]').inputValue(), date);
  assert.equal(await page.locator('select[name="party_size"]').inputValue(), "2");
  await page.unroute(mapUrl);
  console.log("PASS real seat conflicts preserve remaining seats and provide a filtered fallback");

  await page.goto(`${base}/#/seats/${sid}?party_size=2`);
  await page.locator(`[data-seat="${first.id}"]`).click();
  await page.locator(`[data-seat="${second.id}"]`).click();
  await page.locator("#create-hold").click();
  await page.locator("#quote-form").waitFor();
  await page.locator("[data-fare]").first().selectOption("STUDENT");
  const holdUrl = page.url();
  await language("en", "Your seats are on hold.");
  assert.equal(await page.locator("[data-fare]").first().inputValue(), "STUDENT");
  assert.equal(page.url(), holdUrl);
  await page.locator("#quote-form button[type=submit]").click();
  await page.locator("#pay-now").waitFor();
  await language("zh", "座位已为你保留");
  assert.equal(page.url(), holdUrl);
  assert.match(await page.locator("#pay-now").innerText(), /支付.*并购票/);
  await page.locator("#pay-now").click();
  await page.getByRole("heading", { name: "出票成功", exact: true }).waitFor();
  await page.locator("[data-success-ticket]").click();
  const modal = page.getByRole("dialog", { name: "电子影票预览" });
  await modal.locator("canvas").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
  const download = page.waitForEvent("download");
  await modal.getByRole("button", { name: "保存影票图片" }).click();
  assert.match((await download).suggestedFilename(), /^Falcons-ticket-\d+\.png$/);
  await modal.getByRole("button", { name: "关闭影票预览" }).click();
  await page.setViewportSize({ width: 1360, height: 920 });
  await page.locator('.success-panel a[href^="#/account"]').click();
  const order = page.locator("[data-booking]").first();
  await order.getByRole("button", { name: "查看电子票" }).waitFor();
  await order.locator('[data-action="refund-booking"]').click();
  const bookingId = await order.getAttribute("data-booking");
  await page.getByRole("button", { name: /^确认退票/ }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  const refunded = await api(context, `/ui/bookings/${bookingId}`);
  assert.equal(refunded.status, "CUSTOMER_CANCELLED");
  const after = await api(context, `/screenings/${sid}/seats`);
  for (const id of [first.id, second.id]) {
    assert.equal(after.seats.find((seat) => seat.id === id).state, "AVAILABLE");
  }
  assert.deepEqual(errors, []);
  console.log("PASS quote and hold survive language switch, payment opens a downloadable Chinese ticket, account/refund render in Chinese");
} finally {
  await browser.close();
}
