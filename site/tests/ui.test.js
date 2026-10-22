import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alsoListed, bulletList, esc, factsGrid, isNewFor, listRow, pastel, photoStyle, priceNote, reasonChips, sourceName,
} from "../js/ui.js";

const empty = { votes: {}, notes: {}, status: {}, budgets: {} };
const base = {
  key: "1 test st", title: "1 Test St", bedrooms: 4, baths: 2, price_per_person: 900, est_cost_per_person: 1000,
  utilities_included: "no", walk_min_huron: 10, first_seen: "2026-10-20", is_new: false, images: [],
};

test("esc blocks HTML in scraped text", () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(esc("Tom's & Jerry's"), "Tom&#39;s &amp; Jerry&#39;s");
  assert.equal(esc(null), "");
});

test("a listing with HTML in its title or bullets can't inject markup", () => {
  const evil = { ...base, title: "<script>alert(1)</script>", highlights: ["<b>bold</b>"], heads_up: [] };
  const row = listRow(evil, empty);
  assert.ok(!row.includes("<script>"));
  assert.ok(row.includes("&lt;script&gt;"));
  assert.ok(!bulletList(evil).includes("<b>"));
  assert.ok(!factsGrid({ ...evil, neighbourhood: "<i>x</i>" }).includes("<i>x</i>"));
});

test("only https photo URLs are used", () => {
  assert.match(photoStyle({ ...base, images: ["https://offcampus.uwo.ca/a.jpg"] }), /background-image:url\('https:\/\/offcampus/);
  assert.doesNotMatch(photoStyle({ ...base, images: ["javascript:alert(1)"] }), /url\(/);
  assert.doesNotMatch(photoStyle({ ...base, images: ["http://insecure.example/a.jpg"] }), /url\(/);
  assert.match(photoStyle(base), /background-color/);
});

test("why-suggested chips escape house titles and only use known tones", () => {
  assert.equal(reasonChips([]), "");
  const html = reasonChips([
    { text: "Similar to <b>1 Evil St</b> (2 liked)", tone: "" },
    { text: "$50 over Jack's budget", tone: "warn" },
    { text: "x", tone: '"><script>' },
  ]);
  assert.ok(!html.includes("<b>") && !html.includes("<script>"));
  assert.match(html, /class="chip warn">\$50 over Jack&#39;s budget/);
});

test("placeholder colour is stable for the same house", () => {
  assert.deepEqual(pastel("1 test st"), pastel("1 test st"));
});

test("new for me: not listed on my previous visit; first visit uses the scraper's is_new", () => {
  assert.equal(isNewFor({ ...base, is_new: true }, null), true);
  assert.equal(isNewFor(base, null), false);
  assert.equal(isNewFor(base, new Set(["other"])), true);
  assert.equal(isNewFor(base, new Set([base.key])), false);
  assert.equal(isNewFor({ ...base, is_new: true }, new Set([base.key])), false); // I've already seen it
});

test("also listed shows safe links to the other sites", () => {
  assert.equal(alsoListed(base), "");
  assert.equal(alsoListed({ ...base, also_listed: [] }), "");
  const html = alsoListed({ ...base, also_listed: [
    { source: "kijiji", source_id: "1", url: "https://www.kijiji.ca/v/1" },
    { source: "evil", source_id: "2", url: "javascript:alert(1)" },
    { source: "new_site", source_id: "3", url: "https://example.ca/3" },
  ] });
  assert.match(html, /Also listed on <a href="https:\/\/www\.kijiji\.ca\/v\/1"[^>]*>Kijiji/);
  assert.match(html, /new site/);
  assert.doesNotMatch(html, /javascript:/);
  assert.equal(sourceName("western_och"), "Western Off-Campus Housing");
});

test("price note explains utilities", () => {
  assert.equal(priceNote({ ...base, utilities_included: "yes" }), "/ person, utilities incl.");
  assert.equal(priceNote(base), "/ person incl. ~$100 utilities");
  assert.equal(priceNote({ ...base, utilities_included: "unknown" }), "/ person, utilities unclear");
});

test("safeUrl only allows plain https links", async () => {
  const { safeUrl } = await import("../js/ui.js");
  assert.equal(safeUrl("https://offcampus.uwo.ca/Listings/Details/63747"), "https://offcampus.uwo.ca/Listings/Details/63747");
  assert.equal(safeUrl("http://example.ca/a"), null);
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://x.ca/a.jpg');background:url('https://evil"), null); // quote breakout
  assert.equal(safeUrl("https://x.ca/a(1).jpg"), null);
  assert.equal(safeUrl("https://x.ca/a b.jpg"), null);
  assert.equal(safeUrl(null), null);
});

test("a photo URL with a quote can't break out of the style attribute", () => {
  const style = photoStyle({ ...base, images: ["https://x.ca/a.jpg');} body{display:none} x{('"] });
  assert.doesNotMatch(style, /url\(/);
  assert.match(style, /background-color/);
});

test("counts from the data are printed as numbers only", async () => {
  const { num } = await import("../js/ui.js");
  assert.equal(num(4), 4);
  assert.equal(num(1.5), 1.5);
  assert.equal(num("<b>4</b>"), "–");
  assert.equal(num(null), "–");
  const row = listRow({ ...base, bedrooms: "<img src=x onerror=alert(1)>" }, empty);
  assert.ok(!row.includes("<img"));
  assert.ok(factsGrid({ ...base, lease_term_months: 12 }).includes("12 months"));
});
