// lib/purchasingExpense.js — normalisasi & filter transaksi purchasing

import { walletBalance } from "./kasirHarian.js";
import { shouldHideWalletBalance } from "./walletDisplay.js";
import { isSharedWallet } from "./sharedWalletMirror.js";

export const PURCHASING_OUTLETS = [
  { code: "KBU", label: "KBU" },
  { code: "KSM", label: "KSM" },
  { code: "SMT", label: "SMT" },
  { code: "GUDANG", label: "Gudang" },
];

const KASIR_OUTLETS = new Set(["KBU", "KSM", "SMT"]);

/** Label tampilan lokasi pembelian purchasing (GUDANG → Gudang). */
export function purchasingOutletLabel(code) {
  if (!code) return "—";
  const o = PURCHASING_OUTLETS.find((x) => x.code === code);
  return o?.label || code;
}

/** Opsi lokasi pembelian purchasing + lokasi khusus user (mis. Jagasatru). */
export function purchasingOutletOptions(user) {
  const area = String(user?.outlet || "").trim();
  const base = [...PURCHASING_OUTLETS];
  if (area && !KASIR_OUTLETS.has(area.toUpperCase())) {
    const exists = base.some((o) => String(o.code || "").toLowerCase() === area.toLowerCase());
    if (!exists) base.unshift({ code: area, label: area });
  }
  return base;
}

export function formatRupiah(n) {
  const abs = Math.abs(Math.round(Number(n) || 0));
  return `Rp${new Intl.NumberFormat("id-ID").format(abs)}`;
}

export function isPurchasingTx(t) {
  if (!t || t.type !== "out") return false;
  if (t.module === "purchasing") return true;
  const src = t.source || "";
  return typeof src === "string" && src.startsWith("purchasing");
}

/**
 * Wrapper simpan transaksi purchasing via addTx() dari NF3App.
 * @returns boolean — hasil onSave()
 */
export function addPurchasingExpense(onSave, fields) {
  const items = (fields.items || []).filter((i) => i.name);
  const itemsTotal = items.reduce((s, i) => s + (i.subtotal || 0), 0);
  const meta = {
    items,
    itemsTotal,
    nominalOverride: fields.amount,
  };

  const tx = {
    type: "out",
    amount: Math.round(Number(fields.amount)),
    walletId: fields.walletId,
    categoryId: fields.categoryId,
    outlet: fields.outlet,
    supplier: fields.supplier || null,
    date: fields.date,
    desc: fields.desc || "",
    receiptUrl: fields.receiptUrl || null,
    module: "purchasing",
    source: fields.source || "purchasing:manual",
    meta,
  };

  return onSave(tx);
}

function walletAllowNegative(w) {
  return w?.type === "paylater" || w?.liability === true || w?.allowNegative === true;
}

export function checkPurchasingFloor(walletId, amount, wallets, transactions, user) {
  const w = wallets.find((x) => x.id === walletId);
  if (!w || walletAllowNegative(w)) return null;
  // Rekening shared (BCA Sam dll): saldo sumber di FNB; angka sering disembunyikan
  // dari purchasing (mirror balance=null). Jangan validasi di klien — server POST yang cek.
  if (isSharedWallet(w)) return null;
  const bal = walletBalance(walletId, wallets, transactions);
  const hidden = shouldHideWalletBalance(w, user);
  const amt = Math.round(Number(amount));
  if (!w.floor && bal - amt < 0) {
    return hidden
      ? `Saldo ${w.name} tidak cukup untuk transaksi ini.`
      : `Saldo tidak cukup. Saldo saat ini: ${new Intl.NumberFormat("id-ID").format(bal)}`;
  }
  if (!w.floor) return null;
  if (bal - amt < w.floor) {
    return hidden
      ? `Saldo ${w.name} tidak cukup untuk transaksi ini.`
      : `Saldo tidak cukup. Minimum saldo: ${new Intl.NumberFormat("id-ID").format(w.floor)} · Saldo saat ini: ${new Intl.NumberFormat("id-ID").format(bal)}`;
  }
  return null;
}

export function filterPurchasingTransactions(transactions, { start, end, outlet = "all" } = {}) {
  return (transactions || []).filter((t) => {
    if (!isPurchasingTx(t)) return false;
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (outlet && outlet !== "all" && outlet !== "Semua" && t.outlet !== outlet) return false;
    return true;
  });
}
