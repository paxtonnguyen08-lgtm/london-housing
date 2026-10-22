// Runs supabase/schema.sql on a real (in-memory) Postgres and calls it the way the web page
// will: as Supabase's public "anon" role, which only gets the page's functions.
//   cd supabase && npm install && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const CODE = "maple-otter-42-lantern";
const MEMBERS = ["Paxton", "Jordan", "Maya", "Sam"];
const KEY = "western_och:63747";

async function fresh() {
  const db = new PGlite();
  // Supabase creates these roles itself; a plain Postgres needs them made first.
  await db.exec("create role anon nologin; create role authenticated nologin;");
  await db.exec(SCHEMA);
  await db.query("select setup_group($1, $2)", [CODE, MEMBERS]);
  return db;
}

// Run one statement as the web page would (the public anon key).
async function page(db, sql, params = []) {
  await db.exec("set role anon");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}

const state = async (db, code = CODE) =>
  (await page(db, "select get_group_state($1) as s", [code])).rows[0].s;

test("schema can be run twice without errors", async () => {
  const db = await fresh();
  await db.exec(SCHEMA);
  await page(db, "select group_vote($1, $2, $3, $4)", [CODE, KEY, "Maya", "like"]);
  await db.exec(SCHEMA);
  assert.deepEqual((await state(db)).votes, { [KEY]: { Maya: "like" } });
});

test("empty group state has the same shape as the page's emptyState()", async () => {
  const db = await fresh();
  assert.deepEqual(await state(db), { members: MEMBERS, votes: {}, notes: {}, status: {}, budgets: {} });
});

test("the page can't read or write tables directly", async () => {
  const db = await fresh();
  for (const sql of [
    "select * from settings",
    "select * from votes",
    "select * from push_subs",
    "insert into votes (listing_key, member, vote) values ('k', 'Maya', 'like')",
    "delete from notes",
  ]) {
    await assert.rejects(page(db, sql), /permission denied/, sql);
  }
});

test("the page can't call setup or helper functions", async () => {
  const db = await fresh();
  await assert.rejects(page(db, "select setup_group('another-long-code', array['Eve'])"), /permission denied/);
  await assert.rejects(page(db, "select _check($1)", [CODE]), /permission denied/);
  await assert.rejects(page(db, "select _code_hash('x')"), /permission denied/);
});

test("every page function rejects a wrong group code", async () => {
  const db = await fresh();
  const bad = "not-the-code-at-all";
  for (const [sql, params] of [
    ["select get_group_state($1)", [bad]],
    ["select group_vote($1, $2, $3, $4)", [bad, KEY, "Maya", "like"]],
    ["select group_add_note($1, $2, $3, $4)", [bad, KEY, "Maya", "hi"]],
    ["select group_set_status($1, $2, $3, $4)", [bad, KEY, "interested", "Maya"]],
    ["select group_set_budget($1, $2, $3)", [bad, "Maya", 1000]],
    ["select save_push_sub($1, $2, $3)", [bad, "Maya", { endpoint: "https://push.example/1" }]],
    ["select get_group_state($1)", [null]],
  ]) {
    await assert.rejects(page(db, sql, params), /bad group code/, sql);
  }
  assert.deepEqual((await state(db)).votes, {});
});

test("only the hash of the code is stored", async () => {
  const db = await fresh();
  const { rows } = await db.query("select group_code_hash from settings");
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].group_code_hash, CODE);
  assert.match(rows[0].group_code_hash, /^[0-9a-f]{64}$/);
});

test("votes: like, change to pass, clear, and per-member", async () => {
  const db = await fresh();
  const vote = (m, v) => page(db, "select group_vote($1, $2, $3, $4)", [CODE, KEY, m, v]);
  await vote("Maya", "like");
  await vote("Sam", "like");
  await vote("Maya", "pass");
  assert.deepEqual((await state(db)).votes, { [KEY]: { Maya: "pass", Sam: "like" } });
  await vote("Maya", null);
  assert.deepEqual((await state(db)).votes, { [KEY]: { Sam: "like" } });
  await assert.rejects(vote("Maya", "love"), /bad vote/);
  await assert.rejects(vote("Eve", "like"), /unknown member/);
});

test("notes: trimmed, empty ignored, capped at 500, kept in order", async () => {
  const db = await fresh();
  const note = (m, t) =>
    page(db, "select group_add_note($1, $2, $3, $4) as ok", [CODE, KEY, m, t]).then((r) => r.rows[0].ok);
  assert.equal(await note("Maya", "  too far from Huron  "), true);
  assert.equal(await note("Sam", "   "), false);
  assert.equal(await note("Sam", null), false);
  assert.equal(await note("Sam", "x".repeat(600)), true);
  const notes = (await state(db)).notes[KEY];
  assert.deepEqual(notes.map((n) => [n.member, n.text.length]), [["Maya", 18], ["Sam", 500]]);
  assert.equal(notes[0].text, "too far from Huron");
  assert.ok(notes[0].at);
  await assert.rejects(note("Eve", "hi"), /unknown member/);
});

test("status: one per house, last update wins, bad status rejected", async () => {
  const db = await fresh();
  const set = (s, m) => page(db, "select group_set_status($1, $2, $3, $4)", [CODE, KEY, s, m]);
  await set("interested", "Maya");
  await set("viewing", "Sam");
  const s = (await state(db)).status[KEY];
  assert.equal(s.status, "viewing");
  assert.equal(s.by, "Sam");
  assert.ok(s.at);
  await assert.rejects(set("maybe", "Sam"), /check constraint|violates/);
});

test("budgets: same limits and rounding as the page", async () => {
  const db = await fresh();
  const budget = (m, n) =>
    page(db, "select group_set_budget($1, $2, $3) as ok", [CODE, m, n]).then((r) => r.rows[0].ok);
  assert.equal(await budget("Maya", 1199.6), true);
  assert.equal(await budget("Sam", 299), false);
  assert.equal(await budget("Sam", 5001), false);
  assert.equal(await budget("Sam", null), false);
  assert.deepEqual((await state(db)).budgets, { Maya: 1200 });
});

test("push subscriptions: need https, same phone updates instead of duplicating", async () => {
  const db = await fresh();
  const sub = (m, s) => page(db, "select save_push_sub($1, $2, $3)", [CODE, m, s]);
  const phone = { endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } };
  await sub("Maya", phone);
  await sub("Sam", phone); // phone handed to a friend
  const { rows } = await db.query("select member, subscription from push_subs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].member, "Sam");
  assert.equal(rows[0].subscription.keys.auth, "y");
  await assert.rejects(sub("Maya", { endpoint: "http://insecure" }), /https endpoint/);
  await assert.rejects(sub("Maya", {}), /https endpoint/);
});

test("setup_group: short codes refused; re-running changes the code but keeps votes", async () => {
  const db = await fresh();
  await assert.rejects(db.query("select setup_group('short', array['A'])"), /at least 12 characters/);
  await page(db, "select group_vote($1, $2, $3, $4)", [CODE, KEY, "Maya", "like"]);
  const { rows } = await db.query("select setup_group($1, $2) as msg", ["brand-new-code-2027", ["Paxton", "Alex"]]);
  assert.equal(rows[0].msg, "Group ready with 5 members");
  await assert.rejects(state(db), /bad group code/);
  const s = await state(db, "brand-new-code-2027");
  assert.deepEqual(s.votes, { [KEY]: { Maya: "like" } });
  assert.deepEqual(s.members, [...MEMBERS, "Alex"]);
});
