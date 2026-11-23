/** Guest → sign in → cinema conversation → per-account throttle on the disposable fixture. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const fixture = JSON.parse(await readFile("instance/browser-fixture.json", "utf8"));
assert.equal(fixture.status, "running");
assert.equal(fixture.base_url, "http://127.0.0.1:5002");
assert.match(fixture.schema, /^cinema_browser_[a-f0-9]{16}$/);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture.base_url);
  async function signInFromAssistant(account) {
    await page.locator(".ai-launcher").click();
    assert.equal(await page.locator("#assistant-panel textarea").count(), 0);
    await page.locator("#assistant-panel a").click();
    await page.locator('[name="email"]').fill(account + "@cinema.test");
    await page.locator('[name="password"]').fill(fixture.password);
    await page.locator("#auth-form button[type=submit]").click();
  }
  await signInFromAssistant("customer");
  const input = page.locator("#ai-message");
  await input.waitFor();
  for (const [index, question] of ["推荐一部电影", "Show screenings for film number 1", "两个人",
    "帮我写一篇电影主题论文", "Thanks", "你好", "Recommend a film"].entries()) {
    await input.fill(question);
    const pending = page.waitForResponse(res => new URL(res.url()).pathname === "/api/assistant/chat");
    await page.locator("#ai-send").click();
    const response = await pending;
    assert.equal(response.status(), index === 6 ? 429 : 200);
    if (index === 6) await page.locator(".ai-transcript").getByText(/Try again in \d+ seconds/).waitFor();
    if (index === 0) assert.ok((await response.json()).data.films.length);
    if (index === 3) assert.equal((await response.json()).data.intent, "cinema_scope");
  }
  await page.locator("#ai-close").click();
  for (const account of ["staff1", "manager1", "admin"]) {
    await page.locator("#logout").click();
    await page.locator("[data-sign-in-label]").waitFor();
    const requests = [];
    const trackAssistant = req => {
      if (/^\/api\/(ai|assistant)\//.test(new URL(req.url()).pathname)) requests.push(req.url());
    };
    page.on("request", trackAssistant);
    await signInFromAssistant(account);
    await page.waitForURL("**/#/operations");
    await page.locator("[data-operations-nav]").waitFor();
    assert.equal(await page.locator(".ai-launcher").isVisible(), false);
    assert.deepEqual(await page.locator(".main-nav a").evaluateAll(links => links.map(link => link.hash)), ["#/operations"]);
    assert.equal(await page.locator('#site-header a[href="#/cinemas"]').count(), 0);
    await page.goto(fixture.base_url + "/#/reviews");
    await page.locator("[data-operations-nav]").waitFor();
    assert.equal(await page.locator("[data-open-assistant]").count(), 0);
    await page.goto(fixture.base_url + "/#/assistant");
    await page.waitForURL("**/#/operations");
    await page.goto(fixture.base_url + "/assistant");
    await page.waitForURL("**/#/operations");
    await page.locator("[data-operations-nav]").waitFor();
    assert.equal(await page.locator(".ai-launcher").isVisible(), false);
    assert.deepEqual(requests, []);
    page.off("request", trackAssistant);
  }
  assert.deepEqual(errors, []);
  console.log("PASS guest login, customer chat, staff/manager/admin entry and bookmark restrictions");
} finally {
  await browser.close();
}
