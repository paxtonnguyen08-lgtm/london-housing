// Phase 4: learn what the group likes from everyone's likes and passes. Pure functions: no page,
// no storage. Everything here is covered by tests/recommend.test.js.
//
// With a few dozen votes this is a smart, explainable sort, not magic, so every suggestion comes
// with the reasons it ranked where it did.
import { costOf, money, percentile, sweetSpotOf, votesFor, walkLabel, walkOf } from "./logic.js";

export const MIN_VOTES = 5; // votes each person needs before suggestions switch on
const K = 3; // how many of someone's closest liked (and passed) houses a house is compared with
const WALK_SLACK = 5; // minutes past someone's usual walk before it counts against a house
const SIMILAR = 0.4; // similarity needed for a "Similar to ..." reason

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const byKeyOf = (listings) => Object.fromEntries(listings.map((l) => [l.key, l]));
const utilitiesOf = (l) => l.utilities_included || "unknown";

// "Parking(2)" -> "Parking". Utilities are a feature of their own, so "Utilities Incl" is left out.
// Remembered per listing, since scoring compares every house with every voted one.
const amenityCache = new WeakMap();
export function amenitiesOf(l) {
  if (!amenityCache.has(l)) {
    const names = (l.amenities || []).map((a) => String(a).replace(/\s*\(\d+\)\s*$/, "").trim());
    amenityCache.set(l, [...new Set(names)].filter((a) => a && !/^utilities incl/i.test(a)));
  }
  return amenityCache.get(l);
}

// ---------- readiness (cold start) ----------

// Suggestions switch on once everyone has voted on MIN_VOTES houses. Until then: who needs how many more.
export function readiness(state, members, min = MIN_VOTES) {
  const count = (m) => Object.values(state.votes).filter((v) => v[m]).length;
  const needs = members.map((m) => ({ member: m, more: Math.max(0, min - count(m)) })).filter((x) => x.more > 0);
  return { ready: members.length > 0 && needs.length === 0, needs };
}

// ---------- one person's profile ----------

// Laplace smoothing so one vote doesn't make a neighbourhood 100% or 0%: (likes + 1) / (votes + 2)
// with the default 50% prior. A profile passes the person's own overall like rate as the prior, so
// for someone who likes most houses, a neighbourhood they've barely seen doesn't look below average.
const smooth = (likes, votes, prior = 0.5) => (likes + 2 * prior) / (votes + 2);

// Like rate for each value of a feature (each neighbourhood, each amenity...).
function rates(liked, passed, valuesOf, prior) {
  const counts = {};
  const add = (l, like) => {
    for (const v of valuesOf(l)) {
      const c = (counts[v] ||= { likes: 0, votes: 0 });
      c.votes += 1;
      if (like) c.likes += 1;
    }
  };
  liked.forEach((l) => add(l, true));
  passed.forEach((l) => add(l, false));
  for (const c of Object.values(counts)) c.rate = smooth(c.likes, c.votes, prior);
  return counts;
}

// The houses one person liked and passed (skipping houses we don't have a price for).
export function votesOf(state, member, byKey) {
  const liked = [], passed = [];
  for (const [key, v] of Object.entries(state.votes)) {
    const l = byKey[key];
    if (!l || costOf(l) === null) continue;
    if (v[member] === "like") liked.push(l);
    else if (v[member] === "pass") passed.push(l);
  }
  return { liked, passed };
}

// What someone's votes say they want: the prices they actually like (their "revealed budget"),
// how far they'll walk, and how often they like each neighbourhood, utilities option and amenity.
export function personProfile(state, member, byKey) {
  const { liked, passed } = votesOf(state, member, byKey);
  const budget = state.budgets?.[member];
  const stated = typeof budget === "number" && budget > 0 ? budget : null;
  const costs = liked.map(costOf).sort((a, b) => a - b);
  const walks = liked.map(walkOf).filter((w) => w !== null).sort((a, b) => a - b);
  const baseRate = smooth(liked.length, liked.length + passed.length);
  return {
    member,
    stated,
    liked,
    passed,
    revealed: costs.length
      ? {
          low: costs[0], high: costs.at(-1), median: percentile(costs, 0.5), count: costs.length,
          over: stated ? costs.filter((c) => c > stated).length : 0,
        }
      : null,
    // 80th percentile of liked walk times: most of what they like is at least this close
    walkTolerance: walks.length >= 2 ? percentile(walks, 0.8) : null,
    baseRate,
    neighbourhood: rates(liked, passed, (l) => (l.neighbourhood ? [l.neighbourhood] : []), baseRate),
    utilities: rates(liked, passed, (l) => [utilitiesOf(l)], baseRate),
    amenities: rates(liked, passed, amenitiesOf, baseRate),
  };
}

