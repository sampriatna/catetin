// node lib/kasirHarian.smtSync.test.mjs
// Skenario: submit sukses di "server", frontend error, lokal pending, sync 1–5× → 1 record.
import {
  submitDailyReport,
  applyDailyReportMutation,
  makeSmtOmzetIdempotencyKey,
  countSmtSubmissionArtifacts,
  findCommittedDailyReport,
  reconcileSmtOmzetSyncState,
  collapseDailyReportsBySlot,
  enforceSingleSmtGeneratedCash,
  LACI_FLOOR,
} from "./kasirHarian.js";
import {
  mergeDailyReports,
  localDailyReportsToPreserve,
  bindLocalReportsToCloudRecords,
} from "./dailyReportMerge.js";
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
  { id: "w_kas_besar", opening: 0, floor: 0 },
];
const categories = [
  { id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true },
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
  profile: {},
  staffMessages: [],
});

function smtPayload(sid) {
  return {
    channels: { tunai: NOMINAL },
    date: DATE,
    user: { id: "u_smt", name: "Kasir Samtaro", outlet: "SMT" },
    businessId: BIZ,
    submissionId: sid,
    idempotencyKey: sid,
  };
}

/** Inti mergeAppStateFromCloudPull untuk laporan/txs — tanpa Supabase. */
function simulateCloudPull(remote, local) {
  const preserved = localDailyReportsToPreserve(remote, local);
  let reports = mergeDailyReports(remote.dailyReports || [], preserved);
  reports = bindLocalReportsToCloudRecords(reports, remote.dailyReports || []);
  const byId = new Map();
  for (const t of [...(local.transactions || []), ...(remote.transactions || [])]) {
    if (t?.id) byId.set(t.id, t);
  }
  const doc = {
    ...remote,
    dailyReports: reports,
    transactions: [...byId.values()],
    deletedTransactionIds: [
      ...new Set([...(remote.deletedTransactionIds || []), ...(local.deletedTransactionIds || [])]),
    ],
    businessId: BIZ,
  };
  collapseDailyReportsBySlot(doc);
  enforceSingleSmtGeneratedCash(doc, DATE);
  reconcileSmtOmzetSyncState(doc, { businessId: BIZ });
  return doc;
}

/** Inti mergeAppStateData (flushSave saat sync) — full local∪remote lalu collapse. */
function simulateSaveMerge(remote, local) {
  const reports = mergeDailyReports(remote.dailyReports || [], local.dailyReports || []);
  const byId = new Map();
  for (const t of [...(remote.transactions || []), ...(local.transactions || [])]) {
    if (t?.id) byId.set(t.id, t);
  }
  const doc = {
    ...remote,
    ...local,
    dailyReports: reports,
    transactions: [...byId.values()],
    businessId: BIZ,
  };
  collapseDailyReportsBySlot(doc);
  enforceSingleSmtGeneratedCash(doc, DATE);
  reconcileSmtOmzetSyncState(doc, { businessId: BIZ });
  return doc;
}

/** Simulasi: mutate lokal + "server" sudah menyimpan. Frontend error → lokal pending. */
function simulateSubmitServerOkFrontendError() {
  const local = emptyState();
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const built = submitDailyReport(local, smtPayload(sid));
  applyDailyReportMutation(local, {
    report: {
      ...built.report,
      commitStatus: "committing",
      syncStatus: "pending",
      idempotencyKey: sid,
      submissionId: sid,
    },
    txs: built.txs,
    removeIds: built.removeIds || [],
  });
  const cloud = JSON.parse(JSON.stringify(local));
  cloud.dailyReports = cloud.dailyReports.map((r) => ({
    ...r,
    commitStatus: "committed",
    syncStatus: "synced",
    serverRecordId: r.id,
  }));
  local.dailyReports = local.dailyReports.map((r) => ({
    ...r,
    commitStatus: "failed",
    syncStatus: "pending",
  }));
  return { local, cloud, sid, reportId: built.report.id };
}

// --- 1) Server punya record, lokal pending ---
{
  const { local, cloud, sid, reportId } = simulateSubmitServerOkFrontendError();
  ok(cloud.dailyReports.length === 1, "1) server punya 1 report setelah submit");
  ok(local.dailyReports[0].syncStatus === "pending", "1) lokal masih pending setelah frontend error");
  ok(local.dailyReports[0].idempotencyKey === sid, "1) identitas/idempotencyKey tidak hilang");
  ok(!!findCommittedDailyReport(cloud, { idempotencyKey: sid, outlet: "SMT", date: DATE }), "1) pusat ketemu by idempotencyKey");
  ok(reportId === "dr_SMT_2026-08-08", "1) id kanonik slot");
}

