import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FILTERS, budgetFit, costOf, deckFor, filterListings, groupSummary, initials, isMatch,
  money, parseJoinHash, passesFilters, shareText, shortlist, sortListings, statusOf, votesFor, walkLabel, walkOf,
} from "../js/logic.js";

const { listings } = JSON.parse(readFileSync(new URL("../sample-listings.json", import.meta.url)));
const byTitle = (t) => listings.find((l) => l.title === t);
const empty = () => ({ votes: {}, notes: {}, status: {}, budgets: {} });
const members = ["Paxton", "Jordan", "Maya", "Sam"];

test("money and initials", () => {
  assert.equal(money(1150), "$1,150");
  assert.equal(money(999.6), "$1,000");
  assert.equal(money(null), "–");
  assert.equal(initials("Paxton Nguyen"), "PN");
  assert.equal(initials("sam"), "S");
});

test("cost includes the utilities estimate; walk prefers Huron", () => {
  assert.equal(costOf(byTitle("16 Mcdonald Ave")), 1000); // $900 + $100 utilities
  assert.equal(costOf(byTitle("1100 Sunset St")), 1150); // utilities included
  assert.equal(walkOf(byTitle("1100 Sunset St")), 13);
  assert.equal(walkOf({ walk_min_huron: null, walk_min_campus: 7 }), 7);
  assert.equal(walkLabel({ walk_min_huron: null, walk_min_campus: 7 }), "7 min to campus");
  assert.equal(walkLabel({}), "Walk time unknown");
});

test("default filters drop inactive, too far, and out-of-budget houses", () => {
  const kept = filterListings(listings).map((l) => l.title);
  assert.ok(!kept.includes("47 Cheapside St"), "inactive");
  assert.ok(!kept.includes("704 Waterloo St"), "47 min walk is over 45");
  assert.ok(kept.includes("1100 Sunset St"));
  assert.ok(kept.includes("Trott Drive")); // $1,250 is inside $700-$1,400
});

test("group size, budget, walk and utilities filters each work", () => {
  const f = (o) => ({ ...DEFAULT_FILTERS, ...o });
  assert.ok(filterListings(listings, f({ groupSize: 4 })).every((l) => l.bedrooms === 4));
  assert.ok(filterListings(listings, f({ maxBudget: 1000 })).every((l) => costOf(l) <= 1000));
  assert.ok(filterListings(listings, f({ minBudget: 1100 })).every((l) => costOf(l) >= 1100));
  assert.ok(filterListings(listings, f({ maxWalk: 15 })).every((l) => walkOf(l) <= 15));
  assert.ok(filterListings(listings, f({ utilitiesOnly: true })).every((l) => l.utilities_included === "yes"));
  assert.equal(passesFilters({ active: true, bedrooms: 4, est_cost_per_person: null }, f({})), false);
});

test("budget slider ends mean no limit: $1,400+ has no max, the bottom has no min", () => {
  const house = (cost) => ({ active: true, bedrooms: 4, est_cost_per_person: cost, walk_min_huron: 10, utilities_included: "yes" });
  const f = (o) => ({ ...DEFAULT_FILTERS, ...o });
  assert.equal(passesFilters(house(1450), f({ maxBudget: 1400 })), true); // slider at the top
  assert.equal(passesFilters(house(650), f({ minBudget: 700 })), true); // slider at the bottom
  assert.equal(passesFilters(house(1450), f({ maxBudget: 1300 })), false);
  assert.equal(passesFilters(house(1250), f({ maxBudget: 1300 })), true);
  assert.equal(passesFilters(house(650), f({ minBudget: 750 })), false);
  assert.equal(passesFilters(house(800), f({ minBudget: 750 })), true);
});

test("sorting by cost, walk, newest and votes", () => {
  const cost = sortListings(listings, "cost").map(costOf);
  assert.deepEqual(cost, [...cost].sort((a, b) => a - b));
  const walk = sortListings(listings, "walk").map(walkOf);
  assert.deepEqual(walk, [...walk].sort((a, b) => a - b));
  const newest = sortListings(listings, "newest").map((l) => l.first_seen);
  assert.deepEqual(newest, [...newest].sort().reverse());
  const s = empty();
  s.votes[byTitle("Trott Drive").key] = { Paxton: "like", Maya: "like" };
  s.votes[byTitle("1100 Sunset St").key] = { Paxton: "like" };
  const votes = sortListings(listings, "votes", s).map((l) => l.title);
  assert.deepEqual(votes.slice(0, 2), ["Trott Drive", "1100 Sunset St"]);
});

