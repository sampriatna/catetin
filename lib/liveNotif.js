// lib/liveNotif.js — tentukan notifikasi langsung (pop-up + bunyi) dari perubahan data stok.
// Murni (tanpa React/Supabase) supaya bisa dites. Dipakai components/LiveNotif.jsx.

import { profileKey } from "./dapurAccess.js";

const LOKASI_NAMA = { GDG: "Gudang", KBU: "KBU", KSM: "KSM", SMT: "SMT" };
const GUDANG = new Set(["owner", "purchasing_gudang", "gudang"]);
const AREA_PROFIL = { outlet_dapur: "dapur", outlet_bar: "bar" };

// Aksi yang dilakukan HP ini sendiri (mis. membatalkan) — tidak perlu dinotifikasi balik.
const aksiSendiri = new Set();
export function tandaiAksiSendiri(id, status) {
  if (id) aksiSendiri.add(`${id}:${status}`);
}

const areaLabel = (a) => (a === "dapur" ? " · Dapur" : a === "bar" ? " · Bar" : "");
const nama = (l) => LOKASI_NAMA[l] || l;

function peran(user) {
  const key = profileKey(user);
  const outlet = String(user?.outlet || "").trim().toUpperCase();
  return { key, gudang: GUDANG.has(key), outlet: AREA_PROFIL[key] ? outlet : null, area: AREA_PROFIL[key] || null };
}

/** Outlet ini (dan bagiannya) yang dituju transfer? Area kosong = berlaku untuk semua bagian. */
function outletDituju(p, t) {
  if (!p.outlet || p.outlet !== String(t.ke || "").toUpperCase()) return false;
  return !t.area || !p.area || t.area === p.area;
}

/**
 * Notifikasi untuk satu baris inv_transfers (INSERT/UPDATE realtime).
 * @returns {{ key, title, body, href } | null}
 */
export function notifTransfer(t, user) {
  if (!t?.id || !user?.id) return null;
  const key = `${t.id}:${t.status}`;
  if (aksiSendiri.has(key)) return null;
  const p = peran(user);
  const rute = `${nama(t.dari)} → ${nama(t.ke)}${areaLabel(t.area)}`;
  const href = "/dapur?tab=kirim";
  switch (t.status) {
    case "diminta":
      if (!p.gudang || t.diminta_by === user.id) return null;
      return { key, href, title: `📦 Permintaan baru dari ${nama(t.ke)}${areaLabel(t.area)}`,
        body: `${t.diminta_by_name || "Outlet"} minta barang. Ketuk untuk proses kirim.` };
    case "dikirim":
      if (t.dikirim_by === user.id || !outletDituju(p, t)) return null;
      return { key, href, title: `🚚 Barang sedang dikirim ke ${nama(t.ke)}${areaLabel(t.area)}`,
        body: `Dari ${nama(t.dari)}${t.dikirim_by_name ? ` oleh ${t.dikirim_by_name}` : ""}. Tekan "Cek & terima" saat barang datang.` };
    case "diterima":
      if (!p.gudang || t.diterima_by === user.id) return null;
      return { key, href, title: `✅ ${nama(t.ke)} sudah terima barang`,
        body: `${rute}${t.diterima_by_name ? ` · diterima ${t.diterima_by_name}` : ""}.` };
    case "batal":
      if (!(p.gudang || outletDituju(p, t))) return null;
      return { key, href, title: `✖️ Permintaan dibatalkan`, body: rute };
    default:
      return null;
  }
}

/** Notifikasi SO baru (inv_events INSERT jenis so) untuk gudang/purchasing: tanda perlu cek usulan permintaan. */
export function notifSo(ev, user) {
  if (!ev?.id || ev.jenis !== "so" || !user?.id) return null;
  if (ev.created_by && ev.created_by === user.id) return null;
  if (!peran(user).gudang || ev.lokasi === "GDG") return null;
  return {
    key: `so:${ev.id}`,
    href: "/dapur?tab=hari",
    title: `📋 SO baru ${nama(ev.lokasi)}${areaLabel(ev.area)}`,
    body: `${ev.created_by_name || "Staf"} kirim SO${ev.shift ? ` shift ${ev.shift}` : ""}. Cek stok menipis & permintaan.`,
  };
}
