// lib/pushClient.js — sisi HP untuk notifikasi saat HP terkunci (Web Push).

import { readStoredSession } from "./authBootstrap";
import { VAPID_PUBLIC_KEY } from "./pushConfig";

export function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true || window.navigator.standalone === true;
}

/** "ok" | "perlu_pasang_ios" (iPhone di Safari/Chrome biasa) | "tidak_didukung" */
export function pushSupport() {
  if (typeof window === "undefined") return "tidak_didukung";
  const ada = "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
  if (isIos() && !isStandalone()) return "perlu_pasang_ios";
  return ada ? "ok" : "tidak_didukung";
}

export function pushPermission() {
  return typeof Notification === "undefined" ? "default" : Notification.permission;
}

function keyBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function authHeaders() {
  const token = readStoredSession()?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

async function kirimLangganan(bizId, sub) {
  const headers = authHeaders();
  if (!headers) throw new Error("Sesi login habis, silakan masuk lagi.");
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers,
    body: JSON.stringify({ businessId: bizId, subscription: sub.toJSON(), ua: navigator.userAgent }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Gagal mengaktifkan notifikasi.");
}

async function langganan(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  }
  return sub;
}

/** Tombol "Izinkan notifikasi": minta izin lalu daftarkan HP ini. Harus dipanggil dari ketukan. */
export async function aktifkanPush(bizId) {
  if (pushSupport() !== "ok") throw new Error("HP/browser ini belum mendukung notifikasi.");
  const izin = await Notification.requestPermission();
  if (izin !== "granted") throw new Error("Izin notifikasi ditolak. Aktifkan lewat pengaturan browser/HP.");
  const sub = await langganan(true);
  await kirimLangganan(bizId, sub);
}

/** Saat aplikasi dibuka: izin sudah ada → pastikan langganan terdaftar (mis. setelah muat ulang paksa). */
export async function sinkronPush(bizId) {
  if (pushSupport() !== "ok" || pushPermission() !== "granted") return;
  try {
    const sub = await langganan(true);
    if (sub) await kirimLangganan(bizId, sub);
  } catch {
    /* coba lagi saat dibuka berikutnya */
  }
}

/** Setelah simpan berhasil: minta server mengabari HP lain yang terkunci. Tidak pernah melempar error. */
export function kabariPush(bizId, kind, id) {
  try {
    const headers = authHeaders();
    if (!headers || !bizId || !id) return;
    fetch("/api/push/notify", {
      method: "POST",
      headers,
      keepalive: true,
      body: JSON.stringify({ businessId: bizId, kind, id }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
