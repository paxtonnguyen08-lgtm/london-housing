import { CONFIG } from "./config.js";
import { LocalGroupStore, prefs, visitBaseline } from "./group.js";
import { Voting } from "./voting.js";
import { GroupError, SupabaseGroupStore } from "./supabase-store.js";
import {
  DEFAULT_FILTERS, STATUSES, budgetLabel, STATUS_LABELS, deckFor, filterListings, groupSummary, initials, isMatch,
  money, parseInviteInput, parseJoinHash, shareText, shortlist, sortListings, statusOf, votesFor, walkLabel, formatDate, costOf,
} from "./logic.js";
import { MIN_VOTES, budgetCheck, groupProfile, readiness, suggest } from "./recommend.js";
import { Deck } from "./swipe.js";
import {
  alsoListed, bulletList, dots, esc, num, safeUrl, factsGrid, fitLine, isNewFor, listRow, photoClass, photoInner, photoStyle, priceNote,
  reasonChips, voteAvatars,
} from "./ui.js";

const $ = (id) => document.getElementById(id);
let members = CONFIG.members; // replaced by the group's own list once connected to Supabase
let store; // SupabaseGroupStore when connected, LocalGroupStore (this phone only) otherwise
let voting; // casts and undoes my votes on whichever store is in use

const app = {
  listings: [],
  byKey: {},
  sample: false,
  lastRun: null,
  me: prefs.get("me"),
  filters: { ...DEFAULT_FILTERS, ...prefs.get("filters", {}) },
  sort: prefs.get("sort", "cost"),
  tab: prefs.get("tab", "discover"),
  order: prefs.get("order", "suggested"), // the deck's order: "suggested" (once unlocked) or "newest"
  why: {}, // "why suggested" reasons for each card in the deck, by house key
  seen: null, // houses that were already here on my previous visit (null on a first visit)
  detailKey: null,
};

// ---------- data ----------

async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`${url}: ${resp.status}`);
  return resp.json();
}

async function loadListings() {
  const forceSample = new URLSearchParams(location.search).has("sample");
  if (!forceSample) {
    for (const url of CONFIG.dataUrls) {
      try {
        const data = await fetchJson(url);
        if (Array.isArray(data.listings) && data.listings.length) return { data, sample: false };
      } catch {
        // try the next location
      }
    }
  }
  return { data: await fetchJson(CONFIG.sampleUrl), sample: true };
}

// ---------- helpers ----------

function toast(msg) {
  const t = $("toast");
  // An open sheet sits in the browser's top layer, above everything else, so show the toast inside it.
  const host = document.querySelector("dialog[open]") || document.body;
  if (t.parentElement !== host) host.appendChild(t);
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2200);
}

function myBudget() {
  return store.state.budgets[app.me] ?? CONFIG.defaultBudget;
}

function filterPills(id) {
  const f = app.filters;
  const pills = [
    f.groupSize ? `Group of ${f.groupSize}` : "Any size",
    budgetLabel(f.minBudget, f.maxBudget),
    f.maxWalk ? `Under ${f.maxWalk} min` : "Any walk",
  ];
  if (f.utilitiesOnly) pills.push("Utilities incl.");
  $(id).innerHTML =
    `<button class="pill on" type="button" data-filters><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i> Filters</button>` +
    pills.map((p) => `<button class="pill" type="button" data-filters>${esc(p)}</button>`).join("");
}

// ---------- tabs ----------

function setTab(tab) {
  app.tab = tab;
  prefs.set("tab", tab);
  for (const s of document.querySelectorAll("#app > section")) s.hidden = s.id !== `tab-${tab}`;
  for (const b of document.querySelectorAll(".tabbar button")) b.classList.toggle("on", b.dataset.tab === tab);
  document.body.classList.toggle("on-discover", tab === "discover");
  $("page-title").textContent = $(`tab-${tab}`).dataset.title;
  render();
  window.scrollTo(0, 0);
}

function render() {
  renderMe();
  renderBadge();
  if (app.tab === "discover") renderDiscover();
  if (app.tab === "shortlist") renderShortlist();
  if (app.tab === "home") renderHome();
  if (app.tab === "group") renderGroup();
}

function renderMe() {
  $("me-avatar").textContent = app.me ? initials(app.me) : "?";
  $("me-name").textContent = app.me || "Who are you?";
}

function renderBadge() {
  const n = app.me ? deckFor(app.listings, store.state, app.me, app.filters).length : 0;
  $("deck-badge").hidden = n === 0;
  $("deck-badge").textContent = n > 99 ? "99+" : n;
}

// ---------- Discover (swipe) ----------

