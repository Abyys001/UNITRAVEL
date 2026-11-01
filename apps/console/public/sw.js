// Uni Travel console worker (ADR-0022). It makes the app installable and fast to start, and deliberately stores no data:
// /api and pages always go to the network. Only content-hashed build files, icons and the offline page are cached.
const VERSION = "v1"
const STATIC_CACHE = `ut-static-${VERSION}`
const SHELL_CACHE = `ut-shell-${VERSION}`
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"]
const MAX_STATIC_ENTRIES = 300

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

async function cacheFirst(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok && res.type === "basic") {
    await cache.put(req, res.clone())
    // Every build adds new hashed files; the oldest entries are the ones no page asks for any more.
    const keys = await cache.keys()
    if (keys.length > MAX_STATIC_ENTRIES) await Promise.all(keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((k) => cache.delete(k)))
  }
  return res
}

self.addEventListener("fetch", (e) => {
  const req = e.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return
  if (url.pathname.startsWith("/_next/static/")) { e.respondWith(cacheFirst(req, STATIC_CACHE)); return }
  if (url.pathname.startsWith("/icons/")) { e.respondWith(cacheFirst(req, SHELL_CACHE)); return }
  if (req.mode === "navigate") e.respondWith(fetch(req).catch(() => caches.match("/offline.html")))
})
