"use client";

import { useEffect, useState, useCallback } from "react";

const DISMISS_KEY = "nf3_pwa_dismiss_until";
const DISMISS_DAYS = 7;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || window.navigator.standalone === true
  );
}

function isDismissed() {
  try {
    const until = localStorage.getItem(DISMISS_KEY);
    if (!until) return false;
    return Date.now() < Number(until);
  } catch {
    return false;
  }
}

export default function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(
        DISMISS_KEY,
        String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000),
      );
    } catch { /* ignore */ }
    setVisible(false);
    setDeferredPrompt(null);
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch { /* ignore */ }
    setVisible(false);
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  if (!visible) return null;

  return (
    <div className="nf3-pwa-banner" role="region" aria-label="Pasang aplikasi NF3">
      <div className="nf3-pwa-banner-inner">
        <p className="nf3-pwa-banner-text">
          📲 Tambahkan NF3 ke layar utama untuk tampilan lebih nyaman
        </p>
        <div className="nf3-pwa-banner-actions">
          <button type="button" className="nf3-pwa-btn nf3-pwa-btn-primary" onClick={install}>
            Pasang Sekarang
          </button>
          <button type="button" className="nf3-pwa-btn nf3-pwa-btn-ghost" onClick={dismiss}>
            Nanti
          </button>
        </div>
      </div>
    </div>
  );
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(`/sw.js?v=${Date.now().toString(36)}`).catch(() => {});
  // SW baru → buang cache lama; staf tetap perlu hard-reload untuk bundle Next
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event?.data?.type === "NF3_SW_UPDATED") {
      try { sessionStorage.setItem("nf3_sw_updated", event.data.version || "1"); } catch { /* ignore */ }
    }
  });
  navigator.serviceWorker.ready.then((reg) => {
    try { reg.update(); } catch { /* ignore */ }
  }).catch(() => {});
}

/** Paksa muat bundle terbaru — unregister SW + clear Cache Storage + reload. */
export async function forceReloadLatestApp() {
  if (typeof window === "undefined") return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* ignore */ }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* ignore */ }
  const url = new URL(window.location.href);
  url.searchParams.set("_nf3_reload", Date.now().toString(36));
  window.location.replace(url.toString());
}
