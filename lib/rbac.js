// lib/rbac.js
// Aturan role NF3 (sumber kebenaran permission & navigasi)
//
// owner       — semua bisa atur + undang staf + rekening bank
// admin       — hampir semua (settle, dompet, transfer) TANPA undang staf; review void via beranda (bukan tab Void)
// purchasing  — belanja; transaksi out REAL (kurangi saldo dompet sumber). Dompet terbatas via flag purchasingUse
// kasir+outlet — KBU / KSM / SMT: SDM, omset, sosmed, void INPUT (tab Void khusus outlet)

import { resolveWalletId, resolveTransferIds } from "./transactionNormalize.js";
import { PURCHASING_FINAL_NAMES } from "./purchasingCategories.js";

export const ROLES = { owner: 4, admin: 3, kasir: 2, purchasing: 1 };
const KASIR_OUTLET_CODES = new Set(["KBU", "KSM", "SMT"]);

function normText(v) {
  return String(v || "").trim().toLowerCase();
}

function userPurchasingArea(user) {
  if ((user?.role || "") !== "purchasing") return "";
  const area = normText(user?.outlet);
  if (!area || KASIR_OUTLET_CODES.has(area.toUpperCase())) return "";
  return area;
}

function isAreaWallet(wallet, area) {
  if (!wallet || !area) return false;
  const idText = normText(wallet.id).replace(/^w_/, "").replace(/_/g, " ");
  const nameText = normText(wallet.name);
  return nameText.includes(area) || idText.includes(area);
}

function txCreatorId(t) {
  return (
    t?.meta?.createdById
    || t?.createdBy
    || t?.created_by
    || null
  );
}

function normIdentity(v) {
  return String(v || "").trim().toLowerCase();
}

function txCreatorKeys(t) {
  const keys = new Set();
  const add = (v) => {
    const k = normIdentity(v);
    if (k) keys.add(k);
  };
  add(t?.meta?.createdById);
  add(t?.createdBy);
  add(t?.created_by);
  add(t?.meta?.createdByName);
  add(t?.createdByName);
  add(t?.meta?.createdByEmail);
  add(t?.createdByEmail);
  return keys;
}

function userIdentityKeys(user) {
  const keys = new Set();
  const add = (v) => {
    const k = normIdentity(v);
    if (k) keys.add(k);
  };
  add(user?.id);
  add(user?.name);
  add(user?.email);
  return keys;
}

function isOwnedTransactionForUser(t, user) {
  const userKeys = userIdentityKeys(user);
  if (userKeys.size === 0) return true;

  const creatorId = normIdentity(txCreatorId(t));
  const userId = normIdentity(user?.id);
  // Jika transaksi sudah punya creator id, tetap jadi sumber kebenaran utama.
  if (creatorId && userId && creatorId !== userId) return false;

  const txKeys = txCreatorKeys(t);
  // Legacy transaksi tanpa metadata creator jangan disembunyikan.
  if (txKeys.size === 0) return true;

  for (const key of txKeys) {
    if (userKeys.has(key)) return true;
  }
  return false;
}

function walletAssignedToUser(wallet, user) {
  const role = user?.role || "kasir";
  if (role === "owner" || role === "admin") return true;
  const assigned = Array.isArray(wallet?.allowedUserIds) ? wallet.allowedUserIds.filter(Boolean) : [];
  const roleRules = Array.isArray(wallet?.allowedRoles) ? wallet.allowedRoles.filter(Boolean) : [];
  const outletRules = Array.isArray(wallet?.allowedOutlets) ? wallet.allowedOutlets.filter(Boolean) : [];

  const passUser = assigned.length === 0 ? true : (!!user?.id && assigned.includes(user.id));
  const passRole = roleRules.length === 0 ? true : roleRules.includes(role);
  const passOutlet = role !== "kasir" || outletRules.length === 0
    ? true
    : (!!user?.outlet && outletRules.includes(user.outlet));

  return passUser && passRole && passOutlet;
}

