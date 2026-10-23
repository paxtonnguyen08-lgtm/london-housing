import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS } from "../js/logic.js";
import { PLACES, STRETCH, boundsOf, mapPoints, priceBand } from "../js/mapdata.js";

const empty = () => ({ votes: {}, notes: {}, status: {}, budgets: {} });
const house = (key, extra = {}) => ({
  key, title: key, active: true, bedrooms: 4, est_cost_per_person: 1000, walk_min_huron: 20,
  utilities_included: "yes", lat: 43.0, lng: -81.27, ...extra,
});

test("priceBand compares cost with my budget", () => {
  assert.equal(priceBand(1000, 1100), "fits");
  assert.equal(priceBand(1100, 1100), "fits");
  assert.equal(priceBand(1100 + STRETCH, 1100), "stretch");
  assert.equal(priceBand(1100 + STRETCH + 1, 1100), "over");
  assert.equal(priceBand(null, 1100), "unknown");
  assert.equal(priceBand(1000, null), "unknown");
});

test("mapPoints pins filtered houses and counts the ones without a location", () => {
  const listings = [
    house("a"),
    house("b", { lat: null, lng: null }), // geocode was unreliable
    house("c", { active: false }), // gone from the site
    house("d", { bedrooms: 2 }), // filtered out by group size
  ];
  const { points, missing } = mapPoints(listings, { ...DEFAULT_FILTERS, groupSize: 4 }, empty(), { budget: 1050 });
  assert.deepEqual(points.map((p) => p.key), ["a"]);
  assert.deepEqual(missing, ["b"]);
  assert.equal(points[0].band, "fits");
});

test("mapPoints leaves out houses the group rejected", () => {
  const state = empty();
  state.status.a = { status: "rejected" };
  const { points } = mapPoints([house("a"), house("b")], DEFAULT_FILTERS, state, { budget: 1000 });
  assert.deepEqual(points.map((p) => p.key), ["b"]);
});

test("mapPoints marks likes and matches", () => {
  const state = empty();
  state.votes.a = { Paxton: "like", Jack: "like" };
  state.votes.b = { Paxton: "like" };
  const { points } = mapPoints([house("a"), house("b")], DEFAULT_FILTERS, state, { budget: 1000, members: ["Paxton", "Jack"] });
  const byKey = Object.fromEntries(points.map((p) => [p.key, p]));
  assert.equal(byKey.a.likes, 2);
  assert.equal(byKey.a.match, true);
  assert.equal(byKey.b.match, false);
});

test("boundsOf always includes campus and Huron", () => {
  const [[s, w], [n, e]] = boundsOf([{ lat: 42.98, lng: -81.25 }]);
  for (const p of PLACES) {
    assert.ok(p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e);
  }
  assert.equal(s, 42.98);
  assert.equal(e, -81.25);
});