test("votes, matches and status", () => {
  const s = empty();
  const k = byTitle("1100 Sunset St").key;
  s.votes[k] = { Paxton: "like", Jordan: "like", Maya: "pass" };
  assert.deepEqual(votesFor(s, k), { likes: ["Jordan", "Paxton"], passes: ["Maya"] });
  assert.equal(isMatch(s, k, members), false);
  s.votes[k] = Object.fromEntries(members.map((m) => [m, "like"]));
  assert.equal(isMatch(s, k, members), true);
  assert.equal(isMatch(s, k, []), false);
  assert.equal(statusOf(s, k), "new");
  s.status[k] = { status: "viewing", by: "Paxton" };
  assert.equal(statusOf(s, k), "viewing");
});

test("deck hides my voted and rejected houses, newest first", () => {
  const s = empty();
  const all = deckFor(listings, s, "Paxton");
  assert.equal(all[0].first_seen, "2026-10-22");
  const sunset = byTitle("1100 Sunset St").key;
  const trott = byTitle("Trott Drive").key;
  s.votes[sunset] = { Paxton: "pass" };
  s.votes[trott] = { Jordan: "like" }; // someone else's vote doesn't hide it from me
  s.status[byTitle("221 Huron St").key] = { status: "rejected" };
  const keys = deckFor(listings, s, "Paxton").map((l) => l.key);
  assert.ok(!keys.includes(sunset));
  assert.ok(keys.includes(trott));
  assert.ok(!keys.includes(byTitle("221 Huron St").key));
  assert.equal(deckFor(listings, s, "Jordan").some((l) => l.key === trott), false);
});

test("shortlist puts matches first and leaves out rejected", () => {
  const s = empty();
  const a = byTitle("221 Huron St").key, b = byTitle("1100 Sunset St").key, c = byTitle("Trott Drive").key;
  s.votes[a] = { Paxton: "like", Jordan: "like", Maya: "like" };
  s.votes[b] = Object.fromEntries(members.map((m) => [m, "like"]));
  s.votes[c] = { Sam: "like" };
  s.status[c] = { status: "rejected" };
  assert.deepEqual(shortlist(listings, s, members).map((l) => l.key), [b, a]);
});

test("budget fit says under or over", () => {
  const l = byTitle("16 Mcdonald Ave"); // $1,000 with utilities
  assert.deepEqual(budgetFit(l, 1200), { diff: 200, over: false, text: "$200 under your budget" });
  assert.equal(budgetFit(l, 950).text, "$50 over your budget");
  assert.equal(budgetFit(l, null), null);
});

test("group summary: ceiling, sweet spot and counts", () => {
  const s = empty();
  assert.equal(groupSummary(listings, s, members, {}).sweetSpot, null);
  assert.equal(groupSummary(listings, s, members, {}).ceiling, null);
  s.votes[byTitle("16 Mcdonald Ave").key] = { Paxton: "like" }; // 1000
  s.votes[byTitle("221 Huron St").key] = { Paxton: "like", Jordan: "like" }; // 995 x2
  s.votes[byTitle("1100 Sunset St").key] = { Maya: "like", Sam: "pass" }; // 1150
  s.status[byTitle("1100 Sunset St").key] = { status: "viewing" };
  const sum = groupSummary(listings, s, members, { Paxton: 1200, Jordan: 1100, Maya: 1300 });
  assert.equal(sum.ceiling, 1100);
  assert.equal(sum.likedCount, 4);
  assert.deepEqual(sum.sweetSpot, { low: 995, median: 998, high: 1038 });
  assert.equal(sum.viewings, 1);
  assert.equal(sum.shortlist, 3);
  assert.equal(sum.matching, filterListings(listings).length);
});

test("join link parsing", () => {
  assert.equal(parseJoinHash("#join=hunt-2027"), "hunt-2027");
  assert.equal(parseJoinHash("#x=1&join=ABCD"), "ABCD");
  assert.equal(parseJoinHash("#join=a"), null); // too short
  assert.equal(parseJoinHash("#join=<script>"), null);
  assert.equal(parseJoinHash(""), null);
});

test("share text is one tidy line", () => {
  assert.equal(shareText(byTitle("1100 Sunset St")),
    "1100 Sunset St: $1,150/person, 5 bed, 13 min to Huron. https://offcampus.uwo.ca/Listings/Details/63800");
});

test("budget label says what the filter does", async () => {
  const { budgetLabel } = await import("../js/logic.js");
  assert.equal(budgetLabel(700, 1400), "Any price");
  assert.equal(budgetLabel(700, 1100), "Up to $1,100");
  assert.equal(budgetLabel(900, 1400), "$900+");
  assert.equal(budgetLabel(900, 1100), "$900–$1,100");
});
