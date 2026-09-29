// lib/dapurAccess.js — satu-satunya sumber izin tampilan modul Dapur & Stok.
// Komponen tidak lagi mengecek nama role sendiri; semuanya lewat profil di sini.
//
// Pemetaan role database (business_members.role + outlet) → profil kerja:
//   owner, admin                         → "owner"        (semua fungsi, pilih lokasi bebas)
//   purchasing, outlet kosong            → "purchasing_gudang" (purchasing merangkap gudang — pengaturan Nusa Food saat ini)
//   purchasing, outlet "GDG"/"GUDANG"    → "gudang"       (khusus gudang)
//   purchasing, outlet area lain (mis. Jagasatru) → "purchasing" (belanja + barang masuk + waste, lokasi bebas)
//   dapur + outlet KBU/KSM/SMT           → "outlet_dapur" (daftar SO area dapur)
//   kasir + outlet KBU/KSM/SMT           → "outlet_bar"   (daftar SO area bar; Samtaro tanpa area = semua baris)
//   lainnya / outlet belum diatur        → "none"         (tidak ada akses, TIDAK jatuh ke owner)
//
// Kelola (master bahan, daftar SO) & Resep Menu: owner, purchasing, gudang — tidak untuk outlet.
//
// Pengamanan data tetap di database (RLS & RPC: kasir/dapur terkunci di outletnya, penjualan & audit hanya
// owner/admin). Profil ini mengatur apa yang tampil dan dipakai sebagai penjaga URL langsung (?tab=).

import { LOKASI } from "./inventoryLogic.js";

const OUTLETS = ["KBU", "KSM", "SMT"];

/** Kemampuan (capability) yang dipakai UI. */
export const CAP = {
  HARI: "hari",
  SO: "so",
  WASTE: "waste",
  MASUK: "masuk",
  PRODUKSI: "produksi",
  KIRIM_MINTA: "kirim.minta", // outlet membuat permintaan stok
  KIRIM_KIRIM: "kirim.kirim", // gudang memproses permintaan & kirim langsung
  KIRIM_TERIMA: "kirim.terima", // outlet cek & terima kiriman
  KIRIM_SEMUA: "kirim.semua", // lihat kiriman semua outlet
  RINGKASAN: "ringkasan",
  HAPUS_RIWAYAT: "riwayat.hapus",
  AUDIT: "audit",
  PENJUALAN: "penjualan",
  MENU: "menu",
  KELOLA: "kelola",
  BELANJA: "belanja", // pintasan ke Catat Belanja (modul keuangan)
};

const ALL = Object.values(CAP);

const PROFILES = {
  owner: {
    label: "Owner",
    caps: ALL.filter((c) => c !== CAP.BELANJA),
    fixedLokasi: null,
    area: null,
    areaPilih: true,
  },
  purchasing_gudang: {
    label: "Purchasing & Gudang",
    caps: [CAP.HARI, CAP.BELANJA, CAP.SO, CAP.WASTE, CAP.MASUK, CAP.PRODUKSI, CAP.KIRIM_KIRIM, CAP.KIRIM_SEMUA, CAP.RINGKASAN, CAP.MENU, CAP.KELOLA],
    fixedLokasi: "GDG",
    masukLokasiBebas: true,
    masukSumber: null,
    area: null,
  },
  gudang: {
    label: "Gudang",
    caps: [CAP.HARI, CAP.SO, CAP.WASTE, CAP.MASUK, CAP.PRODUKSI, CAP.KIRIM_KIRIM, CAP.KIRIM_SEMUA, CAP.RINGKASAN, CAP.MENU, CAP.KELOLA],
    fixedLokasi: "GDG",
    area: null,
  },
  purchasing: {
    label: "Purchasing",
    caps: [CAP.HARI, CAP.BELANJA, CAP.WASTE, CAP.MASUK, CAP.RINGKASAN, CAP.MENU, CAP.KELOLA],
    fixedLokasi: null,
    masukLokasiBebas: true,
    masukSumber: ["pembelian", "retur"],
    ringkasanReadOnly: true,
    area: null,
  },
  outlet_dapur: {
    label: "Dapur outlet",
    caps: [CAP.HARI, CAP.SO, CAP.WASTE, CAP.PRODUKSI, CAP.KIRIM_MINTA, CAP.KIRIM_TERIMA, CAP.RINGKASAN],
    area: "dapur",
  },
  outlet_bar: {
    label: "Bar / kasir outlet",
    caps: [CAP.HARI, CAP.SO, CAP.WASTE, CAP.PRODUKSI, CAP.KIRIM_MINTA, CAP.KIRIM_TERIMA, CAP.RINGKASAN],
    area: "bar",
  },
  none: { label: "Tanpa akses", caps: [], fixedLokasi: null, area: null },
};

/** Kunci profil dari user { role, outlet }. Role tak dikenal → "none". */
export function profileKey(user) {
  const role = String(user?.role || "").toLowerCase();
  const outlet = String(user?.outlet || "").trim().toUpperCase();
  if (role === "owner" || role === "admin") return "owner";
  if (role === "purchasing") {
    if (!outlet) return "purchasing_gudang";
    if (outlet === "GDG" || outlet === "GUDANG") return "gudang";
    if (OUTLETS.includes(outlet)) return "purchasing_gudang";
    return "purchasing";
  }
  if (role === "dapur") return OUTLETS.includes(outlet) ? "outlet_dapur" : "none";
  if (role === "kasir") return OUTLETS.includes(outlet) ? "outlet_bar" : "none";
  return "none";
}

