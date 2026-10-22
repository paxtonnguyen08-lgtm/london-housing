// Casting and undoing votes, including the "everyone liked it" match. Works with either store.
import { isMatch, statusOf } from "./logic.js";

export class Voting {
  constructor(store, getMembers) {
    this.store = store;
    this.getMembers = getMembers;
    this.history = []; // what undo puts back, newest last
    this.inFlight = new Set(); // houses with a vote still being saved
  }

  get canUndo() {
    return this.history.length > 0;
  }

  // Returns { match } once saved, or null if a vote on this house is already being saved.
  async cast(key, me, vote) {
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);
    try {
      const s = this.store.state;
      const previous = (s.votes[key] || {})[me] ?? null;
      const statusBefore = s.status[key]?.status || "new";
      await this.store.vote(key, me, vote);
      let match = false;
      let autoStatus = false;
      if (vote === "like" && isMatch(this.store.state, key, this.getMembers())) {
        match = true;
        if (statusOf(this.store.state, key) === "new") {
          await this.store.setStatus(key, "interested", me);
          autoStatus = true;
        }
      }
      this.history.push({ key, previous, autoStatus, statusBefore });
      return { match };
    } finally {
      this.inFlight.delete(key);
    }
  }

  // Put back my last vote, and the status if that vote's match changed it. Returns the record.
  async undo(me) {
    const last = this.history.at(-1);
    if (!last) return null;
    await this.store.vote(last.key, me, last.previous);
    if (last.autoStatus && statusOf(this.store.state, last.key) === "interested") {
      await this.store.setStatus(last.key, last.statusBefore, me);
    }
    this.history.pop();
    return last;
  }

  reset() {
    this.history = [];
  }
}
