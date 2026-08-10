// lib/nfCategoryCatalog.js — katalog kategori NF Nusa Fishing (12 grup besar + pemasukan)

/**
 * nfKind — untuk hitung laba:
 * - revenue_gross: omzet kotor (cara lengkap MP — legacy, nonaktif)
 * - revenue_net: pemasukan bersih / settlement (cara standar NF)
 * - revenue_deduction: diskon / retur / refund (kurangi omzet)
 * - capital_in: modal / pinjaman masuk (arus kas, bukan omzet)
 * - hpp: modal produk terjual
 * - marketplace_fee: biaya admin MP (hanya jika pakai revenue_gross)
 * - opex: biaya operasional (mengurangi laba bersih)
 * - capex: pembelian alat (arus kas, bukan beban laba bulanan)
 * - prive: uang owner / transfer usaha lain (arus kas, bukan beban laba)
 * - transfer: perpindahan internal (netral laba)
 *
 * channelGroup (pemasukan NF): marketplace | direct | reseller | maklon | other | capital
 */

function cat(id, name, type, {
  group, nfKind, purchasingUse = false, sort = 0, hint = "", description = "",
  channelGroup = null, platformId = null, defaultWalletId = null, active = true,
} = {}) {
  return {
    id,
    name,
    type,
    active,
    sort,
    group: group || null,
    nfKind: nfKind || null,
    channelGroup: channelGroup || null,
    platformId: platformId || null,
    defaultWalletId: defaultWalletId || null,
    purchasingUse: !!purchasingUse,
    hint: hint || null,
    description: description || null,
  };
}

function incomeChannel(id, name, channelGroup, { platformId, sort, hint, description, defaultWalletId } = {}) {
  return cat(id, name, "in", {
    group: "Pemasukan",
    nfKind: "revenue_net",
    channelGroup,
    platformId: platformId || null,
    defaultWalletId: defaultWalletId || null,
    sort,
    hint: hint || "Catat settlement / uang yang benar-benar cair",
    description,
  });
}

/** 12 grup pengeluaran besar + pemasukan + transfer internal */
export const NF_CATEGORY_GROUPS = [
  "Pemasukan",
  "Bahan produk",
  "Kemasan",
  "Produksi",
  "Pengiriman",
  "Biaya marketplace",
  "Marketing",
  "Karyawan",
  "Operasional",
  "Riset produk",
  "Retur & komplain",
  "Pembelian alat",
  "Uang owner",
  "Transfer internal",
];

