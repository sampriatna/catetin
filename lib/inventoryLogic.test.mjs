// node --test lib/inventoryLogic.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedLokasi, defaultLokasi, itemsForLokasi, searchItems, parseQty, buildSoLines,
  stockStatus, soDelta, scaleRecipe, productionCost, stockValueByLokasi,
  formatSoWa, formatWasteWa, formatProduksiWa, todayJakarta, normalisasiIsi, isiDariKemasan, countsFromSoLines, stokMenipis, usulanPermintaan, soTidakWajar, cocokkanBelanja, belanjaKey, lokasiBelanja,
} from "./inventoryLogic.js";

const items = [
  { id: "a", kode: "AYMRGLR", nama: "Ayam Reguler", kategori: "Protein", satuan: "pcs", harga: 5000, lokasi: ["GDG", "KBU"], min_stok: 25 },
  { id: "b", kode: "MINGOR", nama: "Minyak Goreng", kategori: "Bumbu", satuan: "ml", harga: 20, lokasi: [] },
  { id: "c", kode: "OLD", nama: "Bahan Lama", satuan: "pcs", harga: 1, lokasi: [], aktif: false },
];

test("kasir terkunci di outletnya, purchasing default gudang", () => {
  assert.deepEqual(allowedLokasi({ role: "kasir", outlet: "ksm" }), ["KSM"]);
  assert.deepEqual(allowedLokasi({ role: "kasir", outlet: "" }), []);
  assert.equal(defaultLokasi({ role: "purchasing" }), "GDG");
  assert.equal(allowedLokasi({ role: "owner" }).length, 4);
});

test("bahan per lokasi: lokasi kosong = semua, nonaktif disembunyikan", () => {
  assert.deepEqual(itemsForLokasi(items, "KSM").map((i) => i.id), ["b"]);
  assert.deepEqual(itemsForLokasi(items, "KBU").map((i) => i.id), ["a", "b"]);
});

test("cari bahan pakai semua kata", () => {
  assert.deepEqual(searchItems(items, "ayam reg").map((i) => i.id), ["a"]);
  assert.deepEqual(searchItems(items, "mingor").map((i) => i.id), ["b"]);
  assert.equal(searchItems(items, "").length, 3);
});

test("parseQty terima koma, tolak minus", () => {
  assert.equal(parseQty("1,5"), 1.5);
  assert.equal(parseQty("1.000"), 1000);
  assert.equal(parseQty("12.500"), 12500);
  assert.equal(parseQty("1.250,5"), 1250.5);
  assert.equal(parseQty("0.5"), 0.5);
  assert.equal(parseQty("1.25"), 1.25);
  assert.equal(parseQty("0.500"), 0.5);
  assert.equal(parseQty(""), null);
  assert.equal(parseQty("0"), 0);
  assert.ok(Number.isNaN(parseQty("-2")));
  assert.ok(Number.isNaN(parseQty("abc")));
});