/**
 * Profil akses lengkap untuk satu user.
 * { key, label, can(cap), lokasiOptions(tab), defaultLokasi, area (null = semua / boleh pilih), areaPilih, masukSumber, outlet }
 */
export function dapurAccess(user) {
  const key = profileKey(user);
  const p = PROFILES[key];
  const outlet = String(user?.outlet || "").trim().toUpperCase();
  const isOutlet = key === "outlet_dapur" || key === "outlet_bar";
  const caps = new Set(p.caps);
  const lokasiOptions = (tab) => {
    if (key === "none") return [];
    if (isOutlet) return [outlet];
    if (tab === "masuk" && p.masukLokasiBebas) return LOKASI;
    if (p.fixedLokasi) return [p.fixedLokasi];
    return LOKASI;
  };
  return {
    key,
    label: p.label,
    can: (cap) => caps.has(cap),
    canTab: (tab) => tabAllowed(caps, tab),
    lokasiOptions,
    defaultLokasi: isOutlet ? outlet : p.fixedLokasi || (key === "none" ? null : "GDG"),
    // Lokasi yang boleh dilihat di Stok & Riwayat / Hari Ini.
    lihatLokasi: isOutlet ? [outlet] : key === "none" ? [] : LOKASI,
    area: p.area,
    areaPilih: !!p.areaPilih,
    masukSumber: p.masukSumber || null,
    ringkasanReadOnly: !!p.ringkasanReadOnly,
    outlet: isOutlet ? outlet : null,
    isOutlet,
    isOwner: key === "owner",
    // Staf outlet hanya melihat barang di daftar SO outletnya (bukan semua barang yang terdaftar di outlet itu).
    hanyaDaftarSo: isOutlet,
  };
}

/** Tab utama modul Dapur, urutan tampil. `cap` = salah satu kemampuan cukup untuk menampilkan tab. */
export const DAPUR_TABS = [
  { id: "hari", label: "Hari Ini", caps: [CAP.HARI] },
  { id: "so", label: "SO", caps: [CAP.SO] },
  { id: "waste", label: "Waste", caps: [CAP.WASTE] },
  { id: "masuk", label: "Barang Masuk", caps: [CAP.MASUK] },
  { id: "produksi", label: "Produksi", caps: [CAP.PRODUKSI] },
  { id: "kirim", label: "Kirim Stok", caps: [CAP.KIRIM_KIRIM, CAP.KIRIM_MINTA, CAP.KIRIM_TERIMA] },
  { id: "ringkasan", label: "Stok & Riwayat", caps: [CAP.RINGKASAN] },
  { id: "audit", label: "Audit", caps: [CAP.AUDIT] },
  { id: "penjualan", label: "Penjualan", caps: [CAP.PENJUALAN] },
  { id: "menu", label: "Resep Menu", caps: [CAP.MENU] },
  { id: "kelola", label: "Kelola", caps: [CAP.KELOLA] },
];

function tabAllowed(caps, tab) {
  const t = DAPUR_TABS.find((x) => x.id === tab);
  return !!t && t.caps.some((c) => caps.has(c));
}

/** Label tab sesuai pekerjaan profil (mis. outlet: "Minta & Terima", gudang: "SO Gudang"). */
export function tabLabel(access, tab) {
  const t = DAPUR_TABS.find((x) => x.id === tab);
  if (!t) return tab;
  if (tab === "so") return access.isOutlet ? `SO ${access.area === "dapur" ? "Dapur" : "Bar"}` : access.defaultLokasi === "GDG" && !access.isOwner ? "SO Gudang" : "SO";
  if (tab === "kirim") return access.can(CAP.KIRIM_KIRIM) ? "Kirim Stok" : "Minta & Terima";
  if (tab === "waste" && access.isOutlet) return `Waste ${access.area === "dapur" ? "Dapur" : "Bar"}`;
  if (tab === "waste" && !access.isOwner && access.lokasiOptions("waste").join() === "GDG") return "Waste Gudang";
  if (tab === "produksi" && access.defaultLokasi === "GDG" && !access.isOwner) return "Produksi Gudang";
  return t.label;
}

export function visibleTabs(access) {
  return DAPUR_TABS.filter((t) => access.canTab(t.id)).map((t) => ({ ...t, label: tabLabel(access, t.id) }));
}

export const NO_ACCESS_MSG = "Menu ini tidak tersedia untuk peran kamu.";

/**
 * Resep produksi yang relevan untuk lokasi + area: hasil resep harus ada di daftar SO lokasi itu dengan area
 * yang sama (atau tanpa area). Tanpa area (gudang/owner) → semua resep.
 */
export function recipesForArea(recipes, templates, lokasi, area) {
  if (!area) return recipes || [];
  const ok = new Set(
    (templates || [])
      .filter((t) => t.lokasi === lokasi && t.aktif !== false && (!t.area || t.area === area))
      .map((t) => t.item_id)
  );
  return (recipes || []).filter((r) => ok.has(r.output_item_id));
}
