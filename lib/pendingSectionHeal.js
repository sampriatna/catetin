// lib/pendingSectionHeal.js — pulihkan status checklist setelah sync aman (tanpa create baru)

const REPORT_OK = new Set(["submitted", "admin_verified", "settled", "revision_requested"]);

function healRow(row) {
  if (!row || typeof row !== "object") return { row, changed: false };
  const pendingish =
    row.commitStatus === "failed"
    || row.commitStatus === "committing"
    || row.commitStatus === "pending"
    || row.syncStatus === "pending"
    || row.syncStatus === "failed";
  if (!pendingish) return { row, changed: false };
  return {
    row: {
      ...row,
      serverRecordId: row.serverRecordId || row.id,
      syncStatus: "synced",
      commitStatus: "committed",
      committedAt: row.committedAt || new Date().toISOString(),
    },
    changed: true,
  };
}

/**
 * Setelah data pusat sudah punya isi lengkap, jangan biarkan commitStatus=failed
 * membuat checklist tetap merah. Tidak membuat identitas baru.
 */
export function healPendingSectionStatuses(doc) {
  if (!doc || typeof doc !== "object") return { changed: false, healed: [] };
  let changed = false;
  const healed = [];

  if (Array.isArray(doc.dailyReports)) {
    doc.dailyReports = doc.dailyReports.map((r) => {
      if (!r?.id || !REPORT_OK.has(r.status)) return r;
      const out = healRow(r);
      if (out.changed) {
        changed = true;
        healed.push({ kind: "omzet", id: r.id, outlet: r.outlet, date: r.date });
      }
      return out.row;
    });
  }

  if (Array.isArray(doc.sdmReports)) {
    doc.sdmReports = doc.sdmReports.map((r) => {
      if (!r?.id || r.headcount == null) return r;
      const out = healRow(r);
      if (out.changed) {
        changed = true;
        healed.push({ kind: "sdm", id: r.id, outlet: r.outlet, date: r.date });
      }
      return out.row;
    });
  }

  if (Array.isArray(doc.sosmedReports)) {
    doc.sosmedReports = doc.sosmedReports.map((r) => {
      if (!r?.id) return r;
      const out = healRow(r);
      if (out.changed) {
        changed = true;
        healed.push({ kind: "sosmed", id: r.id, outlet: r.outlet, date: r.date });
      }
      return out.row;
    });
  }

  return { changed, healed };
}

/** Apakah baris checklist sudah aman dianggap selesai di pusat. */
export function isSectionSynced(row) {
  if (!row) return false;
  if (row.syncStatus === "synced") return true;
  if (row.syncStatus === "pending" || row.syncStatus === "failed") return false;
  const st = row.commitStatus;
  if (st === "committing" || st === "failed" || st === "pending") return false;
  return true;
}
