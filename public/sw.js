// Momentum service worker — makes the app open instantly and work fully offline.
const VERSION = '__BUILD__' // replaced with the build id by vite.config.ts (dev keeps the placeholder)
const SHELL = `shell-${VERSION}`, ASSETS = 'assets-v1', FONTS = 'fonts-v1'

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(pruneAssets).then(() => self.clients.claim()))
})
/** drop hashed assets the current build no longer references (old builds piled up in the cache forever) */
async function pruneAssets() {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text()
    const live = new Set([...html.matchAll(/\/assets\/[^"' )]+/g)].map(m => m[0]))
    if (!live.size) return
    // lazily loaded chunks are named inside the entry scripts, not the page: keep those too
    for (const p of [...live].filter(p => p.endsWith('.js'))) {
      const js = await (await fetch(p)).text()
      for (const m of js.matchAll(/["'`](?:\.\/|\/?assets\/)([A-Za-z0-9_-]+\.(?:js|css))["'`]/g)) live.add('/assets/' + m[1])
    }
    const c = await caches.open(ASSETS)
    for (const req of await c.keys()) {
      const p = new URL(req.url).pathname
      // keep anything the page references; lazily loaded chunks of the current build are re-fetched on demand if pruned
      if (p.startsWith('/assets/') && !live.has(p)) await c.delete(req)
    }
  } catch { /* offline: prune next time */ }
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return // sync traffic is never cached

  // Google Fonts / Material Symbols: serve cached, refresh in background
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req)
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r }).catch(() => hit)
      return hit || net
    }))
    return
  }
  if (url.origin !== location.origin) return

  // page navigations: network first (fresh app), fall back to cached shell offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put('/', copy)) } return r }).catch(() => caches.match('/')))
    return
  }
  // hashed build assets are immutable: cache first
  e.respondWith(caches.open(ASSETS).then(async c => {
    const hit = await c.match(req)
    if (hit) return hit
    const r = await fetch(req)
    if (r.ok) c.put(req, r.clone())
    return r
  }))
})