function cardFront(l, photoIndex) {
  const isNew = isNewFor(l, app.seen);
  return `
    <div class="photo ${photoClass(l, photoIndex)}" style="${photoStyle(l, photoIndex)}">
      ${photoInner(l, photoIndex)}${dots(l, photoIndex)}
      <span class="stamp like">Like</span><span class="stamp pass">Pass</span>
      ${l.neighbourhood ? `<span class="photo-tag">${esc(l.neighbourhood)}</span>` : ""}
      ${isNew ? '<span class="photo-tag new-tag">New</span>' : ""}
    </div>
    <div class="card-body">
      <div class="price-line"><span class="serif">${money(costOf(l))}</span><span class="muted small">${esc(priceNote(l))}</span></div>
      <div class="card-title">${esc(l.title)}</div>
      <div class="muted small">${num(l.bedrooms)} bed${l.baths ? ` · ${num(l.baths)} bath` : ""}${l.housing_type ? ` · ${esc(l.housing_type)}` : ""} · ${esc(formatDate(l.lease_start))}</div>
      <div class="muted small"><i class="ti ti-walk" aria-hidden="true"></i> ${esc(walkLabel(l))}</div>
      <div class="chips one-line" style="margin-top:4px">${cardChips(l).map((h) => `<span class="chip">${esc(h)}</span>`).join("")}</div>
      <div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:8px">${fitLine(l, myBudget())}${voteAvatars(store.state, l.key)}</div>
    </div>`;
}

// Highlights for the card front, minus ones that repeat the walk or utilities lines above them.
function cardChips(l) {
  return (l.highlights || []).filter((h) => !/walk to|utilities included/i.test(h)).slice(0, 3);
}

function cardBack(l) {
  const { likes, passes } = votesFor(store.state, l.key);
  const who = [
    likes.length ? `${likes.map(esc).join(", ")} liked it` : "",
    passes.length ? `${passes.map(esc).join(", ")} passed` : "",
  ].filter(Boolean).join(" · ") || "Nobody has voted yet";
  const why = app.why[l.key];
  return `
    <div class="card-back">
      <div><div class="muted small">Rundown</div><div class="serif" style="font-size:30px;line-height:1.15">${esc(l.title)}</div></div>
      ${why?.length ? `<div><div class="muted small"><i class="ti ti-sparkles" aria-hidden="true"></i> Why suggested</div>${reasonChips(why)}</div>` : ""}
      ${bulletList(l)}
      <div class="muted small">${esc(l.neighbourhood || "")}${l.lease_term_months ? ` · ${num(l.lease_term_months)}-month lease` : ""} · utilities ${esc({ yes: "included", no: "extra", unknown: "not stated" }[l.utilities_included])}${l.amenities?.length ? `<br>${l.amenities.map(esc).join(" · ")}` : ""}</div>
      <div class="small">${who}</div>
      <div class="row-btns" style="margin-top:auto">
        <button class="btn" type="button" data-open="${esc(l.key)}">More</button>
        <button class="btn btn-ink" type="button" data-share="${esc(l.key)}"><i class="ti ti-share" aria-hidden="true"></i> Share</button>
      </div>
      <div class="faint tiny" style="text-align:center">Tap anywhere else to flip back</div>
    </div>`;
}

const deck = new Deck($("deck"), {
  renderFront: cardFront,
  renderBack: cardBack,
  onVote: (l, vote) => castVote(l, vote, { fromDeck: true }),
});

// Who still needs to vote before suggestions unlock, as a short line for the pill and a longer one for the toast.
function lockedText(ready) {
  const mine = ready.needs.find((n) => n.member === app.me);
  const others = ready.needs.filter((n) => n.member !== app.me);
  if (mine) {
    return {
      short: `${mine.more} more vote${mine.more === 1 ? "" : "s"} to unlock suggestions`,
      long: `Vote on ${mine.more} more house${mine.more === 1 ? "" : "s"} to unlock suggestions.${others.length ? ` ${others.map((n) => n.member).join(", ")} still need${others.length === 1 ? "s" : ""} to vote too.` : ""}`,
    };
  }
  return {
    short: `Suggestions: waiting on ${others.length === 1 ? others[0].member : `${others.length} friends`}`,
    long: `Suggestions unlock once everyone has ${MIN_VOTES} votes. Waiting on ${others.map((n) => `${n.member} (${n.more} more)`).join(", ")}.`,
  };
}

function orderPill(ready, suggested) {
  const pill = (icon, text) => `<button class="pill" type="button" data-order><i class="ti ti-${icon}" aria-hidden="true"></i> ${esc(text)}</button>`;
  if (!ready.ready) return pill("lock", lockedText(ready).short);
  return suggested ? pill("sparkles", "Suggested for us") : pill("clock", "Newest first");
}

function toggleOrder() {
  const ready = readiness(store.state, members);
  if (!ready.ready) return toast(lockedText(ready).long);
  app.order = app.order === "suggested" ? "newest" : "suggested";
  prefs.set("order", app.order);
  deck.show([]); // start the deck over in the new order
  render();
  toast(app.order === "suggested" ? "Best fits for the whole group first" : "Newest houses first");
}

