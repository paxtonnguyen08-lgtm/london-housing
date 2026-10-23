import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRows } from "../js/compare.js";
import { cleanScorecard, scorecardSummary } from "../js/scorecard.js";
import { compareHtml, pickRow, scorecardFormHtml, scorecardGroupHtml } from "../js/viewing-ui.js";

const EVIL = '<img src=x onerror="alert(1)">';
const house = (key, extra = {}) => ({
  key, title: key, bedrooms: 5, baths: 2, price_per_person: 900, est_cost_per_person: 900,
  utilities_included: "yes", walk_min_huron: 15, heads_up: [], images: [], ...extra,
});

test("the group's scorecards can't inject markup through names or notes", () => {
  const cards = { [EVIL]: { ...cleanScorecard({ ratings: { kitchen: 4 }, deposit_asked: true, note: EVIL }), at: "t" } };
  const html = scorecardGroupHtml(scorecardSummary(cards, []));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.match(html, /asked for a damage deposit/);
  assert.equal(scorecardGroupHtml(scorecardSummary({}, ["Paxton"])), ""); // nothing yet: nothing shown
});

test("my scorecard form shows my answers and escapes my note", () => {
  const html = scorecardFormHtml(cleanScorecard({ ratings: { noise: 2 }, deposit_asked: true, note: `</textarea>${EVIL}` }), { dirty: true });
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("</textarea><"));
  assert.match(html, /class="sc-num on" data-score="noise" data-value="2" aria-pressed="true"/);
  assert.match(html, /class="pill on bad" data-check="deposit_asked" data-value="yes"/);
  assert.match(html, /allowed in Ontario/);
  assert.doesNotMatch(html, /data-score-save disabled/);
  // Nothing changed yet: Save is greyed out and the "not saved" line is hidden
  const clean = scorecardFormHtml(cleanScorecard(), { dirty: false });
  assert.match(clean, /data-score-save disabled/);
  assert.match(clean, /data-score-unsaved [^>]*hidden/);
  assert.doesNotMatch(clean, /Ontario/);
});

test("compare and pick rows escape house titles and heads-ups, and mark the best cells", () => {
  const houses = [house("a", { title: EVIL, heads_up: [EVIL] }), house("b", { est_cost_per_person: 800 })];
  const html = compareHtml(houses, compareRows(houses, { votes: {}, scorecards: {} }, ["Paxton"]));
  assert.ok(!html.includes("<img"));
  assert.match(html, /data-open="b"/);
  assert.equal((html.match(/cmp-cell best/g) || []).length, 1); // only the cheaper house's cost
  assert.match(html, /\(best\)/); // screen readers hear it too
  const row = pickRow(house(EVIL), 2);
  assert.ok(!row.includes("<img"));
  assert.match(row, /pick-mark on" aria-hidden="true">2</);
  assert.match(pickRow(house("c"), 0), /aria-pressed="false"/);
});
