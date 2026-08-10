// lib/ekspedisiReport.js — ringkasan harian Dompet Ekspedisi (format laporan JNE)

import { walletBalanceAtDate } from "./purchasingKasKecil.js";
import { resolveWalletId, resolveTransferIds } from "./transactionNormalize.js";
import { FISHING_EKSPEDISI_WALLET_ID, isEkspedisiWallet } from "./walletPresets.js";

export const EKSPEDISI_CASH_CATEGORY_ID = "nf_in_ekspedisi_cash";
export const EKSPEDISI_TRF_CATEGORY_ID = "nf_in_ekspedisi_trf";
export const EKSPEDISI_COURIERS = ["JNE", "J&T", "SiCepat", "Anteraja", "Pos", "Lainnya"];

function isoDayBefore(iso) {
  if (!iso) return iso;
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Format angka seperti contoh laporan: 128.300 */
export function fmtEkspedisiRp(n) {
  const v = Math.round(Number(n) || 0);
  if (v === 0) return "-";
  return new Intl.NumberFormat("id-ID").format(Math.abs(v));
}

/** ISO yyyy-mm-dd → 07.08.2026 */
export function fmtEkspedisiDate(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function resolveEkspedisiWalletId(wallets = [], preferredId = null) {
  if (preferredId) return preferredId;
  const found = (wallets || []).find((w) => isEkspedisiWallet(w));
  return found?.id || FISHING_EKSPEDISI_WALLET_ID;
}

function looksTransferIncome(tx) {
  if (!tx) return false;
  if (tx.categoryId === EKSPEDISI_TRF_CATEGORY_ID) return true;
  if (tx.categoryId === EKSPEDISI_CASH_CATEGORY_ID) return false;
  const pay = String(tx.paymentMethod || tx.meta?.paymentMethod || "").toLowerCase();
  if (/transfer|trf|tf\b|bank/.test(pay)) return true;
  if (/cash|tunai|cod/.test(pay)) return false;
  const desc = String(tx.desc || tx.description || "").toLowerCase();
  if (/transfer|trf|tf\b/.test(desc)) return true;
  return false;
}

function expenseNote(tx) {
  const note = String(tx?.desc || tx?.description || "").trim();
  return note || null;
}

/**
 * Ringkasan 1 hari Dompet Ekspedisi:
 * Modal + Pemasukan Cash + Transfer − Pengeluaran = Total
 */
export function ekspedisiDaySummary({
  wallets = [],
  transactions = [],
  date,
  walletId = null,
} = {}) {
  const wid = resolveEkspedisiWalletId(wallets, walletId);
  const prev = isoDayBefore(date);
  const modal = walletBalanceAtDate(wid, wallets, transactions, prev);

  let cashIn = 0;
  let transferIn = 0;
  let expenseOut = 0;
  const expenseNotes = [];

  for (const t of transactions || []) {
    if (!t || t.date !== date) continue;

    if (t.type === "transfer") {
      const { from, to } = resolveTransferIds(t);
      if (to === wid) transferIn += Number(t.amount) || 0;
      else if (from === wid) {
        expenseOut += Number(t.amount) || 0;
        const note = expenseNote(t) || "Transfer keluar";
        expenseNotes.push(note);
      }
      continue;
    }

    if (resolveWalletId(t) !== wid) continue;

    if (t.type === "in") {
      const amt = Number(t.amount) || 0;
      if (looksTransferIncome(t)) transferIn += amt;
      else cashIn += amt;
    } else if (t.type === "out") {
      expenseOut += Number(t.amount) || 0;
      const note = expenseNote(t);
      if (note) expenseNotes.push(note);
    }
  }

  const total = modal + cashIn + transferIn - expenseOut;
  const ledger = walletBalanceAtDate(wid, wallets, transactions, date);

  return {
    walletId: wid,
    date,
    modal,
    cashIn,
    transferIn,
    expenseOut,
    expenseNotes,
    total,
    ledger,
  };
}

/**
 * Format WA mengikuti contoh staf:
 *
 * JNE *07.08.2026*
 *
 * _Modal : *128.300*_
 * Pemasukan Cash : 90.000
 *                  Transfer : -
 * Pengeluaran : 20.000 ( Packing Kayu JNE )
 *
 * Total: *198.300*
 */
export function formatEkspedisiWa({
  date,
  wallets = [],
  transactions = [],
  walletId = null,
  courierLabel = "JNE",
  summary = null,
} = {}) {
  const s = summary || ekspedisiDaySummary({ wallets, transactions, date, walletId });
  const label = String(courierLabel || "JNE").trim() || "JNE";
  const dateLabel = fmtEkspedisiDate(s.date || date);

  let expenseLine = `Pengeluaran : ${fmtEkspedisiRp(s.expenseOut)}`;
  if (s.expenseOut > 0 && s.expenseNotes?.length) {
    const unique = [...new Set(s.expenseNotes.filter(Boolean))];
    if (unique.length) expenseLine += ` ( ${unique.join(", ")} )`;
  }

  const lines = [
    `${label} *${dateLabel}*`,
    "",
    `_Modal : *${fmtEkspedisiRp(s.modal)}*_`,
    `Pemasukan Cash : ${fmtEkspedisiRp(s.cashIn)}`,
    `                 Transfer : ${fmtEkspedisiRp(s.transferIn)}`,
    expenseLine,
    "",
    `Total: *${fmtEkspedisiRp(s.total)}*`,
  ];

  return lines.join("\n");
}
