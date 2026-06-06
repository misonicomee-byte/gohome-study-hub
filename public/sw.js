// Minimal Service Worker for PWA install eligibility.
// No caching — always fetch from network so content stays fresh.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through; required for Chrome PWA install criteria.
});
