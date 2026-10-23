import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  ALERTS_TEXT, alertsState, currentSubscription, isIos, isStandalone, keyBytes, pushSupported, sameKey,
  turnOffAlerts, turnOnAlerts,
} from "../js/push.js";
import { CONFIG } from "../js/config.js";

const KEY = CONFIG.vapidPublicKey;

// A stand-in for the browser's push parts: permission prompt, service worker, push service.
function fakeBrowser({ permission = "default", answer = "granted", existing = null } = {}) {
  const calls = [];
  const makeSub = (key) => ({
    endpoint: "https://web.push.apple.com/abc",
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => {
      calls.push("unsubscribe");
      current = null;
      return true;
    },
  });
  let current = existing && makeSub(existing);
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async (opts) => {
      calls.push(["subscribe", opts]);
      current = makeSub(opts.applicationServerKey);
      return current;
    },
  };
  const reg = { pushManager };
  const win = {
    Notification: {
      permission,
      requestPermission: async () => {
        calls.push("ask");
        win.Notification.permission = answer;
        return answer;
      },
    },
    PushManager: function () {},
    navigator: { serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg } },
  };
  return { win, calls, current: () => current };
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

test("push: the config's public key decodes to an uncompressed P-256 point", () => {
  const bytes = keyBytes(KEY);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
  assert.deepEqual([...keyBytes("AQID_-8")], [1, 2, 3, 255, 239]); // base64url's - and _
});

test("push: sameKey spots a subscription made with an old key", () => {
  assert.equal(sameKey({ options: { applicationServerKey: keyBytes(KEY).buffer } }, KEY), true);
  assert.equal(sameKey({ options: { applicationServerKey: new Uint8Array(65).buffer } }, KEY), false);
  assert.equal(sameKey({ options: {} }, KEY), true); // browser doesn't say: assume fine
});

test("push: iPhone, iPad and Home Screen detection", () => {
  assert.equal(isIos({ userAgent: IPHONE }), true);
  assert.equal(isIos({ userAgent: IPAD, maxTouchPoints: 5 }), true);
  assert.equal(isIos({ userAgent: IPAD, maxTouchPoints: 0 }), false); // a real Mac
  assert.equal(isIos({ userAgent: PIXEL }), false);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} }), false);
  assert.equal(pushSupported(fakeBrowser().win), true);
  assert.equal(pushSupported({ navigator: {} }), false); // Safari in a tab on iPhone
});

test("push: the Group tab explains the one thing to do next", () => {
  const ok = { hasKey: true, supported: true, ios: false, standalone: false, shared: true, me: "Paxton", permission: "default", subscribed: false };
  assert.equal(alertsState(ok), "off");
  assert.equal(alertsState({ ...ok, subscribed: true, permission: "granted" }), "on");
  assert.equal(alertsState({ ...ok, permission: "denied" }), "blocked");
  assert.equal(alertsState({ ...ok, me: null }), "pick-name");
  assert.equal(alertsState({ ...ok, shared: false }), "join-first");
  assert.equal(alertsState({ ...ok, supported: false }), "unsupported");
  assert.equal(alertsState({ ...ok, hasKey: false }), "no-key");
  // iPhone: Safari tab first needs the Home Screen; the Home Screen app on old iOS needs an update
  assert.equal(alertsState({ ...ok, ios: true, standalone: false, supported: false }), "ios-home-screen");
  assert.equal(alertsState({ ...ok, ios: true, standalone: true, supported: false }), "ios-update");
  assert.equal(alertsState({ ...ok, ios: true, standalone: true }), "off");
  assert.match(ALERTS_TEXT["ios-home-screen"], /Home Screen/);
  assert.match(ALERTS_TEXT["ios-home-screen"], /16\.4/);
  for (const state of ["no-key", "ios-home-screen", "ios-update", "unsupported", "join-first", "pick-name", "blocked", "on", "off"]) {
    assert.ok(ALERTS_TEXT[state], state);
  }
});

test("push: turning on asks first, subscribes with the site's key, and saves", async () => {
  const b = fakeBrowser();
  const saved = [];
  const result = await turnOnAlerts({ win: b.win, key: KEY, save: async (sub) => saved.push(sub) });
  assert.equal(result.ok, true);
  assert.equal(b.calls[0], "ask"); // the prompt comes first, straight from the tap
  const [, opts] = b.calls[1];
  assert.equal(opts.userVisibleOnly, true);
  assert.deepEqual([...opts.applicationServerKey], [...keyBytes(KEY)]);
  assert.deepEqual(saved, [{ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "p", auth: "a" } }]);
});

