"use client";
// Dengarkan perubahan stok secara langsung (Supabase Realtime) lalu munculkan pop-up + bunyi:
// permintaan barang baru, barang dikirim, barang diterima, dibatalkan, dan SO baru.
// Siapa dapat apa ditentukan lib/liveNotif.js. Data tetap dibatasi RLS (anggota bisnis saja).

import { useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { showActionToast } from "../lib/actionToast";
import { notifSo, notifTransfer } from "../lib/liveNotif";

const sudah = new Set();

function tampil(n) {
  if (!n || sudah.has(n.key)) return;
  sudah.add(n.key);
  showActionToast(n.body, "event", { title: n.title, href: n.href });
  // Tab/aplikasi sedang di belakang: pakai notifikasi sistem HP bila sudah diizinkan.
  try {
    if (document.visibilityState === "hidden" && typeof Notification !== "undefined" && Notification.permission === "granted"
      && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(n.title, {
        body: n.body, tag: n.key, icon: "/icon-192.png", badge: "/icon-192.png", data: { href: n.href },
      })).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export default function LiveNotif({ bizId, user, enabled = true }) {
  const uid = user?.id;
  const role = user?.role;
  const outlet = user?.outlet;
  useEffect(() => {
    if (!enabled || !bizId || !uid) return undefined;
    const me = { id: uid, role, outlet };
    const filter = `business_id=eq.${bizId}`;
    const channel = supabase
      .channel(`nf3-live-${bizId}-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "inv_transfers", filter }, (payload) => {
        const t = payload?.new;
        if (!t?.id) return;
        window.dispatchEvent(new CustomEvent("nf3:inv-transfer", { detail: { id: t.id, status: t.status } }));
        tampil(notifTransfer(t, me));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "inv_events", filter }, (payload) => {
        tampil(notifSo(payload?.new, me));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, bizId, uid, role, outlet]);
  return null;
}
