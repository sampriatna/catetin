// node lib/kasirHarian.smtOnce.test.mjs
// Regression KHUSUS SMT: 1 submit → 1 report + 1 set generated cash (Kasus B guard).
import {
  submitDailyReport,
  applyDailyReportMutation,
  makeDailyReportSubmissionId,
  makeDailyReportKey,
  canonicalLaporanCashTxId,
  enforceSingleSmtGeneratedCash,
  countSmtSubmissionArtifacts,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { hydrateReportChannels } from "./reportChannels.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
const DATE = "2026-08-07";

const baseWallets = [
  { id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR },
  { id: "w_laci_ksm", opening: LACI_FLOOR, floor: LACI_FLOOR },
  { id: "w_laci_kbu", opening: LACI_FLOOR, floor: LACI_FLOOR },
  { id: "w_kas_besar", opening: 0, floor: 0 },
];
const categories = [
  { id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true },
  { id: "ci_qris_bca", name: "Penjualan QRIS BCA", type: "in", active: true },
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
    idempotencyKey: submissionId,
  };
}

/** Simulasi SATU pemanggilan handleSubmit (domain only — tanpa double UI). */
function submitSingleReportOnce(state, payload) {
  const built = submitDailyReport(state, payload);
  applyDailyReportMutation(state, {
    report: built.report,
    txs: built.idempotent ? [] : built.txs,
    removeIds: built.removeIds || [],
  });
  return built;
}

const canon = canonicalLaporanCashTxId({ businessId: BIZ, outlet: "SMT", date: DATE });

// --- A) Satu submit → 1 report + 1 generated cash ---
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "SMT", date: DATE, userId: "u_smt", nonce: "once",
  });
  submitSingleReportOnce(state, smtPayload(DATE, sid));
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1, "A) submit sekali: dailyReports === 1");
  ok(arts.cashCount === 1, "A) submit sekali: generated cash === 1");
  ok(arts.cashIds[0] === canon, "A) cash id kanonik t_cash_SMT_<DATE>");
  ok(
    !state.transactions.some((t) => t.id?.startsWith("t_dr_") && /laporan harian/i.test(t.source || "")),
    "A) tidak ada legacy t_dr_*_cash"
  );
}

// --- B) Payload identik dua kali → tetap 1 + 1 ---
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "SMT", date: DATE, userId: "u_smt", nonce: "ident",
  });
  const payload = smtPayload(DATE, sid);
  submitSingleReportOnce(state, payload);
  const second = submitDailyReport(state, payload);
  ok(second.idempotent === true, "B) submit kedua idempotent");
  applyDailyReportMutation(state, {
    report: second.report,
    txs: second.idempotent ? [] : second.txs,
    removeIds: second.removeIds || [],
  });
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1, "B) dua request identik: report === 1");
  ok(arts.cashCount === 1, "B) dua request identik: cash === 1");
}

// --- C) Kasus B historis: legacy + kanonik hidup berdampingan → enforce → 1 ---
{
  const state = emptyState();
  const reportKey = makeDailyReportKey({ businessId: BIZ, outlet: "SMT", date: DATE });
  state.dailyReports = [{
    id: "dr_smt_live",
    outlet: "SMT",
    date: DATE,
    status: "submitted",
    submittedAt: `${DATE}T10:00:00.000Z`,
    total: 500000,
    setoranOwner: 500000,
    channels: { tunai: 500000 },
    businessId: BIZ,
    reportKey,
  }];
  state.transactions = [
    {
      id: "t_dr_smt_live_cash",
      type: "in",
      amount: 500000,
      walletId: "w_laci_smt",
      desc: "Omset tunai SMT",
      date: DATE,
      source: "Laporan harian",
      dailyReportId: "dr_smt_live",
    },
    {
      id: canon,
      type: "in",
      amount: 500000,
      walletId: "w_laci_smt",
      desc: "Omset tunai SMT",
      date: DATE,
      source: "Laporan harian",
      dailyReportId: "dr_smt_live",
    },
    {
      id: "t_manual_smt",
      type: "out",
      amount: 12000,
      walletId: "w_laci_smt",
      desc: "Beli gas",
      date: DATE,
      source: "Manual",
    },
  ];
  ok(countSmtSubmissionArtifacts(state, DATE).cashCount === 2, "C) setup: Kasus B (1 report, 2 cash)");
  const en = enforceSingleSmtGeneratedCash(state, DATE);
  ok(en.changed === true, "C) enforce mengubah state");
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1 && arts.cashCount === 1, "C) setelah enforce: 1 report + 1 cash");
  ok(arts.cashIds[0] === canon, "C) survivor = id kanonik");
  ok(state.transactions.some((t) => t.id === "t_manual_smt"), "C) tx manual tidak disentuh");
  ok((state.deletedTransactionIds || []).includes("t_dr_smt_live_cash"), "C) legacy di-tombstone");
}

// --- D) applyMutation SMT membersihkan legacy+canon dalam satu mutate ---
{
  const state = emptyState();
  const sid = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "SMT", date: DATE, userId: "u_smt", nonce: "heal",
  });
  // Pre-seed legacy cash (simulasi state production kotor sebelum submit/retry)
  state.transactions.push({
    id: "t_dr_ghost_cash",
    type: "in",
    amount: 500000,
    walletId: "w_laci_smt",
    desc: "Omset tunai SMT",
    date: DATE,
    source: "Laporan harian",
    dailyReportId: "dr_ghost",
  });
  submitSingleReportOnce(state, smtPayload(DATE, sid));
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1, "D) apply SMT: 1 report");
  ok(arts.cashCount === 1, "D) apply SMT: legacy digabung → 1 cash");
  ok(arts.cashIds[0] === canon, "D) hasil akhir kanonik");
}

// --- E) Outlet lain (KBU) tidak kena enforce SMT ---
{
  const state = emptyState();
  const kbuDate = DATE;
  state.dailyReports = [{
    id: "dr_kbu",
    outlet: "KBU",
    date: kbuDate,
    status: "submitted",
    total: 100000,
    setoranOwner: 100000,
    channels: { tunai: 100000 },
    businessId: BIZ,
  }];
  state.transactions = [
    {
      id: "t_dr_kbu_a_cash",
      type: "in",
      amount: 100000,
      walletId: "w_laci_kbu",
      desc: "Omset tunai KBU",
      date: kbuDate,
      source: "Laporan harian",
    },
    {
      id: "t_dr_kbu_b_cash",
      type: "in",
      amount: 100000,
      walletId: "w_laci_kbu",
      desc: "Omset tunai KBU",
      date: kbuDate,
      source: "Laporan harian",
    },
  ];
  const before = state.transactions.filter((t) => /Omset tunai KBU/.test(t.desc || "")).length;
  enforceSingleSmtGeneratedCash(state, kbuDate);
  const after = state.transactions.filter((t) => /Omset tunai KBU/.test(t.desc || "")).length;
  ok(before === 2 && after === 2, "E) enforce SMT tidak mengubah cash KBU");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
