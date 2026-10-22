// Group state shared through Supabase, so everyone sees each other's votes, notes and budgets.
// Same methods as LocalGroupStore. Every call goes through a database function that checks the
// group code from the invite link (see supabase/schema.sql); nobody can read the tables directly.
import { emptyState } from "./group.js";
import { STATUSES } from "./logic.js";

const FRIENDLY = [
  [/bad group code/i, "This invite link isn't valid. Ask your group for a new one."],
  [/unknown member/i, "Your name isn't in this group. Pick your name again."],
];

export class GroupError extends Error {
  constructor(raw) {
    const match = FRIENDLY.find(([re]) => re.test(raw));
    super(match ? match[1] : "Couldn't reach the group database. Check your connection and try again.");
    this.raw = raw;
  }
}

const copy = (o) => JSON.parse(JSON.stringify(o));

export class SupabaseGroupStore {
  constructor({ url, anonKey, code, fetch = globalThis.fetch?.bind(globalThis), pollMs = 30000, env = globalThis }) {
    this.base = url.replace(/\/+$/, "");
    this.anonKey = anonKey;
    this.code = code;
    this.fetch = fetch;
    this.pollMs = pollMs;
    this.env = env;
    this.state = emptyState();
    this.members = [];
    this.shared = true;
    this.listeners = [];
    this.timer = null;
  }

  async rpc(name, params = {}) {
    let resp;
    try {
      resp = await this.fetch(`${this.base}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // apikey only: Supabase's newer publishable keys aren't JWTs, so they can't go in a Bearer header
          apikey: this.anonKey,
        },
        body: JSON.stringify({ p_code: this.code, ...params }),
      });
    } catch (err) {
      throw new GroupError(String(err)); // offline, DNS, etc.
    }
    const text = await resp.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!resp.ok) throw new GroupError(body?.message || `HTTP ${resp.status}`);
    return body;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  _notify(info) {
    this.listeners.forEach((fn) => fn(this.state, info));
  }

  _apply(s) {
    this.members = Array.isArray(s?.members) ? s.members : [];
    this.state = {
      votes: s?.votes || {},
      notes: s?.notes || {},
      status: s?.status || {},
      budgets: s?.budgets || {},
    };
  }

  async load() {
    this._apply(await this.rpc("get_group_state"));
    return this.state;
  }

  // Fetch the latest from the group; tell the page only if something changed.
  async refresh() {
    const before = JSON.stringify([this.members, this.state]);
    await this.load();
    if (JSON.stringify([this.members, this.state]) !== before) this._notify({ remote: true });
  }

  // Check for friends' changes every 30 s while the app is on screen, and right away when it comes back.
  startPolling() {
    this.stopPolling();
    const tick = () => {
      if (this.env.document?.visibilityState === "hidden") return; // app in the background: skip
      this.refresh().catch(() => {}); // a missed refresh just waits for the next one
    };
    this.timer = this.env.setInterval?.(tick, this.pollMs);
    this._onVisible = () => {
      if (this.env.document?.visibilityState === "visible") tick();
    };
    this.env.document?.addEventListener?.("visibilitychange", this._onVisible);
  }

  stopPolling() {
    if (this.timer) this.env.clearInterval?.(this.timer);
    this.timer = null;
    if (this._onVisible) this.env.document?.removeEventListener?.("visibilitychange", this._onVisible);
  }

  // Votes and status change on screen instantly, then save; if saving fails they're put back.
  async _optimistic(change, call) {
    const before = copy(this.state);
    change(this.state);
    this._notify({ remote: false });
    try {
      await call();
    } catch (err) {
      this.state = before;
      this._notify({ remote: false });
      throw err;
    }
  }

  async vote(key, member, vote) {
    if (vote !== null && vote !== "like" && vote !== "pass") throw new Error(`bad vote ${vote}`);
    await this._optimistic(
      (s) => {
        const votes = { ...(s.votes[key] || {}) };
        if (vote === null) delete votes[member];
        else votes[member] = vote;
        s.votes[key] = votes;
      },
      () => this.rpc("group_vote", { p_key: key, p_member: member, p_vote: vote }),
    );
  }

  async setStatus(key, status, member) {
    if (!STATUSES.includes(status)) throw new Error(`bad status ${status}`);
    await this._optimistic(
      (s) => {
        s.status[key] = { status, by: member, at: new Date().toISOString() };
      },
      () => this.rpc("group_set_status", { p_key: key, p_status: status, p_member: member }),
    );
  }

  async addNote(key, member, text) {
    const clean = (text || "").trim().slice(0, 500);
    if (!clean) return false;
    const ok = await this.rpc("group_add_note", { p_key: key, p_member: member, p_text: clean });
    if (ok) {
      this.state.notes[key] = [...(this.state.notes[key] || []), { member, text: clean, at: new Date().toISOString() }];
      this._notify({ remote: false });
    }
    return Boolean(ok);
  }

  async setBudget(member, amount) {
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n < 300 || n > 5000) return false;
    const ok = await this.rpc("group_set_budget", { p_member: member, p_amount: n });
    if (ok) {
      this.state.budgets[member] = n;
      this._notify({ remote: false });
    }
    return Boolean(ok);
  }
}
