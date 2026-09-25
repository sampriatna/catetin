import test from "node:test";
import assert from "node:assert/strict";
import { scanResultToItems, scanResultDate } from "./purchasingScan.js";

// Contoh nyata: laporan WA pengeluaran purchasing 23/09.
const waReport = {
  date: "2025-09-23",
  writtenTotal: 2564280,
  items: [
    { name: "Fresh milk omela", qty: 6, unit: "dus", subtotal: 1296000 },
    { name: "Ayam potong Pentung", qty: 10, unit: "kg", subtotal: 370000 },
    { name: "Tulang Ayam", qty: 5, unit: "kg", subtotal: 50000 },
    { name: "tahu", qty: 60, unit: "pcs", subtotal: 30000 },
    { name: "tempe", qty: 5, unit: "pcs", subtotal: 30000 },
    { name: "Alumunium tray uk 212/56 (Cokies)", qty: 1, unit: "pcs", subtotal: 12000 },
    { name: "alat kocokan telur", qty: 1, unit: "pcs", subtotal: 20000 },
    { name: "klir 25ml", qty: 5, unit: "pcs", subtotal: 50000 },
    { name: "kertas nasi bunga", qty: 1, unit: "ikt", subtotal: 100000 },
    { name: "kertas roti", qty: 10, unit: "lbr", subtotal: 12500 },
    { name: "Gula Pasir RoseBrand", qty: 20, unit: "kg", subtotal: 350000 },
    { name: "Plastik uk 11*15*05 (NF)", qty: 2, unit: "pcs", subtotal: 21000 },
    { name: "Ubi ungu", qty: 2, unit: "kg", subtotal: 18000 },
    { name: "Tom Yam", qty: 2, unit: "pcs", subtotal: 102780 },
    { name: "Bensin Disel", qty: 1, unit: "pcs", subtotal: 20000 },
    { name: "Mie Ramen", qty: 5, unit: "kg", subtotal: 82000 },
  ],
};

test("laporan WA: total item sama persis dengan total tertulis", () => {
  const r = scanResultToItems(waReport);
  assert.equal(r.items.length, 16);
  assert.equal(r.itemsTotal, 2564280);
  assert.equal(r.totalMismatch, false);
  assert.deepEqual(r.items[0], { name: "Fresh milk omela", qty: "6", unit: "dus", unitPrice: "216000" });
  assert.deepEqual(r.items[9], { name: "kertas roti", qty: "10", unit: "lbr", unitPrice: "1250" });
});

test("harga satuan tidak bulat jadi 1 paket, total baris tetap persis", () => {
  const r = scanResultToItems({ items: [{ name: "Telur", qty: 3, unit: "pcs", subtotal: 10000 }] });
  assert.deepEqual(r.items[0], { name: "Telur (3 pcs)", qty: "1", unit: "paket", unitPrice: "10000" });
  assert.equal(r.itemsTotal, 10000);
});

test("selisih dengan total tertulis ditandai, harga kosong dihitung", () => {
  const r = scanResultToItems({
    writtenTotal: "50.000",
    items: [{ name: "Cabai", qty: 1, unit: "kg", subtotal: 40000 }, { name: "Bawang", qty: 1 }],
  });
  assert.equal(r.writtenTotal, 50000);
  assert.equal(r.totalMismatch, true);
  assert.equal(r.missingPrice, 1);
});

test("tanggal hanya dipakai jika format YYYY-MM-DD", () => {
  assert.equal(scanResultDate({ date: "2026-09-23" }), "2026-09-23");
  assert.equal(scanResultDate({ date: "23/09" }), "");
  assert.equal(scanResultDate({}), "");
});
