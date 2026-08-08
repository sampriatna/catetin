// node lib/kasirHarian.duplicate.test.mjs
import {
  submitDailyReport,
  deleteDailyReport,
  applyDailyReportMutation,
  makeDailyReportSubmissionId,
  makeDailyReportKey,
  canonicalLaporanCashTxId,
  reconcileDailyReportTransactions,
  reconcileOrphanLaporanCashTxs,
  collectDailyReportCashTxIds,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { recordDailyReportDelete, filterDeletedDailyReports, mergeDeletedDailyReportMeta } from "./dailyReportDelete.js";
import { mergeDailyReports } from "./dailyReportMerge.js";
import { hydrateReportChannels } from "./reportChannels.js";
import { applyTransactionDelete } from "./transactionEdit.js";
import { auditDailyReportSlot, auditDailyReportDuplicates, previewDuplicateCleanup } from "./dailyReportAudit.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";

const baseWallets = [
  { id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR },
  { id: "w_laci_ksm", opening: LACI_FLOOR, floor: LACI_FLOOR },
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
  wallets: baseWallets,
  categories,
  transactions: [],
  dailyReports: [],
  reportChannels: hydrateReportChannels(null),
  businessId: BIZ,
  deletedTransactionIds: [],
  deletedDailyReportIds: [],
  deletedDailyReportSlots: [],
});

function smtPayload(date, submissionId, channels = { tunai: 500000 }) {
  return {
    channels,
    date,
    user: { id: "u_smt", name: "Kasir Samtaro", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
  };
}

function cashTxs(state, outlet, date) {
  return (state.transactions || []).filter(
    (t) => /laporan harian/i.test(t.source || "") && t.type === "in"
      && (normalize(t.date) === date)
      && String(t.desc || "").includes(`Omset tunai ${outlet}`)
  );
}
function normalize(d) { return String(d || "").slice(0, 10); }

function mergeLikeSave(remote, local) {
  const deleteMeta = mergeDeletedDailyReportMeta(remote, local);
  const filter = (arr) => filterDeletedDailyReports(arr, deleteMeta);
  const reports = filter(mergeDailyReports(remote.dailyReports || [], local.dailyReports || [], { filterDeletedDailyReports: filter }));
  const deletedTx = new Set([...(remote.deletedTransactionIds || []), ...(local.deletedTransactionIds || [])]);
  const map = new Map();
  for (const t of [...(local.transactions || []), ...(remote.transactions || [])]) {
    if (!t?.id || deletedTx.has(t.id)) continue;
    map.set(t.id, t);
  }
  const doc = {
    ...local,
    dailyReports: reports,
    transactions: [...map.values()],
    deletedTransactionIds: [...deletedTx],
    deletedDailyReportIds: deleteMeta.deletedDailyReportIds,
    deletedDailyReportSlots: deleteMeta.deletedDailyReportSlots,
  };
  const orphan = reconcileOrphanLaporanCashTxs(doc);
  return {
    ...doc,
    transactions: orphan.transactions,
    deletedTransactionIds: orphan.deletedTransactionIds,
  };
}

// --- 1) First submit SMT ---
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "n1" });
  const built = submitDailyReport(state, smtPayload("2026-08-03", sid));
  applyDailyReportMutation(state, built);
  ok(state.dailyReports.length === 1, "1) first submit: 1 laporan");
  ok(cashTxs(state, "SMT", "2026-08-03").length === 1, "1) first submit: 1 cash tx");
  ok(
    cashTxs(state, "SMT", "2026-08-03")[0].id === canonicalLaporanCashTxId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03" }),
    "1) cash tx memakai id kanonik slot"
  );
  ok(cashTxs(state, "SMT", "2026-08-03")[0].sourceReportId === built.report.id, "1) sourceReportId terisi");
}

// --- 2) Retry same submit ---
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "retry" });
  const a = submitDailyReport(state, smtPayload("2026-08-03", sid));
  applyDailyReportMutation(state, a);
  const b = submitDailyReport(state, smtPayload("2026-08-03", sid));
  ok(b.idempotent === true, "2) retry idempotent");
  applyDailyReportMutation(state, { report: b.report, txs: b.idempotent ? [] : b.txs });
  ok(state.dailyReports.length === 1 && cashTxs(state, "SMT", "2026-08-03").length === 1, "2) retry tidak dobel");
}

