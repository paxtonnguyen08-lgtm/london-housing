// HTML for the viewing scorecard (on a house's detail sheet) and the side-by-side compare view.
// Everything from listings and from people's answers goes through esc().
import { costOf, initials, money } from "./logic.js";
import { CHECKS, DEPOSIT_RULE, RATINGS, andList, formatScore } from "./scorecard.js";
import { esc, num, photoClass, photoInner, photoStyle } from "./ui.js";

const toneOf = (v) => (v === null ? "faint" : v <= 2 ? "warn" : v >= 4 ? "good" : "");

function depositBanner(names) {
  if (!names.length) return "";
  const who = `${esc(andList(names))} ${names.length === 1 ? "says" : "say"}`;
  return `<div class="banner bad"><i class="ti ti-alert-triangle" aria-hidden="true"></i> <b>${who} the landlord asked for a damage deposit.</b> ${esc(DEPOSIT_RULE)}</div>`;
}

// The group's answers for one house: the average per item, then each person's own answer.
export function scorecardGroupHtml(summary) {
  if (!summary.people.length) return "";
  const cols = `style="--people:${summary.people.length}"`;
  const head = `<div class="sc-row sc-head" ${cols}><span></span><span class="tiny muted">Avg</span>${summary.people
    .map((m) => `<span class="avatar" title="${esc(m)}">${esc(initials(m))}</span>`).join("")}</div>`;
  const ratingRows = summary.items.map((i) => `<div class="sc-row" ${cols}>
      <span class="sc-label">${esc(i.label)}</span>
      <span class="sc-avg ${toneOf(i.average)}">${formatScore(i.average)}</span>
      ${i.answers.map((a) => `<span class="sc-cell ${toneOf(a.value)}" title="${esc(a.member)}: ${a.value ?? "no answer"}">${a.value ?? "–"}</span>`).join("")}
    </div>`).join("");
  const checkRows = summary.checks.map((c) => {
    const answered = c.yes.length + c.no.length;
    const badYes = c.bad && c.yes.length;
    // The icon says whether the answer is good news: for the deposit question, "no" gets the tick.
    const cell = (v) => {
      if (v === null) return '<span class="sc-cell faint">–</span>';
      const good = c.bad ? !v : v;
      const icon = good ? "check" : c.bad ? "alert-triangle" : "x";
      return `<span class="sc-cell ${good ? "good" : "bad"}"><i class="ti ti-${icon}" aria-label="${v ? "Yes" : "No"}"></i></span>`;
    };
    return `<div class="sc-row ${badYes ? "flag" : ""}" ${cols}>
      <span class="sc-label">${esc(c.short || c.label)}</span>
      <span class="sc-avg ${badYes ? "bad" : answered ? "" : "faint"}">${answered ? `${c.yes.length}/${answered}` : "–"}</span>
      ${c.answers.map((a) => cell(a.value)).join("")}
    </div>`;
  }).join("");
  return `
    ${depositBanner(summary.depositAsked)}
    <div class="sc-overall"><span class="serif">${formatScore(summary.overall)}</span><span class="muted small">/ 5 overall, from ${summary.people.length} scorecard${summary.people.length === 1 ? "" : "s"}</span></div>
    <div class="scorecard">${head}${ratingRows}${checkRows}</div>
    ${summary.notes.map((n) => `<div class="note"><span class="avatar">${esc(initials(n.member))}</span><span><span class="faint tiny" style="display:block">${esc(n.member)}'s viewing note</span>${esc(n.note)}</span></div>`).join("")}`;
}

