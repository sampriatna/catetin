// lib/laporanKeuangan.js — rentang & agregasi laporan keuangan

import { resolveTransferIds, resolveWalletId } from "./transactionNormalize.js";

export function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Normalisasi tanggal laporan → YYYY-MM-DD (Asia/Jakarta).
 * Jangan bandingkan "01 Agu", ISO UTC, dan tanggal lokal mentah.
 */
export function normalizeReportDate(input) {
  if (input == null || input === "") return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(input);
  }
  const raw = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Ambil YYYY-MM-DD dari ISO / datetime
  const isoDay = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDay && raw.includes("T")) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed);
    }
    return isoDay[1];
  }
  if (isoDay) return isoDay[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
  }
  return null;
}

/** Tanggal hari ini menurut jam lokal perangkat (WIB jika HP di Indonesia). */
export function todayLocal() {
  return normalizeReportDate(new Date()) || localISO(new Date());
}

export function parseISODate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Senin sebagai awal minggu (ISO-style). */
export function weekBounds(isoDate) {
  const d = parseISODate(isoDate);
  const dow = d.getDay();
  const toMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setDate(d.getDate() + toMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: localISO(mon), end: localISO(sun) };
}

export function monthBounds(isoDate) {
  const d = parseISODate(isoDate);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: localISO(first), end: localISO(last) };
}

/**
 * @param {"Harian"|"Mingguan"|"Bulanan"|"Custom"} range
 * @param {string} anchorDate — hari acuan (ISO)
 * @param {{ customStart?: string, customEnd?: string }} custom
 */
export function getPeriodBounds(range, anchorDate, custom = {}) {
  const anchor = anchorDate || localISO(new Date());
  if (range === "Harian") {
    return { start: anchor, end: anchor };
  }
  if (range === "Mingguan") {
    return weekBounds(anchor);
  }
  if (range === "Bulanan") {
    return monthBounds(anchor);
  }
  if (range === "Custom") {
    let start = custom.customStart || anchor;
    let end = custom.customEnd || anchor;
    if (start > end) [start, end] = [end, start];
    return { start, end };
  }
  return { start: anchor, end: anchor };
}

export function shiftAnchor(range, anchorDate, direction) {
  const d = parseISODate(anchorDate);
  const dir = direction >= 0 ? 1 : -1;
  if (range === "Harian") d.setDate(d.getDate() + dir);
  else if (range === "Mingguan") d.setDate(d.getDate() + dir * 7);
  else if (range === "Bulanan") d.setMonth(d.getMonth() + dir);
  else return anchorDate;
  return localISO(d);
}

/** Semua tanggal ISO dari start sampai end inklusif. */
export function eachDayISO(start, end) {
  const out = [];
  const cur = parseISODate(start);
  const last = parseISODate(end);
  while (cur <= last) {
    out.push(localISO(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function formatPeriodLabel(range, bounds) {
  const fmtShort = (iso) =>
    parseISODate(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const fmtMonth = (iso) =>
    parseISODate(iso).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  if (range === "Harian") {
    const d = parseISODate(bounds.start);
    const wd = d.toLocaleDateString("id-ID", { weekday: "long" });
    return `${wd}, ${fmtShort(bounds.start)}`;
  }
  if (range === "Mingguan") {
    if (bounds.start === bounds.end) return fmtShort(bounds.start);
    return `${fmtShort(bounds.start)} – ${fmtShort(bounds.end)}`;
  }
  if (range === "Bulanan") {
    return fmtMonth(bounds.start);
  }
  if (bounds.start === bounds.end) return fmtShort(bounds.start);
  return `${fmtShort(bounds.start)} – ${fmtShort(bounds.end)}`;
}

export function filterTransactions(transactions, { start, end, walletId, catIn, catOut, includeTransfer = false }) {
  return (transactions || []).filter((t) => {
    if (!includeTransfer && t.type === "transfer") return false;
    if (t.date < start || t.date > end) return false;
    if (walletId && walletId !== "all") {
      if (t.type === "transfer") {
        const { from, to } = resolveTransferIds(t);
        if (from !== walletId && to !== walletId) return false;
      } else if (resolveWalletId(t) !== walletId) return false;
    }
    if (t.type === "in" && catIn && catIn !== "all" && t.categoryId !== catIn) return false;
    if (t.type === "out" && catOut && catOut !== "all" && t.categoryId !== catOut) return false;
    return true;
  });
}

/** Chart points: pemasukan & pengeluaran per hari (transfer diabaikan). */
export function buildCashflowChart(transactions, start, end, shortDateFn) {
  const days = eachDayISO(start, end);
  const inOut = (transactions || []).filter((t) => t.type === "in" || t.type === "out");
  return days.map((d) => {
    const day = inOut.filter((t) => t.date === d);
    return {
      day: shortDateFn ? shortDateFn(d) : d.slice(5),
      iso: d,
      in: day.filter((t) => t.type === "in").reduce((a, t) => a + t.amount, 0),
      out: day.filter((t) => t.type === "out").reduce((a, t) => a + t.amount, 0),
    };
  });
}

export function sumInOut(transactions) {
  const list = (transactions || []).filter((t) => t.type === "in" || t.type === "out");
  const inSum = list.filter((t) => t.type === "in").reduce((a, t) => a + t.amount, 0);
  const outSum = list.filter((t) => t.type === "out").reduce((a, t) => a + t.amount, 0);
  return { inSum, outSum, net: inSum - outSum, count: list.length };
}
