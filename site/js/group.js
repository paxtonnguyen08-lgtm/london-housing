// Group state: votes, notes, status per house, viewing scorecards, and everyone's budgets.
//
// LocalGroupStore keeps it on this device (localStorage). A Supabase store with the same
// methods replaces it once the database is set up, so the screens don't change.
import { STATUSES } from "./logic.js";
import { cleanScorecard, isEmptyScorecard, putScorecard } from "./scorecard.js";

export function emptyState() {
  return { votes: {}, notes: {}, status: {}, budgets: {}, scorecards: {} };
}

const MAX_NOTE = 500;

export class LocalGroupStore {
  constructor(storage = globalThis.localStorage, storageKey = "lh_group_v1", events = globalThis) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.state = emptyState();
    this.shared = false; // true for a store everyone in the group sees
    this.listeners = [];
    // Another tab on this device saved: pick up its changes so we don't overwrite them.
    events?.addEventListener?.("storage", (e) => {
      if (e.key !== this.storageKey) return;
      this._read();
      this._notify({ remote: true });
    });
  }

  _read() {
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (raw) this.state = { ...emptyState(), ...JSON.parse(raw) };
    } catch {
      // private browsing or corrupted data: keep what we have in memory
    }
  }

  async load() {
    this._read();
    return this.state;
  }

  // fn(state, { remote }) — remote is true when the change came from somewhere else
  onChange(fn) {
    this.listeners.push(fn);
  }

  _notify(info) {
    this.listeners.forEach((fn) => fn(this.state, info));
  }

  // Re-read before every change so two open tabs never undo each other's votes.
  _update(change) {
    this._read();
    change(this.state);
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      // storage full or blocked: keep working in memory
    }
    this._notify({ remote: false });
  }

  // vote = "like", "pass", or null to clear
  async vote(key, member, vote) {
    if (vote !== null && vote !== "like" && vote !== "pass") throw new Error(`bad vote ${vote}`);
    this._update((s) => {
      const votes = { ...(s.votes[key] || {}) };
      if (vote === null) delete votes[member];
      else votes[member] = vote;
      s.votes[key] = votes;
    });
  }

  async addNote(key, member, text) {
    const clean = (text || "").trim().slice(0, MAX_NOTE);
    if (!clean) return false;
    this._update((s) => {
      s.notes[key] = [...(s.notes[key] || []), { member, text: clean, at: new Date().toISOString() }];
    });
    return true;
  }

  async setStatus(key, status, member) {
    if (!STATUSES.includes(status)) throw new Error(`bad status ${status}`);
    this._update((s) => {
      s.status[key] = { status, by: member, at: new Date().toISOString() };
    });
  }

  async setBudget(member, amount) {
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n < 300 || n > 5000) return false;
    this._update((s) => {
      s.budgets[member] = n;
    });
    return true;
  }

  // My viewing scorecard for a house (see scorecard.js). Saving again replaces it; saving an
  // empty one removes it. Returns true if saved, false if it was empty.
  async saveScorecard(key, member, card) {
    const clean = cleanScorecard(card); // throws on a rating that isn't 1–5
    this._update((s) => putScorecard(s, key, member, clean));
    return !isEmptyScorecard(clean);
  }
}

// Which houses were already listed on my previous visit, as a Set of keys (null on a first visit).
// Reloads during the same visit keep the same answer (sessionStorage), so "New" tags don't vanish
// on refresh; the next time the app is opened fresh, today's houses become the new baseline.
export function visitBaseline(currentKeys, local = globalThis.localStorage, session = globalThis.sessionStorage) {
  const read = (store, key) => {
    try {
      const raw = store?.getItem(key);
      return raw === null || raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const write = (store, key, value) => {
    try {
      store?.setItem(key, JSON.stringify(value));
    } catch {
      // blocked storage: every house just looks new or not, no harm
    }
  };
  let baseline = read(session, "lh_baseline");
  if (baseline === undefined) {
    baseline = read(local, "lh_seenKeys") ?? null;
    write(session, "lh_baseline", baseline);
  }
  write(local, "lh_seenKeys", [...currentKeys]);
  return Array.isArray(baseline) ? new Set(baseline) : null;
}

// Small per-device preferences (who I am, my filters, which tab I was on).
export const prefs = {
  get(name, fallback = null) {
    try {
      const raw = globalThis.localStorage?.getItem("lh_" + name);
      return raw === null || raw === undefined ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(name, value) {
    try {
      globalThis.localStorage?.setItem("lh_" + name, JSON.stringify(value));
    } catch {
      // ignore: preferences are a convenience
    }
  },
};
