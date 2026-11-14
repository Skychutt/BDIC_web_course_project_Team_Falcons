import test from "node:test";
import assert from "node:assert/strict";
import { ratingSummary } from "../../cinema/static/js/rating-distribution.js";

const data = { film: { rating: { average: 6.6, count: 6085 } }, votes: [{ stars: 10, count: 1 }],
  rating_snapshot: { score: "6.6", vote_count: 7456, source_url: "https://movie.douban.com/subject/37365064/",
    checked_on: "2026-11-14", distribution: [{ stars: 5, percent: "10.6" }, { stars: 4, percent: "27.6" },
      { stars: 3, percent: "47.1" }, { stars: 2, percent: "12.6" }, { stars: 1, percent: "2.1" }] } };

test("external score, count and published percentages use the same snapshot", () => {
  const result = ratingSummary(data);
  assert.equal(result.average, 6.6);
  assert.equal(result.count, 7456);
  assert.equal(result.distribution[0].percent, 10.6);
  assert.ok(result.distribution.every(row => !("count" in row)), "Do not fabricate exact source bucket counts");
});

test("local votes update independently from imported scores", () => {
  const result = ratingSummary(data, "falcons");
  assert.equal(result.average, 10);
  assert.equal(result.count, 1);
  assert.deepEqual(result.distribution[0], { stars: 5, percent: 100, count: 1 });
  assert.equal(result.distribution[1].percent, 0);
  assert.equal(ratingSummary(data).count, 7456);
});

test("missing external details and no local votes never imply a zero-percent sample", () => {
  const result = ratingSummary({ ...data, rating_snapshot: null, votes: [] });
  assert.equal(result.source, "falcons");
  assert.equal(result.average, null);
  assert.ok(result.distribution.every(row => row.percent === null));
});

test("historical half-stars retain their value in the local average", () => {
  const result = ratingSummary({ votes: [{ stars: 7, count: 2 }, { stars: 10, count: 1 }] }, "falcons");
  assert.equal(result.average, 8);
  assert.equal(result.count, 3);
  assert.equal(result.distribution[1].count, 2);
  assert.ok(Math.abs(result.distribution[1].percent - 200 / 3) < 1e-10);
});
