import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_COMPARE, bestOf, compareRows, togglePick } from "../js/compare.js";

const house = (key, extra = {}) => ({
  key, title: key, active: true, bedrooms: 5, baths: 2, price_per_person: 800, est_cost_per_person: 900,
  utilities_included: "no", walk_min_huron: 20, heads_up: [], ...extra,
});
const empty = () => ({ votes: {}, notes: {}, status: {}, budgets: {}, scorecards: {} });
const members = ["Paxton", "Charlie", "Xavier", "Jack", "Tyler"];
const card = (ratings, extra = {}) => ({ ratings, lease_ok: null, deposit_asked: null, note: "", ...extra });
const rowOf = (rows, id) => rows.find((r) => r.id === id);
const bestCols = (row) => row.cells.map((c, i) => (c.best ? i : null)).filter((i) => i !== null);

test("bestOf: lowest or highest wins, and ties for best all count", () => {
  assert.deepEqual(bestOf([950, 900, 1000]), [1]);
  assert.deepEqual(bestOf([950, 900, 1000], "high"), [2]);
  assert.deepEqual(bestOf([900, 1000, 900]), [0, 2]);
});

test("bestOf: nothing is picked out for a tie across the board or a lone value", () => {
  assert.deepEqual(bestOf([900, 900, 900]), []);
  assert.deepEqual(bestOf([900, null, 900]), []);
  assert.deepEqual(bestOf([null, 4.2, undefined], "high"), []);
  assert.deepEqual(bestOf([]), []);
  assert.deepEqual(bestOf([NaN, 3, 4]), [1]); // a broken number is ignored, not a win
});

test("cost, walk and utilities: cheapest, closest, and included win", () => {
  const houses = [
    house("a", { est_cost_per_person: 950, walk_min_huron: 12, utilities_included: "yes", price_per_person: 950 }),
    house("b", { est_cost_per_person: 900, walk_min_huron: 25 }),
    house("c", { est_cost_per_person: 1000, walk_min_huron: 12, utilities_included: "unknown" }),
  ];
  const rows = compareRows(houses, empty(), members);
  assert.deepEqual(bestCols(rowOf(rows, "cost")), [1]);
  assert.equal(rowOf(rows, "cost").cells[1].text, "$900");
  assert.deepEqual(bestCols(rowOf(rows, "walk")), [0, 2]);
  assert.equal(rowOf(rows, "walk").cells[0].text, "12 min");
  assert.deepEqual(bestCols(rowOf(rows, "utilities")), [0]);
  assert.deepEqual(rowOf(rows, "utilities").cells.map((c) => c.text), ["Included", "About $100 extra", "Not stated"]);
});

test("bedrooms: closest to the group size wins, not the most", () => {
  const houses = [house("a", { bedrooms: 6 }), house("b", { bedrooms: 5 }), house("c", { bedrooms: 4 })];
  const row = rowOf(compareRows(houses, empty(), members), "bedrooms");
  assert.deepEqual(bestCols(row), [1]);
  assert.equal(row.hint, "best is 5, one each");
  // 4 and 6 are equally far from 5
  assert.deepEqual(bestCols(rowOf(compareRows([houses[0], houses[2]], empty(), members), "bedrooms")), []);
  // without a group there's nothing to be closest to
  assert.deepEqual(bestCols(rowOf(compareRows(houses, empty(), []), "bedrooms")), []);
});

test("bathrooms: fewest people per bathroom wins", () => {
  const houses = [house("a", { bedrooms: 5, baths: 2 }), house("b", { bedrooms: 4, baths: 2 }), house("c", { baths: null })];
  const row = rowOf(compareRows(houses, empty(), members), "bathrooms");
  assert.deepEqual(bestCols(row), [1]);
  assert.equal(row.cells[0].sub, "2.5 people per bathroom");
  assert.equal(row.cells[2].text, "–");
});

