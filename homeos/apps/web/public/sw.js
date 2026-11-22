/* HomeOS service worker.
 * - Cachet alleen statische bestanden (/_next/static, iconen) en een offline-pagina.
 * - Cachet NOOIT pagina's met gegevens, API-antwoorden, camerabeelden of iets met inloggegevens.
 * - Toont pushmeldingen en opent bij een klik alleen een pagina binnen HomeOS.
 */
const VERSION = "homeos-v1";
const STATIC = `${VERSION}-static`;
const PRECACHE = ["/offline.html", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/badge-96.png", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) => url.pathname.startsWith("/_next/static/") || PRECACHE.includes(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return; // nooit cachen

  if (isStatic(url)) {
    // Bestanden in /_next/static hebben een hash in de naam en veranderen nooit: cache eerst.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    // Pagina's altijd van het netwerk (actuele gegevens, inlogcontrole); alleen bij geen verbinding de offline-pagina.
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
});

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "HomeOS", body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" ? data.title.slice(0, 120) : "HomeOS";
  const body = typeof data.body === "string" ? data.body.slice(0, 400) : "";
  const path = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: typeof data.tag === "string" ? data.tag.slice(0, 64) : undefined,
      data: { url: path },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  const target = new URL(path, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(target.href).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