function renderDiscover() {
  filterPills("discover-pills");
  if (!app.me) {
    deck.show([]);
    $("deck").innerHTML = '<div class="empty"><span class="serif">Pick your name</span>Then start swiping.</div>';
    return;
  }
  const ready = readiness(store.state, members);
  const suggested = app.order === "suggested" && ready.ready;
  $("discover-pills").firstElementChild.insertAdjacentHTML("afterend", orderPill(ready, suggested));
  let items = deckFor(app.listings, store.state, app.me, app.filters);
  app.why = {};
  if (suggested) {
    const ranked = suggest(items, app.listings, store.state, members);
    app.why = Object.fromEntries(ranked.map((r) => [r.listing.key, r.reasons]));
    items = ranked.map((r) => r.listing);
    // Every vote re-ranks the deck. Don't swap the card I'm looking at (or the one peeking out
    // under it, which comes next after a swipe): the first card from the current deck stays on top.
    const keep = deck.items.find((x) => items.some((l) => l.key === x.key));
    if (keep) items = [keep, ...items.filter((l) => l.key !== keep.key)];
  }
  if (deck.top?.key !== items[0]?.key || deck.items.length !== items.length) deck.show(items);
  // At the end of the deck only Undo stays, so the last swipe can still be taken back on a phone
  $("deck-actions").hidden = !items.length && !voting.canUndo;
  for (const id of ["btn-pass", "btn-info", "btn-like"]) $(id).hidden = !items.length;
  $("deck-hint").hidden = !items.length;
  if (!items.length) {
    const total = filterListings(app.listings, app.filters).length;
    $("deck").innerHTML = total
      ? '<div class="empty"><span class="serif">You\'re caught up</span>You\'ve voted on every house that fits your filters. New ones show up here as they\'re found.</div>'
      : '<div class="empty"><span class="serif">Nothing fits yet</span>No houses match these filters. Try a bigger budget or a longer walk.<br><br><button class="btn" type="button" data-filters>Change filters</button></div>';
  }
}

async function castVote(l, vote, { fromDeck = false } = {}) {
  if (!app.me) return askWho();
  // If saving fails, this throws and the error handler below shows a message
  const result = await voting.cast(l.key, app.me, vote);
  if (!result) return; // this house's vote is still saving
  if (result.match) showMatch(l);
  else if (fromDeck) $("deck-hint").textContent = vote === "like" ? `Liked ${l.title}` : `Passed on ${l.title}`;
  render();
}

async function undoLast() {
  const last = await voting.undo(app.me);
  if (!last) return toast("Nothing to undo");
  deck.show([]); // force a fresh deck so the undone card comes back on top
  render();
  const l = app.byKey[last.key];
  if (l && deck.top?.key !== l.key) {
    deck.show([l, ...deck.items.filter((x) => x.key !== l.key)]);
  }
  $("deck-hint").textContent = "Undone";
}

function showMatch(l) {
  $("match-photo").setAttribute("style", photoStyle(l));
  $("match-photo").className = `match-photo ${photoClass(l)}`;
  $("match-photo").innerHTML = photoInner(l);
  $("match-text").textContent = `Everyone liked ${l.title}. It's moved to the top of your shortlist. Someone should contact the landlord.`;
  $("match").hidden = false;
  $("match-open").onclick = () => {
    $("match").hidden = true;
    openDetail(l.key);
  };
}

// ---------- Shortlist ----------

function renderShortlist() {
  const items = shortlist(app.listings, store.state, members);
  $("shortlist").innerHTML = items.length
    ? items.map((l) => {
        const match = isMatch(store.state, l.key, members);
        return (match ? '<div class="chip good" style="align-self:flex-start;margin-top:10px">Match: everyone liked it</div>' : "") +
          listRow(l, store.state, { members, showLikes: true });
      }).join("")
    : '<div class="empty"><span class="serif">No likes yet</span>Swipe right on houses you like in Discover and they\'ll collect here.</div>';
}

// ---------- Home ----------