/** Katalog default NF — pemasukan per channel + 12 kategori besar pengeluaran. */
export const NF_FISHING_DEFAULT_CATEGORIES = [
  // ── Pemasukan per channel (settlement bersih) ──
  incomeChannel("nf_in_mp_tiktok", "MP - TikTok Shop", "marketplace", {
    platformId: "tiktok", sort: 11, defaultWalletId: "w_fish_marketplace",
    description: "Settlement TikTok Shop — pilih toko",
  }),
  incomeChannel("nf_in_mp_shopee", "MP - Shopee", "marketplace", {
    platformId: "shopee", sort: 12, defaultWalletId: "w_fish_marketplace",
    description: "Settlement Shopee — pilih toko",
  }),
  incomeChannel("nf_in_mp_tokopedia", "MP - Tokopedia", "marketplace", {
    platformId: "tokopedia", sort: 13, defaultWalletId: "w_fish_marketplace",
    description: "Settlement Tokopedia — pilih toko",
  }),
  incomeChannel("nf_in_mp_lazada", "MP - Lazada", "marketplace", {
    platformId: "lazada", sort: 14, defaultWalletId: "w_fish_marketplace",
    description: "Settlement Lazada — pilih toko",
  }),
  incomeChannel("nf_in_mp_bukalapak", "MP - Bukalapak", "marketplace", {
    platformId: "bukalapak", sort: 15, defaultWalletId: "w_fish_marketplace",
    description: "Settlement Bukalapak — pilih toko",
  }),
  incomeChannel("nf_in_direct_ads", "Direct - Ads", "direct", {
    sort: 21, defaultWalletId: "w_fish_bca_rudi",
    description: "Penjualan dari iklan langsung (Meta, Google, dll.)",
  }),
  incomeChannel("nf_in_direct_wa", "Direct - WhatsApp", "direct", {
    sort: 22, defaultWalletId: "w_fish_mandiri_durinah",
    description: "Order langsung via WhatsApp",
  }),
  incomeChannel("nf_in_direct_offline", "Direct - Offline", "direct", {
    sort: 23, defaultWalletId: "w_fish_mandiri_durinah",
    description: "Penjualan offline / event / toko fisik",
  }),
  incomeChannel("nf_in_reseller", "Reseller", "reseller", {
    sort: 31, defaultWalletId: "w_fish_reseller",
    description: "Pembayaran dari reseller / distributor",
  }),
  incomeChannel("nf_in_maklon", "Maklon", "maklon", {
    sort: 32, defaultWalletId: "w_fish_bca_rudi",
    description: "Pendapatan jasa maklon / private label",
  }),
  incomeChannel("nf_in_other", "Pendapatan Lain", "other", {
    sort: 41, defaultWalletId: "w_fish_bca_rudi",
    description: "Pemasukan lain di luar channel utama",
  }),
  cat("nf_in_capital", "Modal / Pinjaman Masuk", "in", {
    group: "Pemasukan",
    nfKind: "capital_in",
    channelGroup: "capital",
    sort: 51,
    hint: "Bukan omzet — arus kas modal/pinjaman",
    description: "Setoran modal owner, pinjaman bank, atau inject dana",
  }),
  incomeChannel("nf_in_ekspedisi_cash", "Ekspedisi - Cash", "other", {
    sort: 55,
    defaultWalletId: "w_fish_ekspedisi",
    hint: "Catat ke Dompet Ekspedisi",
    description: "Pemasukan cash harian ekspedisi (COD / bayar tunai)",
  }),
  incomeChannel("nf_in_ekspedisi_trf", "Ekspedisi - Transfer", "other", {
    sort: 56,
    defaultWalletId: "w_fish_ekspedisi",
    hint: "Catat ke Dompet Ekspedisi",
    description: "Pemasukan transfer harian ekspedisi",
  }),

  // Legacy — nonaktif (transaksi lama tetap terbaca)
  cat("nf_in_mp_gross", "Penjualan MP (kotor)", "in", {
    group: "Pemasukan",
    nfKind: "revenue_gross",
    channelGroup: "marketplace",
    sort: 900,
    active: false,
    hint: "Legacy — gunakan channel MP per platform",
  }),
  cat("nf_in_mp_net", "Pemasukan MP (bersih)", "in", {
    group: "Pemasukan",
    nfKind: "revenue_net",
    channelGroup: "marketplace",
    sort: 901,
    active: false,
    hint: "Legacy — gunakan channel MP per platform",
  }),

  // ── 12 kategori besar pengeluaran ──
  cat("nf_out_bahan", "Bahan produk", "out", {
    group: "Bahan produk",
    nfKind: "hpp",
    purchasingUse: true,
    sort: 100,
    description: "Essen, perisa, pewarna, bahan campuran",
  }),
  cat("nf_out_kemasan", "Kemasan", "out", {
    group: "Kemasan",
    nfKind: "hpp",
    purchasingUse: true,
    sort: 200,
    description: "Botol, tutup, stiker, segel, kardus, bubble wrap, QR/serial/PIN",
  }),
  cat("nf_out_produksi", "Produksi", "out", {
    group: "Produksi",
    nfKind: "hpp",
    purchasingUse: true,
    sort: 300,
    description: "Upah produksi, upah packing, produk gagal, bocor/rusak",
  }),
  cat("nf_out_pengiriman", "Pengiriman", "out", {
    group: "Pengiriman",
    nfKind: "opex",
    purchasingUse: true,
    sort: 400,
    defaultWalletId: "w_fish_ekspedisi",
    description: "Ongkir, packing kayu, cargo, bensin kirim — Dompet Ekspedisi",
  }),
  cat("nf_out_marketplace", "Biaya marketplace", "out", {
    group: "Biaya marketplace",
    nfKind: "marketplace_fee",
    sort: 500,
    hint: "Hanya jika pemasukan pakai omzet kotor",
    description: "Admin TikTok/Shopee, komisi affiliate, voucher, potongan campaign",
  }),
  cat("nf_out_marketing", "Marketing", "out", {
    group: "Marketing",
    nfKind: "opex",
    sort: 600,
    description: "Iklan, KOL, affiliate, produk tester, giveaway, konten & live",
  }),
  cat("nf_out_karyawan", "Karyawan", "out", {
    group: "Karyawan",
    nfKind: "opex",
    sort: 700,
    description: "Gaji, bonus, lembur, uang makan & transport",
  }),
  cat("nf_out_operasional", "Operasional", "out", {
    group: "Operasional",
    nfKind: "opex",
    sort: 800,
    description: "Listrik, internet, sewa, ATK, software, domain, Fonnte",
  }),
  cat("nf_out_riset", "Riset produk", "out", {
    group: "Riset produk",
    nfKind: "opex",
    sort: 900,
    description: "Bahan trial, tiket kolam, tester, transport uji coba",
  }),
  cat("nf_out_retur", "Retur & komplain", "out", {
    group: "Retur & komplain",
    nfKind: "revenue_deduction",
    sort: 1000,
    description: "Refund, salah kirim, kirim ulang, barang rusak",
    hint: "Refund/retur mengurangi omzet bersih",
  }),
  cat("nf_out_alat", "Pembelian alat", "out", {
    group: "Pembelian alat",
    nfKind: "capex",
    sort: 1100,
    description: "Mesin, printer, laptop, HP, rak gudang",
  }),
  cat("nf_out_owner", "Uang owner", "out", {
    group: "Uang owner",
    nfKind: "prive",
    sort: 1200,
    hint: "Kurangi saldo kas, tidak mengurangi laba NF",
    description: "Prive owner, transfer ke usaha lain, pengembalian modal",
  }),

  // ── Transfer internal (netral laba) ──
  cat("nf_out_trf_internal", "Transfer internal", "out", {
    group: "Transfer internal",
    nfKind: "transfer",
    sort: 1300,
    hint: "Perpindahan antar dompet — bukan pemasukan/pengeluaran usaha",
  }),
];

