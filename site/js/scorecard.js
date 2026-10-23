// Viewing scorecards: each person rates a house during or after a viewing.
// Pure functions: no page, no storage. Everything here is covered by tests/scorecard.test.js.
//
// One card per person per house (state.scorecards[key][member]):
//   { ratings: { kitchen: 4, ... }, lease_ok: true | false | null, deposit_asked: true | false | null, note, at }

// 1 = bad, 5 = great for every item, so a higher average is always better.
export const RATINGS = [
  { id: "bedrooms", label: "Bedroom sizes", hint: "5 = all about the same size" },
  { id: "bathrooms", label: "Bathrooms" },
  { id: "kitchen", label: "Kitchen" },
  { id: "heating", label: "Heating", hint: "5 = warm, works well" },
  { id: "laundry", label: "Laundry" },
  { id: "damp", label: "Damp or mould", hint: "5 = none at all" },
  { id: "noise", label: "Noise", hint: "5 = quiet" },
  { id: "internet", label: "Internet" },
  { id: "landlord", label: "Landlord vibe" },
];

// Yes/no questions. For the deposit one, "yes" is the bad answer.
export const CHECKS = [
  { id: "lease_ok", label: "Lease terms OK" },
  { id: "deposit_asked", label: "Asked for a damage deposit", short: "Damage deposit", bad: true },
];

export const MAX_SCORE_NOTE = 500;

export const DEPOSIT_RULE =
  "Damage deposits aren't allowed in Ontario. A landlord can only ask for last month's rent and a refundable key deposit.";

// Only the known items, whole numbers 1–5, real true/false, and a trimmed note. A rating that
// isn't 1–5 is refused (the database refuses it too), so a bug can't save a 7 out of 5.
export function cleanScorecard(card = {}) {
  const ratings = {};
  for (const { id } of RATINGS) {
    const v = card?.ratings?.[id];
    if (v === null || v === undefined) continue;
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`bad rating for ${id}: ${v}`);
    ratings[id] = v;
  }
  const yesNo = (v) => (typeof v === "boolean" ? v : null);
  return {
    ratings,
    lease_ok: yesNo(card?.lease_ok),
    deposit_asked: yesNo(card?.deposit_asked),
    note: String(card?.note ?? "").trim().slice(0, MAX_SCORE_NOTE),
  };
}

export function isEmptyScorecard(card) {
  return !Object.keys(card.ratings).length && card.lease_ok === null && card.deposit_asked === null && !card.note;
}

// The change both stores make: save my (already cleaned) card, or remove it if it's empty.
export function putScorecard(state, key, member, clean, at = new Date().toISOString()) {
  const cards = { ...(state.scorecards?.[key] || {}) };
  if (isEmptyScorecard(clean)) delete cards[member];
  else cards[member] = { ...clean, at };
  state.scorecards = { ...(state.scorecards || {}), [key]: cards };
}

export function scorecardsFor(state, key) {
  return state.scorecards?.[key] || {};
}

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

// Everything the group has said about one house:
//   people:  who filled in a card (group order first)
//   items:   per rating, everyone's answer and the average of those who answered
//   overall: the average of the item averages, so every item counts the same
//   checks:  who said yes / no to each yes-or-no question
//   depositAsked: names who said the landlord asked for a damage deposit
//   notes:   [{ member, note, at }]
export function scorecardSummary(cards = {}, members = []) {
  const people = [
    ...members.filter((m) => cards[m]),
    ...Object.keys(cards).filter((m) => !members.includes(m)).sort(),
  ];
  const items = RATINGS.map((r) => {
    const answers = people.map((member) => ({ member, value: cards[member].ratings?.[r.id] ?? null }));
    const values = answers.map((a) => a.value).filter((v) => v !== null);
    return { ...r, answers, average: mean(values), count: values.length };
  });
  const rated = items.filter((i) => i.average !== null);
  const checks = CHECKS.map((c) => ({
    ...c,
    answers: people.map((member) => ({ member, value: cards[member][c.id] ?? null })),
    yes: people.filter((m) => cards[m][c.id] === true),
    no: people.filter((m) => cards[m][c.id] === false),
  }));
  return {
    people,
    items,
    overall: mean(rated.map((i) => i.average)),
    checks,
    depositAsked: checks.find((c) => c.id === "deposit_asked").yes,
    notes: people.filter((m) => cards[m].note).map((m) => ({ member: m, note: cards[m].note, at: cards[m].at })),
  };
}

// "Charlie", "Charlie and Jack", "Paxton, Charlie and Jack"
export function andList(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// "4.3" for averages, "–" when nobody has rated it.
export function formatScore(n) {
  return n === null || n === undefined ? "–" : n.toFixed(1);
}
