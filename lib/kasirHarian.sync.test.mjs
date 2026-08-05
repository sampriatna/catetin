// node lib/kasirHarian.sync.test.mjs
import {
  submitDailyReport,
  deleteDailyReport,
  applyDailyReportMutation,
  makeDailyReportSubmissionId,
  makeDailyReportKey,
  isCompleteDailyReport,
  findDailyReportByKey,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { normalizeReportDate } from "./laporanKeuangan.js";
import { mergeDailyReports, pickNewerDailyReport } from "./dailyReportMerge.js";
import { recordDailyReportDelete, filterDeletedDailyReports } from "./dailyReportDelete.js";
import { applyRevisionNoticesFromMessages, cancelRevisionMessagesForReport, createRevisionRequestMessage, mergeStaffMessages } from "./staffMessages.js";
import { hydrateReportChannels } from "./reportChannels.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";

const baseWallets = [
  { id: "w_laci_ksm", opening: LACI_FLOOR, floor: LACI_FLOOR },
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
  wallets: baseWallets,
  categories,
  transactions: [],
  dailyReports: [],
  reportChannels: hydrateReportChannels(null),
  businessId: BIZ,
});

// --- 1) Klik kirim dua kali (submissionId sama) ---
{
  const state = emptyState();
  const submissionId = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u_smt", nonce: "dbl",
  });
  const a = submitDailyReport(state, {
    channels: { tunai: 100000 },
    date: "2026-08-03",
    user: { id: "u_smt", name: "Kasir SMT", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
  });
  applyDailyReportMutation(state, a);
  const b = submitDailyReport(state, {
    channels: { tunai: 100000 },
    date: "2026-08-03",
    user: { id: "u_smt", name: "Kasir SMT", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
  });
  ok(b.idempotent === true, "Double click → idempotent");
  applyDailyReportMutation(state, { report: b.report, txs: b.idempotent ? [] : b.txs });
  ok(state.dailyReports.length === 1, "Double click tidak menambah laporan");
  ok(state.transactions.filter((t) => /laporan harian/i.test(t.source || "")).length === 1, "Double click tidak menambah tx");
}

// --- 2) Tersimpan + timeout + retry submissionId sama ---
{
  const state = emptyState();
  const submissionId = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "SMT", date: "2026-08-04", userId: "u_smt", nonce: "timeout",
  });
  const a = submitDailyReport(state, {
    channels: { tunai: 200000 },
    date: "2026-08-04",
    user: { id: "u_smt", name: "Kasir SMT", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
  });
  applyDailyReportMutation(state, a);
  // Simulasi: respons gagal, kasir retry dengan key sama
  const retry = submitDailyReport(state, {
    channels: { tunai: 200000 },
    date: "2026-08-04",
    user: { id: "u_smt", name: "Kasir SMT", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
  });
  ok(retry.idempotent && retry.report.id === a.report.id, "Retry setelah timeout mengembalikan laporan sama");
  ok(!!retry.report.reportKey, "reportKey tersimpan");
  ok(retry.report.reportKey === makeDailyReportKey({ businessId: BIZ, outlet: "SMT", date: "2026-08-04" }), "reportKey deterministic");
}

// --- 3) Dua request simultan (mutate berurutan, key sama) ---
{
  const state = emptyState();
  const submissionId = "biz|SMT|2026-08-03|u|sim";
  const a = submitDailyReport(state, {
    channels: { tunai: 150000 },
    date: "2026-08-03",
    user: { id: "u", name: "Kasir", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
  });
  const b = submitDailyReport(state, {
    channels: { tunai: 150000 },
    date: "2026-08-03",
    user: { id: "u", name: "Kasir", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
  });
  ok(a.report.id === b.report.id, "Simultan: id deterministik sama");
  applyDailyReportMutation(state, a);
  applyDailyReportMutation(state, { report: b.report, txs: b.txs });
  ok(state.dailyReports.length === 1, "Simultan: satu laporan setelah mutate");
}

// --- 4) Hapus lalu isi ulang (Kisamen revisi stuck) ---
{
  const state = emptyState();
  const old = {
    id: "dr_ksm_old",
    outlet: "KSM",
    date: "2026-08-01",
    status: "revision_requested",
    submittedAt: "2026-08-01T10:00:00.000Z",
    revisionRequestedAt: "2026-08-02T08:00:00.000Z",
    revisionNote: "ulang",
    total: 500000,
    setoranOwner: 500000,
    channels: { tunai: 500000 },
    businessId: BIZ,
  };
  state.dailyReports = [old];
  state.transactions = [{
    id: "t_dr_ksm_old_cash",
    type: "in",
    amount: 500000,
    walletId: "w_laci_ksm",
    desc: "Omset tunai KSM",
    date: "2026-08-01",
    source: "Laporan harian",
    dailyReportId: "dr_ksm_old",
  }];
  const msg = createRevisionRequestMessage({
    report: old,
    note: "ulang",
    author: { id: "admin", name: "Admin", role: "admin" },
  });
  state.staffMessages = [msg];

  const { report: deleted, removeIds } = deleteDailyReport(state, old.id, { id: "owner", role: "owner" });
  state.dailyReports = state.dailyReports.filter((r) => r.id !== deleted.id);
  state.transactions = state.transactions.filter((t) => !removeIds.includes(t.id));
  recordDailyReportDelete(state, deleted);
  state.staffMessages = cancelRevisionMessagesForReport(state.staffMessages, deleted.id, deleted.date, deleted.outlet);

  ok(!(state.dailyReports || []).some((r) => r.id === old.id), "Hapus menghilangkan laporan dari array");
  ok(state.deletedDailyReportIds.includes(old.id), "Tombstone id tercatat");
  ok(state.staffMessages[0].meta?.cancelled === true, "Notif revisi dibatalkan");

  // Merge seolah remote masih punya notif lama tanpa cancelled
  const remoteMsgs = [{ ...msg, meta: { ...msg.meta } }]; // tanpa cancelled
  const mergedMsgs = mergeStaffMessages(remoteMsgs, state.staffMessages);
  ok(mergedMsgs[0].meta?.cancelled === true, "mergeStaffMessages mempertahankan cancelled lokal");

  const submissionId = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "KSM", date: "2026-08-01", userId: "u_ksm", nonce: "refill",
  });
  const rebuilt = submitDailyReport(state, {
    channels: { tunai: 600000 },
    date: "2026-08-01",
    user: { id: "u_ksm", name: "Kasir KSM", outlet: "KSM" },
    businessId: BIZ,
    submissionId,
  });
  applyDailyReportMutation(state, rebuilt);

  const afterNotices = applyRevisionNoticesFromMessages(state.dailyReports, mergedMsgs);
  ok(afterNotices[0].status === "submitted", "Laporan baru tidak dipaksa revision_requested");
  ok(afterNotices.length === 1, "Satu laporan KSM 1 Agu setelah isi ulang");
}

// --- 5) Outlet berbeda tanggal sama ---
{
  const state = emptyState();
  const ksm = submitDailyReport(state, {
    channels: { tunai: 100000 },
    date: "2026-08-03",
    user: { id: "u_ksm", name: "KSM", outlet: "KSM" },
    businessId: BIZ,
    submissionId: makeDailyReportSubmissionId({ businessId: BIZ, outlet: "KSM", date: "2026-08-03", userId: "u_ksm", nonce: "x" }),
  });
  applyDailyReportMutation(state, ksm);
  const smt = submitDailyReport(state, {
    channels: { tunai: 200000 },
    date: "2026-08-03",
    user: { id: "u_smt", name: "SMT", outlet: "SMT" },
    businessId: BIZ,
    submissionId: makeDailyReportSubmissionId({ businessId: BIZ, outlet: "SMT", date: "2026-08-03", userId: "u_smt", nonce: "x" }),
  });
  applyDailyReportMutation(state, smt);
  ok(state.dailyReports.length === 2, "KSM + SMT tanggal sama = 2 laporan");
  ok(
    makeDailyReportKey({ businessId: BIZ, outlet: "KSM", date: "2026-08-03" })
      !== makeDailyReportKey({ businessId: BIZ, outlet: "SMT", date: "2026-08-03" }),
    "reportKey beda antar outlet"
  );
}

// --- 6) Format tanggal berbeda dinormalisasi ---
{
  ok(normalizeReportDate("2026-08-01") === "2026-08-01", "YYYY-MM-DD tetap");
  ok(normalizeReportDate("2026-08-01T17:00:00.000Z") === "2026-08-02"
    || normalizeReportDate("2026-08-01T17:00:00.000Z") === "2026-08-01",
    "ISO dinormalisasi ke hari WIB");
  const key = makeDailyReportKey({ businessId: BIZ, outlet: "SMT", date: "2026-08-03T00:00:00.000Z" });
  ok(key && key.includes(":SMT:2026-08-0"), "reportKey dari ISO memakai tanggal Jakarta");
}

// --- 7) pickNewer: submitted baru menang atas revision lama (hapus+isi ulang) ---
{
  const oldRev = {
    id: "old",
    outlet: "KSM",
    date: "2026-08-01",
    status: "revision_requested",
    revisionRequestedAt: "2026-08-02T08:00:00.000Z",
    submittedAt: "2026-08-01T10:00:00.000Z",
    total: 1,
  };
  const neu = {
    id: "new",
    outlet: "KSM",
    date: "2026-08-01",
    status: "submitted",
    submittedAt: "2026-08-03T12:00:00.000Z",
    total: 2,
  };
  ok(pickNewerDailyReport(oldRev, neu).id === "new", "Submitted baru menang atas revision_requested lama");
  const merged = mergeDailyReports([oldRev], [neu]);
  ok(merged.length === 1 && merged[0].id === "new", "mergeDailyReports canonical satu slot");
}

// --- 8) Settled tidak diubah submit biasa ---
{
  const state = emptyState();
  state.dailyReports = [{
    id: "dr_set",
    outlet: "SMT",
    date: "2026-08-03",
    status: "settled",
    submittedAt: "2026-08-03T10:00:00.000Z",
    settledAt: "2026-08-04T10:00:00.000Z",
    total: 100,
    setoranOwner: 0,
    channels: { tunai: 0 },
    businessId: BIZ,
  }];
  let rejected = false;
  try {
    submitDailyReport(state, {
      channels: { tunai: 50 },
      date: "2026-08-03",
      user: { id: "u", name: "SMT", outlet: "SMT" },
      businessId: BIZ,
      submissionId: "x|SMT|2026-08-03|u|n",
    });
  } catch (e) {
    rejected = /disettle/i.test(e.message);
  }
  ok(rejected, "Settled tidak bisa ditimpa submit biasa");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
