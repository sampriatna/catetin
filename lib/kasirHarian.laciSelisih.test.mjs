// node lib/kasirHarian.laciSelisih.test.mjs
// Settle ditolak jika laci tidak = modal 250rb + omset tunai; minta revisi kasir.
import {
  submitDailyReport,
  applyDailyReportMutation,
  verifyDailyReportAdmin,
  settleDailyReport,
  laciSettleCheck,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { hydrateReportChannels } from "./reportChannels.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("✓", msg); }
  else { failed++; console.error("✗", msg); }
}

const emptyState = (opening = LACI_FLOOR) => ({
  wallets: [
    { id: "w_laci_smt", opening, floor: LACI_FLOOR },
    { id: "w_kas_besar", opening: 0, floor: 0 },
    { id: "w_bca", opening: 0, floor: 0 },
    { id: "w_gofood", opening: 0, floor: 0 },
  ],
  categories: [
    { id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true },
    { id: "ci_qris_bca", name: "Penjualan QRIS BCA", type: "in", active: true },
    { id: "ci_gojek", name: "Penjualan Gojek", type: "in", active: true },
  ],
  transactions: [],
  dailyReports: [],
  reportChannels: hydrateReportChannels(null),
  businessId: BIZ,
});

function prepareVerified(state, tunai = 500000) {
  const built = submitDailyReport(state, {
    channels: { tunai },
    date: "2026-08-07",
    user: { id: "u_smt", name: "Kasir", outlet: "SMT" },
    businessId: BIZ,
    submissionId: `sid-${tunai}-${openingKey(state)}`,
  });
  applyDailyReportMutation(state, built);
  state.dailyReports[0] = verifyDailyReportAdmin(state, state.dailyReports[0].id, { id: "admin" });
  return state.dailyReports[0];
}
function openingKey(state) {
  return state.wallets.find((w) => w.id === "w_laci_smt")?.opening ?? 0;
}

// 1) Sehat: opening 250 + tunai → settle OK, sisa modal 250
{
  const state = emptyState(LACI_FLOOR);
  const report = prepareVerified(state, 500000);
  const chk = laciSettleCheck(state, report);
  ok(chk.ok === true, "1) laci cocok (250+tunai)");
  ok(chk.afterSettle === LACI_FLOOR, "1) setelah settle = 250");
  const settled = settleDailyReport(state, report.id, { id: "admin", role: "admin_keuangan" });
  ok(settled.idempotent === false && settled.report.status === "settled", "1) settle berhasil");
}

// 2) Modal sisa 246 (kurang 4rb) → settle DITOLAK + pesan revisi
{
  const state = emptyState(246000);
  const report = prepareVerified(state, 500000);
  const chk = laciSettleCheck(state, report);
  ok(chk.ok === false && chk.reason === "laci_under", "2) deteksi modal kurang (246)");
  ok(/revisi ke kasir/i.test(chk.message || ""), "2) pesan minta revisi kasir");
  ok(/250/.test(chk.revisionNoteSuggestion || ""), "2) saran catatan revisi ada modal 250");
  let rejected = false;
  try {
    settleDailyReport(state, report.id, { id: "admin" });
  } catch (e) {
    rejected = /selisih laci/i.test(e.message) && /revisi/i.test(e.message);
  }
  ok(rejected, "2) settle gagal karena selisih");
}

// 3) Omzet tunai dobel → settle DITOLAK (laci_over)
{
  const state = emptyState(LACI_FLOOR);
  const report = prepareVerified(state, 500000);
  state.transactions.push({
    id: "t_cash_dup",
    type: "in",
    amount: 500000,
    walletId: "w_laci_smt",
    desc: "Omset tunai SMT",
    date: "2026-08-07",
    source: "Laporan harian",
  });
  const chk = laciSettleCheck(state, report);
  ok(chk.ok === false && chk.reason === "laci_over", "3) deteksi omzet dobel");
  let rejected = false;
  try {
    settleDailyReport(state, report.id, { id: "admin" });
  } catch (e) {
    rejected = /selisih laci/i.test(e.message);
  }
  ok(rejected, "3) settle gagal saat omzet dobel");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
