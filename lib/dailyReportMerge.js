// lib/dailyReportMerge.js — merge laporan omset antar perangkat (tanpa dependensi Supabase)

const REPORT_STATUS_RANK = {
  settled: 5,
  admin_verified: 4,
  submitted: 3,
  revision_requested: 2,
};

function reportActivityTime(r) {
  return r.resubmittedAt || r.revisionRequestedAt || r.adminVerifiedAt || r.submittedAt || r.settledAt || "";
}

/** Laporan settled selalu menang atas submitted — kecuali ada laporan aktif lebih baru setelah settle (koreksi hari sama). */
export function pickNewerDailyReport(a, b) {
  if (!a) return b;
  if (!b) return a;

  // Satu id — settled tidak boleh kalah dari snapshot stale di HP lain
  if (a.id === b.id) {
    if (a.status === "settled" || b.status === "settled") {
      return a.status === "settled" ? a : b;
    }
  }

  const aAfterSettle =
    a.status !== "settled"
    && b.status === "settled"
    && reportActivityTime(a) > (b.settledAt || b.submittedAt || "");
  const bAfterSettle =
    b.status !== "settled"
    && a.status === "settled"
    && reportActivityTime(b) > (a.settledAt || a.submittedAt || "");
  if (aAfterSettle) return a;
  if (bAfterSettle) return b;

  // Kasir sudah kirim revisi — submitted/resubmitted menang atas revision_requested lama
  if (a.status === "revision_requested" && b.status === "submitted" && b.resubmittedAt) return b;
  if (b.status === "revision_requested" && a.status === "submitted" && a.resubmittedAt) return a;

  // Permintaan revisi admin menang atas submitted/admin_verified stale (merge multi-perangkat)
  if (a.status === "revision_requested" && ["submitted", "admin_verified"].includes(b.status)) {
    const revAt = a.revisionRequestedAt || reportActivityTime(a);
    if (!revAt || revAt >= reportActivityTime(b)) return a;
  }
  if (b.status === "revision_requested" && ["submitted", "admin_verified"].includes(a.status)) {
    const revAt = b.revisionRequestedAt || reportActivityTime(b);
    if (!revAt || revAt >= reportActivityTime(a)) return b;
  }

  const ra = REPORT_STATUS_RANK[a.status] || 0;
  const rb = REPORT_STATUS_RANK[b.status] || 0;
  if (ra !== rb) return ra > rb ? a : b;

  const totalA = Math.round(Number(a.total) || 0);
  const totalB = Math.round(Number(b.total) || 0);
  if (totalA !== totalB) return totalA > totalB ? a : b;

  const ta = reportActivityTime(a);
  const tb = reportActivityTime(b);
  return ta >= tb ? a : b;
}

/** Gabung dailyReports — status settled menang; satu laporan per outlet+tanggal. */
export function mergeDailyReports(remoteArr = [], localArr = [], deleteMeta = null) {
  const filter = deleteMeta?.filterDeletedDailyReports;
  const remote = filter ? filter(remoteArr) : remoteArr;
  const local = filter ? filter(localArr) : localArr;
  const byId = new Map();
  for (const item of [...(local || []), ...(remote || [])]) {
    if (item?.id == null) continue;
    const prev = byId.get(item.id);
    byId.set(item.id, prev ? pickNewerDailyReport(prev, item) : item);
  }
  const byDay = new Map();
  for (const r of byId.values()) {
    if (!r?.outlet || !r?.date) continue;
    const key = `${r.outlet}|${r.date}`;
    const prev = byDay.get(key);
    byDay.set(key, prev ? pickNewerDailyReport(prev, r) : r);
  }
  return [...byDay.values()];
}

/**
 * Laporan lokal yang belum ada di awan — tetap dipertahankan jika:
 * - punya transaksi lokal terikat, atau
 * - slot outlet|tanggal belum ada di awan.
 * Mencegah: notifikasi sukses + tx laci masuk, tapi laporan hilang saat cloud pull.
 */
export function localDailyReportsToPreserve(remote = {}, local = {}) {
  const remoteReports = remote.dailyReports || [];
  const localReports = local.dailyReports || [];
  const localTxs = local.transactions || [];
  const remoteIds = new Set(remoteReports.map((r) => r?.id).filter(Boolean));
  const remoteSlots = new Set(
    remoteReports.filter((r) => r?.outlet && r?.date).map((r) => `${r.outlet}|${r.date}`)
  );
  return localReports.filter((r) => {
    if (!r?.id || remoteIds.has(r.id)) return false;
    if (localTxs.some((t) => t?.dailyReportId === r.id)) return true;
    if (r.outlet && r.date && !remoteSlots.has(`${r.outlet}|${r.date}`)) return true;
    return false;
  });
}