// My own scorecard, as tap-to-pick buttons. card is my unsaved draft or what I saved.
export function scorecardFormHtml(card, { dirty = false, saved = false } = {}) {
  const ratings = card.ratings || {};
  const scale = (r) => `<div class="sc-q">
      <div class="sc-q-label">${esc(r.label)}${r.hint ? `<span class="faint tiny">${esc(r.hint)}</span>` : ""}</div>
      <div class="sc-scale" role="group" aria-label="${esc(r.label)}">${[1, 2, 3, 4, 5].map((n) =>
        `<button type="button" class="sc-num ${ratings[r.id] === n ? "on" : ""}" data-score="${r.id}" data-value="${n}" aria-pressed="${ratings[r.id] === n}">${n}</button>`).join("")}</div>
    </div>`;
  const yesNo = (c) => `<div class="sc-q">
      <div class="sc-q-label">${esc(c.label)}</div>
      <div class="sc-scale" role="group" aria-label="${esc(c.label)}">${[true, false].map((v) =>
        `<button type="button" class="pill ${card[c.id] === v ? (c.bad && v ? "on bad" : "on") : ""}" data-check="${c.id}" data-value="${v ? "yes" : "no"}" aria-pressed="${card[c.id] === v}">${v ? "Yes" : "No"}</button>`).join("")}</div>
    </div>
    ${c.bad && card[c.id] === true ? `<div class="banner bad small">${esc(DEPOSIT_RULE)}</div>` : ""}`;
  return `<div class="sc-form">
      <p class="muted small" style="margin:0 0 4px">1 = bad, 5 = great. Tap a number again to clear it.</p>
      ${RATINGS.map(scale).join("")}
      ${CHECKS.map(yesNo).join("")}
      <textarea id="score-note" maxlength="500" rows="3" placeholder="Anything else? e.g. one bedroom has no window" aria-label="Your viewing note">${esc(card.note || "")}</textarea>
      <div class="row-btns" style="margin-top:10px">
        <button class="btn" type="button" data-score-cancel>${dirty ? "Discard changes" : "Close"}</button>
        <button class="btn btn-ink" type="button" data-score-save ${dirty ? "" : "disabled"}>${saved ? "Save changes" : "Save"}</button>
      </div>
      <p class="faint tiny" data-score-unsaved style="text-align:center;margin:6px 0 0" ${dirty ? "" : "hidden"}>Not saved yet. Kept on this phone until you save.</p>
    </div>`;
}

// A shortlist row in "pick houses to compare" mode. position is 1–3 when picked, else 0.
export function pickRow(l, position) {
  return `<button class="row pick-row" type="button" data-pick="${esc(l.key)}" aria-pressed="${position > 0}">
    <span class="thumb ${photoClass(l)}" style="${photoStyle(l)}">${photoInner(l)}</span>
    <span class="row-main">
      <span class="row-title" style="display:block">${esc(l.title)}</span>
      <span class="muted small">${money(costOf(l))} · ${num(l.bedrooms)} bed${l.walk_min_huron != null ? ` · ${num(l.walk_min_huron)} min to Huron` : ""}</span>
    </span>
    <span class="pick-mark ${position ? "on" : ""}" aria-hidden="true">${position || ""}</span>
  </button>`;
}

const GROUP_TITLES = { basics: "The basics", group: "What the group thinks", headsup: "Heads-ups" };

// Houses side by side. rows come from compareRows(); the best cell in each row is highlighted.
export function compareHtml(houses, rows) {
  const cols = `style="--cols:${houses.length}"`;
  const head = `<div class="cmp-head cmp-cells" ${cols}>${houses.map((l) => `<button class="cmp-house" type="button" data-open="${esc(l.key)}">
      <span class="thumb ${photoClass(l)}" style="${photoStyle(l)}">${photoInner(l)}</span>
      <span class="cmp-title">${esc(l.title)}</span>
    </button>`).join("")}</div>`;
  let lastGroup = null;
  const body = rows.map((r) => {
    const title = r.group !== lastGroup && r.group !== "headsup" ? `<h4 class="cmp-group">${esc(GROUP_TITLES[r.group])}</h4>` : "";
    lastGroup = r.group;
    const cell = (c) => `<div class="cmp-cell ${c.best ? "best" : ""} ${c.tone || ""}">
        ${c.list ? `<ul>${c.list.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<span class="cmp-value">${esc(c.text)}</span>`}
        ${c.sub ? `<span class="cmp-sub">${esc(c.sub)}</span>` : ""}
        ${c.best ? '<span class="sr-only">(best)</span>' : ""}
      </div>`;
    return `${title}<div class="cmp-row">
        <div class="cmp-label">${esc(r.label)}${r.hint ? ` <span class="faint">· ${esc(r.hint)}</span>` : ""}</div>
        <div class="cmp-cells" ${cols}>${r.cells.map(cell).join("")}</div>
      </div>`;
  }).join("");
  return `<div class="cmp">${head}${body}</div>
    <p class="faint tiny" style="margin-top:12px"><span class="cmp-key"></span> Best in that row. Nothing is highlighted when they're all the same, or when only one house has an answer. Tap a house to open it.</p>`;
}
