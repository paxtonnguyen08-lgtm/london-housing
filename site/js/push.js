// Phone alerts (Web Push). Everything here is covered by tests/push.test.js.
//
// How it fits together:
//  1. "Turn on alerts" asks the phone for permission. The browser then gives us a subscription:
//     a private address at Apple's or Google's push service that only accepts messages signed
//     with our VAPID key (public half in config.js, private half a GitHub secret).
//  2. The page saves that address in Supabase (save_push_sub), filed under your name.
//  3. After each daily scrape, scraper/notify.py sends to those addresses and sw.js shows them.

// config.js holds the public key as base64url text; the browser wants the raw bytes.
export function keyBytes(base64url) {
  const bin = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Was this subscription made with this key? (If the key pair is ever replaced, old ones stop working.)
export function sameKey(sub, base64url) {
  const used = sub?.options?.applicationServerKey;
  if (!used) return true; // older browsers don't say; assume it's fine
  const a = new Uint8Array(used);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function isIos(nav) {
  const ua = nav?.userAgent || "";
  // iPads say "Macintosh" but have a touch screen
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
}

// Opened from the Home Screen icon, rather than in a Safari or Chrome tab
export function isStandalone(win) {
  return Boolean(win?.matchMedia?.("(display-mode: standalone)")?.matches || win?.navigator?.standalone === true);
}

export function pushSupported(win) {
  return Boolean(win?.navigator && "serviceWorker" in win.navigator && "PushManager" in win && "Notification" in win);
}

// Which message the Group tab shows. Checked in this order, so each one has a single fix.
export function alertsState({ hasKey, supported, ios, standalone, shared, me, permission, subscribed }) {
  if (!hasKey) return "no-key";
  if (ios && !standalone) return "ios-home-screen"; // Safari tabs on iPhone can't get alerts at all
  if (!supported) return ios ? "ios-update" : "unsupported";
  if (!shared) return "join-first";
  if (!me) return "pick-name";
  if (permission === "denied") return "blocked";
  if (subscribed) return "on";
  return "off";
}

export const ALERTS_TEXT = {
  "no-key": "Phone alerts aren't set up on this site yet.",
  "ios-home-screen": "On iPhone, alerts only work in the Home Screen app, not in Safari (iOS 16.4 or newer). Add House Hunt to your Home Screen (steps below), open it from the icon, then come back here.",
  "ios-update": "Alerts need iOS 16.4 or newer. Update in Settings → General → Software Update, then open House Hunt from your Home Screen again.",
  unsupported: "This browser can't show alerts. On Android use Chrome; on iPhone use the Home Screen app.",
  "join-first": "Join your group first (the invite link above), so alerts know whose phone this is.",
  "pick-name": "Pick your name first, so alerts know whose phone this is.",
  blocked: "Alerts are blocked for House Hunt. iPhone: Settings → Notifications → House Hunt → Allow Notifications. Android: in Chrome, tap the icon left of the web address → Permissions → Notifications. Then come back here.",
  on: "Alerts are on for this phone. You'll get one each morning there are new houses that fit your budget, and one when everyone likes the same house.",
  off: "Get a ping when new houses fit your budget, and when everyone likes the same house. At most a couple a day.",
};

// Ask permission, subscribe, and save. Call it straight from the button tap: iPhones only show
// the permission prompt in direct response to a tap.
export async function turnOnAlerts({ win = globalThis, key, save }) {
  const permission = await win.Notification.requestPermission();
  if (permission !== "granted") return { ok: false, permission };
  const reg = await win.navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await save(sub.toJSON());
  return { ok: true, permission, sub };
}

// The phone stops listening at once. The daily job removes its saved address the next time it
// tries it and the push service says it's gone.
export async function turnOffAlerts({ win = globalThis }) {
  const reg = await win.navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
}

// This phone's current subscription, or null. A subscription made with an old key counts as none.
export async function currentSubscription({ win = globalThis, key }) {
  if (!pushSupported(win) || win.Notification.permission !== "granted") return null;
  const reg = await win.navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && sameKey(sub, key) ? sub : null;
}
