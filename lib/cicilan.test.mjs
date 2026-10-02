import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  dueDateFor,
  analyzeTenorOptions,
  buildJadwal,
  createPlan,
  applyPayment,
  buildPurchaseTx,
  buildUpfrontInterestTx,
  cancelPlan,
  planSummary,
  cicilanOverview,
  mergeCicilanPlans,
  normalizeScreenshotParse,
} from "./cicilan.js";
import { computeWalletBalanceFromDoc } from "./sharedWalletMirror.js";
import { resolvePaylaterSource, buildCicilanView, guessBungaCategoryId } from "./cicilanSource.js";
import { buildFishingSharedLinks } from "./walletPresets.js";
import { CANONICAL_BUSINESS_ID } from "./canonicalBusiness.js";

// Angka dari layar SPayLater DJI Osmo Pocket 4P (harga Rp12.741.080).
const POKOK = 12741080;
const OPTIONS = [
  { tenor: 1, perBulan: 12741080 },
  { tenor: 3, perBulan: 4247027 },
  { tenor: 6, perBulan: 2436054 },
  { tenor: 12, perBulan: 1374183 },
  { tenor: 18, perBulan: 1019593 },
  { tenor: 24, perBulan: 843365 },
];

test("addMonths / dueDateFor menangani pergantian tahun & akhir bulan", () => {
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(dueDateFor("2027-02", 31), "2027-02-28");
  assert.equal(dueDateFor("2028-02", 30), "2028-02-29");
  assert.equal(dueDateFor("2026-11", 5), "2026-11-05");
});

test("analyzeTenorOptions: 1 & 3 bln = 0% (selisih Rp1 pembulatan), tenor panjang ±2,45%/bln", () => {
  const a = analyzeTenorOptions(POKOK, OPTIONS);
  const by = Object.fromEntries(a.rows.map((r) => [r.tenor, r]));
  assert.equal(by[1].tanpaBunga, true);
  assert.equal(by[3].tanpaBunga, true);
  assert.equal(by[3].bunga, 0);
  assert.equal(by[12].bunga, 3749116);
  assert.equal(by[24].bunga, 7499680);
  for (const t of [6, 12, 18, 24]) {
    assert.ok(Math.abs(by[t].flatPerBulanPct - 0.0245) < 0.0005, `tenor ${t}`);
  }
  assert.equal(a.rekomendasi, 3);
});

test("buildJadwal: Σ pokok = pokok, bunga tidak negatif, total = per bulan × tenor", () => {
  for (const o of OPTIONS) {
    const j = buildJadwal({ pokok: POKOK, tenor: o.tenor, perBulan: o.perBulan, startMonth: "2026-11", dueDay: 5 });
    assert.equal(j.length, o.tenor);
    assert.equal(j.reduce((a, r) => a + r.pokok, 0), POKOK);
    assert.ok(j.every((r) => r.bunga >= 0 && r.pokok > 0));
    assert.equal(j.reduce((a, r) => a + r.amount, 0), o.perBulan * o.tenor);
  }
  const j12 = buildJadwal({ pokok: POKOK, tenor: 12, perBulan: 1374183, startMonth: "2026-11", dueDay: 5 });
  assert.equal(j12[0].due, "2026-11-05");
  assert.equal(j12[11].due, "2027-10-05");
});

test("buildJadwal: kurang sedikit karena pembulatan → ditambah ke cicilan terakhir; kurang banyak → error", () => {
  const j = buildJadwal({ pokok: 1000, tenor: 3, perBulan: 333, startMonth: "2026-11", dueDay: 1 });
  assert.deepEqual(j.map((r) => r.amount), [333, 333, 334]);
  assert.throws(() => buildJadwal({ pokok: 1000, tenor: 3, perBulan: 300, startMonth: "2026-11", dueDay: 1 }), /lebih kecil/);
});

function docWith(plan, extraTxs = []) {
  return {
    wallets: [
      { id: "w_shopee_paylater", type: "paylater", liability: true, allowNegative: true, opening: 0, active: true },
      { id: "w_bca", type: "rekening", opening: 20000000, active: true },
    ],
    transactions: [buildPurchaseTx(plan), ...extraTxs],
  };
}