// --- 3) Double click (dua mutate, key sama) ---
{
  const state = emptyState();
  const sid = "biz|SMT|2026-08-03|u|dbl";
  const a = submitDailyReport(state, smtPayload("2026-08-03", sid));
  const b = submitDailyReport(state, smtPayload("2026-08-03", sid));
  applyDailyReportMutation(state, a);
  applyDailyReportMutation(state, { report: b.report, txs: b.txs });
  ok(state.dailyReports.length === 1, "3) double click: 1 laporan");
  ok(cashTxs(state, "SMT", "2026-08-03").length === 1, "3) double click: 1 cash");
}

// --- 4) Refresh/reload (merge remote=local) ---
{
  const local = emptyState();
  const sid = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "ref" });
  applyDailyReportMutation(local, submitDailyReport(local, smtPayload("2026-08-03", sid)));
  const merged = mergeLikeSave(local, local);
  ok(merged.dailyReports.length === 1 && cashTxs(merged, "SMT", "2026-08-03").length === 1, "4) refresh tidak dobel");
}

// --- 5) Submit ulang slot lengkap (submissionId beda, nominal sama) → idempotent, bukan report #2 ---
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-05", userId: "u", nonce: "edit" });
  applyDailyReportMutation(state, submitDailyReport(state, smtPayload("2026-08-05", sid)));
  const again = submitDailyReport(state, smtPayload("2026-08-05", sid + "|other"));
  ok(again.idempotent === true, "5) submit baru (sid beda, nominal sama) idempotent");
  applyDailyReportMutation(state, { report: again.report, txs: again.idempotent ? [] : again.txs });
  ok(state.dailyReports.length === 1, "5) tetap 1 laporan");
  ok(cashTxs(state, "SMT", "2026-08-05").length === 1, "5) tetap 1 cash");
}

// --- 6) Delete report + generated txs, manual tetap ---
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "del" });
  const built = submitDailyReport(state, smtPayload("2026-08-03", sid));
  applyDailyReportMutation(state, built);
  state.transactions.push({
    id: "t_manual_smt",
    type: "out",
    amount: 10000,
    walletId: "w_laci_smt",
    desc: "Beli gas",
    date: "2026-08-03",
    source: "Manual",
  });
  const { report: deleted, removeIds } = deleteDailyReport(state, built.report.id, { id: "owner", role: "owner" });
  state.dailyReports = state.dailyReports.filter((r) => !(r.outlet === deleted.outlet && r.date === deleted.date));
  removeIds.forEach((id) => applyTransactionDelete(state, id));
  recordDailyReportDelete(state, deleted);
  ok(state.dailyReports.length === 0, "6) delete: laporan hilang");
  ok(cashTxs(state, "SMT", "2026-08-03").length === 0, "6) delete: cash generated hilang");
  ok(state.transactions.some((t) => t.id === "t_manual_smt"), "6) delete: tx manual tetap");
}

// --- 7) Resubmit after delete — tidak double ---
{
  const cloud = emptyState();
  const sid1 = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "a" });
  const first = submitDailyReport(cloud, smtPayload("2026-08-03", sid1));
  applyDailyReportMutation(cloud, first);

  const local = JSON.parse(JSON.stringify(cloud));
  const { report: deleted, removeIds } = deleteDailyReport(local, first.report.id, { id: "owner", role: "owner" });
  local.dailyReports = local.dailyReports.filter((r) => !(r.outlet === deleted.outlet && r.date === deleted.date));
  removeIds.forEach((id) => applyTransactionDelete(local, id));
  recordDailyReportDelete(local, deleted);

  const sid2 = makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "b" });
  const second = submitDailyReport(local, smtPayload("2026-08-03", sid2));
  applyDailyReportMutation(local, second);

  // Cloud masih punya laporan lama (race) — merge harus 1 report + 1 cash
  const merged = mergeLikeSave(cloud, local);
  ok(merged.dailyReports.length === 1, "7) resubmit+merge: 1 laporan");
  ok(cashTxs(merged, "SMT", "2026-08-03").length === 1, "7) resubmit+merge: 1 cash");
  ok(
    cashTxs(merged, "SMT", "2026-08-03")[0].id === canonicalLaporanCashTxId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03" }),
    "7) cash kanonik setelah resubmit"
  );
}

