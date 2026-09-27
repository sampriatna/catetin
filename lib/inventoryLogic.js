// lib/inventoryLogic.js — logika murni Dapur (SO shift, waste, produksi) + format laporan WA.
// Tanpa akses Supabase supaya bisa dites dengan node.

export const LOKASI = ["GDG", "KBU", "KSM", "SMT"];
export const LOKASI_LABEL = { GDG: "Gudang", KBU: "Buri Umah (KBU)", KSM: "Kisamen (KSM)", SMT: "Samtaro (SMT)" };

export const SHIFTS = ["Pagi", "Siang", "Tutup"];

export const WASTE_REASONS = [
  "Basi / expired",
  "Rusak",
  "Jatuh / tumpah",
  "Salah produksi / gosong",
  "Kualitas tidak layak",
  "Sisa tidak laku",
  "Retur",
  "Staff meal",
  "Complimentary",
  "Trial / R&D",
  "Lainnya",
];

export const TIPE_LABEL = {
  bahan: "Bahan baku",
  setengah_jadi: "Setengah jadi",
  kemasan: "Kemasan",
  lainnya: "Lainnya",
};

/** Lokasi yang boleh dipilih user. Kasir terkunci di outletnya, purchasing default Gudang. */
/** Kasir & dapur terkunci di outletnya (dicek juga di database). */
export function isOutletLocked(role) {
  return role === "kasir" || role === "dapur";
}

