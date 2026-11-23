import test from "node:test";
import assert from "node:assert/strict";
import { auditoriumName, districtLabel, venueAddress, venueName } from "../../cinema/static/js/venue-locale.js";
import { apiMessage } from "../../cinema/static/js/api.js";
import { filmTitle } from "../../cinema/static/js/film-locale.js";
import { setLanguage } from "../../cinema/static/js/locale.js";

test("directory translations preserve edited addresses and custom auditorium names", () => {
  const name = "万达影城(CBD万达广场店)";
  const address = "北京市朝阳区建国路93号万达广场B座3楼";
  setLanguage("en");
  assert.equal(venueName(name), "Wanda Cinema (CBD Wanda Plaza)");
  assert.match(venueAddress(name, address), /93 Jianguo Road/);
  assert.equal(venueAddress(name, "新地址"), "新地址");
  assert.equal(filmTitle("牛来 (Niu Lai)"), "Niu Lai");
  setLanguage("zh");
  assert.equal(venueName(name), name);
  assert.equal(venueAddress(name, address), address);
  assert.equal(auditoriumName("Catalogue Demo 2"), "片库演示2 号厅");
  assert.equal(auditoriumName("Blue Room"), "Blue Room");
  assert.equal(districtLabel({ admin_code: "110101", name: "Dongcheng" }), "东城区");
  setLanguage("en");
});

test("workspace errors retain input limits and can switch back to the server message", () => {
  const message = "reason length must be 1..500";
  setLanguage("zh");
  assert.equal(apiMessage("VALIDATION", message), "原因长度须为 1 至 500 个字符。");
  assert.match(apiMessage("SCHEDULE_OVERLAP", "Screen is occupied"), /15 分钟/);
  setLanguage("en");
  assert.equal(apiMessage("VALIDATION", message), message);
});
