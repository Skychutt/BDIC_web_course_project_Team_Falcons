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

async function checkExpiredReselection(bookingId) {
  const retry = await context.newPage();
  const otherShow = fixture.ids.screenings[1];
  const seats = (await api(context, `/screenings/${otherShow}/seats`)).seats.filter(s => s.state === "AVAILABLE");
  const csrf = (await api(context, "/auth/csrf")).csrf_token;
  const fares = () => retry.locator("[data-fare]").evaluateAll(inputs => inputs.map(input => input.value));
  const currentQuery = () => new URLSearchParams(new URL(retry.url()).hash.split("?")[1]);
  try {
    await retry.clock.install();
    for (const mode of ["student", "mixed", "reschedule"]) {
      const changing = mode === "reschedule";
      const size = changing ? 2 : 3;
      const query = new URLSearchParams({ party_size: String(size), seat_ids: seats.slice(0, size).map(s => s.id).join(",") });
      if (changing) query.set("source_booking_id", bookingId);
      else query.set("fare_type", "student");
      await retry.goto(`${base}/#/seats/${otherShow}?${query}`);
      await retry.locator("#create-hold").click();
      await retry.locator("#quote-form").waitFor();
      if (mode === "mixed") await retry.locator("[data-fare]").last().selectOption("STANDARD");
      const expected = await fares();
      assert.deepEqual([...expected].sort(), changing ? ["STANDARD", "STUDENT"] :
        mode === "mixed" ? ["STANDARD", "STUDENT", "STUDENT"] : ["STUDENT", "STUDENT", "STUDENT"]);
      const oldHold = currentQuery().get("hold_id");
      await retry.clock.fastForward(301000);
      await retry.locator("#reselect").waitFor();
      // The browser clock advanced independently of MySQL. Remove the old allocations in the fixture too.
      await api(context, `/holds/${oldHold}`, "DELETE", undefined, csrf);
      if (mode === "mixed") await retry.reload();
      await retry.locator("#reselect").click();
      await retry.locator("#party-size").waitFor();
      assert.equal(await retry.locator("#party-size").inputValue(), String(size));
      assert.equal(await retry.locator("#party-size").isDisabled(), changing);
      assert.equal(currentQuery().get("source_booking_id"), changing ? bookingId : null);
      assert.ok(!currentQuery().has("hold_id") && !currentQuery().has("seat_ids"));
      assert.equal(await retry.locator('[data-seat][aria-pressed="true"]').count(), 0);
      for (const seat of seats.slice(3, 3 + size)) await retry.locator(`[data-seat="${seat.id}"]`).click();
      await retry.locator("#create-hold").click();
      await retry.locator("#quote-form").waitFor();
      assert.deepEqual(await fares(), expected);
      assert.notEqual(currentQuery().get("hold_id"), oldHold);
      await api(context, `/holds/${currentQuery().get("hold_id")}`, "DELETE", undefined, csrf);
    }
    assert.equal((await api(context, `/ui/bookings/${bookingId}`)).status, "CONFIRMED");
    console.log("PASS expired holds reselect fresh seats with the same party, fares and reschedule source");
  } finally {
    await retry.close();
  }
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
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  try {
    const phone = await mobile.newPage();
    const backRow = map.seats.filter(s => s.row_no === map.layout.row_count && s.state === "AVAILABLE");
    const ends = [backRow[0].id, backRow.at(-1).id];
    await phone.goto(`${base}/#/seats/${sid}?party_size=2&seat_ids=${ends.join(",")}`);
    const scroller = phone.locator(".seat-scroll");
    await scroller.waitFor();
    assert.ok(await scroller.evaluate(el => el.scrollWidth > el.clientWidth));
    for (const id of [...ends].reverse()) {
      if (id === ends[0]) await phone.emulateMedia({ reducedMotion: "reduce" });
      const chip = phone.locator(`[data-locate-seat="${id}"]`);
      await chip.scrollIntoViewIfNeeded();
      assert.ok(await chip.evaluate(el => el.getBoundingClientRect().height >= 44));
      await chip.tap();
      await phone.waitForFunction(seatId => {
        const seat = document.querySelector(`[data-seat="${seatId}"].seat-located`);
        if (!seat || getComputedStyle(seat).outlineStyle !== "solid") return false;
        const box = seat.getBoundingClientRect();
        const mapBox = seat.closest(".seat-scroll").getBoundingClientRect();
        return box.left >= Math.max(0, mapBox.left) && box.right <= Math.min(innerWidth, mapBox.right) &&
          box.top >= Math.max(0, mapBox.top) && box.bottom <= Math.min(innerHeight, mapBox.bottom);
      }, id, { timeout: 4000 });
      assert.equal(await phone.locator(".seat-located").count(), 1);
      assert.deepEqual(await phone.locator('[data-seat][aria-pressed="true"]').evaluateAll(
        seats => seats.map(seat => seat.dataset.seat)), ends);
    }
    await phone.locator(".seat-located").waitFor({ state: "detached", timeout: 4000 });
    console.log("PASS tapping seat numbers on mobile reveals the correct seat without changing the selection");
  } finally {
    await mobile.close();
  }
  const [first, second, third] = map.seats.filter((seat) =>
    seat.row_no === 1 && seat.aisle_segment === 2 && seat.state === "AVAILABLE");
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
  // Wait for the periodic update without clicking refresh or trying to reserve.
  await page.getByText(`${first.row_no} 排 ${first.seat_no} 座 已被占用。 请再选 1 个座位。`, { exact: true }).waitFor();
  assert.ok(await page.locator(`[data-seat="${first.id}"]`).isDisabled());
  assert.ok(await page.locator("#create-hold").isDisabled());
  assert.equal(await page.locator(`[data-seat="${second.id}"]`).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(`[data-seat="${first.id}"]`).getAttribute("aria-pressed"), "false");

  const recommend = page.getByRole("button", { name: "一键重新推荐连座" });
  const chosenIds = () => page.locator('[data-seat][aria-pressed="true"]').evaluateAll(
    buttons => buttons.map(button => button.dataset.seat));
  await recommend.click();
  await page.getByText("已选好连座，确认后可占座。", { exact: true }).waitFor();
  assert.deepEqual(await chosenIds(), [second.id, third.id]);
  assert.equal((await api(context, "/me/holds")).items.length, 0);
  // This auditorium has enough individual seats, but no block of twelve.
  await page.locator("#party-size").selectOption("12");
  await recommend.click();
  await page.getByText("本场暂无 12 个连座，可手动选择分散座位或更换场次。", { exact: true }).waitFor();
  assert.deepEqual(await chosenIds(), [second.id, third.id]);
  assert.ok(await page.locator("#create-hold").isDisabled());
  await page.locator("#party-size").selectOption("2");
  await api(rival, `/holds/${rivalHold.hold_id}`, "DELETE", undefined, rivalCsrf);
  const refreshed = page.waitForResponse(res => new URL(res.url()).pathname === `/api/screenings/${sid}/seats`);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await refreshed;
  await page.locator(`[data-seat="${first.id}"]:enabled`).waitFor();

  // Reproduce the race between the last map update and the customer's hold request.
  let restrictMap = false;
  await page.route("**/api/holds", async route => {
    await api(rival, "/holds", "POST", { screening_id: sid, seat_ids: [third.id] }, rivalCsrf);
    restrictMap = true;
    await route.continue();
  }, { times: 1 });
  const mapUrl = `**/api/screenings/${sid}/seats`;
  await page.route(mapUrl, async (route) => {
    if (!restrictMap) return route.continue();
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

  await page.goto(`${base}/#/seats/${sid}?party_size=2&seat_ids=${first.id}`);
  await recommend.click();
  await page.locator(`[data-seat="${second.id}"][aria-pressed="true"]`).waitFor();
  assert.deepEqual(await chosenIds(), [first.id, second.id]);
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
  assert.equal(await page.locator(".success-ticket [data-locate-seat]").count(), 0);
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
  const bookingId = await order.getAttribute("data-booking");
  await checkExpiredReselection(bookingId);
  await order.locator('[data-action="refund-booking"]').click();
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
