// lib/dailyReportDelete.js — tombstone hapus laporan omset (cegah muncul lagi saat sync)

const MAX_SLOTS = 200;
const MAX_IDS = 500;

/** Rekam hapus laporan agar merge awan tidak menghidupkan lagi. */
export function recordDailyReportDelete(state, report) {
  if (!state || !report?.id) return;
  const at = new Date().toISOString();
  const ids = new Set(state.deletedDailyReportIds || []);
  ids.add(report.id);
  state.deletedDailyReportIds = [...ids].slice(-MAX_IDS);

  if (report.outlet && report.date) {
    const slots = [...(state.deletedDailyReportSlots || [])];
    const key = `${report.outlet}|${report.date}`;
    const i = slots.findIndex((s) => `${s.outlet}|${s.date}` === key);
    const entry = {
      outlet: report.outlet,
      date: report.date,
      reportId: report.id,
      reportKey: report.reportKey || null,
      deletedAt: at,
    };
    if (i >= 0) slots[i] = entry;
    else slots.push(entry);
    state.deletedDailyReportSlots = slots.slice(-MAX_SLOTS);
  }
}

export function mergeDeletedDailyReportMeta(remote = {}, local = {}) {
  const ids = new Set([...(remote.deletedDailyReportIds || []), ...(local.deletedDailyReportIds || [])]);
  const slotMap = new Map();
  for (const s of [...(remote.deletedDailyReportSlots || []), ...(local.deletedDailyReportSlots || [])]) {
    if (!s?.outlet || !s?.date) continue;
    const key = `${s.outlet}|${s.date}`;
    const prev = slotMap.get(key);
    if (!prev || (s.deletedAt || "") >= (prev.deletedAt || "")) slotMap.set(key, s);
  }
  return {
    deletedDailyReportIds: [...ids].slice(-MAX_IDS),
    deletedDailyReportSlots: [...slotMap.values()].slice(-MAX_SLOTS),
  };
}

function reportActivityTime(r) {
  return r?.resubmittedAt || r?.submittedAt || r?.revisionRequestedAt || "";
}

/** Filter laporan yang sudah dihapus (kecuali kirim ulang baru setelah hapus). */
export function filterDeletedDailyReports(reports = [], meta = {}) {
  const deletedIds = new Set(meta.deletedDailyReportIds || []);
  const slots = new Map();
  for (const s of meta.deletedDailyReportSlots || []) {
    if (!s?.outlet || !s?.date) continue;
    slots.set(`${s.outlet}|${s.date}`, s);
  }
  return (reports || []).filter((r) => {
    if (!r?.id) return false;
    if (deletedIds.has(r.id)) return false;
    const slot = slots.get(`${r.outlet}|${r.date}`);
    if (!slot) return true;
    const activity = reportActivityTime(r);
    if (activity > (slot.deletedAt || "")) return true;
    return false;
  });
}
