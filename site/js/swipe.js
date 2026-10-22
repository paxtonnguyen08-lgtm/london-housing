// The Tinder-style deck: drag a card right to like, left to pass, tap to flip to the rundown.
const THRESHOLD = 100; // px past which a release counts as a swipe
const TAP_SLOP = 6; // px of movement still counted as a tap

export class Deck {
  constructor(el, { renderFront, renderBack, onVote }) {
    this.el = el;
    this.renderFront = renderFront; // (listing, photoIndex) -> html
    this.renderBack = renderBack; // (listing) -> html
    this.onVote = onVote; // (listing, "like" | "pass") -> void
    this.items = [];
    this.flipped = false;
    this.photo = 0;
    this.busy = false;
  }

  get top() {
    return this.items[0] || null;
  }

  show(items) {
    this.items = items;
    this.flipped = false;
    this.photo = 0;
    this.render();
  }

  render() {
    this.el.innerHTML = "";
    if (!this.top) return;
    if (this.items[1]) {
      const under = document.createElement("div");
      under.className = "card under";
      under.setAttribute("aria-hidden", "true");
      under.innerHTML = this.renderFront(this.items[1], 0);
      this.el.appendChild(under);
    }
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("aria-label", `${this.top.title}. Press right arrow to like, left to pass, space for the rundown.`);
    card.innerHTML = this.flipped ? this.renderBack(this.top) : this.renderFront(this.top, this.photo);
    this.el.appendChild(card);
    this.card = card;
    this._bindDrag(card);
  }

  flip() {
    if (!this.top || this.busy) return;
    this.flipped = !this.flipped;
    this.card.innerHTML = this.flipped ? this.renderBack(this.top) : this.renderFront(this.top, this.photo);
  }

  nextPhoto(dir) {
    const n = this.top?.images?.length || 0;
    if (n < 2) return false;
    this.photo = (this.photo + dir + n) % n;
    this.card.innerHTML = this.renderFront(this.top, this.photo);
    return true;
  }

  // Animate the top card off screen, then tell the app. Stays busy until the vote is saved,
  // so a second tap while a slow network save is in progress can't vote on the same card twice.
  async swipe(vote) {
    if (!this.top || this.busy) return;
    this.busy = true;
    const listing = this.top;
    const card = this.card;
    const dx = vote === "like" ? 1 : -1;
    card.classList.add("flying");
    card.style.transform = `translateX(${dx * ((globalThis.innerWidth || 400) + 200)}px) rotate(${dx * 24}deg)`;
    this._stamps(card, dx * THRESHOLD * 2);
    await new Promise((r) => setTimeout(r, 260));
    try {
      await this.onVote(listing, vote);
    } finally {
      this.busy = false;
    }
  }

  _stamps(card, dx) {
    const like = card.querySelector(".stamp.like");
    const pass = card.querySelector(".stamp.pass");
    if (like) like.style.opacity = Math.max(0, Math.min(1, dx / THRESHOLD));
    if (pass) pass.style.opacity = Math.max(0, Math.min(1, -dx / THRESHOLD));
  }

  _bindDrag(card) {
    let startX = 0, startY = 0, dx = 0, dragging = false, moved = false, pointerId = null;

    card.addEventListener("pointerdown", (e) => {
      if (this.busy || e.button > 0) return;
      if (e.target.closest("a, button")) return; // let links and buttons on the rundown work
      dragging = true;
      moved = false;
      dx = 0;
      startX = e.clientX;
      startY = e.clientY;
      pointerId = e.pointerId;
      card.classList.remove("settle");
    });

    card.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;
      if (!moved && Math.abs(dy) > Math.abs(dx)) {
        dragging = false; // vertical: let the page (or rundown) scroll
        return;
      }
      if (!moved) card.setPointerCapture(pointerId);
      moved = true;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      this._stamps(card, dx);
    });

    const end = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      if (!moved) {
        this._tap(card, e);
        return;
      }
      if (Math.abs(dx) > THRESHOLD) {
        this.swipe(dx > 0 ? "like" : "pass");
      } else {
        card.classList.add("settle");
        card.style.transform = "";
        this._stamps(card, 0);
      }
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", (e) => {
      if (e.pointerId !== pointerId) return;
      dragging = false;
      card.classList.add("settle");
      card.style.transform = "";
      this._stamps(card, 0);
    });
  }

  // Tapping the photo's left/right edge flips through photos; tapping anywhere else flips the card.
  _tap(card, e) {
    if (!this.flipped) {
      const photo = card.querySelector(".photo");
      const r = photo?.getBoundingClientRect();
      if (r && e.clientY >= r.top && e.clientY <= r.bottom) {
        const third = r.width / 3;
        if (e.clientX < r.left + third && this.nextPhoto(-1)) return;
        if (e.clientX > r.right - third && this.nextPhoto(1)) return;
      }
    }
    this.flip();
  }
}
