// lib/staffMessages.js — pengumuman admin/owner ke staf (via app_state)

import { isStaffMessageStale } from "./notificationCatalog.js";

function shortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function isRevisionRequestMessage(msg) {
  if (msg?.kind === "revision_request") return true;
  return /^⚠\s*Revisi laporan omset/i.test(String(msg?.title || ""));
}

export function revisionMessageReportDate(msg) {
  if (msg?.meta?.reportDate) return msg.meta.reportDate;
  const t = String(msg?.title || "");
  const m = t.match(/·\s*(\d{1,2})\s+(\w+)/);
  if (!m) return null;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6, jul: 7, agu: 8, sep: 9, okt: 10, nov: 11, des: 12 };
  const mon = months[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const year = new Date().getFullYear();
  const day = String(m[1]).padStart(2, "0");
  const month = String(mon).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Notif revisi terbaru untuk laporan outlet+tanggal (atau id laporan). */
export function findRevisionMessageForReport(staffMessages, { reportId, reportDate, outlet } = {}) {
  if (!outlet) return null;
  const list = (staffMessages || [])
    .filter((m) => isRevisionRequestMessage(m) && m.target?.value === outlet)
    .filter(
      (m) =>
        (reportId && m.meta?.dailyReportId === reportId)
        || (reportDate && m.meta?.reportDate === reportDate)
    )
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return list[0] || null;
}

/** Apakah permintaan revisi masih aktif (belum dikirim ulang kasir). */
export function revisionStillPending(report, staffMessages, outlet) {
  if (!report || report.status === "settled" || report.status === "admin_verified") return false;
  if (report.status !== "revision_requested") return false;
  const o = outlet || report.outlet;
  const msg = findRevisionMessageForReport(staffMessages, {
    reportId: report.id,
    reportDate: report.date,
    outlet: o,
  });

  if (msg?.meta?.fulfilledAt || msg?.meta?.cancelled) return false;
  if (report.resubmittedAt && msg?.createdAt && report.resubmittedAt >= msg.createdAt) return false;
  if (report.resubmittedAt && !msg && report.revisionRequestedAt && report.resubmittedAt >= report.revisionRequestedAt) {
    return false;
  }

  return true;
}

/** Catatan revisi dari laporan atau notif admin (fallback jika status DB belum sinkron). */
export function revisionNoteForReport(report, staffMessages, outlet) {
  if (report?.revisionNote) return report.revisionNote;
  const msg = findRevisionMessageForReport(staffMessages, {
    reportId: report?.id,
    reportDate: report?.date,
    outlet,
  });
  return msg?.meta?.revisionNote || null;
}

function msgId() {
  return "msg" + Date.now() + Math.random().toString(36).slice(2, 5);
}

function fmtRp(amount) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Math.max(0, +amount || 0));
}

/** Tambah pesan ke awal list — hormati preferensi admin & dedupe. */
export function prependStaffMessage(messages, msg, prefs) {
  if (!msg) return messages || [];
  const kind = msg.kind || "broadcast";
  if (kind !== "broadcast" && prefs && prefs[kind] === false) return messages || [];
  if (msg.meta?.dedupeKey && (messages || []).some((m) => m.meta?.dedupeKey === msg.meta.dedupeKey)) return messages || [];
  return [msg, ...(messages || [])];
}

