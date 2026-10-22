import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalGroupStore, emptyState, visitBaseline } from "../js/group.js";

class MemoryStorage {
  constructor() { this.data = {}; }
  getItem(k) { return k in this.data ? this.data[k] : null; }
  setItem(k, v) { this.data[k] = String(v); }
}

test("votes can be set, changed and cleared, and survive a reload", async () => {
  const storage = new MemoryStorage();
  const s = new LocalGroupStore(storage);
  await s.load();
  await s.vote("1100 sunset st", "Paxton", "like");
  await s.vote("1100 sunset st", "Maya", "pass");
  await s.vote("1100 sunset st", "Maya", "like");
  assert.deepEqual(s.state.votes["1100 sunset st"], { Paxton: "like", Maya: "like" });
  await s.vote("1100 sunset st", "Paxton", null);
  assert.deepEqual(s.state.votes["1100 sunset st"], { Maya: "like" });

  const again = new LocalGroupStore(storage);
  await again.load();
  assert.deepEqual(again.state.votes["1100 sunset st"], { Maya: "like" });
});

test("bad votes and statuses are refused", async () => {
  const s = new LocalGroupStore(new MemoryStorage());
  await assert.rejects(s.vote("k", "Paxton", "love"));
  await assert.rejects(s.setStatus("k", "bought", "Paxton"));
});

test("notes are trimmed, capped, and empty ones ignored", async () => {
  const s = new LocalGroupStore(new MemoryStorage());
  assert.equal(await s.addNote("k", "Sam", "   "), false);
  assert.equal(await s.addNote("k", "Sam", "  basement rooms are tiny  "), true);
  await s.addNote("k", "Jordan", "x".repeat(900));
  assert.equal(s.state.notes.k[0].text, "basement rooms are tiny");
  assert.equal(s.state.notes.k[1].text.length, 500);
  assert.equal(s.state.notes.k[1].member, "Jordan");
});

test("status and budgets", async () => {
  const s = new LocalGroupStore(new MemoryStorage());
  await s.setStatus("k", "viewing", "Paxton");
  assert.equal(s.state.status.k.status, "viewing");
  assert.equal(s.state.status.k.by, "Paxton");
  assert.equal(await s.setBudget("Paxton", "1150"), true);
  assert.equal(await s.setBudget("Paxton", 50), false);
  assert.equal(await s.setBudget("Paxton", "lots"), false);
  assert.equal(s.state.budgets.Paxton, 1150);
});

test("listeners hear every change", async () => {
  const s = new LocalGroupStore(new MemoryStorage());
  let calls = 0;
  s.onChange(() => calls++);
  await s.vote("k", "Paxton", "like");
  await s.setStatus("k", "contacted", "Paxton");
  assert.equal(calls, 2);
});

test("two tabs on one phone don't erase each other's votes", async () => {
  const shared = new MemoryStorage();
  const tabA = new LocalGroupStore(shared, "lh_group_v1", null);
  const tabB = new LocalGroupStore(shared, "lh_group_v1", null);
  await tabA.load();
  await tabB.load(); // both start empty
  await tabA.vote("k1", "Paxton", "like");
  await tabB.vote("k2", "Sam", "like"); // tabB's memory didn't have tabA's vote
  await tabA.addNote("k1", "Paxton", "nice");
  const fresh = new LocalGroupStore(shared, "lh_group_v1", null);
  await fresh.load();
  assert.deepEqual(fresh.state.votes, { k1: { Paxton: "like" }, k2: { Sam: "like" } });
  assert.equal(fresh.state.notes.k1.length, 1);
});

test("a save in another tab refreshes this tab and tells the page", async () => {
  const shared = new MemoryStorage();
  const handlers = {};
  const fakeWindow = { addEventListener: (type, fn) => (handlers[type] = fn) };
  const tab = new LocalGroupStore(shared, "lh_group_v1", fakeWindow);
  await tab.load();
  const heard = [];
  tab.onChange((state, info) => heard.push(info));
  shared.setItem("lh_group_v1", JSON.stringify({ votes: { k: { Maya: "pass" } } }));
  handlers.storage({ key: "lh_other" }); // unrelated key: ignored
  handlers.storage({ key: "lh_group_v1" });
  assert.deepEqual(tab.state.votes, { k: { Maya: "pass" } });
  assert.deepEqual(heard, [{ remote: true }]);
  await tab.vote("k", "Paxton", "like");
  assert.deepEqual(heard[1], { remote: false });
});

test("new for me: a house found after my morning visit is new on my next visit", () => {
  const local = new MemoryStorage();
  // Mon 6 am, first ever visit: nothing to compare with yet
  assert.equal(visitBaseline(["A"], local, new MemoryStorage()), null);
  // Mon 7 am the scraper finds B. Tue I open the app again (a fresh visit = fresh sessionStorage).
  // By then B's is_new flag is false and its first_seen is Monday, which broke the date version.
  const tuesday = visitBaseline(["A", "B"], local, new MemoryStorage());
  assert.deepEqual([...tuesday], ["A"]);
  assert.equal(tuesday.has("B"), false); // so B shows as New
});

test("new for me: evening visits don't miss houses (no dates, so no UTC mix-up)", () => {
  const local = new MemoryStorage();
  visitBaseline(["A"], local, new MemoryStorage()); // Mon 9 pm Toronto (already Tue in UTC)
  const wed = visitBaseline(["A", "C"], local, new MemoryStorage()); // C found Tue, opened Wed
  assert.equal(wed.has("C"), false);
});

test("new for me: reloading during the same visit keeps the same New tags", () => {
  const local = new MemoryStorage();
  visitBaseline(["A"], local, new MemoryStorage());
  const session = new MemoryStorage();
  const first = visitBaseline(["A", "B"], local, session);
  const reload = visitBaseline(["A", "B"], local, session);
  assert.deepEqual([...reload], [...first]);
  assert.equal(reload.has("B"), false); // B is still New after a refresh
  // Next fresh visit: B is no longer new
  assert.equal(visitBaseline(["A", "B"], local, new MemoryStorage()).has("B"), true);
});

test("new for me: blocked storage doesn't crash", () => {
  const broken = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  assert.equal(visitBaseline(["A"], broken, broken), null);
});

test("broken or missing storage doesn't crash", async () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const s = new LocalGroupStore(broken);
  assert.deepEqual(await s.load(), emptyState());
  await s.vote("k", "Paxton", "like"); // keeps working in memory
  assert.equal(s.state.votes.k.Paxton, "like");

  const corrupt = new MemoryStorage();
  corrupt.setItem("lh_group_v1", "{not json");
  const c = new LocalGroupStore(corrupt);
  assert.deepEqual(await c.load(), emptyState());

  const none = new LocalGroupStore(undefined);
  assert.deepEqual(await none.load(), emptyState());
});
