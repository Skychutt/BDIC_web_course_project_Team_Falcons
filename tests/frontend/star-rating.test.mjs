import test from "node:test";
import assert from "node:assert/strict";
import { stars, starPicker } from "../../cinema/static/js/star-rating.js";

test("five-star picker writes the established ten-point scale", () => {
  const html = starPicker(8);
  assert.equal((html.match(/type="radio"/g) || []).length, 5);
  assert.match(html, /value="8" aria-label="4 stars" checked/);
  assert.match(html, /value="10" aria-label="5 stars"/);
});

test("legacy odd ratings display half stars and are preserved until a new choice", () => {
  assert.match(stars(7), /3.5 out of 5 stars/);
  assert.match(stars(7), /--fill:50%/);
  assert.match(starPicker(7), /name="stars" value="7"/);
});

test("invalid scores cannot inject markup into star output", () => {
  assert.doesNotMatch(stars('<img onerror=alert(1)>'), /<img/);
  assert.match(stars(20), /5 out of 5 stars/);
  assert.match(stars(-4), /0 out of 5 stars/);
});
