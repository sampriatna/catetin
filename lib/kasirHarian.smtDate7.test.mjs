// node lib/kasirHarian.smtDate7.test.mjs
// Permanent idempotency — Samtaro / SMT business date 2026-08-07
import {
  submitDailyReport,
  settleDailyReport,
  applyDailyReportMutation,
  makeDailyReportSubmissionId,
  canonicalDailyReportId,
  canonicalLaporanCashTxId,
  countSmtSubmissionArtifacts,
  collapseDailyReportsBySlot,
  enforceSingleSmtGeneratedCash,
  reconcileOrphanLaporanCashTxs,
  reportsForDate,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { mergeDailyReports } from "./dailyReportMerge.js";
import { hydrateReportChannels } from "./reportChannels.js";

/** Mirror finalizeMergedDoc protections (tanpa Supabase). */
function finalizeLikeSave(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  collapseDailyReportsBySlot(d);
  const orphan = reconcileOrphanLaporanCashTxs(d);
  if (orphan.changed) {
    d.transactions = orphan.transactions;
    d.deletedTransactionIds = orphan.deletedTransactionIds;
  }
  enforceSingleSmtGeneratedCash(d, DATE);
  return d;
}

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
const DATE = "2026-08-07";
const CANON_REPORT = canonicalDailyReportId({ businessId: BIZ, outlet: "SMT", date: DATE });
const CANON_CASH = canonicalLaporanCashTxId({ businessId: BIZ, outlet: "SMT", date: DATE });

const baseWallets = [
  { id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR },
  { id: "w_kas_besar", opening: 0, floor: 0 },
  { id: "w_bca", opening: 0, floor: 0 },
  { id: "w_gofood", opening: 0, floor: 0 },
];
const categories = [
  { id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true },
  { id: "ci_qris_bca", name: "Penjualan QRIS BCA", type: "in", active: true },
  { id: "ci_gojek", name: "Penjualan Gojek", type: "in", active: true },
];

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("✓", msg); }
  else { failed++; console.error("✗", msg); }
}

const emptyState = () => ({
  wallets: JSON.parse(JSON.stringify(baseWallets)),
  categories,
  transactions: [],
  dailyReports: [],
  reportChannels: hydrateReportChannels(null),
  businessId: BIZ,
  deletedTransactionIds: [],
  deletedDailyReportIds: [],
  deletedDailyReportSlots: [],
});

function smtPayload(submissionId, channels = { tunai: 500000, edc_bca: 100000, gofood: 50000 }) {
  return {
    channels,
    date: DATE,
    user: { id: "u_smt", name: "Kasir Samtaro", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
    idempotencyKey: submissionId,
  };
}

function submitOnce(state, sid, channels) {
  const built = submitDailyReport(state, smtPayload(sid, channels));
  applyDailyReportMutation(state, {
    report: built.report,
    txs: built.idempotent ? [] : built.txs,
    removeIds: built.removeIds || [],
  });
  return built;
}

// CASE 1 — NORMAL: input sekali
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: DATE, userId: "u", nonce: "c1" });
  submitOnce(state, sid);
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1, "CASE1 normal: 1 report");
  ok(arts.cashCount === 1, "CASE1 normal: 1 cash");
  ok(state.dailyReports[0].id === CANON_REPORT, "CASE1 report id kanonik");
  ok(arts.cashIds[0] === CANON_CASH, "CASE1 cash id kanonik");
}

// CASE 2 — DOUBLE CLICK: dua request hampir bersamaan (sid sama)
{
  const state = emptyState();
  const sid = "biz|SMT|2026-08-07|u|dbl";
  const a = submitDailyReport(state, smtPayload(sid));
  const b = submitDailyReport(state, smtPayload(sid));
  ok(a.report.id === b.report.id && a.report.id === CANON_REPORT, "CASE2 id sama");
  applyDailyReportMutation(state, a);
  applyDailyReportMutation(state, { report: b.report, txs: b.txs });
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1 && arts.cashCount === 1, "CASE2 double click → 1+1");
}

// CASE 3 — RETRY: payload identik dikirim ulang
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: DATE, userId: "u", nonce: "retry" });
  submitOnce(state, sid);
  const again = submitDailyReport(state, smtPayload(sid));
  ok(again.idempotent === true, "CASE3 retry idempotent");
  applyDailyReportMutation(state, { report: again.report, txs: [] });
  ok(countSmtSubmissionArtifacts(state, DATE).reportCount === 1, "CASE3 tetap 1 report");
  ok(countSmtSubmissionArtifacts(state, DATE).cashCount === 1, "CASE3 tetap 1 cash");
}

// CASE 4 — EDIT: sid beda, nominal beda → UPDATE report yang sama
{
  const state = emptyState();
  submitOnce(state, "sid-a", { tunai: 500000 });
  const edit = submitDailyReport(state, smtPayload("sid-b", { tunai: 750000 }));
  ok(edit.report.id === CANON_REPORT, "CASE4 edit id sama");
  applyDailyReportMutation(state, edit);
  ok(state.dailyReports.length === 1, "CASE4 bukan INSERT baru");
  ok(state.dailyReports[0].setoranOwner === 750000, "CASE4 nominal ter-update");
  ok(countSmtSubmissionArtifacts(state, DATE).cashCount === 1, "CASE4 1 cash setelah edit");
}