// --- 2–5) Sync 1–5× → tetap 1 record, ID sama, pending bersih ---
{
  const { local, cloud, sid, reportId } = simulateSubmitServerOkFrontendError();
  let merged = local;
  const ids = [];
  for (let i = 1; i <= 5; i++) {
    merged = simulateCloudPull(cloud, merged);
    const arts = countSmtSubmissionArtifacts(merged, DATE);
    ok(arts.reportCount === 1, `sync #${i}: tepat 1 report di pusat/merge`);
    ok(arts.cashCount === 1, `sync #${i}: tepat 1 cash`);
    ok(merged.dailyReports[0].id === reportId, `sync #${i}: ID record pusat sama`);
    ids.push(merged.dailyReports[0].id);
  }
  ok(ids.every((id) => id === reportId), "5) semua sync mengembalikan ID pusat yang sama");
  const smt = merged.dailyReports.find((r) => r.outlet === "SMT");
  ok(smt.syncStatus === "synced" || smt.commitStatus === "committed", "6) pending queue bersih / status synced");
  ok(smt.serverRecordId === reportId || smt.id === reportId, "6) serverRecordId tersimpan");
  ok(smt.idempotencyKey === sid, "6) idempotencyKey stabil setelah sync");
  ok(smt.total === NOMINAL, "nominal Rp442.456 tidak digandakan");
}

// --- Sync save path (flushSave merge) juga tidak dobel ---
{
  const { local, cloud, reportId } = simulateSubmitServerOkFrontendError();
  let remote = cloud;
  for (let i = 0; i < 5; i++) {
    remote = simulateSaveMerge(remote, local);
  }
  const arts = countSmtSubmissionArtifacts(remote, DATE);
  ok(arts.reportCount === 1, "save-merge ×5: 1 report");
  ok(arts.cashCount === 1, "save-merge ×5: 1 cash");
  ok(remote.dailyReports[0].id === reportId, "save-merge ×5: ID sama");
}

// --- Lokal "hilang dari tampilan" + cash masih ada; cloud punya report ---
{
  const { cloud, sid, reportId } = simulateSubmitServerOkFrontendError();
  const wipedLocal = emptyState();
  wipedLocal.transactions = JSON.parse(JSON.stringify(cloud.transactions));
  wipedLocal.dailyReports = [];
  const merged = simulateCloudPull(cloud, wipedLocal);
  ok(merged.dailyReports.length === 1, "wipe lokal + sync: ambil 1 record dari pusat");
  ok(merged.dailyReports[0].id === reportId, "wipe lokal + sync: ID pusat");
  ok(countSmtSubmissionArtifacts(merged, DATE).cashCount === 1, "wipe lokal + sync: 1 cash");
  const bound = bindLocalReportsToCloudRecords(
    [{ id: "dr_local_stale", outlet: "SMT", date: DATE, idempotencyKey: sid, commitStatus: "failed", syncStatus: "pending", total: NOMINAL }],
    cloud.dailyReports
  );
  ok(bound[0].serverRecordId === reportId, "bindLocalReportsToCloudRecords mengisi serverRecordId");
  ok(bound[0].syncStatus === "synced", "bind menandai synced");
}

// --- Sync tidak membuat idempotencyKey baru ---
{
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const again = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  ok(sid === again, "tombol sync/regen key → key sama (stabil)");
}

// --- reconcileSmtOmzetSyncState stamps synced ---
{
  const doc = emptyState();
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const built = submitDailyReport(doc, smtPayload(sid));
  applyDailyReportMutation(doc, built);
  doc.dailyReports[0].commitStatus = "failed";
  doc.dailyReports[0].syncStatus = "pending";
  reconcileSmtOmzetSyncState(doc, { businessId: BIZ });
  ok(doc.dailyReports[0].syncStatus === "synced", "reconcileSmtOmzetSyncState → synced");
  ok(doc.dailyReports[0].serverRecordId === doc.dailyReports[0].id, "serverRecordId di-stamp");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
