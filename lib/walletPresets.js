// lib/walletPresets.js — katalog dompet per tipe bisnis (onboarding tidak pakai F&B penuh semua)

import { CANONICAL_BUSINESS_ID } from "./canonicalBusiness.js";
import { sanitizeSharedLinks } from "./sharedWalletPolicy.js";

/** Nusa Food F&B — katalog lengkap (canonical saja). */
export const NF_FNB_WALLETS = [
  { id: "w_laci_kbu", name: "Laci KBU", type: "kas_fisik", outlet: "KBU", color: "#6366F1", opening: 250000, floor: 250000, active: true, sort: 10 },
  { id: "w_laci_ksm", name: "Laci Kisamen", type: "kas_fisik", outlet: "KSM", color: "#16A34A", opening: 250000, floor: 250000, active: true, sort: 20 },
  { id: "w_laci_smt", name: "Laci Samtaro", type: "kas_fisik", outlet: "SMT", color: "#D97706", opening: 250000, floor: 250000, active: true, sort: 30 },
  { id: "w_kas_besar", name: "NF Cash (Kas Besar)", type: "kas_fisik", outlet: null, color: "#0EA5E9", opening: 0, floor: 0, active: true, sort: 40 },
  { id: "w_pm", name: "Shopee Food", type: "digital", outlet: null, color: "#EE4D2D", opening: 0, floor: 0, active: true, sort: 50 },
  { id: "w_nf", name: "Grab Food", type: "digital", outlet: null, color: "#00B14F", opening: 0, floor: 0, active: true, sort: 51 },
  { id: "w_gofood", name: "Go Food", type: "digital", outlet: null, color: "#00AA13", opening: 0, floor: 0, active: true, sort: 52 },
  { id: "w_tiktok_go", name: "TikTok Go", type: "digital", outlet: null, color: "#111827", opening: 0, floor: 0, active: true, sort: 53 },
  { id: "w_kas_kecil", name: "Kas Kecil Dodi", type: "kas_fisik", outlet: null, color: "#8B5CF6", opening: 0, floor: 0, active: true, purchasingUse: true, sort: 60 },
  { id: "w_ops_kar", name: "Operasional Karyawan", type: "kas_fisik", outlet: null, color: "#EC4899", opening: 0, floor: 0, active: true, sort: 70 },
  { id: "w_shopeepay", name: "ShopeePay", type: "ewallet", outlet: null, color: "#EE4D2D", opening: 0, floor: 0, active: true, purchasingUse: true, sort: 80 },
  { id: "w_gojek", name: "Saldo Gojek", type: "ewallet", outlet: null, color: "#00AA13", opening: 0, floor: 0, active: true, purchasingUse: true, sort: 90 },
  { id: "w_shopee_paylater", name: "Shopee PayLater", type: "paylater", liability: true, allowNegative: true, outlet: null, color: "#B45309", opening: 0, floor: 0, active: true, purchasingUse: true, sort: 100 },
  { id: "w_bca", name: "BCA", type: "rekening", outlet: null, color: "#1D4ED8", opening: 0, floor: 0, active: true, ownerOnly: true, purchasingUse: true, hide_balance: true, sort: 110 },
  { id: "w_bri", name: "BRI", type: "rekening", outlet: null, color: "#DC2626", opening: 0, floor: 0, active: true, ownerOnly: true, purchasingUse: true, hide_balance: true, sort: 120 },
  { id: "w_mandiri", name: "Mandiri", type: "rekening", outlet: null, color: "#CA8A04", opening: 0, floor: 0, active: true, ownerOnly: true, purchasingUse: true, hide_balance: true, sort: 130 },
  { id: "w_bni", name: "BNI", type: "rekening", outlet: null, color: "#1E40AF", opening: 0, floor: 0, active: true, ownerOnly: true, purchasingUse: true, hide_balance: true, sort: 140 },
  { id: "w_owner", name: "Owner", type: "rekening", outlet: null, color: "#7C3AED", opening: 0, floor: 0, active: true, ownerOnly: true, sort: 150 },
];

/** E-commerce / marketplace — starter ringkas. */
export const ECOMMERCE_WALLETS = [
  { id: "w_kas", name: "Kas", type: "kas_fisik", outlet: null, color: "#16A34A", opening: 0, floor: 0, active: true, sort: 10 },
  { id: "w_bank", name: "Bank", type: "rekening", outlet: null, color: "#2563EB", opening: 0, floor: 0, active: true, sort: 20 },
  { id: "w_marketplace", name: "Saldo Marketplace", type: "ewallet", outlet: null, color: "#F97316", opening: 0, floor: 0, active: true, sort: 30 },
];