test("mode per_bayar: hutang PayLater kembali 0 saat lunas, bunga jadi pengeluaran rekening", () => {
  let plan = createPlan(
    { label: "DJI Osmo Pocket 4P", walletId: "w_shopee_paylater", pokok: POKOK, tenor: 12, perBulan: 1374183, startMonth: "2026-11", dueDay: 5, bungaCategoryId: "c_bunga" },
    { id: "cl_test", now: "2026-10-02T10:00:00.000Z" }
  );
  assert.equal(buildUpfrontInterestTx(plan), null);
  const doc = docWith(plan);
  assert.equal(computeWalletBalanceFromDoc(doc, "w_shopee_paylater"), -POKOK);

  const res1 = applyPayment(plan, { ke: 1, fromWalletId: "w_bca", date: "2026-11-04", now: "2026-11-04T01:00:00.000Z" });
  assert.equal(res1.txs.length, 2);
  const [trf, bunga] = res1.txs;
  assert.equal(trf.type, "transfer");
  assert.equal(trf.toWalletId, "w_shopee_paylater");
  assert.equal(bunga.type, "out");
  assert.equal(bunga.walletId, "w_bca");
  assert.equal(bunga.categoryId, "c_bunga");
  assert.equal(trf.amount + bunga.amount, 1374183);
  doc.transactions.push(...res1.txs);
  plan = res1.plan;

  assert.throws(() => applyPayment(plan, { ke: 1, fromWalletId: "w_bca" }), /sudah dibayar/);
  assert.throws(() => applyPayment(plan, { ke: 3, fromWalletId: "w_bca" }), /ke-2 dulu/);

  for (let k = 2; k <= 12; k++) {
    const r = applyPayment(plan, { ke: k, fromWalletId: "w_bca", date: "2027-01-01" });
    doc.transactions.push(...r.txs);
    plan = r.plan;
  }
  assert.equal(plan.status, "lunas");
  assert.equal(computeWalletBalanceFromDoc(doc, "w_shopee_paylater"), 0);
  assert.equal(computeWalletBalanceFromDoc(doc, "w_bca"), 20000000 - 1374183 * 12);
  const totalBunga = doc.transactions.filter((t) => t.meta?.cicilanRole === "bayar_bunga").reduce((a, t) => a + t.amount, 0);
  assert.equal(totalBunga, 3749116);
});

test("mode di_awal: hutang = total bayar sejak awal, tiap bayar transfer penuh", () => {
  let plan = createPlan(
    { label: "Kamera", walletId: "w_shopee_paylater", pokok: POKOK, tenor: 6, perBulan: 2436054, startMonth: "2026-11", dueDay: 5, bungaMode: "di_awal" },
    { id: "cl_awal" }
  );
  const upfront = buildUpfrontInterestTx(plan);
  assert.equal(upfront.amount, 2436054 * 6 - POKOK);
  const doc = docWith(plan, [upfront]);
  assert.equal(computeWalletBalanceFromDoc(doc, "w_shopee_paylater"), -(2436054 * 6));
  for (let k = 1; k <= 6; k++) {
    const r = applyPayment(plan, { ke: k, fromWalletId: "w_bca" });
    assert.equal(r.txs.length, 1);
    assert.equal(r.txs[0].amount, 2436054);
    doc.transactions.push(...r.txs);
    plan = r.plan;
  }
  assert.equal(computeWalletBalanceFromDoc(doc, "w_shopee_paylater"), 0);
});

test("bayar lebih (denda) → selisih jadi pengeluaran; bayar kurang ditolak", () => {
  const plan = createPlan(
    { label: "X", walletId: "w_shopee_paylater", pokok: 3000000, tenor: 3, perBulan: 1000000, startMonth: "2026-11", dueDay: 5 },
    { id: "cl_denda" }
  );
  assert.throws(() => applyPayment(plan, { ke: 1, fromWalletId: "w_bca", amount: 900000 }), /kurang/);
  const r = applyPayment(plan, { ke: 1, fromWalletId: "w_bca", amount: 1050000 });
  assert.equal(r.txs[0].amount, 1000000);
  assert.equal(r.txs[1].amount, 50000);
  assert.match(r.txs[1].desc, /denda/i);
  assert.throws(() => applyPayment(plan, { ke: 1, fromWalletId: "w_shopee_paylater" }), /tidak boleh/);
});

test("planSummary / cicilanOverview: jatuh tempo, terlambat, sisa", () => {
  const plan = createPlan(
    { label: "Kamera", walletId: "w_shopee_paylater", pokok: POKOK, tenor: 3, perBulan: 4247027, startMonth: "2026-11", dueDay: 5 },
    { id: "cl_sum" }
  );
  const s1 = planSummary(plan, "2026-11-03");
  assert.equal(s1.next.ke, 1);
  assert.equal(s1.daysToDue, 2);
  assert.equal(s1.dueSoon, true);
  assert.equal(s1.overdue, false);
  const s2 = planSummary(plan, "2026-11-07");
  assert.equal(s2.overdue, true);

  const paid = applyPayment(plan, { ke: 1, fromWalletId: "w_bca" }).plan;
  const ov = cicilanOverview([paid, cancelPlan(plan)], "2026-11-20");
  assert.equal(ov.activeCount, 1);
  assert.equal(ov.sisaBayar, 4247027 * 2);
  assert.equal(ov.tagihanBerikut.row.ke, 2);
});

