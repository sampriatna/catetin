// lib/kasirHarian.js — laporan omset harian kasir & settle Admin NF3

import {
  getReportChannels,
  getSettleChannels,
  reportCashAmount,
  reportChannelTotal,
  legacyFieldsFromChannels,
  cashChannel,
  channelAmounts,
  snapshotChannelDefs,
} from "./reportChannels.js";
import { todayLocal, normalizeReportDate } from "./laporanKeuangan.js";
import { pickNewerDailyReport } from "./dailyReportMerge.js";
import { isRevisionRequestMessage, revisionStillPending } from "./staffMessages.js";
import { resolveWalletId, resolveTransferIds } from "./transactionNormalize.js";
import { canDo } from "./rbac.js";
import { filterDeletedDailyReports } from "./dailyReportDelete.js";
import { CANONICAL_BUSINESS_ID } from "./canonicalBusiness.js";

export const LACI_BY_OUTLET = { KBU: "w_laci_kbu", KSM: "w_laci_ksm", SMT: "w_laci_smt" };
export const LACI_FLOOR = 250000;

/** Status final — tidak boleh membuat transaksi dompet baru saat dibuka/refresh/kirim ulang. */
export const SETTLED_REPORT_STATUSES = new Set(["settled"]);

/** Status laporan yang sudah punya efek keuangan (tunai laci) atau menunggu settle. */
export const ACTIVE_REPORT_STATUSES = new Set([
  "submitted",
  "submitting",
  "admin_verified",
  "revision_requested",
  "settled",
]);

/** Status yang mengunci slot outlet+tanggal (laporan final / menunggu aksi). */
export const LOCKING_REPORT_STATUSES = new Set([
  "submitted",
  "admin_verified",
  "revision_requested",
  "settled",
]);

function findCat(categories, hint, type = "in") {
  return (categories || []).find(
    (c) => c.type === type && c.active !== false && c.name.toLowerCase().includes(hint.toLowerCase())
  );
}

function nowWibIso() {
  try {
    return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).replace(" ", "T") + "+07:00";
  } catch {
    return new Date().toISOString();
  }
}

/** Log terstruktur untuk audit submit/settle/delete (browser + Node). */
export function logDailyReportStage(stage, payload = {}) {
  const entry = {
    scope: "daily_report",
    stage,
    at: new Date().toISOString(),
    atWib: nowWibIso(),
    ...payload,
  };
  try {
    if (typeof console !== "undefined" && console.info) {
      console.info("[daily_report]", JSON.stringify(entry));
    }
  } catch { /* ignore */ }
  return entry;
}

/**
 * Deterministic reportKey: businessId:outletCode:YYYY-MM-DD (Asia/Jakarta).
 * Satu outlet hanya satu laporan aktif per reportKey.
 */
export function makeDailyReportKey({ businessId, outlet, date } = {}) {
  const b = String(businessId || CANONICAL_BUSINESS_ID || "biz").trim() || "biz";
  const o = String(outlet || "").trim();
  const d = normalizeReportDate(date);
  if (!o || !d) return null;
  return `${b}:${o}:${d}`;
}

/**
 * ID laporan kanonik per slot bisnis (bukan per submission/nonce).
 * Satu app_state doc = satu bisnis → `dr_<OUTLET>_<YYYY-MM-DD>` unik per outlet+tanggal.
 * Request/retry/concurrent dengan submissionId berbeda tetap menulis id yang sama → upsert.
 */
export function canonicalDailyReportId({ businessId, outlet, date, reportKey } = {}) {
  const key = reportKey || makeDailyReportKey({ businessId, outlet, date });
  if (key) {
    const parts = String(key).split(":");
    const o = parts[1] || String(outlet || "").trim();
    const d = parts[2] || normalizeReportDate(date) || String(date || "").trim();
    if (o && d) return `dr_${o}_${d}`;
  }
  const o = String(outlet || "").trim();
  const d = normalizeReportDate(date) || String(date || "").trim();
  if (!o || !d) return null;
  return `dr_${o}_${d}`;
}

/**
 * Idempotency key aman: business + outlet + tanggal + user + nonce sesi.
 * Dipakai ulang saat retry laporan yang sama; berbeda antar-outlet pada tanggal sama.
 */
