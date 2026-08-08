/* NF3 service worker — bump APP_SW_VERSION / SW_VERSION tiap patch kritis */
const SW_VERSION = "nf3-sw-20260808-samtaro-sync3";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
    await self.clients.claim();
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "NF3_SW_UPDATED", version: SW_VERSION });
      }
    } catch { /* ignore */ }
  })());
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "NF3_SKIP_WAITING") {
    self.skipWaiting();
  }
});