test("buildSoLines hanya simpan yang diisi, termasuk 0", () => {
  const { lines, errors } = buildSoLines(items, { a: "12", b: "0", c: "" });
  assert.deepEqual(lines, [
    { item_id: "a", arah: "hitung", qty: 12 },
    { item_id: "b", arah: "hitung", qty: 0 },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(buildSoLines(items, { a: "x" }).errors, ["Ayam Reguler"]);
});

test("status stok & selisih", () => {
  assert.equal(stockStatus(0, 10), "habis");
  assert.equal(stockStatus(5, 10), "menipis");
  assert.equal(stockStatus(15, 10), "aman");
  assert.equal(stockStatus(15, null), null);
  assert.equal(soDelta(10, 7), -3);
  assert.equal(soDelta(null, 7), null);
});

test("resep diskala per batch & modal per unit", () => {
  const r = { hasil_qty: 40, lines: [{ item_id: "a", qty: 12 }, { item_id: "b", qty: 500 }] };
  const s = scaleRecipe(r, 1.5);
  assert.equal(s.hasil, 60);
  assert.deepEqual(s.bahan, [{ item_id: "a", qty: 18 }, { item_id: "b", qty: 750 }]);
  const c = productionCost([{ qty: 12, harga: 38000 }, { qty: 500, harga: 20 }], 40);
  assert.equal(c.total, 466000);
  assert.equal(c.perUnit, 11650);
  assert.equal(productionCost([{ qty: 1, harga: 100 }], 0).perUnit, 0);
});

test("nilai stok per lokasi + total", () => {
  const v = stockValueByLokasi([{ lokasi: "GDG", nilai: 1000 }, { lokasi: "KBU", nilai: 250.5 }, { lokasi: "GDG", nilai: 500 }]);
  assert.equal(v.GDG, 1500);
  assert.equal(v.KBU, 250.5);
  assert.equal(v.KSM, 0);
  assert.equal(v.total, 1750.5);
});

test("tanggal WIB", () => {
  assert.equal(todayJakarta(new Date("2026-09-26T18:30:00Z")), "2026-09-27");
  assert.equal(todayJakarta(new Date("2026-09-26T16:00:00Z")), "2026-09-26");
});

test("format WA SO memuat alert menipis & nilai", () => {
  const t = formatSoWa({
    lokasi: "KBU", tanggal: "2026-09-27", shift: "Tutup", by: "Dodi",
    lines: [
      { nama: "Ayam Reguler", satuan: "pcs", qty: 10, prevQty: 30, minStok: 25 },
      { nama: "Minyak Goreng", satuan: "ml", qty: 5000, prevQty: 5000 },
    ],
    total: 150000,
  });
  assert.match(t, /SO SHIFT/);
  assert.match(t, /Buri Umah/);
  assert.match(t, /Ayam Reguler: 10 pcs \(-20\)/);
  assert.match(t, /USULAN PERMINTAAN KE GUDANG/);
  assert.match(t, /Ayam Reguler: \*15 pcs\* \(sisa 10 · min 25\)/);
  assert.match(t, /Rp150\.000/);
  assert.doesNotMatch(t, /Minyak Goreng: 5\.000 ml \(/);
});

test("format WA waste & produksi", () => {
  const w = formatWasteWa({ lokasi: "KSM", tanggal: "2026-09-27", lines: [{ nama: "Susu", satuan: "L", qty: 2, alasan: "Basi / expired", nilai: 32000 }], total: 32000 });
  assert.match(w, /LAPORAN WASTE/);
  assert.match(w, /Basi \/ expired/);
  const p = formatProduksiWa({
    lokasi: "GDG", tanggal: "2026-09-27", resep: "Ungkep ayam",
    bahan: [{ nama: "Ayam Potong", satuan: "kg", qty: 12, nilai: 456000 }],
    hasil: { nama: "Ayam Reguler", satuan: "pcs", qty: 40 }, total: 456000, perUnit: 11400, stokHasil: 55,
  });
  assert.match(p, /Ayam Reguler\*: 40 pcs/);
  assert.match(p, /Modal per pcs: \*Rp11\.400\*/);
  assert.match(p, /Stok Ayam Reguler .*: 55 pcs/);
});

// ── Template SO & tempel laporan WA ────────────────────────
import {
  normUnit, convertUnit, buildSoRows, soToItemQty, itemToSoQty, buildSoLinesFromRows,
  parseWaNumber, parseWaValue, parseWaDate, parseWaStock, applyWaToRows, wasteFromWa,
} from "./inventoryLogic.js";

const tItems = [
  { id: "brs", kode: "BRS", nama: "Beras", satuan: "kg", harga: 14000, lokasi: ["GDG", "KBU"] },
  { id: "otk", kode: "OTKOTK", nama: "Otak-otak", satuan: "pcs", harga: 1500, lokasi: ["KBU"] },
  { id: "crm", kode: "SRPCRML", nama: "Sirup Caramel", satuan: "btl", harga: 90000, lokasi: ["KBU"] },
  { id: "min", kode: "MINGOR", nama: "Minyak Goreng", satuan: "ml", harga: 20, lokasi: ["KBU"] },
  { id: "pak", kode: "PKCY", nama: "Pakcoy", satuan: "gr", harga: 20, lokasi: ["KSM"] },
  { id: "jmr", kode: "JMRKUPING", nama: "Jamur Kuping", satuan: "kg", harga: 40000, lokasi: ["KSM"] },
  { id: "gyz", kode: "GYOZA", nama: "Gyoza", satuan: "pcs", harga: 2500, lokasi: ["KSM"] },
  { id: "wjn", kode: "WIJEN", nama: "Biji Wijen", satuan: "gr", harga: 50, lokasi: ["KSM"] },
  { id: "bbk", kode: "BBK", nama: "Bebek Ungkep", satuan: "pcs", harga: 15000, lokasi: ["KBU"] },
];
const tTpl = [
  { id: 1, lokasi: "KBU", item_id: "brs", label: "Beras", grup: "Dapur", urut: 10, satuan_so: "karung", isi: 25 },
  { id: 2, lokasi: "KBU", item_id: "otk", label: "Otak-otak", grup: "Dapur", urut: 20, satuan_so: "pcs", isi: 1 },
  { id: 3, lokasi: "KBU", item_id: "crm", label: "S. Caramel", grup: "Bar", urut: 30, satuan_so: "ml", isi: null },
  { id: 4, lokasi: "KBU", item_id: "min", label: "Minyak Goreng", grup: "Dapur", urut: 15, satuan_so: "pouch", isi: null },
  { id: 5, lokasi: "KSM", item_id: "pak", label: "Pakcoy", grup: "Topping", urut: 10, satuan_so: "kg", isi: 1000 },
  { id: 6, lokasi: "KSM", item_id: "jmr", label: "Jamur kuping", grup: "Topping", urut: 20, satuan_so: "kg", isi: 1 },
  { id: 7, lokasi: "KSM", item_id: "gyz", label: "Gyoza", grup: "Ala Carte", urut: 30, satuan_so: "porsi", isi: null },
  { id: 8, lokasi: "KSM", item_id: "wjn", label: "Biji Wijen", grup: "Bahan", urut: 5, satuan_so: "gr", isi: 1 },
];

test("satuan: alias & konversi pasti", () => {
  assert.equal(normUnit("Gram"), "gr");
  assert.equal(normUnit("Liter"), "l");
  assert.equal(normUnit("pax"), "pack");
  assert.equal(convertUnit(1.5, "kg", "gr"), 1500);
  assert.equal(convertUnit(3.1, "Liter", "ml"), 3100);
  assert.equal(convertUnit(2, "pcs", "gr"), null);
  assert.equal(convertUnit(4, "ekor", "ekor"), 4);
});

test("baris SO: template urut per outlet + bahan lain di belakang", () => {
  const rows = buildSoRows(tItems, tTpl, "KBU");
  assert.deepEqual(rows.map((r) => r.label), ["Beras", "Minyak Goreng", "Otak-otak", "S. Caramel", "Bebek Ungkep"]);
  assert.equal(rows[4].template, false);
  const beras = rows[0];
  assert.deepEqual(soToItemQty(beras, 1.5), { qty: 37.5, satuan: "kg", converted: true });
  assert.equal(itemToSoQty(beras, 37.5, "kg"), 1.5);
  const caramel = rows[3];
  assert.deepEqual(soToItemQty(caramel, 969), { qty: 969, satuan: "ml", converted: false });
  const { lines, errors } = buildSoLinesFromRows(rows, { [beras.key]: "1,5", [caramel.key]: "969", [rows[2].key]: "" });
  assert.deepEqual(errors, []);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { item_id: "brs", arah: "hitung", qty: 37.5, satuan: "kg", qty_input: 1.5, satuan_input: "karung", label: "Beras", converted: true });
  assert.equal(lines[1].satuan, "ml");
});

test("angka & nilai gaya WA", () => {
  assert.equal(parseWaNumber("1,5"), 1.5);
  assert.equal(parseWaNumber("6.5"), 6.5);
  assert.equal(parseWaNumber("1.000"), 1000);
  assert.deepEqual(parseWaValue("est .....1,5 karung"), [{ qty: 1.5, unit: "karung" }]);
  assert.deepEqual(parseWaValue("2.4 Kg + 2.4 Kg (blm)"), [{ qty: 2.4, unit: "kg" }, { qty: 2.4, unit: "kg" }]);
  assert.deepEqual(parseWaValue("-"), [{ qty: 0, unit: null }]);
  assert.deepEqual(parseWaValue("1btl 255 ml"), [{ qty: 1, unit: "btl" }, { qty: 255, unit: "ml" }]);
  assert.equal(parseWaValue("Pa Aji"), null);
  assert.equal(parseWaDate("*26-09-2026*"), "2026-09-26");
  assert.equal(parseWaDate("Sabtu,26 september 2026"), "2026-09-26");
  assert.equal(parseWaDate("Mie 6.5 Kg"), null);
});

const WA_KBU = `dapur KBU
item Wajib Stock Opname Harian Dapur
PIC : Staf A & Staf B
Sabtu,26 september 2026

Beras  : est .....1,5 karung
Minyak Goreng :  2L/Pouch
Otak” : 3pcs
Bebek : 14pcs

*Limit / habis
- ayam besar 0
- PP 0

bar kBU
Berikut stok barang keseluruhan per 26 September 2026:
S. Caramel: 969 ml
Pisang Goreng: 3 pcs`;

test("tempel WA KBU: cocokkan label staf, konversi, tandai yang tidak dikenal", () => {
  const rows = buildSoRows(tItems, tTpl, "KBU");
  const p = parseWaStock(WA_KBU, { year: 2026 });
  assert.equal(p.tanggal, "2026-09-26");
  assert.deepEqual(p.notes.slice(0, 2), ["ayam besar 0", "PP 0"]);
  const r = applyWaToRows(p, rows);
  const byLabel = Object.fromEntries(r.matched.map((m) => [m.row.label, r.counts[m.row.key]]));
  assert.deepEqual(byLabel, { Beras: "1,5", "Otak-otak": "3", "Bebek Ungkep": "14", "S. Caramel": "969" });
  assert.deepEqual(r.unmatched.map((u) => u.label), ["Pisang Goreng"]);
  // "2L/Pouch" tidak bisa jadi pouch tanpa isi → minta dicek manual
  assert.deepEqual(r.unconvertible.map((u) => u.row.label), ["Minyak Goreng"]);
});

const WA_KSM = `*26-09-2026*
*BAHAN*
*Biji Wijen* : -
*TOPPING*
*Pakcoy* : 1.5 Kg
*Jamur kuping* : 2.4 Kg + 2.4 Kg (blm)
*ALA CARTE/CEMILAN*
Gyoza : 12 Porsi  + 2 pcs

*WASTE*
Pakcoy : 200 gram
Jamur kuping : 0,5 kg

*Menipis*
Ebi Furai
Pudding all rasa`;

test("tempel WA KSM: kosong '-', penjumlahan, waste ke form waste, menipis jadi catatan", () => {
  const rows = buildSoRows(tItems, tTpl, "KSM");
  const p = parseWaStock(WA_KSM);
  const r = applyWaToRows(p, rows);
  const val = (label) => r.counts[rows.find((x) => x.label === label).key];
  assert.equal(val("Biji Wijen"), "0");
  assert.equal(val("Pakcoy"), "1,5");
  assert.equal(val("Jamur kuping"), "4,8");
  assert.deepEqual(r.unconvertible.map((u) => u.label), ["Gyoza"]);
  assert.deepEqual(p.notes, ["Ebi Furai", "Pudding all rasa"]);
  const w = wasteFromWa(p, rows);
  assert.deepEqual(w.rows.map((x) => [x.item.kode, x.qty]), [["PKCY", 200], ["JMRKUPING", 0.5]]);
  const { lines } = buildSoLinesFromRows(rows, r.counts);
  assert.equal(lines.find((l) => l.item_id === "pak").qty, 1500);
});

test("format WA SO pakai grup & satuan staf", () => {
  const t = formatSoWa({
    lokasi: "KSM", tanggal: "2026-09-26", shift: "Tutup", total: 1000, foto: 2, belumKonversi: 1,
    tambahan: [{ nama: "Menu baru X", qty: "3", satuan: "porsi" }],
    lines: [
      { grup: "Topping", nama: "Pakcoy", satuan: "kg", qty: 1.5, statusQty: 1500, statusSatuan: "gr", minStok: 2000 },
      { grup: "Ala Carte", nama: "Gyoza", satuan: "porsi", qty: 12 },
    ],
  });
  assert.match(t, /\*TOPPING\*\n• Pakcoy: 1,5 kg/);
  assert.match(t, /\*ALA CARTE\*/);
  assert.match(t, /🟠 Pakcoy: \*500 gr\* \(sisa 1\.500 · min 2\.000\)/);
  assert.match(t, /2 foto terlampir/);
  assert.match(t, /1 bahan belum ada konversi/);
  assert.match(t, /TAMBAHAN \(belum di daftar\)\*\n• Menu baru X: 3 porsi/);
});

import { fixWaTerms, termsToUnit } from "./inventoryLogic.js";

test("sirup: botol + sisa ml setelah ukuran botol diisi purchasing", () => {
  const row = { satuan_so: "ml", isi: 1 / 750, item: { satuan: "btl" } };
  assert.equal(termsToUnit(parseWaValue("1btl 255 ml"), "ml", row), 1005);
  // "1btl 205 btl" = 1 botol + 205 ml
  assert.equal(termsToUnit(fixWaTerms(parseWaValue("1btl 205 btl"), "ml"), "ml", row), 955);
  // angka kecil tetap botol
  assert.deepEqual(fixWaTerms([{ qty: 1, unit: "btl" }, { qty: 2, unit: "btl" }], "ml"), [{ qty: 1, unit: "btl" }, { qty: 2, unit: "btl" }]);
  assert.equal(termsToUnit([{ qty: 1, unit: "btl" }], "ml", { ...row, isi: null }), null);
});

import { buildTransferLines, transferLineNilai, formatTransferWa } from "./inventoryLogic.js";

test("permintaan stok: baris dari daftar outlet, nilai, dan teks WA per tahap", () => {
  const rows = buildSoRows(tItems, tTpl, "KBU");
  const beras = rows.find((r) => r.label === "Beras");
  const caramel = rows.find((r) => r.label === "S. Caramel");
  const { lines, errors } = buildTransferLines(rows, { [beras.key]: "2", [caramel.key]: "750", [rows[2].key]: "0" });
  assert.deepEqual(errors, []);
  assert.deepEqual(lines, [
    { item_id: "brs", label: "Beras", satuan: "karung", isi: 25, qty: 2 },
    { item_id: "crm", label: "S. Caramel", satuan: "ml", isi: null, qty: 750 },
  ]);
  assert.equal(transferLineNilai(1.5, 25, 14000), 525000);
  assert.equal(transferLineNilai(750, null, 90000), 0);

  const wl = [
    { nama: "Beras", satuan: "karung", qty_minta: 2, qty_kirim: 1.5, qty_terima: 1.5 },
    { nama: "Bebek", satuan: "pcs", qty_minta: null, qty_kirim: 5, qty_terima: 4 },
  ];
  const m = formatTransferWa({ tahap: "minta", ke: "KBU", tanggal: "2026-09-28", lines: wl });
  assert.match(m, /PERMINTAAN STOK/);
  assert.match(m, /Gudang → Buri Umah/);
  assert.doesNotMatch(m, /Nilai/);
  const k = formatTransferWa({ tahap: "kirim", ke: "KBU", tanggal: "2026-09-28", lines: wl, total: 600000 });
  assert.match(k, /• Beras: 1,5 karung \(diminta 2\)/);
  assert.match(k, /Tidak sesuai permintaan:\*\n🔻 Beras -0,5 karung/);
  const t = formatTransferWa({ tahap: "terima", ke: "KBU", tanggal: "2026-09-28", lines: wl, total: 585000, catatan: "bebek kurang 1" });
  assert.match(t, /• Bebek: 4 pcs \(dikirim 5\)/);
  assert.match(t, /Selisih terima vs kirim:\*\n🔻 Bebek -1 pcs/);
  assert.match(t, /Rp585\.000/);
});

import { rowsForArea, defaultArea, summarizeValueSeries, allowedLokasi as allowedLok } from "./inventoryLogic.js";

test("akun dapur/kasir: outlet terkunci & area daftar SO", () => {
  assert.deepEqual(allowedLok({ role: "dapur", outlet: "KSM" }), ["KSM"]);
  assert.equal(defaultArea({ role: "dapur" }), "dapur");
  assert.equal(defaultArea({ role: "kasir" }), "bar");
  assert.equal(defaultArea({ role: "owner" }), null);
  const rows = [
    { key: 1, template: true, area: "dapur", label: "Mie" },
    { key: 2, template: true, area: "bar", label: "Milo" },
    { key: 3, template: true, area: null, label: "Dimsum" },
    { key: 4, template: false, area: null, label: "Lain" },
  ];
  assert.deepEqual(rowsForArea(rows, "dapur").map((r) => r.key), [1, 3, 4]);
  assert.deepEqual(rowsForArea(rows, "bar").map((r) => r.key), [2, 3, 4]);
  assert.equal(rowsForArea(rows, null).length, 4);
});

test("tren nilai stok: total, naik/turun 1 & 7 hari, hari kosong bukan nol", () => {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const d = `2026-09-${String(20 + i).padStart(2, "0")}`;
    rows.push({ tanggal: d, lokasi: "KBU", nilai: 1000000 + i * 100000 });
    if (i >= 6) rows.push({ tanggal: d, lokasi: "KSM", nilai: 500000 });
  }
  const s = summarizeValueSeries(rows);
  assert.equal(s.dates.length, 8);
  assert.equal(s.last, 2200000);
  assert.equal(s.d1, 100000);
  assert.equal(s.d7, 1200000);
  assert.equal(s.perLokasi.KBU.d7, 700000);
  assert.equal(s.perLokasi.KSM.d7, null);
  assert.equal(s.byLokasi.KSM[0], null);
  assert.equal(s.perLokasi.SMT.last, null);
});

import { summarizeDapurToday, fmtJam } from "./inventoryLogic.js";

test("status hari ini: SO saya, kiriman masuk, permintaan menunggu per lokasi", () => {
  const today = "2026-09-28";
  const events = [
    { tanggal: today, jenis: "so", lokasi: "KBU", created_by: "kasir", created_at: "2026-09-28T14:00:00Z" },
    { tanggal: today, jenis: "so", lokasi: "KBU", created_by: "dapur", created_at: "2026-09-28T15:00:00Z" },
    { tanggal: today, jenis: "waste", lokasi: "KBU", created_by: "dapur", total_nilai: 12000 },
    { tanggal: "2026-09-27", jenis: "so", lokasi: "KSM", created_by: "x" },
    { tanggal: today, jenis: "produksi", lokasi: "GDG", created_by: "p" },
  ];
  const transfers = [
    { status: "dikirim", dari: "GDG", ke: "KBU" },
    { status: "diminta", dari: "GDG", ke: "KSM" },
    { status: "diminta", dari: "GDG", ke: "KBU" },
    { status: "diterima", dari: "GDG", ke: "KBU" },
  ];
  const kbu = summarizeDapurToday({ events, transfers, lokasi: "KBU", userId: "kasir", today });
  assert.equal(kbu.soMine, true);
  assert.equal(kbu.soCount, 2);
  assert.equal(kbu.wasteNilai, 12000);
  assert.equal(kbu.kirimanMasuk, 1);
  assert.equal(kbu.permintaanMenunggu, 1);
  const ksm = summarizeDapurToday({ events, transfers, lokasi: "KSM", userId: "kasir2", today });
  assert.equal(ksm.soMine, false);
  assert.equal(ksm.soCount, 0);
  const gdg = summarizeDapurToday({ events, transfers, lokasi: "GDG", userId: "p", today });
  assert.equal(gdg.permintaanMenunggu, 2);
  assert.equal(gdg.produksiCount, 1);
  const owner = summarizeDapurToday({ events, transfers, today });
  assert.deepEqual(Object.keys(owner.soByLokasi), ["KBU"]);
  assert.equal(fmtJam("2026-09-28T14:05:00Z"), "21.05");
});

import { auditMovements, priorityFor } from "./inventoryLogic.js";

test("audit harian: statis, naik tanpa masuk, turun tidak normal, waste tinggi — SO tidak diubah", () => {
  const items = {
    bs: { nama: "Butterscotch", satuan: "ml", harga: 98 },
    at: { nama: "Bumbu Atomic", satuan: "kg", harga: 40000 },
    cc: { nama: "Cheese Cream", satuan: "gr", harga: 115 },
    ay: { nama: "Ayam Baput", satuan: "pcs", harga: 5000 },
  };
  const t = (d, h = "15") => `2026-09-${d}T${h}:00:00Z`;
  const mv = [
    // Butterscotch 552 ml tiga hari berturut-turut
    ...["26", "27", "28"].map((d) => ({ tanggal: `2026-09-${d}`, lokasi: "KBU", item_id: "bs", tipe: "so", qty: 552, created_at: t(d) })),
    // Atomic 5,9 → 6,4 kg tanpa barang masuk
    { tanggal: "2026-09-26", lokasi: "KSM", item_id: "at", tipe: "so", qty: 5.9, created_at: t("26") },
    { tanggal: "2026-09-27", lokasi: "KSM", item_id: "at", tipe: "so", qty: 6.4, created_at: t("27") },
    // Cheese cream biasanya turun 20 gr, lalu turun 280 gr
    ...[["22", 450], ["23", 430], ["24", 410], ["25", 390], ["26", 370], ["27", 90]].map(([d, q]) => ({ tanggal: `2026-09-${d}`, lokasi: "KSM", item_id: "cc", tipe: "so", qty: q, created_at: t(d) })),
    // Ayam: masuk 20 diterima, waste 12 pcs
    { tanggal: "2026-09-26", lokasi: "KBU", item_id: "ay", tipe: "so", qty: 10, created_at: t("26") },
    { tanggal: "2026-09-27", lokasi: "KBU", item_id: "ay", tipe: "trf_in", qty: 20, created_at: t("27", "08") },
    { tanggal: "2026-09-27", lokasi: "KBU", item_id: "ay", tipe: "waste", qty: 12, created_at: t("27", "10") },
    { tanggal: "2026-09-27", lokasi: "KBU", item_id: "ay", tipe: "so", qty: 15, created_at: t("27") },
  ];
  const { findings, ledger } = auditMovements(mv, items, { from: "2026-09-22" });
  const by = (type, id) => findings.find((f) => f.type === type && f.item_id === id);
  assert.ok(by("statis", "bs"), "butterscotch statis");
  const naik = by("naik", "at");
  assert.ok(naik);
  assert.equal(naik.qty, 0.5);
  assert.equal(naik.confidence, "MEDIUM");
  const turun = by("turun", "cc");
  assert.ok(turun);
  assert.equal(turun.status, "Menunggu data penjualan");
  assert.equal(turun.confidence, "LOW");
  assert.ok(by("waste", "ay"));
  assert.equal(by("naik", "ay"), undefined, "ayam: 10 + 20 − 12 = 18, SO 15 → turun wajar, bukan naik");
  const ay = ledger.find((l) => l.item_id === "ay");
  assert.deepEqual([ay.expected, ay.cur, ay.variance], [18, 15, -3]);
  assert.equal(priorityFor(10000), "INFO");
  assert.equal(priorityFor(150000), "WARNING");
  assert.equal(priorityFor(600000), "CRITICAL");
  assert.equal(priorityFor(30000, 3), "WARNING");
});

import { soAreaStatus } from "./inventoryLogic.js";
test("status SO per area: KBU Kitchen/Bar terpisah, Samtaro satu", () => {
  const st = soAreaStatus({ "KBU:bar": { id: 1 }, "SMT:": { id: 2 } });
  const get = (l) => st.find((x) => x.label === l).event;
  assert.ok(get("KBU Bar"));
  assert.equal(get("KBU Kitchen"), null);
  assert.ok(get("Samtaro"));
  assert.equal(get("Gudang"), null);
});

import { unitOptions, toItemQty } from "./inventoryLogic.js";
test("waste/masuk: satuan staf dikonversi ke satuan master, modal dihitung otomatis", () => {
  const susu = { satuan_so: "pcs", isi: 1, item: { satuan: "l", harga: 16000 } };
  assert.deepEqual(unitOptions(susu), ["pcs", "l", "ml"]);
  assert.deepEqual(toItemQty(susu, 500, "ml"), { qty: 0.5, satuan: "l", converted: true });
  assert.deepEqual(toItemQty(susu, 2, "pcs"), { qty: 2, satuan: "l", converted: true });
  const beras = { satuan_so: "karung", isi: 25, item: { satuan: "kg" } };
  assert.deepEqual(toItemQty(beras, 500, "gr"), { qty: 0.5, satuan: "kg", converted: true });
  assert.deepEqual(toItemQty(beras, 1, "karung"), { qty: 25, satuan: "kg", converted: true });
  const sirup = { satuan_so: "ml", isi: null, item: { satuan: "btl" } };
  assert.deepEqual(toItemQty(sirup, 100, "ml"), { qty: 100, satuan: "ml", converted: false });
});

import { parseSalesRows, parseSheetDate, outletFromText, suggestMenu, menuCost, salesUsageReport, auditMovements as audit2 } from "./inventoryLogic.js";
test("upload penjualan: laporan ESB dibaca per outlet dari kategori, periode dari header", () => {
  const rows = [
    ["Sales Menu Recapitulation Report"],
    ["Period", "01-09-2026 - 07-09-2026"],
    [],
    ["Sales Type", "Menu Category", "Menu Category Detail", "Menu", "Menu Short Name", "Order Mode", "Qty", "Net Sales Total"],
    ["Sales", "FOOD KISAMEN", "Ramen", "Ramen Atomic", "", "POS Lite", 10, 350000],
    ["Sales", "FOOD KISAMEN", "Ramen", "Ramen Atomic", "", "EZO QS", 2, 70000],
    ["Sales", "DRINK KOPI BURI UMAH", "Kopi", "Es Kopi Susu", "", "POS Lite", "5", "90.000"],
    ["Sales", "SAM DIMSUM", "Dimsum", "Dimsum Ayam", "", "POS Lite", 3, 45000],
    ["Sales", "MERCHANDISE", "", "Totebag", "", "POS Lite", 1, 50000],
    ["Refund", "FOOD KISAMEN", "Ramen", "Ramen Atomic", "", "POS Lite", 1, 35000],
  ];
  const r = parseSalesRows(rows);
  assert.equal(r.dari, "2026-09-01");
  assert.equal(r.sampai, "2026-09-07");
  assert.equal(r.perHari, false);
  const atomic = r.lines.find((l) => l.nama_pos === "Ramen Atomic");
  assert.deepEqual([atomic.lokasi, atomic.qty, atomic.omset, atomic.tanggal], ["KSM", 12, 420000, null]);
  assert.equal(r.lines.find((l) => l.nama_pos === "Es Kopi Susu").omset, 90000);
  assert.equal(r.lines.find((l) => l.nama_pos === "Dimsum Ayam").lokasi, "SMT");
  assert.deepEqual(r.tanpaOutlet, [{ kategori: "MERCHANDISE", qty: 1 }]);
  const r2 = parseSalesRows(rows, { kategoriOutlet: { MERCHANDISE: "-" } });
  assert.deepEqual(r2.tanpaOutlet, []);
  assert.equal(outletFromText("DRINK KISAMEN"), "KSM");
  assert.equal(parseSheetDate(46266), "2026-09-01");
  assert.equal(parseSheetDate("7 Sep 2026"), "2026-09-07");
});

test("upload penjualan: CSV harian satu outlet", () => {
  const rows = [["Tanggal", "Nama Menu", "Jumlah"], ["2026-09-01", "Es Teh", 3], ["2026-09-02", "Es Teh", 4]];
  const r = parseSalesRows(rows, { outlet: "KBU" });
  assert.equal(r.perHari, true);
  assert.deepEqual(r.lines.map((l) => [l.tanggal, l.qty]), [["2026-09-01", 3], ["2026-09-02", 4]]);
  assert.equal(r.dari, "2026-09-01");
});

test("resep menu: saran nama POS & HPP per porsi", () => {
  const menus = [{ id: "m1", lokasi: "KSM", nama: "Ramen Atomic" }, { id: "m2", lokasi: "KSM", nama: "Corn Milk Coffe Latte" }];
  assert.equal(suggestMenu("Corn Milk Coffee Latte", menus, "KSM").menu.id, "m2");
  assert.equal(suggestMenu("Ramen Atomic", menus, "KBU"), null);
  const c = menuCost({ harga_jual: 35000, lines: [{ item_id: "mie", qty: 0.15 }, { item_id: "x", qty: 1 }] }, { mie: { harga: 18000 }, x: { harga: 0 } });
  assert.deepEqual(c, { hpp: 2700, missing: 1, foodCost: 7.71 });
});

test("penjualan vs pemakaian: aktual dari SO dibanding teori dari resep × terjual", () => {
  const itemsById = { mie: { id: "mie", nama: "Mie Ramen", satuan: "kg", harga: 18000 } };
  const mv = [
    { tanggal: "2026-08-31", lokasi: "KSM", item_id: "mie", tipe: "so", qty: 10, created_at: "2026-08-31T15:00:00Z" },
    { tanggal: "2026-09-03", lokasi: "KSM", item_id: "mie", tipe: "trf_in", qty: 5, created_at: "2026-09-03T03:00:00Z" },
    { tanggal: "2026-09-07", lokasi: "KSM", item_id: "mie", tipe: "jual_periode", qty: 9, created_at: "2026-09-07T05:00:00Z" },
    { tanggal: "2026-09-07", lokasi: "KSM", item_id: "mie", tipe: "so", qty: 4, created_at: "2026-09-07T15:00:00Z" },
  ];
  const [r] = salesUsageReport(mv, itemsById, { from: "2026-09-01", to: "2026-09-07" });
  // aktual = 10 + 5 − 4 = 11, teori 9 → lebih 2 kg = Rp36.000
  assert.deepEqual([r.aktual, r.teori, r.selisih, r.rp, r.confidence], [11, 9, 2, 36000, "HIGH"]);
  assert.equal(r.priority, "WATCH");
});

test("audit harian dengan penjualan harian: selisih lebih dari terjual jadi temuan 'kurang'", () => {
  const itemsById = { ay: { id: "ay", nama: "Ayam Reguler", satuan: "pcs", harga: 5000 } };
  const mv = [
    { tanggal: "2026-09-01", lokasi: "KBU", item_id: "ay", tipe: "so", qty: 40, created_at: "2026-09-01T15:00:00Z" },
    { tanggal: "2026-09-02", lokasi: "KBU", item_id: "ay", tipe: "jual", qty: 20, created_at: "2026-09-02T05:00:00Z" },
    { tanggal: "2026-09-02", lokasi: "KBU", item_id: "ay", tipe: "so", qty: 12, created_at: "2026-09-02T15:00:00Z" },
  ];
  const { findings, ledger } = audit2(mv, itemsById, { salesDays: new Set(["KBU|2026-09-02"]) });
  assert.equal(ledger[0].expected, 20);
  const k = findings.find((f) => f.type === "kurang");
  assert.ok(k);
  assert.equal(k.qty, 8);
  assert.equal(k.rp, 40000);
  const tanpa = audit2(mv, itemsById, {}).findings.find((f) => f.type === "kurang");
  assert.equal(tanpa, undefined, "tanpa rekap harian → tidak dituduh kurang");
});

import { weekRange, findingKey, weeklyAuditSummary, fallbackAuditNarrative, formatAuditWa, salesDaysFrom } from "./inventoryLogic.js";
test("audit mingguan: minggu Senin–Minggu, temuan yang sudah dicek dipisah, narasi & WA", () => {
  assert.deepEqual(weekRange("2026-09-30"), { from: "2026-09-28", to: "2026-10-04" });
  assert.deepEqual(weekRange("2026-09-28", -1), { from: "2026-09-21", to: "2026-09-27" });
  assert.deepEqual(weekRange("2026-10-04"), { from: "2026-09-28", to: "2026-10-04" });
  const itemsById = { at: { id: "at", nama: "Bumbu Atomic", satuan: "kg", harga: 40000 }, ay: { id: "ay", nama: "Ayam", satuan: "pcs", harga: 5000 } };
  const mv = [
    { tanggal: "2026-09-21", lokasi: "KSM", item_id: "at", tipe: "so", qty: 5.9, created_at: "2026-09-21T15:00:00Z" },
    { tanggal: "2026-09-22", lokasi: "KSM", item_id: "at", tipe: "so", qty: 6.9, created_at: "2026-09-22T15:00:00Z" },
    { tanggal: "2026-09-22", lokasi: "KBU", item_id: "ay", tipe: "waste", qty: 12, created_at: "2026-09-22T10:00:00Z" },
  ];
  const s = weeklyAuditSummary(mv, itemsById, { from: "2026-09-21", to: "2026-09-27" });
  const naik = s.findings.find((f) => f.type === "naik");
  assert.ok(naik);
  assert.equal(naik.nama, "Bumbu Atomic");
  assert.equal(s.lokasi.KBU.wasteRp, 60000);
  assert.equal(s.totals.wasteRp, 60000);
  assert.equal(s.lokasi.KSM.so, 2);
  const key = findingKey(naik);
  const s2 = weeklyAuditSummary(mv, itemsById, { from: "2026-09-21", to: "2026-09-27", notes: { [key]: { status: "wajar", catatan: "barang masuk lupa dicatat" } } });
  assert.equal(s2.findings.find((f) => f.type === "naik"), undefined);
  assert.equal(s2.totals.sudahDicek, 1);
  const n = fallbackAuditNarrative(s);
  assert.match(n.ringkasan, /2026-09-21/);
  assert.ok(n.tindakan.some((t) => /penjualan/i.test(t)));
  const wa = formatAuditWa(s, n);
  assert.match(wa, /AUDIT STOK MINGGUAN/);
  assert.match(wa, /Kisamen/);
  assert.doesNotMatch(wa, /curi|curang/i);
  const days = salesDaysFrom([{ per_hari: true, dari: "2026-09-01", sampai: "2026-09-03", lokasi: ["KBU"] }, { per_hari: false, dari: "2026-09-01", sampai: "2026-09-07", lokasi: ["KSM"] }]);
  assert.deepEqual([...days], ["KBU|2026-09-01", "KBU|2026-09-02", "KBU|2026-09-03"]);
});

test("normalisasiIsi: l→ml, kg→gr, tidak valid → null", () => {
  assert.deepEqual(normalisasiIsi(1, "l"), { isi: 1000, satuan: "ml" });
  assert.deepEqual(normalisasiIsi(0.5, "kg"), { isi: 500, satuan: "gr" });
  assert.deepEqual(normalisasiIsi(760, "ml"), { isi: 760, satuan: "ml" });
  assert.deepEqual(normalisasiIsi(null, "ml"), { isi: null, satuan: null });
  assert.deepEqual(normalisasiIsi(500, null), { isi: null, satuan: null });
});

test("isiDariKemasan: sirup hitung ml, master btl → 1/ukuran; jerigen master gr → ukuran", () => {
  assert.equal(isiDariKemasan(760, "ml", "ml", "btl"), 0.001316);
  assert.equal(isiDariKemasan(5000, "gr", "drigen", "gr"), 5000);
  assert.equal(isiDariKemasan(760, "ml", "gr", "btl"), null);
  assert.equal(isiDariKemasan(760, "ml", "ml", "ml"), null);
  assert.equal(isiDariKemasan(0, "ml", "ml", "btl"), null);
});

test("countsFromSoLines: isi ulang form SO dari SO tersimpan", () => {
  const keju = { id: "k", satuan: "kg" };
  const mie = { id: "m", satuan: "pcs" };
  const rows = [
    { key: "t:1", item: keju, label: "Cheese Cream", satuan_so: "gr", isi: null },
    { key: "t:2", item: mie, label: "Mie", satuan_so: "pcs", isi: 1 },
  ];
  const { counts, missing } = countsFromSoLines(rows, [
    { item_id: "k", qty: 1.27, satuan: "kg", qty_input: 1270, satuan_input: "gr", label: "Cheese Cream" },
    { item_id: "m", qty: 4, satuan: "pcs", qty_input: 4, satuan_input: "pcs", label: "Mie" },
    { item_id: "x", qty: 1, satuan: "pcs", label: "Lama" },
  ]);
  assert.deepEqual(counts, { "t:1": "1270", "t:2": "4" });
  assert.deepEqual(missing, ["Lama"]);
});

test("stokMenipis: semua lokasi, habis dulu, abaikan nonaktif & satuan beda", () => {
  const its = [
    { id: "a", nama: "Ayam", satuan: "pcs", min_stok: 10 },
    { id: "b", nama: "Beef", satuan: "gr", min_stok: 2000 },
    { id: "c", nama: "Cabe", satuan: "gr", min_stok: 100, aktif: false },
    { id: "d", nama: "Daun", satuan: "gr", min_stok: 100 },
  ];
  const snap = [
    { lokasi: "KSM", item_id: "b", qty: 635, satuan: "gr" },
    { lokasi: "KBU", item_id: "a", qty: 0, satuan: "pcs" },
    { lokasi: "GDG", item_id: "c", qty: 0, satuan: "gr" },
    { lokasi: "KSM", item_id: "d", qty: 1, satuan: "kg" },
    { lokasi: "KSM", item_id: "a", qty: 50, satuan: "pcs" },
  ];
  const all = stokMenipis(snap, its);
  assert.deepEqual(all.map((r) => `${r.lokasi}:${r.item.nama}:${r.status}`), ["KBU:Ayam:habis", "KSM:Beef:menipis"]);
  assert.deepEqual(stokMenipis(snap, its, ["KSM"]).map((r) => r.item.nama), ["Beef"]);
});

test("usulanPermintaan: minimum − sisa dibulatkan, habis tanpa minimum tetap muncul", () => {
  const u = usulanPermintaan([
    { key: "a", nama: "S. Caramel", statusQty: 0.8, satuanMaster: "btl", minStok: 2 },
    { key: "b", nama: "Mineral", statusQty: 98, satuanMaster: "pcs", minStok: 120 },
    { key: "c", nama: "Leci", statusQty: 0, satuanMaster: "klg", minStok: null },
    { key: "d", nama: "Aman", statusQty: 5, satuanMaster: "pcs", minStok: 2 },
    { key: "e", nama: "Belum konversi", statusQty: null, minStok: 2 },
  ]);
  assert.deepEqual(u.map((x) => [x.nama, x.minta, x.satuan]), [["Leci", null, "klg"], ["S. Caramel", 2, "btl"], ["Mineral", 22, "pcs"]]);
});

test("formatSoWa: satu judul per grup walau urutan berselang", () => {
  const t = formatSoWa({ lokasi: "KBU", tanggal: "2026-09-29", shift: "Tutup", total: 0, lines: [
    { grup: "Bar", nama: "A", satuan: "pcs", qty: 1 }, { grup: "Lainnya", nama: "B", satuan: "pcs", qty: 1 }, { grup: "Bar", nama: "C", satuan: "pcs", qty: 1 },
  ] });
  assert.equal((t.match(/\*BAR\*/g) || []).length, 1);
  assert.ok(t.indexOf("• C") < t.indexOf("*LAINNYA*"));
});

test("soTidakWajar: tangkap gram ditulis di kolom kg", () => {
  const r = soTidakWajar([
    { nama: "Bumbu Paitan", qty: 740, satuan: "kg", nilai: 28597300, prevQty: 1.2 },
    { nama: "Beef", qty: 635, satuan: "gr", nilai: 71120, prevQty: 800 },
    { nama: "Mie", qty: 250, satuan: "kg", nilai: 4500000, prevQty: 10 },
    { nama: "Sirup", qty: 30, satuan: "btl", nilai: 690000, prevQty: 1 },
  ]);
  assert.deepEqual(r.map((x) => x.nama), ["Bumbu Paitan", "Mie", "Sirup"]);
});

test("parseWaNumber sejalan parseQty untuk 0.500", async () => {
  const { parseWaNumber } = await import("./inventoryLogic.js");
  assert.equal(parseWaNumber("0.500"), 0.5);
  assert.equal(parseWaNumber("1.500"), 1500);
});

test("cocokkanBelanja: padanan, nama sama, konversi, abaikan, saran", () => {
  const items = [
    { id: "fm", kode: "SUSFRES", nama: "Susu freshmilk", satuan: "l" },
    { id: "sk", kode: "SKM", nama: "SKM Pillow", satuan: "kg" },
    { id: "hd", kode: "KOPIHADE", nama: "Kopi Biji Hade Asam Manis", satuan: "gr" },
    { id: "lc", kode: "SRPLCMJN", nama: "Sirup leci marjan", satuan: "btl" },
  ];
  const maps = [
    { ...belanjaKey("Freshmilk Omela", "Dus"), item_id: "fm", isi: 12 },
    { ...belanjaKey("Beans Americano", "kg"), item_id: "hd", isi: 1000 },
    { ...belanjaKey("Ongkir powder", ""), abaikan: true },
  ];
  const fm = cocokkanBelanja({ name: "freshmilk  omela", qty: 2, unit: "dus", unitPrice: 216000 }, maps, items);
  assert.equal(fm.status, "cocok"); assert.equal(fm.qtyMaster, 24); assert.equal(fm.hargaMaster, 18000);
  const hd = cocokkanBelanja({ name: "Beans Americano", qty: 1, unit: "kg", unitPrice: 350000 }, maps, items);
  assert.equal(hd.item.id, "hd"); assert.equal(hd.qtyMaster, 1000); assert.equal(hd.hargaMaster, 350);
  const skm = cocokkanBelanja({ name: "SKM Pillow", qty: 2500, unit: "gr", unitPrice: 24 }, maps, items);
  assert.equal(skm.status, "cocok"); assert.equal(skm.qtyMaster, 2.5); assert.equal(skm.hargaMaster, 24000);
  const skmPcs = cocokkanBelanja({ name: "SKM Pillow", qty: 1, unit: "pcs", unitPrice: 60000 }, maps, items);
  assert.equal(skmPcs.status, "perlu_isi");
  assert.equal(cocokkanBelanja({ name: "Ongkir Powder", qty: 1, unit: "pcs" }, maps, items).status, "abaikan");
  const leci = cocokkanBelanja({ name: "Sirup Marjan Leci", qty: 3, unit: "btl", unitPrice: 24000 }, maps, items);
  assert.equal(leci.status, "belum"); assert.equal(leci.saran.id, "lc");
  assert.equal(cocokkanBelanja({ name: "Sabun colek", qty: 1, unit: "pcs" }, maps, items).saran, null);
  assert.equal(lokasiBelanja("KSM"), "KSM"); assert.equal(lokasiBelanja("NF"), "GDG");
});
