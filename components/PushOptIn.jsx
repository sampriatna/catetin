"use client";
// Kartu kecil "Aktifkan notifikasi" supaya HP tetap berbunyi saat terkunci / aplikasi ditutup.
// iPhone di Safari/Chrome biasa: tampilkan cara "Tambah ke Layar Utama" (syarat dari Apple).
// Izin sudah diberikan → diam-diam memastikan HP ini tetap terdaftar.

import { useEffect, useState } from "react";
import { aktifkanPush, pushPermission, pushSupport, sinkronPush } from "../lib/pushClient";
import { showActionToast } from "../lib/actionToast";

const TUNDA_KEY = "nf3_push_nanti_until";
const TUNDA_HARI = 3;

function ditunda() {
  try { return Date.now() < Number(localStorage.getItem(TUNDA_KEY) || 0); } catch { return false; }
}

export default function PushOptIn({ bizId, enabled }) {
  const [mode, setMode] = useState(null); // "tanya" | "ios"
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !bizId) return;
    const s = pushSupport();
    const izin = pushPermission();
    if (s === "ok" && izin === "granted") { sinkronPush(bizId); setMode(null); return; }
    if (ditunda()) return;
    if (s === "ok" && izin === "default") setMode("tanya");
    else if (s === "perlu_pasang_ios") setMode("ios");
  }, [bizId, enabled]);

  if (!mode) return null;

  const nanti = () => {
    try { localStorage.setItem(TUNDA_KEY, String(Date.now() + TUNDA_HARI * 864e5)); } catch { /* ignore */ }
    setMode(null);
  };

  const aktifkan = async () => {
    setBusy(true);
    try {
      await aktifkanPush(bizId);
      showActionToast("Notifikasi aktif. HP ini akan berbunyi walau aplikasi ditutup.", "success");
      setMode(null);
    } catch (e) {
      showActionToast(e.message || String(e), "error");
      if (pushPermission() === "denied") setMode(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label="Aktifkan notifikasi"
      style={{ position: "fixed", left: 12, right: 12, margin: "0 auto", maxWidth: 420, bottom: "calc(env(safe-area-inset-bottom, 0px) + 90px)",
        zIndex: 9990, background: "#fff", border: "1px solid #BFDBFE", borderRadius: 16, boxShadow: "0 10px 28px rgba(15,23,42,.18)",
        padding: 14, boxSizing: "border-box", fontFamily: "inherit" }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#111827" }}>🔔 Aktifkan notifikasi</div>
      {mode === "tanya" ? (
        <div style={{ fontSize: 13, color: "#4B5563", marginTop: 4, lineHeight: 1.45 }}>
          Supaya HP tetap berbunyi saat ada permintaan barang, kiriman, atau SO baru — walau HP terkunci atau aplikasi ditutup.
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "#4B5563", marginTop: 4, lineHeight: 1.5 }}>
          Di iPhone, notifikasi hanya bisa lewat aplikasi di layar utama:
          <ol style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>Buka di <b>Safari</b>, ketuk tombol <b>Bagikan</b> (kotak dengan panah ke atas)</li>
            <li>Pilih <b>Tambah ke Layar Utama</b></li>
            <li>Buka NF3 dari ikon baru itu, lalu ketuk <b>Aktifkan</b> di kartu ini</li>
          </ol>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {mode === "tanya" && (
          <button type="button" onClick={aktifkan} disabled={busy}
            style={{ flex: 1, border: "none", borderRadius: 12, padding: "10px 12px", background: "#185FA5", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Mengaktifkan…" : "Aktifkan"}
          </button>
        )}
        <button type="button" onClick={nanti}
          style={{ flex: mode === "tanya" ? "0 0 auto" : 1, border: "none", borderRadius: 12, padding: "10px 14px", background: "#F3F4F6", color: "#374151", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
          {mode === "tanya" ? "Nanti" : "Mengerti"}
        </button>
      </div>
    </div>
  );
}
