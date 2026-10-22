// Small HTML builders shared by the screens. Everything from listings goes through esc().
import {
  STATUS_LABELS, budgetFit, costOf, formatDate, initials, money, statusOf, votesFor, walkLabel,
} from "./logic.js";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Soft pastel for houses without photos, picked from the key so it's stable.
const PASTELS = [
  ["#fae9e2", "#9a3b1c"], ["#e1f4ec", "#0f6e56"], ["#ecebfd", "#4f45b0"],
  ["#e5eff9", "#1b5c9e"], ["#f9efd9", "#855109"], ["#efeee8", "#5d5c57"],
];
export function pastel(key) {
  let h = 0;
  for (const ch of key || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PASTELS[h % PASTELS.length];
}

// Only plain https links. Quotes, brackets, backslashes and spaces are refused outright, because
// inside a style="url('…')" the browser decodes &#39; back into a quote and the URL could break out.
export function safeUrl(u) {
  return typeof u === "string" && /^https:\/\/[^\s'"()\\<>`]+$/i.test(u) ? u : null;
}

// A count from the data (bedrooms, months...) as a plain number, or "–" if it isn't one.
export function num(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : "–";
}

export function photoStyle(l, index = 0) {
  const img = safeUrl(l.images?.[index]);
  if (img) return `background-image:url('${img}')`;
  const [bg, fg] = pastel(l.key);
  return `background-color:${bg};color:${fg}`;
}

export function photoClass(l, index = 0) {
  return safeUrl(l.images?.[index]) ? "" : "pastel";
}

export function photoInner(l, index = 0) {
  return safeUrl(l.images?.[index]) ? "" : '<i class="ti ti-home" aria-hidden="true"></i>';
}

export function dots(l, index) {
  const n = l.images?.length || 0;
  if (n < 2) return "";
  return `<div class="photo-dots">${Array.from({ length: n }, (_, i) => `<span class="${i === index ? "on" : ""}"></span>`).join("")}</div>`;
}

export function statusChip(state, key) {
  const s = statusOf(state, key);
  const cls = { new: "", interested: "info", contacted: "warn", viewing: "good", rejected: "bad" }[s];
  return `<span class="chip ${cls}">${STATUS_LABELS[s]}</span>`;
}

export function voteAvatars(state, key) {
  const { likes, passes } = votesFor(state, key);
  if (!likes.length && !passes.length) return "";
  return `<span class="avatars">${likes.map((m) => `<span class="avatar liked" title="${esc(m)} liked">${esc(initials(m))}</span>`).join("")}${passes.map((m) => `<span class="avatar passed" title="${esc(m)} passed">${esc(initials(m))}</span>`).join("")}</span>`;
}

export function priceNote(l) {
  if (l.utilities_included === "yes") return "/ person, utilities incl.";
  if (l.utilities_included === "no") return `/ person incl. ~${money(l.est_cost_per_person - l.price_per_person)} utilities`;
  return "/ person, utilities unclear";
}

export function fitLine(l, budget) {
  const fit = budgetFit(l, budget);
  if (!fit) return "";
  return `<span class="${fit.over ? "warn" : "good"} small">${esc(fit.text)}</span>`;
}

// New for me = it wasn't listed on my previous visit. On a first visit, fall back to the
// scraper's own "found in the latest run" flag.
export function isNewFor(l, seen) {
  if (!seen) return Boolean(l.is_new);
  return !seen.has(l.key);
}

export function listRow(l, state, opts = {}) {
  const { members = [], showLikes = false } = opts;
  const { likes } = votesFor(state, l.key);
  const sub = showLikes
    ? `${statusChip(state, l.key)} <span class="muted small">${likes.length} of ${members.length} liked</span>`
    : `<span class="muted small">${num(l.bedrooms)} bed · ${esc(walkLabel(l))}</span>`;
  return `<button class="row" type="button" data-open="${esc(l.key)}">
    <span class="thumb ${photoClass(l)}" style="${photoStyle(l)}">${photoInner(l)}</span>
    <span class="row-main">
      <span class="row-title" style="display:block">${esc(l.title)}</span>
      <span style="display:flex;gap:6px;align-items:center;margin-top:2px;flex-wrap:wrap">${sub}</span>
      ${opts.showVotes !== false && !showLikes ? `<span style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px">${voteAvatars(state, l.key)}${statusOf(state, l.key) !== "new" ? statusChip(state, l.key) : ""}${opts.isNew ? '<span class="chip ink">New</span>' : ""}</span>` : ""}
    </span>
    <span class="row-side">
      <span class="row-price" style="display:block">${money(costOf(l))}</span>
      <span class="faint tiny">per person</span>
    </span>
  </button>`;
}

export function factsGrid(l) {
  const rows = [
    ["Bedrooms", l.bedrooms ?? "–"],
    ["Bathrooms", l.baths ?? "–"],
    ["Type", l.housing_type || "–"],
    ["Available", formatDate(l.lease_start)],
    ["Lease", l.lease_term_months ? `${num(l.lease_term_months)} months` : "–"],
    ["Utilities", { yes: "Included", no: "Extra", unknown: "Not stated" }[l.utilities_included] || "–"],
    ["Whole house", l.total_rent ? `${money(l.total_rent)}/mo` : "–"],
    ["Advertised", l.price ? `${money(l.price)}${l.price_basis === "per_room" ? " per room" : ""}${l.price_assumed ? " (assumed)" : ""}` : "–"],
    ["To Huron", l.walk_min_huron != null ? `${l.walk_min_huron} min walk` : "–"],
    ["To main campus", l.walk_min_campus != null ? `${l.walk_min_campus} min walk` : "–"],
    ["Neighbourhood", l.neighbourhood || "–"],
    ["First seen", formatDate(l.first_seen)],
  ];
  return `<div class="facts">${rows.map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`).join("")}</div>`;
}

const SOURCE_NAMES = {
  western_och: "Western Off-Campus Housing", kijiji: "Kijiji", rentals_ca: "rentals.ca", liv_rent: "liv.rent",
  places4students: "Places4Students", sample: "sample data",
};
export function sourceName(source) {
  return SOURCE_NAMES[source] || String(source || "another site").replace(/_/g, " ");
}

// "Also listed on Kijiji ↗" when the scraper merged the same house from another site.
export function alsoListed(l) {
  const links = (l.also_listed || []).filter((a) => safeUrl(a?.url));
  if (!links.length) return "";
  return `<p class="small muted" style="margin:6px 0 0">Also listed on ${links.map((a) =>
    `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${esc(sourceName(a.source))} <i class="ti ti-external-link" aria-hidden="true"></i></a>`).join(", ")}</p>`;
}

// "Why suggested" chips from recommend.js: [{ text, tone: "good" | "warn" | "" }]
export function reasonChips(reasons) {
  if (!reasons?.length) return "";
  const tone = (t) => (t === "good" || t === "warn" ? t : "");
  return `<div class="chips reasons">${reasons.map((r) => `<span class="chip ${tone(r.tone)}">${esc(r.text)}</span>`).join("")}</div>`;
}

export function bulletList(l) {
  const hi = (l.highlights || []).map((t) => `<li><i class="ti ti-circle-check good" aria-hidden="true"></i>${esc(t)}</li>`);
  const hu = (l.heads_up || []).map((t) => `<li><i class="ti ti-alert-circle warn" aria-hidden="true"></i>${esc(t)}</li>`);
  if (!hi.length && !hu.length) return '<p class="muted small">No rundown for this one yet. Check the listing for details.</p>';
  return `<ul class="bullets">${hi.join("")}${hu.join("")}</ul>`;
}
