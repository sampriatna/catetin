// lib/inventoryLogic.js — logika murni Dapur (SO shift, waste, produksi) + format laporan WA.
// Tanpa akses Supabase supaya bisa dites dengan node.

export const LOKASI = ["GDG", "KBU", "KSM", "SMT"];
export const LOKASI_LABEL = { GDG: "Gudang", KBU: "Buri Umah (KBU)", KSM: "Kisamen (KSM)", SMT: "Samtaro (SMT)" };

export const SHIFTS = ["Pagi", "Siang", "Tutup"];

export const WASTE_REASONS = [
  "Basi / expired",
  "Jatuh / tumpah",
  "Salah masak",
  "Sisa tidak laku",
  "Rusak / hama",
  "Lainnya",
];

export const TIPE_LABEL = {
  bahan: "Bahan baku",
  setengah_jadi: "Setengah jadi",
  kemasan: "Kemasan",
  lainnya: "Lainnya",
};

/** Lokasi yang boleh dipilih user. Kasir terkunci di outletnya, purchasing default Gudang. */
export function allowedLokasi(user) {
  const role = user?.role || "kasir";
  if (role === "kasir") {
    const o = String(user?.outlet || "").toUpperCase();
    return LOKASI.includes(o) ? [o] : [];
  }
  return LOKASI;
}

export function defaultLokasi(user) {
  const list = allowedLokasi(user);
  if ((user?.role || "") === "purchasing" && list.includes("GDG")) return "GDG";
  return list[0] || null;
}

export function canManageMaster(role) {
  return ["owner", "admin", "purchasing"].includes(role || "");
}

/** Bahan yang dihitung di lokasi ini (lokasi kosong = semua lokasi). */
export function itemsForLokasi(items, lokasi) {
  return (items || []).filter(
    (i) => i.aktif !== false && (!Array.isArray(i.lokasi) || i.lokasi.length === 0 || i.lokasi.includes(lokasi))
  );
}

