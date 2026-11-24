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
// Leave room for a minute-precision upper time limit on the fixture's screening date.
const screening = [fixture.ids.screenings[2], fixture.ids.screenings[0]]
  .map(id => fixture.screenings.find(s => s.id === id)).find(s => s.starts_at.slice(11, 16) !== "23:59");
const sid = screening.id;
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

async function checkRescheduleFeeChange() {
  const manager = await browser.newContext();
  // Earlier expiry checks advance the main context's clock. Use real time for the fee change.
  const customer = await browser.newContext({ storageState: await context.storageState() });
  const checkout = await customer.newPage();
  try {
    const login = await api(manager, "/auth/login", "POST", {
      email: "manager1@cinema.test", password: fixture.password,
    }, (await api(manager, "/auth/csrf")).csrf_token);
    const csrf = (await api(context, "/auth/csrf")).csrf_token;
    const target = fixture.ids.screenings[2];
    const screen = await api(manager, "/staff/screens", "POST", {
      name: "Fee boundary " + crypto.randomUUID(), screen_type: "STANDARD",
    }, login.csrf_token);
    const layout = await api(manager, `/staff/screens/${screen.screen_id}/layouts`, "POST", {
      row_count: 1, screen_direction: "TOP",
      seats: [{ row_no: 1, seat_no: 1, aisle_segment: 1, segment_position: 1, map_x: 0, map_y: 0 }],
    }, login.csrf_token);
    const [sourceSeat] = (await api(manager, `/staff/layouts/${layout.layout_id}`)).seats;
    for (const [hours, oldRate, newRate] of [[12, 0, 500], [6, 500, 2000]]) {
      const map = await api(context, `/screenings/${target}/seats`);
      const seat = map.seats.find(s => s.state === "AVAILABLE").id;
      const fares = Object.fromEntries(map.fares.map(f => [f.fare_type, f.price_minor]));
      const source = await api(manager, "/staff/screenings", "POST", {
        layout_id: layout.layout_id, film_id: fixture.ids.film_id, fares,
        starts_at: new Date(Date.parse(map.as_of) + hours * 3600000 + 20000).toISOString(),
      }, login.csrf_token);
      const hold = await api(context, "/holds", "POST", { screening_id: source.id, seat_ids: [sourceSeat.id] }, csrf);
      const originalQuote = await api(context, `/holds/${hold.hold_id}/quote`, "POST", {
        tickets: [{ seat_id: sourceSeat.id, fare_type: "STUDENT" }],
      }, csrf);
      const original = await api(context, "/bookings", "POST", { quote_token: originalQuote.quote_token }, csrf);
      const balance = async () => (await api(context, "/me/wallet")).balance_minor;
      const before = await balance();
      await checkout.goto(`${base}/#/seats/${target}?source_booking_id=${original.booking_id}&seat_ids=${seat}`);
      await checkout.locator("#create-hold").click();
      const review = checkout.locator("#quote-form [type=submit]");
      const quote = async () => {
        const reply = checkout.waitForResponse(r => r.url().endsWith("/quote") && r.ok());
        await review.click();
        return (await (await reply).json()).data;
      };
      const first = await quote();
      assert.equal(first.fee_rate_bps, oldRate);
      await checkout.locator("#pay-now").waitFor();
      const holdUrl = checkout.url();
      await review.waitFor({ timeout: 30000 });
      assert.equal(await checkout.locator("#pay-now").count(), 0);
      assert.equal(checkout.url(), holdUrl);
      assert.equal(await checkout.locator("[data-fare]").inputValue(), "STUDENT");
      assert.equal((await api(context, `/ui/bookings/${original.booking_id}`)).status, "CONFIRMED");
      assert.equal(await balance(), before);
      const fresh = await quote();
      const fee = Math.round(fares.STUDENT * newRate / 10000);
      assert.equal(fresh.fee_rate_bps, newRate);
      assert.equal(fresh.amount_due_minor, fee);
      assert.equal(fresh.hold_id, first.hold_id);
      assert.equal(fresh.expires_at, first.expires_at);
      await checkout.locator("#pay-now").click();
      await checkout.locator(".success-panel").waitFor();
      assert.equal((await api(context, `/ui/bookings/${original.booking_id}`)).status, "RESCHEDULED");
      assert.equal(await balance(), before - fee);
    }
    console.log("PASS both reschedule fee changes require a fresh quote on the same hold before charging");
  } finally {
    await customer.close();
    await manager.close();
  }
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
      if (changing) {
        await retry.locator(`[data-seat="${seats[3 + size - 1].id}"][aria-pressed="true"]`).waitFor();
        await retry.reload();
        await retry.locator("#party-size").waitFor();
        assert.ok(await retry.locator("#party-size").isDisabled());
        assert.equal(currentQuery().get("source_booking_id"), bookingId);
        assert.deepEqual(await retry.locator('[data-seat][aria-pressed="true"]').evaluateAll(
          buttons => buttons.map(button => button.dataset.seat)), seats.slice(3, 3 + size).map(seat => seat.id));
      }
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
  const budgetMinor = map.fares.find(f => f.fare_type === "STUDENT").price_minor + 1;
  const startFrom = screening.starts_at.slice(11, 16);
  const upperMinute = Math.min(1439, Number(startFrom.slice(0, 2)) * 60 + Number(startFrom.slice(3)) + 15);
  const startTo = [Math.floor(upperMinute / 60), upperMinute % 60].map(v => String(v).padStart(2, "0")).join(":");
  const criteria = { fare_type: "student", budget_minor: String(budgetMinor), budget_scope: "per_ticket",
    start_from: startFrom, start_to: startTo, require_contiguous: "true" };
  const search = page.locator("#search-form");
  await search.locator('[name="budget_yuan"]').fill((budgetMinor / 100).toFixed(2));
  for (const key of ["fare_type", "budget_scope", "require_contiguous"])
    await search.locator(`[name="${key}"]`).selectOption(criteria[key]);
  await search.locator('[name="start_from"]').fill(startFrom);
  await search.locator('[name="start_to"]').fill(startTo);
  await search.locator('[type="submit"]').click();
  await page.locator(`.session-button[href^="#/seats/${sid}?"]`).click();
  await page.locator("#party-size").waitFor();
  await page.reload();
  await page.locator("#party-size").waitFor();
  const selected = page.locator('[data-seat][aria-pressed="true"]');
  const chosenIds = () => selected.evaluateAll(buttons => buttons.map(button => button.dataset.seat));
  const historyLength = await page.evaluate(() => history.length);
  while (await selected.count()) await selected.first().click();
  await page.locator("#party-size").selectOption("3");
  await page.reload();
  await page.locator("#party-size").waitFor();
  assert.equal(await page.locator("#party-size").inputValue(), "3");
  assert.deepEqual(await chosenIds(), []);
  await page.locator(`[data-seat="${first.id}"]`).click();
  await page.locator(`[data-seat="${second.id}"]`).click();
  await page.locator(`[data-seat="${second.id}"][aria-pressed="true"]`).waitFor();
  await page.locator("#party-size").selectOption("2");
  await page.reload();
  await page.locator("#party-size").waitFor();
  assert.deepEqual(await chosenIds(), [first.id, second.id]);
  assert.equal(await page.evaluate(() => history.length), historyLength);
  const editedUrl = page.url();
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

  // Reload a saved choice after its first seat was taken. Only the surviving seat should return.
  const reopened = await context.newPage();
  try {
    await reopened.goto(editedUrl);
    await reopened.locator("#party-size").waitFor();
    assert.equal(await reopened.locator('[data-seat][aria-pressed="true"]').count(), 1);
    assert.equal(await reopened.locator(`[data-seat="${second.id}"]`).getAttribute("aria-pressed"), "true");
    assert.ok(await reopened.locator("#create-hold").isDisabled());
    assert.equal(new URLSearchParams(new URL(reopened.url()).hash.split("?")[1]).get("seat_ids"), second.id);
  } finally {
    await reopened.close();
  }
  const recommend = page.getByRole("button", { name: "一键重新推荐连座" });
  await recommend.click();
  await page.getByText("已选好连座，确认后可占座。", { exact: true }).waitFor();
  await page.reload();
  await page.locator("#party-size").waitFor();
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
  const results = page.waitForResponse(res => new URL(res.url()).pathname === "/api/screenings" && res.ok());
  await alternatives.click();
  const response = await results;
  const applied = new URL(response.url()).searchParams;
  await page.getByRole("button", { name: "查找场次", exact: true }).waitFor();
  for (const [key, value] of Object.entries(criteria)) {
    assert.equal(filters.get(key), value, key);
    assert.equal(applied.get(key), value, key);
    if (key !== "budget_minor") assert.equal(await search.locator(`[name="${key}"]`).inputValue(), value, key);
  }
  assert.equal(await search.locator('[name="budget_yuan"]').inputValue(), (budgetMinor / 100).toFixed(2));
  const matches = (await response.json()).data.items;
  assert.ok(matches.some(s => s.id !== sid), "There is a matching screening at another cinema");
  for (const show of matches) {
    assert.ok(show.suggestion.adjacent && show.suggestion.seat_ids.length === 2);
    assert.ok(show.fares.find(f => f.fare_type === "STUDENT").price_minor <= budgetMinor);
    assert.ok(show.starts_at.slice(11, 16) >= startFrom && show.starts_at.slice(11, 16) <= startTo);
  }
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
  const manager = await browser.newContext();
  const originalWallet = (await api(context, "/me/wallet")).balance_minor;
  let revisedTotal;
  try {
    const csrf = (await api(manager, "/auth/csrf")).csrf_token;
    const session = await api(manager, "/auth/login", "POST", {
      email: "manager1@cinema.test", password: fixture.password,
    }, csrf);
    let revision = map.screening.revision_no;
    for (const reload of [false, true]) {
      const delta = reload ? -17 : 125;
      const fares = Object.fromEntries(map.fares.map(f => [f.fare_type, f.price_minor + delta]));
      const updated = await api(manager, `/staff/screenings/${sid}/fares`, "PUT",
        { revision_no: revision, fares }, session.csrf_token);
      revision = updated.revision_no;
      const liveStatus = "**/payment-result?include_sale_status=1";
      if (reload) {
        await page.route(liveStatus, route => route.abort());
        await page.reload();
      }
      const review = page.locator("#quote-form button[type=submit]");
      await review.waitFor();
      if (reload) await page.unroute(liveStatus);
      assert.equal(await page.locator("#pay-now").count(), 0);
      await page.getByText("票价或改签费已变化，请核对最新报价。", { exact: true }).waitFor();
      for (const [index, fare] of ["STUDENT", "STANDARD"].entries()) {
        const field = page.locator("[data-fare]").nth(index);
        assert.equal(await field.inputValue(), fare);
        await field.locator("option:checked").filter({ hasText: (fares[fare] / 100).toFixed(2) }).waitFor({ state: "attached" });
      }
      assert.equal(page.url(), holdUrl);
      assert.equal((await api(context, "/me/wallet")).balance_minor, originalWallet);
      const newQuote = page.waitForResponse(res => res.url().endsWith("/quote") && res.ok());
      await review.click();
      revisedTotal = fares.STUDENT + fares.STANDARD;
      assert.equal((await (await newQuote).json()).data.amount_due_minor, revisedTotal);
      await page.locator("#pay-now").waitFor();
      assert.ok((await page.locator("#pay-now").innerText()).includes((revisedTotal / 100).toFixed(2)));
    }
  } finally {
    await manager.close();
  }
  await page.locator("#pay-now").click();
  await page.getByRole("heading", { name: "出票成功", exact: true }).waitFor();
  assert.equal((await api(context, "/me/wallet")).balance_minor, originalWallet - revisedTotal);
  console.log("PASS fare changes invalidate live and reloaded quotes; only the reconfirmed price is charged");
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

  await page.goto(`${base}/#/seats/${sid}?seat_ids=${first.id}`);
  await page.locator("#create-hold").click();
  await page.locator("#change-seats").click();
  await page.locator("#create-hold").waitFor();
  assert.equal(new URL(page.url()).hash, `#/seats/${sid}?seat_ids=${first.id}&party_size=1`);

  await page.locator("#create-hold").click();
  await page.locator("#quote-form").waitFor();
  const holdId = new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("hold_id");
  const draftKey = `falcons.checkout.${fixture.ids.accounts["customer@cinema.test"]}.${sid}`;
  assert.equal(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).hold_id, draftKey), holdId);
  await page.route(`**/api/holds/${holdId}`, async route => {
    const response = await route.fetch();
    await page.locator(".review-film-grid").waitFor();
    await route.fulfill({ response });
  }, { times: 1 });
  const releasing = page.waitForRequest(req => req.method() === "DELETE" && req.url().endsWith("/holds/" + holdId));
  await page.locator("#change-seats").click();
  await releasing;
  await page.locator('#main-nav a[href="#/reviews"]').click();
  await page.waitForFunction(key => sessionStorage.getItem(key) === null, draftKey);
  assert.equal(new URL(page.url()).hash, "#/reviews");
  assert.ok(await page.locator(".review-film-grid").isVisible());
  const afterRelease = await api(context, `/screenings/${sid}/seats`);
  assert.equal(afterRelease.seats.find(seat => seat.id === first.id).state, "AVAILABLE");
  assert.deepEqual(errors, []);
  console.log("PASS releasing seats completes without redirecting a customer who has opened reviews");

  const checkout = await context.newPage();
  const charges = async () => (await api(context, "/me/wallet-entries")).items.filter(e => e.entry_type === "PAYMENT");
  try {
    const writes = [];
    page.on("request", req => {
      if (req.method() === "POST" && new URL(req.url()).pathname === "/api/bookings") writes.push(req.url());
    });
    const before = await charges();
    await page.goto(`${base}/#/seats/${sid}?seat_ids=${first.id}`);
    await page.locator("#create-hold").click();
    await page.locator("#quote-form [type=submit]").click();
    await page.locator("#pay-now").waitFor();

    await checkout.goto(`${base}/#/seats/${sid}?seat_ids=${second.id}`);
    await checkout.locator("#create-hold").click();
    await checkout.locator("#quote-form").waitFor();
    await page.locator("#reselect").waitFor();
    assert.equal(await page.getByRole("link", { name: "查看我的占座" }).getAttribute("href"), "#/account?tab=holds");
    assert.equal(await page.locator("#pay-now, #countdown").count(), 0);
    const newHold = new URLSearchParams(new URL(checkout.url()).hash.split("?")[1]).get("hold_id");
    assert.equal((await api(context, `/holds/${newHold}/payment-result`)).status, "ACTIVE");
    assert.deepEqual(await charges(), before);

    await page.clock.install();
    await page.goto(checkout.url());
    await page.locator("#quote-form [type=submit]").click();
    await page.locator("#pay-now").waitFor();
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
    await checkout.locator("#quote-form [type=submit]").click();
    await checkout.locator("#pay-now").click();
    const receipt = ".success-panel a[href*='booking=']";
    await checkout.locator(receipt).waitFor();
    // Resume this tab after its local countdown has elapsed.
    await page.clock.fastForward(301000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.locator(receipt).waitFor();
    assert.equal(await page.locator(receipt).getAttribute("href"), await checkout.locator(receipt).getAttribute("href"));
    assert.equal(await page.locator("#pay-now, #countdown").count(), 0);
    assert.equal((await charges()).length, before.length + 1);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log("PASS a second checkout tab replaces a hold or pays once and the first tab updates automatically");
  } finally {
    await checkout.close();
  }
  await checkRescheduleFeeChange();
} finally {
  await browser.close();
}