test("mergeCicilanPlans: updatedAt terbaru menang (server tidak tertimpa HP stale)", () => {
  const a = { id: "p1", updatedAt: "2026-11-01T00:00:00Z", status: "berjalan" };
  const b = { id: "p1", updatedAt: "2026-11-05T00:00:00Z", status: "lunas" };
  assert.equal(mergeCicilanPlans([b], [a])[0].status, "lunas");
  assert.equal(mergeCicilanPlans([a], [b])[0].status, "lunas");
  assert.equal(mergeCicilanPlans([a], [{ id: "p2", updatedAt: "x" }]).length, 2);
});

test("normalizeScreenshotParse membersihkan hasil AI", () => {
  const n = normalizeScreenshotParse({
    pokok: "12741080",
    label: "DJI Osmo",
    options: [{ tenor: 3, perBulan: 4247027 }, { tenor: 3, perBulan: 1 }, { tenor: 0, perBulan: 5 }, { tenor: 1, per_bulan: 12741080 }],
  });
  assert.equal(n.pokok, 12741080);
  assert.deepEqual(n.options, [{ tenor: 1, perBulan: 12741080 }, { tenor: 3, perBulan: 4247027 }]);
});

// ── sumber PayLater (FNB vs Fishing) ─────────────────────────────────────────

const fnbDoc = {
  wallets: [
    { id: "w_shopee_paylater", name: "Shopee PayLater", type: "paylater", liability: true, opening: 0, active: true, sort: 100 },
    { id: "w_bca", name: "BCA", type: "rekening", opening: 0, active: true, sort: 110 },
    { id: "w_bri", name: "BRI", type: "rekening", opening: 0, active: true, sort: 120 },
    { id: "w_kas_besar", name: "NF Cash (Kas Besar)", type: "kas_fisik", opening: 0, active: true, sort: 40 },
  ],
  categories: [
    { id: "c1", name: "Bahan Baku", type: "out" },
    { id: "c2", name: "Lain-lain", type: "out" },
    { id: "c3", name: "Penjualan", type: "in" },
  ],
  transactions: [
    { id: "t_beli", type: "out", amount: 12798580, walletId: "w_shopee_paylater", date: "2026-10-02", desc: "DJI Osmo" },
    { id: "t_lain", type: "out", amount: 50000, walletId: "w_bca", date: "2026-10-02" },
  ],
};

test("FNB memakai dompet PayLater sendiri; bayar dari semua rekening non-PayLater", () => {
  const src = resolvePaylaterSource(fnbDoc, CANONICAL_BUSINESS_ID);
  assert.equal(src.sourceBusinessId, CANONICAL_BUSINESS_ID);
  assert.equal(src.walletId, "w_shopee_paylater");
  const view = buildCicilanView(src, fnbDoc);
  assert.deepEqual(view.payWallets.map((w) => w.id), ["w_kas_besar", "w_bca", "w_bri"]);
  assert.equal(view.paylater.balance, -12798580);
  assert.deepEqual(view.purchases.map((p) => p.id), ["t_beli"]);
  assert.equal(view.suggestedBungaCategoryId, "c2");
});

test("Fishing memakai PayLater FNB via shared link; bayar hanya dari rekening yang di-share", () => {
  const fishingDoc = {
    wallets: [{ id: "w_fish_shopee_paylater", type: "paylater", active: true }],
    walletSetup: { sharedLinks: buildFishingSharedLinks({ enabled: true }) },
  };
  const src = resolvePaylaterSource(fishingDoc, "fishing-biz");
  assert.equal(src.sourceBusinessId, CANONICAL_BUSINESS_ID);
  assert.equal(src.walletId, "w_shopee_paylater");
  const view = buildCicilanView(src, fnbDoc);
  // Kas Besar FNB tidak pernah di-share ke Fishing; Uang NF tidak ada di fnbDoc ini.
  assert.deepEqual(view.payWallets.map((w) => w.id).sort(), ["w_bca", "w_bri"]);
});

test("purchase yang sudah ditautkan tidak muncul lagi; tebak kategori bunga", () => {
  const src = resolvePaylaterSource(fnbDoc, CANONICAL_BUSINESS_ID);
  const view = buildCicilanView(src, { ...fnbDoc, cicilanPlans: [{ id: "p", purchaseTxId: "t_beli", createdAt: "x" }] });
  assert.equal(view.purchases.length, 0);
  assert.equal(guessBungaCategoryId([{ id: "a", name: "Lain-lain" }, { id: "b", name: "Bunga PayLater" }]), "b");
});
