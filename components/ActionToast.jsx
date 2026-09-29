"use client";
// Pop-up notifikasi global. Hasil aksi (berhasil/gagal/info) muncul di bawah; kabar baru (event:
// permintaan barang, kiriman, SO) muncul di atas dan bisa diketuk untuk membuka halamannya.
// Berhasil = hijau + "ting"; gagal = merah + bunyi tegas + getar, tetap tampil sampai ditutup.

import { useEffect, useRef, useState } from "react";
import { subscribeActionToast } from "../lib/actionToast";
import { playErrorSound, playNotificationPing, playSuccessSound, unlockNotificationAudio } from "../lib/notificationSound";

const TONE = {
  success: { bg: "#ECFDF5", border: "#A7F3D0", color: "#047857", icon: "✅" },
  error: { bg: "#FEF2F2", border: "#FCA5A5", color: "#B91C1C", icon: "❌" },
  info: { bg: "#EFF6FF", border: "#BFDBFE", color: "#1D4ED8", icon: "" },
  event: { bg: "#FFFFFF", border: "#BFDBFE", color: "#111827", icon: "" },
};

const MAX = 3;

export default function ActionToast() {
  const [list, setList] = useState([]);
  const timers = useRef(new Map());

  // Browser HP hanya mengizinkan bunyi setelah layar pernah disentuh.
  useEffect(() => {
    const unlock = () => unlockNotificationAudio();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const t = timers.current;
    const unsub = subscribeActionToast((toast) => {
      if (!toast.silent) {
        if (toast.tone === "success") playSuccessSound();
        else if (toast.tone === "error") playErrorSound();
        else if (toast.tone === "event") playNotificationPing();
      }
      setList((prev) => {
        // Hasil aksi di bawah cukup satu (yang terbaru); kabar baru ditumpuk maks 3.
        const rest = toast.tone === "event" ? prev : prev.filter((x) => x.tone === "event");
        return [...rest, toast].slice(-MAX - 1);
      });
      if (toast.durationMs > 0) {
        t.set(toast.id, setTimeout(() => close(toast.id), toast.durationMs));
      }
    });
    return () => {
      unsub();
      t.forEach((x) => clearTimeout(x));
      t.clear();
    };
  }, []);

  function close(id) {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setList((prev) => prev.filter((x) => x.id !== id));
  }

  function open(toast) {
    close(toast.id);
    if (toast.href) window.location.assign(toast.href);
  }

  const events = list.filter((x) => x.tone === "event").slice(-MAX);
  const result = list.filter((x) => x.tone !== "event").slice(-1)[0];

  return (
    <>
      {events.length > 0 && (
        <div style={{ position: "fixed", top: "calc(env(safe-area-inset-top, 0px) + 10px)", left: 0, right: 0, zIndex: 10000,
          display: "grid", gap: 8, justifyItems: "center", padding: "0 12px", pointerEvents: "none" }}>
          {events.map((x) => (
            <div key={x.id} role="alert" aria-live="assertive"
              style={{ pointerEvents: "auto", width: "100%", maxWidth: 420, boxSizing: "border-box", background: "#fff", borderRadius: 16,
                border: "1px solid #BFDBFE", boxShadow: "0 12px 32px rgba(15,23,42,.22)", padding: "12px 12px 12px 14px",
                display: "flex", gap: 10, alignItems: "flex-start", animation: "nf3ToastIn .22s ease-out" }}>
              <button type="button" onClick={() => open(x)}
                style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                {x.title && <div style={{ fontWeight: 800, fontSize: 14, color: "#111827", lineHeight: 1.35 }}>{x.title}</div>}
                {x.message && <div style={{ fontSize: 13, color: "#4B5563", marginTop: 2, lineHeight: 1.4 }}>{x.message}</div>}
                {x.href && <div style={{ fontSize: 12, color: "#185FA5", fontWeight: 800, marginTop: 6 }}>Buka →</div>}
              </button>
              <button type="button" onClick={() => close(x.id)} aria-label="Tutup"
                style={{ border: "none", background: "#F3F4F6", borderRadius: 999, width: 28, height: 28, color: "#6B7280", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {result && (() => {
        const s = TONE[result.tone] || TONE.info;
        const sticky = !(result.durationMs > 0);
        return (
          <div key={result.id} role={result.tone === "error" ? "alert" : "status"} aria-live={result.tone === "error" ? "assertive" : "polite"}
            onClick={() => close(result.id)}
            style={{ position: "fixed", left: 16, right: 16, margin: "0 auto", bottom: 96, zIndex: 9999, maxWidth: 380,
              boxSizing: "border-box", padding: "12px 14px", borderRadius: 14, background: s.bg, border: `1px solid ${s.border}`,
              color: s.color, fontSize: 14, fontWeight: 700, lineHeight: 1.45, boxShadow: "0 8px 24px rgba(0,0,0,.14)",
              display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", animation: "nf3ToastUp .2s ease-out" }}>
            {s.icon && <span aria-hidden>{s.icon}</span>}
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {result.title ? <b>{result.title} </b> : null}{result.message}
            </span>
            {sticky && <span aria-label="Tutup" style={{ fontSize: 13, opacity: 0.7 }}>✕</span>}
          </div>
        );
      })()}
      <style>{`@keyframes nf3ToastIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}}
@keyframes nf3ToastUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}`}</style>
    </>
  );
}
