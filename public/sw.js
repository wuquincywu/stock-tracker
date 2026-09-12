self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// PWA app-icon red dot — supported from a service worker per the Badging API spec, so this works
// even with no page open. Not an exact unread count, just "you have something new"; cleared by
// ClearAppBadge.tsx when the 通知 page is actually opened.
//
// The Badge mixin is spec'd onto Navigator/WorkerNavigator, so in a service worker the call is
// `self.navigator.setAppBadge()` — plain `self.setAppBadge()` is undefined in spec-compliant
// engines and silently no-ops. Checking both here in case an implementation exposes it either way.
// Also wrapped in try/catch as well as .catch() since some implementations throw synchronously
// instead of rejecting the returned promise — either way this must never break notification
// display.
function trySetAppBadge(count) {
  try {
    const badgeApi = typeof self.setAppBadge === "function" ? self : self.navigator;
    if (badgeApi && typeof badgeApi.setAppBadge === "function") {
      return Promise.resolve(badgeApi.setAppBadge(count)).catch(() => {});
    }
  } catch {
    // ignore
  }
  return Promise.resolve();
}

self.addEventListener("push", (event) => {
  let payload = { title: "股票追蹤", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // ignore malformed payloads
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: payload.url },
      }),
      trySetAppBadge(1),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.endsWith(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
