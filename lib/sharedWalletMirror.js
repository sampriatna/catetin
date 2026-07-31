// lib/sharedWalletMirror.js
// Mirror rekening bank lintas bisnis (read-only). Dipakai NF Nusa Fishing untuk
// menampilkan saldo & mutasi rekening Sam yang berada di FNB (Nusa Food) —
// TANPA pernah mengubah data bisnis sumber (FNB). Semua fungsi di sini murni.

import { resolveWalletId, resolveTransferIds } from "./transactionNormalize.js";
import { sanitizeSharedLinks } from "./sharedWalletPolicy.js";

const SHARED_WALLET_PREFIX = "shared_";

/** id dompet virtual (di bisnis tujuan) untuk sebuah shared-link. */
export function sharedWalletId(link) {
  return `${SHARED_WALLET_PREFIX}${link?.id ?? ""}`;
}

export function isSharedWallet(w) {
  return w?.type === "shared" || String(w?.id || "").startsWith(SHARED_WALLET_PREFIX);
}

/**
 * Hitung saldo satu dompet dari dokumen app_state (opening + transaksi).
 * Menangani transfer (from/to) dan bentuk field camelCase/snake_case.
 */
export function computeWalletBalanceFromDoc(doc, walletId) {
  if (!doc || !walletId) return 0;
  const wallet = (doc.wallets || []).find((w) => w.id === walletId);
  if (!wallet) return 0;
  const opening = Number(wallet.opening ?? wallet.opening_balance ?? 0) || 0;
  const txs = doc.transactions || [];
  const deleted = new Set(doc.deletedTransactionIds || []);

  return txs.reduce((acc, t) => {
    if (!t || (t.id != null && deleted.has(t.id))) return acc;
    const amount = Number(t.amount) || 0;
    if (t.type === "transfer") {
      const { from, to } = resolveTransferIds(t);
      if (to === walletId) return acc + amount;
      if (from === walletId) return acc - amount;
      return acc;
    }
    if (resolveWalletId(t) !== walletId) return acc;
    return acc + (t.type === "in" ? amount : -amount);
  }, opening);
}

/** Transaksi yang menyentuh sebuah dompet, diurutkan terbaru dulu (read-only). */
export function walletTransactionsFromDoc(doc, walletId, { limit = 50 } = {}) {
  if (!doc || !walletId) return [];
  const deleted = new Set(doc.deletedTransactionIds || []);
  const rows = (doc.transactions || []).filter((t) => {
    if (!t || (t.id != null && deleted.has(t.id))) return false;
    if (t.type === "transfer") {
      const { from, to } = resolveTransferIds(t);
      return from === walletId || to === walletId;
    }
    return resolveWalletId(t) === walletId;
  });
  rows.sort((a, b) => String(b.date || b.occurred_at || "").localeCompare(String(a.date || a.occurred_at || "")));
  return limit ? rows.slice(0, limit) : rows;
}

/**
 * Filter transaksi mirror untuk tampilan NF.
 * Hanya transaksi write-through dari bisnis NF aktif — mutasi FNB asli tidak ditampilkan.
 */
export function filterSharedTransactionsForView(txs, { businessId, userId, role, strictNfOrigin = true } = {}) {
  const isPurchasing = role === "purchasing";
  return (txs || []).filter((t) => {
    const meta = t?.meta || {};
    if (!meta.sharedWriteThrough) return false;
    if (businessId && meta.fromBusinessId && meta.fromBusinessId !== businessId) return false;
    if (isPurchasing && userId && meta.createdById && meta.createdById !== userId) return false;
    return true;
  });
}

/** Map transaksi sumber FNB ke id dompet virtual `shared_*` di NF. */
export function mapTransactionsToSharedWallet(txs, virtualWalletId) {
  if (!virtualWalletId) return txs || [];
  return (txs || []).map((t) => ({
    ...t,
    walletId: virtualWalletId,
    meta: {
      ...(t.meta || {}),
      sharedVirtualWalletId: virtualWalletId,
      sourceWalletId: t.walletId || t.meta?.sourceWalletId || null,
    },
  }));
}

export function flattenSharedTransactions(transactionsByWallet) {
  if (!transactionsByWallet || typeof transactionsByWallet !== "object") return [];
  return Object.values(transactionsByWallet).flat().filter(Boolean);
}

/** Gabungkan transaksi lokal NF dengan mirror shared (dedupe by id). */
export function mergeWithLocalTransactions(localTx, sharedByWallet) {
  const shared = flattenSharedTransactions(sharedByWallet);
  if (!shared.length) return localTx || [];
  const seen = new Set((localTx || []).map((t) => t?.id).filter(Boolean));
  const merged = [...(localTx || [])];
  for (const t of shared) {
    if (t?.id && !seen.has(t.id)) {
      merged.push(t);
      seen.add(t.id);
    }
  }
  return merged;
}

/**
 * Untuk tiap shared-link aktif, hitung saldo dari dokumen bisnis sumber.
 * @param {Array} sharedLinks - walletSetup.sharedLinks
 * @param {Object} sourceDocsById - { [businessId]: appStateDoc }
 * @returns {Object} map: sharedWalletId(link) -> { linkId, balance, sourceWalletName, sourceBusinessName, missing }
 */
export function mirrorBalancesForLinks(sharedLinks, sourceDocsById = {}) {
  const out = {};
  const links = sanitizeSharedLinks(sharedLinks).filter((l) => l.enabled);
  for (const link of links) {
    const doc = sourceDocsById[link.sourceBusinessId] || null;
    const hasWallet = !!doc && (doc.wallets || []).some((w) => w.id === link.sourceWalletId);
    out[sharedWalletId(link)] = {
      linkId: link.id,
      balance: hasWallet ? computeWalletBalanceFromDoc(doc, link.sourceWalletId) : 0,
      sourceWalletName: link.sourceWalletName || "",
      sourceBusinessName: link.sourceBusinessName || "",
      missing: !hasWallet,
    };
  }
  return out;
}

/** Business id unik yang perlu diambil dokumennya untuk mirror (link aktif saja). */
export function sourceBusinessIdsForLinks(sharedLinks) {
  const ids = new Set();
  for (const l of sanitizeSharedLinks(sharedLinks).filter((x) => x.enabled)) {
    if (l.sourceBusinessId) ids.add(l.sourceBusinessId);
  }
  return [...ids];
}

/**
 * Tempelkan saldo mirror ke dompet virtual `shared` (opening = saldo sumber).
 * Karena dompet shared tidak punya transaksi lokal, walletBalance lokal = opening.
 *
 * Catatan: untuk purchasing, API bisa kirim balance=null + hidden=true (angka disembunyikan).
 * Jangan timpa opening jadi null — itu membuat validasi klien mengira saldo 0.
 */
export function applyMirrorBalances(wallets, mirrorMap = {}) {
  return (wallets || []).map((w) => {
    if (!isSharedWallet(w)) return w;
    const m = mirrorMap[w.id];
    if (!m) return w;
    const bal = m.balance;
    if (bal == null || Number.isNaN(Number(bal))) {
      return { ...w, mirror: m };
    }
    return { ...w, opening: Number(bal), mirror: m };
  });
}