function hasExplicitWalletAssignment(wallets, user) {
  const uid = user?.id;
  if (!uid) return false;
  return (wallets || []).some((w) => Array.isArray(w?.allowedUserIds) && w.allowedUserIds.includes(uid));
}

export function canDo(role, action) {
  const r = role || "kasir";
  const perms = {
    transfer: ["owner", "admin"],
    settleLaci: ["owner", "admin"],
    settleTikTokGo: ["owner", "admin"],
    /** Hapus laporan omset kasir yang belum settle (bersihkan transaksi tunai laci). */
    hapusLaporanOmset: ["owner", "admin"],
    /** Kasir hapus laporan outlet sendiri (belum diverifikasi admin). */
    hapusLaporanOmsetSendiri: ["kasir"],
    kelolaDompet: ["owner", "admin"],
    editSaldoDompet: ["owner", "admin"],
    kelolaKategoriSemua: ["owner", "admin"],
    kelolaKategoriSendiri: ["owner", "admin", "kasir", "purchasing"],
    lihatRekening: ["owner", "admin"],
    lihatAnalisis: ["owner", "admin"],
    lihatLaporanPenuh: ["owner", "admin"],
    inputLaporanHarian: ["kasir"],
    inputSosmedReport: ["owner", "admin", "kasir"],
    /** Tab Void — HANYA kasir outlet */
    inputVoid: ["kasir"],
    lihatVoidLog: ["admin", "kasir"],
    /** Review void — admin via kartu beranda, BUKAN tab Void */
    reviewVoidLog: ["admin"],
    inputIncome: ["owner", "admin"],
    inputExpense: ["owner", "admin", "kasir", "purchasing"],
    kelolaStaf: ["owner", "admin"],
    kelolaTransaksi: ["owner", "admin"],
    undangStaf: ["owner"],
    hubungkanWeb: ["owner", "admin"],
    kirimPengumuman: ["owner", "admin"],
  };
  return (perms[action] || []).includes(r);
}

/** Edit/hapus transaksi di Laporan — owner/admin semua; purchasing hanya belanja sendiri. */
export function canManageTransactions(role) {
  return canDo(role, "kelolaTransaksi") || role === "purchasing";
}

/** Tab Void di bottom nav — hanya kasir outlet. */
export function showVoidTab(role) {
  return role === "kasir";
}

/** Tab Analisis di bottom nav. */
export function showAnalisisTab(role) {
  return canDo(role, "lihatAnalisis");
}

/** Tab Asisten Purchasing — hanya role purchasing (owner/admin via kartu Beranda). */
export function showPurchasingAsistenTab(role) {
  return role === "purchasing";
}

/** Kartu Tanya Purchasing di Beranda — owner/admin saja (bukan tab terpisah). */
export function showPurchasingAsistenBeranda(role) {
  return role !== "purchasing" && canDo(role, "kelolaKategoriSemua");
}

/** Bisa buka overlay / API asisten purchasing. */
export function canUsePurchasingAsisten(role) {
  return showPurchasingAsistenTab(role) || showPurchasingAsistenBeranda(role);
}

/** Dompet yang purchasing boleh pakai belanja (saldo real berkurang). */
export const PURCHASING_WALLET_IDS = new Set([
  "w_kas_kecil",
  "w_shopeepay",
  "w_gojek",
  "w_shopee_paylater",
  "w_bca",
  "w_bri",
  "w_mandiri",
  "w_bni",
]);

export function isPurchasingWallet(w) {
  if (!w || w.active === false) return false;
  if (w.purchasingUse === true) return true;
  if (PURCHASING_WALLET_IDS.has(w.id)) return true;
  if (/kas\s*kecil/i.test(w.name || "")) return true;
  if (w.type === "rekening" && w.id !== "w_owner") return true;
  if (w.type === "ewallet" || w.type === "paylater") return true;
  return false;
}

/** Dompet yang boleh dipakai purchasing untuk catat belanja (transaksi out → saldo berkurang). */
export function purchasingWallets(wallets) {
  return (wallets || []).filter(isPurchasingWallet);
}

