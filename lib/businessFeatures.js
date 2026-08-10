// lib/businessFeatures.js — fitur & dompet per tipe bisnis (F&B vs e-commerce vs UMKM)

import {
  isCanonicalBusiness,
  CANONICAL_DISPLAY_NAME,
  findCanonicalInList,
  resolveBusinessDisplayName,
} from "./canonicalBusiness.js";
import { NF_FNB_WALLETS, NF_FISHING_WALLET_IDS, FISHING_SLUG, hasNfFishingWalletSetup, hasNfFishingSharedWallet } from "./walletPresets.js";
import { PURCHASING_FINAL_NAMES } from "./purchasingCategories.js";
import { visibleWallets, visibleTransactions, visibleCategories } from "./rbac.js";
import { mergeWithLocalTransactions } from "./sharedWalletMirror.js";
import {
  NF_FISHING_DEFAULT_CATEGORIES,
  isLegacyEcommerceCategoryList,
  isDetailedNfCategoryList,
  ensureNfFishingCategories,
  needsNfChannelUpgrade,
  isNfCatalogCategory,
  hasNfFishingCatalog,
  hasLegacyNfMpIncomeCategories,
  nfCategoryById,
  normalizeNfCategoryId,
  NF_LEGACY_MP_INCOME_IDS,
} from "./nfCategoryCatalog.js";

const FNB_WALLET_IDS = new Set(NF_FNB_WALLETS.map((w) => w.id));

const ECOMMERCE_WALLET_IDS = new Set(["w_kas", "w_bank", "w_marketplace", "w_qris"]);

export function resolveBusinessType(business) {
  if (isCanonicalBusiness(business)) return "fnb";
  return business?.type || "umkm";
}

export function isFnBBusiness(business) {
  return resolveBusinessType(business) === "fnb";
}

/** Konteks bisnis NF dari state tersimpan (dompet, kategori, setup). */
export function nfBusinessContext(state) {
  if (!state) return {};
  return {
    wallets: state.wallets,
    categories: state.categories,
    walletSetup: state.walletSetup,
    profile: state.profile,
  };
}

/** Scope Keuangan NF aktif — untuk filter transaksi & UI channel. */
export function isNfFinanceScope(business, ctx = {}) {
  return isNfFishingBusiness(business, ctx);
}

/** Nama bisnis/profil yang mengindikasikan Keuangan NF Nusa Fishing (bukan Nusa Food F&B). */
function isNfFishingDisplayName(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return false;
  if (/nusa\s*food|nf\s*f\s*&?\s*b|resto|warung|outlet|kasir/i.test(n) && !/fishing/i.test(n)) return false;
  return /nusa\s*fishing|nf\s*nusa\s*fishing|^nf\s*fishing|keuangan\s*nf/i.test(n);
}

/** Bisnis Keuangan NF Nusa Fishing — bukan F&B, bukan e-commerce/UMKM generik. */
export function isNfFishingBusiness(business, { wallets, categories, walletSetup, profile } = {}) {
  if (isCanonicalBusiness(business)) return false;
  const fishingMarkers =
    business?.slug === FISHING_SLUG
    || hasNfFishingWalletSetup(walletSetup)
    || hasNfFishingSharedWallet(wallets)
    || (wallets || []).some((w) => NF_FISHING_WALLET_IDS.has(w?.id))
    || hasNfFishingCatalog(categories)
    || hasLegacyNfMpIncomeCategories(categories)
    || isNfFishingDisplayName(business?.name || profile?.name || "");

  if (fishingMarkers) return true;
  if (isFnBBusiness(business)) return false;
  return false;
}

/** Fitur yang boleh dipakai di bisnis aktif. */
export function businessFeatures(business, { wallets, categories, walletSetup, profile } = {}) {
  const type = resolveBusinessType(business);
  const isFnB = type === "fnb";
  const isNfFishing = isNfFishingBusiness(business, { wallets, categories, walletSetup, profile });
  return {
    type,
    isFnB,
    isNfFishing,
    /** Channel omzet MP, registry toko, P&L NF — hanya NF Nusa Fishing. */
    nfChannelFinance: isNfFishing,
    label: businessTypeLabel(type),
    settleLaci: isFnB,
    kasirDaily: isFnB,
    sosmedReports: isFnB,
    voidOutlet: isFnB,
    purchasingModule: isFnB,
    fnbAnalisis: isFnB,
    sharedWalletLinks: true,
  };
}

export function businessTypeLabel(type) {
  if (type === "fnb") return "Resto F&B";
  if (type === "ecommerce") return "E-commerce";
  return "Toko / UMKM";
}

