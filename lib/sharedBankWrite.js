// lib/sharedBankWrite.js
// Write-through rekening Sam: catat dari NF → transaksi asli di bisnis sumber (FNB).
// Dompet shared_* di NF hanya pointer; saldo ikut sumber.

import { sanitizeSharedLink } from "./sharedWalletPolicy.js";
import { isSharedWallet, sharedWalletId } from "./sharedWalletMirror.js";

/** Role yang boleh catat di rekening shared dari NF. */
export function canWriteSharedBank(role) {
  return role === "owner" || role === "admin" || role === "purchasing";
}

/**
 * Validasi pengeluaran vs saldo sumber (FNB).
 * Purchasing tidak boleh lihat angka saldo → pesan tanpa nominal.
 * @returns {string|null} pesan error, atau null jika OK / PayLater
 */
export function sharedBankFloorError({
  type,
  amount,
  balance,
  walletName,
  hideAmount = false,
  allowNegative = false,
}) {
  if (type !== "out") return null;
  if (allowNegative) return null;
  const amt = Math.round(Number(amount) || 0);
  const bal = Math.round(Number(balance) || 0);
  if (!(amt > 0)) return null;
  if (bal - amt >= 0) return null;
  const name = walletName || "dompet bersama";
  if (hideAmount) return `Saldo ${name} tidak cukup untuk transaksi ini.`;
  return `Saldo tidak cukup. Saldo saat ini: ${new Intl.NumberFormat("id-ID").format(bal)}`;
}

/** Ambil shared-link aktif dari id dompet virtual `shared_<linkId>`. */
export function resolveSharedLinkFromWalletId(walletId, sharedLinks = []) {
  if (!walletId || typeof walletId !== "string") return null;
  if (!walletId.startsWith("shared_")) return null;
  const linkId = walletId.slice("shared_".length);
  const link = (sharedLinks || []).find((l) => l?.id === linkId && l.enabled !== false);
  if (!link || !sanitizeSharedLink(link)) return null;
  if (!link.sourceBusinessId || !link.sourceWalletId) return null;
  return link;
}

/**
 * Bangun transaksi untuk ditulis ke app_state bisnis sumber.
 * walletId diganti ke rekening sumber; meta menandai write-through dari NF.
 */
export function buildSourceTransaction({
  draft,
  sourceWalletId,
  fromBusinessId,
  fromBusinessName,
  user,
  txId,
}) {
  const amount = Math.round(Number(draft?.amount) || 0);
  if (!(amount > 0)) throw new Error("Nominal harus lebih dari 0.");
  if (draft?.type !== "in" && draft?.type !== "out") {
    throw new Error("Rekening bersama hanya mendukung pemasukan/pengeluaran (bukan transfer lokal).");
  }
  const baseMeta = draft?.meta && typeof draft.meta === "object" ? { ...draft.meta } : {};
  return {
    id: txId,
    type: draft.type,
    amount,
    walletId: sourceWalletId,
    categoryId: draft.categoryId || null,
    desc: draft.desc || "",
    date: draft.date || new Date().toISOString().slice(0, 10),
    source: draft.source || "NF shared bank",
    meta: {
      ...baseMeta,
      sharedWriteThrough: true,
      fromBusinessId: fromBusinessId || null,
      fromBusinessName: fromBusinessName || null,
      createdById: user?.id || baseMeta.createdById || null,
      createdByName: user?.name || baseMeta.createdByName || null,
      createdByRole: user?.role || null,
    },
  };
}

/** Sisipkan tx ke dokumen sumber (idempotent by id). */
export function appendTransactionToDoc(doc, tx) {
  const next = { ...(doc || {}) };
  const txs = Array.isArray(next.transactions) ? [...next.transactions] : [];
  if (tx?.id && txs.some((t) => t?.id === tx.id)) {
    return { doc: next, appended: false };
  }
  txs.push(tx);
  next.transactions = txs;
  return { doc: next, appended: true };
}

export function findSharedWalletIds(wallets = []) {
  return (wallets || []).filter(isSharedWallet).map((w) => w.id);
}

export { sharedWalletId, isSharedWallet };
