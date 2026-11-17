import test from "node:test";
import assert from "node:assert/strict";
import { getLanguage, onLanguage, setLanguage, tx } from "../../cinema/static/js/locale.js";

test("english is the default and chinese replaces the same copy", () => {
  setLanguage("en");
  assert.equal(getLanguage(), "en");
  assert.equal(tx("Movies", "电影"), "Movies");
  setLanguage("zh");
  assert.equal(getLanguage(), "zh");
  assert.equal(tx("Movies", "电影"), "电影");
  setLanguage("nope");
  assert.equal(getLanguage(), "en");
  assert.equal(tx("Movies", "电影"), "Movies");
});

test("listeners hear each real change and can unsubscribe", () => {
  const seen = [];
  const stop = onLanguage((value) => seen.push(value));
  setLanguage("zh");
  setLanguage("zh");
  setLanguage("en");
  stop();
  setLanguage("zh");
  assert.deepEqual(seen, ["zh", "en"]);
  setLanguage("en");
});
