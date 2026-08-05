// node lib/kasirHarian.idempotency.test.mjs
import {
  submitDailyReport,
  settleDailyReport,
  verifyDailyReportAdmin,
  makeDailyReportSubmissionId,
  reportIdFromSubmissionId,
  applyDailyReportMutation,
  reconcileOrphanLaporanCashTxs,
  isCompleteDailyReport,
  findDailyReportInSlot,
  dailyReportSlotKey,
  walletBalance,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { mergeDailyReports, localDailyReportsToPreserve } from "./dailyReportMerge.js";
import { hydrateReportChannels } from "./reportChannels.js";
import { localISO } from "./laporanKeuangan.js";

const baseWallets = [
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

/** Simulasi inti mergeAppStateFromCloudPull untuk laporan (tanpa Supabase). */
function mergeReportsOnCloudPull(remote, local) {
  const preserved = localDailyReportsToPreserve(remote, local);
  return mergeDailyReports(remote.dailyReports || [], preserved);
}

const emptyState = () => ({
  wallets: baseWallets,
  categories,
  transactions: [],
  dailyReports: [],
  reportChannels: hydrateReportChannels(null),
});

const payload = (overrides = {}) => ({
  channels: { tunai: 500000, edc_bca: 100000, gofood: 50000 },
  date: "2026-08-01",
  user: { id: "u_ksm", name: "Kasir Kisamen", outlet: "KSM" },
  ...overrides,
});

// --- 1) Double click / request ulang dengan idempotency_key sama ---
{
  const state = emptyState();
  const submissionId = makeDailyReportSubmissionId({
    outlet: "KSM",
    date: "2026-08-01",
    userId: "u_ksm",
    nonce: "fixed-nonce-1",
  });
  const a = submitDailyReport(state, payload({ submissionId }));
  applyDailyReportMutation(state, a);
  const b = submitDailyReport(state, payload({ submissionId }));
  ok(b.idempotent === true, "Request ulang idempotent");
  ok(b.report.id === a.report.id, "Report id sama pada retry");
  ok(reportIdFromSubmissionId(submissionId) === a.report.id, "Report id deterministik dari submissionId");

  applyDailyReportMutation(state, { report: b.report, txs: b.idempotent ? [] : b.txs });
  const cashTxs = state.transactions.filter((t) => /laporan harian/i.test(t.source || ""));
  ok(cashTxs.length === 1, "Double submit tidak menambah tx laci");
  ok(state.dailyReports.length === 1, "Hanya satu laporan KSM 1 Agu");
}

// --- 2) Double click tanpa menunggu state (simulasi dua panggilan berurutan, key sama) ---
{
  const state = emptyState();
  const submissionId = "KSM|2026-08-02|u_ksm|dbl";
  const a = submitDailyReport(state, payload({ date: "2026-08-02", submissionId }));
  const b = submitDailyReport(state, payload({ date: "2026-08-02", submissionId }));
  ok(a.report.id === b.report.id, "Tanpa state: id laporan tetap sama (deterministik)");
  applyDailyReportMutation(state, a);
  applyDailyReportMutation(state, { report: b.report, txs: b.txs });
  ok(state.transactions.filter((t) => t.id === `t_${a.report.id}_cash`).length === 1, "Mutate kedua tidak dobelkan tx");
  ok(state.dailyReports.length === 1, "Mutate kedua tidak dobelkan laporan");
}

// --- 3) Cloud pull: tx lokal ada, laporan belum di awan → laporan tetap ada ---
{
  const submissionId = "KSM|2026-08-01|u_ksm|cloud";
  const local = emptyState();
  const built = submitDailyReport(local, payload({ submissionId }));
  applyDailyReportMutation(local, built);

  const remote = emptyState();
  ok(localDailyReportsToPreserve(remote, local).length === 1, "localDailyReportsToPreserve menangkap laporan lokal");

  const mergedReports = mergeReportsOnCloudPull(remote, local);
  ok(
    mergedReports.some((r) => r.outlet === "KSM" && r.date === "2026-08-01"),
    "Cloud pull tidak menghapus laporan lokal yang punya tx"
  );
  const bal = walletBalance("w_laci_ksm", local.wallets, local.transactions);
  ok(bal === LACI_FLOOR + 500000, "Saldo laci lokal tetap setelah pull logic");
}

// --- 4) Bug Kisamen: laporan hilang, user kirim lagi → dedupe cash ---
{
  const state = emptyState();
  state.transactions.push({
    id: "t_dr_old_cash",
    type: "in",
    amount: 500000,
    walletId: "w_laci_ksm",
    desc: "Omset tunai KSM",
    date: "2026-08-01",
    source: "Laporan harian",
    dailyReportId: "dr_old",
  });
  const built = submitDailyReport(state, payload({
    submissionId: "KSM|2026-08-01|u_ksm|retry2",
  }));
  applyDailyReportMutation(state, built);
  const fixed = reconcileOrphanLaporanCashTxs(state);
  ok(fixed.changed, "reconcile mendeteksi cash dobel");
  ok(
    fixed.transactions.filter((t) => /laporan harian/i.test(t.source || "") && t.date === "2026-08-01").length === 1,
    "Hanya satu omset tunai KSM 1 Agu setelah reconcile"
  );
  ok(
    fixed.transactions.some((t) => t.id === `t_${built.report.id}_cash`),
    "Tx kanonik laporan surviving yang dipertahankan"
  );
}

// --- 5) Settled dikirim ulang → ditolak, tidak buat tx baru ---
{
  const state = emptyState();
  const built = submitDailyReport(state, payload({
    date: "2026-08-01",
    submissionId: "KSM|2026-08-01|u_ksm|settled",
  }));
  applyDailyReportMutation(state, built);
  const verified = verifyDailyReportAdmin(state, built.report.id, { id: "admin" });
  state.dailyReports = [verified];
  const settled = settleDailyReport(state, built.report.id, { id: "admin" });
  applyDailyReportMutation(state, settled);

  let rejected = false;
  try {
    submitDailyReport(state, payload({
      date: "2026-08-01",
      submissionId: "KSM|2026-08-01|u_ksm|settled-again",
    }));
  } catch (e) {
    rejected = /sudah disettle/i.test(e.message);
  }
  ok(rejected, "Submit ulang laporan settled ditolak");

  const again = settleDailyReport(state, built.report.id, { id: "admin" });
  ok(again.idempotent === true && again.txs.length === 0, "Settle ulang idempotent tanpa tx baru");
}

// --- 6) Timezone: tanggal laporan dari form, bukan UTC slice ---
{
  const wibNight = new Date("2026-08-01T15:00:00.000Z");
  const localDate = localISO(wibNight);
  const state = emptyState();
  const built = submitDailyReport(state, payload({
    date: "2026-08-01",
    submissionId: "KSM|2026-08-01|u_ksm|tz",
  }));
  ok(built.report.date === "2026-08-01", "Tanggal laporan mengikuti input form (bukan UTC drift)");
  ok(built.txs[0]?.date === "2026-08-01", "Tx tunai memakai tanggal laporan form");
  ok(typeof localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(localDate), "localISO menghasilkan YYYY-MM-DD");
}

// --- 7) Refresh setelah submit: preserve + merge tidak dobel ---
{
  const local = emptyState();
  const sid = "KSM|2026-08-02|u_ksm|refresh";
  const built = submitDailyReport(local, payload({ date: "2026-08-02", submissionId: sid }));
  applyDailyReportMutation(local, built);

  const afterPull = mergeReportsOnCloudPull(emptyState(), local);
  ok(afterPull.length === 1, "Refresh: laporan tetap ada");

  const afterSavePull = mergeReportsOnCloudPull(
    { dailyReports: afterPull, transactions: local.transactions },
    local
  );
  ok(afterSavePull.length === 1, "Refresh setelah save: laporan tetap 1");
}

// --- 8) applyDailyReportMutation atomik ---
{
  const doc = emptyState();
  const built = submitDailyReport(doc, payload({
    date: "2026-08-02",
    submissionId: "KSM|2026-08-02|u_ksm|atomic",
  }));
  applyDailyReportMutation(doc, built);
  ok(doc.dailyReports[0]?.id === built.report.id, "Laporan tersimpan");
  ok(doc.transactions[0]?.dailyReportId === built.report.id, "Tx terhubung report_id");
  ok(!!doc.dailyReports[0] && !!doc.transactions[0], "Tidak ada keadaan tx tanpa laporan dari helper");
}

// --- 9) Bug lama: cloud-only reports (tanpa preserve) menghilangkan laporan ---
{
  const local = emptyState();
  const built = submitDailyReport(local, payload({
    submissionId: "KSM|2026-08-01|u_ksm|regress",
  }));
  applyDailyReportMutation(local, built);
  const brokenOldBehavior = mergeDailyReports([], []);
  ok(brokenOldBehavior.length === 0, "Regresi: merge cloud-only kosong menghapus laporan");
  const fixedBehavior = mergeReportsOnCloudPull({ dailyReports: [], transactions: [] }, local);
  ok(fixedBehavior.length === 1, "Perbaikan: preserve local mengembalikan laporan");
}

// --- 10) Outlet berbeda tanggal sama BUKAN duplicate ---
{
  const state = emptyState();
  state.wallets.push({ id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR });
  const ksm = submitDailyReport(state, payload({
    date: "2026-08-01",
    submissionId: makeDailyReportSubmissionId({
      businessId: "biz1", outlet: "KSM", date: "2026-08-01", userId: "u_ksm", nonce: "a",
    }),
  }));
  applyDailyReportMutation(state, ksm);
  const smt = submitDailyReport(state, {
    channels: { tunai: 400000, edc_bca: 50000, gofood: 0 },
    date: "2026-08-01",
    user: { id: "u_smt", name: "Kasir Samtaro", outlet: "SMT" },
    submissionId: makeDailyReportSubmissionId({
      businessId: "biz1", outlet: "SMT", date: "2026-08-01", userId: "u_smt", nonce: "a",
    }),
  });
  applyDailyReportMutation(state, smt);
  ok(state.dailyReports.length === 2, "KSM + SMT 1 Agu: dua laporan valid");
  ok(
    findDailyReportInSlot(state.dailyReports, "KSM", "2026-08-01")?.id === ksm.report.id,
    "Slot KSM|2026-08-01 terisi KSM"
  );
  ok(
    findDailyReportInSlot(state.dailyReports, "SMT", "2026-08-01")?.id === smt.report.id,
    "Slot SMT|2026-08-01 terisi SMT"
  );
  ok(
    makeDailyReportSubmissionId({ businessId: "biz1", outlet: "KSM", date: "2026-08-01", userId: "u", nonce: "n" })
      !== makeDailyReportSubmissionId({ businessId: "biz1", outlet: "SMT", date: "2026-08-01", userId: "u", nonce: "n" }),
    "Idempotency key beda antar outlet"
  );
}

// --- 11) Record incomplete tidak mengunci submit ulang (Kisamen/Samtaro) ---
{
  const state = emptyState();
  // Stale: ada laporan submitted tanpa tx tunai padahal setoran > 0
  state.dailyReports.push({
    id: "dr_stale_ksm",
    outlet: "KSM",
    date: "2026-08-01",
    status: "submitted",
    submittedAt: "2026-08-01T10:00:00.000Z",
    total: 500000,
    setoranOwner: 500000,
    channels: { tunai: 500000 },
    submissionId: "stale-key",
  });
  ok(!isCompleteDailyReport(state.dailyReports[0], state.transactions), "Stale KSM tanpa cash tx = incomplete");
  const rebuilt = submitDailyReport(state, payload({
    date: "2026-08-01",
    submissionId: makeDailyReportSubmissionId({
      businessId: "biz1", outlet: "KSM", date: "2026-08-01", userId: "u_ksm", nonce: "retry",
    }),
  }));
  ok(rebuilt.idempotent !== true, "Incomplete tidak dianggap idempotent sukses");
  applyDailyReportMutation(state, rebuilt);
  ok(isCompleteDailyReport(rebuilt.report, [...state.transactions, ...rebuilt.txs]), "Laporan rebuild lengkap");
  ok(
    state.dailyReports.filter((r) => r.outlet === "KSM" && r.date === "2026-08-01").length === 1,
    "Tetap satu slot KSM 1 Agu setelah replace"
  );
}

// --- 12) Samtaro 3 Agu: incomplete boleh rebuild; complete ditolak ---
{
  const state = emptyState();
  state.wallets.push({ id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR });
  state.dailyReports.push({
    id: "dr_stale_smt",
    outlet: "SMT",
    date: "2026-08-03",
    status: "submitting",
    total: 100000,
    setoranOwner: 100000,
    channels: { tunai: 100000 },
  });
  ok(!isCompleteDailyReport(state.dailyReports[0], []), "Status submitting = incomplete");
  const okSubmit = submitDailyReport(state, {
    channels: { tunai: 300000, edc_bca: 0, gofood: 0 },
    date: "2026-08-03",
    user: { id: "u_smt", name: "Kasir Samtaro", outlet: "SMT" },
    submissionId: "biz1|SMT|2026-08-03|u_smt|n1",
  });
  applyDailyReportMutation(state, okSubmit);
  ok(okSubmit.report.outlet === "SMT" && okSubmit.report.date === "2026-08-03", "SMT 3 Agu tersimpan");

  let rejected = false;
  try {
    submitDailyReport(state, {
      channels: { tunai: 999, edc_bca: 0, gofood: 0 },
      date: "2026-08-03",
      user: { id: "u_smt", name: "Kasir Samtaro", outlet: "SMT" },
      submissionId: "biz1|SMT|2026-08-03|u_smt|n2",
    });
  } catch (e) {
    rejected = /sudah dikirim/i.test(e.message) && /SMT/.test(e.message);
  }
  ok(rejected, "Laporan SMT lengkap menolak duplicate dengan pesan outlet");
  ok(dailyReportSlotKey("SMT", "2026-08-03") === "SMT|2026-08-03", "Slot key outlet|tanggal");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