function renderHome() {
  const sum = groupSummary(app.listings, store.state, members, store.state.budgets, app.filters);
  const lo = 700, hi = 1400;
  const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  let hero;
  if (sum.sweetSpot) {
    const vs = sum.ceiling
      ? (sum.sweetSpot.median <= sum.ceiling
        ? `<span class="good"><i class="ti ti-arrow-down-right" aria-hidden="true"></i> ${money(sum.ceiling - sum.sweetSpot.median)} under the group ceiling</span>`
        : `<span class="warn"><i class="ti ti-arrow-up-right" aria-hidden="true"></i> ${money(sum.sweetSpot.median - sum.ceiling)} over the group ceiling</span>`)
      : '<span class="muted">Set budgets in Group to see the ceiling</span>';
    hero = `
      <div class="hero-label">Group sweet spot · per person</div>
      <div class="hero-number serif">${money(sum.sweetSpot.median)}</div>
      <div class="hero-sub">${vs}</div>
      <div class="range">
        <div class="range-track">
          <div class="range-band" style="left:${pct(sum.sweetSpot.low)}%;width:${Math.max(2, pct(sum.sweetSpot.high) - pct(sum.sweetSpot.low))}%"></div>
          ${sum.ceiling ? `<div class="range-mark" style="left:${pct(sum.ceiling)}%" title="Group ceiling"></div>` : ""}
        </div>
        <div class="range-labels"><span>${money(lo)}</span><span>Likes ${money(sum.sweetSpot.low)}–${money(sum.sweetSpot.high)}</span><span class="${sum.ceiling ? "warn" : ""}">${sum.ceiling ? `Ceiling ${money(sum.ceiling)}` : money(hi)}</span></div>
      </div>`;
  } else {
    hero = `
      <div class="hero-label">Houses that fit your filters</div>
      <div class="hero-number count">${sum.matching}</div>
      <div class="hero-sub muted">Like ${Math.max(0, 3 - sum.likedCount)} more to see your group's price sweet spot.</div>`;
  }
  $("summary").innerHTML = `${hero}
    <div class="stats">
      <button class="stat" type="button" data-scroll="listings"><div class="muted tiny">Matching</div><div class="count">${sum.matching}</div></button>
      <button class="stat" type="button" data-tab-go="shortlist"><div class="muted tiny">Shortlist</div><div class="count">${sum.shortlist}</div></button>
      <button class="stat" type="button" data-tab-go="shortlist"><div class="muted tiny">Viewings</div><div class="count">${sum.viewings}</div></button>
    </div>`;
  filterPills("home-pills");
  $("sort").value = app.sort;
  const items = sortListings(filterListings(app.listings, app.filters), app.sort, store.state)
    .filter((l) => statusOf(store.state, l.key) !== "rejected");
  $("list-count").textContent = `${items.length} listing${items.length === 1 ? "" : "s"}`;
  $("listings").innerHTML = items.length
    ? items.map((l) => listRow(l, store.state, { members, isNew: isNewFor(l, app.seen) })).join("")
    : '<div class="empty"><span class="serif">No matches</span>Loosen the filters to see more.</div>';
}

// ---------- Group ----------

