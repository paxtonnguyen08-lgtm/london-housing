import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_VOTES, amenitiesOf, budgetCheck, budgetLine, groupProfile, miseryFor, personProfile, readiness, similarity, suggest,
} from "../js/recommend.js";

// Made-up houses: everything defaults to a 4-bed Old North house, $1,000/person, utilities included.
const house = (key, o = {}) => ({
  key, title: key, active: true, bedrooms: 4, neighbourhood: "Old North", utilities_included: "yes",
  price_per_person: o.est_cost_per_person ?? 1000, est_cost_per_person: 1000, walk_min_huron: 12,
  amenities: ["Laundry", "Dishwasher"], lease_start: "2027-05-01", first_seen: "2026-10-20", ...o,
});
const cost = (key, c, o = {}) => house(key, { est_cost_per_person: c, ...o });

// votes: { houseKey: { member: "like" | "pass" } }
const stateOf = (votes, budgets = {}) => ({ votes, notes: {}, status: {}, budgets });
const byKey = (listings) => Object.fromEntries(listings.map((l) => [l.key, l]));
const titles = (ranked) => ranked.map((r) => r.listing.title);
const texts = (reasons) => reasons.map((r) => r.text);

test("revealed budget: the prices someone actually likes, vs what they said", () => {
  const listings = [cost("a", 1040), cost("b", 1060), cost("c", 1100), cost("d", 1150), cost("e", 990), cost("f", 900)];
  const s = stateOf({
    a: { Sam: "like" }, b: { Sam: "like" }, c: { Sam: "like" }, d: { Sam: "like" }, e: { Sam: "like" }, f: { Sam: "pass" },
  }, { Sam: 1000 });
  const sam = personProfile(s, "Sam", byKey(listings));
  assert.deepEqual(sam.revealed, { low: 990, high: 1150, median: 1060, count: 5, over: 4 });
  assert.equal(budgetLine(sam), "says $1,000 · likes $990–$1,150 (4 of 5 over)");

  assert.equal(budgetLine(personProfile(stateOf(s.votes), "Sam", byKey(listings))), "no budget set · likes $990–$1,150");
  assert.equal(budgetLine(personProfile(s, "Maya", byKey(listings))), "no budget set · no likes yet");
  const cheap = personProfile(stateOf({ e: { Sam: "like" } }, { Sam: 1000 }), "Sam", byKey(listings));
  assert.equal(budgetLine(cheap), "says $1,000 · likes $990 (all within budget)");
});

test("walk tolerance is the 80th percentile of liked walk times", () => {
  const listings = [10, 12, 15, 20, 30].map((w, i) => house(`h${i}`, { walk_min_huron: w }));
  const s = stateOf(Object.fromEntries(listings.map((l) => [l.key, { Sam: "like" }])));
  assert.equal(personProfile(s, "Sam", byKey(listings)).walkTolerance, 22); // 20 + (30 - 20) × 0.2
  const one = stateOf({ h0: { Sam: "like" } });
  assert.equal(personProfile(one, "Sam", byKey(listings)).walkTolerance, null, "one like isn't enough to tell");
});

test("like rates are Laplace-smoothed, so one vote doesn't dominate", () => {
  const listings = [
    house("o1"), house("o2"),
    house("s1", { neighbourhood: "Near South", amenities: ["Laundry", "Parking(2)"] }),
    house("s2", { neighbourhood: "Near South", amenities: ["Parking(1)"] }),
  ];
  // 2 likes and 2 passes overall, so the prior is exactly 50%: (likes + 1) / (votes + 2)
  const s = stateOf({ o1: { Sam: "like" }, o2: { Sam: "like" }, s1: { Sam: "pass" }, s2: { Sam: "pass" } });
  const sam = personProfile(s, "Sam", byKey(listings));
  assert.equal(sam.baseRate, 0.5);
  assert.equal(sam.neighbourhood["Old North"].rate, 3 / 4);
  assert.equal(sam.neighbourhood["Near South"].rate, 1 / 4);
  assert.equal(sam.amenities.Parking.rate, 1 / 4); // "Parking(2)" and "Parking(1)" are the same amenity
  assert.equal(sam.amenities.Laundry.rate, 3 / 5); // liked twice, passed once: (2 + 1) / (3 + 2)

  // Someone who likes nearly everything: a neighbourhood they liked every time still beats their average
  const keen = personProfile(stateOf({ o1: { Sam: "like" }, o2: { Sam: "like" } }), "Sam", byKey(listings));
  assert.ok(keen.neighbourhood["Old North"].rate > keen.baseRate);
});

