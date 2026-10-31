// Bump VERSION whenever any shell file changes so phones pick up the new copy.
const VERSION = "routine-v4";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "scale-protocol.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "art/hero-morning.jpg", "art/hero-day.jpg", "art/hero-evening.jpg",
  "art/ex-squats.jpg", "art/ex-pushups.jpg", "art/ex-jumpingjacks.jpg",
  "art/ex-plank.jpg", "art/ex-lunges.jpg", "art/ex-bridges.jpg"
];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Page: network first so updates land, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put("index.html", copy));
      return res;
    }).catch(() => caches.match("index.html")));
    return;
  }

  // Same-origin files and Google Fonts: cache first, fill the cache on first use.
  if (url.origin === location.origin || FONTS.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    })));
  }
});