export function normSearch(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Cari bahan: semua kata harus ada di nama/kode/kategori. */
export function searchItems(items, q) {
  const words = normSearch(q).split(" ").filter(Boolean);
  if (!words.length) return items || [];
  return (items || []).filter((i) => {
    const hay = normSearch(`${i.nama} ${i.kode} ${i.kategori || ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Parse angka input HP: terima koma desimal ("1,5"), kosong = null. */
export function parseQty(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function makeClientRef(prefix = "inv") {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}

export function todayJakarta(now = new Date()) {
  // YYYY-MM-DD di WIB (UTC+7) tanpa bergantung zona waktu HP
  const t = new Date(now.getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/**
 * Baris SO dari isian form { [itemId]: "12" }. Hanya bahan yang diisi (termasuk 0) yang disimpan.
 * Return { lines, errors } — errors berisi nama bahan dengan angka tidak valid.
 */
export function buildSoLines(items, counts) {
  const lines = [];
  const errors = [];
  for (const it of items || []) {
    const raw = counts?.[it.id];
    const q = parseQty(raw);
    if (q === null) continue;
    if (Number.isNaN(q)) { errors.push(it.nama); continue; }
    lines.push({ item_id: it.id, arah: "hitung", qty: q });
  }
  return { lines, errors };
}

/** Status stok vs minimum: 'habis' | 'menipis' | 'aman' | null (tanpa minimum). */
export function stockStatus(qty, minStok) {
  if (qty === null || qty === undefined) return null;
  if (Number(qty) <= 0) return "habis";
  if (minStok !== null && minStok !== undefined && Number(minStok) > 0 && Number(qty) < Number(minStok)) return "menipis";
  return minStok ? "aman" : null;
}

/** Selisih vs SO sebelumnya (positif = bertambah). */
export function soDelta(prevQty, qty) {
  if (prevQty === null || prevQty === undefined || qty === null || qty === undefined) return null;
  return round2(Number(qty) - Number(prevQty));
}

/**
 * Skala resep ke jumlah batch.
 * recipe: { hasil_qty, lines: [{ item_id, qty }] }
 */
export function scaleRecipe(recipe, batches) {
  const b = Number(batches) || 0;
  return {
    hasil: round2((Number(recipe?.hasil_qty) || 0) * b),
    bahan: (recipe?.lines || []).map((l) => ({ item_id: l.item_id, qty: round2((Number(l.qty) || 0) * b) })),
  };
}

/**
 * Modal produksi: total nilai bahan / hasil.
 * bahan: [{ qty, harga }]
 */
export function productionCost(bahan, hasilQty) {
  const total = round2((bahan || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.harga) || 0), 0));
  const h = Number(hasilQty) || 0;
  return { total, perUnit: h > 0 ? round2(total / h) : 0 };
}

export function sumNilai(lines, itemsById) {
  return round2((lines || []).reduce((s, l) => {
    const harga = itemsById?.[l.item_id]?.harga ?? l.harga ?? 0;
    return s + (Number(l.qty) || 0) * (Number(harga) || 0);
  }, 0));
}

/** Nilai stok per lokasi dari snapshot SO terakhir. rows: [{lokasi, nilai}] */
export function stockValueByLokasi(rows) {
  const out = {};
  for (const l of LOKASI) out[l] = 0;
  for (const r of rows || []) {
    if (!(r.lokasi in out)) out[r.lokasi] = 0;
    out[r.lokasi] = round2(out[r.lokasi] + (Number(r.nilai) || 0));
  }
  out.total = round2(LOKASI.reduce((s, l) => s + (out[l] || 0), 0));
  return out;
}

// ── Format WA ──────────────────────────────────────────────

export function fmtRp(n) {
  const v = Math.round(Number(n) || 0);
  return `Rp${v.toLocaleString("id-ID")}`;
}

export function fmtQty(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString("id-ID") : v.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function header(title, { lokasi, tanggal, shift, by }) {
  const parts = [`*${title}*`, `📍 ${LOKASI_LABEL[lokasi] || lokasi}`, `📅 ${tanggal}${shift ? ` · Shift ${shift}` : ""}`];
  if (by) parts.push(`👤 ${by}`);
  return parts.join("\n");
}

/**
 * lines: [{ nama, satuan, qty, nilai, prevQty, minStok }]
 */
export function formatSoWa({ lokasi, tanggal, shift, by, lines, total, catatan }) {
  const out = [header("SO SHIFT", { lokasi, tanggal, shift, by }), ""];
  const alerts = [];
  for (const l of lines || []) {
    const st = stockStatus(l.qty, l.minStok);
    const d = soDelta(l.prevQty, l.qty);
    const dTxt = d === null || d === 0 ? "" : ` (${d > 0 ? "+" : ""}${fmtQty(d)})`;
    out.push(`• ${l.nama}: ${fmtQty(l.qty)} ${l.satuan || ""}${dTxt}`.trimEnd());
    if (st === "habis" || st === "menipis") alerts.push(`${st === "habis" ? "🔴" : "🟠"} ${l.nama} ${fmtQty(l.qty)}${l.minStok ? ` (min ${fmtQty(l.minStok)})` : ""}`);
  }
  out.push("", `Jumlah bahan dihitung: ${(lines || []).length}`, `💰 Nilai stok: *${fmtRp(total)}*`);
  if (alerts.length) out.push("", "*⚠️ Perlu diisi ulang:*", ...alerts);
  if (catatan) out.push("", `📝 ${catatan}`);
  return out.join("\n");
}

/** lines: [{ nama, satuan, qty, nilai, alasan }] */
export function formatWasteWa({ lokasi, tanggal, shift, by, lines, total, catatan }) {
  const out = [header("LAPORAN WASTE", { lokasi, tanggal, shift, by }), ""];
  for (const l of lines || []) {
    out.push(`• ${l.nama}: ${fmtQty(l.qty)} ${l.satuan || ""} — ${l.alasan || "tanpa alasan"} (${fmtRp(l.nilai)})`);
  }
  out.push("", `🗑️ Total nilai waste: *${fmtRp(total)}*`);
  if (catatan) out.push("", `📝 ${catatan}`);
  return out.join("\n");
}

/** bahan: [{ nama, satuan, qty, nilai }], hasil: { nama, satuan, qty } */
export function formatProduksiWa({ lokasi, tanggal, by, resep, bahan, hasil, total, perUnit, stokHasil, catatan }) {
  const out = [header("PRODUKSI", { lokasi, tanggal, by }), ""];
  out.push(`🍳 ${resep ? `${resep} → ` : ""}*${hasil?.nama}*: ${fmtQty(hasil?.qty)} ${hasil?.satuan || ""}`.trimEnd());
  out.push("", "Bahan terpakai:");
  for (const l of bahan || []) out.push(`• ${l.nama}: ${fmtQty(l.qty)} ${l.satuan || ""} (${fmtRp(l.nilai)})`);
  out.push("", `💰 Total modal: *${fmtRp(total)}*`, `📦 Modal per ${hasil?.satuan || "satuan"}: *${fmtRp(perUnit)}*`);
  if (stokHasil !== null && stokHasil !== undefined) out.push(`📊 Stok ${hasil?.nama} (SO terakhir + produksi ini): ${fmtQty(stokHasil)} ${hasil?.satuan || ""}`.trimEnd());
  if (catatan) out.push("", `📝 ${catatan}`);
  return out.join("\n");
}
