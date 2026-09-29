// node --test lib/dapurAccess.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { dapurAccess, profileKey, visibleTabs, recipesForArea, CAP } from "./dapurAccess.js";

const tabs = (u) => visibleTabs(dapurAccess(u)).map((t) => t.label);

test("pemetaan role database → profil kerja; role tak dikenal tidak dapat akses", () => {
  assert.equal(profileKey({ role: "owner" }), "owner");
  assert.equal(profileKey({ role: "admin" }), "owner");
  assert.equal(profileKey({ role: "purchasing" }), "purchasing_gudang");
  assert.equal(profileKey({ role: "purchasing", outlet: "GDG" }), "gudang");
  assert.equal(profileKey({ role: "purchasing", outlet: "lombok" }), "purchasing");
  assert.equal(profileKey({ role: "dapur", outlet: "kbu" }), "outlet_dapur");
  assert.equal(profileKey({ role: "kasir", outlet: "KSM" }), "outlet_bar");
  assert.equal(profileKey({ role: "kasir" }), "none");
  assert.equal(profileKey({ role: "superuser" }), "none");
  assert.equal(profileKey(null), "none");
  assert.deepEqual(tabs({ role: "superuser" }), []);
});

test("menu per peran", () => {
  assert.deepEqual(tabs({ role: "purchasing", outlet: "lombok" }), ["Hari Ini", "Waste", "Barang Masuk", "Stok & Riwayat", "Resep Menu", "Kelola"]);
  assert.deepEqual(tabs({ role: "purchasing", outlet: "GDG" }), ["Hari Ini", "SO Gudang", "Waste Gudang", "Barang Masuk", "Produksi Gudang", "Kirim Stok", "Stok & Riwayat", "Resep Menu", "Kelola"]);
  assert.deepEqual(tabs({ role: "purchasing" }), ["Hari Ini", "SO Gudang", "Waste Gudang", "Barang Masuk", "Produksi Gudang", "Kirim Stok", "Stok & Riwayat", "Resep Menu", "Kelola"]);
  assert.deepEqual(tabs({ role: "dapur", outlet: "KBU" }), ["Hari Ini", "SO Dapur", "Waste Dapur", "Produksi", "Minta & Terima", "Stok & Riwayat"]);
  assert.deepEqual(tabs({ role: "kasir", outlet: "KBU" }), ["Hari Ini", "SO Bar", "Waste Bar", "Produksi", "Minta & Terima", "Stok & Riwayat"]);
  assert.deepEqual(tabs({ role: "owner" }), ["Hari Ini", "SO", "Waste", "Barang Masuk", "Produksi", "Kirim Stok", "Stok & Riwayat", "Audit", "Penjualan", "Resep Menu", "Kelola"]);
});

test("lokasi mengikuti penugasan", () => {
  const bar = dapurAccess({ role: "kasir", outlet: "KSM" });
  assert.deepEqual(bar.lokasiOptions("so"), ["KSM"]);
  assert.equal(bar.defaultLokasi, "KSM");
  assert.equal(bar.area, "bar");
  assert.equal(bar.can(CAP.KIRIM_KIRIM), false);
  assert.equal(bar.canTab("kelola"), false);
  const pg = dapurAccess({ role: "purchasing" });
  assert.deepEqual(pg.lokasiOptions("so"), ["GDG"]);
  assert.deepEqual(pg.lokasiOptions("masuk"), ["GDG", "KBU", "KSM", "SMT"]);
  const pur = dapurAccess({ role: "purchasing", outlet: "lombok" });
  assert.deepEqual(pur.masukSumber, ["pembelian", "retur"]);
  assert.deepEqual(pur.lokasiOptions("waste"), ["GDG", "KBU", "KSM", "SMT"]);
  const own = dapurAccess({ role: "owner" });
  assert.equal(own.areaPilih, true);
  assert.deepEqual(own.lokasiOptions("so"), ["GDG", "KBU", "KSM", "SMT"]);
});

test("resep produksi sesuai area daftar SO", () => {
  const recipes = [{ id: "r1", output_item_id: "sirup" }, { id: "r2", output_item_id: "bumbu" }, { id: "r3", output_item_id: "umum" }];
  const tpl = [
    { lokasi: "KSM", item_id: "sirup", area: "bar" },
    { lokasi: "KSM", item_id: "bumbu", area: "dapur" },
    { lokasi: "KSM", item_id: "umum", area: null },
  ];
  assert.deepEqual(recipesForArea(recipes, tpl, "KSM", "bar").map((r) => r.id), ["r1", "r3"]);
  assert.deepEqual(recipesForArea(recipes, tpl, "KSM", "dapur").map((r) => r.id), ["r2", "r3"]);
  assert.equal(recipesForArea(recipes, tpl, "GDG", null).length, 3);
});
