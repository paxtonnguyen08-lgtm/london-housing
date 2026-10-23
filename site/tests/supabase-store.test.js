import { test } from "node:test";
import assert from "node:assert/strict";
import { GroupError, SupabaseGroupStore } from "../js/supabase-store.js";

// A stand-in for the Supabase server: records calls and answers like PostgREST would.
function fakeServer(handlers = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const name = url.split("/rpc/")[1];
    const body = JSON.parse(init.body);
    calls.push({ url, name, body, headers: init.headers, method: init.method });
    const h = handlers[name];
    const out = typeof h === "function" ? h(body) : h;
    if (out instanceof Error) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ code: "P0001", message: out.message }) };
    }
    return { ok: true, status: 200, text: async () => (out === undefined ? "" : JSON.stringify(out)) };
  };
  return { fetch, calls };
}

const STATE = {
  members: ["Paxton", "Jordan", "Maya", "Sam"],
  votes: { "western_och:1": { Jordan: "like" } },
  notes: {},
  status: {},
  budgets: { Jordan: 1100 },
};

const make = (handlers) => {
  const server = fakeServer({ get_group_state: STATE, ...handlers });
  const store = new SupabaseGroupStore({
    url: "https://abc.supabase.co/", anonKey: "anon-key", code: "our-secret-code", fetch: server.fetch, env: {},
  });
  return { store, calls: server.calls };
};

test("load calls get_group_state with the code and the right headers", async () => {
  const { store, calls } = make();
  const state = await store.load();
  assert.equal(calls[0].url, "https://abc.supabase.co/rest/v1/rpc/get_group_state");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { p_code: "our-secret-code" });
  assert.equal(calls[0].headers.apikey, "anon-key");
  assert.equal(calls[0].headers.Authorization, undefined); // publishable keys aren't JWTs
  assert.deepEqual(store.members, ["Paxton", "Jordan", "Maya", "Sam"]);
  assert.deepEqual(state.votes, STATE.votes);
  assert.equal(store.shared, true);
});

test("each change calls its function with the exact parameter names", async () => {
  const { store, calls } = make({ group_vote: undefined, group_set_status: undefined, group_add_note: true, group_set_budget: true });
  await store.load();
  await store.vote("western_och:1", "Paxton", "like");
  await store.vote("western_och:1", "Paxton", null);
  await store.setStatus("western_och:1", "viewing", "Paxton");
  assert.equal(await store.addNote("western_och:1", "Paxton", "  call landlord  "), true);
  assert.equal(await store.setBudget("Paxton", "1150.4"), true);
  const sent = calls.slice(1).map((c) => [c.name, c.body]);
  assert.deepEqual(sent, [
    ["group_vote", { p_code: "our-secret-code", p_key: "western_och:1", p_member: "Paxton", p_vote: "like" }],
    ["group_vote", { p_code: "our-secret-code", p_key: "western_och:1", p_member: "Paxton", p_vote: null }],
    ["group_set_status", { p_code: "our-secret-code", p_key: "western_och:1", p_status: "viewing", p_member: "Paxton" }],
    ["group_add_note", { p_code: "our-secret-code", p_key: "western_och:1", p_member: "Paxton", p_text: "call landlord" }],
    ["group_set_budget", { p_code: "our-secret-code", p_member: "Paxton", p_amount: 1150 }],
  ]);
  assert.equal(store.state.status["western_och:1"].status, "viewing");
  assert.equal(store.state.notes["western_och:1"][0].text, "call landlord");
  assert.equal(store.state.budgets.Paxton, 1150);
});

test("a vote shows instantly, and is put back if saving fails", async () => {
  let release;
  const { store } = make({ group_vote: () => new Promise((r) => (release = r)) });
  await store.load();
  const pending = store.vote("western_och:2", "Sam", "like");
  assert.equal(store.state.votes["western_och:2"].Sam, "like"); // before the server answers
  release(undefined);
  await pending;

  const failing = make({ group_vote: new Error("bad group code") });
  await failing.store.load();
  await assert.rejects(failing.store.vote("western_och:2", "Sam", "like"), GroupError);
  assert.equal(failing.store.state.votes["western_och:2"], undefined);
});

test("server errors become friendly messages", async () => {
  const bad = make({ get_group_state: new Error("bad group code") });
  await assert.rejects(bad.store.load(), { message: "This invite link isn't valid. Ask your group for a new one." });
  const who = make({ group_set_status: new Error("unknown member Bob") });
  await who.store.load();
  await assert.rejects(who.store.setStatus("k", "contacted", "Bob"), { message: "Your name isn't in this group. Pick your name again." });
  const offline = new SupabaseGroupStore({ url: "https://x.supabase.co", anonKey: "k", code: "c", fetch: async () => { throw new TypeError("Failed to fetch"); }, env: {} });
  await assert.rejects(offline.load(), { message: "Couldn't reach the group database. Check your connection and try again." });
});

test("empty notes and silly budgets never reach the server", async () => {
  const { store, calls } = make();
  await store.load();
  assert.equal(await store.addNote("k", "Paxton", "   "), false);
  assert.equal(await store.setBudget("Paxton", 99), false);
  assert.equal(await store.setBudget("Paxton", "lots"), false);
  await assert.rejects(store.vote("k", "Paxton", "love"));
  await assert.rejects(store.setStatus("k", "bought", "Paxton"));
  assert.equal(calls.length, 1); // only the load
});