test("amenities ignore parking counts and the utilities flag", () => {
  assert.deepEqual(amenitiesOf({ amenities: ["Laundry", "Parking(2)", "Parking(3)", "Utilities Incl", "A/C"] }), ["Laundry", "Parking", "A/C"]);
  assert.deepEqual(amenitiesOf({}), []);
});

test("similarity: 1 for the same house, lower as price, walk and neighbourhood drift apart", () => {
  const a = house("a");
  assert.equal(similarity(a, house("b")), 1);
  const pricier = similarity(a, cost("c", 1100)); // half a step: $100 is half of $200
  const elsewhere = similarity(a, house("d", { neighbourhood: "Near South" })); // a whole step
  assert.ok(pricier < 1 && pricier > elsewhere, `${pricier} vs ${elsewhere}`);
  assert.ok(similarity(a, house("e", { walk_min_huron: null })) < 1, "unknown walk counts as a small difference");
});

test("cold start: suggestions wait until everyone has about 5 votes", () => {
  assert.equal(MIN_VOTES, 5);
  const votes = {};
  for (let i = 0; i < 5; i++) votes[`h${i}`] = { Paxton: "like", ...(i < 3 ? { Jack: "pass" } : {}) };
  assert.deepEqual(readiness(stateOf(votes), ["Paxton", "Jack", "Tyler"]), {
    ready: false,
    needs: [{ member: "Jack", more: 2 }, { member: "Tyler", more: 5 }],
  });
  for (let i = 0; i < 5; i++) votes[`h${i}`] = { Paxton: "like", Jack: "pass", Tyler: "like" };
  assert.deepEqual(readiness(stateOf(votes), ["Paxton", "Jack", "Tyler"]), { ready: true, needs: [] });
  assert.equal(readiness(stateOf({}), []).ready, false);
});

// Two friends who like Old North around $1,000–$1,060 and pass on Near South.
const members = ["Paxton", "Jack"];
const liked = [cost("h1", 1040, { walk_min_huron: 10 }), cost("h2", 1060, { walk_min_huron: 12 }), cost("h3", 990, { walk_min_huron: 11 })];
const passed = [
  cost("p1", 1000, { neighbourhood: "Near South", walk_min_huron: 30 }),
  cost("p2", 1050, { neighbourhood: "Near South", walk_min_huron: 28 }),
];
const both = (v) => ({ Paxton: v, Jack: v });
const votes = { h1: both("like"), h2: both("like"), h3: both("like"), p1: both("pass"), p2: both("pass") };

test("houses like the ones you liked rank above similar-priced houses in a neighbourhood you passed on", () => {
  const good = cost("Good fit", 1010, { walk_min_huron: 11 });
  const southern = cost("Near South twin", 1000, { neighbourhood: "Near South", walk_min_huron: 11 });
  const listings = [...liked, ...passed, good, southern];
  assert.deepEqual(titles(suggest([southern, good], listings, stateOf(votes), members)), ["Good fit", "Near South twin"]);
});