// CASE 5 — SETTLE
{
  const state = emptyState();
  submitOnce(state, "sid-settle", { tunai: 400000 });
  const verified = {
    ...state.dailyReports[0],
    status: "admin_verified",
    adminVerifiedAt: new Date().toISOString(),
  };
  state.dailyReports[0] = verified;
  const settled = settleDailyReport(state, verified.id, { id: "admin", role: "admin_keuangan" });
  applyDailyReportMutation(state, settled);
  ok(state.dailyReports[0].status === "settled", "CASE5 status settled");
  ok(state.dailyReports.length === 1, "CASE5 tetap 1 report");
}

// CASE 6 — SETTLE ULANG
{
  const state = emptyState();
  submitOnce(state, "sid-settle2", { tunai: 400000 });
  state.dailyReports[0] = {
    ...state.dailyReports[0],
    status: "admin_verified",
    adminVerifiedAt: new Date().toISOString(),
  };
  const s1 = settleDailyReport(state, state.dailyReports[0].id, { id: "admin", role: "admin_keuangan" });
  applyDailyReportMutation(state, s1);
  const txCountAfterFirst = state.transactions.length;
  const s2 = settleDailyReport(state, state.dailyReports[0].id, { id: "admin", role: "admin_keuangan" });
  ok(s2.idempotent === true, "CASE6 settle ulang idempotent");
  applyDailyReportMutation(state, { report: s2.report, txs: s2.idempotent ? [] : s2.txs });
  ok(state.transactions.length === txCountAfterFirst, "CASE6 tidak double posting settle");
  ok(state.dailyReports.length === 1, "CASE6 tetap 1 report");
}

// CASE 7 — REFRESH: merge remote=local → report sama
{
  const local = emptyState();
  submitOnce(local, "sid-refresh", { tunai: 500000 });
  const merged = mergeDailyReports(local.dailyReports, local.dailyReports);
  ok(merged.length === 1 && merged[0].id === CANON_REPORT, "CASE7 refresh 1 report kanonik");
  ok(reportsForDate(merged, DATE).filter((r) => r.outlet === "SMT").length === 1, "CASE7 UI date list 1");
}

// CASE 8 — CONCURRENT: dua sid berbeda + merge finalize → 1 report + 1 cash
{
  const a = emptyState();
  const b = emptyState();
  submitOnce(a, "concurrent-a", { tunai: 500000 });
  submitOnce(b, "concurrent-b", { tunai: 500000 });
  // Simulasi union kotor sebelum finalize (dua report id beda era lama + dua cash legacy)
  const dirty = emptyState();
  dirty.dailyReports = [
    { ...a.dailyReports[0], id: "dr_legacy_a", submittedAt: "2026-08-07T10:00:00.000Z" },
    { ...b.dailyReports[0], id: "dr_legacy_b", submittedAt: "2026-08-07T10:00:01.000Z" },
  ];
  dirty.transactions = [
    {
      id: "t_dr_legacy_a_cash",
      type: "in",
      amount: 500000,
      walletId: "w_laci_smt",
      desc: "Omset tunai SMT",
      date: DATE,
      source: "Laporan harian",
      dailyReportId: "dr_legacy_a",
    },
    {
      id: "t_dr_legacy_b_cash",
      type: "in",
      amount: 500000,
      walletId: "w_laci_smt",
      desc: "Omset tunai SMT",
      date: DATE,
      source: "Laporan harian",
      dailyReportId: "dr_legacy_b",
    },
  ];
  ok(dirty.dailyReports.length === 2, "CASE8 setup: 2 report kotor");
  ok(countSmtSubmissionArtifacts(dirty, DATE).cashCount === 2, "CASE8 setup: 2 cash kotor");
  const clean = finalizeLikeSave(dirty);
  const arts = countSmtSubmissionArtifacts(clean, DATE);
  ok(arts.reportCount === 1, "CASE8 concurrent finalize → 1 report");
  ok(arts.cashCount === 1, "CASE8 concurrent finalize → 1 cash");
}

// Bonus: format tanggal beda tidak bikin slot dobel di merge
// ISO pagi UTC (= siang WIB) tetap hari yang sama di Jakarta
{
  const merged = mergeDailyReports(
    [{ id: "x1", outlet: "SMT", date: "2026-08-07", status: "submitted", total: 1, submittedAt: "2026-08-07T10:00:00Z" }],
    [{ id: "x2", outlet: "SMT", date: "2026-08-07T03:00:00.000Z", status: "submitted", total: 2, submittedAt: "2026-08-07T11:00:00Z" }]
  );
  ok(merged.length === 1, "merge normalize tanggal → 1 slot SMT 7 Agu");
  ok(merged[0].date === "2026-08-07", "date tersimpan YYYY-MM-DD");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