// Budget reality check: what each person said vs the prices they've actually liked.
function budgetReality() {
  const check = budgetCheck(app.listings, store.state, members);
  const profile = groupProfile(app.listings, store.state, members);
  const lo = 700, hi = 1400; // same scale as the Home tab's range bar
  const pct = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const bar = (r, stated) => `<div class="range mini"><div class="range-track">
      <div class="range-band" style="left:${pct(r.low)}%;width:${Math.max(2, pct(r.high) - pct(r.low))}%"></div>
      ${stated ? `<div class="range-mark" style="left:${pct(stated)}%"></div>` : ""}
    </div></div>`;
  const spot = check.sweetSpot;
  return `
    <div class="section-head"><h2>Budget reality check</h2></div>
    <p class="muted small" style="margin-top:4px">What each of you said vs what you've actually liked. The bar is the price range of your likes; the tick is your budget.</p>
    <div class="stats two">
      <div class="stat"><div class="muted tiny">Realistic ceiling</div><span class="serif money">${check.ceiling ? money(check.ceiling) : "–"}</span><div class="faint tiny">${check.ceilingBy.length ? `Lowest budget: ${esc(check.ceilingBy.join(", "))}` : "Set budgets above"}</div></div>
      <div class="stat"><div class="muted tiny">Group sweet spot</div><span class="serif money">${spot ? money(spot.median) : "–"}</span><div class="faint tiny">${spot ? `Most likes: ${money(spot.low)}–${money(spot.high)}` : "Needs 3 likes"}</div></div>
    </div>
    ${check.flags.map((f) => `<div class="banner warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i> The sweet spot is ${money(f.by)} over ${esc(f.member)}'s budget of ${money(f.budget)}. Worth talking about before you book viewings.</div>`).join("")}
    <div>
      ${check.people.map((p) => `<div class="group-row top">
          <span class="avatar">${esc(initials(p.member))}</span>
          <span style="flex:1;min-width:0"><span style="display:block;font-weight:500">${esc(p.member)}</span><span class="muted small ${p.revealed?.over ? "warn" : ""}">${esc(p.line)}</span>${p.revealed ? bar(p.revealed, p.stated) : ""}</span>
        </div>`).join("")}
    </div>
    ${profile.summary ? `<p class="muted small"><i class="ti ti-sparkles" aria-hidden="true"></i> Your likes so far: <b>${esc(profile.summary)}</b></p>` : ""}`;
}

function renderGroup() {
  const code = prefs.get("code");
  const invite = code ? `${location.origin}${location.pathname}#join=${code}` : null;
  const rejected = app.listings.filter((l) => statusOf(store.state, l.key) === "rejected");
  const voteCount = (m) => Object.values(store.state.votes).filter((v) => v[m]).length;
  $("group").innerHTML = `
    ${store.shared ? "" : '<div class="banner"><b>Practice mode.</b> Votes, notes and budgets are saved on this phone only. Once the group database (Supabase) is connected, everyone sees each other\'s votes.</div>'}
    <div class="section-head" style="margin-top:0"><h2>Members</h2><span class="muted small">Max budget / person</span></div>
    <div>
      ${members.map((m) => {
        const b = store.state.budgets[m];
        const mine = m === app.me;
        return `<div class="group-row">
          <span class="avatar">${esc(initials(m))}</span>
          <span style="flex:1"><span style="display:block;font-weight:500">${esc(m)}${mine ? ' <span class="faint small">(you)</span>' : ""}</span><span class="muted tiny">${voteCount(m)} vote${voteCount(m) === 1 ? "" : "s"}</span></span>
          ${mine
            ? `<form id="budget-form" style="text-align:right"><input class="budget-input" id="budget-input" inputmode="numeric" value="${b ?? ""}" placeholder="${CONFIG.defaultBudget}" aria-label="Your max budget per person"><div class="field-error" id="budget-error"></div></form>`
            : `<span class="serif" style="font-size:22px">${b ? money(b) : '<span class="faint small" style="font-family:var(--sans)">Not set</span>'}</span>`}
        </div>`;
      }).join("")}
    </div>
    ${budgetReality()}

    <div class="section-head"><h2>Invite your group</h2></div>
    ${invite
      ? `<div class="invite"><code>${esc(invite)}</code><button class="pill" type="button" id="copy-invite">Copy</button></div>
         <p class="muted small">Paste this in your group chat. Tapping it opens the app and joins your group.</p>`
      : '<p class="muted small">Your invite link appears here once the group code is set up (it comes with the database step).</p>'}

    <div class="section-head"><h2>${code ? "Switch groups" : "Join with a link"}</h2></div>
    <p class="muted small" style="margin-top:4px">${code ? "Paste another group's invite link to switch." : "Paste the invite link from your group chat."} On iPhone, if you added this to your Home Screen, tapping the link opens Safari instead, so paste it here.</p>
    ${joinForm()}

    <div class="section-head"><h2>Add to Home Screen</h2></div>
    <p class="muted small" style="margin-top:4px">On iPhone: tap <i class="ti ti-share" aria-hidden="true"></i> Share in Safari, then <b>Add to Home Screen</b>. It opens like an app, and later that's how alerts reach your phone.</p>

    <div class="section-head"><h2>Hidden houses</h2><span class="muted small">${rejected.length}</span></div>
    <div class="list">${rejected.map((l) => listRow(l, store.state, { members })).join("") || '<p class="muted small">Houses marked "Rejected" go here.</p>'}</div>

    <div class="section-head"><h2>Data</h2></div>
    <p class="muted small" style="margin-top:4px">${app.sample ? "Showing sample houses until the scraper's first run." : `Last updated ${esc(new Date(app.lastRun).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }))}.`}</p>
    <button class="btn" type="button" id="switch-person" style="margin-top:8px">Switch person</button>`;
}

async function saveBudget(e) {
  e.preventDefault();
  const input = $("budget-input");
  const ok = await store.setBudget(app.me, input.value.replace(/[$,\s]/g, ""));
  if (!ok) {
    $("budget-error").textContent = "Enter a monthly amount between $300 and $5,000.";
    return;
  }
  toast("Budget saved");
  render();
}

// ---------- Detail sheet ----------

function openDetail(key) {
  const l = app.byKey[key];
  if (!l) return;
  app.detailKey = key;
  renderDetail();
  const dlg = $("detail-sheet");
  if (!dlg.open) dlg.showModal();
  $("detail").scrollTop = 0;
}