test("a house a friend already liked ranks above an identical one nobody has voted on", () => {
  const charlieLiked = house("Charlie's pick");
  const fresh = house("Fresh");
  const listings = [...liked, ...passed, charlieLiked, fresh];
  const s = stateOf({ ...votes, "Charlie's pick": { Charlie: "like" } });
  const ranked = suggest([fresh, charlieLiked], listings, s, [...members, "Charlie"]);
  assert.deepEqual(titles(ranked), ["Charlie's pick", "Fresh"]);
  assert.equal(ranked[0].reasons[0].text, "Charlie liked it");
  assert.equal(ranked[0].reasons[0].tone, "good");
});

test("least misery: a house over one person's budget drops even though it fits everyone else best", () => {
  const favourite = cost("Favourite", 1050, { walk_min_huron: 11 });
  const fallback = cost("Fallback", 990, { neighbourhood: "Near West", walk_min_huron: 15 });
  const listings = [...liked, ...passed, favourite, fallback];

  const noBudgets = suggest([fallback, favourite], listings, stateOf(votes), members);
  assert.deepEqual(titles(noBudgets), ["Favourite", "Fallback"], "on taste alone it's the favourite");

  const ranked = suggest([fallback, favourite], listings, stateOf(votes, { Paxton: 1200, Jack: 1000 }), members);
  assert.deepEqual(titles(ranked), ["Fallback", "Favourite"]);
  const fav = ranked[1];
  assert.deepEqual(fav.misery.problems.map((p) => [p.member, p.kind, p.by]), [["Jack", "budget", 50]]);
  assert.deepEqual(fav.reasons.at(-1), { text: "$50 over Jack's budget", tone: "warn" });
});

test("least misery: a walk well past someone's usual walk counts against a house", () => {
  const near = [8, 10, 12].map((w, i) => house(`near${i}`, { walk_min_huron: w }));
  const far = [25, 30, 35].map((w, i) => house(`far${i}`, { walk_min_huron: w }));
  const s = stateOf({
    ...Object.fromEntries(near.map((l) => [l.key, { Jack: "like" }])),
    ...Object.fromEntries(far.map((l) => [l.key, { Paxton: "like" }])),
  });
  const listings = [...near, ...far];
  const profiles = members.map((m) => personProfile(s, m, byKey(listings)));
  assert.equal(profiles[1].walkTolerance, 11); // 10 + (12 - 10) × 0.6, rounded
  const misery = miseryFor(house("long", { walk_min_huron: 25 }), profiles);
  assert.deepEqual(misery.problems.map((p) => [p.member, p.kind, p.by]), [["Jack", "walk", 14]]);
  assert.equal(miseryFor(house("ok", { walk_min_huron: 16 }), profiles).problems.length, 0, "a few minutes over is fine");

  const [ranked] = suggest([house("long", { walk_min_huron: 25 })], listings, s, members);
  assert.deepEqual(ranked.reasons.at(-1), { text: "Further than Jack usually walks", tone: "warn" });
});

