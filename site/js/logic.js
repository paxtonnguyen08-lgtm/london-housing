// Pure functions: no page, no storage. Everything here is covered by tests/logic.test.js.

export const STATUSES = ["new", "interested", "contacted", "viewing", "rejected"];
export const STATUS_LABELS = {
  new: "New", interested: "Interested", contacted: "Contacted", viewing: "Viewing booked", rejected: "Rejected",
};

export function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return "$" + Math.round(n).toLocaleString("en-CA");
}

export function initials(name) {
  return (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// What one person actually pays per month, utilities estimate included.
export function costOf(l) {
  return l.est_cost_per_person ?? l.price_per_person ?? null;
}

// Walk time to Huron if we know it, otherwise to main campus.
export function walkOf(l) {
  return l.walk_min_huron ?? l.walk_min_campus ?? null;
}

export function walkLabel(l) {
  if (l.walk_min_huron != null) return `${l.walk_min_huron} min to Huron`;
  if (l.walk_min_campus != null) return `${l.walk_min_campus} min to campus`;
  return "Walk time unknown";
}

export function formatDate(iso) {
  if (!iso) return "Date unknown";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

// The budget slider's range. A handle pushed all the way to an end means "no limit that way".
export const BUDGET_SLIDER = { min: 700, max: 1400 };

export const DEFAULT_FILTERS = {
  groupSize: null, // null = any bedroom count
  minBudget: BUDGET_SLIDER.min,
  maxBudget: BUDGET_SLIDER.max,
  maxWalk: 45,
  utilitiesOnly: false,
};

// "Any price", "Up to $1,100", "$900+" or "$900–$1,100", matching what the filter really does.
export function budgetLabel(min, max) {
  const openLow = min <= BUDGET_SLIDER.min;
  const openHigh = max >= BUDGET_SLIDER.max;
  if (openLow && openHigh) return "Any price";
  if (openLow) return `Up to ${money(max)}`;
  if (openHigh) return `${money(min)}+`;
  return `${money(min)}–${money(max)}`;
}

export function passesFilters(l, f = DEFAULT_FILTERS) {
  if (!l.active) return false;
  if (f.groupSize && l.bedrooms !== f.groupSize) return false;
  const cost = costOf(l);
  if (cost === null) return false;
  if (f.minBudget > BUDGET_SLIDER.min && cost < f.minBudget) return false;
  if (f.maxBudget < BUDGET_SLIDER.max && cost > f.maxBudget) return false;
  const walk = walkOf(l);
  if (f.maxWalk && walk !== null && walk > f.maxWalk) return false;
  if (f.utilitiesOnly && l.utilities_included !== "yes") return false;
  return true;
}

export function filterListings(listings, f = DEFAULT_FILTERS) {
  return listings.filter((l) => passesFilters(l, f));
}

// --- group state helpers (state shape: see group.js) ---

export function votesFor(state, key) {
  const v = state.votes[key] || {};
  const likes = Object.keys(v).filter((m) => v[m] === "like").sort();
  const passes = Object.keys(v).filter((m) => v[m] === "pass").sort();
  return { likes, passes };
}

export function statusOf(state, key) {
  return state.status[key]?.status || "new";
}

export function isMatch(state, key, members) {
  if (!members.length) return false;
  const { likes } = votesFor(state, key);
  return members.every((m) => likes.includes(m));
}

const byNewest = (a, b) => (b.first_seen || "").localeCompare(a.first_seen || "");
const byCost = (a, b) => (costOf(a) ?? Infinity) - (costOf(b) ?? Infinity);
const byWalk = (a, b) => (walkOf(a) ?? Infinity) - (walkOf(b) ?? Infinity);

export function sortListings(listings, by, state) {
  const list = [...listings];
  const likes = (l) => (state ? votesFor(state, l.key).likes.length : 0);
  const cmp = {
    cost: (a, b) => byCost(a, b) || byNewest(a, b),
    walk: (a, b) => byWalk(a, b) || byCost(a, b),
    newest: (a, b) => byNewest(a, b) || byCost(a, b),
    votes: (a, b) => likes(b) - likes(a) || byCost(a, b),
  }[by] || ((a, b) => byCost(a, b));
  return list.sort(cmp);
}

// The swipe deck: houses that pass the filters, that I haven't voted on, and that nobody rejected.
export function deckFor(listings, state, me, f = DEFAULT_FILTERS) {
  return filterListings(listings, f)
    .filter((l) => !(state.votes[l.key] || {})[me])
    .filter((l) => statusOf(state, l.key) !== "rejected")
    .sort((a, b) => byNewest(a, b) || byCost(a, b));
}

// Shortlist: anything at least one person liked and nobody rejected. Matches first, then most likes.
export function shortlist(listings, state, members) {
  return listings
    .filter((l) => l.active && votesFor(state, l.key).likes.length > 0 && statusOf(state, l.key) !== "rejected")
    .sort((a, b) =>
      Number(isMatch(state, b.key, members)) - Number(isMatch(state, a.key, members)) ||
      votesFor(state, b.key).likes.length - votesFor(state, a.key).likes.length ||
      byCost(a, b));
}

export function budgetFit(l, budget) {
  const cost = costOf(l);
  if (cost === null || !budget) return null;
  const diff = budget - cost;
  return {
    diff,
    over: diff < 0,
    text: diff >= 0 ? `${money(diff)} under your budget` : `${money(-diff)} over your budget`,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}

// Home tab numbers. Sweet spot = middle half of the prices people liked (needs 3+ likes).
export function groupSummary(listings, state, members, budgets, f = DEFAULT_FILTERS) {
  const byKey = Object.fromEntries(listings.map((l) => [l.key, l]));
  const likedCosts = [];
  for (const [key, v] of Object.entries(state.votes)) {
    const l = byKey[key];
    if (!l || costOf(l) === null) continue;
    for (const m of Object.keys(v)) if (v[m] === "like") likedCosts.push(costOf(l));
  }
  likedCosts.sort((a, b) => a - b);
  const known = members.map((m) => budgets[m]).filter((b) => typeof b === "number" && b > 0);
  const ceiling = known.length ? Math.min(...known) : null;
  const sweetSpot = likedCosts.length >= 3
    ? { low: percentile(likedCosts, 0.25), median: percentile(likedCosts, 0.5), high: percentile(likedCosts, 0.75) }
    : null;
  const viewings = listings.filter((l) => statusOf(state, l.key) === "viewing").length;
  return {
    ceiling,
    sweetSpot,
    likedCount: likedCosts.length,
    matching: filterListings(listings, f).length,
    shortlist: shortlist(listings, state, members).length,
    viewings,
  };
}

// "#join=ABC123" -> "ABC123"
export function parseJoinHash(hash) {
  const m = /(?:^#|&)join=([A-Za-z0-9_-]{4,64})/.exec(hash || "");
  return m ? m[1] : null;
}

export function shareText(l) {
  return `${l.title}: ${money(costOf(l))}/person, ${l.bedrooms} bed, ${walkLabel(l)}. ${l.url}`;
}