export function allowedLokasi(user) {
  const role = user?.role || "kasir";
  if (isOutletLocked(role)) {
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

export const AREA_LABEL = { dapur: "Dapur", bar: "Bar / Kasir" };

/** Area daftar SO bawaan: akun dapur → dapur, kasir → bar, lainnya semua (null). */
export function defaultArea(user) {
  const role = user?.role || "";
  if (role === "dapur") return "dapur";
  if (role === "kasir") return "bar";
  return null;
}

/** Baris SO untuk area tertentu. Baris tanpa area (mis. Samtaro) tampil untuk semua. */
export function rowsForArea(rows, area) {
  if (!area) return rows || [];
  return (rows || []).filter((r) => !r.template || !r.area || r.area === area);
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

export function fmtQty(n, digits = 2) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? v.toLocaleString("id-ID") : v.toLocaleString("id-ID", { maximumFractionDigits: digits });
}

function header(title, { lokasi, tanggal, shift, by }) {
  const parts = [`*${title}*`, `📍 ${LOKASI_LABEL[lokasi] || lokasi}`, `📅 ${tanggal}${shift ? ` · Shift ${shift}` : ""}`];
  if (by) parts.push(`👤 ${by}`);
  return parts.join("\n");
}

/**
 * lines: [{ nama, satuan, qty, nilai, prevQty, minStok }]
 */
export function formatSoWa({ lokasi, tanggal, shift, by, lines, total, catatan, foto = 0, belumKonversi = 0, tambahan = [], area = null }) {
  const out = [header(area ? `SO SHIFT · ${String(AREA_LABEL[area] || area).toUpperCase()}` : "SO SHIFT", { lokasi, tanggal, shift, by }), ""];
  const alerts = [];
  let grup = null;
  for (const l of lines || []) {
    if (l.grup && l.grup !== grup) {
      if (grup !== null) out.push("");
      out.push(`*${l.grup.toUpperCase()}*`);
      grup = l.grup;
    }
    const st = stockStatus(l.statusQty ?? l.qty, l.minStok);
    const d = soDelta(l.prevQty, l.qty);
    const dTxt = d === null || d === 0 ? "" : ` (${d > 0 ? "+" : ""}${fmtQty(d)})`;
    out.push(`• ${l.nama}: ${fmtQty(l.qty)} ${l.satuan || ""}${dTxt}`.trimEnd());
    if (st === "habis" || st === "menipis") alerts.push(`${st === "habis" ? "🔴" : "🟠"} ${l.nama} ${fmtQty(l.statusQty ?? l.qty)}${l.statusSatuan ? ` ${l.statusSatuan}` : ""}${l.minStok ? ` (min ${fmtQty(l.minStok)})` : ""}`);
  }
  if (tambahan?.length) {
    out.push("", "*TAMBAHAN (belum di daftar)*");
    for (const x of tambahan) out.push(`• ${x.nama}: ${x.qty || "-"} ${x.satuan || ""}`.trimEnd());
  }
  out.push("", `Jumlah bahan dihitung: ${(lines || []).length}`, `💰 Nilai stok: *${fmtRp(total)}*`);
  if (belumKonversi) out.push(`ℹ️ ${belumKonversi} bahan belum ada konversi satuan (belum masuk nilai stok)`);
  if (foto) out.push(`📷 ${foto} foto terlampir di aplikasi`);
  if (alerts.length) out.push("", "*⚠️ Perlu diisi ulang:*", ...alerts);
  if (catatan) out.push("", `📝 ${catatan}`);
  return out.join("\n");
}

/** lines: [{ nama, satuan, qty, nilai, alasan }] */
export function formatWasteWa({ lokasi, tanggal, shift, by, lines, total, catatan, foto = 0 }) {
  const out = [header("LAPORAN WASTE", { lokasi, tanggal, shift, by }), ""];
  for (const l of lines || []) {
    out.push(`• ${l.nama}: ${fmtQty(l.qty)} ${l.satuan || ""} — ${l.alasan || "tanpa alasan"} (${fmtRp(l.nilai)})`);
  }
  out.push("", `🗑️ Total nilai waste: *${fmtRp(total)}*`);
  if (foto) out.push(`📷 ${foto} foto terlampir di aplikasi`);
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

// ── Template SO per outlet & konversi satuan ───────────────

const UNIT_ALIASES = {
  g: "gr", gr: "gr", grm: "gr", gram: "gr",
  kg: "kg", kilo: "kg", kilogram: "kg",
  ml: "ml", l: "l", lt: "l", ltr: "l", liter: "l", litre: "l",
  pc: "pcs", pcs: "pcs", pcss: "pcs", biji: "pcs", buah: "pcs", bh: "pcs",
  porsi: "porsi", prs: "porsi", portion: "porsi",
  pack: "pack", pak: "pack", pax: "pack", pck: "pack",
  btl: "btl", botol: "btl", bottle: "btl",
  ekor: "ekor", ekr: "ekor",
  karung: "karung", krg: "karung", sak: "karung",
  pouch: "pouch", klg: "klg", klng: "klg", kaleng: "klg",
  bks: "bks", bungkus: "bks", sachet: "sachet", sct: "sachet", saset: "sachet",
  lembar: "lembar", lbr: "lembar", sheet: "lembar",
  ikat: "ikat", iket: "ikat", papan: "papan", butir: "butir", btr: "butir", tray: "tray",
  box: "box", dus: "dus", drigen: "drigen", jerigen: "drigen", galon: "galon", cup: "cup", roll: "roll",
};

export function normUnit(u) {
  const k = String(u || "").toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_ALIASES[k] || k || null;
}

const UNIT_FACTORS = { gr: ["gr", 1], kg: ["gr", 1000], ml: ["ml", 1], l: ["ml", 1000] };

/** Konversi antar satuan yang pasti (sama, kg↔gr, l↔ml). null jika tidak bisa. */
export function convertUnit(qty, from, to) {
  const a = normUnit(from);
  const b = normUnit(to);
  if (qty === null || qty === undefined || Number.isNaN(Number(qty))) return null;
  if (!a || !b || a === b) return Number(qty);
  const fa = UNIT_FACTORS[a];
  const fb = UNIT_FACTORS[b];
  if (fa && fb && fa[0] === fb[0]) return (Number(qty) * fa[1]) / fb[1];
  return null;
}

/**
 * Baris form SO untuk satu lokasi. Pakai template (nama & satuan staf) bila ada,
 * sisanya bahan lokasi itu tanpa template (satuan master).
 * row: { key, item, label, grup, satuan_so, isi, catatan, template }
 */
export function buildSoRows(items, templates, lokasi) {
  const byId = Object.fromEntries((items || []).map((i) => [i.id, i]));
  const rows = [];
  const used = new Set();
  const tpl = (templates || [])
    .filter((t) => t.lokasi === lokasi && t.aktif !== false && byId[t.item_id] && byId[t.item_id].aktif !== false)
    .sort((a, b) => (a.urut || 0) - (b.urut || 0));
  for (const t of tpl) {
    const item = byId[t.item_id];
    used.add(item.id);
    rows.push({
      key: `t:${t.id}`, item, label: t.label, grup: t.grup || "Lainnya", satuan_so: t.satuan_so || item.satuan,
      isi: t.isi === null || t.isi === undefined || t.isi === "" ? null : Number(t.isi), catatan: t.catatan || null, template: true,
      area: t.area || null,
    });
  }
  const others = itemsForLokasi(items, lokasi)
    .filter((item) => !used.has(item.id))
    .map((item) => ({ key: `i:${item.id}`, item, label: item.nama, grup: item.kategori || "Lainnya", satuan_so: item.satuan, isi: 1, catatan: null, template: false, area: null }))
    .sort((a, b) => a.grup.localeCompare(b.grup) || a.label.localeCompare(b.label));
  return rows.concat(others);
}

/** Faktor satuan SO → satuan master; null bila belum diketahui. */
export function rowFactor(row) {
  if (row.isi !== null && row.isi !== undefined && Number(row.isi) > 0) return Number(row.isi);
  return convertUnit(1, row.satuan_so, row.item?.satuan);
}

/** qty satuan SO → { qty, satuan } untuk disimpan. Tanpa konversi: satuan SO apa adanya (nilai Rp 0). */
export function soToItemQty(row, qtySo) {
  const f = rowFactor(row);
  if (f === null) return { qty: round4(qtySo), satuan: row.satuan_so, converted: false };
  return { qty: round4(qtySo * f), satuan: row.item.satuan, converted: true };
}

/** qty tersimpan (qty+satuan) → satuan SO baris, untuk tampilan "SO lalu". */
export function itemToSoQty(row, qty, satuan) {
  if (qty === null || qty === undefined) return null;
  if (normUnit(satuan) === normUnit(row.satuan_so)) return Number(qty);
  const direct = convertUnit(qty, satuan, row.satuan_so);
  if (direct !== null) return round4(direct);
  const f = rowFactor(row);
  if (f && normUnit(satuan) === normUnit(row.item?.satuan)) return round4(Number(qty) / f);
  return null;
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/**
 * Baris SO dari isian per baris form { [row.key]: "1,5" }.
 * Beberapa baris template ke bahan yang sama dijumlahkan (jika satuan sama).
 */
export function buildSoLinesFromRows(rows, counts) {
  const byItem = new Map();
  const errors = [];
  for (const r of rows || []) {
    const q = parseQty(counts?.[r.key]);
    if (q === null) continue;
    if (Number.isNaN(q)) { errors.push(r.label); continue; }
    const conv = soToItemQty(r, q);
    const k = `${r.item.id}|${normUnit(conv.satuan)}`;
    const prev = byItem.get(k);
    if (prev) {
      prev.qty = round4(prev.qty + conv.qty);
      prev.qty_input = round4(prev.qty_input + q);
      prev.label = `${prev.label} + ${r.label}`;
    } else {
      byItem.set(k, { item_id: r.item.id, arah: "hitung", qty: conv.qty, satuan: conv.satuan, qty_input: q, satuan_input: r.satuan_so, label: r.label, converted: conv.converted });
    }
  }
  const lines = [...byItem.values()];
  const itemsSeen = new Map();
  for (const l of lines) itemsSeen.set(l.item_id, (itemsSeen.get(l.item_id) || 0) + 1);
  for (const [id, n] of itemsSeen) {
    if (n > 1) errors.push(`${(rows.find((r) => r.item.id === id) || {}).label || id} (satuan berbeda untuk bahan yang sama)`);
  }
  return { lines, errors };
}

// ── Tempel laporan WA ──────────────────────────────────────

const NUM_RE = /(\d+(?:[.,]\d+)*)/;

/** Angka gaya WA: "1,5" → 1.5, "6.5" → 6.5, "1.000" → 1000. */
export function parseWaNumber(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  if (/^\d{1,3}(,\d{3}){2,}$/.test(t)) return Number(t.replace(/,/g, ""));
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function cleanWaLine(raw) {
  return String(raw || "")
    .replace(/[*_~`]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/^\s*(?:[-•·▪►>]+|\d{1,2}[.)]\s+)\s*/, "")
    .replace(/[“”"’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };

/** Tanggal di baris judul WA: "26-09-2026", "26/09", "Sabtu, 26 September 2026". */
export function parseWaDate(line, year = null) {
  const s = String(line || "");
  let dd;
  let mm;
  let yy;
  // "6.5" bisa berarti 6,5 kg — titik hanya dianggap tanggal bila ada tahunnya.
  const a = s.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/) || s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  const b = s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
  if (a) { dd = Number(a[1]); mm = Number(a[2]); yy = a[3]; }
  else if (b) { dd = Number(b[1]); mm = BULAN[b[2].toLowerCase()]; yy = b[3]; }
  else return null;
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
  const y = yy ? (yy.length === 2 ? `20${yy}` : yy) : String(year || new Date().getFullYear());
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

const EMPTY_WORDS = /^(?:-+|habis|kosong|nihil|nol|x|tidak ada|gak ada|ga ada|ngga ada|0)$/i;

/** "2.4 Kg + 2.4 Kg (blm)" → [{qty:2.4,unit:'kg'},{qty:2.4,unit:'kg'}]; "-" → [{qty:0}] */
export function parseWaValue(v) {
  let s = String(v || "").replace(/\(([^)]*)\)/g, " ").replace(/\best(?:imasi)?\b\.*/gi, " ").replace(/\.{2,}/g, " ").trim();
  s = s.replace(/^[:=\s]+/, "").trim();
  if (!s) return null;
  if (EMPTY_WORDS.test(s)) return [{ qty: 0, unit: null }];
  const terms = [];
  // "2.4 Kg + 2.4 Kg", "1btl 255 ml" (botol utuh + sisa) → beberapa term dijumlah.
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)*)\s*([a-zA-Z]+)?/g)) {
    const qty = parseWaNumber(m[1]);
    if (qty === null) continue;
    terms.push({ qty, unit: m[2] ? normUnit(m[2]) : null });
  }
  return terms.length ? terms : null;
}

function isWasteSection(name) {
  return /waste|buang|rusak|basi|reject/i.test(name || "");
}
function isNoteSection(name) {
  return /menipis|limit|habis|order|request|permintaan|kurang|catatan|note/i.test(name || "");
}

/**
 * Parse laporan SO dari WA.
 * Return { tanggal, counts:[{section,label,terms,raw}], waste:[...], notes:[raw], ignored:[raw] }
 */
export function parseWaStock(text, { year = null } = {}) {
  const out = { tanggal: null, counts: [], waste: [], notes: [], ignored: [] };
  let section = "";
  const lines = String(text || "").split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = cleanWaLine(raw);
    if (!line) continue;
    if (!/:\s*\d/.test(line)) {
      const tgl = parseWaDate(line, year);
      if (tgl) {
        if (!out.tanggal) out.tanggal = tgl;
        section = "";
        continue;
      }
    }
    const rawTrim = String(raw).trim();
    const bold = /^\*/.test(rawTrim);
    // Judul bagian yang dikenal (WASTE, Menipis, Limit / habis) walau tanpa tanda bintang.
    if (!NUM_RE.test(line) && line.length <= 40 && (isWasteSection(line) || isNoteSection(line)) && !/[:=]\s*\S/.test(line)) {
      section = line.replace(/[:=]\s*$/, "").trim();
      continue;
    }
    let label;
    let value;
    const sep = line.match(/^(.*?)\s*[:=]\s*(.*)$/);
    if (sep) {
      label = sep[1].trim();
      value = sep[2].trim();
    } else {
      const m = line.match(/^(.*?[a-zA-Z)].*?)\s+((?:est\.*\s*)?(?:\d+(?:[.,]\d+)*\s*[a-zA-Z]*(?:\s*\+\s*\d+(?:[.,]\d+)*\s*[a-zA-Z]*)*|-+|habis|kosong))\s*(?:\([^)]*\))?$/i);
      if (m) { label = m[1].trim(); value = m[2].trim(); }
    }
    const terms = label ? parseWaValue(value) : null;
    if (!label || !terms || !/[a-zA-Z]/.test(label)) {
      // Judul bagian: baris pendek tanpa angka, atau "Bagian:" tanpa nilai.
      const head = (sep && !sep[2].trim() ? sep[1] : line).trim();
      const inList = isNoteSection(section) || isWasteSection(section);
      const looksHead = bold || (sep && !sep[2].trim()) || !inList;
      if (looksHead && !NUM_RE.test(head) && head.length <= 40 && !/^pic\b|^nama\b|^shift\b/i.test(head)) {
        section = head;
      } else if (inList) {
        out.notes.push(line);
      } else {
        out.ignored.push(line);
      }
      continue;
    }
    if (/^pic\b|^nama\b|^tgl\b|^tanggal\b|^shift\b|^jam\b/i.test(label)) { out.ignored.push(line); continue; }
    // Daftar "Menipis/Limit" biasanya tanpa titik dua; baris "Nama : qty" berarti daftar stok sudah lanjut lagi.
    if (isNoteSection(section) && sep) section = "";
    const entry = { section, label, terms, raw: line };
    if (isWasteSection(section)) out.waste.push(entry);
    else if (isNoteSection(section)) out.notes.push(line);
    else out.counts.push(entry);
  }
  return out;
}

const LABEL_EXPAND = { s: "sirup", p: "powder", b: "bumbu", t: "teh", cb: "cabe" };

export function normLabel(s) {
  return normSearch(String(s || "").replace(/\b([a-z]{1,2})\./gi, (m, a) => `${LABEL_EXPAND[a.toLowerCase()] || a} `))
    .split(" ")
    .filter((w) => w && !/^\d+(?:l|ml|kg|gr)?$/.test(w) && !["pouch", "est", "stok", "stock"].includes(w))
    .map((w) => (LABEL_EXPAND[w] || w))
    .join(" ");
}

function bigrams(s) {
  const t = ` ${s} `;
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}
function dice(a, b) {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const m = new Map();
  for (const x of B) m.set(x, (m.get(x) || 0) + 1);
  let hit = 0;
  for (const x of A) { const c = m.get(x); if (c) { hit++; m.set(x, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}

/** Skor kecocokan label WA ke baris form (0..1). */
export function labelScore(waLabel, row) {
  const w = normLabel(waLabel);
  if (!w) return 0;
  let best = 0;
  for (const cand of [row.label, row.item?.nama, row.item?.kode]) {
    const c = normLabel(cand);
    if (!c) continue;
    if (c === w) return 1;
    const wt = w.split(" ");
    const ct = c.split(" ");
    if (wt.every((x) => ct.includes(x)) || ct.every((x) => wt.includes(x))) best = Math.max(best, 0.9 - 0.02 * Math.abs(wt.length - ct.length));
    best = Math.max(best, dice(w, c));
  }
  return best;
}

export function matchRow(waLabel, rows, min = 0.72) {
  let best = null;
  let score = 0;
  for (const r of rows || []) {
    const s = labelScore(waLabel, r);
    if (s > score) { score = s; best = r; }
  }
  return score >= min ? { row: best, score } : null;
}

/**
 * Salah ketik umum: "1btl 205 btl" maksudnya 1 botol + 205 ml. Term lanjutan dengan satuan besar yang sama
 * dan angka ≥ 20 dianggap dalam satuan hitung staf.
 */
export function fixWaTerms(terms, satuanSo) {
  const so = normUnit(satuanSo);
  if (!terms || terms.length < 2 || !so) return terms;
  const first = terms[0].unit;
  return terms.map((t, i) => (i > 0 && t.unit && t.unit === first && t.unit !== so && t.qty >= 20 ? { ...t, unit: so } : t));
}

/** Jumlahkan term ke satuan target; null bila ada term yang tidak bisa dikonversi. */
export function termsToUnit(terms, target, row = null) {
  let total = 0;
  for (const t of terms || []) {
    if (!t.unit) { total += t.qty; continue; }
    const c = convertUnit(t.qty, t.unit, target);
    if (c !== null) { total += c; continue; }
    if (row) {
      const f = rowFactor(row);
      const toItem = convertUnit(t.qty, t.unit, row.item?.satuan);
      if (f && toItem !== null && normUnit(target) === normUnit(row.satuan_so)) { total += toItem / f; continue; }
    }
    return null;
  }
  return round4(total);
}

/**
 * Terapkan hasil parse WA ke baris form SO.
 * Return { counts:{[key]:"qty"}, matched:[{label,row,qty}], unmatched:[entry], unconvertible:[entry] }
 */
export function applyWaToRows(parsed, rows) {
  const counts = {};
  const matched = [];
  const unmatched = [];
  const unconvertible = [];
  for (const e of parsed?.counts || []) {
    const m = matchRow(e.label, rows);
    if (!m) { unmatched.push(e); continue; }
    const q = termsToUnit(fixWaTerms(e.terms, m.row.satuan_so), m.row.satuan_so, m.row);
    if (q === null) { unconvertible.push({ ...e, row: m.row }); continue; }
    const prev = parseQty(counts[m.row.key]);
    const val = round4((prev && !Number.isNaN(prev) ? prev : 0) + q);
    counts[m.row.key] = String(val).replace(".", ",");
    matched.push({ label: e.label, row: m.row, qty: val });
  }
  return { counts, matched, unmatched, unconvertible };
}

/** Bagian WASTE dari WA → baris waste { item, qty (satuan master), label } + yang tidak dikenali. */
export function wasteFromWa(parsed, rows) {
  const out = [];
  const unmatched = [];
  for (const e of parsed?.waste || []) {
    const m = matchRow(e.label, rows);
    if (!m) { unmatched.push(e); continue; }
    const qSo = termsToUnit(fixWaTerms(e.terms, m.row.satuan_so), m.row.satuan_so, m.row);
    const f = rowFactor(m.row);
    if (qSo === null || f === null) { unmatched.push(e); continue; }
    if (qSo <= 0) continue;
    out.push({ item: m.row.item, qty: round4(qSo * f), label: e.label });
  }
  return { rows: out, unmatched };
}

// ── Permintaan & kirim stok (gudang → outlet) ──────────────

export const TRANSFER_STATUS = {
  diminta: "Menunggu dikirim",
  dikirim: "Dalam perjalanan",
  diterima: "Sudah diterima",
  batal: "Dibatalkan",
};

/** Baris permintaan/kiriman dari isian form per baris { [row.key]: "2" } (satuan staf). */
export function buildTransferLines(rows, counts) {
  const lines = [];
  const errors = [];
  for (const r of rows || []) {
    const q = parseQty(counts?.[r.key]);
    if (q === null || q === 0) continue;
    if (Number.isNaN(q)) { errors.push(r.label); continue; }
    lines.push({ item_id: r.item.id, label: r.label, satuan: r.satuan_so, isi: rowFactor(r), qty: q });
  }
  return { lines, errors };
}

/** Nilai baris: qty × isi × modal. Tanpa konversi = 0. */
export function transferLineNilai(qty, isi, harga) {
  if (isi === null || isi === undefined) return 0;
  return round2((Number(qty) || 0) * Number(isi) * (Number(harga) || 0));
}

/**
 * Teks WA untuk tahap minta / kirim / terima.
 * lines: [{ nama, satuan, qty_minta, qty_kirim, qty_terima, nilai }]
 */
export function formatTransferWa({ tahap, dari = "GDG", ke, tanggal, by, lines, total, catatan, foto = 0 }) {
  const title = { minta: "PERMINTAAN STOK", kirim: "KIRIM STOK", terima: "TERIMA STOK" }[tahap] || "STOK";
  const out = [`*${title}*`, `🚚 ${LOKASI_LABEL[dari] || dari} → ${LOKASI_LABEL[ke] || ke}`, `📅 ${tanggal}`];
  if (by) out.push(`👤 ${by}`);
  out.push("");
  const key = { minta: "qty_minta", kirim: "qty_kirim", terima: "qty_terima" }[tahap];
  const prevKey = { kirim: "qty_minta", terima: "qty_kirim" }[tahap];
  const beda = [];
  for (const l of lines || []) {
    const q = l[key];
    const p = prevKey ? l[prevKey] : null;
    const diff = prevKey && p !== null && p !== undefined && Number(q || 0) !== Number(p);
    out.push(`• ${l.nama}: ${fmtQty(q || 0)} ${l.satuan || ""}${diff ? ` (${tahap === "kirim" ? "diminta" : "dikirim"} ${fmtQty(p)})` : ""}`.trimEnd());
    if (diff) beda.push(l);
  }
  if (tahap !== "minta") out.push("", `💰 Nilai: *${fmtRp(total)}*`);
  if (beda.length) {
    out.push("", tahap === "kirim" ? "*⚠️ Tidak sesuai permintaan:*" : "*⚠️ Selisih terima vs kirim:*");
    for (const l of beda) {
      const d = round2(Number(l[key] || 0) - Number(l[prevKey] || 0));
      out.push(`${d < 0 ? "🔻" : "🔺"} ${l.nama} ${d > 0 ? "+" : ""}${fmtQty(d)} ${l.satuan || ""}`.trimEnd());
    }
  }
  if (foto) out.push(`📷 ${foto} foto terlampir di aplikasi`);
  if (catatan) out.push("", `📝 ${catatan}`);
  return out.join("\n");
}

// ── Nilai stok: ringkasan tren ─────────────────────────────

/**
 * rows dari inv_stock_value_series: [{ tanggal, lokasi, nilai }].
 * Return { dates, byLokasi: { KBU: [nilai per tanggal] }, total: [..], last, prev1, prev7 }.
 * Hari tanpa SO sama sekali = null (bukan 0) supaya tidak terlihat "stok hilang".
 */
export function summarizeValueSeries(rows, lokasiList = LOKASI) {
  const dates = [...new Set((rows || []).map((r) => String(r.tanggal).slice(0, 10)))].sort();
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const byLokasi = {};
  for (const l of lokasiList) byLokasi[l] = dates.map(() => null);
  for (const r of rows || []) {
    if (!(r.lokasi in byLokasi)) continue;
    byLokasi[r.lokasi][idx[String(r.tanggal).slice(0, 10)]] = round2(r.nilai);
  }
  const total = dates.map((_, i) => {
    const vals = lokasiList.map((l) => byLokasi[l][i]).filter((v) => v !== null);
    return vals.length ? round2(vals.reduce((a, b) => a + b, 0)) : null;
  });
  const at = (arr, back) => (arr.length > back ? arr[arr.length - 1 - back] : null);
  const delta = (arr, back) => {
    const a = at(arr, 0);
    const b = at(arr, back);
    return a === null || b === null ? null : round2(a - b);
  };
  const perLokasi = Object.fromEntries(lokasiList.map((l) => [l, {
    last: at(byLokasi[l], 0), d1: delta(byLokasi[l], 1), d7: delta(byLokasi[l], 7),
  }]));
  return { dates, byLokasi, total, last: at(total, 0), d1: delta(total, 1), d7: delta(total, 7), perLokasi };
}

// ── Status hari ini (checklist kasir/dapur/gudang) ─────────

/**
 * Ringkasan pekerjaan stok hari ini untuk satu lokasi (null = semua lokasi, untuk owner).
 * events: inv_events (butuh tanggal, jenis, lokasi, created_by, created_at, total_nilai)
 * transfers: inv_transfers (status, dari, ke)
 */
export function summarizeDapurToday({ events, transfers, lokasi = null, userId = null, today }) {
  const ev = (events || []).filter((e) => e.tanggal === today && (!lokasi || e.lokasi === lokasi));
  const so = ev.filter((e) => e.jenis === "so").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const mine = userId ? so.find((e) => e.created_by === userId) || null : null;
  const waste = ev.filter((e) => e.jenis === "waste");
  const tr = transfers || [];
  const gudang = lokasi === "GDG";
  const soByLokasi = {};
  const soByArea = {};
  for (const e of so) {
    if (!soByLokasi[e.lokasi]) soByLokasi[e.lokasi] = e;
    const k = `${e.lokasi}:${e.area || ""}`;
    if (!soByArea[k]) soByArea[k] = e;
  }
  return {
    soMine: !!mine,
    soMineAt: mine?.created_at || null,
    soLast: so[0] || null,
    soCount: so.length,
    soByLokasi,
    soByArea,
    wasteCount: waste.length,
    wasteNilai: round2(waste.reduce((s, e) => s + (Number(e.total_nilai) || 0), 0)),
    produksiCount: ev.filter((e) => e.jenis === "produksi").length,
    // Barang sudah dikirim gudang tapi belum dicek outlet.
    kirimanMasuk: tr.filter((t) => t.status === "dikirim" && (!lokasi || gudang ? true : t.ke === lokasi)).length,
    // Permintaan yang belum diproses gudang (gudang/owner: semua outlet).
    permintaanMenunggu: tr.filter((t) => t.status === "diminta" && (!lokasi || gudang ? true : t.ke === lokasi)).length,
  };
}

export function fmtJam(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${String(w.getUTCHours()).padStart(2, "0")}.${String(w.getUTCMinutes()).padStart(2, "0")}`;
}

// ── Audit stok harian (Tahap A, tanpa data penjualan) ──────

export const PRIORITY = ["INFO", "WATCH", "WARNING", "CRITICAL"];
export const PRIORITY_LABEL = { INFO: "Info", WATCH: "Pantau", WARNING: "Peringatan", CRITICAL: "Kritis" };
export const AREA_SO = [
  { lokasi: "GDG", area: null, label: "Gudang" },
  { lokasi: "KBU", area: "dapur", label: "KBU Kitchen" },
  { lokasi: "KBU", area: "bar", label: "KBU Bar" },
  { lokasi: "KSM", area: "dapur", label: "Kisamen Kitchen" },
  { lokasi: "KSM", area: "bar", label: "Kisamen Bar" },
  { lokasi: "SMT", area: null, label: "Samtaro" },
];

/** Prioritas dari nilai Rupiah; kejadian berulang (≥3) naik satu tingkat. */
export function priorityFor(rp, repeat = 1) {
  const v = Math.abs(Number(rp) || 0);
  let i = v >= 500000 ? 3 : v >= 100000 ? 2 : v >= 25000 ? 1 : 0;
  if (repeat >= 3) i = Math.min(3, i + 1);
  return PRIORITY[i];
}

/** Toleransi selisih wajar per satuan (supaya timbangan/tetesan kecil tidak jadi alarm). */
export function varianceTolerance(satuan, ref) {
  const u = normUnit(satuan);
  const base = u === "gr" || u === "ml" ? 5 : u === "kg" || u === "l" ? 0.005 : 0.5;
  return Math.max(base, Math.abs(Number(ref) || 0) * 0.02);
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Hitung buku pergerakan per barang per lokasi dari inv_stock_movements, lalu cari kejanggalan.
 * movements: [{ tanggal, lokasi, item_id, tipe, qty, created_at, oleh }]
 * Return { findings, ledger } — ledger: per pasangan SO: { prev, cur, masuk, keluar, expected, variance }.
 * SO staf tidak pernah diubah; selisih disimpan sebagai data audit.
 */
export function auditMovements(movements, itemsById, { from = null, hasSales = false } = {}) {
  const groups = new Map();
  for (const m of movements || []) {
    const k = `${m.lokasi}|${m.item_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ ...m, qty: Number(m.qty) || 0 });
  }
  const findings = [];
  const ledger = [];
  for (const [k, list] of groups) {
    const [lokasi, itemId] = k.split("|");
    const item = itemsById?.[itemId];
    if (!item) continue;
    const harga = Number(item.harga) || 0;
    list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const sos = list.filter((m) => m.tipe === "so");
    const usages = [];
    let naikCount = 0;
    for (let i = 1; i < sos.length; i++) {
      const prev = sos[i - 1];
      const cur = sos[i];
      const between = list.filter((m) => m.tipe !== "so" && m.created_at > prev.created_at && m.created_at <= cur.created_at);
      const masuk = between.filter((m) => ["masuk", "prod_in", "trf_in"].includes(m.tipe)).reduce((s, m) => s + m.qty, 0);
      const keluar = between.filter((m) => ["waste", "prod_out", "trf_out"].includes(m.tipe)).reduce((s, m) => s + m.qty, 0);
      const expected = round4(prev.qty + masuk - keluar);
      const variance = round4(cur.qty - expected);
      const tol = varianceTolerance(item.satuan, Math.max(prev.qty, cur.qty));
      const row = { lokasi, item_id: itemId, tanggal: cur.tanggal, prev: prev.qty, cur: cur.qty, masuk: round4(masuk), keluar: round4(keluar), expected, variance, oleh: cur.oleh };
      ledger.push(row);
      const inWindow = !from || cur.tanggal >= from;
      if (variance > tol) {
        naikCount++;
        if (inWindow) {
          const rp = round2(variance * harga);
          findings.push({
            type: "naik", lokasi, item_id: itemId, tanggal: cur.tanggal, priority: priorityFor(rp, naikCount), confidence: "MEDIUM", rp,
            qty: variance, status: "Perlu dicek",
            message: `${item.nama} naik ${fmtQty(variance)} ${item.satuan} dibanding stok seharusnya (${fmtQty(prev.qty)}${masuk ? ` + masuk ${fmtQty(masuk)}` : ""}${keluar ? ` − keluar ${fmtQty(keluar)}` : ""} → ${fmtQty(expected)}, SO ${fmtQty(cur.qty)})${masuk ? "" : " tanpa barang masuk tercatat"}. Kemungkinan: barang masuk belum dicatat, salah hitung SO, atau salah satuan.`,
          });
        }
      } else if (variance < 0) {
        const used = -variance;
        const hist = usages.slice(-10);
        if (inWindow && hist.length >= 3) {
          const med = median(hist);
          if (used > med * 2.5 && used - med > tol) {
            const rp = round2((used - med) * harga);
            findings.push({
              type: "turun", lokasi, item_id: itemId, tanggal: cur.tanggal, priority: priorityFor(rp), confidence: hasSales ? "MEDIUM" : "LOW", rp,
              qty: used, status: hasSales ? "Perlu dicek" : "Menunggu data penjualan",
              message: `${item.nama} berkurang ${fmtQty(used)} ${item.satuan} (biasanya ±${fmtQty(med)}) tanpa waste tercatat. Tandai untuk dicocokkan dengan penjualan.`,
            });
          }
        }
        usages.push(used);
      } else {
        usages.push(0);
      }
    }
    // SO sama persis 3× berturut-turut tanpa pergerakan di antaranya
    if (sos.length >= 3) {
      const last = sos.slice(-3);
      const same = last.every((s) => s.qty === last[0].qty) && last[0].qty > 0;
      const moved = list.some((m) => m.tipe !== "so" && m.created_at > last[0].created_at && m.created_at <= last[2].created_at);
      if (same && !moved && (!from || last[2].tanggal >= from)) {
        const rp = round2(last[0].qty * harga);
        findings.push({
          type: "statis", lokasi, item_id: itemId, tanggal: last[2].tanggal, priority: rp >= 50000 ? "WATCH" : "INFO", confidence: "LOW", rp: 0,
          qty: last[0].qty, status: "Perlu dicek",
          message: `${item.nama} tidak berubah selama 3 kali SO (${fmtQty(last[0].qty)} ${item.satuan}). Periksa apakah memang tidak dipakai atau SO belum dihitung ulang.`,
        });
      }
    }
    // Angka selalu bulat (estimasi) untuk barang yang ditimbang
    const u = normUnit(item.satuan);
    if ((u === "gr" || u === "ml") && sos.length >= 5) {
      const last5 = sos.slice(-5);
      if (last5.every((s) => s.qty >= 100 && s.qty % 50 === 0) && (!from || last5[4].tanggal >= from)) {
        findings.push({
          type: "bulat", lokasi, item_id: itemId, tanggal: last5[4].tanggal, priority: "INFO", confidence: "LOW", rp: 0, qty: last5[4].qty,
          status: "Perlu dicek", message: `SO ${item.nama} 5 kali terakhir selalu angka bulat (kelipatan 50 ${item.satuan}). Kemungkinan masih perkiraan, belum ditimbang.`,
        });
      }
    }
    // Waste tinggi dalam periode
    const waste = list.filter((m) => m.tipe === "waste" && (!from || m.tanggal >= from));
    const wasteRp = round2(waste.reduce((s, m) => s + m.qty * harga, 0));
    if (wasteRp >= 50000) {
      findings.push({
        type: "waste", lokasi, item_id: itemId, tanggal: waste[waste.length - 1].tanggal, priority: priorityFor(wasteRp, waste.length), confidence: "HIGH",
        rp: wasteRp, qty: round4(waste.reduce((s, m) => s + m.qty, 0)), status: "Perlu dicek",
        message: `Waste ${item.nama} ${fmtRp(wasteRp)} (${waste.length}× dicatat) dalam periode ini.`,
      });
    }
  }
  findings.sort((a, b) => PRIORITY.indexOf(b.priority) - PRIORITY.indexOf(a.priority) || Math.abs(b.rp) - Math.abs(a.rp));
  return { findings, ledger };
}

/** Status SO per area hari ini: area SO tanpa area (Samtaro, Gudang) dianggap selesai bila ada SO apa pun. */
export function soAreaStatus(soByArea) {
  return AREA_SO.map((a) => {
    const e = a.area ? soByArea?.[`${a.lokasi}:${a.area}`] : soByArea?.[`${a.lokasi}:`] || Object.entries(soByArea || {}).find(([k]) => k.startsWith(`${a.lokasi}:`))?.[1];
    return { ...a, event: e || null };
  });
}

// ── Satuan bebas untuk waste / barang masuk ────────────────

/** Pilihan satuan untuk satu barang: satuan staf, satuan master, dan pasangan pastinya (gr↔kg, ml↔L). */
export function unitOptions(row) {
  const out = [];
  const add = (u) => { const n = normUnit(u); if (n && !out.includes(n)) out.push(n); };
  add(row?.satuan_so);
  add(row?.item?.satuan);
  for (const u of [...out]) {
    if (u === "gr" || u === "kg") { add("gr"); add("kg"); }
    if (u === "ml" || u === "l") { add("ml"); add("l"); }
  }
  return out;
}

/** qty dalam satuan pilihan → { qty, satuan, converted } dalam satuan master bila bisa. */
export function toItemQty(row, qty, unit) {
  const q = Number(qty) || 0;
  const u = normUnit(unit);
  const master = row?.item?.satuan;
  if (u === normUnit(master)) return { qty: round4(q), satuan: master, converted: true };
  const direct = convertUnit(q, u, master);
  if (direct !== null) return { qty: round4(direct), satuan: master, converted: true };
  if (u === normUnit(row?.satuan_so)) {
    const c = soToItemQty(row, q);
    return c.converted ? c : { qty: round4(q), satuan: row.satuan_so, converted: false };
  }
  const viaSo = convertUnit(q, u, row?.satuan_so);
  if (viaSo !== null) {
    const c = soToItemQty(row, viaSo);
    if (c.converted) return c;
  }
  return { qty: round4(q), satuan: unit, converted: false };
}

export const MASUK_SUMBER = [
  { id: "pembelian", label: "Pembelian" },
  { id: "retur", label: "Retur" },
  { id: "koreksi", label: "Koreksi stok" },
  { id: "lainnya", label: "Lainnya" },
];

/** lines: [{ nama, satuan, qty, nilai }] */
export function formatMasukWa({ lokasi, tanggal, by, sumber, lines, total, catatan, foto = 0 }) {
  const s = MASUK_SUMBER.find((x) => x.id === sumber)?.label || sumber;
  const out = [header(`BARANG MASUK · ${String(s).toUpperCase()}`, { lokasi, tanggal, by }), ""];
  for (const l of lines || []) out.push(`• ${l.nama}: ${fmtQty(l.qty)} ${l.satuan || ""}${l.nilai ? ` (${fmtRp(l.nilai)})` : ""}`.trimEnd());
  out.push("", `💰 Nilai: *${fmtRp(total)}*`);
  if (foto) out.push(`📷 ${foto} foto terlampir di aplikasi`);
  if (catatan) out.push("", `📝 ${catatan}`);
  return out.join("\n");
}
