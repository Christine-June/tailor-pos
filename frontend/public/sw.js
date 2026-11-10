/*
 * Tailor POS service worker: lets the app open with no internet.
 * - Pages: network first (so updates arrive), falling back to the saved app shell offline.
 * - Built files under /assets/: their names change with every build, so once saved they never change.
 * - API calls are never cached here. The app keeps its own offline copies and outbox in IndexedDB,
 *   and a cached API answer could show stale balances as if they were current.
 */
const VERSION = "v1"
const SHELL = `tailorpos-shell-${VERSION}`
const ASSETS = `tailorpos-assets-${VERSION}`
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"]
const NAV_TIMEOUT_MS = 4000

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tailorpos-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
}

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL)
  try {
    const response = await Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)])
    // Every route serves the same index.html, so one copy under "/" covers them all.
    if (response.ok) await cache.put("/", response.clone())
    return response
  } catch {
    return (await cache.match("/")) || Response.error()
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL)
  const hit = await cache.match(request)
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => hit)
  return hit || refresh
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return

  if (request.mode === "navigate") event.respondWith(networkFirstPage(request))
  else if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(request))
  else event.respondWith(staleWhileRevalidate(request))
})
