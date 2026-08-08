// node lib/kasirHarian.smtIdempotency.test.mjs
// Skenario wajib: Samtaro omzet submit/retry idempotent + key stabil + no sRef dependency.
import {
  submitDailyReport,
  applyDailyReportMutation,
  makeDailyReportSubmissionId,
  makeSmtOmzetIdempotencyKey,
  findCommittedDailyReport,
  countSmtSubmissionArtifacts,
  userFacingDailyReportError,
  isUncertainDeliveryError,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { hydrateReportChannels } from "./reportChannels.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
const DATE = "2026-08-08";
const NOMINAL = 442456;

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("✓", msg); }
  else { failed++; console.error("✗", msg); }
}

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

const emptyState = () => ({
  wallets: baseWallets.map((w) => ({ ...w })),
  categories,
  transactions: [],
  dailyReports: [],
  reportChannels: hydrateReportChannels(null),
  businessId: BIZ,
  deletedTransactionIds: [],
  deletedDailyReportIds: [],
  deletedDailyReportSlots: [],
});

function smtPayload(submissionId, channels = { tunai: NOMINAL }) {
  return {
    channels,
    date: DATE,
    user: { id: "u_smt", name: "Kasir Samtaro", outlet: "SMT" },
    businessId: BIZ,
    submissionId,
    idempotencyKey: submissionId,
  };
}

function submitOnce(state, payload) {
  const built = submitDailyReport(state, payload);
  applyDailyReportMutation(state, {
    report: built.report,
    txs: built.idempotent ? [] : built.txs,
    removeIds: built.removeIds || [],
  });
  return built;
}

function cashTotalSmt(state) {
  return (state.transactions || [])
    .filter((t) => t.type === "in" && /laporan harian/i.test(t.source || "") && /SMT/.test(t.desc || ""))
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

// --- helpers: key stabil + pesan UI ---
{
  const a = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const b = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  ok(a === b, "1) makeSmtOmzetIdempotencyKey stabil antar panggilan");
  ok(a === `${BIZ}|SMT|${DATE}|omzet`, "1) format key = biz|SMT|date|omzet");
  ok(
    makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: "2026-08-09" }) !== a,
    "1) tanggal beda → key beda"
  );
  ok(
    userFacingDailyReportError(new ReferenceError("sRef is not defined")) !== "sRef is not defined",
    "6) pesan teknis sRef tidak ditampilkan ke user"
  );
  ok(
    /kirim ulang|gangguan/i.test(userFacingDailyReportError(new ReferenceError("sRef is not defined"))),
    "6) userFacing mengganti ReferenceError dengan pesan ramah"
  );
  ok(isUncertainDeliveryError(new Error("Failed to fetch")), "uncertain: Failed to fetch");
  ok(
    userFacingDailyReportError(new Error("timeout"), { uncertain: true })
      .includes("belum dapat dipastikan"),
    "UI uncertain message sesuai spesifikasi"
  );
}

// --- 1) Submit sekali → satu record ---
{
  const state = emptyState();
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const first = submitOnce(state, smtPayload(sid));
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1, "1) submit sekali: 1 report");
  ok(arts.cashCount === 1, "1) submit sekali: 1 cash");
  ok(first.report.total === NOMINAL, "1) nominal Rp442.456");
  ok(cashTotalSmt(state) === NOMINAL, "7) total cash = Rp442.456 (bukan 2×)");
}

// --- 2) Double submit cepat (key sama) → tetap satu ---
{
  const state = emptyState();
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const payload = smtPayload(sid);
  submitOnce(state, payload);
  const second = submitDailyReport(state, payload);
  ok(second.idempotent === true, "2) submit kedua idempotent");
  applyDailyReportMutation(state, {
    report: second.report,
    txs: second.idempotent ? [] : second.txs,
    removeIds: second.removeIds || [],
  });
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1, "2) double click: tetap 1 report");
  ok(arts.cashCount === 1, "2) double click: tetap 1 cash");
  ok(state.dailyReports[0].total === NOMINAL, "2/7) nominal tidak dijumlahkan");
}

