self.addEventListener('install', (e) => {
  ;(e as any).waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (e) => {
  ;(e as any).waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Pass-through — no caching. Real-time-first.
})