// ---------- how alike two houses are ----------

function overlap(a, b) {
  const B = new Set(b);
  const union = new Set([...a, ...b]).size;
  return union ? a.filter((x) => B.has(x)).length / union : 1;
}

const monthIndex = (iso) => {
  const [y, m] = (iso || "").split("-").map(Number);
  return y && m ? y * 12 + m : null;
};

// Difference in "steps"; a missing value on either side counts as half a step.
const gap = (x, y, step) => (x === null || x === undefined || y === null || y === undefined ? 0.5 : (x - y) / step);

// 1 for identical houses, falling towards 0. Each of these is one step apart: $200 a person,
// 10 min more walk, 2 bedrooms, another neighbourhood, no amenities in common, 4 months' later start.
export function similarity(a, b) {
  const steps = [
    gap(costOf(a), costOf(b), 200),
    gap(walkOf(a), walkOf(b), 10),
    gap(a.bedrooms, b.bedrooms, 2),
    a.neighbourhood && a.neighbourhood === b.neighbourhood ? 0 : 1,
    utilitiesOf(a) === utilitiesOf(b) ? 0 : 0.5,
    1 - overlap(amenitiesOf(a), amenitiesOf(b)),
    gap(monthIndex(a.lease_start), monthIndex(b.lease_start), 4),
  ];
  return Math.exp(-Math.hypot(...steps));
}