/** Dana masuk Kas Kecil dari admin keuangan → purchasing. */
export function createPurchasingFundMessage({ amount, fromWalletName, author, transactionId }) {
  const amt = Math.max(0, +amount || 0);
  if (!(amt > 0)) throw new Error("Nominal transfer tidak valid.");
  const from = fromWalletName || "Admin Keuangan";
  const roleLabel = author?.role === "owner" ? "Owner" : "Admin Keuangan";
  return {
    id: msgId(),
    kind: "purchasing_fund",
    title: `💰 Dana masuk Kas Kecil · ${fmtRp(amt)}`,
    body: `${roleLabel} (${author?.name || "Admin"}) transfer ${fmtRp(amt)} dari ${from}.\n\nSaldo Kas Kecil sudah bertambah — tap untuk catat belanja.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Admin",
    createdById: author?.id || null,
    target: { type: "role", value: "purchasing" },
    readBy: [],
    meta: { amount: amt, fromWalletName: from, transactionId: transactionId || null, dedupeKey: transactionId ? `purchasing_fund|${transactionId}` : null },
  };
}

/** Pengingat isi report sosmed harian. */
export function createSosmedReminderMessage({ outlet, date }) {
  if (!outlet || !date) throw new Error("Outlet/tanggal sosmed tidak valid.");
  return {
    id: msgId(),
    kind: "sosmed_reminder",
    title: `📱 Report Sosmed belum diisi · ${outlet}`,
    body: `Daily Report Sosmed ${outlet} tanggal ${shortDate(date)} belum dilaporkan.\n\nTap untuk isi DM, komentar, review Google, dan komplain.`,
    createdAt: new Date().toISOString(),
    createdBy: "NF3",
    createdById: null,
    target: { type: "outlet", value: outlet },
    readBy: [],
    meta: { outlet, reportDate: date, dedupeKey: `sosmed_reminder|${outlet}|${date}` },
  };
}

/** Pengingat SDM pagi outlet. */
export function createSdmReminderMessage({ outlet, date }) {
  if (!outlet || !date) throw new Error("Outlet/tanggal SDM tidak valid.");
  return {
    id: msgId(),
    kind: "sdm_reminder",
    title: `👥 SDM Pagi belum diisi · ${outlet}`,
    body: `Berapa orang masuk kerja hari ini (${shortDate(date)})?\n\nTap untuk isi SDM pagi — target omset mengikuti jumlah staf.`,
    createdAt: new Date().toISOString(),
    createdBy: "NF3",
    createdById: null,
    target: { type: "outlet", value: outlet },
    readBy: [],
    meta: { outlet, reportDate: date, dedupeKey: `sdm_reminder|${outlet}|${date}` },
  };
}

/** Konfirmasi ke kasir: laporan sudah disettle (saldo laci & Kas Besar sudah diproses). */
export function createDailyReportSettledMessage({ report, author }) {
  const outlet = report?.outlet || "";
  const date = report?.date || "";
  if (!outlet || !date) throw new Error("Data laporan tidak lengkap.");
  return {
    id: msgId(),
    kind: "daily_report_settled",
    title: `✓ Laporan disettle · ${outlet} · ${shortDate(date)}`,
    body: `Laporan omset ${shortDate(date)} sudah disettle ${author?.role === "owner" ? "owner" : "admin"}.\n\nTotal ${fmtRp(report.total)} — tunai sudah masuk Kas Besar. Tidak perlu kirim ulang.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Admin",
    createdById: author?.id || null,
    target: { type: "outlet", value: outlet },
    readBy: [],
    meta: { dailyReportId: report.id, reportDate: date, outlet, dedupeKey: `daily_report_settled|${report.id}` },
  };
}

/** Kasir: laporan dihapus admin — isi ulang dari awal. */
export function createDailyReportDeletedMessage({ report, author }) {
  const outlet = report?.outlet || "";
  const date = report?.date || "";
  if (!outlet || !date) throw new Error("Data laporan tidak lengkap.");
  return {
    id: msgId(),
    kind: "daily_report_deleted",
    title: `↩ Laporan dihapus · ${outlet} · ${shortDate(date)}`,
    body: `Admin/owner menghapus laporan omset ${shortDate(date)}.\n\nSilakan buka Laporan Omset dan kirim laporan baru dari awal.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Admin",
    createdById: author?.id || null,
    target: { type: "outlet", value: outlet },
    readBy: [],
    meta: { reportDate: date, outlet, dedupeKey: `daily_report_deleted|${report.id}|${date}` },
  };
}

/** Konfirmasi ke kasir: revisi sudah terkirim (cegah tap ulang). */
export function createRevisionSubmittedAckMessage({ report, author }) {
  const outlet = report?.outlet || "";
  const date = report?.date || "";
  if (!outlet || !date) throw new Error("Data laporan tidak lengkap.");
  return {
    id: msgId(),
    kind: "revision_submitted",
    title: `✓ Revisi terkirim · ${outlet} · ${shortDate(date)}`,
    body: `Revisi laporan omset ${shortDate(date)} sudah masuk ke admin.\n\nTotal ${fmtRp(report.total)} — tunggu verifikasi. Jangan kirim ulang kecuali admin minta lagi.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Kasir",
    createdById: author?.id || null,
    target: { type: "outlet", value: outlet },
    readBy: [],
    meta: { dailyReportId: report.id, reportDate: date, outlet, dedupeKey: `revision_submitted|${report.id}|${report.resubmittedAt || report.submittedAt || date}` },
  };
}