export function visibleWallets(wallets, user) {
  const role = user?.role || "kasir";
  const purchasingArea = userPurchasingArea(user);
  const hasExplicitAssignment = hasExplicitWalletAssignment(wallets, user);
  const filtered = (wallets || []).filter((w) => {
    if (w.active === false) return false;
    if (!walletAssignedToUser(w, user)) return false;
    if (role === "kasir") return w.outlet === user.outlet;
    if (role === "purchasing") {
      // Jika owner sudah assign dompet spesifik ke user purchasing,
      // pakai assignment itu sebagai sumber kebenaran (aman walau dompet di-rename).
      if (hasExplicitAssignment) return true;
      // Purchasing area khusus (contoh: Jagasatru) wajib dipisah dari kas kecil umum.
      if (purchasingArea) {
        if (w.type === "rekening") return true;
        return isAreaWallet(w, purchasingArea);
      }
      return isPurchasingWallet(w);
    }
    if (w.ownerOnly && !canDo(role, "lihatRekening")) return false;
    return true;
  });
  return filtered.sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999) || (a.name || "").localeCompare(b.name || "", "id"));
}

export function visibleCategories(categories, user, txType) {
  const role = user?.role || "kasir";
  return (categories || []).filter((c) => {
    if (c.active === false) return false;
    if (txType && c.type !== txType) return false;

    if (role === "owner" || role === "admin") return true;

    if (role === "kasir") {
      if (c.type === "in") return false;
      if (!c.role) return c.type === "out";
      if (c.role === "kasir") return !c.outlet || c.outlet === user.outlet;
      return false;
    }

    if (role === "purchasing") {
      if (c.type === "in") return false;
      if (c.role !== "purchasing") return false;
      return PURCHASING_FINAL_NAMES.has((c.name || "").trim().toLowerCase());
    }

    return false;
  });
}

/** Dompet kas kecil purchasing — satu-satunya sumber saldo & pemasukan yang purchasing lihat. */
export function isKasKecilWallet(w) {
  if (!w) return false;
  if (w.id === "w_kas_kecil") return true;
  return /kas\s*kecil/i.test(w.name || "");
}

/**
 * Transaksi yang boleh tampil untuk purchasing:
 * - pengeluaran belanja (out) dari dompet purchasing
 * - pemasukan/transfer HANYA ke Kas Kecil (dana dari admin keuangan)
 * - BUKAN pemasukan settlement ke BRI/bank
 */
export function purchasingVisibleTransaction(t, wallets) {
  if (!t) return false;
  if (t.type === "transfer") {
    const { from, to } = resolveTransferIds(t);
    return (wallets || []).some((w) => w.id === from || w.id === to);
  }
  return (wallets || []).some((w) => w.id === resolveWalletId(t));
}

export function visibleTransactions(transactions, wallets, user) {
  const role = user?.role || "kasir";

  if (role === "purchasing" || role === "kasir") {
    return (transactions || []).filter((t) => {
      if (!isOwnedTransactionForUser(t, user)) return false;
      if (role === "purchasing") return purchasingVisibleTransaction(t, wallets);
      const allowedWalletIds = new Set(visibleWallets(wallets, user).map((w) => w.id));
      if (t.type === "transfer") {
        const { from, to } = resolveTransferIds(t);
        return allowedWalletIds.has(from) || allowedWalletIds.has(to);
      }
      return allowedWalletIds.has(resolveWalletId(t));
    });
  }

  const allowedWalletIds = new Set(visibleWallets(wallets, user).map((w) => w.id));
  return (transactions || []).filter((t) => {
    if (t.type === "transfer") {
      const { from, to } = resolveTransferIds(t);
      return allowedWalletIds.has(from) || allowedWalletIds.has(to);
    }
    return allowedWalletIds.has(resolveWalletId(t));
  });
}

export const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin Keuangan",
  kasir: "Kasir",
  purchasing: "Purchasing",
};
