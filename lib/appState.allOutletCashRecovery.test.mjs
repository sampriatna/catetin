// node lib/appState.allOutletCashRecovery.test.mjs
// Regresi: laporan aktif adalah sumber kebenaran untuk tepat satu transaksi tunai laci.
import {
  canonicalLaporanCashTxId,
  laciSettleCheck,
  reconcilePendingLaciTransactions,
  walletBalance,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { cashChannel, factoryChannelsForOutlet } from "./reportChannels.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log("✓", message);
  } else {
    failed++;
    console.error("✗", message);
  }
}

function makeReport(outlet, date, cash, overrides = {}) {
  const channelDefs = factoryChannelsForOutlet(outlet);
  const cashDef = cashChannel(channelDefs);
  return {
    id: `dr_${outlet}_${date}`,
    outlet,
    date,
    businessId: BIZ,
    reportKey: `${BIZ}:${outlet}:${date}`,
    status: "submitted",
    submittedAt: `${date}T14:00:00.000Z`,
    channelDefs,
    channels: { [cashDef.id]: cash },
    setoranOwner: cash,
    cash,
    total: cash,
    laciFloor: LACI_FLOOR,
    ...overrides,
  };
}

function baseState(reports = []) {
  return {
    businessId: BIZ,
    wallets: [
      { id: "w_laci_kbu", opening: LACI_FLOOR, floor: LACI_FLOOR },
      { id: "w_laci_ksm", opening: LACI_FLOOR, floor: LACI_FLOOR },
      { id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR },
      { id: "w_kas_besar", opening: 0, floor: 0 },
    ],
    categories: [
      { id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true },
    ],
    transactions: [],
    deletedTransactionIds: [],
    dailyReports: reports,
  };
}

function generatedCash(doc, outlet, date) {
  return (doc.transactions || []).filter(
    (t) => t.type === "in"
      && /laporan harian/i.test(t.source || "")
      && t.outletCode === outlet
      && t.date === date
  );
}

function healPending(state) {
  const fixed = reconcilePendingLaciTransactions(state);
  return {
    ...state,
    transactions: fixed.transactions,
    deletedTransactionIds: fixed.deletedTransactionIds,
  };
}

// 1) Kasus Production KBU 16 Agustus: laporan/fisik benar, tx laci hilang.
{
  const date = "2026-08-16";
  const report = makeReport("KBU", date, 3_414_000, {
    total: 5_518_500,
    physicalCashEnd: 3_664_000,
  });
  const canonicalId = canonicalLaporanCashTxId(report);
  const source = baseState([report]);
  source.deletedTransactionIds = [canonicalId];

  const healed = healPending(source);
  const cash = generatedCash(healed, "KBU", date);

  ok(cash.length === 1, "1) KBU: transaksi tunai yang hilang dipulihkan tepat satu");
  ok(cash[0]?.id === canonicalId && cash[0]?.amount === 3_414_000, "1) KBU: id dan nominal kanonik benar");
  ok(cash[0]?.categoryId === "ci_tunai", "1) KBU: kategori pemasukan tunai ikut dipulihkan");
  ok(!healed.deletedTransactionIds.includes(canonicalId), "1) KBU: tombstone stale transaksi kanonik dibersihkan");
  ok(walletBalance("w_laci_kbu", healed.wallets, healed.transactions) === 3_664_000, "1) KBU: saldo laci menjadi modal + tunai");
  ok(laciSettleCheck(healed, healed.dailyReports[0]).ok, "1) KBU: laporan siap diverifikasi/settle tanpa revisi kasir");
}

// 2) Perlindungan yang sama harus berlaku untuk ketiga outlet.
{
  const reports = [
    makeReport("KBU", "2026-08-17", 100_000),
    makeReport("KSM", "2026-08-17", 200_000),
    makeReport("SMT", "2026-08-17", 300_000),
  ];
  const healed = healPending(baseState(reports));

  for (const report of reports) {
    const cash = generatedCash(healed, report.outlet, report.date);
    ok(cash.length === 1, `2) ${report.outlet}: missing cash dipulihkan tepat satu`);
    ok(cash[0]?.id === canonicalLaporanCashTxId(report), `2) ${report.outlet}: memakai id kanonik`);
  }
}

// 3) Duplikat legacy KBU dibuang, lalu merge ulang tetap idempotent.
{
  const date = "2026-08-18";
  const report = makeReport("KBU", date, 450_000);
  const canonicalId = canonicalLaporanCashTxId(report);
  const source = baseState([report]);
  source.transactions = [
    {
      id: canonicalId,
      type: "in",
      amount: 450_000,
      walletId: "w_laci_kbu",
      desc: "Omset tunai KBU",
      date,
      source: "Laporan harian",
      dailyReportId: report.id,
      outletCode: "KBU",
    },
    {
      id: `t_${report.id}_cash`,
      type: "in",
      amount: 450_000,
      walletId: "w_laci_kbu",
      desc: "Omset tunai KBU",
      date,
      source: "Laporan harian",
      dailyReportId: report.id,
      outletCode: "KBU",
    },
  ];

  const healed = healPending(source);
  const healedAgain = healPending(healed);
  ok(generatedCash(healed, "KBU", date).length === 1, "3) KBU: duplikat legacy dibersihkan");
  ok(generatedCash(healedAgain, "KBU", date).length === 1, "3) KBU: merge ulang tidak membuat transaksi kedua");
  ok(
    healedAgain.deletedTransactionIds.includes(`t_${report.id}_cash`),
    "3) KBU: id legacy ditombstone agar HP lama tidak menghidupkan duplikat"
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
