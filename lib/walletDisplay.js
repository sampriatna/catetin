// lib/walletDisplay.js — tampilan saldo dompet per role (UI purchasing)

import { LACI_PLAFOND, isLockedLaciWallet } from "./wallets.js";

export function isKasKecilWalletDisplay(w) {
  if (!w) return false;
  if (w.id === "w_kas_kecil") return true;
  return /kas\s*kecil/i.test(w.name || "");
}

export function isLaciOutletWallet(w) {
  if (!w) return false;
  if (/^w_laci_/i.test(w.id || "")) return true;
  return w.type === "kas_fisik" && !!w.outlet;
}

/** Floor efektif laci — selalu 250rb untuk KBU/KSM/SMT. */
export function effectiveLaciFloor(w) {
  if (isLockedLaciWallet(w) || isLaciOutletWallet(w)) return LACI_PLAFOND;
  return Math.round(Number(w?.floor) || 0) || LACI_PLAFOND;
}

/**
 * Laci outlet — minus di layar biasanya selisih laporan/settle, bukan uang fisik hilang.
 */
export function laciBalancePresentation(bal, fmtMoney, cur, floor = LACI_PLAFOND) {
  const n = Math.round(Number(bal) || 0);
  const fl = Math.round(Number(floor) || 0) || LACI_PLAFOND;
  if (n < fl) {
    return {
      primary: n < 0 ? "Selisih laci" : fmtMoney(n, cur),
      secondary: "Cek Settle Laporan Kasir.",
      variant: "warn",
    };
  }
  return { primary: fmtMoney(n, cur), secondary: null, variant: "ok" };
}

/** Sembunyikan angka saldo dari staf purchasing (dompet tetap bisa dipilih). */
export function walletHidesBalanceFromPurchasing(w) {
  if (!w) return false;
  if (w.hide_balance === true || w.hideBalanceFromPurchasing === true) return true;
  // Rekening Sam terhubung — purchasing boleh catat, tidak boleh lihat saldo.
  // Ops share (Uang NF / PayLater) boleh lihat saldo → hide_balance=false di virtual wallet.
  if (
    (w.type === "shared" || String(w.id || "").startsWith("shared_")) &&
    w.sharedLink?.linkKind !== "ops_share" &&
    w.hide_balance !== false
  ) {
    return true;
  }
  return false;
}

/**
 * Kartu saldo purchasing — jangan tampilkan minus merah (memicu owner sesuaikan saldo berulang).
 * Minus = dana habis, bukan error sistem.
 */
export function purchasingBalancePresentation(bal, fmtMoney, cur) {
  const n = Math.round(Number(bal) || 0);
  if (n < 0) {
    return {
      primary: "Dana belanja habis",
      secondary: "Minta top-up admin — jangan pakai Sesuaikan Saldo.",
      variant: "empty",
    };
  }
  if (n === 0) {
    return {
      primary: fmtMoney(0, cur),
      secondary: "Saldo kosong — hubungi admin sebelum belanja.",
      variant: "low",
    };
  }
  return { primary: fmtMoney(n, cur), secondary: null, variant: "ok" };
}

export function shouldHideWalletBalance(w, user) {
  if ((user?.role || "kasir") !== "purchasing") return false;
  return walletHidesBalanceFromPurchasing(w);
}

/** Label dompet + saldo untuk dropdown/kartu. Purchasing + hide_balance → nama saja. */
export function walletOptionLabel(w, bal, cur, user, fmtMoney) {
  if (shouldHideWalletBalance(w, user)) return w.name;
  if ((w?.type === "paylater" || w?.liability) && bal < 0) {
    return `${w.name} — Hutang ${fmtMoney(Math.abs(bal), cur)}`;
  }
  return `${w.name} — ${fmtMoney(bal, cur)}`;
}

/** Saldo untuk kartu dompet; null = jangan tampilkan angka. */
export function walletBalanceDisplay(w, bal, cur, user, fmtMoney) {
  if (shouldHideWalletBalance(w, user)) return null;
  if ((user?.role || "kasir") === "purchasing" && isKasKecilWalletDisplay(w)) {
    const pres = purchasingBalancePresentation(bal, fmtMoney, cur);
    return pres.variant === "empty" ? pres.primary : pres.primary;
  }
  if (isLaciOutletWallet(w) && bal < effectiveLaciFloor(w)) {
    return laciBalancePresentation(bal, fmtMoney, cur, effectiveLaciFloor(w)).primary;
  }
  if ((w?.type === "paylater" || w?.liability) && bal < 0) {
    return `Hutang ${fmtMoney(Math.abs(bal), cur)}`;
  }
  return fmtMoney(bal, cur);
}

/** Total saldo beranda — hanya dompet yang saldonya boleh dilihat purchasing. */
export function walletsForSaldoTotal(wallets, user) {
  return (wallets || []).filter((w) => !shouldHideWalletBalance(w, user));
}
