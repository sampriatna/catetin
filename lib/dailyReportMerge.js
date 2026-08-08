// lib/dailyReportMerge.js — merge laporan omset antar perangkat (tanpa dependensi Supabase)

import { normalizeReportDate } from "./laporanKeuangan.js";

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

  // Setelah hapus + isi ulang: submitted baru (id beda, tanpa resubmittedAt) menang atas revision_requested lama
  if (a.status === "revision_requested" && b.status === "submitted" && a.id !== b.id) {
    const bAt = reportActivityTime(b);
    const aAt = a.revisionRequestedAt || reportActivityTime(a);
    if (bAt && (!aAt || bAt > aAt)) return b;
  }
  if (b.status === "revision_requested" && a.status === "submitted" && a.id !== b.id) {
    const aAt = reportActivityTime(a);
    const bAt = b.revisionRequestedAt || reportActivityTime(b);
    if (aAt && (!bAt || aAt > bAt)) return a;
  }

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

/** Slot kanonik: outlet|YYYY-MM-DD (Asia/Jakarta) — cegah dobel karena format tanggal beda. */
function slotKey(outlet, date) {
  const o = String(outlet || "").trim();
  const d = normalizeReportDate(date) || String(date || "").trim().slice(0, 10);
  if (!o || !d) return null;
  return `${o}|${d}`;
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
    const key = slotKey(r.outlet, r.date);
    if (!key) continue;
    const normalized = {
      ...r,
      date: normalizeReportDate(r.date) || String(r.date).trim().slice(0, 10),
    };
    const prev = byDay.get(key);
    byDay.set(key, prev ? pickNewerDailyReport(prev, normalized) : normalized);
  }
  return [...byDay.values()];
}

/**
 * Laporan lokal yang belum ada di awan — tetap dipertahankan jika:
 * - punya transaksi lokal terikat, atau
 * - slot outlet|tanggal belum ada di awan, atau
 * - idempotencyKey/submissionId lokal belum ada di awan (SMT omzet stabil).
 * Mencegah: notifikasi sukses + tx laci masuk, tapi laporan hilang saat cloud pull.
 */
export function localDailyReportsToPreserve(remote = {}, local = {}) {
  const remoteReports = remote.dailyReports || [];
  const localReports = local.dailyReports || [];
  const localTxs = local.transactions || [];
  const remoteIds = new Set(remoteReports.map((r) => r?.id).filter(Boolean));
  const remoteSlots = new Set(
    remoteReports
      .map((r) => slotKey(r?.outlet, r?.date))
      .filter(Boolean)
  );
  const remoteIdempotencyKeys = new Set(
    remoteReports
      .flatMap((r) => [r?.idempotencyKey, r?.submissionId])
      .map((k) => String(k || "").trim())
      .filter(Boolean)
  );
  return localReports.filter((r) => {
    if (!r?.id || remoteIds.has(r.id)) return false;
    const localKey = String(r.idempotencyKey || r.submissionId || "").trim();
    // Slot sudah di awan (id beda) → jangan preserve salinan kedua; sync akan pakai record pusat
    const sk = slotKey(r.outlet, r.date);
    if (sk && remoteSlots.has(sk)) return false;
    if (localKey && remoteIdempotencyKeys.has(localKey)) return false;
    if (localTxs.some((t) => t?.dailyReportId === r.id || t?.sourceReportId === r.id)) return true;
    if (sk && !remoteSlots.has(sk)) return true;
    return false;
  });
}

/**
 * Setelah pull/save: samakan status lokal dengan record pusat.
 * - Temukan by id / slot / idempotencyKey
 * - Set serverRecordId + syncStatus=synced + commitStatus=committed
 * - Jangan membuat laporan baru
 */
export function bindLocalReportsToCloudRecords(localReports = [], cloudReports = []) {
  const cloud = cloudReports || [];
  return (localReports || []).map((local) => {
    if (!local?.id) return local;
    const key = String(local.idempotencyKey || local.submissionId || "").trim();
    const sk = slotKey(local.outlet, local.date);
    const match =
      cloud.find((r) => r?.id === local.id)
      || (key && cloud.find((r) => r?.idempotencyKey === key || r?.submissionId === key))
      || (sk && cloud.find((r) => slotKey(r?.outlet, r?.date) === sk))
      || null;
    if (!match) return local;
    const pendingish = ["committing", "failed", "pending"].includes(local.commitStatus)
      || ["pending", "failed"].includes(local.syncStatus);
    if (!pendingish && local.serverRecordId === match.id && local.syncStatus === "synced") {
      return local;
    }
    return {
      ...local,
      ...match,
      // Identitas lokal yang sudah dikirim tetap dipertahankan bila cloud belum punya
      submissionId: match.submissionId || local.submissionId || null,
      idempotencyKey: match.idempotencyKey || local.idempotencyKey || match.submissionId || local.submissionId || null,
      serverRecordId: match.id,
      syncStatus: "synced",
      commitStatus: "committed",
      committedAt: match.committedAt || local.committedAt || new Date().toISOString(),
    };
  });
}