// k-nearest neighbours: average similarity to the K closest houses in a list, plus the closest one.
function nearest(house, list) {
  const top = list
    .filter((l) => l.key !== house.key)
    .map((l) => ({ listing: l, sim: similarity(house, l) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, K);
  return { sim: top.length ? top.reduce((s, x) => s + x.sim, 0) / top.length : 0, closest: top[0] || null };
}

// ---------- scoring ----------

// How well a house fits one person's profile, from about -1 (bad) to +0.5 (good).
function profileFit(house, p) {
  const cost = costOf(house), walk = walkOf(house);
  // Price is judged against what they actually like once they've liked a couple, else what they said.
  const target = p.revealed?.count >= 2 ? p.revealed.median : p.stated;
  const price = target ? clamp((target - cost) / 200, -1, 0.5) : 0;
  const walkFit = p.walkTolerance !== null && walk !== null ? clamp((p.walkTolerance - walk) / 10, -1, 0.5) : 0;
  // Lift = how much more often than usual they like houses with these values (unseen values: 0)
  const lift = (table, values) => {
    const seen = values.filter((v) => table[v]);
    if (!seen.length) return 0;
    return clamp((2 * seen.reduce((s, v) => s + table[v].rate - p.baseRate, 0)) / seen.length, -1, 1);
  };
  return 0.35 * price + 0.25 * walkFit
    + 0.2 * lift(p.neighbourhood, house.neighbourhood ? [house.neighbourhood] : [])
    + 0.1 * lift(p.utilities, [utilitiesOf(house)])
    + 0.1 * lift(p.amenities, amenitiesOf(house));
}

// One person's score for a house they haven't voted on: similar to their likes, unlike their
// passes, and a good fit for their profile. About -1 to +1.
export function personScore(house, p) {
  const like = nearest(house, p.liked);
  const pass = nearest(house, p.passed);
  return { score: 0.5 * (like.sim - pass.sim) + 0.5 * profileFit(house, p), closest: like.closest };
}

// Least misery: a group lease only works if it works for everyone, so a house over anyone's stated
// budget, or well past how far anyone has shown they'll walk, gets pushed down hard.
export function miseryFor(house, profiles) {
  const cost = costOf(house), walk = walkOf(house);
  const problems = [];
  for (const p of profiles) {
    if (p.stated && cost > p.stated) {
      const by = cost - p.stated;
      problems.push({ member: p.member, kind: "budget", by, penalty: 0.5 + Math.min(0.5, by / 100) });
    }
    if (p.walkTolerance !== null && walk !== null && walk > p.walkTolerance + WALK_SLACK) {
      const by = walk - p.walkTolerance;
      problems.push({ member: p.member, kind: "walk", by, penalty: 0.3 + Math.min(0.4, (by - WALK_SLACK) / 20) });
    }
  }
  return { penalty: problems.reduce((s, x) => s + x.penalty, 0), problems };
}

// Group score = everyone's average (a vote someone already cast counts as +1 or -1) minus the misery.
export function groupScore(house, profiles, state) {
  const votes = state.votes[house.key] || {};
  const per = profiles.map((p) => {
    if (votes[p.member] === "like") return { member: p.member, score: 1, vote: "like" };
    if (votes[p.member] === "pass") return { member: p.member, score: -1, vote: "pass" };
    return { member: p.member, ...personScore(house, p) };
  });
  const average = per.length ? per.reduce((s, x) => s + x.score, 0) / per.length : 0;
  const misery = miseryFor(house, profiles);
  return { score: average - misery.penalty, average, per, misery };
}

// ---------- the group as a whole ----------

// Likes and votes per neighbourhood (or other feature) across everyone, with a plain 50% prior.
function pooled(profiles, field) {
  const out = {};
  for (const p of profiles) {
    for (const [v, c] of Object.entries(p[field])) {
      const o = (out[v] ||= { likes: 0, votes: 0 });
      o.likes += c.likes;
      o.votes += c.votes;
    }
  }
  for (const o of Object.values(out)) o.rate = smooth(o.likes, o.votes);
  return out;
}

function groupContext(listings, state, members) {
  const byKey = byKeyOf(listings);
  const profiles = members.map((m) => personProfile(state, m, byKey));
  const budgets = profiles.filter((p) => p.stated).map((p) => p.stated);
  const tolerances = profiles.map((p) => p.walkTolerance).filter((t) => t !== null);
  const liked = new Map(profiles.flatMap((p) => p.liked).map((l) => [l.key, l]));
  return {
    state,
    members,
    profiles,
    liked: [...liked.values()], // every house at least one person liked, once each
    sweetSpot: sweetSpotOf(listings, state),
    ceiling: budgets.length ? Math.min(...budgets) : null,
    shortestWalk: tolerances.length ? Math.min(...tolerances) : null, // the strictest walk tolerance
    neighbourhood: pooled(profiles, "neighbourhood"),
    utilities: pooled(profiles, "utilities"),
  };
}

const names = (list) => (list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);
const everyone = (list, ctx) => ctx.members.length > 1 && list.length === ctx.members.length;

// 2–3 short reasons for a suggestion, strongest first, plus a heads-up if it doesn't work for someone.
// Each is { text, tone } where tone is "good", "warn" or "" (plain).
export function reasonsFor(house, scored, ctx) {
  const good = [];
  const add = (text, strength, tone = "") => good.push({ text, strength, tone });
  const cost = costOf(house), walk = walkOf(house);

  const likers = votesFor(ctx.state, house.key).likes.filter((m) => ctx.members.includes(m));
  if (likers.length) {
    add(likers.length <= 2 ? `${names(likers)} liked it` : `${likers.length} of you liked it`, 2 + likers.length, "good");
  }

  const similar = nearest(house, ctx.liked).closest;
  if (similar && similar.sim >= SIMILAR) {
    const n = votesFor(ctx.state, similar.listing.key).likes.filter((m) => ctx.members.includes(m)).length;
    add(`Similar to ${similar.listing.title} (${n} liked)`, 1 + similar.sim);
  }

  if (ctx.sweetSpot) {
    const diff = ctx.sweetSpot.median - cost;
    if (diff >= 10) add(`${money(diff)} under the group sweet spot`, 1 + Math.min(diff, 200) / 400);
    else if (diff > -10) add("Right at the group sweet spot", 1);
  } else if (ctx.ceiling && cost <= ctx.ceiling) {
    const diff = ctx.ceiling - cost;
    add(diff >= 10 ? `${money(diff)} under everyone's budget` : "Just fits everyone's budget", 0.9);
  }

  // A short walk: within everyone's usual walk, and 15 min at most (10 always counts)
  if (walk !== null && walk <= clamp(ctx.shortestWalk ?? 15, 10, 15)) add(walkLabel(house), walk <= 10 ? 1.1 : 0.8);

  const hood = ctx.neighbourhood[house.neighbourhood];
  if (hood && hood.votes >= 3 && hood.rate >= 0.6) add(`Group likes ${house.neighbourhood} (${hood.likes} of ${hood.votes})`, hood.rate);

  const { yes, no } = ctx.utilities;
  if (house.utilities_included === "yes" && yes && no && yes.rate - no.rate >= 0.15) add("Utilities included, which you tend to like", 0.6);

  const warn = [];
  const over = scored.misery.problems.filter((x) => x.kind === "budget");
  const far = scored.misery.problems.filter((x) => x.kind === "walk");
  if (over.length === 1) warn.push({ text: `${money(over[0].by)} over ${over[0].member}'s budget`, tone: "warn" });
  else if (over.length) warn.push({ text: everyone(over, ctx) ? "Over everyone's budget" : `Over budget for ${names(over.map((x) => x.member))}`, tone: "warn" });
  else if (far.length === 1) warn.push({ text: `Further than ${far[0].member} usually walks`, tone: "warn" });
  else if (far.length) warn.push({ text: everyone(far, ctx) ? "Further than any of you usually walk" : `Long walk for ${names(far.map((x) => x.member))}`, tone: "warn" });

  // Nothing stood out: fall back to plain facts so every suggestion still has two chips
  const facts = [house.neighbourhood, !far.length && walkLabel(house), Number.isFinite(house.bedrooms) && `${house.bedrooms} bed`];
  for (const fact of facts) {
    if (good.length + warn.length >= 2) break;
    if (fact && !good.some((r) => r.text === fact)) add(fact, 0);
  }

  return [
    ...good.sort((a, b) => b.strength - a.strength).slice(0, warn.length ? 2 : 3).map(({ text, tone }) => ({ text, tone })),
    ...warn,
  ];
}

// Rank houses (my swipe deck, say) for the whole group, best first, each with its reasons.
export function suggest(candidates, listings, state, members) {
  const ctx = groupContext(listings, state, members);
  return candidates
    .filter((l) => costOf(l) !== null)
    .map((l) => {
      const scored = groupScore(l, ctx.profiles, state);
      return { listing: l, ...scored, reasons: reasonsFor(l, scored, ctx) };
    })
    .sort((a, b) => b.score - a.score || (b.listing.first_seen || "").localeCompare(a.listing.first_seen || ""));
}

// ---------- budget reality check ----------

// "says $1,000 · likes $1,040–$1,150 (4 of 5 over)"
export function budgetLine(p) {
  const says = p.stated ? `says ${money(p.stated)}` : "no budget set";
  const r = p.revealed;
  if (!r) return `${says} · no likes yet`;
  const range = r.low === r.high ? money(r.low) : `${money(r.low)}–${money(r.high)}`;
  const over = !p.stated ? "" : r.over ? ` (${r.over} of ${r.count} over)` : " (all within budget)";
  return `${says} · likes ${range}${over}`;
}

// Each person's stated vs revealed budget, the realistic group ceiling (the lowest budget), the
// group sweet spot, and a flag for everyone whose budget the sweet spot is above.
export function budgetCheck(listings, state, members) {
  const { profiles, ceiling, sweetSpot } = groupContext(listings, state, members);
  return {
    people: profiles.map((p) => ({ member: p.member, stated: p.stated, revealed: p.revealed, line: budgetLine(p) })),
    ceiling,
    ceilingBy: ceiling === null ? [] : profiles.filter((p) => p.stated === ceiling).map((p) => p.member),
    sweetSpot,
    flags: sweetSpot
      ? profiles.filter((p) => p.stated && sweetSpot.median > p.stated)
          .map((p) => ({ member: p.member, budget: p.stated, by: sweetSpot.median - p.stated }))
      : [],
  };
}

// The group's taste in one small object, e.g. "4 bed, Old North/Near West, ~$1,050, ≤15 min to Huron".
// Meant for later: ranking which new listings deserve an alert, or briefing a search.
export function groupProfile(listings, state, members) {
  const ctx = groupContext(listings, state, members);
  const beds = {};
  for (const p of ctx.profiles) for (const l of p.liked) if (Number.isFinite(l.bedrooms)) beds[l.bedrooms] = (beds[l.bedrooms] || 0) + 1;
  const bedrooms = Object.keys(beds).length ? Number(Object.entries(beds).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]) : null;
  const neighbourhoods = Object.entries(ctx.neighbourhood)
    .filter(([, c]) => c.likes >= 2 && c.rate >= 0.5)
    .sort((a, b) => b[1].rate - a[1].rate || b[1].likes - a[1].likes)
    .slice(0, 3)
    .map(([n]) => n);
  const price = ctx.sweetSpot?.median ?? null;
  const summary = [
    bedrooms && `${bedrooms} bed`,
    neighbourhoods.length && neighbourhoods.join("/"),
    price && `~${money(price)}`,
    ctx.shortestWalk !== null && `≤${ctx.shortestWalk} min to Huron`,
  ].filter(Boolean).join(", ");
  return {
    bedrooms,
    neighbourhoods,
    sweetSpot: ctx.sweetSpot,
    ceiling: ctx.ceiling,
    maxWalk: ctx.shortestWalk,
    likes: ctx.profiles.reduce((s, p) => s + p.liked.length, 0),
    summary,
  };
}
