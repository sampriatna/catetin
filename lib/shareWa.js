// lib/shareWa.js — format laporan NF3 & buka WhatsApp (tanpa input ulang)

import {
  DM_PLATFORMS, SOCIAL_PLATFORMS, STAR_KEYS, sosmedDisplayName,
} from "./sosmedReport.js";
import { OUTLET_LABEL, opsTagsLabel, OPS_TAGS_MORNING, OPS_TAGS_EVENING } from "./sdmHarian.js";
import { reportCashAmount } from "./reportChannels.js";
import { VOID_TYPES } from "./voidLog.js";
import { walletBalance } from "./kasirHarian.js";
import { shouldHideWalletBalance } from "./walletDisplay.js";
import { purchasingOutletLabel } from "./purchasingExpense.js";
import { walletBalanceAtDate, KAS_KECIL_ID } from "./purchasingKasKecil.js";
import { resolveWalletId, resolveTransferIds } from "./transactionNormalize.js";
import { isPurchasingTx } from "./purchasingExpense.js";

function isKasKecilWallet(w) {
  if (!w || w.active === false) return false;
  if (w.id === "w_kas_kecil") return true;
  return /kas\s*kecil/i.test(w.name || "");
}

function isoDayBefore(iso) {
  if (!iso) return iso;
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function inferPurchasingReportWalletId({ selectedWalletId, transactions, wallets }) {
  if (selectedWalletId) return selectedWalletId;
  const txWalletIds = [...new Set((transactions || []).map((t) => resolveWalletId(t)).filter(Boolean))];
  if (txWalletIds.length === 1) return txWalletIds[0];
  if ((wallets || []).some((w) => w.id === KAS_KECIL_ID)) return KAS_KECIL_ID;
  const firstKasKecil = (wallets || []).find((w) => isKasKecilWallet(w));
  return firstKasKecil?.id || null;
}

export async function openWhatsAppShare(text, phone) {
  if (typeof window === "undefined") return;
  const raw = String(text || "").trim();
  if (!raw) return;

  const digits = phone ? String(phone).replace(/\D/g, "") : "";

  // Laporan SO gudang bisa sangat panjang. Jangan pernah dipotong diam-diam.
  // Di HP, native Web Share mengirim teks utuh tanpa menaruh seluruh laporan
  // di query-string wa.me (yang sebelumnya dipotong paksa 4.000 karakter).
  if (!digits && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text: raw });
      return;
    } catch (e) {
      // User menutup share sheet = selesai, jangan malah buka tab WhatsApp lagi.
      if (e?.name === "AbortError") return;
      // Browser tertentu mengaku mendukung share tetapi gagal; lanjut fallback.
    }
  }

  // Fallback browser desktop / WebView lama.
  // Untuk laporan panjang, salin UTUH ke clipboard lalu buka WhatsApp tanpa
  // query text agar URL tidak menjadi sangat panjang. User tinggal Paste.
  if (raw.length > 3500 && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(raw);
      const url = digits ? `https://wa.me/${digits}` : "https://wa.me/";
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => {
        window.alert("Laporan panjang sudah disalin lengkap. Di WhatsApp, tekan Paste/Tempel lalu kirim.");
      }, 150);
      return;
    } catch {
      // Clipboard bisa ditolak browser; fallback terakhir pakai wa.me teks utuh.
    }
  }

  const enc = encodeURIComponent(raw);
  const url = digits ? `https://wa.me/${digits}?text=${enc}` : `https://wa.me/?text=${enc}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function fmtRp(n) {
  return new Intl.NumberFormat("id-ID").format(Math.max(0, +(n || 0)));
}

function fmtDateId(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("id-ID", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function bulletList(items, prefix = "•") {
  const list = (items || []).filter(Boolean);
  if (!list.length) return `${prefix} —`;
  return list.map(l => `${prefix} ${l}`).join("\n");
}

function header(title, outlet, date) {
  const out = outlet ? (sosmedDisplayName(outlet) !== outlet ? sosmedDisplayName(outlet) : OUTLET_LABEL[outlet] || outlet) : "";
  return [
    `📋 *${title}*`,
    out ? `🏪 ${out}` : "",
    `📅 ${fmtDateId(date)}`,
    "",
  ].filter(Boolean).join("\n");
}

/** Daily Report Sosmed */
export function formatSosmedWa(entry) {
  if (!entry) return "";
  const out = entry.outlet;
  let t = header("DAILY REPORT SOSIAL MEDIA", out, entry.date);

  t += "*DM masuk:*\n";
  DM_PLATFORMS.forEach(p => {
    t += `• ${p.label} = ${entry.dm?.[p.key] || 0}\n`;
  });
  t += "\n*Komentar postingan:*\n";
  SOCIAL_PLATFORMS.forEach(p => {
    t += `• ${p.label} = ${entry.comments?.[p.key] || 0}\n`;
  });
  t += "\n*Google review:*\n";
  STAR_KEYS.forEach(s => {
    t += `• ${s.label} = ${entry.googleReviews?.[s.key] || 0}\n`;
  });
  t += "\n*Sudah dibalas:*\n";
  SOCIAL_PLATFORMS.forEach(p => {
    t += `• ${p.label} ${entry.replied?.[p.key] ? "✅" : "⬜"}\n`;
  });
  t += `\n*Well-done:* ${entry.wellDone ? "✅" : "⬜"}\n`;
  t += "\n*Komplain follow-up:*\n";
  t += bulletList(entry.complaints) + "\n";
  t += "\n*Pertanyaan customer terbanyak:*\n";
  t += bulletList(entry.topQuestions) + "\n";
  if (entry.submittedByName) t += `\n_Oleh: ${entry.submittedByName}_\n`;
  t += "\n— NF3";
  return t;
}

/** SDM pagi */
export function formatSdmWa(report) {
  if (!report) return "";
  let t = header("SDM PAGI", report.outlet, report.date);
  t += `👥 SDM: *${report.headcount}* orang\n`;
  t += `💰 Gaji harian: Rp ${fmtRp(report.sdmCost)} (${fmtRp(report.dailyWage)}/org)\n`;
  t += `🎯 Target omset: Rp ${fmtRp(report.targetOmset)} (${fmtRp(report.omsetPerPerson)}/org)\n`;
  t += `📊 Rasio gaji/omset: *${report.ratioLabel}* → ${report.statusLabel}\n`;
  if (report.opsTags?.length) {
    t += `\n*Kendala pagi:* ${opsTagsLabel(report.opsTags, OPS_TAGS_MORNING)}\n`;
  }
  if (report.opsNote) t += `📝 ${report.opsNote}\n`;
  if (report.advice?.summary) t += `\n💡 ${report.advice.summary}\n`;
  if (report.kasirName) t += `\n_Oleh: ${report.kasirName}_\n`;
  t += "\n— NF3";
  return t;
}

/** Laporan omset harian kasir */
export function formatOmsetWa(report, channelDefs = []) {
  if (!report) return "";
  let t = header("LAPORAN OMSET HARIAN", report.outlet, report.date);
  t += `💵 *Total omset: Rp ${fmtRp(report.total)}*\n`;
  if (report.dailyTargetAtSubmit) {
    t += `🎯 Target: Rp ${fmtRp(report.dailyTargetAtSubmit)}`;
    t += report.total >= report.dailyTargetAtSubmit ? " ✅\n" : " ⚠️ di bawah target\n";
  }

  const lines = [];
  if (report.channels && channelDefs.length) {
    channelDefs.forEach(c => {
      const amt = Math.max(0, +(report.channels[c.id] || 0));
      if (amt > 0) lines.push({ label: c.label, amt });
    });
  } else if (report.channels) {
    Object.entries(report.channels).forEach(([id, amt]) => {
      const n = Math.max(0, +amt);
      if (n > 0) lines.push({ label: id, amt: n });
    });
  } else {
    if (report.cash) lines.push({ label: "Tunai", amt: report.cash });
    if (report.qrisBca) lines.push({ label: "QRIS BCA", amt: report.qrisBca });
    if (report.qrisBri) lines.push({ label: "QRIS BRI", amt: report.qrisBri });
    if (report.gojek) lines.push({ label: "Gojek", amt: report.gojek });
  }

  if (lines.length) {
    t += "\n*Rincian channel:*\n";
    lines.forEach(l => { t += `• ${l.label}: Rp ${fmtRp(l.amt)}\n`; });
  }

  if (report.physicalCashEnd > 0) {
    t += `\n💼 Kas fisik akhir: Rp ${fmtRp(report.physicalCashEnd)}\n`;
  }
  const cash = report.setoranOwner ?? reportCashAmount(report, channelDefs);
  if (cash > 0) t += `→ Setoran tunai laci: Rp ${fmtRp(cash)}\n`;

  if (report.opsTags?.length) {
    t += `\n*Kendala closing:* ${opsTagsLabel(report.opsTags, OPS_TAGS_EVENING)}\n`;
  }
  if (report.opsNote) t += `📝 ${report.opsNote}\n`;
  if (report.eveningAdvice?.summary) t += `\n💡 ${report.eveningAdvice.summary}\n`;

  t += `\nStatus: ${report.status === "settled" ? "✅ Settled" : "⏳ Menunggu settle Admin NF3"}\n`;
  if (report.kasirName) t += `_Oleh: ${report.kasirName}_\n`;
  t += "\n— NF3";
  return t;
}

/** Laporan purchasing — belanja harian/periode + sisa dompet */
export function formatPurchasingWa({
  date,
  dateEnd,
  transactions = [],
  wallets = [],
  allTransactions = [],
  user,
  outletFilter = "Semua",
  periodLabel,
  selectedWalletId = null,
}) {
  const txs = [...(transactions || [])].sort(
    (a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id))
  );
  const total = txs.reduce((s, t) => s + (t.amount || 0), 0);
  const outlet =
    outletFilter && outletFilter !== "Semua"
      ? purchasingOutletLabel(outletFilter)
      : null;

  let t = header("LAPORAN BELANJA", outlet, date);
  if (dateEnd && dateEnd !== date) {
    t += `📆 s/d ${fmtDateId(dateEnd)}\n`;
  }
  if (periodLabel) t += `🗓 ${periodLabel}\n`;
  t += "\n";

  t += `💸 *Total belanja: Rp ${fmtRp(total)}* (${txs.length} transaksi)\n\n`;

  const itemLines = [];
  for (const tx of txs) {
    const out = purchasingOutletLabel(tx.outlet);
    const supplier = tx.supplier || "—";
    const items = tx.meta?.items || [];
    if (items.length) {
      for (const it of items) {
        if (!it?.name) continue;
        const qty = Number(it.qty) || 0;
        const unit = it.unit || "pcs";
        const sub = Math.round(Number(it.subtotal) || qty * (Number(it.unitPrice) || 0) || 0);
        const qtyPart = qty ? `${qty} ${unit}` : "";
        const pricePart = it.unitPrice ? `@ Rp ${fmtRp(it.unitPrice)}` : "";
        itemLines.push(
          `• *${it.name}*${qtyPart ? ` — ${qtyPart}` : ""}${pricePart ? ` ${pricePart}` : ""} = Rp ${fmtRp(sub)} (${out} · ${supplier})`
        );
      }
    } else {
      const desc = (tx.desc || tx.description || "Belanja").trim();
      itemLines.push(`• *${desc}* — Rp ${fmtRp(tx.amount)} (${out} · ${supplier})`);
    }
  }

  if (itemLines.length) {
    t += `*Barang dibeli:*\n${itemLines.join("\n")}\n\n`;
  } else {
    t += `_Belum ada transaksi belanja di periode ini._\n\n`;
  }

  const kasKecil = (wallets || []).filter(isKasKecilWallet);
  const balLines = [];
  const singleDay = !dateEnd || dateEnd === date;

  const targetWalletId = inferPurchasingReportWalletId({
    selectedWalletId,
    transactions: txs,
    wallets,
  });
  const targetWallet = (wallets || []).find((w) => w.id === targetWalletId) || null;

  if (singleDay && targetWalletId && targetWallet && !shouldHideWalletBalance(targetWallet, user)) {
    const prev = isoDayBefore(date);
    const opening = walletBalanceAtDate(targetWalletId, wallets, allTransactions || [], prev);
    let transfersIn = 0;
    for (const tx of allTransactions || []) {
      if (tx?.date !== date || tx?.type !== "transfer") continue;
      const { to } = resolveTransferIds(tx);
      if (to === targetWalletId) transfersIn += tx.amount || 0;
    }
    let belanjaOut = 0;
    for (const tx of txs) {
      if (tx?.date !== date) continue;
      if (tx.type !== "out" || !isPurchasingTx(tx)) continue;
      if (resolveWalletId(tx) !== targetWalletId) continue;
      belanjaOut += tx.amount || 0;
    }
    const closing = opening + transfersIn - belanjaOut;
    const ledger = walletBalanceAtDate(targetWalletId, wallets, allTransactions || [], date);
    t += `💰 *Sisa awal:* Rp ${fmtRp(opening)}\n`;
    t += `➕ *Dana masuk:* Rp ${fmtRp(transfersIn)}\n`;
    t += `💸 *Belanja (kas kecil):* Rp ${fmtRp(belanjaOut)}\n`;
    t += `💵 *Sisa kas kecil:* Rp ${fmtRp(closing)}\n`;
    if (Math.abs(closing - ledger) > 1) {
      t += `_⚠ Saldo buku Rp ${fmtRp(ledger)} — cek sync / tarik refresh_\n`;
    }
  } else {
    for (const w of kasKecil) {
      const bal = walletBalance(w.id, wallets, allTransactions || []);
      if (shouldHideWalletBalance(w, user)) {
        balLines.push(`• ${w.name}`);
      } else {
        balLines.push(`💵 *Sisa kas kecil: Rp ${fmtRp(bal)}*`);
      }
    }
    if (balLines.length) t += `${balLines.join("\n")}\n`;
  }

  t += "\n— NF3";
  return t.trim();
}

/** Laporan keuangan (periode) */
export function formatKeuanganWa({ periodLabel, inSum, outSum, net, count, scopeLabel }) {
  let t = `📊 *LAPORAN KEUANGAN NF3*\n`;
  if (scopeLabel) t += `🏪 ${scopeLabel}\n`;
  t += `📅 ${periodLabel}\n\n`;
  t += `📥 Pemasukan: Rp ${fmtRp(inSum)}\n`;
  t += `📤 Pengeluaran: Rp ${fmtRp(outSum)}\n`;
  t += `💰 Laba bersih: ${net < 0 ? "-" : ""}Rp ${fmtRp(Math.abs(net))} ${net >= 0 ? "▲" : "▼"}\n`;
  t += `📝 ${count} transaksi\n\n— NF3`;
  return t;
}

/** Void / cancel */
export function formatVoidWa(entry) {
  if (!entry) return "";
  const type = VOID_TYPES[entry.type]?.label || entry.type;
  let t = header(`VOID — ${type}`, entry.outlet, entry.date);
  t += `🔢 No transaksi: ${entry.txnNo || "—"}\n`;
  if (entry.txnNoNew) t += `🔄 Transaksi baru: ${entry.txnNoNew}\n`;
  if (entry.customerName) t += `👤 Customer: ${entry.customerName}\n`;
  t += `💵 Nominal: Rp ${fmtRp(entry.amount)}\n`;
  t += `📌 ${entry.type === "cancel" ? "Alasan" : "Perubahan"}: ${entry.reason || "—"}\n`;
  t += `👤 Kasir: ${entry.kasirName || "—"} · Ngevoid: ${entry.voidedBy || "—"}\n`;
  t += `Status: ${entry.status === "reviewed" ? "✅ Reviewed" : "⏳ Menunggu review"}\n\n— NF3`;
  return t;
}

/** Build sosmed text from form state (sebelum/sesudah simpan) */
export function formatSosmedFormWa({ outlet, date, dm, comments, googleReviews, replied, wellDone, complaintsText, topQuestionsText, submittedByName }) {
  return formatSosmedWa({
    outlet, date, dm, comments, googleReviews, replied, wellDone,
    complaints: String(complaintsText || "").split("\n").map(l => l.trim()).filter(Boolean),
    topQuestions: String(topQuestionsText || "").split("\n").map(l => l.trim()).filter(Boolean),
    submittedByName,
  });
}
