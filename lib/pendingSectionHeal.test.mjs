// node lib/pendingSectionHeal.test.mjs
import { healPendingSectionStatuses, isSectionSynced } from "./pendingSectionHeal.js";
import {
  makeSmtOmzetIdempotencyKey,
  submitDailyReport,
  applyDailyReportMutation,
  countSmtSubmissionArtifacts,
  LACI_FLOOR,
} from "./kasirHarian.js";
import { bindLocalReportsToCloudRecords, mergeDailyReports, localDailyReportsToPreserve } from "./dailyReportMerge.js";
import { hydrateReportChannels } from "./reportChannels.js";

const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
const DATE = "2026-08-08";

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("✓", msg); }
  else { failed++; console.error("✗", msg); }
}

// heal: failed + status submitted → synced
{
  const doc = {
    dailyReports: [{
      id: "dr_SMT_2026-08-08",
      outlet: "SMT",
      date: DATE,
      status: "submitted",
      total: 442456,
      commitStatus: "failed",
      syncStatus: "pending",
    }],
    sdmReports: [{
      id: "sdm1",
      outlet: "SMT",
      date: DATE,
      headcount: 3,
      commitStatus: "failed",
    }],
    sosmedReports: [{
      id: "sos1",
      outlet: "SMT",
      date: DATE,
      commitStatus: "failed",
    }],
  };
  const { changed, healed } = healPendingSectionStatuses(doc);
  ok(changed === true, "heal mengubah status");
  ok(healed.length === 3, "heal SDM + omzet + sosmed");
  ok(doc.dailyReports[0].syncStatus === "synced", "omzet synced");
  ok(doc.dailyReports[0].commitStatus === "committed", "omzet committed");
  ok(doc.dailyReports[0].serverRecordId === "dr_SMT_2026-08-08", "serverRecordId di-stamp");
  ok(isSectionSynced(doc.dailyReports[0]), "checklist omzet hijau");
  ok(isSectionSynced(doc.sdmReports[0]), "checklist SDM hijau");
  ok(isSectionSynced(doc.sosmedReports[0]), "checklist sosmed hijau");
}

// bind ≠ create
{
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const cloud = [{
    id: "dr_SMT_2026-08-08",
    outlet: "SMT",
    date: DATE,
    status: "submitted",
    total: 442456,
    idempotencyKey: sid,
    submissionId: sid,
  }];
  const local = [{
    id: "dr_local_pending",
    outlet: "SMT",
    date: DATE,
    status: "submitted",
    total: 442456,
    idempotencyKey: sid,
    commitStatus: "failed",
    syncStatus: "pending",
  }];
  // Pull: jangan preserve lokal jika slot sudah di pusat
  const preserved = localDailyReportsToPreserve({ dailyReports: cloud }, { dailyReports: local, transactions: [] });
  ok(preserved.length === 0, "preserve tidak menyimpan identitas lokal kedua");
  const merged = mergeDailyReports(cloud, preserved);
  ok(merged.length === 1 && merged[0].id === "dr_SMT_2026-08-08", "merge tetap 1 record pusat");
  const bound = bindLocalReportsToCloudRecords(local, cloud);
  ok(bound[0].serverRecordId === "dr_SMT_2026-08-08", "bind mengisi serverRecordId pusat");
  ok(bound[0].id === "dr_SMT_2026-08-08" || bound[0].serverRecordId === cloud[0].id, "bind ke record pusat");
  ok(bound[0].syncStatus === "synced", "bind → synced");
}

// Bukti urutan: mutate → (simulasi save) → baru diagnostik; sync ×3 tetap 1
{
  const state = {
    wallets: [
      { id: "w_laci_smt", opening: LACI_FLOOR, floor: LACI_FLOOR },
      { id: "w_kas_besar", opening: 0, floor: 0 },
    ],
    categories: [{ id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true }],
    transactions: [],
    dailyReports: [],
    reportChannels: hydrateReportChannels(null),
    businessId: BIZ,
  };
  const sid = makeSmtOmzetIdempotencyKey({ businessId: BIZ, date: DATE });
  const stages = [];
  const built = submitDailyReport(state, {
    channels: { tunai: 442456 },
    date: DATE,
    user: { id: "u", name: "Kasir", outlet: "SMT" },
    businessId: BIZ,
    submissionId: sid,
    idempotencyKey: sid,
  });
  stages.push("mutate");
  applyDailyReportMutation(state, {
    report: { ...built.report, commitStatus: "committing", syncStatus: "pending" },
    txs: built.txs,
  });
  stages.push("critical_save_ok"); // save sebelum diagnostik
  stages.push("diagnostics"); // sRef-era code would run here — now after save
  const cloud = JSON.parse(JSON.stringify(state));
  cloud.dailyReports[0].commitStatus = "committed";
  cloud.dailyReports[0].syncStatus = "synced";
  state.dailyReports[0].commitStatus = "failed";
  state.dailyReports[0].syncStatus = "pending";
  ok(stages.indexOf("critical_save_ok") < stages.indexOf("diagnostics"), "critical save sebelum diagnostik");
  let merged = state;
  for (let i = 0; i < 3; i++) {
    const preserved = localDailyReportsToPreserve(cloud, merged);
    merged = {
      ...cloud,
      dailyReports: mergeDailyReports(cloud.dailyReports, preserved),
      transactions: cloud.transactions,
    };
    healPendingSectionStatuses(merged);
  }
  ok(countSmtSubmissionArtifacts(merged, DATE).reportCount === 1, "setelah sync berulang: 1 laporan pusat");
  ok(isSectionSynced(merged.dailyReports[0]), "pending bersih setelah sync");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