// --- 8) Two concurrent submissions (key sama) ---
{
  const state = emptyState();
  const sid = "biz|SMT|2026-08-06|u|conc";
  const a = submitDailyReport(state, smtPayload("2026-08-06", sid));
  const b = submitDailyReport(state, smtPayload("2026-08-06", sid));
  ok(a.report.id === b.report.id, "8) concurrent: id sama");
  applyDailyReportMutation(state, a);
  applyDailyReportMutation(state, { report: b.report, txs: b.txs });
  ok(state.dailyReports.length === 1 && cashTxs(state, "SMT", "2026-08-06").length === 1, "8) concurrent: 1 set");
}

// --- 9) Different outlet same date ---
{
  const state = emptyState();
  applyDailyReportMutation(state, submitDailyReport(state, {
    ...smtPayload("2026-08-03", makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "x" })),
  }));
  applyDailyReportMutation(state, submitDailyReport(state, {
    channels: { tunai: 200000 },
    date: "2026-08-03",
    user: { id: "u_ksm", name: "KSM", outlet: "KSM" },
    businessId: BIZ,
    submissionId: makeDailyReportSubmissionId({ businessId: BIZ, outlet: "KSM", date: "2026-08-03", userId: "u", nonce: "x" }),
  }));
  ok(state.dailyReports.length === 2, "9) outlet beda: 2 laporan");
  ok(cashTxs(state, "SMT", "2026-08-03").length === 1 && cashTxs(state, "KSM", "2026-08-03").length === 1, "9) 1 cash per outlet");
}

// --- 10) Same outlet different date ---
{
  const state = emptyState();
  applyDailyReportMutation(state, submitDailyReport(state, smtPayload(
    "2026-08-03",
    makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u", nonce: "d1" })
  )));
  applyDailyReportMutation(state, submitDailyReport(state, smtPayload(
    "2026-08-04",
    makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-04", userId: "u", nonce: "d2" })
  )));
  ok(state.dailyReports.length === 2, "10) tanggal beda: 2 laporan");
  ok(
    makeDailyReportKey({ businessId: BIZ, outlet: "SMT", date: "2026-08-03" })
      !== makeDailyReportKey({ businessId: BIZ, outlet: "SMT", date: "2026-08-04" }),
    "10) reportKey beda per tanggal"
  );
}

// --- 11) Tombstone same-ms resubmit tidak menelan laporan baru ---
{
  const deletedAt = "2026-08-07T10:00:00.000Z";
  const meta = {
    deletedDailyReportIds: ["dr_old"],
    deletedDailyReportSlots: [{ outlet: "SMT", date: "2026-08-03", reportId: "dr_old", deletedAt }],
  };
  const neu = {
    id: "dr_new",
    outlet: "SMT",
    date: "2026-08-03",
    status: "submitted",
    submittedAt: deletedAt,
    total: 1,
  };
  ok(filterDeletedDailyReports([neu], meta).length === 1, "11) resubmit same-ms lolos tombstone slot");
  ok(filterDeletedDailyReports([{ ...neu, id: "dr_old" }], meta).length === 1, "11) id kanonik sama setelah hapus diizinkan");
  ok(
    filterDeletedDailyReports([{ ...neu, id: "dr_old", submittedAt: "2026-08-07T09:00:00.000Z" }], meta).length === 0,
    "11) id lama stale (sebelum delete) tetap diblok"
  );
}

