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
import { todayLocal } from "./laporanKeuangan.js";
import { pickNewerDailyReport } from "./dailyReportMerge.js";
import { isRevisionRequestMessage, revisionStillPending } from "./staffMessages.js";
import { resolveWalletId, resolveTransferIds } from "./transactionNormalize.js";
import { canDo } from "./rbac.js";
import { filterDeletedDailyReports } from "./dailyReportDelete.js";

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

function findCat(categories, hint, type = "in") {
  return (categories || []).find(
    (c) => c.type === type && c.active !== false && c.name.toLowerCase().includes(hint.toLowerCase())
  );
}

/** Log terstruktur untuk audit submit/settle (browser + Node). */
export function logDailyReportStage(stage, payload = {}) {
  const entry = {
    scope: "daily_report",
    stage,
    at: new Date().toISOString(),
    ...payload,
  };
  try {
    if (typeof console !== "undefined" && console.info) {
      console.info("[daily_report]", JSON.stringify(entry));
    }
  } catch { /* ignore */ }
  return entry;
}

/** Buat submission_id / idempotency_key sekali di frontend; dipakai ulang saat retry. */
export function makeDailyReportSubmissionId({ outlet, date, userId, nonce } = {}) {
  const o = String(outlet || "X").trim() || "X";
  const d = String(date || "").trim() || "nodate";
  const u = String(userId || "anon").trim() || "anon";
  const n = String(nonce || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  return `${o}|${d}|${u}|${n}`;
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

/** Semua transaksi omset tunai dari laporan harian untuk outlet+tanggal (termasuk duplikat revisi). */
export function collectDailyReportCashTxIds(transactions, report) {
  const outlet = report?.outlet;
  const date = report?.date;
  if (!outlet || !date) return [];
  const ids = [];
  (transactions || []).forEach((t) => {
    const src = (t.source || "").toLowerCase();
    if (!/laporan harian/.test(src) || t.type !== "in" || t.date !== date) return;
    const desc = t.desc || "";
    if (desc !== `Omset tunai ${outlet}` && !desc.includes(`Omset tunai ${outlet}`)) return;
    ids.push(t.id);
  });
  return ids;
}

/** Semua transaksi terkait laporan (tunai laci + settle admin) — untuk hapus owner. */
export function collectAllDailyReportTxIds(transactions, report) {
  const reportId = report?.id;
  const ids = new Set(collectDailyReportCashTxIds(transactions, report));
  (transactions || []).forEach((t) => {
    if (t?.dailyReportId === reportId) ids.add(t.id);
  });
  return [...ids];
}

function cashTxForReport(state, reportId, cashAmt, walletId, outlet, date, cashCh) {
  if (!(cashAmt > 0)) return null;
  const hint = cashCh.categoryHint || "tunai";
  const cat = findCat(state.categories, hint) || findCat(state.categories, "penjualan");
  return {
    id: `t_${reportId}_cash`,
    type: "in",
    amount: cashAmt,
    categoryId: cat?.id,
    walletId,
    desc: `Omset tunai ${outlet}`,
    date,
    source: "Laporan harian",
    dailyReportId: reportId,
  };
}

/**
 * Kasir submit laporan omset.
 * - Tunai (role cash) → transaksi masuk laci outlet
 * - Channel lain → dicatat di laporan, settle Admin NF3
 * - physicalCashEnd opsional: tunai = fisik − floor (modal statis)
 * - submissionId / idempotencyKey: request ulang mengembalikan hasil sebelumnya (tanpa tx baru)
 */
export function submitDailyReport(state, payload) {
  const { user } = payload;
  const submissionId = String(payload.submissionId || payload.idempotencyKey || "").trim() || null;
  const computed = computeReportPayload(state, payload);
  const { outlet, walletId, channels, cashCh, floor, amounts, physical, cashAmt, total, legacy, date } = computed;

  logDailyReportStage("submit_started", {
    submissionId,
    outletId: outlet,
    reportDate: date,
    nominal: total,
    cashAmt,
    userId: user?.id || null,
  });

  const reports = filterDeletedDailyReports(state.dailyReports || [], state);

  // Idempotency: request yang sama → kembalikan laporan + tx kanonik yang sudah ada
  const prior = findReportBySubmissionId(reports, submissionId);
  if (prior) {
    const existingTxs = (state.transactions || []).filter(
      (t) => t.dailyReportId === prior.id && /laporan harian/i.test(t.source || "")
    );
    logDailyReportStage("submit_idempotent_hit", {
      submissionId,
      reportId: prior.id,
      outletId: outlet,
      reportDate: date,
      walletTransactionIds: existingTxs.map((t) => t.id),
    });
    return { report: prior, txs: existingTxs, idempotent: true };
  }

  const conflict = reports.find((r) => r.outlet === outlet && r.date === date);
  if (conflict) {
    if (conflict.status === "revision_requested") {
      logDailyReportStage("submit_rejected", { submissionId, reason: "revision_requested", reportId: conflict.id });
      throw new Error("Admin minta revisi — buka laporan dan kirim ulang (bukan laporan baru).");
    }
    if (SETTLED_REPORT_STATUSES.has(conflict.status)) {
      logDailyReportStage("submit_rejected", { submissionId, reason: "already_settled", reportId: conflict.id });
      throw new Error(`Laporan ${date} ${outlet} sudah disettle. Hubungi admin keuangan jika perlu koreksi.`);
    }
    logDailyReportStage("submit_rejected", { submissionId, reason: "already_submitted", reportId: conflict.id });
    throw new Error(`Laporan ${date} untuk ${outlet} sudah dikirim.`);
  }

  const reportId = submissionId ? reportIdFromSubmissionId(submissionId) : `dr${Date.now()}`;
  const report = {
    id: reportId,
    date,
    outlet,
    kasirId: user.id,
    kasirName: user.name,
    channels: { ...amounts },
    channelDefs: snapshotChannelDefs(channels),
    physicalCashEnd: physical || null,
    laciFloor: floor,
    setoranOwner: cashAmt,
    ...legacy,
    total,
    status: "submitted",
    submittedAt: new Date().toISOString(),
    ...(submissionId ? { submissionId, idempotencyKey: submissionId } : {}),
  };

  const txs = [];
  const cashTx = cashTxForReport(state, report.id, cashAmt, walletId, outlet, date, cashCh);
  if (cashTx) {
    if (submissionId) cashTx.idempotencyKey = `${submissionId}|cash`;
    txs.push(cashTx);
  }

  logDailyReportStage("submit_built", {
    submissionId,
    reportId: report.id,
    outletId: outlet,
    reportDate: date,
    nominal: total,
    walletTransactionIds: txs.map((t) => t.id),
  });

  return { report, txs, idempotent: false };
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
  };

  const removeIds = collectDailyReportCashTxIds(state.transactions, report);

  const txs = [];
  const cashTx = cashTxForReport(state, reportId, cashAmt, walletId, outlet, date, cashCh);
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
  return { report, removeIds };
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
    const hasCashIn = cashTxIds.length > 0
      || (state.transactions || []).some(
        (t) => t.id === `t_${reportId}_cash` && resolveWalletId(t) === walletId
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

    const cid = `t_${rep.id}_cash`;
    const tid = `t_${rep.id}_settle_trf_cash`;

    if (deleted.delete(cid)) changed = true;
    if (deleted.delete(tid)) changed = true;

    if (!txs.some((t) => t.id === cid)) {
      txs.push({
        id: cid,
        type: "in",
        amount: cashAmt,
        walletId,
        date: rep.date,
        source: "Laporan harian",
        desc: `Omset tunai ${outlet}`,
        dailyReportId: rep.id,
      });
      changed = true;
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
      });
      changed = true;
    }

    for (let i = txs.length - 1; i >= 0; i--) {
      const t = txs[i];
      if (t.dailyReportId !== rep.id) continue;
      if (t.id === cid || t.id === tid) continue;
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
    const key = `${r.outlet}|${r.date}`;
    const prev = survivingBySlot.get(key);
    survivingBySlot.set(key, prev ? pickNewerDailyReport(prev, r) : r);
  }

  const deletedReportIds = new Set(state.deletedDailyReportIds || []);
  const deletedSlots = new Set(
    (state.deletedDailyReportSlots || [])
      .filter((s) => s?.outlet && s?.date)
      .map((s) => `${s.outlet}|${s.date}`)
  );

  const txs = [...(state.transactions || [])];
  const deleted = new Set(state.deletedTransactionIds || []);
  let changed = false;

  for (let i = txs.length - 1; i >= 0; i--) {
    const t = txs[i];
    if (!t || t.type !== "in" || !/laporan harian/i.test(t.source || "")) continue;

    const reportId = t.dailyReportId || null;
    const linked = reportId ? reportById.get(reportId) : null;
    const outletFromDesc = String(t.desc || "").match(/Omset tunai\s+(\w+)/i)?.[1] || null;
    const outlet = linked?.outlet || outletFromDesc;
    const date = linked?.date || t.date;
    const slot = outlet && date ? `${outlet}|${date}` : null;

    // Laporan sudah dihapus resmi (tombstone) → bersihkan tx terkait
    if ((reportId && deletedReportIds.has(reportId)) || (slot && deletedSlots.has(slot) && !linked)) {
      deleted.add(t.id);
      txs.splice(i, 1);
      changed = true;
    }
  }

  // Slot dengan survivor: pastikan tidak ada dua omset tunai aktif
  for (const [slot, survivor] of survivingBySlot) {
    const [outlet] = slot.split("|");
    const walletId = LACI_BY_OUTLET[outlet];
    const cashIds = [];
    for (const t of txs) {
      if (t?.type !== "in" || !/laporan harian/i.test(t.source || "")) continue;
      const w = resolveWalletId(t);
      if (walletId && w !== walletId) continue;
      const descOk = (t.desc || "").includes(`Omset tunai ${outlet}`) && t.date === survivor.date;
      const linkedOk = t.dailyReportId === survivor.id;
      if (descOk || linkedOk) cashIds.push(t.id);
    }
    if (cashIds.length <= 1) continue;
    const prefer = `t_${survivor.id}_cash`;
    const keepId = cashIds.includes(prefer) ? prefer : cashIds[0];
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
 * Terapkan hasil submit/settle ke dokumen state secara atomik (satu mutate).
 * Mencegah push tx dobel bila id sudah ada.
 */
export function applyDailyReportMutation(doc, { report, txs = [], removeIds = [] } = {}) {
  if (!doc || !report?.id) return doc;
  if (!doc.dailyReports) doc.dailyReports = [];
  if (!doc.transactions) doc.transactions = [];

  const remove = new Set(removeIds || []);
  if (remove.size) {
    doc.transactions = doc.transactions.filter((t) => !remove.has(t.id));
  }

  const i = doc.dailyReports.findIndex(
    (r) => r.id === report.id || (r.outlet === report.outlet && r.date === report.date)
  );
  if (i >= 0) doc.dailyReports[i] = pickNewerDailyReport(doc.dailyReports[i], report);
  else doc.dailyReports.push(report);

  for (const t of txs || []) {
    if (!t?.id || remove.has(t.id)) continue;
    const ti = doc.transactions.findIndex((x) => x.id === t.id);
    if (ti >= 0) doc.transactions[ti] = { ...doc.transactions[ti], ...t };
    else doc.transactions.push(t);
  }
  return doc;
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
  const byOutlet = new Map();
  for (const r of reports || []) {
    if (!r?.outlet || r.date !== dateStr) continue;
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
    if (!r?.outlet || !r?.date || r.date < cutoffStr) continue;
    const key = `${r.outlet}|${r.date}`;
    const prev = byDay.get(key);
    byDay.set(key, prev ? pickNewerDailyReport(prev, r) : r);
  }
  return [...byDay.values()].sort((a, b) =>
    (b.date || "").localeCompare(a.date || "") || (a.outlet || "").localeCompare(b.outlet || "")
  );
}

export { reportCashAmount, reportChannelTotal };