// --- 3) Simulasi: tersimpan lokal, respons "timeout" → verify menemukan existing ---
{
  const state = emptyState();
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const first = submitOnce(state, smtPayload(sid));
  // cloudDoc = state setelah save (respons hilang di FE)
  const cloudDoc = JSON.parse(JSON.stringify(state));
  const verified = findCommittedDailyReport(cloudDoc, {
    reportId: first.report.id,
    submissionId: sid,
    idempotencyKey: sid,
    outlet: "SMT",
    date: DATE,
  });
  ok(!!verified, "3) verify menemukan record lama setelah timeout");
  ok(verified.id === first.report.id, "3) ID record sama");
  const retry = submitDailyReport(state, smtPayload(sid));
  ok(retry.idempotent === true, "3) retry setelah timeout → existing, bukan create");
  ok(retry.report.id === first.report.id, "3) retry mengembalikan report yang sama");
  applyDailyReportMutation(state, {
    report: retry.report,
    txs: retry.idempotent ? [] : retry.txs,
    removeIds: retry.removeIds || [],
  });
  ok(countSmtSubmissionArtifacts(state, DATE).reportCount === 1, "3) tetap 1 report");
  ok(cashTotalSmt(state) === NOMINAL, "3/7) nominal tetap Rp442.456");
}

// --- 4) Refresh: key diregenerasi stabil → tetap satu record ---
{
  const state = emptyState();
  const sid1 = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  submitOnce(state, smtPayload(sid1));
  // refresh = hilang ref sesi, key dihitung ulang
  const sid2 = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  ok(sid1 === sid2, "4) refresh menghasilkan idempotencyKey sama");
  const retry = submitDailyReport(state, smtPayload(sid2));
  ok(retry.idempotent === true, "4) refresh+retry idempotent");
  ok(countSmtSubmissionArtifacts(state, DATE).reportCount === 1, "4) tetap 1 report setelah refresh retry");
}

// --- 5) Coba kirim ulang berkali-kali ---
{
  const state = emptyState();
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  submitOnce(state, smtPayload(sid));
  for (let i = 0; i < 5; i++) {
    const r = submitDailyReport(state, smtPayload(sid));
    ok(r.idempotent === true, `5) retry #${i + 1} idempotent`);
    applyDailyReportMutation(state, {
      report: r.report,
      txs: r.idempotent ? [] : r.txs,
      removeIds: r.removeIds || [],
    });
  }
  const arts = countSmtSubmissionArtifacts(state, DATE);
  ok(arts.reportCount === 1, "5) 5× kirim ulang: 1 report");
  ok(arts.cashCount === 1, "5) 5× kirim ulang: 1 cash");
  ok(cashTotalSmt(state) === NOMINAL, "5/7) nominal tidak digandakan");
}

// --- 8) Outlet lain (KSM) tidak terpengaruh ---
{
  const state = emptyState();
  const smtSid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  submitOnce(state, smtPayload(smtSid));

  const ksmSid = makeDailyReportSubmissionId({
    businessId: BIZ, outlet: "KSM", date: DATE, userId: "u_ksm", nonce: "ksm1",
  });
  const ksm = submitDailyReport(state, {
    channels: { tunai: 100000 },
    date: DATE,
    user: { id: "u_ksm", name: "Kasir Kisamen", outlet: "KSM" },
    businessId: BIZ,
    submissionId: ksmSid,
    idempotencyKey: ksmSid,
  });
  applyDailyReportMutation(state, {
    report: ksm.report,
    txs: ksm.idempotent ? [] : ksm.txs,
    removeIds: ksm.removeIds || [],
  });

  const smtArts = countSmtSubmissionArtifacts(state, DATE);
  const ksmReports = state.dailyReports.filter((r) => r.outlet === "KSM" && r.date === DATE);
  ok(smtArts.reportCount === 1, "8) SMT tetap 1 report");
  ok(ksmReports.length === 1, "8) KSM punya report sendiri di tanggal sama");
  ok(ksmReports[0].total === 100000, "8) nominal KSM tidak berubah");
  ok(state.dailyReports.find((r) => r.outlet === "SMT").total === NOMINAL, "8) nominal SMT tetap");
  ok(smtSid !== ksmSid, "8) idempotency key beda antar outlet");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
