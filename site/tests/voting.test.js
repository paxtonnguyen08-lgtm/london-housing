import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalGroupStore } from "../js/group.js";
import { statusOf } from "../js/logic.js";
import { Deck } from "../js/swipe.js";
import { Voting } from "../js/voting.js";

const members = ["Paxton", "Jordan", "Maya", "Sam"];
const memoryStorage = () => {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)) };
};
const freshStore = async () => {
  const s = new LocalGroupStore(memoryStorage(), "lh_group_v1", null);
  await s.load();
  return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pretend the network is slow: every vote takes 300 ms to save.
function slow(store) {
  const real = store.vote.bind(store);
  store.calls = 0;
  store.vote = async (...args) => {
    store.calls++;
    await sleep(300);
    return real(...args);
  };
  return store;
}

test("deck: two quick swipes on a slow save vote only once", async () => {
  const votes = [];
  const store = slow(await freshStore());
  const deck = new Deck({ innerHTML: "", appendChild() {} }, {
    renderFront: () => "", renderBack: () => "",
    onVote: async (l, v) => {
      await store.vote(l.key, "Paxton", v);
      votes.push([l.key, v]);
    },
  });
  // Skip the DOM: give the deck its items and a fake card directly
  deck.items = [{ key: "a", title: "A" }, { key: "b", title: "B" }];
  deck.card = { classList: { add() {} }, style: {}, querySelector: () => null };
  const first = deck.swipe("like");
  await sleep(280); // past the fly-off animation, while the save is still running
  const second = deck.swipe("like"); // a second tap on the same card
  await Promise.all([first, second]);
  assert.equal(store.calls, 1);
  assert.deepEqual(votes, [["a", "like"]]);
  assert.equal(deck.busy, false);
});

test("deck: busy is cleared even if saving fails", async () => {
  const deck = new Deck({ innerHTML: "", appendChild() {} }, {
    renderFront: () => "", renderBack: () => "", onVote: async () => { throw new Error("offline"); },
  });
  deck.items = [{ key: "a", title: "A" }];
  deck.card = { classList: { add() {} }, style: {}, querySelector: () => null };
  await assert.rejects(deck.swipe("pass"));
  assert.equal(deck.busy, false);
});

test("voting: a second vote on the same house while one is saving is ignored", async () => {
  const store = slow(await freshStore());
  const v = new Voting(store, () => members);
  const [a, b] = await Promise.all([v.cast("k", "Paxton", "like"), v.cast("k", "Paxton", "like")]);
  assert.deepEqual(a, { match: false });
  assert.equal(b, null);
  assert.equal(store.calls, 1);
  assert.equal(v.history.length, 1);
});

test("voting: the last like makes a match and sets Interested", async () => {
  const store = await freshStore();
  for (const m of ["Jordan", "Maya", "Sam"]) await store.vote("k", m, "like");
  const v = new Voting(store, () => members);
  assert.deepEqual(await v.cast("k", "Paxton", "like"), { match: true });
  assert.equal(statusOf(store.state, "k"), "interested");
  assert.equal(store.state.status.k.by, "Paxton");
});

test("voting: undo after a match takes back the vote and the auto status", async () => {
  const store = await freshStore();
  for (const m of ["Paxton", "Maya", "Sam"]) await store.vote("k", m, "like");
  const v = new Voting(store, () => members);
  await v.cast("k", "Jordan", "like"); // match
  await v.cast("other", "Jordan", "pass"); // keeps swiping
  await v.undo("Jordan"); // undoes "other"
  await v.undo("Jordan"); // undoes the match
  assert.equal(store.state.votes.k.Jordan, undefined);
  assert.equal(statusOf(store.state, "k"), "new");
  assert.equal(v.canUndo, false);
});

test("voting: undo keeps a status someone set by hand after the match", async () => {
  const store = await freshStore();
  for (const m of ["Paxton", "Maya", "Sam"]) await store.vote("k", m, "like");
  const v = new Voting(store, () => members);
  await v.cast("k", "Jordan", "like");
  await store.setStatus("k", "viewing", "Maya"); // Maya booked a viewing
  await v.undo("Jordan");
  assert.equal(statusOf(store.state, "k"), "viewing");
});

test("voting: undo restores the earlier vote, and does nothing with no history", async () => {
  const store = await freshStore();
  const v = new Voting(store, () => members);
  assert.equal(await v.undo("Paxton"), null);
  await v.cast("k", "Paxton", "pass");
  await v.cast("k", "Paxton", "like"); // changed mind
  await v.undo("Paxton");
  assert.equal(store.state.votes.k.Paxton, "pass");
});

test("voting: a failed save leaves nothing to undo", async () => {
  const store = await freshStore();
  store.vote = async () => { throw new Error("offline"); };
  const v = new Voting(store, () => members);
  await assert.rejects(v.cast("k", "Paxton", "like"));
  assert.equal(v.canUndo, false);
  assert.equal(v.inFlight.size, 0);
});