/** Slug bisnis NF Nusa Fishing (dipakai untuk memilih preset & migrasi). */
export const FISHING_SLUG = "nf-nusa-fishing";

/** Dompet kas fisik operasional ekspedisi / packing (laporan harian JNE dll.). */
export const FISHING_EKSPEDISI_WALLET_ID = "w_fish_ekspedisi";

/** NF Nusa Fishing — dompet milik Fishing sendiri (rekening Rudi/Durinah, marketplace, reseller).
 *  Uang NF & Shopee PayLater di-share dari FNB (lihat NF_FISHING_FNB_OPS_LINKS) — jangan doble lokal. */
export const NF_FISHING_WALLETS = [
  { id: "w_fish_dana_darurat",     name: "Dana Darurat",         type: "kas_fisik", outlet: null, color: "#DC2626", opening: 0, floor: 0, active: true, purchasingUse: true, sort: 5 },
  { id: "w_fish_uang_makan",       name: "Dompet Uang Makan",    type: "kas_fisik", outlet: null, color: "#16A34A", opening: 0, floor: 0, active: true, purchasingUse: true, sort: 6 },
  { id: FISHING_EKSPEDISI_WALLET_ID, name: "Dompet Ekspedisi", type: "kas_fisik", outlet: null, color: "#0F766E", opening: 0, floor: 0, active: true, purchasingUse: true, sort: 7 },
  { id: "w_fish_marketplace",      name: "Marketplace",          type: "ewallet",  outlet: null, color: "#F97316", opening: 0, floor: 0, active: true, sort: 10 },
  { id: "w_fish_reseller",         name: "Reseller",             type: "rekening", outlet: null, color: "#0EA5E9", opening: 0, floor: 0, active: true, sort: 20 },
  { id: "w_fish_mandiri_durinah",  name: "Bank Mandiri Durinah", type: "rekening", outlet: null, color: "#CA8A04", opening: 0, floor: 0, active: true, sort: 30 },
  { id: "w_fish_bca_rudi",         name: "Bank BCA Rudi",        type: "rekening", outlet: null, color: "#1D4ED8", opening: 0, floor: 0, active: true, sort: 40 },
  { id: "w_fish_bni_rudi",         name: "Bank BNI Rudi",        type: "rekening", outlet: null, color: "#1E40AF", opening: 0, floor: 0, active: true, sort: 50 },
  { id: "w_fish_mandiri_rudi",     name: "Bank Mandiri Rudi",    type: "rekening", outlet: null, color: "#A16207", opening: 0, floor: 0, active: true, sort: 60 },
  { id: "w_fish_bri_rudi",         name: "Bank BRI Rudi",        type: "rekening", outlet: null, color: "#DC2626", opening: 0, floor: 0, active: true, sort: 70 },
];

export const NF_FISHING_WALLET_IDS = new Set(NF_FISHING_WALLETS.map((w) => w.id));

export function isEkspedisiWallet(w) {
  if (!w) return false;
  if (w.id === FISHING_EKSPEDISI_WALLET_ID) return true;
  return /ekspedisi|expedition/i.test(String(w.name || ""));
}

/**
 * Inject preset dompet Fishing yang belum ada di app_state (idempotent).
 * Dipakai karena merge mode Fishing biasanya saved-only — preset baru tidak auto-masuk.
 */
export function ensureNfFishingWallets(wallets = []) {
  const list = Array.isArray(wallets) ? wallets.filter(Boolean) : [];
  const have = new Set(list.map((w) => w.id).filter(Boolean));
  const missing = NF_FISHING_WALLETS
    .filter((def) => def?.id && !have.has(def.id))
    .map((def) => ({ ...def }));
  if (!missing.length) return list;
  return [...list, ...missing];
}

export function needsNfFishingWalletEnsure(wallets = []) {
  const have = new Set((wallets || []).map((w) => w?.id).filter(Boolean));
  return NF_FISHING_WALLETS.some((def) => def?.id && !have.has(def.id));
}

/**
 * Rekening Sam yang berada di FNB (Nusa Food) dan di-mirror ke Fishing.
 * id link dibuat deterministik agar migrasi idempoten.
 */
