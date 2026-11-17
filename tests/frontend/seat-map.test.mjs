import test from "node:test";
import assert from "node:assert/strict";
import { seatGeometry } from "../../cinema/static/js/seat-map.js";

test("cross aisles keep their own track instead of collapsing between numbered rows", () => {
  const result = seatGeometry([{ row_no: 1, map_x: 2, map_y: 0 }, { row_no: 2, map_x: 6, map_y: 2 }]);
  assert.equal(result.columns, 7);
  assert.equal(result.columnTracks.split(" ").filter(x => x === "var(--aisle-width)").length, 5);
  assert.equal(result.rowTracks, "var(--seat-height) var(--cross-aisle-height) var(--seat-height)");
  assert.deepEqual(result.labels, [{ y: 0, label: 1 }, { y: 2, label: 2 }]);
});

test("rotated custom layouts do not mislabel several logical rows as one row", () => {
  const result = seatGeometry([{ row_no: 1, map_x: 0, map_y: 0 }, { row_no: 2, map_x: 1, map_y: 0 }]);
  assert.equal(result.labels[0].label, "");
  assert.equal(seatGeometry([]).columns, 0);
});
