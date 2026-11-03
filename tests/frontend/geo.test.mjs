import test from "node:test";
import assert from "node:assert/strict";
import { cinemaPosition, distanceMetres, orderedCinemas } from "../../cinema/static/js/geo.js";

test("missing coordinates and wrong coordinate systems never become map pins", () => {
  for (const c of [{}, { latitude: null, longitude: null, coordinate_system: "GCJ02" },
    { latitude: 39, longitude: 116, coordinate_system: "WGS84" },
    { latitude: "bad", longitude: 116, coordinate_system: "GCJ02" }]) assert.equal(cinemaPosition(c), null);
  assert.deepEqual(cinemaPosition({ latitude: "39.9", longitude: "116.4", coordinate_system: "GCJ02" }), [116.4, 39.9]);
});
test("straight-line calculation has known scale and handles equal points", () => {
  assert.equal(distanceMetres([116, 39], [116, 39]), 0);
  assert.ok(Math.abs(distanceMetres([0, 0], [0, 1]) - 111195) < 1);
});
test("nearest sorting respects active/district filters and keeps unknown distances last", () => {
  const cinema = (id, lng, extra = {}) => ({ id, name: id, district_id: "1", is_active: true, coordinate_system: "GCJ02", latitude: 39.9, longitude: lng, ...extra });
  const values = [cinema("far", 117), cinema("unknown", null), cinema("near", 116.401), cinema("closed", 116.4, { is_active: false }), cinema("other", 116.4, { district_id: "2" })];
  const result = orderedCinemas(values, [116.4, 39.9], "1", true);
  assert.deepEqual(result.map((c) => c.id), ["near", "far", "unknown"]);
  assert.equal(result[2].distance, null);
  assert.ok(result[0].distance < 100);
  assert.ok(orderedCinemas(values, null).every((c) => c.distance === null));
});
