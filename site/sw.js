// The service worker: a small script the phone keeps so it can show alerts while House Hunt
// is closed. It only handles alerts. It caches nothing, so the site always loads fresh.
// Alerts are sent by scraper/notify.py after the daily scrape, as JSON: { title, body, url, tag }.

const FALLBACK = { title: "House Hunt", body: "Something new in your house hunt.", url: "./", tag: "house-hunt" };

// Only open pages inside this site, whatever the message says
function siteUrl(url) {
  const scope = self.registration.scope;
  try {
    const u = new URL(url || "./", scope);
    return u.href.startsWith(scope) ? u.href : scope;
  } catch {
    return scope;
  }
}

function readMessage(data) {
  let msg = {};
  try {
    msg = data ? data.json() : {};
  } catch {
    msg = { body: data?.text?.() };
  }
  return {
    title: msg.title || FALLBACK.title,
    body: msg.body || FALLBACK.body,
    url: siteUrl(msg.url || FALLBACK.url),
    tag: msg.tag || FALLBACK.tag,
  };
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Always show something: iPhones turn off alerts for sites that receive pushes without showing one.
self.addEventListener("push", (event) => {
  const msg = readMessage(event.data);
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag, // a newer alert of the same kind replaces the older one
      icon: "icon-192.png",
      data: { url: msg.url },
    }),
  );
});

// Tapping an alert: bring House Hunt to the front on the right tab (reloaded, so today's houses show).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = siteUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = open.find((c) => c.url.startsWith(self.registration.scope));
      if (!tab) return self.clients.openWindow(url);
      await tab.focus();
      await tab.navigate?.(url)?.catch(() => {}); // only works on a page this worker controls
    })(),
  );
});
