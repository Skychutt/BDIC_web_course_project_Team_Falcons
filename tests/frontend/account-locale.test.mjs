import test from "node:test";
import assert from "node:assert/strict";
import { accountName } from "../../cinema/static/js/account-locale.js";
import { setLanguage } from "../../cinema/static/js/locale.js";

test("ticket and community labels translate only the original demo customer names", () => {
  setLanguage("zh");
  assert.equal(accountName("Demo Customer", { is_demo_customer: true }), "演示顾客");
  assert.equal(accountName("Second Customer", { is_demo_customer: true }), "第二位顾客");
  assert.equal(accountName("Demo Customer", {}), "Demo Customer");
  assert.equal(accountName("Second Customer", { email_normalized: "customer@cinema.test" }), "Second Customer");
  setLanguage("en");
  assert.equal(accountName("Demo Customer", { is_demo_customer: true }), "Demo Customer");
});

test("an imported manager's nickname is translated only for its original account and venue", () => {
  setLanguage("en");
  const account = { email_normalized: "manager.zhonghua@cinema.test" };
  assert.equal(accountName("中华电影院 演示店长", account), "Zhonghua Cinema Demo Manager");
  assert.equal(accountName("My cinema 演示店长", account), "My cinema 演示店长");
  assert.equal(accountName("中华电影院 演示店长", { email_normalized: "manager.test@cinema.test" }), "中华电影院 演示店长");
  setLanguage("zh");
  assert.equal(accountName("中华电影院 演示店长", account), "中华电影院 演示店长");
  setLanguage("en");
});