export const NF_FISHING_FNB_BANK_LINKS = [
  { key: "bca",     sourceWalletId: "w_bca",     sourceWalletName: "BCA" },
  { key: "bri",     sourceWalletId: "w_bri",     sourceWalletName: "BRI" },
  { key: "mandiri", sourceWalletId: "w_mandiri", sourceWalletName: "Mandiri" },
  { key: "bni",     sourceWalletId: "w_bni",     sourceWalletName: "BNI" },
];

/**
 * Dompet operasional yang dipakai bersama FNB ↔ Fishing.
 * Sumber kebenaran di FNB — bukan Kas Besar (w_kas_besar).
 * Uang NF di FNB: w1782220389555 (nama "Uang NF").
 */
export const NF_FISHING_FNB_OPS_LINKS = [
  {
    key: "uang_nf",
    sourceWalletId: "w1782220389555",
    sourceWalletName: "Uang NF",
    sourceWalletType: "kas_fisik",
    linkKind: "ops_share",
    label: "Uang NF",
    color: "#DC2626",
  },
  {
    key: "paylater",
    sourceWalletId: "w_shopee_paylater",
    sourceWalletName: "Shopee PayLater",
    sourceWalletType: "paylater",
    linkKind: "ops_share",
    label: "Shopee PayLater",
    color: "#B45309",
  },
];

export const NF_FISHING_OPS_SHARE_SOURCE_IDS = new Set(
  NF_FISHING_FNB_OPS_LINKS.map((l) => l.sourceWalletId)
);

/** Bangun shared-link Fishing: 4 bank Sam + Uang NF + PayLater (sumber FNB). */
export function buildFishingSharedLinks({ enabled = true } = {}) {
  const banks = NF_FISHING_FNB_BANK_LINKS.map((b) => ({
    id: `sh_nf_${b.key}`,
    sourceBusinessId: CANONICAL_BUSINESS_ID,
    sourceBusinessName: "Nusa Food",
    sourceWalletId: b.sourceWalletId,
    sourceWalletName: b.sourceWalletName,
    sourceWalletType: "rekening",
    linkKind: "rekening",
    label: `${b.sourceWalletName} (Sam · NF)`,
    enabled,
  }));
  const ops = NF_FISHING_FNB_OPS_LINKS.map((o) => ({
    id: `sh_nf_${o.key}`,
    sourceBusinessId: CANONICAL_BUSINESS_ID,
    sourceBusinessName: "Nusa Food",
    sourceWalletId: o.sourceWalletId,
    sourceWalletName: o.sourceWalletName,
    sourceWalletType: o.sourceWalletType,
    linkKind: o.linkKind,
    label: o.label,
    color: o.color,
    enabled,
  }));
  return [...ops, ...banks];
}

/** walletSetup awal khusus Fishing: dompet sendiri + 4 rekening Sam ter-mirror dari FNB. */
export function createFishingWalletSetup() {
  return {
    initialized: true,
    businessType: "ecommerce",
    sharedLinks: buildFishingSharedLinks({ enabled: true }),
  };
}

/** UMKM / toko umum — starter minimal. */
export const UMKM_WALLETS = [
  { id: "w_kas", name: "Kas", type: "kas_fisik", outlet: null, color: "#16A34A", opening: 0, floor: 0, active: true, sort: 10 },
  { id: "w_bank", name: "Bank", type: "rekening", outlet: null, color: "#2563EB", opening: 0, floor: 0, active: true, sort: 20 },
  { id: "w_qris", name: "QRIS / E-Wallet", type: "ewallet", outlet: null, color: "#7C3AED", opening: 0, floor: 0, active: true, sort: 30 },
];

export function getPresetWalletsForType(businessType) {
  if (businessType === "fnb") return NF_FNB_WALLETS.map((w) => ({ ...w }));
  if (businessType === "ecommerce") return ECOMMERCE_WALLETS.map((w) => ({ ...w }));
  return UMKM_WALLETS.map((w) => ({ ...w }));
}

/** Dompet default saat load — canonical NF pakai katalog F&B penuh. */
export function getWalletCatalogForBusiness(bizId, businessType) {
  if (bizId === CANONICAL_BUSINESS_ID) return NF_FNB_WALLETS.map((w) => ({ ...w }));
  return getPresetWalletsForType(businessType || "umkm");
}

