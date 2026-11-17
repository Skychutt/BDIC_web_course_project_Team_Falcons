import test from "node:test";
import assert from "node:assert/strict";
import { ratingSummary } from "../../cinema/static/js/rating-distribution.js";

const snapshot = { score: "8.0", vote_count: 10, source_url: "https://movie.douban.com/subject/37365064/",
  checked_on: "2026-11-14", distribution: [{ stars: 5, percent: "50.0" }, { stars: 4, percent: "25.0" },
    { stars: 3, percent: "10.0" }, { stars: 2, percent: "5.0" }, { stars: 1, percent: "10.0" }] };
const data = (average, count, votes = [], source = snapshot, imported = source?.vote_count || 0) => ({
  film: { rating: { average, count } }, votes, rating_snapshot: source, imported_votes: imported,
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("initial score and all five percentages use the published snapshot", () => {
  const result = ratingSummary(data("8.0", 10));
  assert.equal(result.average, 8);
  assert.equal(result.count, 10);
  assert.deepEqual(result.distribution.map(row => row.percent), [50, 25, 10, 5, 10]);
  assert.ok(result.distribution.every(row => !("count" in row)), "No fabricated exact source bucket counts");
});

test("a new five-star rating joins the source sample and changes every percentage", () => {
  const result = ratingSummary(data("8.2", 11, [{ stars: 10, count: 1 }]));
  assert.equal(result.average, 8.2);
  assert.equal(result.count, 11);
  [600 / 11, 250 / 11, 100 / 11, 50 / 11, 100 / 11].forEach((p, i) => close(result.distribution[i].percent, p));
  close(result.distribution.reduce((sum, row) => sum + row.percent, 0), 100);
});

test("editing a rating moves its weight without adding another vote", () => {
  const before = ratingSummary(data("8.2", 11, [{ stars: 10, count: 1 }]));
  const after = ratingSummary(data("7.6", 11, [{ stars: 4, count: 1 }]));
  assert.equal(after.count, before.count);
  close(before.distribution[0].percent - after.distribution[0].percent, 100 / 11);
  close(after.distribution[3].percent - before.distribution[3].percent, 100 / 11);
  assert.equal(after.average, 7.6);
});

test("millions of source votes retain a new vote even when displayed precision stays the same", () => {
  const source = { ...snapshot, score: "9.4", vote_count: 2239064,
    distribution: [76.1, 19.7, 3.6, 0.4, 0.2].map((percent, i) => ({ stars: 5 - i, percent })) };
  const result = ratingSummary(data("9.4", 2239065, [{ stars: 10, count: 1 }], source));
  assert.equal(result.count, 2239065);
  assert.ok(result.distribution[0].percent > 76.1);
  assert.equal(result.distribution[0].percent.toFixed(1), "76.1");
});

test("published rounding is preserved without inventing precision or mutating the source", () => {
  const source = { ...snapshot, distribution: [72.8, 23.3, 3.5, 0.2, 0.1].map((percent, i) => ({ stars: 5 - i, percent })) };
  const original = structuredClone(source);
  assert.deepEqual(ratingSummary(data("9.4", 10, [], source)).distribution, source.distribution);
  ratingSummary(data("9.4", 11, [{ stars: 10, count: 1 }], source));
  assert.deepEqual(source, original);
});

test("no ratings shows an empty distribution and local-only votes retain half-star scores", () => {
  const empty = ratingSummary(data(null, 0, [], null));
  assert.equal(empty.average, null);
  assert.ok(empty.distribution.every(row => row.percent === null));
  const result = ratingSummary(data("8.0", 3, [{ stars: 7, count: 2 }, { stars: 10, count: 1 }], null));
  assert.equal(result.average, 8);
  close(result.distribution[1].percent, 200 / 3);
  assert.equal(result.distribution[4].percent, 0);
});

test("a legacy total without a published histogram does not pretend local votes are the full sample", () => {
  const result = ratingSummary(data("7.4", 101, [{ stars: 10, count: 1 }], null, 100));
  assert.equal(result.average, 7.4);
  assert.equal(result.count, 101);
  assert.equal(result.hasDistribution, false);
  assert.ok(result.distribution.every(row => row.percent === null));
});
