// node lib/kasirHarian.falseSuccess.test.mjs
import {
  submitDailyReport,
  applyDailyReportMutation,
  makeDailyReportSubmissionId,
  canonicalLaporanCashTxId,
  findOrphanLaporanCashForSlot,
  hasOrphanLaporanCashSlot,
  findCommittedDailyReport,
  recoverDailyReportFromOrphanCash,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { hydrateReportChannels } from "./reportChannels.js";
import { todayLocal, normalizeReportDate } from "./laporanKeuangan.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("✓", msg); }
  else { failed++; console.error("✗", msg); }
}

const emptyState = () => ({
  wallets: [
    { id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR },
    { id: "w_kas_besar", opening: 0, floor: 0 },
  ],
  categories: [{ id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true }],
  transactions: [],
  dailyReports: [],
  reportChannels: hydrateReportChannels(null),
  businessId: BIZ,
});

const DATE = "2026-08-07";

// 1) Orphan cash tanpa laporan terdeteksi
{
  const state = emptyState();
  const canon = canonicalLaporanCashTxId({ businessId: BIZ, outlet: "SMT", date: DATE });
  state.transactions.push({
    id: canon,
    type: "in",
    amount: 750000,
    walletId: "w_laci_smt",
    desc: "Omset tunai SMT",
    date: DATE,
    source: "Laporan harian",
    outletCode: "SMT",
    reportDate: DATE,
    transactionKind: "daily_report_cash",
  });
  ok(hasOrphanLaporanCashSlot(state, "SMT", DATE) === true, "orphan cash SMT terdeteksi");
  ok(findOrphanLaporanCashForSlot(state, "SMT", DATE).length === 1, "satu orphan cash");
}

// 2) Recovery membangun stub laporan tanpa menambah cash
{
  const state = emptyState();
  const canon = canonicalLaporanCashTxId({ businessId: BIZ, outlet: "SMT", date: DATE });
  state.transactions.push({
    id: canon,
    type: "in",
    amount: 750000,
    walletId: "w_laci_smt",
    desc: "Omset tunai SMT",
    date: DATE,
    source: "Laporan harian",
    outletCode: "SMT",
    sourceSubmissionId: "sub-orphan-1",
  });
  const { report, recovered, txs } = recoverDailyReportFromOrphanCash(state, {
    outlet: "SMT",
    date: DATE,
    user: { id: "u", name: "Kasir", outlet: "SMT" },
    businessId: BIZ,
  });
  ok(recovered === true, "recovery membuat stub");
  ok(report.outlet === "SMT" && report.date === DATE, "stub slot benar");
  ok(report.total === 750000, "stub nominal dari orphan cash");
  ok(txs.length === 1 && txs[0].id === canon, "tidak membuat cash baru");

  applyDailyReportMutation(state, { report, txs: [] });
  ok(hasOrphanLaporanCashSlot(state, "SMT", DATE) === false, "setelah recovery bukan orphan lagi");
  ok(findCommittedDailyReport(state, { outlet: "SMT", date: DATE })?.id === report.id, "findCommitted menemukan stub");
}

// 3) Resubmit setelah orphan → cash id tetap kanonik (tidak double)
{
  const state = emptyState();
  const canon = canonicalLaporanCashTxId({ businessId: BIZ, outlet: "SMT", date: DATE });
  state.transactions.push({
    id: canon,
    type: "in",
    amount: 500000,
    walletId: "w_laci_smt",
    desc: "Omset tunai SMT",
    date: DATE,
    source: "Laporan harian",
    outletCode: "SMT",
  });
  const { report: stub } = recoverDailyReportFromOrphanCash(state, {
    outlet: "SMT", date: DATE, user: { id: "u", outlet: "SMT" }, businessId: BIZ,
  });
  applyDailyReportMutation(state, { report: stub, txs: [] });

  const sid = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "SMT", date: DATE, userId: "u", nonce: "resub",
  });
  const { report, txs } = submitDailyReport(
    { ...state, currentUser: { id: "u", outlet: "SMT" } },
    { channels: { tunai: 800000 }, date: DATE, user: { id: "u", outlet: "SMT" }, businessId: BIZ, submissionId: sid }
  );
  applyDailyReportMutation(state, { report, txs });
  const cash = state.transactions.filter((t) => /laporan harian/i.test(t.source || "") && t.type === "in");
  ok(cash.length === 1, "resubmit orphan tidak menambah cash kedua");
  ok(cash[0].id === canon, "cash tetap id kanonik");
  ok(cash[0].amount === 800000, "nominal cash di-upsert");
}

// 4) findCommitted by reportKey / submissionId
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "SMT", date: DATE, userId: "u", nonce: "v1",
  });
  const { report, txs } = submitDailyReport(
    { ...state, currentUser: { id: "u", outlet: "SMT" } },
    { channels: { tunai: 100000 }, date: DATE, user: { id: "u", outlet: "SMT" }, businessId: BIZ, submissionId: sid }
  );
  applyDailyReportMutation(state, { report, txs });
  ok(!!findCommittedDailyReport(state, { submissionId: sid }), "verify by submissionId");
  ok(!!findCommittedDailyReport(state, { reportKey: report.reportKey }), "verify by reportKey");
  ok(!findCommittedDailyReport(state, { outlet: "KSM", date: DATE }), "outlet lain tidak ketemu");
}

// 5) todayLocal = Asia/Jakarta YYYY-MM-DD
{
  const t = todayLocal();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(t), "todayLocal format YYYY-MM-DD");
  ok(normalizeReportDate(new Date()) === t, "normalizeReportDate(now) === todayLocal");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
