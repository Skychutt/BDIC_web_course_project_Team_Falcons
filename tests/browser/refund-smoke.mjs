/** Customer refund UI and lost-response recovery. Uses only scripts/browser_fixture.py's owned DB. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fixture = JSON.parse(await fs.readFile(new URL('../../instance/browser-fixture.json', import.meta.url)));
assert.equal(fixture.status, 'running');
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]{16}$/);
assert.equal(fixture.base_url, 'http://127.0.0.1:5002');
const base = fixture.base_url;
const browser = await chromium.launch({ headless: true, ...(process.env.CINEMA_QA_CHROME ? {channel:'chrome'} : {}) });
const context = await browser.newContext({viewport:{width:1380,height:1000},timezoneId:'Asia/Shanghai'});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let csrf;
async function api(path, method='GET', body, key) {
  const response = await context.request.fetch(base+'/api'+path, {method,data:body,
    headers:{...(csrf ? {'X-CSRF-Token':csrf}:{}),...(key ? {'Idempotency-Key':key}:{})}});
  const payload = await response.json();
  assert.ok(response.ok(), `${path}: ${JSON.stringify(payload)}`);
  return payload.data;
}
try {
  csrf = (await api('/auth/csrf')).csrf_token;
  csrf = (await api('/auth/login','POST',{email:'customer@cinema.test',password:fixture.password})).csrf_token;
  const sid = fixture.ids.screenings[2];
  const map = await api(`/screenings/${sid}/seats`);
  const seats = map.seats.filter(s=>s.state==='AVAILABLE').slice(0,2);
  const hold = await api('/holds','POST',{screening_id:sid,seat_ids:seats.map(s=>s.id)},crypto.randomUUID());
  const quote = await api(`/holds/${hold.hold_id}/quote`,'POST',{tickets:seats.map(s=>({seat_id:s.id,fare_type:'STANDARD'}))});
  const receipt = await api('/bookings','POST',{quote_token:quote.quote_token},crypto.randomUUID());
  const path = `/#/account?tab=orders&booking=${receipt.booking_id}`;
  await page.goto(base+path);
  const refundButton = page.locator(`[data-action="refund-booking"][data-id="${receipt.booking_id}"]`);
  await refundButton.click();
  await page.getByRole('button',{name:/Confirm refund ·/}).waitFor();
  assert.match(await page.locator('dialog').innerText(), /Cancellation fee \(0%\)/);
  await fs.mkdir(new URL('./results/', import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('./results/refund-preview.png',import.meta.url).pathname});
  await page.getByRole('button',{name:'Keep my tickets'}).click();
  assert.equal((await api(`/ui/bookings/${receipt.booking_id}`)).status,'CONFIRMED');
  console.log('PASS preview cancellation preserves tickets and wallet');

  const cutoff = Date.parse(map.screening.starts_at) - 30 * 60000;
  for (const idle of [true, false]) {
    const separate = await browser.newContext({storageState:await context.storageState()});
    try {
      const tab = await separate.newPage();
      await tab.clock.install();
      await tab.goto(base+path);
      await tab.locator('[data-action="refund-booking"]').first().click();
      const confirm = tab.locator('[data-confirm-refund]');
      await tab.getByRole('button',{name:/Confirm refund ·/}).waitFor();
      const writes = [];
      tab.on('request', r => { if (r.url().endsWith('/refund')) writes.push(r.url()); });
      if (idle) {
        await tab.clock.fastForward(cutoff - await tab.evaluate(() => Date.now()) + 2000);
      } else {
        // A suspended tab can receive the click before its first timer callback.
        await tab.clock.setSystemTime(new Date(cutoff + 2000));
        await confirm.evaluate(button => button.click());
      }
      await tab.locator('[data-confirm-refund]:disabled').waitFor({timeout:3000});
      await tab.getByRole('button',{name:'Refunds closed',exact:true}).waitFor({timeout:3000});
      assert.deepEqual(writes,[]);
      assert.equal((await api(`/ui/bookings/${receipt.booking_id}`)).status,'CONFIRMED');
      assert.equal((await api('/me/wallet')).balance_minor,receipt.balance_minor);
    } finally { await separate.close(); }
  }
  console.log('PASS an open refund preview closes at the cutoff without sending a refund');

  await refundButton.click();
  await page.getByRole('button',{name:/Confirm refund ·/}).waitFor();
  await page.setViewportSize({width:390,height:844});
  const modal = page.locator('dialog');
  const bounds = await modal.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  assert.ok(await modal.evaluate(d=>d.scrollWidth<=d.clientWidth+1),'Refund dialog must not overflow horizontally');
  await page.screenshot({path:new URL('./results/refund-preview-mobile.png',import.meta.url).pathname});
  await page.setViewportSize({width:1380,height:1000});
  let requests = 0;
  const keys = [];
  await page.route(`**/api/bookings/${receipt.booking_id}/refund`, async route=>{
    keys.push(route.request().headers()['idempotency-key']);
    requests++;
    if(requests===1) {
      const response=await route.fetch(); // commit succeeds, but its response is lost
      assert.ok(response.ok());
      await route.abort('failed');
    } else await route.continue();
  });
  await page.clock.install();
  await page.getByRole('button',{name:/Confirm refund ·/}).click();
  const retry = page.getByRole('button',{name:'Retry this refund'});
  await retry.waitFor();
  await page.clock.fastForward(cutoff - await page.evaluate(() => Date.now()) + 2000);
  await retry.click();
  await page.locator('dialog').waitFor({state:'detached'});
  assert.equal(requests,2);
  assert.equal(keys[0],keys[1]);
  await page.getByRole('heading',{name:'Tickets cancelled · seats released'}).waitFor();
  const order=await api(`/ui/bookings/${receipt.booking_id}`);
  assert.equal(order.status,'CUSTOMER_CANCELLED');
  assert.equal(order.refunds.length,1);
  assert.equal(order.cancellation.refund_minor,receipt.net_ticket_minor);
  const wallet=await api('/me/wallet');
  assert.equal(wallet.balance_minor,receipt.balance_minor+receipt.net_ticket_minor);
  const after=await api(`/screenings/${sid}/seats`);
  for(const seat of seats) assert.equal(after.seats.find(s=>s.id===seat.id).state,'AVAILABLE');
  assert.ok(await refundButton.isDisabled());
  assert.equal(await page.locator(`[id="refund-reason-${receipt.booking_id}"]`).innerText(), 'This booking has already been refunded.');
  await page.screenshot({path:new URL('./results/refund-completed.png',import.meta.url).pathname});
  console.log('PASS lost response retries with same key, credits once, releases all seats and invalidates tickets');
  await page.reload();
  await page.getByRole('heading',{name:'Tickets cancelled · seats released'}).waitFor();
  assert.ok(await refundButton.isDisabled());
  assert.equal(await page.locator(`[id="refund-reason-${receipt.booking_id}"]`).innerText(), 'This booking has already been refunded.');
  await page.goto(base+'/#/account?tab=refunds');
  await page.getByText(/Your ticket refund: net ticket value/).first().waitFor();
  console.log('PASS refund receipt survives reload and appears in refund history');
  assert.deepEqual(errors,[]);
  console.log('PASS no browser JavaScript errors; desktop and mobile dialog verified');
} finally { await browser.close(); }