function renderDetail() {
  const l = app.byKey[app.detailKey];
  if (!l) return;
  const myVote = (store.state.votes[l.key] || {})[app.me];
  const status = statusOf(store.state, l.key);
  const notes = store.state.notes[l.key] || [];
  $("detail").innerHTML = `
    <div class="sheet-grab"></div>
    <div class="photo ${photoClass(l)}" style="${photoStyle(l)}">${photoInner(l)}${l.images?.length > 1 ? `<span class="photo-tag">${l.images.length} photos</span>` : ""}</div>
    <div class="price-line"><span class="serif" style="font-size:44px">${money(costOf(l))}</span><span class="muted small">${esc(priceNote(l))}</span></div>
    <div class="card-title" style="font-size:18px">${esc(l.title)}</div>
    <div style="margin-top:4px">${fitLine(l, myBudget())}</div>
    ${factsGrid(l)}
    ${alsoListed(l)}
    <h3>Rundown</h3>
    ${bulletList(l)}
    ${l.amenities?.length ? `<div class="chips" style="margin-top:8px">${l.amenities.map((a) => `<span class="chip">${esc(a)}</span>`).join("")}</div>` : ""}

    <h3>Your vote</h3>
    <div class="row-btns">
      <button class="btn ${myVote === "pass" ? "btn-ink" : ""}" type="button" data-vote="pass"><i class="ti ti-x" aria-hidden="true"></i> Pass</button>
      <button class="btn ${myVote === "like" ? "btn-ink" : ""}" type="button" data-vote="like"><i class="ti ti-heart" aria-hidden="true"></i> Like</button>
    </div>
    <div class="small muted" style="margin-top:8px;display:flex;gap:8px;align-items:center">${voteAvatars(store.state, l.key) || "No votes yet"}</div>

    <h3>Status</h3>
    <div class="seg">${STATUSES.map((s) => `<button class="pill ${s === status ? "on" : ""}" type="button" data-status="${s}">${STATUS_LABELS[s]}</button>`).join("")}</div>
    ${store.state.status[l.key]?.by ? `<div class="faint tiny" style="margin-top:6px">Set by ${esc(store.state.status[l.key].by)}</div>` : ""}

    <h3>Notes</h3>
    ${notes.map((n) => `<div class="note"><span class="avatar">${esc(initials(n.member))}</span><span><span class="faint tiny" style="display:block">${esc(n.member)} · ${esc(new Date(n.at).toLocaleDateString("en-CA", { month: "short", day: "numeric" }))}</span>${esc(n.text)}</span></div>`).join("") || '<p class="muted small">No notes yet. Add things like "basement rooms are tiny" or "landlord replied fast".</p>'}
    <form class="note-form" id="note-form">
      <input id="note-input" maxlength="500" placeholder="Landlord said viewings are Saturday" aria-label="Add a note">
      <button class="btn btn-ink" type="submit" style="padding:9px 16px">Add</button>
    </form>
    <div class="field-error" id="note-error"></div>

    <div class="row-btns" style="margin-top:18px">
      <button class="btn" type="button" data-share="${esc(l.key)}"><i class="ti ti-share" aria-hidden="true"></i> Share</button>
      ${safeUrl(l.url) ? `<a class="btn btn-ink" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open listing <i class="ti ti-external-link" aria-hidden="true"></i></a>` : ""}
    </div>`;
}

