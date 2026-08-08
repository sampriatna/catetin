// lib/dailyReportDelete.test.mjs
import { mergeDailyReports, pickNewerDailyReport } from "./dailyReportMerge.js";
import { recordDailyReportDelete, filterDeletedDailyReports, mergeDeletedDailyReportMeta } from "./dailyReportDelete.js";
import { countAppStateRecords, isDestructiveSave } from "./appStateGuards.js";

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("✓", msg); }
  else { failed++; console.error("✗", msg); }
}

const report = {
  id: "dr_old",
  outlet: "KBU",
  date: "2026-06-21",
  status: "submitted",
  submittedAt: "2026-06-21T20:00:00.000Z",
  total: 1000000,
};

const state = { dailyReports: [report], transactions: [] };
recordDailyReportDelete(state, report);
ok(state.deletedDailyReportIds?.includes("dr_old"), "record delete id");
ok(state.deletedDailyReportSlots?.length === 1, "record delete slot");

const filtered = filterDeletedDailyReports([report], state);
ok(filtered.length === 0, "filter hides deleted report");

const newer = {
  id: "dr_new",
  outlet: "KBU",
  date: "2026-06-21",
  status: "submitted",
  submittedAt: new Date(Date.now() + 60_000).toISOString(),
  total: 2000000,
};
ok(filterDeletedDailyReports([newer], state).length === 1, "new submit after delete kept");

const sameMs = {
  id: "dr_same_ms",
  outlet: "KBU",
  date: "2026-06-21",
  status: "submitted",
  submittedAt: state.deletedDailyReportSlots[0].deletedAt,
  total: 1500000,
};
ok(filterDeletedDailyReports([sameMs], state).length === 1, "resubmit same-ms as delete kept");
// Id kanonik slot sama dengan yang dihapus: izinkan jika submittedAt >= deletedAt (hapus→isi ulang)
ok(filterDeletedDailyReports([{ ...sameMs, id: "dr_old" }], state).length === 1, "canonical id resubmit after delete kept");
ok(
  filterDeletedDailyReports([{ ...report, submittedAt: "2026-06-21T10:00:00.000Z" }], state).length === 0,
  "stale same id before delete still blocked"
);

const remote = { dailyReports: [report], transactions: [{ id: "tx1", type: "in", amount: 1 }] };
const local = {
  dailyReports: [newer],
  transactions: [{ id: "tx2", type: "in", amount: 2 }],
  deletedDailyReportIds: state.deletedDailyReportIds,
  deletedDailyReportSlots: state.deletedDailyReportSlots,
};
const deleteMeta = mergeDeletedDailyReportMeta({}, local);
const filterReports = (arr) => filterDeletedDailyReports(arr, deleteMeta);
const merged = mergeDailyReports(remote.dailyReports, local.dailyReports, {
  filterDeletedDailyReports: filterReports,
});
ok(!merged.some((r) => r.id === "dr_old"), "merge drops resurrected deleted report");
ok(merged.some((r) => r.id === "dr_new"), "merge keeps new report after delete");

ok(
  pickNewerDailyReport(
    { id: "dr1", status: "settled", settledAt: "2026-06-22T10:00:00.000Z", total: 1 },
    { id: "dr1", status: "submitted", resubmittedAt: "2026-06-22T12:00:00.000Z", total: 2 }
  ).status === "settled",
  "same id settled beats stale submitted"
);

const destructive = isDestructiveSave(
  { dailyReports: [{ id: "a" }, { id: "b" }, { id: "c" }], transactions: [{ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }, { id: "t5" }] },
  { dailyReports: [{ id: "a" }, { id: "new_kasir" }], transactions: [{ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }, { id: "t5" }, { id: "t6" }] }
);
ok(!destructive.blocked, "kasir submit tidak diblok destructive save");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