// --- 12) Legacy duplicate cash dibersihkan reconcile ---
{
  const state = emptyState();
  const report = {
    id: "dr_live",
    outlet: "SMT",
    date: "2026-08-03",
    status: "submitted",
    submittedAt: "2026-08-03T10:00:00.000Z",
    total: 500000,
    setoranOwner: 500000,
    channels: { tunai: 500000 },
    businessId: BIZ,
    reportKey: makeDailyReportKey({ businessId: BIZ, outlet: "SMT", date: "2026-08-03" }),
  };
  state.dailyReports = [report];
  state.transactions = [
    { id: "t_dr_live_cash", type: "in", amount: 500000, walletId: "w_laci_smt", desc: "Omset tunai SMT", date: "2026-08-03", source: "Laporan harian", dailyReportId: "dr_live" },
    { id: "t_dr_ghost_cash", type: "in", amount: 500000, walletId: "w_laci_smt", desc: "Omset tunai SMT", date: "2026-08-03", source: "Laporan harian", dailyReportId: "dr_ghost" },
    { id: "t_manual", type: "in", amount: 1000, walletId: "w_laci_smt", desc: "Setoran lain", date: "2026-08-03", source: "Manual" },
  ];
  const rec = reconcileDailyReportTransactions(state, report);
  ok(rec.changed, "12) reconcile mengubah state");
  ok(rec.transactions.filter((t) => /laporan harian/i.test(t.source || "")).length === 1, "12) 1 cash setelah reconcile");
  ok(rec.transactions.some((t) => t.id === "t_manual"), "12) manual tidak terhapus");
  const again = reconcileDailyReportTransactions({ ...state, transactions: rec.transactions }, report);
  ok(again.changed === false || rec.transactions.filter((t) => /laporan harian/i.test(t.source || "")).length === 1, "12) reconcile idempotent");
}

// --- 13) Audit helper ---
{
  const state = emptyState();
  state.dailyReports = [
    { id: "a", outlet: "SMT", date: "2026-08-03", status: "submitted", submittedAt: "2026-08-03T10:00:00Z", total: 1, setoranOwner: 1, channels: { tunai: 1 } },
    { id: "b", outlet: "SMT", date: "2026-08-03", status: "submitted", submittedAt: "2026-08-03T11:00:00Z", total: 2, setoranOwner: 2, channels: { tunai: 2 } },
  ];
  state.transactions = [
    { id: "t1", type: "in", amount: 1, walletId: "w_laci_smt", desc: "Omset tunai SMT", date: "2026-08-03", source: "Laporan harian", dailyReportId: "a" },
    { id: "t2", type: "in", amount: 2, walletId: "w_laci_smt", desc: "Omset tunai SMT", date: "2026-08-03", source: "Laporan harian", dailyReportId: "b" },
  ];
  const slot = auditDailyReportSlot(state, { businessId: BIZ, outlet: "SMT", date: "2026-08-03" });
  ok(slot.duplicate === true && slot.reportCount === 2 && slot.generatedCashCount === 2, "13) audit mendeteksi duplikat SMT");
  const preview = previewDuplicateCleanup(state, slot);
  ok(preview.wouldDeleteReportIds.length === 1 && preview.wouldDeleteTxIds.length >= 1, "13) preview cleanup tanpa eksekusi");
  const scan = auditDailyReportDuplicates(state, { businessId: BIZ });
  ok(scan.duplicateSlots >= 1 && scan.focus.some((f) => f.outlet === "SMT"), "13) scan focus SMT");
}

// --- 14) collectDailyReportCashTxIds menangkap legacy + kanonik ---
{
  const report = { id: "drX", outlet: "SMT", date: "2026-08-03", businessId: BIZ };
  const txs = [
    { id: "t_drX_cash", type: "in", amount: 1, desc: "Omset tunai SMT", date: "2026-08-03", source: "Laporan harian", dailyReportId: "drX" },
    { id: "t_cash_SMT_2026-08-03", type: "in", amount: 1, desc: "Omset tunai SMT", date: "2026-08-03", source: "Laporan harian" },
  ];
  const ids = collectDailyReportCashTxIds(txs, report);
  ok(ids.includes("t_drX_cash") && ids.includes("t_cash_SMT_2026-08-03"), "14) collect menangkap legacy+kanonik");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