/** Subkategori detail (deploy lama) → 12 kategori besar */
export const NF_LEGACY_CATEGORY_REMAP = {
  nf_in_ongkir_buyer: "nf_in_other",
  nf_out_bahan_essen: "nf_out_bahan",
  nf_out_bahan_perisa: "nf_out_bahan",
  nf_out_bahan_pewarna: "nf_out_bahan",
  nf_out_bahan_campuran: "nf_out_bahan",
  nf_out_kem_botol: "nf_out_kemasan",
  nf_out_kem_tutup: "nf_out_kemasan",
  nf_out_kem_stiker: "nf_out_kemasan",
  nf_out_kem_segel: "nf_out_kemasan",
  nf_out_kem_kardus: "nf_out_kemasan",
  nf_out_kem_bubble: "nf_out_kemasan",
  nf_out_kem_qr: "nf_out_kemasan",
  nf_out_prod_upah: "nf_out_produksi",
  nf_out_prod_packing: "nf_out_produksi",
  nf_out_prod_gagal: "nf_out_produksi",
  nf_out_prod_rusak: "nf_out_produksi",
  nf_out_kirim_pesanan: "nf_out_pengiriman",
  nf_out_kirim_bahan: "nf_out_pengiriman",
  nf_out_kirim_bensin: "nf_out_pengiriman",
  nf_out_kirim_cargo: "nf_out_pengiriman",
  nf_out_mp_admin: "nf_out_marketplace",
  nf_out_mp_affiliate: "nf_out_marketplace",
  nf_out_mp_voucher: "nf_out_marketplace",
  nf_out_mp_campaign: "nf_out_marketplace",
  nf_out_mkt_iklan: "nf_out_marketing",
  nf_out_mkt_kol: "nf_out_marketing",
  nf_out_mkt_affiliate: "nf_out_marketing",
  nf_out_mkt_tester: "nf_out_marketing",
  nf_out_mkt_giveaway: "nf_out_marketing",
  nf_out_mkt_konten: "nf_out_marketing",
  nf_out_kar_gaji: "nf_out_karyawan",
  nf_out_kar_bonus: "nf_out_karyawan",
  nf_out_kar_lembur: "nf_out_karyawan",
  nf_out_kar_makan: "nf_out_karyawan",
  nf_out_ops_listrik: "nf_out_operasional",
  nf_out_ops_internet: "nf_out_operasional",
  nf_out_ops_sewa: "nf_out_operasional",
  nf_out_ops_atk: "nf_out_operasional",
  nf_out_ops_software: "nf_out_operasional",
  nf_out_ops_domain: "nf_out_operasional",
  nf_out_ops_fonnte: "nf_out_operasional",
  nf_out_riset_bahan: "nf_out_riset",
  nf_out_riset_kolam: "nf_out_riset",
  nf_out_riset_tester: "nf_out_riset",
  nf_out_riset_transport: "nf_out_riset",
  nf_out_ret_refund: "nf_out_retur",
  nf_out_ret_salah: "nf_out_retur",
  nf_out_ret_ulang: "nf_out_retur",
  nf_out_ret_rusak: "nf_out_retur",
  nf_out_alat_mesin: "nf_out_alat",
  nf_out_alat_printer: "nf_out_alat",
  nf_out_alat_laptop: "nf_out_alat",
  nf_out_alat_hp: "nf_out_alat",
  nf_out_alat_rak: "nf_out_alat",
  nf_out_own_prive: "nf_out_owner",
  nf_out_own_transfer: "nf_out_owner",
  nf_out_own_modal: "nf_out_owner",
};

const LEGACY_EC_IDS = new Set([
  "ec_in1", "ec_in2", "ec_out1", "ec_out2", "ec_out3", "ec_out4", "ec_out5",
]);