/** Dompet khusus resto (laci outlet, purchasing, marketplace makanan, dll.).
 *  Catatan: type "shared" (rekening Sam mirror) BUKAN FNB-only — dipakai bersama di NF. */
export function isFnBOnlyWallet(w) {
  if (!w) return false;
  if (w.type === "shared" || String(w.id || "").startsWith("shared_")) return false;
  if (NF_FISHING_WALLET_IDS.has(w.id)) return false;
  if (w.outlet && ["KBU", "KSM", "SMT"].includes(w.outlet)) return true;
  if (FNB_WALLET_IDS.has(w.id)) return true;
  if (ECOMMERCE_WALLET_IDS.has(w.id)) return false;
  return false;
}

/** Kategori awal e-commerce / NF — katalog lengkap NF Fishing (contoh owner). */
export const ECOMMERCE_DEFAULT_CATEGORIES = NF_FISHING_DEFAULT_CATEGORIES;

export function defaultCategoriesForBusiness(business, { wallets, categories, walletSetup, profile } = {}) {
  if (isFnBBusiness(business)) return null;
  if (!isNfFishingBusiness(business, { wallets, categories, walletSetup, profile })) {
    return ECOMMERCE_DEFAULT_CATEGORIES_LEGACY.map((c) => ({ ...c }));
  }
  return NF_FISHING_DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

/** @deprecated gunakan NF_FISHING_DEFAULT_CATEGORIES */
export const ECOMMERCE_DEFAULT_CATEGORIES_LEGACY = [
  { id: "ec_in1", name: "Penjualan", type: "in", active: true, sort: 0 },
  { id: "ec_in2", name: "Ongkir masuk", type: "in", active: true, sort: 1 },
  { id: "ec_out1", name: "Modal / Kulakan", type: "out", active: true, sort: 0 },
  { id: "ec_out2", name: "Packing", type: "out", active: true, sort: 1 },
  { id: "ec_out3", name: "Ongkir", type: "out", active: true, sort: 2 },
  { id: "ec_out4", name: "Iklan", type: "out", active: true, sort: 3 },
  { id: "ec_out5", name: "Lain-lain", type: "out", active: true, sort: 4 },
];

export function hasFnBPurchasingCategories(categories = []) {
  return (categories || []).some((c) => {
    if (c?.role === "purchasing") return true;
    const n = (c?.name || "").trim().toLowerCase();
    return PURCHASING_FINAL_NAMES.has(n);
  });
}

/** Kategori awal — katalog NF Fishing hanya untuk bisnis NF Nusa Fishing. */
export function resolveCategoriesForBusiness(savedCats, business, { wallets, walletSetup, profile } = {}) {
  if (isFnBBusiness(business)) return null;
  const list = savedCats || [];
  const ctx = { wallets, categories: list, walletSetup, profile };

  if (!isNfFishingBusiness(business, ctx)) {
    if (!list.length || hasFnBPurchasingCategories(list)) {
      return defaultCategoriesForBusiness(business, ctx);
    }
    return list;
  }

  if (
    !list.length
    || hasFnBPurchasingCategories(list)
    || isLegacyEcommerceCategoryList(list)
    || isDetailedNfCategoryList(list)
    || needsNfChannelUpgrade(list)
  ) {
    return ensureNfFishingCategories(defaultCategoriesForBusiness(business, ctx) || []);
  }
  return ensureNfFishingCategories(list);
}

/** Dompet operasional NF yang purchasing boleh pakai (nama lama manual / preset). */
export function isNfPurchasingOpsWallet(w) {
  if (!w || w.active === false) return false;
  if (w.purchasingUse === true) return true;
  const n = String(w.name || "").toLowerCase();
  return /dana\s*darurat|uang\s*makan|paylater|pay\s*later|ekspedisi|expedition/.test(n);
}

export function visibleWalletsForBusiness(wallets, user, business) {
  let list = (wallets || []).filter((w) => w.active !== false);
  const role = user?.role || "kasir";
  const isShared = (w) => w?.type === "shared" || String(w?.id || "").startsWith("shared_");

  if (!isFnBBusiness(business)) {
    list = list.filter((w) => !isFnBOnlyWallet(w));
    if (role === "purchasing") {
      const uid = user?.id;
      const hasAssignment =
        !!uid &&
        list.some(
          (w) => !isShared(w) && Array.isArray(w?.allowedUserIds) && w.allowedUserIds.includes(uid)
        );
      const ops = hasAssignment
        ? list.filter((w) => Array.isArray(w?.allowedUserIds) && w.allowedUserIds.includes(uid))
        : list.filter((w) => !isShared(w) && isNfPurchasingOpsWallet(w));
      // Purchasing NF: dompet belanja + rekening Sam terhubung (write-through ke FNB).
      const sharedBanks = list.filter(isShared);
      const scoped = [...ops, ...sharedBanks];
      return scoped.sort(
        (a, b) => (a.sort ?? 9999) - (b.sort ?? 9999) || (a.name || "").localeCompare(b.name || "", "id")
      );
    }
  }

  return visibleWallets(list, user);
}

export function visibleCategoriesForBusiness(categories, user, txType, business) {
  if (isFnBBusiness(business)) {
    return visibleCategories(categories, user, txType);
  }
  const role = user?.role || "kasir";
  const list = categories || [];
  if (role === "purchasing") {
    return list.filter((c) => {
      if (c.active === false) return false;
      if (txType && c.type !== txType) return false;
      if (c.type !== "out") return false;
      return c.purchasingUse === true;
    });
  }
  return visibleCategories(categories, user, txType);
}

/** Kategori pemasukan NF — sembunyikan legacy MP agregat saat channel finance aktif. */
export function visibleNfIncomeCategories(categories, user, business, { nfChannelFinance, features, ...ctx } = {}) {
  const list = visibleCategoriesForBusiness(categories, user, "in", business);
  const channelOn = nfChannelFinance
    ?? features?.nfChannelFinance
    ?? isNfFishingBusiness(business, ctx);
  if (!channelOn) return list;
  return list.filter((c) => !NF_LEGACY_MP_INCOME_IDS.has(c.id));
}

export function visibleTransactionsForBusiness(transactions, wallets, user, business) {
  const scopedWallets = visibleWalletsForBusiness(wallets, user, business);
  return visibleTransactions(transactions, scopedWallets, user);
}

/**
 * Transaksi yang boleh tampil di Keuangan NF Nusa Fishing —
 * bukan settle/laporan FNB, hanya catatan NF (lokal + write-through rekening Sam).
 */
export function filterTransactionsForNfFinance(transactions, categories = [], { businessId, role, userId } = {}) {
  const catMap = nfCategoryById(categories);
  return (transactions || []).filter((t) => {
    if (!t) return false;
    const meta = t.meta || {};

    if (meta.sharedWriteThrough) {
      if (businessId && meta.fromBusinessId && meta.fromBusinessId !== businessId) return false;
      if (role === "purchasing" && userId && meta.createdById && meta.createdById !== userId) return false;
      return true;
    }

    if (t.reportChannelId) return false;
    if (t.type === "transfer") return true;

    const catId = normalizeNfCategoryId(t.categoryId || t.category_id);
    if (!catId) return false;
    const cat = catMap.get(catId);
    if (!cat || !isNfCatalogCategory(cat)) return false;
    if (cat.role === "kasir") return false;
    return true;
  });
}

/** Gabung lokal + mirror shared, lalu filter scope Keuangan NF. */
export function scopedNfFinanceTransactions(localTx, sharedByWallet, categories, { businessId, role, userId }) {
  const merged = mergeWithLocalTransactions(localTx, sharedByWallet);
  return filterTransactionsForNfFinance(merged, categories, { businessId, role, userId });
}

/** Overlay / layar yang hanya untuk Nusa Food F&B. */
export const FNB_ONLY_OVERLAYS = new Set([
  "settleLaporan",
  "sdmHarian",
  "laporanHarian",
  "sosmedHarian",
  "sosmedConfig",
  "voidReview",
  "outletTargets",
  "reportChannels",
  "laporanPurchasing",
  "asisten",
  "kategoriPurchasing",
  "purchasingAliases",
]);

export const NF_FISHING_ONLY_OVERLAYS = new Set(["mpStores"]);

export function isOverlayAllowedForBusiness(overlayName, business, { wallets, categories, walletSetup, profile } = {}) {
  if (!overlayName) return true;
  if (NF_FISHING_ONLY_OVERLAYS.has(overlayName) && !isNfFishingBusiness(business, { wallets, categories, walletSetup, profile })) return false;
  if (isFnBBusiness(business)) return true;
  return !FNB_ONLY_OVERLAYS.has(overlayName);
}

export function fnbFeatureLabel(overlayName) {
  const map = {
    settleLaporan: "Settle laporan omset kasir",
    sdmHarian: "SDM pagi outlet",
    laporanHarian: "Laporan omset harian",
    laporanPurchasing: "Laporan purchasing resto",
    asisten: "Asisten purchasing resto",
    kategoriPurchasing: "Kategori purchasing resto",
    purchasingAliases: "Alias purchasing resto",
  };
  return map[overlayName] || "Fitur resto F&B";
}

export { findCanonicalInList, resolveBusinessDisplayName, CANONICAL_DISPLAY_NAME };
