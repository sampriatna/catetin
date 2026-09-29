/* NF3 service worker — bump APP_SW_VERSION / SW_VERSION tiap patch kritis */
const SW_VERSION = "nf3-sw-20260929-notif";

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

// Ketuk notifikasi sistem (permintaan barang, kiriman, SO) → buka/fokuskan aplikasi ke halamannya.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification?.data?.href || "/dashboard";
  event.waitUntil((async () => {
    const url = new URL(href, self.location.origin).href;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        try { await client.navigate(url); } catch { /* ignore */ }
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