test("push: saying no saves nothing; a subscription with an old key is replaced", async () => {
  const no = fakeBrowser({ answer: "denied" });
  const saved = [];
  assert.deepEqual(await turnOnAlerts({ win: no.win, key: KEY, save: async (s) => saved.push(s) }), { ok: false, permission: "denied" });
  assert.deepEqual(saved, []);

  const old = fakeBrowser({ permission: "granted", existing: new Uint8Array(65) });
  await turnOnAlerts({ win: old.win, key: KEY, save: async () => {} });
  assert.deepEqual(old.calls.slice(1, 3).map((c) => (Array.isArray(c) ? c[0] : c)), ["unsubscribe", "subscribe"]);
});

test("push: a failed save is reported, so the button can say so", async () => {
  const b = fakeBrowser();
  await assert.rejects(turnOnAlerts({ win: b.win, key: KEY, save: async () => { throw new Error("offline"); } }), /offline/);
});

test("push: current subscription and turning off", async () => {
  const none = fakeBrowser({ permission: "default" });
  assert.equal(await currentSubscription({ win: none.win, key: KEY }), null);
  const on = fakeBrowser({ permission: "granted", existing: keyBytes(KEY) });
  assert.equal((await currentSubscription({ win: on.win, key: KEY })).endpoint, "https://web.push.apple.com/abc");
  const stale = fakeBrowser({ permission: "granted", existing: new Uint8Array(65) });
  assert.equal(await currentSubscription({ win: stale.win, key: KEY }), null);
  await turnOffAlerts({ win: on.win });
  assert.equal(on.current(), null);
  await turnOffAlerts({ win: none.win }); // nothing to turn off: no error
});

// ---------- the service worker (sw.js), run in a sandbox with a fake phone ----------

function loadWorker({ open = [] } = {}) {
  const handlers = {};
  const shown = [];
  const opened = [];
  const scope = "https://me.github.io/london-housing/";
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => {},
    registration: { scope, showNotification: async (title, opts) => shown.push({ title, ...opts }) },
    clients: {
      claim: async () => {},
      matchAll: async () => open,
      openWindow: async (url) => opened.push(url),
    },
  };
  vm.runInNewContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), { self, URL });
  const fire = async (type, event) => {
    let wait;
    handlers[type]({ ...event, waitUntil: (p) => (wait = p) });
    await wait;
  };
  return { fire, shown, opened, scope };
}

const pushData = (obj) => ({ json: () => (typeof obj === "string" ? JSON.parse(obj) : obj), text: () => String(obj) });

test("service worker: shows the alert notify.py sent", async () => {
  const w = loadWorker();
  await w.fire("push", { data: pushData({ title: "New house: $850/person", body: "12 Oxford St", url: `${w.scope}?tab=discover`, tag: "new-houses" }) });
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0].title, "New house: $850/person");
  assert.equal(w.shown[0].body, "12 Oxford St");
  assert.equal(w.shown[0].tag, "new-houses");
  assert.equal(w.shown[0].data.url, `${w.scope}?tab=discover`);
});

test("service worker: always shows something, and never links off the site", async () => {
  const w = loadWorker();
  await w.fire("push", { data: null });
  await w.fire("push", { data: pushData("not json") });
  await w.fire("push", { data: pushData({ title: "Hi", url: "https://evil.example/" }) });
  assert.equal(w.shown.length, 3);
  assert.equal(w.shown[0].title, "House Hunt");
  assert.equal(w.shown[1].body, "not json");
  assert.equal(w.shown[2].data.url, w.scope);
  await w.fire("push", { data: pushData({ url: "./?tab=shortlist" }) }); // relative, when SITE_URL isn't set
  assert.equal(w.shown[3].data.url, `${w.scope}?tab=shortlist`);
});

test("service worker: tapping opens the app, or brings the open one to that tab", async () => {
  const closed = [];
  const notification = { data: { url: "https://me.github.io/london-housing/?tab=shortlist" }, close: () => closed.push(1) };
  const w = loadWorker();
  await w.fire("notificationclick", { notification });
  assert.deepEqual(w.opened, ["https://me.github.io/london-housing/?tab=shortlist"]);
  assert.equal(closed.length, 1);

  const tab = { url: "https://me.github.io/london-housing/", focused: false, went: null };
  tab.focus = async () => (tab.focused = true);
  tab.navigate = async (url) => (tab.went = url);
  const w2 = loadWorker({ open: [tab] });
  await w2.fire("notificationclick", { notification });
  assert.equal(tab.focused, true);
  assert.equal(tab.went, "https://me.github.io/london-housing/?tab=shortlist");
  assert.deepEqual(w2.opened, []);
});
