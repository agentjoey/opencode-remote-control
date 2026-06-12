/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// Safe offline shell. A previous pass-through SW caused stale-script bugs, so:
//   - content-hashed build assets → cache-first (a new build = new URLs, so a
//     cached old asset is never wrongly served for a new page)
//   - HTML/navigations → network-first with a cached fallback (always fresh
//     index.html, never a stale script graph)
//   - /api and /ws → never touched (always network)
// version-named cache + cleanup on activate guarantees old assets are purged.

import { build, files, version } from '$service-worker'

const sw = self as unknown as ServiceWorkerGlobalScope

const CACHE = `oprc-cache-${version}`
const PRECACHE = [...build, ...files]

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // `cache: 'reload'` bypasses the HTTP disk cache so a precache never
      // captures a stale asset (e.g. an icon still under a CDN max-age). Each
      // entry is fetched straight from the network.
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => sw.skipWaiting()),
  )
})

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key)
    }
    await sw.clients.claim()
  })())
})

sw.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return

  // Content-hashed build/static assets: cache-first.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    )
    return
  }

  // Navigations and anything else: network-first, fall back to cache when offline.
  event.respondWith((async () => {
    try {
      return await fetch(request)
    } catch {
      const cached = await caches.match(request)
      return cached ?? (await caches.match('/')) ?? Response.error()
    }
  })())
})