test("group likes and scorecard averages: highest wins", () => {
  const state = empty();
  state.votes = { a: { Paxton: "like", Jack: "like" }, b: { Paxton: "like", Tyler: "pass" } };
  state.scorecards = {
    a: { Paxton: card({ kitchen: 2, noise: 4 }), Jack: card({ kitchen: 3 }) },
    b: { Tyler: card({ kitchen: 5 }) },
  };
  const rows = compareRows([house("a"), house("b"), house("c")], state, members);
  assert.deepEqual(rowOf(rows, "likes").cells.map((c) => c.text), ["2 of 5", "1 of 5", "0 of 5"]);
  assert.deepEqual(bestCols(rowOf(rows, "likes")), [0]);

  const kitchen = rowOf(rows, "kitchen");
  assert.deepEqual(kitchen.cells.map((c) => c.text), ["2.5", "5.0", "–"]);
  assert.deepEqual(bestCols(kitchen), [1]);
  // noise: only house a has a rating, so no winner
  assert.deepEqual(bestCols(rowOf(rows, "noise")), []);
  // items nobody rated don't get a row
  assert.equal(rowOf(rows, "heating"), undefined);

  const score = rowOf(rows, "score");
  assert.deepEqual(score.cells.map((c) => c.text), ["3.3 / 5", "5.0 / 5", "–"]); // a: (2.5 + 4) / 2
  assert.deepEqual(score.cells.map((c) => c.sub), ["2 scorecards", "1 scorecard", "No scorecards yet"]);
  assert.deepEqual(bestCols(score), [1]);
});

test("low averages are flagged, and the damage deposit is a red flag, never a winner", () => {
  const state = empty();
  state.scorecards = {
    a: { Charlie: card({ damp: 1 }, { deposit_asked: true, lease_ok: false }), Jack: card({}, { deposit_asked: true }) },
    b: { Xavier: card({ damp: 4 }, { deposit_asked: false, lease_ok: true }) },
  };
  const rows = compareRows([house("a"), house("b")], state, members);
  assert.equal(rowOf(rows, "damp").cells[0].tone, "warn");
  assert.equal(rowOf(rows, "damp").cells[1].tone, undefined);
  const deposit = rowOf(rows, "deposit_asked");
  assert.deepEqual(deposit.cells.map((c) => [c.text, c.tone]), [["Yes", "bad"], ["No", undefined]]);
  assert.equal(deposit.cells[0].sub, "Said by Charlie and Jack");
  assert.deepEqual(bestCols(deposit), []);
  const lease = rowOf(rows, "lease_ok");
  assert.deepEqual(lease.cells.map((c) => c.text), ["0 of 1 yes", "1 of 1 yes"]);
  assert.deepEqual(bestCols(lease), [1]);
});

test("yes/no rows only appear once someone answered them; heads-ups are listed", () => {
  const houses = [house("a", { heads_up: ["Some bedrooms in the basement"] }), house("b")];
  const rows = compareRows(houses, empty(), members);
  assert.equal(rowOf(rows, "lease_ok"), undefined);
  assert.equal(rowOf(rows, "deposit_asked"), undefined);
  const heads = rowOf(rows, "heads_up");
  assert.deepEqual(heads.cells[0].list, ["Some bedrooms in the basement"]);
  assert.equal(heads.cells[1].text, "None");
  assert.deepEqual(rows.map((r) => r.group), [...rows.map((r) => r.group)].sort((x, y) =>
    ["basics", "group", "headsup"].indexOf(x) - ["basics", "group", "headsup"].indexOf(y))); // grouped in order
});

test("togglePick: pick, unpick, and at most 3", () => {
  let p = togglePick([], "a");
  assert.deepEqual(p, { picks: ["a"], full: false });
  p = togglePick(togglePick(p.picks, "b").picks, "c");
  assert.deepEqual(p.picks, ["a", "b", "c"]);
  assert.deepEqual(togglePick(p.picks, "d"), { picks: ["a", "b", "c"], full: true });
  assert.deepEqual(togglePick(p.picks, "b").picks, ["a", "c"]);
  assert.equal(MAX_COMPARE, 3);
});