export function makeDailyReportSubmissionId({ businessId, outlet, date, userId, nonce } = {}) {
  const b = String(businessId || CANONICAL_BUSINESS_ID || "biz").trim() || "biz";
  const o = String(outlet || "X").trim() || "X";
  const d = normalizeReportDate(date) || String(date || "").trim() || "nodate";
  const u = String(userId || "anon").trim() || "anon";
  const n = String(nonce || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  return `${b}|${o}|${d}|${u}|${n}`;
}

/** ID laporan deterministik dari submission_id — request ulang tidak buat laporan baru. */
export function reportIdFromSubmissionId(submissionId) {
  const raw = String(submissionId || "").trim();
  if (!raw) return null;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `dr_${hex}_${raw.length.toString(36)}`;
}

function findReportBySubmissionId(reports, submissionId) {
  if (!submissionId) return null;
  const id = reportIdFromSubmissionId(submissionId);
  return (reports || []).find(
    (r) => r.submissionId === submissionId || r.idempotencyKey === submissionId || r.id === id
  ) || null;
}

/** Kunci slot bisnis: outlet|tanggal (bukan tanggal saja). */
export function dailyReportSlotKey(outlet, date) {
  const o = String(outlet || "").trim();
  const d = normalizeReportDate(date) || String(date || "").trim();
  if (!o || !d) return null;
  return `${o}|${d}`;
}

export function findDailyReportByKey(reports, reportKey) {
  if (!reportKey) return null;
  return (reports || []).find((r) => {
    if (!r) return false;
    if (r.reportKey === reportKey) return true;
    return makeDailyReportKey({
      businessId: r.businessId,
      outlet: r.outlet,
      date: r.date,
    }) === reportKey;
  }) || null;
}

/**
 * Laporan final/lengkap yang boleh mengunci slot outlet+tanggal.
 * Record draft / submitting / tanpa timestamp / omset tunai tanpa tx laci → tidak lengkap
 * (tidak boleh menolak submit ulang sebagai "duplicate").
 */
export function isCompleteDailyReport(report, transactions = []) {
  if (!report?.id || !report.outlet || !report.date) return false;
  if (!LOCKING_REPORT_STATUSES.has(report.status)) return false;
  if (!report.submittedAt && !report.settledAt && !report.resubmittedAt) return false;
  const total = Number(report.total);
  if (!Number.isFinite(total) || total < 0) return false;

  let cashAmt = 0;
  try {
    cashAmt = Math.max(0, Number(reportCashAmount(report)) || 0);
  } catch { /* ignore */ }
  if (!(cashAmt > 0)) {
    cashAmt = Math.max(0, Number(report.setoranOwner ?? report.cash) || 0);
  }
  if (!(cashAmt > 0) && report.channels && typeof report.channels === "object") {
    cashAmt = Math.max(
      0,
      Number(report.channels.tunai ?? report.channels.cash ?? 0) || 0
    );
  }
  if (cashAmt > 0) {
    const hasCash = (transactions || []).some((t) => {
      if (!t || t.type !== "in" || !/laporan harian/i.test(t.source || "")) return false;
      if (t.dailyReportId === report.id || t.sourceReportId === report.id) return true;
      if (laporanCashTxIdCandidates(report).includes(t.id)) return true;
      return t.date === report.date && String(t.desc || "").includes(`Omset tunai ${report.outlet}`);
    });
    if (!hasCash) return false;
  }
  return true;
}

/** Cari laporan di slot outlet+tanggal (bukan tanggal lintas outlet). */
export function findDailyReportInSlot(reports, outlet, date) {
  const key = dailyReportSlotKey(outlet, date);
  if (!key) return null;
  return (reports || []).find((r) => dailyReportSlotKey(r?.outlet, r?.date) === key) || null;
}

export function walletBalance(walletId, wallets, transactions) {
  const w = (wallets || []).find((x) => x.id === walletId);
  if (!w) return 0;
  const txs = (transactions || []).filter((t) => {
    if (t.type === "transfer") {
      const { from, to } = resolveTransferIds(t);
      return from === walletId || to === walletId;
    }
    return resolveWalletId(t) === walletId;
  });
  return (w.opening || 0) + txs.reduce((a, t) => {
    if (t.type === "transfer") {
      const { to } = resolveTransferIds(t);
      return a + (to === walletId ? t.amount : -t.amount);
    }
    return a + (t.type === "in" ? t.amount : -t.amount);
  }, 0);
}

/** Batas settle: esok hari jam 17:00 setelah tanggal laporan. */
export function reportSettleDeadlineIso(dateStr) {
  const [y, m, d] = (dateStr || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d + 1, 17, 0, 0, 0).toISOString();
}

export function reportSettleDeadlineLabel(dateStr) {
  const iso = reportSettleDeadlineIso(dateStr);
  if (!iso) return "";
  const dt = new Date(iso);
  return dt.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" }) + " · 17:00";
}

/** overdue | urgent | ok */
export function reportSettleUrgency(report) {
  if (!report || report.status === "settled") return null;
  const iso = reportSettleDeadlineIso(report.date);
  if (!iso) return null;
  const deadline = new Date(iso);
  const now = new Date();
  if (now > deadline) return "overdue";
  if (deadline - now < 24 * 3600000) return "urgent";
  return "ok";
}

function computeReportPayload(state, payload) {
  const { date, user, physicalCashEnd } = payload;
  const outlet = user?.outlet;
  const walletId = LACI_BY_OUTLET[outlet];
  if (!walletId) throw new Error("Outlet kasir tidak valid.");

  const channels = getReportChannels(state, outlet);
  const cashCh = cashChannel(channels);
  if (!cashCh) throw new Error("Channel tunai belum dikonfigurasi untuk outlet ini.");

  const laciWallet = (state.wallets || []).find((w) => w.id === walletId);
  const floor = laciWallet?.floor ?? LACI_FLOOR;

  let amounts = channelAmounts(payload.channels || {});

  if (!Object.keys(amounts).length && (payload.cash != null || payload.qrisBca != null)) {
    amounts = channelAmounts({
      tunai: payload.cash,
      qris_bca: payload.qrisBca,
      qris_bri: payload.qrisBri,
      gojek: payload.gojek,
    });
  }

  const physical = Math.max(0, +physicalCashEnd || 0);
  if (physical > 0) {
    amounts[cashCh.id] = Math.max(0, physical - floor);
  }

  const cashAmt = Math.max(0, +(amounts[cashCh.id] || 0));
  const channelEntries = channels.filter((c) => c.role !== "cash");
  const nonCashTotal = channelEntries.reduce((s, c) => s + Math.max(0, +(amounts[c.id] || 0)), 0);
  const total = cashAmt + nonCashTotal;

  if (total <= 0 && physical <= 0) throw new Error("Isi minimal satu nominal omset atau kas fisik akhir.");

  const legacy = legacyFieldsFromChannels(amounts, channels);
  return { outlet, walletId, channels, cashCh, floor, amounts, physical, cashAmt, total, legacy, date };
}

/**
 * ID transaksi omset tunai kanonik per slot bisnis (bukan per reportId).
 * Delete → resubmit memakai id yang sama → upsert, bukan push kedua.
 */
export function canonicalLaporanCashTxId({ businessId, outlet, date, reportKey } = {}) {
  const key = reportKey || makeDailyReportKey({ businessId, outlet, date });
  if (key) {
    const parts = String(key).split(":");
    const o = parts[1] || String(outlet || "").trim();
    const d = parts[2] || normalizeReportDate(date) || String(date || "").trim();
    if (o && d) return `t_cash_${o}_${d}`;
  }
  const o = String(outlet || "").trim();
  const d = normalizeReportDate(date) || String(date || "").trim();
  if (!o || !d) return null;
  return `t_cash_${o}_${d}`;
}

/** Legacy id `t_<reportId>_cash` + kanonik slot. */
export function laporanCashTxIdCandidates(report) {
  if (!report) return [];
  const out = [];
  const canon = canonicalLaporanCashTxId(report);
  if (canon) out.push(canon);
  if (report.id) out.push(`t_${report.id}_cash`);
  return [...new Set(out)];
}

function isGeneratedLaporanCashTx(t, outlet, date) {
  if (!t || t.type !== "in") return false;
  if (!/laporan harian/i.test(t.source || "")) return false;
  const d = normalizeReportDate(t.date) || t.date;
  const rd = normalizeReportDate(date) || date;
  if (d !== rd) return false;
  const desc = String(t.desc || "");
  if (desc === `Omset tunai ${outlet}` || desc.includes(`Omset tunai ${outlet}`)) return true;
  if (t.outletCode === outlet || t.meta?.outletCode === outlet) return true;
  return false;
}

/** Semua transaksi omset tunai dari laporan harian untuk outlet+tanggal (termasuk duplikat revisi). */
export function collectDailyReportCashTxIds(transactions, report) {
  const outlet = report?.outlet;
  const date = normalizeReportDate(report?.date) || report?.date;
  if (!outlet || !date) return [];
  const ids = new Set();
  (transactions || []).forEach((t) => {
    if (!t?.id) return;
    if (isGeneratedLaporanCashTx(t, outlet, date)) {
      ids.add(t.id);
      return;
    }
    if (
      t.type === "in"
      && /laporan harian/i.test(t.source || "")
      && (t.dailyReportId === report.id || t.sourceReportId === report.id || t.meta?.sourceReportId === report.id)
    ) {
      ids.add(t.id);
    }
  });
  // Pastikan kandidat kanonik/legacy ikut jika masih ada di buku
  const existing = new Set((transactions || []).map((t) => t?.id).filter(Boolean));
  for (const id of laporanCashTxIdCandidates(report)) {
    if (existing.has(id)) ids.add(id);
  }
  return [...ids];
}

/** Semua transaksi terkait laporan (tunai laci + settle admin) — untuk hapus owner. */
export function collectAllDailyReportTxIds(transactions, report) {
  const reportId = report?.id;
  const outlet = report?.outlet;
  const date = normalizeReportDate(report?.date) || report?.date;
  const ids = new Set(collectDailyReportCashTxIds(transactions, report));
  (transactions || []).forEach((t) => {
    if (!t?.id) return;
    if (t.dailyReportId === reportId || t.sourceReportId === reportId || t.meta?.sourceReportId === reportId) {
      ids.add(t.id);
      return;
    }
    // Settle legacy tanpa dailyReportId: desc mengandung outlet+tanggal laporan
    if (
      outlet && date
      && /settle admin/i.test(t.source || "")
      && String(t.desc || "").includes(outlet)
      && String(t.desc || "").includes(date)
    ) {
      ids.add(t.id);
    }
  });
  return [...ids];
}

function cashTxForReport(state, report, cashAmt, walletId, cashCh, submissionId = null) {
  if (!(cashAmt > 0) || !report?.id) return null;
  const outlet = report.outlet;
  const date = normalizeReportDate(report.date) || report.date;
  const hint = cashCh.categoryHint || "tunai";
  const cat = findCat(state.categories, hint) || findCat(state.categories, "penjualan");
  const reportKey = report.reportKey || makeDailyReportKey(report);
  const id = canonicalLaporanCashTxId({ ...report, reportKey }) || `t_${report.id}_cash`;
  const sid = submissionId || report.submissionId || report.idempotencyKey || null;
  return {
    id,
    type: "in",
    amount: cashAmt,
    categoryId: cat?.id,
    walletId,
    desc: `Omset tunai ${outlet}`,
    date,
    source: "Laporan harian",
    dailyReportId: report.id,
    sourceReportId: report.id,
    sourceSubmissionId: sid,
    outletCode: outlet,
    reportDate: date,
    reportKey: reportKey || null,
    transactionKind: "daily_report_cash",
    meta: {
      source: "daily_report",
      sourceReportId: report.id,
      sourceSubmissionId: sid,
      outletCode: outlet,
      reportDate: date,
      transactionKind: "daily_report_cash",
    },
    ...(sid || reportKey
      ? { idempotencyKey: `${reportKey || sid}|cash` }
      : {}),
  };
}

/**
 * Kasir submit laporan omset.
 * - Tunai (role cash) → transaksi masuk laci outlet
 * - Channel lain → dicatat di laporan, settle Admin NF3
 * - physicalCashEnd opsional: tunai = fisik − floor (modal statis)
 * - submissionId / idempotencyKey: request ulang mengembalikan hasil sebelumnya (tanpa tx baru)
 * - reportKey = businessId:outlet:YYYY-MM-DD → unique upsert per slot
 */
export function submitDailyReport(state, payload) {
  const { user } = payload;
  const submissionId = String(payload.submissionId || payload.idempotencyKey || "").trim() || null;
  const businessId = String(
    payload.businessId || state.businessId || CANONICAL_BUSINESS_ID || ""
  ).trim() || CANONICAL_BUSINESS_ID;
  const computed = computeReportPayload(state, {
    ...payload,
    date: normalizeReportDate(payload.date) || payload.date,
  });
  const { outlet, walletId, channels, cashCh, floor, amounts, physical, cashAmt, total, legacy } = computed;
  const date = normalizeReportDate(computed.date) || computed.date;
  const reportKey = makeDailyReportKey({ businessId, outlet, date });

  logDailyReportStage("submit_started", {
    action: "submit",
    submissionId,
    businessId,
    outletCode: outlet,
    reportDate: date,
    reportKey,
    slotKey: dailyReportSlotKey(outlet, date),
    nominal: total,
    cashAmt,
    userId: user?.id || null,
  });

  const reports = filterDeletedDailyReports(state.dailyReports || [], state);
  const txsAll = state.transactions || [];
  const existingCount = reports.filter(
    (r) => makeDailyReportKey({ businessId: r.businessId || businessId, outlet: r.outlet, date: r.date }) === reportKey
      || dailyReportSlotKey(r.outlet, r.date) === dailyReportSlotKey(outlet, date)
  ).length;

  // Idempotency: submissionId sama + laporan lengkap → kembalikan hasil tersimpan (bukan INSERT baru)
  const prior = findReportBySubmissionId(reports, submissionId);
  if (prior && isCompleteDailyReport(prior, txsAll)) {
    const existingTxs = txsAll.filter(
      (t) =>
        /laporan harian/i.test(t.source || "")
        && (
          t.dailyReportId === prior.id
          || t.sourceReportId === prior.id
          || laporanCashTxIdCandidates(prior).includes(t.id)
        )
    );
    logDailyReportStage("submit_idempotent_hit", {
      action: "retry",
      result: "idempotent",
      submissionId,
      businessId,
      outletCode: outlet,
      reportDate: date,
      reportKey,
      reportId: prior.id,
      existingRecordCount: existingCount,
      walletTransactionIds: existingTxs.map((t) => t.id),
    });
    return { report: { ...prior, reportKey: prior.reportKey || reportKey }, txs: existingTxs, removeIds: [], idempotent: true };
  }

  // Unique upsert by reportKey / outlet+date — outlet lain di tanggal sama BUKAN duplicate
  const conflict =
    findDailyReportByKey(reports, reportKey)
    || findDailyReportInSlot(reports, outlet, date);
  let removeIds = [];
  let action = "create";
  if (conflict) {
    const sameAttempt = prior && prior.id === conflict.id;
    const incomplete = !isCompleteDailyReport(conflict, txsAll);

    if (incomplete || (sameAttempt && prior && !isCompleteDailyReport(prior, txsAll))) {
      removeIds = collectDailyReportCashTxIds(txsAll, conflict);
      action = "update";
      logDailyReportStage("submit_replace_incomplete", {
        action: "update",
        submissionId,
        businessId,
        outletCode: outlet,
        reportDate: date,
        reportKey,
        previousReportId: conflict.id,
        previousStatus: conflict.status || null,
        existingRecordCount: existingCount,
        removeTxIds: removeIds,
      });
    } else if (conflict.status === "revision_requested") {
      logDailyReportStage("submit_rejected", {
        action: "reject",
        result: "revision_requested",
        submissionId,
        businessId,
        outletCode: outlet,
        reportDate: date,
        reportKey,
        reportId: conflict.id,
        existingRecordCount: existingCount,
      });
      throw new Error("Admin minta revisi — buka laporan dan kirim ulang (bukan laporan baru).");
    } else if (SETTLED_REPORT_STATUSES.has(conflict.status)) {
      logDailyReportStage("submit_rejected", {
        action: "reject",
        result: "already_settled",
        submissionId,
        reportId: conflict.id,
        reportKey,
      });
      throw new Error(`Laporan ${date} ${outlet} sudah disettle. Hubungi admin keuangan jika perlu koreksi.`);
    } else {
      // Laporan lengkap sudah ada — JANGAN INSERT kedua.
      // submission sama → idempotent; submission beda → UPSERT ke slot yang sama.
      const existingTxs = txsAll.filter(
        (t) =>
          /laporan harian/i.test(t.source || "")
          && (
            t.dailyReportId === conflict.id
            || t.sourceReportId === conflict.id
            || laporanCashTxIdCandidates(conflict).includes(t.id)
          )
      );
      if (submissionId && (conflict.submissionId === submissionId || conflict.idempotencyKey === submissionId)) {
        logDailyReportStage("submit_idempotent_hit", {
          action: "retry",
          result: "idempotent_by_key",
          submissionId,
          reportId: conflict.id,
          reportKey,
        });
        return { report: conflict, txs: existingTxs, removeIds: [], idempotent: true };
      }
      // Payload sama (nominal) → treat as retry meski submissionId beda (anti double dari sesi baru)
      const sameNominal =
        Math.round(Number(conflict.total) || 0) === Math.round(Number(total) || 0)
        && Math.round(Number(conflict.setoranOwner ?? conflict.cash) || 0) === Math.round(Number(cashAmt) || 0);
      if (sameNominal && isCompleteDailyReport(conflict, txsAll)) {
        logDailyReportStage("submit_idempotent_hit", {
          action: "retry",
          result: "idempotent_same_slot_nominal",
          submissionId,
          reportId: conflict.id,
          reportKey,
          previousSubmissionId: conflict.submissionId || null,
        });
        return {
          report: { ...conflict, reportKey: conflict.reportKey || reportKey },
          txs: existingTxs,
          removeIds: [],
          idempotent: true,
        };
      }
      removeIds = collectDailyReportCashTxIds(txsAll, conflict);
      action = "update";
      logDailyReportStage("submit_upsert_existing", {
        action: "update",
        result: "upsert_same_slot",
        submissionId,
        businessId,
        outletCode: outlet,
        reportDate: date,
        reportKey,
        previousReportId: conflict.id,
        previousStatus: conflict.status || null,
        existingRecordCount: existingCount,
      });
    }
  }

  // ID kanonik per outlet+tanggal — bukan hash(submissionId/nonce). Concurrent/retry → id sama → upsert.
  const canonId = canonicalDailyReportId({ businessId, outlet, date, reportKey });
  const finalReportId = canonId
    || (action === "update" && conflict?.id)
    || (submissionId ? reportIdFromSubmissionId(submissionId) : `dr${Date.now()}`);

  if (conflict && conflict.id !== finalReportId) {
    removeIds = [...new Set([...removeIds, ...collectDailyReportCashTxIds(txsAll, conflict)])];
  }

  const keepStatus =
    action === "update"
    && conflict
    && (conflict.status === "admin_verified" || conflict.status === "submitted")
      ? conflict.status
      : "submitted";

  const report = {
    id: finalReportId,
    date,
    outlet,
    businessId,
    reportKey,
    kasirId: user.id,
    kasirName: user.name,
    channels: { ...amounts },
    channelDefs: snapshotChannelDefs(channels),
    physicalCashEnd: physical || null,
    laciFloor: floor,
    setoranOwner: cashAmt,
    ...legacy,
    total,
    status: keepStatus,
    submittedAt: (action === "update" && conflict?.submittedAt) || new Date().toISOString(),
    ...(keepStatus === "admin_verified" && conflict?.adminVerifiedAt
      ? { adminVerifiedAt: conflict.adminVerifiedAt, adminVerifiedBy: conflict.adminVerifiedBy }
      : {}),
    ...(submissionId ? { submissionId, idempotencyKey: submissionId } : {}),
  };

  // Bersihkan omset tunai slot legacy; id kanonik akan di-upsert lewat txs
  removeIds = [...new Set([
    ...removeIds,
    ...collectDailyReportCashTxIds(txsAll, { id: finalReportId, outlet, date, businessId, reportKey }),
  ])];

  const txs = [];
  const cashTx = cashTxForReport(state, report, cashAmt, walletId, cashCh, submissionId);
  if (cashTx) txs.push(cashTx);

  logDailyReportStage("submit_built", {
    action,
    result: "ok",
    submissionId,
    businessId,
    outletCode: outlet,
    reportDate: date,
    reportKey,
    reportId: report.id,
    existingRecordCount: existingCount,
    nominal: total,
    walletTransactionIds: txs.map((t) => t.id),
  });

  return { report, txs, removeIds, idempotent: false };
}

/** Kasir perbaiki laporan setelah diminta revisi admin/owner. */
export function resubmitDailyReport(state, reportId, payload) {
  const reports = state.dailyReports || [];
  const report = reports.find((r) => r.id === reportId);
  if (!report) throw new Error("Laporan tidak ditemukan.");

  const inRevision = revisionStillPending(report, state.staffMessages, report.outlet);
  if (!inRevision) throw new Error("Laporan ini tidak dalam status revisi.");

  const { user } = payload;
  const computed = computeReportPayload(state, payload);
  const { outlet, walletId, channels, cashCh, floor, amounts, physical, cashAmt, total, legacy, date } = computed;

  if (date !== report.date || outlet !== report.outlet) {
    throw new Error("Tanggal/outlet tidak bisa diubah saat revisi.");
  }

  const reportKey = report.reportKey || makeDailyReportKey({
    businessId: report.businessId,
    outlet,
    date,
  });
  const updated = {
    ...report,
    channels: { ...amounts },
    channelDefs: snapshotChannelDefs(channels),
    physicalCashEnd: physical || null,
    laciFloor: floor,
    setoranOwner: cashAmt,
    ...legacy,
    total,
    status: "submitted",
    resubmittedAt: new Date().toISOString(),
    revisionNote: null,
    revisionRequestedAt: null,
    revisionRequestedBy: null,
    revisionRequestedByRole: null,
    adminVerifiedAt: null,
    adminVerifiedBy: null,
    adminVerifyNote: null,
    reportKey: reportKey || report.reportKey || null,
  };

  const canonCashId = canonicalLaporanCashTxId(updated);
  const removeIds = collectDailyReportCashTxIds(state.transactions, updated)
    .filter((id) => id !== canonCashId);

  const txs = [];
  const cashTx = cashTxForReport(state, updated, cashAmt, walletId, cashCh, updated.submissionId || updated.idempotencyKey);
  if (cashTx) txs.push(cashTx);

  return { report: updated, txs, removeIds };
}

/** Admin Keuangan verifikasi fisik + nota sebelum settle. */
export function verifyDailyReportAdmin(state, reportId, adminUser, { note = "" } = {}) {
  const report = (state.dailyReports || []).find((r) => r.id === reportId);
  if (!report) throw new Error("Laporan tidak ditemukan.");
  if (report.status !== "submitted") throw new Error("Hanya laporan baru yang menunggu verifikasi.");
  return {
    ...report,
    status: "admin_verified",
    adminVerifiedAt: new Date().toISOString(),
    adminVerifiedBy: adminUser?.id,
    adminVerifyNote: (note || "").trim() || null,
  };
}

/** Owner/admin atau kasir (outlet sendiri) hapus laporan + bersihkan transaksi terkait. Owner boleh hapus riwayat settled. */
export function deleteDailyReport(state, reportId, user) {
  const asAdmin = canDo(user?.role, "hapusLaporanOmset");
  const asKasir = canDo(user?.role, "hapusLaporanOmsetSendiri");
  if (!asAdmin && !asKasir) {
    throw new Error("Anda tidak bisa menghapus laporan omset.");
  }
  const reports = state.dailyReports || [];
  const report = reports.find((r) => r.id === reportId);
  if (!report) throw new Error("Laporan tidak ditemukan.");

  if (asKasir && !asAdmin) {
    if ((user?.outlet || "") !== report.outlet) {
      throw new Error("Hanya bisa hapus laporan outlet Anda sendiri.");
    }
    if (report.status === "settled" || reportHasSettleTxs(reportId, state.transactions)) {
      throw new Error("Laporan sudah disettle — hubungi admin/owner untuk hapus.");
    }
    if (report.status === "admin_verified") {
      throw new Error("Sudah diverifikasi admin — hubungi admin/owner untuk hapus atau revisi.");
    }
  }

  const removeIds = asAdmin
    ? collectAllDailyReportTxIds(state.transactions, report)
    : collectDailyReportCashTxIds(state.transactions, report);

  // Pastikan semua omset tunai slot ikut (termasuk legacy tanpa dailyReportId)
  const slotCash = collectDailyReportCashTxIds(state.transactions, report);
  const allRemove = [...new Set([...removeIds, ...slotCash])];

  const reportKey = report.reportKey || makeDailyReportKey(report);
  logDailyReportStage("delete_started", {
    action: "delete",
    businessId: report.businessId || null,
    outletCode: report.outlet,
    reportDate: report.date,
    reportKey,
    submissionId: report.submissionId || report.idempotencyKey || null,
    reportId: report.id,
    existingRecordCount: reports.filter(
      (r) => r.outlet === report.outlet && (normalizeReportDate(r.date) || r.date) === (normalizeReportDate(report.date) || report.date)
    ).length,
    removeTxCount: allRemove.length,
  });

  return { report: { ...report, reportKey }, removeIds: allRemove };
}

/** Admin/owner minta kasir perbaiki laporan. */
export function requestDailyReportRevision(state, reportId, user, note) {
  const trimmed = (note || "").trim();
  if (!trimmed) throw new Error("Catatan revisi wajib diisi — jelaskan selisih fisik/nota.");
  const report = (state.dailyReports || []).find((r) => r.id === reportId);
  if (!report) throw new Error("Laporan tidak ditemukan.");
  if (!["submitted", "admin_verified"].includes(report.status)) {
    throw new Error("Laporan tidak bisa direvisi dari status ini.");
  }
  return {
    ...report,
    status: "revision_requested",
    revisionNote: trimmed,
    revisionRequestedAt: new Date().toISOString(),
    revisionRequestedBy: user?.id,
    revisionRequestedByRole: user?.role || null,
    adminVerifiedAt: null,
    adminVerifiedBy: null,
    adminVerifyNote: null,
  };
}

/** Admin NF3 settle — channel non-tunai ke dompet/rekening, tunai → Kas Besar, laci tetap floor. */
export function settleDailyReport(state, reportId, adminUser) {
  const reports = state.dailyReports || [];
  const report = reports.find((r) => r.id === reportId);
  if (!report) throw new Error("Laporan tidak ditemukan atau sudah disettle.");

  logDailyReportStage("settle_started", {
    reportId,
    outletId: report.outlet,
    reportDate: report.date,
    status: report.status,
    nominal: report.total,
    adminId: adminUser?.id || null,
  });

  if (report.status === "settled") {
    logDailyReportStage("settle_idempotent_hit", { reportId, reason: "already_settled" });
    return { report, txs: [], idempotent: true };
  }
  if (report.status !== "admin_verified") {
    if (report.status === "submitted") {
      throw new Error("Verifikasi fisik & nota dulu (Admin Keuangan) sebelum settle.");
    }
    if (report.status === "revision_requested") {
      throw new Error("Kasir belum mengirim revisi laporan.");
    }
    throw new Error("Laporan belum siap disettle.");
  }
  if (reportHasSettleTxs(reportId, state.transactions)) {
    const settled = {
      ...report,
      status: "settled",
      settledAt: report.settledAt || new Date().toISOString(),
      settledBy: report.settledBy || adminUser?.id,
    };
    logDailyReportStage("settle_idempotent_hit", {
      reportId,
      reason: "settle_txs_exist",
      settlementId: settled.settledAt,
    });
    return { report: settled, txs: [], idempotent: true };
  }

  const older = reports.find(
    (r) => r.outlet === report.outlet && r.status !== "settled" && r.date < report.date
  );
  if (older) throw new Error(`Selesaikan laporan ${older.date} (${older.outlet}) terlebih dulu.`);

  const outlet = report.outlet;
  const channels = getSettleChannels(state, report);
  const walletId = LACI_BY_OUTLET[outlet];
  const laciWallet = (state.wallets || []).find((w) => w.id === walletId);
  const floor = laciWallet?.floor || LACI_FLOOR;
  const settleDate = todayLocal();
  const ts = Date.now();
  const txs = [];
  const settlementKey = report.submissionId || report.idempotencyKey || report.id;

  const amounts = report.channels || {};
  const cashAmt = reportCashAmount(report, channels);

  // Channel non-tunai dari config outlet
  channels
    .filter((c) => c.role === "channel" && c.settleWallet)
    .forEach((ch) => {
      const amt = Math.max(0, +(amounts[ch.id] ?? legacyFallbackAmount(report, ch.id)));
      if (amt <= 0) return;
      const hint = ch.categoryHint || ch.label;
      const cat = findCat(state.categories, hint) || findCat(state.categories, "penjualan");
      txs.push({
        id: `t_${reportId}_settle_${ch.id}`,
        type: "in",
        amount: amt,
        categoryId: cat?.id,
        walletId: ch.settleWallet,
        desc: `${ch.label} ${outlet} · ${report.date}`,
        date: settleDate,
        source: "Settle Admin NF3",
        dailyReportId: report.id,
        reportChannelId: ch.id,
        idempotencyKey: `${settlementKey}|settle|${ch.id}`,
      });
    });

  // Laporan legacy tanpa channels — fallback hardcoded
  if (!report.channels) {
    settleLegacyNonCash(report, txs, ts, settleDate, outlet);
  }

  if (cashAmt > 0) {
    const cashTxIds = collectDailyReportCashTxIds(state.transactions, report);
    const canonCashId = canonicalLaporanCashTxId(report);
    const hasCashIn = cashTxIds.length > 0
      || (state.transactions || []).some(
        (t) =>
          (t.id === canonCashId || t.id === `t_${reportId}_cash`)
          && resolveWalletId(t) === walletId
      );
    if (!hasCashIn) {
      logDailyReportStage("settle_rejected", { reportId, reason: "missing_cash_tx" });
      throw new Error(
        `Transaksi tunai laci ${outlet} untuk laporan ini belum ada — saldo akan minus jika disettle. Hubungi admin perbaiki data atau hapus & kirim ulang laporan kasir.`
      );
    }
    const bal = walletBalance(walletId, state.wallets, [...(state.transactions || []), ...txs]);
    if (bal - cashAmt < floor) {
      logDailyReportStage("settle_rejected", { reportId, reason: "laci_insufficient", balance: bal, cashAmt, floor });
      throw new Error(
        `Saldo laci ${outlet} tidak cukup. Butuh Rp ${new Intl.NumberFormat("id-ID").format(cashAmt)} di atas floor Rp ${new Intl.NumberFormat("id-ID").format(floor)}.`
      );
    }
    txs.push({
      id: `t_${reportId}_settle_trf_cash`,
      type: "transfer",
      amount: cashAmt,
      fromWalletId: walletId,
      toWalletId: "w_kas_besar",
      desc: `Setoran tunai ${outlet} · ${report.date} → Kas Besar`,
      date: settleDate,
      source: "Settle Admin NF3",
      dailyReportId: report.id,
      idempotencyKey: `${settlementKey}|settle|trf_cash`,
    });
  }

  const settled = {
    ...report,
    status: "settled",
    settledAt: new Date().toISOString(),
    settledBy: adminUser?.id,
    settlement: { toKasBesar: cashAmt, laciFloor: floor, laciAfter: floor },
  };

  logDailyReportStage("settle_built", {
    reportId,
    settlementId: settled.settledAt,
    outletId: outlet,
    reportDate: report.date,
    nominal: report.total,
    walletTransactionIds: txs.map((t) => t.id),
  });

  return { report: settled, txs, idempotent: false };
}

function legacyFallbackAmount(report, channelId) {
  const map = {
    qris_bca: report.qrisBca,
    edc_bca: report.qrisBca,
    qris_bri: report.qrisBri,
    edc_bri: report.qrisBri,
    gojek: report.gojek,
    ojek_online: report.gojek,
    online: report.gojek,
  };
  return map[channelId] || 0;
}

function settleLegacyNonCash(report, txs, ts, settleDate, outlet) {
  const pairs = [
    [report.qrisBca, "w_bca", "qris bca"],
    [report.qrisBri, "w_bri", "qris bri"],
    [report.gojek, "w_gofood", "gojek"],
  ];
  pairs.forEach(([amt, wallet, hint], i) => {
    if (!(amt > 0)) return;
    txs.push({
      id: "t" + ts + "leg" + i,
      type: "in",
      amount: amt,
      walletId: wallet,
      desc: `${hint} ${outlet} · ${report.date}`,
      date: settleDate,
      source: "Settle Admin NF3",
      dailyReportId: report.id,
    });
  });
}

/** Apakah laporan sudah punya transaksi settle di buku (status DB bisa telat). */
export function reportHasSettleTxs(reportId, transactions) {
  if (!reportId) return false;
  return (transactions || []).some(
    (t) =>
      t.dailyReportId === reportId &&
      (t.source === "Settle Admin NF3" || /settle admin/i.test(t.source || ""))
  );
}

/** Sinkronkan status laporan dari transaksi settle yang sudah ada. */
export function reconcileDailyReports(reports, transactions) {
  return (reports || []).map((r) => {
    if (r.status === "settled") return r;
    if (!reportHasSettleTxs(r.id, transactions)) return r;
    return {
      ...r,
      status: "settled",
      settledAt: r.settledAt || new Date().toISOString(),
    };
  });
}

/**
 * Laporan settled harus punya tx tunai laci + transfer settle kanonik.
 * Pulihkan yang hilang (HP lama/sync) dan buang duplikat legacy.
 */
export function reconcileSettledLaciTransactions(state) {
  if (!state || typeof state !== "object") {
    return { transactions: [], deletedTransactionIds: [], changed: false };
  }
  const reports = state.dailyReports || [];
  const txs = [...(state.transactions || [])];
  const deleted = new Set(state.deletedTransactionIds || []);
  let changed = false;

  for (const rep of reports) {
    if (rep.status !== "settled") continue;
    const outlet = rep.outlet;
    const walletId = LACI_BY_OUTLET[outlet];
    if (!walletId) continue;

    const channels = rep.channelDefs?.length
      ? rep.channelDefs
      : getSettleChannels(state, rep);
    const cashAmt = Math.round(reportCashAmount(rep, channels) || rep.setoranOwner || rep.cash || 0);
    if (cashAmt <= 0) continue;

    const cid = canonicalLaporanCashTxId(rep) || `t_${rep.id}_cash`;
    const legacyCid = `t_${rep.id}_cash`;
    const tid = `t_${rep.id}_settle_trf_cash`;

    if (deleted.delete(cid)) changed = true;
    if (legacyCid !== cid && deleted.delete(legacyCid)) changed = true;
    if (deleted.delete(tid)) changed = true;

    if (!txs.some((t) => t.id === cid || t.id === legacyCid)) {
      txs.push({
        id: cid,
        type: "in",
        amount: cashAmt,
        walletId,
        date: rep.date,
        source: "Laporan harian",
        desc: `Omset tunai ${outlet}`,
        dailyReportId: rep.id,
        sourceReportId: rep.id,
        outletCode: outlet,
        reportDate: rep.date,
        reportKey: rep.reportKey || makeDailyReportKey(rep),
        transactionKind: "daily_report_cash",
      });
      changed = true;
    } else if (!txs.some((t) => t.id === cid) && txs.some((t) => t.id === legacyCid)) {
      // Migrasi id legacy → kanonik
      const li = txs.findIndex((t) => t.id === legacyCid);
      if (li >= 0) {
        txs[li] = {
          ...txs[li],
          id: cid,
          sourceReportId: rep.id,
          outletCode: outlet,
          reportDate: rep.date,
          transactionKind: "daily_report_cash",
        };
        deleted.add(legacyCid);
        changed = true;
      }
    }

    if (!txs.some((t) => t.id === tid)) {
      txs.push({
        id: tid,
        type: "transfer",
        amount: cashAmt,
        fromWalletId: walletId,
        toWalletId: "w_kas_besar",
        desc: `Setoran tunai ${outlet} · ${rep.date} → Kas Besar`,
        date: rep.date,
        source: "Settle Admin NF3",
        dailyReportId: rep.id,
        sourceReportId: rep.id,
      });
      changed = true;
    }

    for (let i = txs.length - 1; i >= 0; i--) {
      const t = txs[i];
      if (t.dailyReportId !== rep.id && t.sourceReportId !== rep.id) continue;
      if (t.id === cid || t.id === tid || t.id === legacyCid) continue;
      const from = resolveTransferIds(t).from;
      const w = resolveWalletId(t);
      const isDupCash = t.type === "in" && /laporan harian/i.test(t.source || "") && w === walletId;
      const isDupSettle = t.type === "transfer" && from === walletId && /settle/i.test(t.source || "");
      if (isDupCash || isDupSettle) {
        deleted.add(t.id);
        txs.splice(i, 1);
        changed = true;
      }
    }
  }

  return {
    transactions: txs,
    deletedTransactionIds: [...deleted].slice(-1000),
    changed,
  };
}

/**
 * Buang transaksi omset tunai yatim / dobel:
 * - duplikat omset tunai untuk outlet+tanggal yang sama (sisakan kanonik laporan surviving)
 * - tx yang terikat laporan yang sudah di-tombstone hapus
 *
 * Tidak menghapus tx yatim "sementara" saat laporan lokal belum sempat digabung ke merge —
 * itu ditangani dengan preserve local reports di mergeAppStateFromCloudPull.
 */
export function reconcileOrphanLaporanCashTxs(state) {
  if (!state || typeof state !== "object") {
    return { transactions: [], deletedTransactionIds: [], changed: false };
  }
  const reports = state.dailyReports || [];
  const reportById = new Map(reports.filter((r) => r?.id).map((r) => [r.id, r]));
  const survivingBySlot = new Map();
  for (const r of reports) {
    if (!r?.outlet || !r?.date) continue;
    const key = `${r.outlet}|${normalizeReportDate(r.date) || r.date}`;
    const prev = survivingBySlot.get(key);
    survivingBySlot.set(key, prev ? pickNewerDailyReport(prev, r) : r);
  }

  const deletedReportIds = new Set(state.deletedDailyReportIds || []);
  const deletedSlots = new Map();
  for (const s of state.deletedDailyReportSlots || []) {
    if (!s?.outlet || !s?.date) continue;
    deletedSlots.set(`${s.outlet}|${s.date}`, s);
  }

  const txs = [...(state.transactions || [])];
  const deleted = new Set(state.deletedTransactionIds || []);
  let changed = false;

  for (let i = txs.length - 1; i >= 0; i--) {
    const t = txs[i];
    if (!t || t.type !== "in" || !/laporan harian/i.test(t.source || "")) continue;

    const reportId = t.dailyReportId || t.sourceReportId || t.meta?.sourceReportId || null;
    const linked = reportId ? reportById.get(reportId) : null;
    const outletFromDesc = String(t.desc || "").match(/Omset tunai\s+(\w+)/i)?.[1] || t.outletCode || t.meta?.outletCode || null;
    const outlet = linked?.outlet || outletFromDesc;
    const date = linked?.date || t.reportDate || t.meta?.reportDate || t.date;
    const slot = outlet && date ? `${outlet}|${normalizeReportDate(date) || date}` : null;
    const survivor = slot ? survivingBySlot.get(slot) : null;
    const slotTomb = slot ? deletedSlots.get(slot) : null;

    // Ada laporan aktif di slot → jangan hapus tx hanya karena tombstone slot lama
    if (survivor) continue;

    // Laporan sudah dihapus resmi (tombstone) dan tidak ada pengganti → bersihkan tx terkait
    if ((reportId && deletedReportIds.has(reportId)) || (slotTomb && !linked && !survivor)) {
      deleted.add(t.id);
      txs.splice(i, 1);
      changed = true;
    }
  }

  // Slot dengan survivor: pastikan tidak ada dua omset tunai aktif — sisakan id kanonik
  for (const [slot, survivor] of survivingBySlot) {
    const [outlet] = slot.split("|");
    const walletId = LACI_BY_OUTLET[outlet];
    const cashIds = [];
    for (const t of txs) {
      if (t?.type !== "in" || !/laporan harian/i.test(t.source || "")) continue;
      const w = resolveWalletId(t);
      if (walletId && w && w !== walletId) continue;
      const descOk = (t.desc || "").includes(`Omset tunai ${outlet}`)
        && (normalizeReportDate(t.date) || t.date) === (normalizeReportDate(survivor.date) || survivor.date);
      const linkedOk = t.dailyReportId === survivor.id || t.sourceReportId === survivor.id;
      const canonOk = t.id === canonicalLaporanCashTxId(survivor);
      if (descOk || linkedOk || canonOk) cashIds.push(t.id);
    }
    if (cashIds.length <= 1) continue;
    const prefer = canonicalLaporanCashTxId(survivor) || `t_${survivor.id}_cash`;
    const keepId = cashIds.includes(prefer)
      ? prefer
      : (cashIds.includes(`t_${survivor.id}_cash`) ? `t_${survivor.id}_cash` : cashIds[0]);
    for (const id of cashIds) {
      if (id === keepId) continue;
      const idx = txs.findIndex((t) => t.id === id);
      if (idx >= 0) {
        deleted.add(id);
        txs.splice(idx, 1);
        changed = true;
      }
    }
  }

  if (changed) {
    logDailyReportStage("orphan_cash_reconciled", {
      deletedCount: [...deleted].filter((id) => !(state.deletedTransactionIds || []).includes(id)).length,
    });
  }

  return {
    transactions: txs,
    deletedTransactionIds: [...deleted].slice(-1000),
    changed,
  };
}

/**
 * Reconcile idempotent: 1 laporan kanonik → tepat 1 set transaksi generated.
 * Aman dijalankan 1× atau 10× — state akhir sama.
 */
export function reconcileDailyReportTransactions(state, report) {
  if (!state || !report?.id || !report.outlet || !report.date) {
    return { transactions: state?.transactions || [], deletedTransactionIds: state?.deletedTransactionIds || [], changed: false, report };
  }
  const doc = {
    ...state,
    transactions: [...(state.transactions || [])],
    deletedTransactionIds: [...(state.deletedTransactionIds || [])],
    dailyReports: state.dailyReports || [report],
  };
  const deleted = new Set(doc.deletedTransactionIds);
  let changed = false;

  let cashAmt = 0;
  try {
    cashAmt = Math.max(0, Math.round(Number(reportCashAmount(report)) || 0));
  } catch { /* ignore */ }
  if (!(cashAmt > 0)) {
    cashAmt = Math.max(0, Math.round(Number(report.setoranOwner ?? report.cash) || 0));
  }
  if (!(cashAmt > 0) && report.channels && typeof report.channels === "object") {
    cashAmt = Math.max(0, Math.round(Number(report.channels.tunai ?? report.channels.cash ?? 0) || 0));
  }

  const walletId = LACI_BY_OUTLET[report.outlet];
  const canonId = canonicalLaporanCashTxId(report);
  const cashIds = collectDailyReportCashTxIds(doc.transactions, report);

  if (cashAmt > 0 && walletId && canonId) {
    const keep = doc.transactions.find((t) => t.id === canonId)
      || doc.transactions.find((t) => cashIds.includes(t.id));
    // Buang semua cash slot kecuali kanonik
    for (const id of cashIds) {
      if (id === canonId) continue;
      const idx = doc.transactions.findIndex((t) => t.id === id);
      if (idx >= 0) {
        deleted.add(id);
        doc.transactions.splice(idx, 1);
        changed = true;
      }
    }
    const desired = {
      id: canonId,
      type: "in",
      amount: cashAmt,
      walletId,
      desc: `Omset tunai ${report.outlet}`,
      date: normalizeReportDate(report.date) || report.date,
      source: "Laporan harian",
      dailyReportId: report.id,
      sourceReportId: report.id,
      sourceSubmissionId: report.submissionId || report.idempotencyKey || null,
      outletCode: report.outlet,
      reportDate: normalizeReportDate(report.date) || report.date,
      reportKey: report.reportKey || makeDailyReportKey(report),
      transactionKind: "daily_report_cash",
      idempotencyKey: `${report.reportKey || report.submissionId || report.id}|cash`,
      categoryId: keep?.categoryId,
      meta: {
        source: "daily_report",
        sourceReportId: report.id,
        sourceSubmissionId: report.submissionId || report.idempotencyKey || null,
        outletCode: report.outlet,
        reportDate: normalizeReportDate(report.date) || report.date,
        transactionKind: "daily_report_cash",
      },
    };
    const ti = doc.transactions.findIndex((t) => t.id === canonId);
    if (ti >= 0) {
      const prev = doc.transactions[ti];
      if (
        prev.amount !== desired.amount
        || prev.dailyReportId !== desired.dailyReportId
        || prev.sourceReportId !== desired.sourceReportId
      ) {
        doc.transactions[ti] = { ...prev, ...desired };
        changed = true;
      }
    } else {
      doc.transactions.push(desired);
      changed = true;
    }
    deleted.delete(canonId);
  } else {
    // Tidak ada omset tunai — hapus generated cash slot
    for (const id of cashIds) {
      const idx = doc.transactions.findIndex((t) => t.id === id);
      if (idx >= 0) {
        deleted.add(id);
        doc.transactions.splice(idx, 1);
        changed = true;
      }
    }
  }

  return {
    transactions: doc.transactions,
    deletedTransactionIds: [...deleted].slice(-1000),
    changed,
    report,
  };
}

/**
 * Terapkan hasil submit/settle ke dokumen state secara atomik (satu mutate).
 * Mencegah push tx dobel bila id / reportKey sudah ada — unique upsert per slot.
 */
export function applyDailyReportMutation(doc, { report, txs = [], removeIds = [] } = {}) {
  if (!doc || !report?.id) return doc;
  if (!doc.dailyReports) doc.dailyReports = [];
  if (!doc.transactions) doc.transactions = [];
  if (!doc.deletedTransactionIds) doc.deletedTransactionIds = [];

  const remove = new Set(removeIds || []);
  if (remove.size) {
    doc.transactions = doc.transactions.filter((t) => !remove.has(t.id));
    const tomb = new Set(doc.deletedTransactionIds);
    for (const id of remove) {
      // Jangan tombstone id yang akan di-upsert lagi di langkah berikutnya
      if ((txs || []).some((t) => t?.id === id)) continue;
      tomb.add(id);
    }
    doc.deletedTransactionIds = [...tomb].slice(-1000);
  }

  const reportKey = report.reportKey || makeDailyReportKey(report);
  const normalizedDate = normalizeReportDate(report.date) || report.date;
  const enriched = { ...report, date: normalizedDate, ...(reportKey ? { reportKey } : {}) };

  const i = doc.dailyReports.findIndex((r) => {
    if (!r) return false;
    if (r.id === enriched.id) return true;
    if (reportKey && (r.reportKey === reportKey || makeDailyReportKey(r) === reportKey)) return true;
    return r.outlet === enriched.outlet && (normalizeReportDate(r.date) || r.date) === normalizedDate;
  });
  // Mutasi eksplisit (submit/settle/recover): payload masuk menang.
  // Jangan pakai pickNewer-by-total — itu bisa menolak edit nominal lebih kecil dan menyisakan "dua kebenaran".
  if (i >= 0) doc.dailyReports[i] = enriched;
  else doc.dailyReports.push(enriched);

  // Canonical: buang duplikat slot yang kalah merge
  if (reportKey || (enriched.outlet && normalizedDate)) {
    const keepId = doc.dailyReports.find((r) =>
      r.id === enriched.id
      || (reportKey && (r.reportKey === reportKey || makeDailyReportKey(r) === reportKey))
      || (r.outlet === enriched.outlet && (normalizeReportDate(r.date) || r.date) === normalizedDate)
    )?.id;
    if (keepId) {
      doc.dailyReports = doc.dailyReports.filter((r) => {
        if (r.id === keepId) return true;
        const sameKey = reportKey && (r.reportKey === reportKey || makeDailyReportKey(r) === reportKey);
        const sameSlot = r.outlet === enriched.outlet && (normalizeReportDate(r.date) || r.date) === normalizedDate;
        return !(sameKey || sameSlot);
      });
    }
  }

  for (const t of txs || []) {
    if (!t?.id) continue;
    const ti = doc.transactions.findIndex((x) => x.id === t.id);
    if (ti >= 0) doc.transactions[ti] = { ...doc.transactions[ti], ...t };
    else doc.transactions.push(t);
    // Pastikan id kanonik tidak tertahan di tombstone
    doc.deletedTransactionIds = (doc.deletedTransactionIds || []).filter((id) => id !== t.id);
  }

  // Reconcile generated cash untuk laporan ini (idempotent)
  const reconciled = reconcileDailyReportTransactions(doc, enriched);
  if (reconciled.changed) {
    doc.transactions = reconciled.transactions;
    doc.deletedTransactionIds = reconciled.deletedTransactionIds;
  }

  // SMT-only hard guard: 1 laporan slot → tepat 1 cash kanonik (buang legacy t_dr_*_cash)
  if (enriched.outlet === "SMT") {
    enforceSingleSmtGeneratedCash(doc, enriched.date);
  }

  return doc;
}

/**
 * Guard khusus Samtaro (SMT): buang omset tunai generated dobel untuk tanggal sama.
 * Outlet lain tidak disentuh. Tx manual (bukan "Laporan harian") tidak disentuh.
 */
export function enforceSingleSmtGeneratedCash(doc, date) {
  if (!doc || typeof doc !== "object") return { changed: false, keptId: null, removedIds: [] };
  const d = normalizeReportDate(date) || String(date || "").trim();
  if (!d) return { changed: false, keptId: null, removedIds: [] };

  const walletId = LACI_BY_OUTLET.SMT;
  const canonId = canonicalLaporanCashTxId({ outlet: "SMT", date: d });
  const txs = [...(doc.transactions || [])];
  const candidates = txs.filter((t) => {
    if (!t?.id || t.type !== "in") return false;
    if (!/laporan harian/i.test(t.source || "")) return false;
    const w = resolveWalletId(t);
    if (walletId && w && w !== walletId) return false;
    return isGeneratedLaporanCashTx(t, "SMT", d) || t.id === canonId;
  });

  if (candidates.length === 0) {
    return { changed: false, keptId: canonId, removedIds: [] };
  }
  if (candidates.length === 1 && candidates[0].id === canonId) {
    return { changed: false, keptId: canonId, removedIds: [] };
  }

  const prefer = candidates.find((t) => t.id === canonId)
    || candidates.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
  const removedIds = candidates.filter((t) => t.id !== prefer.id).map((t) => t.id);
  const deleted = new Set(doc.deletedTransactionIds || []);
  for (const id of removedIds) deleted.add(id);

  const survivor = {
    ...prefer,
    id: canonId,
    walletId,
    desc: "Omset tunai SMT",
    date: d,
    source: "Laporan harian",
    outletCode: "SMT",
    reportDate: d,
    transactionKind: "daily_report_cash",
    meta: {
      ...(prefer.meta || {}),
      outletCode: "SMT",
      reportDate: d,
      transactionKind: "daily_report_cash",
    },
  };
  deleted.delete(canonId);

  const drop = new Set(candidates.map((t) => t.id));
  doc.transactions = txs.filter((t) => !drop.has(t.id));
  doc.transactions.push(survivor);
  doc.deletedTransactionIds = [...deleted].slice(-1000);

  const removedLog = [...new Set([
    ...removedIds,
    prefer.id !== canonId ? prefer.id : null,
  ].filter(Boolean))];

  logDailyReportStage("smt_enforce_single_cash", {
    outletCode: "SMT",
    reportDate: d,
    keptId: canonId,
    removedIds: removedLog,
    beforeCount: candidates.length,
    afterCount: 1,
  });

  return { changed: true, keptId: canonId, removedIds: removedLog };
}

/**
 * Hitung ringkas hasil 1 submission SMT (untuk assert / logging).
 */
export function countSmtSubmissionArtifacts(state, date) {
  const d = normalizeReportDate(date) || String(date || "").trim();
  const reports = (state?.dailyReports || []).filter(
    (r) => r?.outlet === "SMT" && (normalizeReportDate(r.date) || r.date) === d
  );
  const canonId = canonicalLaporanCashTxId({ outlet: "SMT", date: d });
  const cash = (state?.transactions || []).filter((t) => {
    if (!t || t.type !== "in" || !/laporan harian/i.test(t.source || "")) return false;
    if (!isGeneratedLaporanCashTx(t, "SMT", d) && t.id !== canonId) return false;
    const w = resolveWalletId(t);
    if (w && w !== LACI_BY_OUTLET.SMT) return false;
    return true;
  });
  return {
    reportCount: reports.length,
    cashCount: cash.length,
    reportIds: reports.map((r) => r.id),
    cashIds: cash.map((t) => t.id),
  };
}

function openReports(reports, transactions) {
  const list = reconcileDailyReports(reports, transactions);
  const settledKeys = new Set(
    list.filter((r) => r.status === "settled").map((r) => `${r.outlet}|${r.date}`)
  );
  return list
    .filter((r) => {
      if (r.status === "settled") return false;
      if (settledKeys.has(`${r.outlet}|${r.date}`)) return false;
      if (reportHasSettleTxs(r.id, transactions)) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.outlet || "").localeCompare(b.outlet || ""));
}

export function reportsAwaitingVerify(reports, transactions) {
  return openReports(reports, transactions).filter((r) => r.status === "submitted");
}

export function reportsReadyToSettle(reports, transactions) {
  return openReports(reports, transactions).filter((r) => r.status === "admin_verified");
}

export function reportsAwaitingRevision(reports, transactions) {
  return openReports(reports, transactions).filter((r) => r.status === "revision_requested");
}

/** Apakah laporan ini menunggu kasir revisi (status DB atau notif admin). */
export function reportAwaitingKasirRevision(report, staffMessages, outlet) {
  return revisionStillPending(report, staffMessages, outlet);
}

/** Laporan revisi terbaru untuk outlet kasir (bisa tanggal kemarin). */
export function findPendingRevisionReport(reports, outlet, staffMessages) {
  if (!outlet) return null;
  const pending = (reports || [])
    .filter((r) => r.outlet === outlet && revisionStillPending(r, staffMessages, outlet))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (pending.length) return pending[0];

  const msg = (staffMessages || [])
    .filter((m) => isRevisionRequestMessage(m) && m.target?.value === outlet && !m.meta?.fulfilledAt && !m.meta?.cancelled)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
  if (!msg) return null;

  const rep = (reports || []).find(
    (r) =>
      r.outlet === outlet
      && r.status !== "settled"
      && (r.id === msg.meta?.dailyReportId || r.date === msg.meta?.reportDate)
  );
  return rep && revisionStillPending(rep, staffMessages, outlet) ? rep : null;
}

/** Laporan submitted + admin_verified (menunggu tindakan admin/owner). */
export function pendingReports(reports, transactions) {
  return openReports(reports, transactions).filter((r) =>
    r.status === "submitted" || r.status === "admin_verified"
  );
}

/** Riwayat semua laporan untuk owner — tampilkan semua, tidak disembunyikan. */
/** Satu laporan per outlet untuk tanggal tertentu (merge status). */
export function reportsForDate(reports, dateStr) {
  if (!dateStr) return [];
  const want = normalizeReportDate(dateStr) || String(dateStr).trim();
  const byOutlet = new Map();
  for (const r of reports || []) {
    if (!r?.outlet) continue;
    const rd = normalizeReportDate(r.date) || r.date;
    if (rd !== want) continue;
    const prev = byOutlet.get(r.outlet);
    byOutlet.set(r.outlet, prev ? pickNewerDailyReport(prev, r) : r);
  }
  return [...byOutlet.values()].sort((a, b) => (a.outlet || "").localeCompare(b.outlet || ""));
}

export function allDailyReportsForAdmin(reports, transactions, { days = 14 } = {}) {
  const list = reconcileDailyReports(reports, transactions);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const byDay = new Map();
  for (const r of list) {
    if (!r?.outlet || !r?.date) continue;
    const rd = normalizeReportDate(r.date) || r.date;
    if (rd < cutoffStr) continue;
    const key = dailyReportSlotKey(r.outlet, rd);
    if (!key) continue;
    const prev = byDay.get(key);
    byDay.set(key, prev ? pickNewerDailyReport(prev, { ...r, date: rd }) : { ...r, date: rd });
  }
  return [...byDay.values()].sort((a, b) =>
    (b.date || "").localeCompare(a.date || "") || (a.outlet || "").localeCompare(b.outlet || "")
  );
}

/**
 * Hard-collapse: tepat 1 dailyReport per outlet|YYYY-MM-DD di dokumen app_state.
 * Dipanggil di finalize merge/save agar race multi-request tidak menyisakan 2 laporan.
 */
export function collapseDailyReportsBySlot(doc) {
  if (!doc || typeof doc !== "object") return { changed: false };
  const list = doc.dailyReports || [];
  if (!list.length) return { changed: false };
  const byDay = new Map();
  let changed = false;
  for (const r of list) {
    if (!r?.outlet || !r?.date) {
      changed = true;
      continue;
    }
    const key = dailyReportSlotKey(r.outlet, r.date);
    if (!key) {
      changed = true;
      continue;
    }
    const normalized = {
      ...r,
      date: normalizeReportDate(r.date) || String(r.date).trim().slice(0, 10),
    };
    const prev = byDay.get(key);
    if (!prev) byDay.set(key, normalized);
    else {
      changed = true;
      byDay.set(key, pickNewerDailyReport(prev, normalized));
    }
  }
  const next = [...byDay.values()];
  if (next.length !== list.length) changed = true;
  if (changed) {
    doc.dailyReports = next;
    logDailyReportStage("collapse_reports_by_slot", {
      beforeCount: list.length,
      afterCount: next.length,
    });
  }
  return { changed, beforeCount: list.length, afterCount: next.length };
}

/**
 * Omset tunai "Laporan harian" untuk outlet+tanggal tanpa dailyReport surviving.
 * Indikasi inconsistent state (false success / lost update) — jangan push cash kedua.
 */
export function findOrphanLaporanCashForSlot(state, outlet, date) {
  const o = String(outlet || "").trim();
  const d = normalizeReportDate(date) || String(date || "").trim();
  if (!o || !d) return [];
  const hasReport = (state?.dailyReports || []).some(
    (r) => r?.outlet === o && (normalizeReportDate(r.date) || r.date) === d
  );
  if (hasReport) return [];
  const walletId = LACI_BY_OUTLET[o];
  const canon = canonicalLaporanCashTxId({ outlet: o, date: d });
  return (state?.transactions || []).filter((t) => {
    if (!t || t.type !== "in" || !/laporan harian/i.test(t.source || "")) return false;
    if (canon && t.id === canon) return true;
    if (isGeneratedLaporanCashTx(t, o, d)) return true;
    const w = resolveWalletId(t);
    if (walletId && w && w !== walletId) return false;
    return false;
  });
}

/** Slot punya orphan cash tanpa laporan → UI harus blokir "isi baru" polos. */
export function hasOrphanLaporanCashSlot(state, outlet, date) {
  return findOrphanLaporanCashForSlot(state, outlet, date).length > 0;
}

/**
 * Baca-ulang: pastikan laporan ada di dokumen (cloud/local) by reportKey / id / slot.
 */
export function findCommittedDailyReport(doc, { reportId, reportKey, submissionId, outlet, date } = {}) {
  const reports = doc?.dailyReports || [];
  if (!reports.length) return null;
  const d = normalizeReportDate(date) || date;
  if (reportId) {
    const byId = reports.find((r) => r?.id === reportId);
    if (byId) return byId;
  }
  if (submissionId) {
    const bySub = findReportBySubmissionId(reports, submissionId);
    if (bySub) return bySub;
  }
  if (reportKey) {
    const byKey = reports.find(
      (r) => r?.reportKey === reportKey || makeDailyReportKey(r) === reportKey
    );
    if (byKey) return byKey;
  }
  if (outlet && d) {
    return reports.find(
      (r) => r?.outlet === outlet && (normalizeReportDate(r.date) || r.date) === d
    ) || null;
  }
  return null;
}

/**
 * Pulihkan stub laporan dari orphan cash agar checklist/Adel melihat slot terisi
 * dan submit berikutnya jadi upsert (bukan cash kedua).
 */
export function recoverDailyReportFromOrphanCash(state, { outlet, date, user, businessId } = {}) {
  const o = String(outlet || "").trim();
  const d = normalizeReportDate(date) || String(date || "").trim();
  if (!o || !d) throw new Error("Outlet dan tanggal wajib untuk recovery orphan.");

  const existing = (state?.dailyReports || []).find(
    (r) => r?.outlet === o && (normalizeReportDate(r.date) || r.date) === d
  );
  if (existing) return { report: existing, recovered: false, txs: [] };

  const orphans = findOrphanLaporanCashForSlot(state, o, d);
  if (!orphans.length) throw new Error("Tidak ada omset yatim untuk dipulihkan.");

  const primary = orphans.slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))[0];
  const cashAmt = Math.max(0, Math.round(Number(primary.amount) || 0));
  const biz = String(businessId || state?.businessId || CANONICAL_BUSINESS_ID || "").trim() || CANONICAL_BUSINESS_ID;
  const reportKey = makeDailyReportKey({ businessId: biz, outlet: o, date: d });
  const submissionId = primary.sourceSubmissionId || primary.meta?.sourceSubmissionId
    || makeDailyReportSubmissionId({ businessId: biz, outlet: o, date: d, userId: user?.id || "recover", nonce: "orphan" });
  // Selalu id kanonik slot — jangan warisi id acak dari orphan meta (sumber duplicate historis)
  const reportId = canonicalDailyReportId({ businessId: biz, outlet: o, date: d, reportKey })
    || primary.sourceReportId || primary.dailyReportId || primary.meta?.sourceReportId
    || reportIdFromSubmissionId(submissionId);

  const channels = { tunai: cashAmt };
  const report = {
    id: reportId,
    outlet: o,
    date: d,
    businessId: biz,
    reportKey,
    // submitting = incomplete → submit berikutnya replace (bukan reject "sudah dikirim")
    status: "submitting",
    channels,
    total: cashAmt,
    cash: cashAmt,
    setoranOwner: cashAmt,
    submittedAt: null,
    submittedBy: user?.id || primary.meta?.createdById || null,
    submittedByName: user?.name || primary.meta?.createdByName || "recovery",
    submissionId,
    idempotencyKey: submissionId,
    recoveredFromOrphan: true,
    commitStatus: "recovered",
  };

  logDailyReportStage("orphan_report_recovered", {
    action: "recover",
    result: "ok",
    reportId: report.id,
    outletCode: o,
    reportDate: d,
    reportKey,
    submissionId,
    cashAmt,
    orphanTxIds: orphans.map((t) => t.id),
  });

  return { report, recovered: true, txs: orphans };
}

export { reportCashAmount, reportChannelTotal };
