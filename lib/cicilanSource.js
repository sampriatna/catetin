// lib/cicilanSource.js — tentukan dokumen & dompet sumber PayLater untuk fitur cicilan.
// FNB: dompet PayLater miliknya sendiri. Fishing: PayLater di-share dari FNB (ops_share),
// jadi rencana + transaksi cicilan ditulis ke dokumen FNB (satu akun PayLater, satu catatan).

import { sanitizeSharedLinks } from "./sharedWalletPolicy.js";
import { isSharedWallet, computeWalletBalanceFromDoc } from "./sharedWalletMirror.js";
import { resolveWalletId } from "./transactionNormalize.js";

export function canManageCicilan(role) {
  return role === "owner" || role === "admin";
}

function isPaylaterWallet(w) {
  return w?.type === "paylater" || w?.liability === true;
}

function isPaylaterLink(l) {
  return l?.sourceWalletType === "paylater" || /paylater/i.test(`${l?.label || ""} ${l?.sourceWalletName || ""}`);
}

/**
 * @returns {{ sourceBusinessId, walletId, walletName, viaLink: object|null, links: object[] } | null}
 * Link shared didahulukan — dompet PayLater lokal Fishing (legacy) tidak dipakai bila ada link.
 */
export function resolvePaylaterSource(localDoc, businessId) {
  const links = sanitizeSharedLinks(localDoc?.walletSetup?.sharedLinks).filter((l) => l.enabled);
  const link = links.find(isPaylaterLink);
  if (link && link.sourceBusinessId && link.sourceBusinessId !== businessId) {
    return {
      sourceBusinessId: link.sourceBusinessId,
      walletId: link.sourceWalletId,
      walletName: link.label || link.sourceWalletName || "PayLater",
      viaLink: link,
      links,
    };
  }
  const own = (localDoc?.wallets || []).find((w) => isPaylaterWallet(w) && w.active !== false && !isSharedWallet(w));
  if (own) {
    return { sourceBusinessId: businessId, walletId: own.id, walletName: own.name || "PayLater", viaLink: null, links };
  }
  return null;
}

/** Rekening yang boleh dipakai bayar cicilan (id = id dompet di dokumen sumber). */
export function paymentWalletsFor(source, sourceDoc) {
  const srcWallets = (sourceDoc?.wallets || []).filter((w) => w.active !== false);
  const byId = new Map(srcWallets.map((w) => [w.id, w]));
  if (source?.viaLink) {
    // Fishing: hanya rekening FNB yang memang di-share ke Fishing.
    return source.links
      .filter((l) => !isPaylaterLink(l) && l.sourceBusinessId === source.sourceBusinessId && byId.has(l.sourceWalletId))
      .map((l) => ({ id: l.sourceWalletId, name: l.label || l.sourceWalletName || byId.get(l.sourceWalletId).name, type: byId.get(l.sourceWalletId).type }));
  }
  return srcWallets
    .filter((w) => !isPaylaterWallet(w) && !isSharedWallet(w) && w.id !== source?.walletId)
    .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999))
    .map((w) => ({ id: w.id, name: w.name, type: w.type }));
}

export function expenseCategoriesFor(sourceDoc) {
  return (sourceDoc?.categories || [])
    .filter((c) => c?.type === "out" && c.active !== false && !c.deleted)
    .map((c) => ({ id: c.id, name: c.name }));
}

/** Tebak kategori bunga: "bunga"/"cicilan"/"paylater", lalu "biaya admin", lalu "lain-lain". */
export function guessBungaCategoryId(categories = []) {
  const tryRe = (re) => categories.find((c) => re.test(c.name || ""))?.id || null;
  return tryRe(/bunga|cicilan|paylater|kredit/i) || tryRe(/biaya admin|admin bank/i) || tryRe(/^lain/i) || null;
}

/** Belanja PayLater terbaru yang belum ditautkan ke rencana cicilan (untuk dipilih). */
export function unlinkedPaylaterPurchases(sourceDoc, walletId, plans = [], limit = 30) {
  const linked = new Set((plans || []).map((p) => p.purchaseTxId).filter(Boolean));
  const deleted = new Set(sourceDoc?.deletedTransactionIds || []);
  return (sourceDoc?.transactions || [])
    .filter((t) => t?.type === "out" && resolveWalletId(t) === walletId && !deleted.has(t.id) && !linked.has(t.id) && !t.meta?.cicilanPlanId)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id).localeCompare(String(a.id)))
    .slice(0, limit)
    .map((t) => ({ id: t.id, amount: Math.round(Number(t.amount) || 0), date: t.date, desc: t.desc || "" }));
}

/** Payload GET /api/cicilan. */
export function buildCicilanView(source, sourceDoc) {
  const plans = Array.isArray(sourceDoc?.cicilanPlans) ? sourceDoc.cicilanPlans : [];
  const categories = expenseCategoriesFor(sourceDoc);
  return {
    sourceBusinessId: source.sourceBusinessId,
    paylater: {
      walletId: source.walletId,
      name: source.walletName,
      balance: computeWalletBalanceFromDoc(sourceDoc, source.walletId),
    },
    plans: [...plans].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    payWallets: paymentWalletsFor(source, sourceDoc),
    categories,
    suggestedBungaCategoryId: guessBungaCategoryId(categories),
    purchases: unlinkedPaylaterPurchases(sourceDoc, source.walletId, plans),
  };
}
