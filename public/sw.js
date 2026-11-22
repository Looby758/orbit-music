// Orbit Music works offline: the app itself is kept on the phone (your downloaded songs are kept
// separately, by the app). Pages come from the network when there is one, so updates arrive.
const CACHE = 'orbit-music-app-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (e.request.mode === 'navigate') {
    // The page: fresh if online, the kept copy if not.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          void caches.open(CACHE).then((c) => c.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html'))
    )
    return
  }
  // Scripts, styles and pictures: kept once fetched (their names change when they change).
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            void caches.open(CACHE).then((c) => c.put(e.request, copy))
          }
          return res
        })
    )
  )
})
