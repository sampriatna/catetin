// lib/accountUi.js — navigasi & tampilan dashboard per role/outlet

import { canDo, ROLE_LABEL, showVoidTab, showAnalisisTab, showPurchasingAsistenTab } from "./rbac.js";
import { OUTLET_LABEL } from "./sdmHarian.js";
import { SOSMED_OUTLET_DISPLAY } from "./sosmedReport.js";
import { roleDisplayLabel } from "./membershipResolve.js";
import { businessFeatures } from "./businessFeatures.js";

const GRAD = {
  owner: "linear-gradient(135deg,#5B5BD6,#7C7CF8)",
  admin: "linear-gradient(135deg,#D97706,#6366F1)",
  purchasing: "linear-gradient(135deg,#059669,#0D9488)",
  KBU: "linear-gradient(135deg,#EA580C,#F59E0B)",
  KSM: "linear-gradient(135deg,#7C3AED,#A855F7)",
  SMT: "linear-gradient(135deg,#2563EB,#0EA5E9)",
  default: "linear-gradient(135deg,#6366F1,#4F46E5)",
};

/** Tab bottom nav — Void HANYA kasir outlet F&B. */
export function navConfig(user, business, _voidPending = 0) {
  const role = user?.role || "kasir";
  const feat = businessFeatures(business);
  const left = [
    ["beranda", "Beranda"],
    ["laporan", "Laporan"],
  ];
  const right = [];

  if (feat.voidOutlet && showVoidTab(role)) right.push(["void", "Void"]);
  if (feat.fnbAnalisis && showAnalisisTab(role)) right.push(["analisis", "Analisis"]);
  if (feat.purchasingModule && showPurchasingAsistenTab(role)) right.push(["asisten", "Asisten"]);
  right.push(["profil", "Atur"]);

  return { left, right };
}

export function getAccountUi(user, business) {
  const role = user?.role || "kasir";
  const outlet = user?.outlet;
  const feat = businessFeatures(business);
  const roleLabel = roleDisplayLabel(user) || ROLE_LABEL[role] || role;

  let saldoGradient = GRAD.default;
  let homeTitle = "";
  let homeSubtitle = "";
  let walletSectionTitle = "Dompet";

  if (role === "kasir" && outlet) {
    saldoGradient = GRAD[outlet] || GRAD.default;
    homeTitle = SOSMED_OUTLET_DISPLAY[outlet] || OUTLET_LABEL[outlet] || outlet;
    walletSectionTitle = `Laci ${outlet}`;
  } else if (role === "purchasing") {
    saldoGradient = GRAD.purchasing;
    if (feat.isFnB) {
      homeTitle = "Belanja & Kas Kecil";
      homeSubtitle = "Saldo utama: Kas Kecil dari Admin Keuangan. Rekening bank hanya untuk bayar — tanpa lihat pemasukan bank.";
    } else {
      homeTitle = "Belanja NF";
      homeSubtitle = "Catat pengeluaran & cari riwayat belanja. Isi deskripsi saat catat supaya mudah dicari.";
    }
    walletSectionTitle = "Dompet belanja";
  } else if (role === "admin") {
    saldoGradient = GRAD.admin;
    homeTitle = "Admin Keuangan";
  } else if (role === "owner") {
    saldoGradient = GRAD.owner;
    homeTitle = feat.isFnB ? "Ringkasan keuangan" : "Keuangan bisnis";
    walletSectionTitle = feat.isFnB ? "Seluruh dompet" : "Dompet bisnis ini";
  }

  if (!feat.isFnB && !homeSubtitle) {
    homeSubtitle = "Dompet & laporan di sini terpisah dari resto Nusa Food (KBU/KSM/SMT).";
  }

  return {
    roleLabel,
    micTitle: role === "kasir" ? "Catat pengeluaran laci" : role === "purchasing" ? (feat.isFnB ? "Catat belanja" : "Catat belanja baru") : "Catat transaksi",
    saldoGradient,
    homeTitle,
    homeSubtitle,
    walletSectionTitle,
    laporanTitle: "Laporan",
    badgeBg: "var(--brand-soft)",
    badgeColor: "var(--brand-text)",
  };
}

export const ACCOUNT_MAP = [
  { email: "sampriatna@gmail.com", role: "owner", outlet: null, label: "Owner — semua + undang staf" },
  { email: "duriplant@gmail.com", role: "admin", outlet: null, label: "Admin Keuangan — tanpa undang" },
  { email: "durinah55@gmail.com", role: "admin", outlet: null, label: "Admin Keuangan NF — pemasukan & pengeluaran" },
  { email: "nf3.crb@gmail.com", role: "purchasing", outlet: null, label: "Purchasing — belanja saja" },
  { email: "kopiburiumah@gmail.com", role: "kasir", outlet: "KBU", label: "Kasir KBU" },
  { email: "ramenkisamen@gmail.com", role: "kasir", outlet: "KSM", label: "Kasir KSM" },
  { email: "samtarospace@gmail.com", role: "kasir", outlet: "SMT", label: "Kasir SMT" },
];