/** Kasir kirim laporan omset → admin verifikasi. */
export function createDailyReportSubmittedMessage({ report, author, resubmit = false }) {
  const outlet = report?.outlet || "";
  const date = report?.date || "";
  if (!outlet || !date) throw new Error("Data laporan tidak lengkap.");
  const verb = resubmit ? "kirim ulang revisi" : "mengirim laporan omset";
  return {
    id: msgId(),
    kind: "daily_report_submitted",
    title: `${resubmit ? "🔄" : "📋"} Laporan omset ${outlet} · ${shortDate(date)}`,
    body: `${author?.name || "Kasir"} ${verb}.\n\nTotal ${fmtRp(report.total)} — tap untuk verifikasi fisik & settle.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Kasir",
    createdById: author?.id || null,
    target: { type: "role", value: "admin" },
    readBy: [],
    meta: { dailyReportId: report.id, reportDate: date, outlet, total: report.total, dedupeKey: `daily_report_submitted|${report.id}` },
  };
}

/** Void kasir menunggu review admin. */
export function createVoidPendingMessage({ entry, author }) {
  const outlet = entry?.outlet || "";
  if (!outlet) throw new Error("Data void tidak lengkap.");
  return {
    id: msgId(),
    kind: "void_pending",
    title: `🚫 Void ${outlet} · ${shortDate(entry.date)}`,
    body: `${author?.name || "Kasir"} ajukan ${entry.type === "replacement" ? "koreksi transaksi" : "void/cancel"}.\n\nTxn ${entry.txnNo} · ${fmtRp(entry.amount)} — tap untuk review.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Kasir",
    createdById: author?.id || null,
    target: { type: "role", value: "admin" },
    readBy: [],
    meta: { voidLogId: entry.id, outlet, reportDate: entry.date, dedupeKey: `void_pending|${entry.id}` },
  };
}