const DETAILED_NF_PREFIXES = [
  "nf_out_bahan_",
  "nf_out_kem_",
  "nf_out_prod_",
  "nf_out_kirim_",
  "nf_out_mp_",
  "nf_out_mkt_",
  "nf_out_kar_",
  "nf_out_ops_",
  "nf_out_riset_",
  "nf_out_ret_",
  "nf_out_alat_",
  "nf_out_own_",
];

export function normalizeNfCategoryId(id) {
  if (!id) return id;
  return NF_LEGACY_CATEGORY_REMAP[id] || id;
}

export function isLegacyEcommerceCategoryList(categories = []) {
  const list = categories || [];
  if (!list.length) return false;
  return list.every((c) => LEGACY_EC_IDS.has(c.id) || /^ec_(in|out)\d+$/.test(String(c.id || "")));
}

/** Katalog subkategori detail (deploy lama) — ganti ke 12 besar. */
export function isDetailedNfCategoryList(categories = []) {
  return (categories || []).some((c) => {
    const id = String(c.id || "");
    return DETAILED_NF_PREFIXES.some((p) => id.startsWith(p));
  });
}

/** Katalog pemasukan lama (2 kategori MP agregat) — perlu upgrade ke channel per platform. */
export function needsNfChannelUpgrade(categories = []) {
  const list = categories || [];
  if (!list.length) return true;
  if (list.some((c) => c.id === "nf_in_mp_tiktok")) return false;
  if (hasLegacyNfMpIncomeCategories(list)) return true;
  return false;
}

/** Kategori pemasukan MP agregat (legacy) — diganti channel per platform. */
export const NF_LEGACY_MP_INCOME_IDS = new Set(["nf_in_mp_gross", "nf_in_mp_net"]);

export const NF_LEGACY_MP_INCOME_NAMES = new Set([
  "penjualan mp (kotor)",
  "pemasukan mp (bersih)",
]);

export function hasLegacyNfMpIncomeCategories(categories = []) {
  return (categories || []).some((c) => {
    if (NF_LEGACY_MP_INCOME_IDS.has(c.id)) return true;
    const nm = String(c.name || "").trim().toLowerCase();
    return NF_LEGACY_MP_INCOME_NAMES.has(nm);
  });
}

export function isNfCatalogCategory(c) {
  if (!c) return false;
  if (c.nfKind) return true;
  return String(c.id || "").startsWith("nf_");
}

export function hasNfFishingCatalog(categories = []) {
  return (categories || []).some((c) => isNfCatalogCategory(c));
}

export function ensureNfFishingCategories(categories = []) {
  const byId = new Map();
  for (const c of categories || []) {
    if (c?.id) byId.set(c.id, c);
  }
  for (const def of NF_FISHING_DEFAULT_CATEGORIES) {
    const existing = byId.get(def.id);
    byId.set(def.id, existing
      ? {
          ...def,
          ...existing,
          nfKind: def.nfKind ?? existing.nfKind,
          channelGroup: def.channelGroup ?? existing.channelGroup,
          platformId: def.platformId ?? existing.platformId,
          defaultWalletId: def.defaultWalletId ?? existing.defaultWalletId,
          purchasingUse: def.purchasingUse,
          group: def.group ?? existing.group,
          active: def.active === false ? false : (existing.active !== false),
        }
      : { ...def });
  }
  // Nonaktifkan kategori pemasukan legacy jika channel baru sudah ada
  const hasChannelIncome = [...byId.values()].some((c) => c.id === "nf_in_mp_tiktok");
  if (hasChannelIncome) {
    for (const legacyId of ["nf_in_mp_gross", "nf_in_mp_net"]) {
      const leg = byId.get(legacyId);
      if (leg) byId.set(legacyId, { ...leg, active: false });
    }
  }
  for (const oldId of Object.keys(NF_LEGACY_CATEGORY_REMAP)) {
    byId.delete(oldId);
  }
  return [...byId.values()].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
}

export function isNfRevenueCategory(cat) {
  const k = cat?.nfKind;
  return k === "revenue_net" || k === "revenue_gross";
}

export function nfCategoryById(categories = []) {
  return new Map((categories || []).map((c) => [c.id, c]));
}

export function nfPurchasingCategories(categories = []) {
  return (categories || []).filter((c) => c.active !== false && c.type === "out" && c.purchasingUse);
}

/** Remap categoryId transaksi lama ke 12 kategori besar. */
export function remapNfTransactions(transactions = []) {
  let changed = false;
  const out = (transactions || []).map((t) => {
    const next = normalizeNfCategoryId(t.categoryId);
    if (next && next !== t.categoryId) {
      changed = true;
      return { ...t, categoryId: next };
    }
    return t;
  });
  return { transactions: out, changed };
}