async function share(key) {
  const l = app.byKey[key];
  if (!l) return;
  const text = shareText(l);
  if (navigator.share) {
    try {
      await navigator.share({ title: l.title, text, url: l.url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return; // they closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it in your group chat");
  } catch {
    toast("Couldn't share. Long-press the listing link instead");
  }
}

// ---------- Filters ----------

function openFilters() {
  const f = app.filters;
  $("f-size").innerHTML = [null, 2, 3, 4, 5].map((n) =>
    `<button class="pill ${f.groupSize === n ? "on" : ""}" type="button" data-size="${n ?? ""}">${n ? n : "Any"}</button>`).join("");
  $("f-walk").innerHTML = [15, 30, 45, 60, 0].map((n) =>
    `<button class="pill ${f.maxWalk === n ? "on" : ""}" type="button" data-walk="${n}">${n ? `${n} min` : "Any"}</button>`).join("");
  $("f-min").value = f.minBudget;
  $("f-max").value = f.maxBudget;
  $("f-util").checked = f.utilitiesOnly;
  updateBudgetOut();
  $("filter-sheet").showModal();
}

function updateBudgetOut() {
  const lo = Number($("f-min").min), hi = Number($("f-min").max);
  const a = Number($("f-min").value), b = Number($("f-max").value);
  $("f-budget-out").textContent = budgetLabel(a, b);
  $("f-fill").style.left = `${((a - lo) / (hi - lo)) * 100}%`;
  $("f-fill").style.width = `${((b - a) / (hi - lo)) * 100}%`;
}

function setFilters(patch) {
  app.filters = { ...app.filters, ...patch };
  prefs.set("filters", app.filters);
  render();
}

// ---------- who are you / join ----------

function askWho() {
  $("name-grid").innerHTML = members.map((m) =>
    `<button class="btn ${m === app.me ? "btn-ink" : ""}" type="button" data-me="${esc(m)}">${esc(m)}</button>`).join("");
  $("onboard-note").textContent = prefs.get("code") ? "You're joining your group." : "";
  $("onboard").hidden = false;
}

function setMe(name) {
  app.me = name;
  prefs.set("me", name);
  voting.reset();
  $("onboard").hidden = true;
  deck.show([]);
  render();
}

function handleJoinLink() {
  const code = parseJoinHash(location.hash);
  if (!code) return false;
  prefs.set("code", code);
  history.replaceState(null, "", location.pathname + location.search); // hide the code from the address bar
  toast("Joined the group");
  return true;
}

// An iPhone Home Screen app keeps its own storage, separate from Safari, and opens without the
// #join= part. Tapping the invite link in the group chat opens Safari, so the app can never join
// that way. Pasting the link (or just the code) here works everywhere.
function joinForm() {
  return `<form class="join-form" data-join-form>
      <input name="invite" placeholder="Paste invite link" aria-label="Invite link or code" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go">
      <button class="btn btn-ink" type="submit" style="padding:9px 16px">Join</button>
    </form>
    <div class="field-error" data-join-error></div>`;
}

async function joinWithInvite(form) {
  const error = form.parentElement.querySelector("[data-join-error]");
  const code = parseInviteInput(form.elements.invite.value);
  if (!code) {
    error.textContent = "That's not an invite link. Copy the whole link from your group chat (it ends in #join=…).";
    return;
  }
  // Check the code before saving it, so a typo can't knock you out of a group you're already in
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const sb = CONFIG.supabase;
    if (sb?.url && sb?.anonKey) await new SupabaseGroupStore({ ...sb, code }).load();
  } catch (err) {
    error.textContent = err.message; // e.g. "This invite link isn't valid. Ask your group for a new one."
    button.disabled = false;
    return;
  }
  prefs.set("code", code);
  location.reload();
}

// ---------- events ----------

function bindEvents() {
  document.querySelector(".tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) setTab(b.dataset.tab);
  });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-open],[data-share],[data-filters],[data-order],[data-tab-go],[data-scroll],[data-close],[data-me]");
    if (!t) return;
    if (t.dataset.open !== undefined) openDetail(t.dataset.open);
    else if (t.dataset.share !== undefined) share(t.dataset.share);
    else if (t.dataset.filters !== undefined) openFilters();
    else if (t.dataset.order !== undefined) toggleOrder();
    else if (t.dataset.tabGo) setTab(t.dataset.tabGo);
    else if (t.dataset.scroll) $(t.dataset.scroll).scrollIntoView({ behavior: "smooth" });
    else if (t.dataset.close !== undefined) t.closest("dialog")?.close();
    else if (t.dataset.me !== undefined) setMe(t.dataset.me);
  });

  // A join link opened while the app is already open only changes the #part, without reloading
  window.addEventListener("hashchange", () => {
    if (!handleJoinLink()) return;
    if (CONFIG.supabase) location.reload(); // reconnect with the new group code
    else render();
  });

  // Saving to the group failed (offline, bad link...): explain, and redraw with what's really saved.
  window.addEventListener("unhandledrejection", (e) => {
    if (!(e.reason instanceof GroupError)) return;
    e.preventDefault();
    toast(e.reason.message);
    deck.show([]); // a swiped card may be mid-flight off screen: rebuild so it comes back
    render();
  });

  $("me-chip").onclick = askWho;
  $("btn-like").onclick = () => deck.swipe("like");
  $("btn-pass").onclick = () => deck.swipe("pass");
  $("btn-info").onclick = () => deck.flip();
  $("btn-undo").onclick = undoLast;
  $("match-keep").onclick = () => ($("match").hidden = true);

  document.addEventListener("keydown", (e) => {
    if (app.tab !== "discover" || document.querySelector("dialog[open]") || !$("onboard").hidden) return;
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight") deck.swipe("like");
    else if (e.key === "ArrowLeft") deck.swipe("pass");
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); deck.flip(); }
    else if (e.key === "z" && (e.metaKey || e.ctrlKey)) undoLast();
  });

  $("sort").onchange = (e) => {
    app.sort = e.target.value;
    prefs.set("sort", app.sort);
    render();
  };

  // Detail sheet actions
  $("detail").addEventListener("click", async (e) => {
    const v = e.target.closest("[data-vote]");
    const s = e.target.closest("[data-status]");
    const l = app.byKey[app.detailKey];
    if (!l) return;
    if (v) {
      if (!app.me) return askWho();
      const current = (store.state.votes[l.key] || {})[app.me];
      const next = current === v.dataset.vote ? null : v.dataset.vote; // tap again to clear
      if (next) await castVote(l, next);
      else { await store.vote(l.key, app.me, null); render(); }
      renderDetail();
    } else if (s) {
      if (!app.me) return askWho();
      await store.setStatus(l.key, s.dataset.status, app.me);
      render();
      renderDetail();
    }
  });
  $("detail").addEventListener("submit", async (e) => {
    if (e.target.id !== "note-form") return;
    e.preventDefault();
    if (!app.me) return askWho();
    const ok = await store.addNote(app.detailKey, app.me, $("note-input").value);
    if (!ok) {
      $("note-error").textContent = "Write something first.";
      return;
    }
    renderDetail();
  });
  $("detail").addEventListener("input", (e) => {
    if (e.target.id === "note-input") $("note-error").textContent = "";
  });
  $("detail-sheet").addEventListener("close", () => (app.detailKey = null));

  // Paste-to-join, in the banner and on the Group tab
  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-join-form]");
    if (!form) return;
    e.preventDefault();
    joinWithInvite(form);
  });
  document.addEventListener("input", (e) => {
    const form = e.target.closest("[data-join-form]");
    if (form) form.parentElement.querySelector("[data-join-error]").textContent = "";
  });

  // Group tab
  $("group").addEventListener("submit", (e) => {
    if (e.target.id === "budget-form") saveBudget(e);
  });
  $("group").addEventListener("input", (e) => {
    if (e.target.id === "budget-input") $("budget-error").textContent = "";
  });
  $("group").addEventListener("change", (e) => {
    if (e.target.id === "budget-input") e.target.form.requestSubmit();
  });
  $("group").addEventListener("click", async (e) => {
    if (e.target.closest("#switch-person")) askWho();
    if (e.target.closest("#copy-invite")) {
      try {
        await navigator.clipboard.writeText($("group").querySelector(".invite code").textContent);
        toast("Invite link copied");
      } catch {
        toast("Couldn't copy. Long-press the link instead");
      }
    }
  });

  // Filters
  $("f-size").addEventListener("click", (e) => {
    const b = e.target.closest("[data-size]");
    if (!b) return;
    setFilters({ groupSize: b.dataset.size ? Number(b.dataset.size) : null });
    for (const x of $("f-size").children) x.classList.toggle("on", x === b);
  });
  $("f-walk").addEventListener("click", (e) => {
    const b = e.target.closest("[data-walk]");
    if (!b) return;
    setFilters({ maxWalk: Number(b.dataset.walk) });
    for (const x of $("f-walk").children) x.classList.toggle("on", x === b);
  });
  for (const id of ["f-min", "f-max"]) {
    $(id).addEventListener("input", () => {
      let a = Number($("f-min").value), b = Number($("f-max").value);
      if (a > b) {
        if (id === "f-min") $("f-max").value = b = a;
        else $("f-min").value = a = b;
      }
      updateBudgetOut();
    });
    $(id).addEventListener("change", () => setFilters({ minBudget: Number($("f-min").value), maxBudget: Number($("f-max").value) }));
  }
  $("f-util").onchange = (e) => setFilters({ utilitiesOnly: e.target.checked });
  $("f-reset").onclick = () => {
    setFilters({ ...DEFAULT_FILTERS, groupSize: members.length >= 2 && members.length <= 5 ? members.length : null });
    openFilters();
  };
  // Tap outside a sheet closes it
  for (const dlg of document.querySelectorAll("dialog.sheet")) {
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  }
}

