/** Read-only check on the :5002 browser fixture or another running site via CINEMA_BASE_URL. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CINEMA_QA_CHROME ? { channel: "chrome" } : {}),
});
const names = {
  Dongcheng: "东城区", Xicheng: "西城区", Chaoyang: "朝阳区", Fengtai: "丰台区", Haidian: "海淀区",
};

try {
  const page = await browser.newPage();
  await page.goto((process.env.CINEMA_BASE_URL || "http://127.0.0.1:5002") + "/#/cinemas");
  const district = page.locator('[data-map="district"]');
  const cards = page.locator("[data-cinema]");
  const cardIds = () => cards.evaluateAll(nodes => nodes.map(node => node.dataset.cinema));
  const options = () => district.locator("option").evaluateAll(nodes =>
    nodes.map(node => ({ id: node.value, label: node.textContent })));

  await page.locator('#site-header [data-lang="en"]').click();
  await district.locator("option", { hasText: "Dongcheng" }).waitFor({ state: "attached" });
  const english = await options();
  const dongcheng = english.find(option => option.label === "Dongcheng");
  assert.equal(english[0].label, "All Beijing");
  await district.selectOption(dongcheng.id);
  const cinemas = await cardIds();
  assert.ok(cinemas.length > 0);

  for (const [language, name, caption] of [
    ["zh", "东城区", "北京 · 影院"], ["en", "Dongcheng", "BEIJING · CINEMA"],
  ]) {
    await page.locator(`#site-header [data-lang="${language}"]`).click();
    assert.equal(await district.inputValue(), dongcheng.id);
    assert.deepEqual(await cardIds(), cinemas);
    const labels = await options();
    if (language === "en") {
      assert.deepEqual(labels, english);
    } else {
      assert.deepEqual(labels[0], { id: "", label: "北京全市" });
      for (const { id, label } of english.filter(option => Object.hasOwn(names, option.label))) {
        assert.equal(labels.find(option => option.id === id)?.label, names[label]);
      }
    }
    assert.deepEqual(await cards.locator(".cinema-cover-label > span").allTextContents(), cinemas.map(() => name));
    assert.deepEqual(await cards.locator(".cinema-cover-label > small").allTextContents(), cinemas.map(() => caption));
  }
  console.log("PASS district options and cinema covers switch language and keep the selected cinemas");
} finally {
  await browser.close();
}