test("reason chips: 2–3 per house, strongest first", () => {
  const sunset = cost("1100 Sunset", 1100, { walk_min_huron: 13 });
  const listings = [
    sunset,
    cost("l2", 1040, { walk_min_huron: 16 }),
    cost("l3", 1150, { neighbourhood: "Near West", walk_min_huron: 20 }),
    cost("p1", 1000, { neighbourhood: "Near South", walk_min_huron: 30 }),
  ];
  const s = stateOf({
    "1100 Sunset": { Paxton: "like", Charlie: "like" }, l2: { Paxton: "like" }, l3: { Charlie: "like" }, p1: { Paxton: "pass", Charlie: "pass" },
  });
  const group = ["Paxton", "Charlie"];

  // Sweet spot: likes at $1,040, $1,100, $1,100, $1,150, so the middle is $1,100
  const twin = cost("Twin", 1070, { walk_min_huron: 13 });
  const [r] = suggest([twin], [...listings, twin], s, group);
  assert.deepEqual(texts(r.reasons), ["Similar to 1100 Sunset (2 liked)", "$30 under the group sweet spot", "13 min to Huron"]);

  // Nothing stands out: plain facts fill it up to two chips
  const odd = cost("Odd one", 1300, { neighbourhood: "Masonville", walk_min_huron: 18, amenities: ["A/C"] });
  const [o] = suggest([odd], [...listings, odd], s, group);
  assert.deepEqual(texts(o.reasons), ["Masonville", "18 min to Huron"]);
  // ...but a long walk is a heads-up, never a reason
  const far = cost("Far one", 1300, { neighbourhood: "Masonville", walk_min_huron: 40, amenities: ["A/C"] });
  const [f] = suggest([far], [...listings, far], s, group);
  assert.deepEqual(f.reasons, [{ text: "Masonville", tone: "" }, { text: "Further than any of you usually walk", tone: "warn" }]);
  const [all] = suggest([far], [...listings, far], { ...s, budgets: { Paxton: 1100, Charlie: 1200 } }, group);
  assert.equal(all.reasons.at(-1).text, "Over everyone's budget");

  // With a heads-up: two reasons, then the warning
  const over = cost("Over", 1080, { walk_min_huron: 13 });
  const [w] = suggest([over], [...listings, over], { ...s, budgets: { Charlie: 1050 } }, group);
  assert.equal(w.reasons.length, 3);
  assert.deepEqual(w.reasons[2], { text: "$30 over Charlie's budget", tone: "warn" });
});

test("houses without a price can't be scored and are left out", () => {
  const unknown = house("Unknown", { est_cost_per_person: null, price_per_person: null });
  assert.deepEqual(suggest([unknown, house("x")], [house("x"), unknown], stateOf({}), members).map((r) => r.listing.key), ["x"]);
});

test("budget check: ceiling is the lowest budget, and a sweet spot above someone's budget is flagged", () => {
  const listings = [cost("a", 1080), cost("b", 1100), cost("c", 1150)];
  const s = stateOf({
    a: { Paxton: "like", Jack: "like" }, b: { Paxton: "like", Sam: "like" }, c: { Paxton: "like", Sam: "like" },
  }, { Paxton: 1200, Jack: 1000, Sam: 1000 });
  const check = budgetCheck(listings, s, ["Paxton", "Jack", "Sam", "Tyler"]);
  assert.equal(check.ceiling, 1000);
  assert.deepEqual(check.ceilingBy, ["Jack", "Sam"]);
  // Middle half of the six likes: $1,080 ×2, $1,100 ×2, $1,150 ×2
  assert.deepEqual(check.sweetSpot, { low: 1085, median: 1100, high: 1138 });
  assert.deepEqual(check.flags, [{ member: "Jack", budget: 1000, by: 100 }, { member: "Sam", budget: 1000, by: 100 }]);
  assert.equal(check.people.find((p) => p.member === "Sam").line, "says $1,000 · likes $1,100–$1,150 (2 of 2 over)");
  assert.equal(check.people.find((p) => p.member === "Tyler").line, "no budget set · no likes yet");

  const fine = budgetCheck(listings, { ...s, budgets: { Paxton: 1200 } }, ["Paxton", "Jack"]);
  assert.deepEqual(fine.flags, []);
  assert.equal(budgetCheck([], stateOf({}), ["Paxton"]).ceiling, null);
});

test("group profile: the group's taste in one line, for alerts and search later", () => {
  const listings = [...liked, ...passed];
  const p = groupProfile(listings, stateOf(votes, { Paxton: 1200, Jack: 1000 }), members);
  assert.equal(p.summary, "4 bed, Old North, ~$1,040, ≤12 min to Huron");
  assert.deepEqual(p.neighbourhoods, ["Old North"]);
  assert.equal(p.ceiling, 1000);
  assert.equal(p.likes, 6);
  assert.equal(groupProfile([], stateOf({}), members).summary, "");
});