/**
 * canonical = merge penuh (backward compat Nusa Food)
 * saved-only = hanya dompet yang disimpan owner — tidak inject 17 dompet F&B otomatis
 */
export function resolveWalletMergeMode(bizId, savedDoc) {
  if (bizId === CANONICAL_BUSINESS_ID && !savedDoc?.walletSetup?.initialized) {
    return "canonical";
  }
  if (savedDoc?.walletSetup?.initialized) return "saved-only";
  if (Array.isArray(savedDoc?.wallets) && savedDoc.wallets.length > 0) return "saved-only";
  return "preset";
}

export function createWalletSetupSeed(businessType) {
  return {
    initialized: true,
    businessType: businessType || "umkm",
    sharedLinks: [],
  };
}

/** Dompet mirror dari bisnis lain — default mati, owner aktifkan manual. Hanya rekening bank. */
export function createSharedWalletLink({
  sourceBusinessId,
  sourceBusinessName,
  sourceWalletId,
  sourceWalletName,
  sourceWalletType = "rekening",
}) {
  return {
    id: "sh_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    sourceBusinessId,
    sourceBusinessName: sourceBusinessName || "",
    sourceWalletId,
    sourceWalletName: sourceWalletName || "",
    sourceWalletType,
    linkKind: "rekening",
    label: sourceWalletName || "Rekening bersama",
    enabled: false,
  };
}

export function applySharedWalletLinks(wallets, walletSetup) {
  const base = wallets || [];
  const links = sanitizeSharedLinks(walletSetup?.sharedLinks).filter((l) => l.enabled);
  if (!links.length) return base;

  const virtual = links.map((link) => {
    const isOps = link.linkKind === "ops_share";
    const isPaylater = link.sourceWalletType === "paylater";
    const isBank = link.linkKind === "rekening" || link.sourceWalletType === "rekening";
    let sort = 9990;
    if (isOps && /uang\s*nf/i.test(link.label || link.sourceWalletName || "")) sort = 4;
    else if (isOps && isPaylater) sort = 8;
    else if (isBank) sort = 9990;
    return {
      id: `shared_${link.id}`,
      name: isOps
        ? (link.label || link.sourceWalletName || "Dompet bersama")
        : `${link.label || link.sourceWalletName} ↗`,
      type: "shared",
      outlet: null,
      color: link.color || (isPaylater ? "#B45309" : isOps ? "#DC2626" : "#6B7280"),
      opening: 0,
      floor: 0,
      active: true,
      sort,
      sharedLink: link,
      ownerOnly: false,
      purchasingUse: true,
      // Bank Sam: purchasing tanpa lihat saldo. Uang NF / PayLater: saldo boleh dilihat.
      hide_balance: isBank,
      liability: isPaylater,
      allowNegative: isPaylater,
    };
  });

  return [...base, ...virtual];
}

export function isNfFishingSharedLink(link) {
  if (!link) return false;
  if (link.key === "uang_nf") return true;
  if (NF_FISHING_OPS_SHARE_SOURCE_IDS.has(link.sourceWalletId)) return true;
  if (link.linkKind === "ops_share" && /uang\s*nf/i.test(`${link.label || ""} ${link.sourceWalletName || ""}`)) {
    return true;
  }
  return false;
}

/** walletSetup dengan link Uang NF / ops share khas NF Fishing. */
export function hasNfFishingWalletSetup(walletSetup) {
  return (walletSetup?.sharedLinks || []).some((l) => isNfFishingSharedLink(l));
}

/** Dompet lokal w_fish_* atau mirror shared "Uang NF". */
export function hasNfFishingSharedWallet(wallets = []) {
  return (wallets || []).some((w) => {
    if (NF_FISHING_WALLET_IDS.has(w?.id)) return true;
    if (String(w?.id || "").startsWith("w_fish_")) return true;
    if (w?.type === "shared" && /uang\s*nf/i.test(w?.name || "")) return true;
    if (w?.sharedLink && isNfFishingSharedLink(w.sharedLink)) return true;
    return false;
  });
}

/** Dompet nyata saja + mirror rekening bersama yang owner aktifkan. */
export function rebuildWalletsWithShared(wallets, walletSetup) {
  const base = (wallets || []).filter((w) => w.type !== "shared");
  const setup = walletSetup
    ? { ...walletSetup, sharedLinks: sanitizeSharedLinks(walletSetup.sharedLinks) }
    : walletSetup;
  return applySharedWalletLinks(base, setup);
}
