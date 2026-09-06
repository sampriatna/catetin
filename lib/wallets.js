// lib/wallets.js — katalog dompet, rename migrasi, urutan tampilan

import { DEFAULT_TIKTOK_GO_WALLET, TIKTOK_GO_WALLET_ID } from "./tiktokGoSettlement.js";

/** Modal/plafond laci outlet F&B — tetap Rp 250.000 (KBU/KSM/SMT sama rata). */
export const LACI_PLAFOND = 250000;

/** ID dompet laci outlet yang wajib plafond tetap. */
export const LACI_WALLET_IDS = new Set(["w_laci_kbu", "w_laci_ksm", "w_laci_smt"]);

/** True jika dompet adalah laci outlet (plafond dikunci 250rb). */
export function isLockedLaciWallet(w) {
  if (!w) return false;
  if (LACI_WALLET_IDS.has(w.id)) return true;
  return w.type === "kas_fisik" && !!w.outlet && /laci/i.test(w.name || "");
}

/** Plafond laci selalu 250rb — tidak boleh kurang/lebih dari setting. */
export function resolveLaciPlafond(walletOrFloor) {
  if (walletOrFloor && typeof walletOrFloor === "object") {
    if (isLockedLaciWallet(walletOrFloor)) return LACI_PLAFOND;
    const n = Math.round(Number(walletOrFloor.floor) || 0);
    return n > 0 ? n : LACI_PLAFOND;
  }
  const n = Math.round(Number(walletOrFloor) || 0);
  return n > 0 ? n : LACI_PLAFOND;
}

/** Paksa floor = 250rb pada semua laci outlet (abaikan nilai salah di cloud/UI). */
export function enforceLaciPlafond(wallets) {
  return (wallets || []).map((w) => {
    if (!isLockedLaciWallet(w)) return w;
    if (Math.round(Number(w.floor) || 0) === LACI_PLAFOND) return w;
    return { ...w, floor: LACI_PLAFOND };
  });
}

/** Patch nama/warna dompet digital food (ID tetap — transaksi lama aman). */
export const FOOD_WALLET_PATCH = {
  w_pm: { name: "Shopee Food", color: "#EE4D2D", type: "digital" },
  w_nf: { name: "Grab Food", color: "#00B14F", type: "digital" },
};

/** Nama lama sebelum migrasi Shopee/Grab/Go Food — di-rename otomatis ke label baru. */
const LEGACY_FOOD_WALLET_NAMES = {
  w_pm: new Set([
    "payment method", "pm", "shopee pay", "shopeepay",
    "dompet pm", "dompet payment method",
  ]),
  w_nf: new Set([
    "night food", "nf", "grab pay", "grabpay",
    "dompet nf", "dompet night food",
  ]),
  w_gofood: new Set(["gojek", "ojek online", "ojek", "dompet gofood", "go food wallet"]),
};

function isLegacyFoodWalletName(walletId, name) {
  const n = (name || "").trim().toLowerCase();
  const legacy = LEGACY_FOOD_WALLET_NAMES[walletId];
  if (legacy?.has(n)) return true;
  if (walletId === "w_pm" && /^dompet\s*pm$/i.test(name || "")) return true;
  if (walletId === "w_nf" && /^dompet\s*nf$/i.test(name || "")) return true;
  return false;
}

/** Label tampilan dompet food delivery (abaikan nama lama di DB). */
export function foodWalletDisplayName(wallet) {
  if (!wallet?.id) return "—";
  const patch = FOOD_WALLET_PATCH[wallet.id];
  if (patch?.name) return patch.name;
  if (wallet.id === "w_gofood") return DEFAULT_GO_FOOD_WALLET.name;
  return wallet.name || "—";
}

export const DEFAULT_GO_FOOD_WALLET = {
  id: "w_gofood",
  name: "Go Food",
  type: "digital",
  outlet: null,
  color: "#00AA13",
  opening: 0,
  floor: 0,
  active: true,
  sort: 52,
};

/** Channel omset → dompet settle (food delivery). */
export const FOOD_CHANNEL_SETTLE = {
  shopee: "w_pm",
  shopefood: "w_pm",
  grab: "w_nf",
  grabfood: "w_nf",
  gofood: "w_gofood",
  gojek: "w_gofood",
  ojek_online: "w_gofood",
  online: "w_gofood",
  tiktok_go: TIKTOK_GO_WALLET_ID,
};

