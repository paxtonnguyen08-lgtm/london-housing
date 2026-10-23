// Compare 2–3 houses side by side, with the best value in each row picked out.
// Pure functions: no page, no storage. Everything here is covered by tests/compare.test.js.
import { costOf, money, votesFor } from "./logic.js";
import { RATINGS, andList, formatScore, scorecardSummary, scorecardsFor } from "./scorecard.js";

export const MAX_COMPARE = 3;

// Tap a house to pick it, tap again to drop it. full is true when a 4th pick was refused.
export function togglePick(picks, key, max = MAX_COMPARE) {
  if (picks.includes(key)) return { picks: picks.filter((k) => k !== key), full: false };
  if (picks.length >= max) return { picks, full: true };
  return { picks: [...picks, key], full: false };
}

// Which columns hold the best value: the indexes of the lowest ("low") or highest ("high") number.
// Nothing is picked out unless at least two houses have a number and they aren't all the same,
// so a lone value or a tie across the board never looks like a win. Ties for best all count.
export function bestOf(values, better = "low") {
  const known = values.map((v, i) => [v, i]).filter(([v]) => typeof v === "number" && Number.isFinite(v));
  if (known.length < 2) return [];
  const nums = known.map(([v]) => v);
  const top = better === "high" ? Math.max(...nums) : Math.min(...nums);
  if (nums.every((v) => v === top)) return [];
  return known.filter(([v]) => v === top).map(([, i]) => i);
}

const oneDecimal = (n) => String(Math.round(n * 10) / 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The rows of the compare view, in order. Each row:
//   { id, group: "basics" | "group" | "headsup", label, hint?, cells: [{ text, sub?, tone?, list?, best }] }
// group: "basics" = the listing's numbers, "group" = votes and scorecards, "headsup" = the scraper's warnings.
export function compareRows(houses, state, members = []) {
  const size = members.length;
  const sums = houses.map((l) => scorecardSummary(scorecardsFor(state, l.key), members));
  const rows = [];
  const add = (row, values, better) => {
    const best = better ? bestOf(values, better) : [];
    rows.push({ ...row, cells: row.cells.map((c, i) => ({ ...c, best: best.includes(i) })) });
  };

  add({
    id: "cost", group: "basics", label: "Cost per person", hint: "a month, with utilities",
    cells: houses.map((l) => ({ text: money(costOf(l)) })),
  }, houses.map(costOf), "low");

  add({
    id: "walk", group: "basics", label: "Walk to Huron",
    cells: houses.map((l) => ({ text: l.walk_min_huron != null ? `${l.walk_min_huron} min` : "–" })),
  }, houses.map((l) => l.walk_min_huron), "low");

  // More bedrooms isn't better: the best fit is one bedroom each.
  add({
    id: "bedrooms", group: "basics", label: "Bedrooms", hint: size ? `best is ${size}, one each` : undefined,
    cells: houses.map((l) => ({ text: l.bedrooms != null ? String(l.bedrooms) : "–" })),
  }, houses.map((l) => (size && l.bedrooms != null ? -Math.abs(l.bedrooms - size) : null)), "high");

  // Fewest people sharing each bathroom wins.
  const perBath = (l) => (l.baths && l.bedrooms ? l.bedrooms / l.baths : null);
  add({
    id: "bathrooms", group: "basics", label: "Bathrooms",
    cells: houses.map((l) => ({
      text: l.baths != null ? String(l.baths) : "–",
      sub: perBath(l) !== null ? `${oneDecimal(perBath(l))} people per bathroom` : undefined,
    })),
  }, houses.map(perBath), "low");

  add({
    id: "utilities", group: "basics", label: "Utilities",
    cells: houses.map((l) => {
      if (l.utilities_included === "yes") return { text: "Included" };
      const extra = (l.est_cost_per_person ?? 0) - (l.price_per_person ?? 0);
      if (l.utilities_included === "no") return { text: extra > 0 ? `About ${money(extra)} extra` : "Extra" };
      return { text: "Not stated" };
    }),
  }, houses.map((l) => (l.utilities_included === "yes" ? 1 : 0)), "high");

  const likes = houses.map((l) => votesFor(state, l.key).likes.length);
  add({
    id: "likes", group: "group", label: "Group likes",
    cells: likes.map((n) => ({ text: size ? `${n} of ${size}` : String(n) })),
  }, likes, "high");

  add({
    id: "score", group: "group", label: "Viewing score", hint: "Average of everyone's scorecard, out of 5",
    cells: sums.map((s) => ({
      text: s.overall !== null ? `${formatScore(s.overall)} / 5` : "–",
      sub: s.people.length ? plural(s.people.length, "scorecard") : "No scorecards yet",
    })),
  }, sums.map((s) => s.overall), "high");

  // One row per scorecard item that at least one of these houses has a rating for.
  for (const r of RATINGS) {
    const avgs = sums.map((s) => s.items.find((i) => i.id === r.id).average);
    if (avgs.every((a) => a === null)) continue;
    add({
      id: r.id, group: "group", label: r.label,
      cells: avgs.map((a) => ({ text: formatScore(a), tone: a !== null && a <= 2 ? "warn" : undefined })),
    }, avgs, "high");
  }

  const check = (s, id) => s.checks.find((c) => c.id === id);
  const lease = sums.map((s) => check(s, "lease_ok"));
  if (lease.some((c) => c.yes.length + c.no.length)) {
    add({
      id: "lease_ok", group: "group", label: "Lease terms OK",
      cells: lease.map((c) => {
        const answered = c.yes.length + c.no.length;
        return { text: answered ? `${c.yes.length} of ${answered} yes` : "–", tone: c.no.length ? "warn" : undefined };
      }),
    }, lease.map((c) => (c.yes.length + c.no.length ? c.yes.length / (c.yes.length + c.no.length) : null)), "high");
  }

  // A red flag, not a contest: no "best" here.
  const deposit = sums.map((s) => check(s, "deposit_asked"));
  if (deposit.some((c) => c.yes.length + c.no.length)) {
    add({
      id: "deposit_asked", group: "group", label: "Asked for a damage deposit",
      cells: deposit.map((c) => {
        if (c.yes.length) return { text: "Yes", sub: `Said by ${andList(c.yes)}`, tone: "bad" };
        return { text: c.no.length ? "No" : "–" };
      }),
    });
  }

  add({
    id: "heads_up", group: "headsup", label: "Heads-ups",
    cells: houses.map((l) => (l.heads_up?.length ? { text: "", list: l.heads_up } : { text: "None" })),
  });

  return rows;
}
