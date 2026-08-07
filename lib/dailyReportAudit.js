// lib/dailyReportAudit.js — audit read-only duplikat laporan/omset (tanpa DELETE)

import { makeDailyReportKey, canonicalLaporanCashTxId, isCompleteDailyReport, dailyReportSlotKey } from "./kasirHarian.js";
import { normalizeReportDate } from "./laporanKeuangan.js";
import { pickNewerDailyReport } from "./dailyReportMerge.js";
import { CANONICAL_BUSINESS_ID } from "./canonicalBusiness.js";

function isGeneratedCashTx(t) {
  return t?.type === "in" && /laporan harian/i.test(t?.source || "");
}

function cashTxMatchesSlot(t, outlet, date) {
  if (!isGeneratedCashTx(t)) return false;
  const d = normalizeReportDate(t.date) || t.date;
  const rd = normalizeReportDate(date) || date;
  if (d !== rd) return false;
  if (t.outletCode === outlet || t.meta?.outletCode === outlet) return true;
  return String(t.desc || "").includes(`Omset tunai ${outlet}`);
}

/**
 * Audit satu slot outlet+tanggal — read-only.
 * @returns {{ duplicate: boolean, reason: string|null, ... }}
 */
export function auditDailyReportSlot(state, { businessId, outlet, date } = {}) {
  const biz = businessId || state?.businessId || CANONICAL_BUSINESS_ID;
  const d = normalizeReportDate(date) || date;
  const reports = (state?.dailyReports || []).filter(
    (r) => r?.outlet === outlet && (normalizeReportDate(r.date) || r.date) === d
  );
  const reportKey = makeDailyReportKey({ businessId: biz, outlet, date: d });
  const generated = (state?.transactions || []).filter((t) => cashTxMatchesSlot(t, outlet, d));
  const settle = (state?.transactions || []).filter(
    (t) =>
      /settle admin/i.test(t?.source || "")
      && (
        reports.some((r) => r.id === t.dailyReportId || r.id === t.sourceReportId)
        || (String(t.desc || "").includes(outlet) && String(t.desc || "").includes(d))
      )
  );

  const canonical = reports.length
    ? reports.reduce((a, b) => pickNewerDailyReport(a, b))
    : null;

  const reasons = [];
  if (reports.length > 1) reasons.push(`dailyReports×${reports.length} untuk slot yang sama`);
  if (generated.length > 1) reasons.push(`generated cash tx×${generated.length}`);
  if (canonical && generated.length === 0 && (Number(canonical.setoranOwner || canonical.cash) > 0)) {
    reasons.push("laporan punya setoran tunai tetapi tidak ada tx laci");
  }
  if (canonical && !isCompleteDailyReport(canonical, state?.transactions || [])) {
    reasons.push("laporan kanonik tidak lengkap");
  }

  const canonCashId = canonical ? canonicalLaporanCashTxId(canonical) : canonicalLaporanCashTxId({ businessId: biz, outlet, date: d });

  return {
    businessId: biz,
    outlet,
    reportDate: d,
    reportKey,
    slotKey: dailyReportSlotKey(outlet, d),
    reportCount: reports.length,
    reportIds: reports.map((r) => r.id),
    submissionIds: reports.map((r) => r.submissionId || r.idempotencyKey || null),
    statuses: reports.map((r) => r.status),
    canonicalReportId: canonical?.id || null,
    canonicalComplete: canonical ? isCompleteDailyReport(canonical, state?.transactions || []) : false,
    generatedCashCount: generated.length,
    generatedCashTxIds: generated.map((t) => t.id),
    generatedCashAmounts: generated.map((t) => t.amount),
    generatedCashCreatedAt: generated.map((t) => t.createdAt || t.date || null),
    expectedCanonicalCashTxId: canonCashId,
    settleTxCount: settle.length,
    settleTxIds: settle.map((t) => t.id),
    duplicate: reports.length > 1 || generated.length > 1,
    reason: reasons.length ? reasons.join("; ") : null,
    reasons,
  };
}

/**
 * Scan seluruh state untuk slot yang dobel.
 * Khusus highlight SMT/Samtaro bila ada.
 */
export function auditDailyReportDuplicates(state, { businessId, focusOutlets = ["SMT", "KSM", "KBU"] } = {}) {
  const biz = businessId || state?.businessId || CANONICAL_BUSINESS_ID;
  const slots = new Map();
  for (const r of state?.dailyReports || []) {
    if (!r?.outlet || !r?.date) continue;
    const key = dailyReportSlotKey(r.outlet, r.date);
    if (!key) continue;
    if (!slots.has(key)) slots.set(key, { outlet: r.outlet, date: normalizeReportDate(r.date) || r.date });
  }
  // Juga slot yang hanya punya tx omset tanpa laporan
  for (const t of state?.transactions || []) {
    if (!isGeneratedCashTx(t)) continue;
    const m = String(t.desc || "").match(/Omset tunai\s+(\w+)/i);
    const outlet = t.outletCode || t.meta?.outletCode || m?.[1];
    const date = normalizeReportDate(t.reportDate || t.meta?.reportDate || t.date) || t.date;
    if (!outlet || !date) continue;
    const key = dailyReportSlotKey(outlet, date);
    if (key && !slots.has(key)) slots.set(key, { outlet, date });
  }

  const results = [];
  for (const { outlet, date } of slots.values()) {
    const row = auditDailyReportSlot(state, { businessId: biz, outlet, date });
    if (row.duplicate || row.reasons.length) results.push(row);
  }

  results.sort((a, b) => {
    const af = focusOutlets.indexOf(a.outlet);
    const bf = focusOutlets.indexOf(b.outlet);
    const ao = af === -1 ? 99 : af;
    const bo = bf === -1 ? 99 : bf;
    if (ao !== bo) return ao - bo;
    return String(b.reportDate).localeCompare(String(a.reportDate));
  });

  return {
    businessId: biz,
    scannedSlots: slots.size,
    duplicateSlots: results.filter((r) => r.duplicate).length,
    issues: results,
    focus: results.filter((r) => focusOutlets.includes(r.outlet)),
  };
}

/** Preview cleanup aman — TIDAK mengeksekusi hapus. */
export function previewDuplicateCleanup(state, slotAudit) {
  if (!slotAudit?.duplicate && !(slotAudit?.generatedCashCount > 1)) {
    return { wouldDeleteReportIds: [], wouldDeleteTxIds: [], keepReportId: slotAudit?.canonicalReportId || null, keepCashTxId: slotAudit?.expectedCanonicalCashTxId || null, note: "tidak ada duplikat" };
  }
  const keepReportId = slotAudit.canonicalReportId;
  const keepCashTxId = slotAudit.expectedCanonicalCashTxId;
  const wouldDeleteReportIds = (slotAudit.reportIds || []).filter((id) => id !== keepReportId);
  const wouldDeleteTxIds = (slotAudit.generatedCashTxIds || []).filter((id) => id !== keepCashTxId);
  return {
    keepReportId,
    keepCashTxId,
    wouldDeleteReportIds,
    wouldDeleteTxIds,
    note: "preview only — tidak mengubah data. Jalankan reconcileDailyReportTransactions / orphan reconcile via save merge.",
  };
}