export function sortWallets(wallets) {
  return [...(wallets || [])].sort((a, b) => {
    const sa = a.sort ?? 9999;
    const sb = b.sort ?? 9999;
    if (sa !== sb) return sa - sb;
    return (a.name || "").localeCompare(b.name || "", "id");
  });
}

/** Tambah Go Food + TikTok Go, rename PM/NF — HANYA untuk katalog F&B (punya w_pm / w_nf / laci).
 *  Bisnis e-commerce/NF tidak boleh di-inject dompet food delivery. */
export function patchWalletCatalog(wallets) {
  const byId = new Map((wallets || []).map((w) => [w.id, { ...w }]));
  const looksLikeFnB =
    byId.has("w_pm") ||
    byId.has("w_nf") ||
    byId.has("w_laci_kbu") ||
    byId.has("w_kas_besar") ||
    byId.has("w_gofood") ||
    byId.has(TIKTOK_GO_WALLET_ID);

  for (const [id, patch] of Object.entries(FOOD_WALLET_PATCH)) {
    const w = byId.get(id);
    if (!w) continue;
    if (isLegacyFoodWalletName(id, w.name)) {
      Object.assign(w, patch);
    } else if (!w.type && patch.type) {
      w.type = patch.type;
    } else if ((w.name || "").trim().toLowerCase() === patch.name.toLowerCase()) {
      w.color = w.color || patch.color;
      w.type = w.type || patch.type;
    }
  }

  if (looksLikeFnB) {
    const go = byId.get("w_gofood");
    if (go && isLegacyFoodWalletName("w_gofood", go.name)) {
      Object.assign(go, DEFAULT_GO_FOOD_WALLET);
    }
    if (!byId.has("w_gofood")) {
      byId.set("w_gofood", { ...DEFAULT_GO_FOOD_WALLET });
    }
    if (!byId.has(TIKTOK_GO_WALLET_ID)) {
      byId.set(TIKTOK_GO_WALLET_ID, { ...DEFAULT_TIKTOK_GO_WALLET });
    }
  }

  const list = [...byId.values()];
  list.forEach((w, i) => {
    if (w.sort == null || w.sort === undefined) w.sort = (i + 1) * 10;
    // KBU / KSM / SMT: plafond tetap 250rb — tidak boleh diubah lewat setting/cloud.
    if (isLockedLaciWallet(w)) w.floor = LACI_PLAFOND;
  });
  return sortWallets(list);
}

/** Perbarui settleWallet channel food di data tersimpan. */
export function migrateReportChannelSettles(reportChannels) {
  if (!reportChannels || typeof reportChannels !== "object") return reportChannels;
  const out = { ...reportChannels };
  for (const outlet of Object.keys(out)) {
    const channels = out[outlet];
    if (!Array.isArray(channels)) continue;
    out[outlet] = channels.map((ch) => {
      if (ch?.role !== "channel") return ch;
      const target = FOOD_CHANNEL_SETTLE[ch.id];
      if (target && ch.settleWallet !== target) {
        return { ...ch, settleWallet: target };
      }
      return ch;
    });
  }
  return out;
}

export function settleWalletOptionsFromWallets(wallets) {
  const bank = sortWallets(wallets).filter((w) => w.type === "rekening" && w.active !== false);
  const digital = sortWallets(wallets).filter((w) =>
    w.active !== false && (w.type === "digital" || w.id === "w_gofood" || w.id === "w_pm" || w.id === "w_nf" || w.id === TIKTOK_GO_WALLET_ID)
  );
  return [
    ...bank.map((w) => ({ id: w.id, label: w.name })),
    ...digital.map((w) => ({ id: w.id, label: w.name })),
  ];
}

/** Gabung dompet — perubahan lokal (nama, logo, warna) menang atas salinan awan lama. */
export function mergeWalletsPreferLocal(remoteArr = [], localArr = []) {
  const map = new Map();
  (remoteArr || []).forEach((item) => {
    if (item?.id != null) map.set(item.id, item);
  });
  (localArr || []).forEach((item) => {
    if (item?.id == null) return;
    const prev = map.get(item.id);
    map.set(item.id, prev ? { ...prev, ...item } : item);
  });
  return [...map.values()];
}