/** Admin verifikasi laporan → kabari kasir. */
export function createDailyReportVerifiedMessage({ report, author }) {
  const outlet = report?.outlet || "";
  const date = report?.date || "";
  if (!outlet || !date) throw new Error("Data laporan tidak lengkap.");
  const roleLabel = author?.role === "owner" ? "Owner" : "Admin Keuangan";
  return {
    id: msgId(),
    kind: "daily_report_verified",
    title: `✓ Laporan ${outlet} diverifikasi · ${shortDate(date)}`,
    body: `${roleLabel} sudah verifikasi fisik & nota.\n\nMenunggu settle owner/admin — tap untuk lihat laporan.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Admin",
    createdById: author?.id || null,
    target: { type: "outlet", value: outlet },
    readBy: [],
    meta: { dailyReportId: report.id, reportDate: date, outlet, dedupeKey: `daily_report_verified|${report.id}` },
  };
}

/** Notifikasi ke kasir outlet saat admin minta revisi laporan omset. */
export function createRevisionRequestMessage({ report, note, author }) {
  const outlet = report?.outlet || "";
  const date = report?.date || "";
  const n = String(note || report?.revisionNote || "").trim();
  if (!outlet || !date || !n) throw new Error("Data revisi tidak lengkap.");

  const roleLabel = author?.role === "owner" ? "Owner" : "Admin Keuangan";
  return {
    id: msgId(),
    kind: "revision_request",
    title: `⚠ Revisi laporan omset ${outlet} · ${shortDate(date)}`,
    body: `${roleLabel} (${author?.name || "Admin"}) minta perbaikan:\n\n${n}\n\nBuka Laporan Omset → perbaiki data → tap Kirim revisi.`,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Admin",
    createdById: author?.id || null,
    target: { type: "outlet", value: outlet },
    readBy: [],
    meta: { dailyReportId: report?.id || null, reportDate: date, outlet, revisionNote: n },
  };
}

/** Sinkronkan status laporan dari notif revisi — cegah status submitted menimpa permintaan admin. */
export function applyRevisionNoticesFromMessages(reports, staffMessages) {
  const msgs = (staffMessages || []).filter((m) => {
    if (!isRevisionRequestMessage(m)) return false;
    if (m.meta?.fulfilledAt || m.meta?.cancelled) return false;
    return true;
  });
  if (!msgs.length) return reports || [];

  return (reports || []).map((r) => {
    if (!r || r.status === "settled") return r;
    // Kasir sudah kirim revisi — jangan buka lagi meski notif lama masih ada
    if (r.status === "revision_requested" && r.resubmittedAt) {
      const msg = msgs.find(
        (m) =>
          m.meta?.dailyReportId === r.id
          || (m.meta?.reportDate === r.date && m.meta?.outlet === r.outlet)
      );
      const revAt = msg?.createdAt || r.revisionRequestedAt || "";
      if (!revAt || r.resubmittedAt >= revAt || msg?.meta?.fulfilledAt) {
        return {
          ...r,
          status: "submitted",
          revisionNote: null,
          revisionRequestedAt: null,
          revisionRequestedBy: null,
          revisionRequestedByRole: null,
        };
      }
    }
    if (!r || r.status === "settled" || r.status === "revision_requested") return r;
    const msg = msgs.find(
      (m) =>
        m.meta?.dailyReportId === r.id
        || (m.meta?.reportDate === r.date && m.meta?.outlet === r.outlet)
    );
    if (!msg || !["submitted", "admin_verified"].includes(r.status)) return r;
    if (r.resubmittedAt && msg.createdAt && r.resubmittedAt >= msg.createdAt) return r;
    if (msg.meta?.fulfilledAt || msg.meta?.cancelled) return r;
    // Laporan pengganti setelah hapus (id beda, submitted lebih baru) — jangan paksa revisi lagi
    if (
      msg.meta?.dailyReportId
      && msg.meta.dailyReportId !== r.id
      && r.submittedAt
      && msg.createdAt
      && r.submittedAt > msg.createdAt
    ) {
      return r;
    }
    const note = msg.meta?.revisionNote || r.revisionNote || "Perbaiki sesuai catatan admin";
    return {
      ...r,
      status: "revision_requested",
      revisionNote: note,
      revisionRequestedAt: r.revisionRequestedAt || msg.createdAt,
      revisionRequestedByRole: r.revisionRequestedByRole || "admin",
      adminVerifiedAt: null,
      adminVerifiedBy: null,
      adminVerifyNote: null,
    };
  });
}

export function markRevisionMessagesRead(messages, dailyReportId, userId, reportDate = null) {
  if (!userId || (!dailyReportId && !reportDate)) return messages;
  return (messages || []).map((m) => {
    if (!isRevisionRequestMessage(m)) return m;
    const idMatch = dailyReportId && m.meta?.dailyReportId === dailyReportId;
    const dateMatch = reportDate && m.meta?.reportDate === reportDate;
    if (!idMatch && !dateMatch) return m;
    const readBy = new Set(m.readBy || []);
    readBy.add(userId);
    return { ...m, readBy: [...readBy] };
  });
}

/** Batalkan notif revisi saat laporan dihapus admin/owner. */
export function cancelRevisionMessagesForReport(messages, dailyReportId, reportDate = null, outlet = null) {
  const at = new Date().toISOString();
  return (messages || []).map((m) => {
    if (!isRevisionRequestMessage(m)) return m;
    const idMatch = dailyReportId && m.meta?.dailyReportId === dailyReportId;
    const dateOutletMatch =
      reportDate
      && m.meta?.reportDate === reportDate
      && (!outlet || m.meta?.outlet === outlet || m.target?.value === outlet);
    if (!idMatch && !dateOutletMatch) return m;
    return {
      ...m,
      meta: { ...(m.meta || {}), fulfilledAt: m.meta?.fulfilledAt || at, cancelled: true },
    };
  });
}

/**
 * Merge staff messages — meta.cancelled / fulfilledAt lokal tidak boleh hilang
 * saat remote masih menyimpan notif revisi lama (akar bug "Menunggu revisi" setelah hapus).
 */
export function mergeStaffMessages(remoteArr = [], localArr = []) {
  const map = new Map();
  const put = (item) => {
    if (!item?.id) return;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      return;
    }
    const prevMeta = prev.meta || {};
    const itemMeta = item.meta || {};
    const prevDone = !!(prevMeta.fulfilledAt || prevMeta.cancelled);
    const itemDone = !!(itemMeta.fulfilledAt || itemMeta.cancelled);
    let meta;
    if (itemDone && !prevDone) meta = { ...prevMeta, ...itemMeta };
    else if (prevDone && !itemDone) meta = { ...itemMeta, ...prevMeta };
    else meta = { ...prevMeta, ...itemMeta };
    if (prevMeta.cancelled || itemMeta.cancelled) meta.cancelled = true;
    if (prevMeta.fulfilledAt || itemMeta.fulfilledAt) {
      meta.fulfilledAt = prevMeta.fulfilledAt || itemMeta.fulfilledAt;
      if (itemMeta.fulfilledAt && prevMeta.fulfilledAt) {
        meta.fulfilledAt = itemMeta.fulfilledAt > prevMeta.fulfilledAt ? itemMeta.fulfilledAt : prevMeta.fulfilledAt;
      }
    }
    map.set(item.id, { ...prev, ...item, meta });
  };
  (remoteArr || []).forEach(put);
  (localArr || []).forEach(put);
  return [...map.values()];
}

/** Tandai notif "laporan omset baru" selesai setelah settle — hilang dari Pengumuman admin. */
export function fulfillSubmittedReportMessages(messages, dailyReportId, reportDate = null, outlet = null, fulfilledAt = null) {
  const at = fulfilledAt || new Date().toISOString();
  return (messages || []).map((m) => {
    if (m?.kind !== "daily_report_submitted") return m;
    const idMatch = dailyReportId && m.meta?.dailyReportId === dailyReportId;
    const slotMatch = reportDate && outlet && m.meta?.reportDate === reportDate && m.meta?.outlet === outlet;
    if (!idMatch && !slotMatch) return m;
    return {
      ...m,
      meta: { ...(m.meta || {}), fulfilledAt: m.meta?.fulfilledAt || at },
    };
  });
}

/** Tandai notif revisi selesai setelah kasir kirim ulang — cegah form revisi terbuka lagi. */
export function resolveRevisionMessages(messages, dailyReportId, userId, reportDate = null, fulfilledAt = null) {
  const at = fulfilledAt || new Date().toISOString();
  return markRevisionMessagesRead(messages, dailyReportId, userId, reportDate).map((m) => {
    if (!isRevisionRequestMessage(m)) return m;
    const idMatch = dailyReportId && m.meta?.dailyReportId === dailyReportId;
    const dateMatch = reportDate && m.meta?.reportDate === reportDate;
    if (!idMatch && !dateMatch) return m;
    return {
      ...m,
      meta: { ...(m.meta || {}), fulfilledAt: m.meta?.fulfilledAt || at },
    };
  });
}

export function createStaffMessage({ title, body, targetType = "all", targetValue = null, author }) {
  const t = String(title || "").trim();
  const b = String(body || "").trim();
  if (!t || !b) throw new Error("Judul dan isi pengumuman wajib diisi.");

  return {
    id: msgId(),
    title: t,
    body: b,
    createdAt: new Date().toISOString(),
    createdBy: author?.name || "Admin",
    createdById: author?.id || null,
    target: { type: targetType, value: targetValue || null },
    readBy: [],
  };
}

/** Apakah pesan ditujukan ke user ini? */
export function messageForUser(msg, user) {
  if (!msg?.target) return true;
  const { type, value } = msg.target;
  if (type === "all" || !type) return true;
  if (type === "role") {
    const role = user?.role || "";
    if (role === value) return true;
    // Owner juga terima notif operasional admin keuangan (verifikasi laporan, void, dll.)
    if (value === "admin" && role === "owner") return true;
    return false;
  }
  if (type === "outlet") return (user?.outlet || "") === value;
  return false;
}

export function visibleStaffMessages(messages, user) {
  return (messages || [])
    .filter(m => messageForUser(m, user))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function unreadStaffCount(messages, user, dailyReports) {
  const uid = user?.id;
  if (!uid) return 0;
  return visibleStaffMessages(messages, user)
    .filter((m) => !dailyReports?.length || !isStaffMessageStale(m, dailyReports))
    .filter((m) => !(m.readBy || []).includes(uid)).length;
}

export function markStaffMessageRead(messages, messageId, userId) {
  const list = [...(messages || [])];
  const i = list.findIndex(m => m.id === messageId);
  if (i < 0) return list;
  const readBy = new Set(list[i].readBy || []);
  if (userId) readBy.add(userId);
  list[i] = { ...list[i], readBy: [...readBy] };
  return list;
}

export function formatMessageTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