test("refresh tells the page only when a friend changed something", async () => {
  let state = STATE;
  const server = fakeServer({ get_group_state: () => state });
  const store = new SupabaseGroupStore({ url: "https://x.supabase.co", anonKey: "k", code: "c", fetch: server.fetch, env: {} });
  await store.load();
  const heard = [];
  store.onChange((s, info) => heard.push(info));
  await store.refresh();
  assert.deepEqual(heard, []);
  state = { ...STATE, votes: { ...STATE.votes, "western_och:9": { Maya: "like" } } };
  await store.refresh();
  assert.deepEqual(heard, [{ remote: true }]);
  assert.equal(store.state.votes["western_och:9"].Maya, "like");
});

test("polling refreshes on a timer and when the app comes back on screen", async () => {
  let loads = 0;
  const server = fakeServer({ get_group_state: () => (loads++, STATE) });
  const listeners = {};
  let intervalFn = null;
  const env = {
    setInterval: (fn, ms) => ((intervalFn = fn), assert.equal(ms, 30000), 7),
    clearInterval: (id) => assert.equal(id, 7),
    document: {
      visibilityState: "visible",
      addEventListener: (t, fn) => (listeners[t] = fn),
      removeEventListener: (t) => delete listeners[t],
    },
  };
  const store = new SupabaseGroupStore({ url: "https://x.supabase.co", anonKey: "k", code: "c", fetch: server.fetch, env });
  await store.load();
  store.startPolling();
  intervalFn();
  listeners.visibilitychange();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(loads, 3);
  store.stopPolling();
  assert.equal(listeners.visibilitychange, undefined);
});

// A tiny in-memory copy of supabase/schema.sql's functions, shared by several "phones".
function groupServer(code = "our-group-code-2027", members = ["Alex", "Bea"]) {
  const db = { members, votes: {}, notes: {}, status: {}, budgets: {} };
  const fail = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ message }) });
  const ok = (v) => ({ ok: true, status: v === undefined ? 204 : 200, text: async () => (v === undefined ? "" : JSON.stringify(v)) });
  const fetch = async (url, init) => {
    const fn = url.split("/rpc/")[1];
    const p = JSON.parse(init.body);
    if (p.p_code !== code) return fail(403, "bad group code");
    if ("p_member" in p && !members.includes(p.p_member)) return fail(400, `unknown member ${p.p_member}`);
    if (fn === "get_group_state") return ok(JSON.parse(JSON.stringify(db)));
    if (fn === "group_vote") {
      const v = (db.votes[p.p_key] ||= {});
      if (p.p_vote === null) delete v[p.p_member];
      else v[p.p_member] = p.p_vote;
      return ok(undefined); // void function: empty 204 body
    }
    if (fn === "group_set_status") {
      db.status[p.p_key] = { status: p.p_status, by: p.p_member, at: "now" };
      return ok(undefined);
    }
    return fail(404, `no function ${fn}`);
  };
  return { fetch, db };
}

const phone = (server, code = "our-group-code-2027") =>
  new SupabaseGroupStore({ url: "https://x.supabase.co", anonKey: "sb_publishable_test", code, fetch: server.fetch, env: {} });

test("a vote from Alex's phone shows up in Bea's after a refresh", async () => {
  const server = groupServer();
  const alex = phone(server);
  const bea = phone(server);
  await alex.load();
  await bea.load();
  assert.equal(bea.state.votes["western_och:1"], undefined);
  await alex.vote("western_och:1", "Alex", "like"); // the server answers 204 with no body
  await alex.setStatus("western_och:1", "contacted", "Alex");
  let heard = 0;
  bea.onChange(() => heard++);
  await bea.refresh();
  assert.deepEqual(bea.state.votes["western_och:1"], { Alex: "like" });
  assert.equal(bea.state.status["western_och:1"].status, "contacted");
  assert.equal(heard, 1);
});

test("a wrong group code is reported, not silently ignored", async () => {
  const server = groupServer();
  const stranger = phone(server, "not-the-right-code");
  await assert.rejects(stranger.load(), (err) => {
    assert.ok(err instanceof GroupError);
    assert.equal(err.raw, "bad group code");
    assert.equal(err.message, "This invite link isn't valid. Ask your group for a new one.");
    return true;
  });
});

test("polling skips refreshes while the app is in the background", async () => {
  let loads = 0;
  const server = fakeServer({ get_group_state: () => (loads++, STATE) });
  let intervalFn = null;
  const doc = { visibilityState: "hidden", addEventListener() {}, removeEventListener() {} };
  const env = { setInterval: (fn) => ((intervalFn = fn), 1), clearInterval() {}, document: doc };
  const store = new SupabaseGroupStore({ url: "https://x.supabase.co", anonKey: "k", code: "c", fetch: server.fetch, env });
  await store.load();
  store.startPolling();
  intervalFn();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(loads, 1); // only the first load
  doc.visibilityState = "visible";
  intervalFn();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(loads, 2);
});

test("savePushSub files this phone's push address under my name, with the code", async () => {
  const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p", auth: "a" } };
  const { store, calls } = make({ save_push_sub: undefined });
  await store.savePushSub("Paxton", sub);
  assert.equal(calls[0].name, "save_push_sub");
  assert.deepEqual(calls[0].body, { p_code: "our-secret-code", p_member: "Paxton", p_sub: sub });
  const broken = make({ save_push_sub: new Error("bad group code") });
  await assert.rejects(broken.store.savePushSub("Paxton", sub), (err) => err instanceof GroupError && /isn't valid/.test(err.message));
});
