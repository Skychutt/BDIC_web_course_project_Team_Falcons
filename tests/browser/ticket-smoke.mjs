/** Purchased ticket -> preview -> PNG -> signed lookup -> refund. Disposable schema only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const fixture = JSON.parse(await fs.readFile(new URL('../../instance/browser-fixture.json', import.meta.url)));
assert.equal(fixture.status, 'running');
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]{16}$/);
assert.equal(fixture.base_url, 'http://127.0.0.1:5002');
const output = new URL('../../output/e-ticket-preview/', import.meta.url);
await fs.mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true, ...(process.env.CINEMA_QA_CHROME ? {channel:'chrome'} : {})});
const context = await browser.newContext({viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai'});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e=>errors.push(e.message));
let csrf;
async function api(path, method='GET', body, key) {
  const response = await context.request.fetch(fixture.base_url+'/api'+path, {method,data:body,
    headers:{...(csrf ? {'X-CSRF-Token':csrf}:{}),...(key ? {'Idempotency-Key':key}:{})}});
  const json = await response.json();
  assert.ok(response.ok(), `${path}: ${JSON.stringify(json)}`);
  return json.data;
}
try {
  csrf = (await api('/auth/csrf')).csrf_token;
  csrf = (await api('/auth/login','POST',{email:'customer@cinema.test',password:fixture.password})).csrf_token;
  const sid = fixture.ids.screenings[2];
  const map = await api(`/screenings/${sid}/seats`);
  const seats = map.seats.filter(s=>s.state==='AVAILABLE' && Number(s.row_no)===5).slice(0,2);
  assert.equal(seats.length,2);
  const hold = await api('/holds','POST',{screening_id:sid,seat_ids:seats.map(s=>s.id)},crypto.randomUUID());
  const quote = await api(`/holds/${hold.hold_id}/quote`,'POST',{tickets:seats.map(s=>({seat_id:s.id,fare_type:'STANDARD'}))});
  const receipt = await api('/bookings','POST',{quote_token:quote.quote_token},crypto.randomUUID());
  const card = await api(`/bookings/${receipt.booking_id}/ticket`);
  const ticketUrl = fixture.base_url+card.ticket_path;
  await fs.writeFile(new URL('expected-qr.txt',output), ticketUrl);
  const accountPath = `/#/account?tab=orders&booking=${receipt.booking_id}`;
  await page.goto(fixture.base_url+accountPath);
  const open = page.locator(`[data-action="view-ticket"][data-id="${receipt.booking_id}"]`);
  await open.click();
  const modal = page.locator('dialog.ticket-card-dialog');
  await modal.locator('canvas').waitFor();
  await page.screenshot({path:new URL('ticket-desktop.png',output).pathname});
  const downloadEvent = page.waitForEvent('download');
  await modal.getByRole('button',{name:'Save ticket image'}).click();
  const download = await downloadEvent;
  await download.saveAs(new URL('ticket-card.png',output).pathname);
  const png = await fs.readFile(new URL('ticket-card.png',output));
  assert.equal(png.readUInt32BE(16),1080);
  assert.ok(png.readUInt32BE(20)>=1500);
  assert.equal(download.suggestedFilename(),`Falcons-ticket-${String(receipt.booking_id).slice(-8)}.png`);
  await page.keyboard.press('Escape');
  assert.equal(await modal.count(),0);
  await open.click();
  await modal.locator('canvas').waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await modal.evaluate(d=>d.scrollWidth<=d.clientWidth+1),'No horizontal modal overflow');
  await page.screenshot({path:new URL('ticket-mobile.png',output).pathname});
  await modal.getByRole('button',{name:'Close ticket preview'}).click();

  // The QR destination is a real authorized route, not a decorative code.
  await page.goto(ticketUrl);
  await page.locator('.ticket-card-page canvas').waitFor();
  assert.match(await page.locator('.ticket-card-message').innerText(), /seats are booked/);
  const guest = await browser.newPage();
  await guest.goto(ticketUrl);
  await guest.getByRole('heading',{name:'Sign in to Falcons'}).waitFor();
  assert.ok(guest.url().includes('next='));
  await guest.close();
  const preview = await api(`/bookings/${receipt.booking_id}/refund-preview`,'POST');
  await api(`/bookings/${receipt.booking_id}/refund`,'POST',{preview_token:preview.preview_token},crypto.randomUUID());
  await page.getByRole('button',{name:'Refresh ticket status'}).click();
  await page.getByRole('heading',{name:'These tickets were refunded'}).waitFor();
  assert.match(await page.locator('.ticket-card-message').innerText(), /no longer valid/);
  const refunded = await api(`/tickets/${card.ticket_path.split('/ticket/')[1]}`);
  assert.equal(refunded.status,'CUSTOMER_CANCELLED');
  await page.setViewportSize({width:1440,height:1100});
  await page.screenshot({path:new URL('ticket-refunded.png',output).pathname});

  // Long labels and a maximum-size group must render without clipping / lost seats.
  const stress = {...card, film_title:"Harry Potter and the Philosopher's Stone",
    holder_name:'这是一个用于检查长用户名的观众名字 / A very long cinema guest name',
    cinema_name:'北京万达影城（CBD店）· 杜比全景声激光巨幕体验厅',screen_name:'Dolby Cinema · Premium auditorium',screen_type:'DOLBY_CINEMA',
    seats:Array.from({length:12},(_,i)=>({row_no:10,seat_no:i+1,ticket_id:String(i)}))};
  await page.evaluate(async data=>{
    const {renderTicketCanvas}=await import('/static/js/ticket-card.js');
    const canvas=await renderTicketCanvas(data); document.querySelector('[data-ticket-art]').replaceChildren(canvas);
  },stress);
  await page.locator('[data-ticket-art]').screenshot({path:new URL('ticket-long-labels.png',output).pathname});
  assert.deepEqual(errors,[]);
  console.log('PASS: order preview, PNG download, desktop/mobile, QR destination/sign-in, live refunded state, long labels/12 seats.');
} finally { await browser.close(); }
