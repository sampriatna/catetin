// node --test lib/inventoryLogic.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  allowedLokasi, defaultLokasi, itemsForLokasi, searchItems, parseQty, buildSoLines,
  stockStatus, soDelta, scaleRecipe, productionCost, stockValueByLokasi,
  formatSoWa, formatWasteWa, formatProduksiWa, todayJakarta,
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
  assert.match(t, /Perlu diisi ulang/);
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