// ---------- start ----------

// Shared group database if it's set up and this phone has the invite code; otherwise practice mode.
async function connectStore() {
  const code = prefs.get("code");
  const sb = CONFIG.supabase;
  if (sb?.url && sb?.anonKey && code) {
    const shared = new SupabaseGroupStore({ ...sb, code });
    try {
      await shared.load();
      if (shared.members.length) members = shared.members;
      shared.startPolling();
      return shared;
    } catch (err) {
      // A bad code gets the paste box too, so a fresh link from the group can replace it
      showGroupBanner(`${err.message} Votes are saved on this phone only for now.`, { join: /bad group code/i.test(err.raw || "") });
    }
  } else if (sb?.url && !code) {
    showGroupBanner("To join your group, open the invite link from your group chat or paste it here. Until then, votes stay on this phone.", { join: true });
  }
  const local = new LocalGroupStore();
  await local.load();
  return local;
}

function showGroupBanner(text, { join = false } = {}) {
  $("group-banner").innerHTML = `<div>${esc(text)}</div>${join ? joinForm() : ""}`;
  $("group-banner").hidden = false;
}

async function start() {
  handleJoinLink();
  bindEvents();
  store = await connectStore();
  voting = new Voting(store, () => members);
  store.onChange((state, info) => {
    if (info?.remote) render(); // someone else's change (another tab, or the group database)
    if (app.detailKey && $("detail-sheet").open) renderDetail();
  });

  // First visit: default the group-size filter to the number of people in the group.
  if (!prefs.get("filters") && members.length >= 2 && members.length <= 5) {
    app.filters.groupSize = members.length;
  }

  try {
    const { data, sample } = await loadListings();
    app.listings = data.listings.filter((l) => l && l.key);
    app.byKey = Object.fromEntries(app.listings.map((l) => [l.key, l]));
    // "New for me" = not here on my previous visit (tracked by house, so no date or time-zone mix-ups)
    app.seen = visitBaseline(app.listings.map((l) => l.key));
    app.sample = sample;
    app.lastRun = data.last_run;
    if (sample) {
      $("data-banner").hidden = false;
      $("data-banner").textContent = "These are sample houses. Real listings appear here after the scraper's first run.";
    }
  } catch (err) {
    $("data-banner").hidden = false;
    $("data-banner").textContent = "Couldn't load listings. Check your connection and refresh.";
    console.error(err);
  }

  setTab(app.tab);
  if (!app.me || !members.includes(app.me)) askWho();
}

start();
