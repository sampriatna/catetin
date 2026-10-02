// ============================================================
// components/LaporanPurchasing.jsx
// Laporan pengeluaran purchasing — overlay di NF3App
// ============================================================
// Integrasi di NF3App.jsx:
//
// 1. Import:
//    import LaporanPurchasing from "../../../components/LaporanPurchasing";
//
// 2. Tambah tombol di tab Laporan atau menu Purchasing:
//    <button onClick={() => setOverlay("laporanPurchasing")}>Laporan Purchasing</button>
//
// 3. Tambah overlay renderer:
//    {overlay === "laporanPurchasing" && (
//      <LaporanPurchasing s={view} onClose={() => setOverlay(null)} />
//    )}
//
// Install jsPDF (untuk export PDF):
//    npm install jspdf jspdf-autotable
// ============================================================

"use client";

import { useState, useMemo, useCallback } from "react";
import {
  getPeriodBounds,
  shiftAnchor,
  filterTransactions,
  formatPeriodLabel,
  localISO,
} from "../lib/laporanKeuangan";
import { formatRupiah, PURCHASING_OUTLETS, purchasingOutletLabel } from "../lib/purchasingExpense";
import { purchasingTxTitle, purchasingTxSubtitle } from "../lib/purchasingItems";
import { formatPurchasingWa, openWhatsAppShare } from "../lib/shareWa";
import { walletBalanceAtDate } from "../lib/purchasingKasKecil.js";
import { visibleWallets } from "../lib/rbac";
import { shouldHideWalletBalance } from "../lib/walletDisplay";

// ------------------------------------------------------------
// Helper
// ------------------------------------------------------------
const fmtMoney = formatRupiah;
const today    = () => localISO(new Date());

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localISO(d);
}

function isPurchasingTx(t) {
  return t.type === "out" && (
    t.module === "purchasing" ||
    t.source?.startsWith("purchasing")
  );
}

function isTransferIntoWallet(t, walletId) {
  if (!t || t.type !== "transfer") return false;
  return (t.toWalletId || t.to_wallet_id) === walletId;
}

function isRefundIntoWallet(t, walletId) {
  if (!t || t.type !== "in") return false;
  const wId = t.walletId || t.wallet_id;
  if (wId !== walletId) return false;
  const blob = `${t.desc || ""} ${(t.source || "")}`.toLowerCase();
  return /refund|retur|pengembalian/.test(blob);
}

function isAreaWalletName(wallet, area) {
  if (!wallet || !area) return false;
  if (wallet.type === "rekening") return false;
  const areaText = String(area).toLowerCase();
  const idText = String(wallet.id || "").toLowerCase().replace(/^w_/, "").replace(/_/g, " ");
  const nameText = String(wallet.name || "").toLowerCase();
  return nameText.includes(areaText) || idText.includes(areaText);
}

function hasUserAssignedWallet(wallet, user) {
  const uid = user?.id;
  if (!uid) return false;
  return Array.isArray(wallet?.allowedUserIds) && wallet.allowedUserIds.includes(uid);
}

// Periode preset — "1 hari" = hari ini (untuk ringkas WA)
const PRESETS = ["1 hari", "Kemarin", "Mingguan", "Bulanan", "Custom"];

function getPresetBounds(preset, anchorDate, customStart, customEnd) {
  if (preset === "1 hari")   return getPeriodBounds("Harian",  today());
  if (preset === "Kemarin")   return getPeriodBounds("Harian",  isoOffset(-1));
  if (preset === "Mingguan")  return getPeriodBounds("Mingguan", anchorDate);
  if (preset === "Bulanan")   return getPeriodBounds("Bulanan",  anchorDate);
  if (preset === "Custom")    return getPeriodBounds("Custom",   anchorDate, { customStart, customEnd });
  return getPeriodBounds("Harian", today());
}

// ------------------------------------------------------------
// Export CSV — native, tanpa library
// ------------------------------------------------------------
function exportCsv(transactions, categories, wallets, bounds, preset) {
  const catMap    = Object.fromEntries((categories || []).map(c => [c.id, c.name]));
  const walletMap = Object.fromEntries((wallets    || []).map(w => [w.id, w.name]));

  const header = ["Tanggal", "Outlet", "Kategori", "Supplier", "Dompet", "Nominal", "Catatan", "Item Detail"];
  const rows   = transactions.map(t => {
    const items = (t.meta?.items || [])
      .map(i => `${i.name} ${i.qty}${i.unit} @${i.unitPrice}`)
      .join(" | ");
    return [
      t.date,
      purchasingOutletLabel(t.outlet),
      catMap[t.categoryId || t.category_id] || "",
      t.supplier || "",
      walletMap[t.walletId || t.wallet_id] || "",
      t.amount,
      (t.desc || t.description || "").replace(/,/g, " "),
      items,
    ];
  });

  const csv = [header, ...rows]
    .map(row => row.map(v => `"${v}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `laporan-purchasing-${preset.toLowerCase().replace(/ /g, "-")}-${bounds.start}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------
// Export PDF — pakai jsPDF + autoTable
// ------------------------------------------------------------
async function exportPdf(transactions, categories, wallets, bounds, preset) {
  let jsPDF, autoTable;
  try {
    const mod1 = await import("jspdf");
    const mod2 = await import("jspdf-autotable");
    jsPDF     = mod1.jsPDF || mod1.default;
    autoTable = mod2.default || mod2.autoTable;
  } catch {
    alert("Modul PDF belum terinstall.\nJalankan: npm install jspdf jspdf-autotable");
    return;
  }

  const catMap    = Object.fromEntries((categories || []).map(c => [c.id, c.name]));
  const walletMap = Object.fromEntries((wallets    || []).map(w => [w.id, w.name]));
  const total     = transactions.reduce((s, t) => s + (t.amount || 0), 0);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Header
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Laporan Pengeluaran Purchasing — NF3", 14, 16);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Periode: ${preset} (${bounds.start} s/d ${bounds.end})`, 14, 23);
  doc.text(`Total: ${formatRupiah(total)} dari ${transactions.length} transaksi`, 14, 29);
  doc.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, 14, 35);

  // Tabel
  autoTable(doc, {
    startY: 40,
    head: [["Tanggal", "Outlet", "Kategori", "Supplier", "Dompet", "Nominal", "Catatan"]],
    body: transactions.map(t => [
      t.date,
      purchasingOutletLabel(t.outlet),
      catMap[t.categoryId || t.category_id] || "—",
      t.supplier || "—",
      walletMap[t.walletId || t.wallet_id] || "—",
      formatRupiah(t.amount),
      (t.desc || t.description || "").slice(0, 40),
    ]),
    foot: [["", "", "", "", "TOTAL", formatRupiah(total), ""]],
    styles:     { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [24, 95, 165], textColor: 255 },
    footStyles: { fillColor: [240, 240, 240], fontStyle: "bold" },
    columnStyles: { 5: { halign: "right" } },
  });

  doc.save(`laporan-purchasing-${preset.toLowerCase().replace(/ /g, "-")}-${bounds.start}.pdf`);
}

// ------------------------------------------------------------
// Kartu ringkasan
// ------------------------------------------------------------
function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{ ...styles.summaryCard, borderLeft: `3px solid ${color || "#378ADD"}` }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------
// Baris transaksi
// ------------------------------------------------------------
function TxRow({ tx, catMap, walletMap }) {
  const [open, setOpen] = useState(false);
  const hasItems = tx.meta?.items?.length > 0;

  return (
    <div style={styles.txRow}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }} onClick={() => hasItems && setOpen(o => !o)}>
        {/* Tanggal */}
        <div style={{ minWidth: 38, textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1 }}>{tx.date?.slice(8)}</div>
          <div style={{ fontSize: 10, color: "#aaa" }}>{["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"][parseInt(tx.date?.slice(5,7)) - 1]}</div>
        </div>
        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{purchasingTxTitle(tx)}</span>
            {tx.outlet && <span style={styles.badge}>{purchasingOutletLabel(tx.outlet)}</span>}
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            {purchasingTxSubtitle(tx, catMap[tx.categoryId || tx.category_id], walletMap[tx.walletId || tx.wallet_id])}
          </div>
          {tx.supplier && !purchasingTxTitle(tx).includes(tx.supplier) && (
            <div style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>{tx.supplier}</div>
          )}
          {tx.desc && <div style={{ fontSize: 11, color: "#aaa", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.desc}</div>}
        </div>
        {/* Nominal */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#E24B4A" }}>−{formatRupiah(tx.amount)}</div>
          {hasItems && <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{open ? "▲" : "▼"} {tx.meta.items.length} item</div>}
        </div>
      </div>

      {/* Detail item */}
      {open && hasItems && (
        <div style={styles.itemDetail}>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Item", "Qty", "Satuan", "Subtotal"].map(h => (
                  <th key={h} style={{ textAlign: h === "Item" ? "left" : "right", color: "#aaa", fontWeight: 500, paddingBottom: 4, borderBottom: "0.5px solid #eee" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tx.meta.items.map((item, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 0" }}>{item.name}</td>
                  <td style={{ textAlign: "right", color: "#888" }}>{item.qty}</td>
                  <td style={{ textAlign: "right", color: "#888" }}>{item.unit}</td>
                  <td style={{ textAlign: "right", fontWeight: 500 }}>{fmtMoney(item.subtotal || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// KOMPONEN UTAMA
// ------------------------------------------------------------
export default function LaporanPurchasing({ s, onClose }) {
  const user = s.currentUser || { role: "purchasing" };
  const myWallets = useMemo(() => visibleWallets(s.wallets || [], user), [s.wallets, user]);
  const allowedWalletIds = useMemo(() => new Set((myWallets || []).map((w) => w.id)), [myWallets]);
  const assignedWalletIds = useMemo(() => {
    const ids = (myWallets || []).filter((w) => hasUserAssignedWallet(w, user)).map((w) => w.id);
    return new Set(ids);
  }, [myWallets, user]);
  const hasExplicitWalletAssignment = assignedWalletIds.size > 0;
  const purchasingArea = user.role === "purchasing" && user.outlet && !["KBU", "KSM", "SMT"].includes(String(user.outlet).toUpperCase())
    ? String(user.outlet)
    : "";
  const areaWalletIds = useMemo(() => {
    if (hasExplicitWalletAssignment) return assignedWalletIds;
    if (!purchasingArea) return null;
    const ids = (myWallets || []).filter((w) => isAreaWalletName(w, purchasingArea)).map((w) => w.id);
    return new Set(ids);
  }, [hasExplicitWalletAssignment, assignedWalletIds, myWallets, purchasingArea]);
  const [preset,      setPreset]      = useState("1 hari");
  const [anchorDate,  setAnchorDate]  = useState(today());
  const [customStart, setCustomStart] = useState(isoOffset(-7));
  const [customEnd,   setCustomEnd]   = useState(today());
  const [outletFilter,setOutletFilter]= useState("Semua");
  const [walletFilter,setWalletFilter]= useState("all");
  const [creatorFilter,setCreatorFilter]= useState("all");
  const [verifiedFilter,setVerifiedFilter]= useState("all");
  const [exporting,   setExporting]   = useState(null); // "csv" | "pdf" | null

  const bounds = useMemo(
    () => getPresetBounds(preset, anchorDate, customStart, customEnd),
    [preset, anchorDate, customStart, customEnd]
  );

  // Filter transaksi purchasing
  const baseTx = useMemo(
    () => (s.transactions || []).filter((t) => {
      if (!isPurchasingTx(t)) return false;
      const wid = t.walletId || t.wallet_id;
      if (!allowedWalletIds.has(wid)) return false;
      if (areaWalletIds && !areaWalletIds.has(wid)) return false;
      return true;
    }),
    [s.transactions, allowedWalletIds, areaWalletIds]
  );

  const filteredTx = useMemo(() => {
    let tx = filterTransactions(baseTx, {
      start: bounds.start, end: bounds.end, walletId: walletFilter,
    });
    if (outletFilter !== "Semua") tx = tx.filter(t => t.outlet === outletFilter);
    if (creatorFilter !== "all") tx = tx.filter(t => t.meta?.createdById === creatorFilter || t.createdBy === creatorFilter);
    if (verifiedFilter === "verified") tx = tx.filter(t => t.meta?.verified === true);
    if (verifiedFilter === "unverified") tx = tx.filter(t => t.meta?.verified !== true);
    return tx.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [baseTx, bounds, outletFilter, walletFilter, creatorFilter, verifiedFilter]);

  // Ringkasan
  const totalAmount  = filteredTx.reduce((s, t) => s + (t.amount || 0), 0);
  const totalCount   = filteredTx.length;
  const avgPerTx     = totalCount > 0 ? Math.round(totalAmount / totalCount) : 0;

  // Terbesar per kategori
  const catMap    = Object.fromEntries((s.categories || []).map(c => [c.id, c.name]));
  const walletMap = Object.fromEntries((myWallets || []).map(w => [w.id, w.name]));
  const creatorMap = Object.fromEntries((s.members || []).map((m) => [m.user_id, m.profiles?.name || m.profiles?.email || m.user_id]));
  const walletOptions = [{ id: "all", name: "Semua dompet" }, ...(myWallets || []).map((w) => ({ id: w.id, name: w.name }))];
  const creatorOptions = [{ id: "all", name: "Semua user" }, ...Object.entries(creatorMap).map(([id, name]) => ({ id, name }))];
  const selectedWalletId = walletFilter === "all" ? null : walletFilter;
  const openingBalance = selectedWalletId ? walletBalanceAtDate(selectedWalletId, s.wallets || [], s.transactions || [], bounds.start) : null;
  const transferIn = selectedWalletId
    ? (s.transactions || []).filter((t) => (t.date || "") >= bounds.start && (t.date || "") <= bounds.end && isTransferIntoWallet(t, selectedWalletId)).reduce((sum, t) => sum + (t.amount || 0), 0)
    : null;
  const refundIn = selectedWalletId
    ? (s.transactions || []).filter((t) => (t.date || "") >= bounds.start && (t.date || "") <= bounds.end && isRefundIntoWallet(t, selectedWalletId)).reduce((sum, t) => sum + (t.amount || 0), 0)
    : null;
  const unverifiedCount = filteredTx.filter((t) => t.meta?.verified !== true).length;
  const noReceiptCount = filteredTx.filter((t) => !t.receiptUrl && !t.receipt_url).length;
  const closingBalance = selectedWalletId && openingBalance != null && transferIn != null && refundIn != null
    ? openingBalance + transferIn + refundIn - totalAmount
    : null;

  const byOutlet = PURCHASING_OUTLETS.map(o => ({
    ...o,
    total: filteredTx.filter(t => t.outlet === o.code).reduce((s, t) => s + t.amount, 0),
  })).filter(o => o.total > 0).sort((a, b) => b.total - a.total);

  const waText = useMemo(() => formatPurchasingWa({
    date: bounds.start,
    dateEnd: bounds.end,
    transactions: filteredTx,
    wallets: s.wallets || [],
    allTransactions: s.transactions || [],
    user,
    outletFilter,
    selectedWalletId,
    periodLabel: preset === "1 hari" || preset === "Kemarin"
      ? null
      : formatPeriodLabel(preset === "Mingguan" ? "Mingguan" : preset === "Bulanan" ? "Bulanan" : "Custom", bounds),
  }), [bounds, filteredTx, s.wallets, s.transactions, user, outletFilter, selectedWalletId, preset]);

  // Navigasi prev/next (Mingguan/Bulanan)
  function navigate(dir) {
    if (preset === "Mingguan") setAnchorDate(shiftAnchor("Mingguan", anchorDate, dir));
    if (preset === "Bulanan") setAnchorDate(shiftAnchor("Bulanan", anchorDate, dir));
  }

  // Export handlers
  async function handleExport(type) {
    setExporting(type);
    try {
      if (type === "csv") exportCsv(filteredTx, s.categories, s.wallets, bounds, preset);
      if (type === "pdf") await exportPdf(filteredTx, s.categories, s.wallets, bounds, preset);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.sheet}>

        {/* Header */}
        <div style={styles.header}>
          <button style={styles.iconBtn} onClick={onClose} aria-label="Tutup">
            <i className="ti ti-arrow-left" aria-hidden="true" />
          </button>
          <span style={styles.headerTitle}>Laporan purchasing</span>
          <div style={{ width: 32 }} />
        </div>

        <div style={styles.body}>

          {/* Preset periode */}
          <div style={styles.presetRow}>
            {PRESETS.map(p => (
              <button
                key={p}
                style={{ ...styles.presetBtn, ...(preset === p ? styles.presetBtnActive : {}) }}
                onClick={() => setPreset(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Navigasi minggu/bulan */}
          {(preset === "Mingguan" || preset === "Bulanan") && (
            <div style={styles.navRow}>
              <button style={styles.navBtn} onClick={() => navigate(-1)}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1, textAlign: "center" }}>
                {formatPeriodLabel(preset === "Mingguan" ? "Mingguan" : "Bulanan", bounds)}
              </span>
              <button style={styles.navBtn} onClick={() => navigate(1)}>›</button>
            </div>
          )}

          {/* Custom range */}
          {preset === "Custom" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <input
                style={{ ...styles.inp, flex: 1 }}
                type="date" value={customStart}
                onChange={e => setCustomStart(e.target.value)}
              />
              <span style={{ fontSize: 12, color: "#888" }}>s/d</span>
              <input
                style={{ ...styles.inp, flex: 1 }}
                type="date" value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
              />
            </div>
          )}

          {/* Label periode aktif */}
          <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
            {preset === "1 hari" && `Hari ini, ${bounds.start}`}
            {preset === "Kemarin"  && `Kemarin, ${bounds.start}`}
            {preset === "Custom"   && `${customStart} — ${customEnd}`}
          </div>

          {/* Bagikan WA */}
          <div style={{ ...styles.exportBar, marginBottom: 14, background: "#ECFDF5", border: "1px solid #A7F3D0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#047857", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Kirim ringkasan WhatsApp
            </div>
            <div style={{ fontSize: 12, color: "#065F46", marginBottom: 10, lineHeight: 1.45 }}>
              Daftar barang + jumlah belanja{preset === "1 hari" ? " hari ini" : ""} dan sisa kas kecil.
            </div>
            <button
              type="button"
              onClick={() => openWhatsAppShare(waText)}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                border: "none",
                background: "#25D366",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Bagikan ke WhatsApp
            </button>
          </div>

          {/* Filter outlet */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {[{ code: "Semua", label: "Semua" }, ...PURCHASING_OUTLETS].map(o => (
              <button
                key={o.code}
                style={{ ...styles.outletBtn, ...(outletFilter === o.code ? styles.outletBtnActive : {}) }}
                onClick={() => setOutletFilter(o.code)}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Filter dompet & user input */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            <select style={styles.inp} value={walletFilter} onChange={(e) => setWalletFilter(e.target.value)}>
              {walletOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select style={styles.inp} value={creatorFilter} onChange={(e) => setCreatorFilter(e.target.value)}>
              {creatorOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              ["all", "Semua status verifikasi"],
              ["unverified", "Belum diverifikasi"],
              ["verified", "Terverifikasi"],
            ].map(([id, label]) => (
              <button
                key={id}
                style={{ ...styles.outletBtn, ...(verifiedFilter === id ? styles.outletBtnActive : {}) }}
                onClick={() => setVerifiedFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Summary cards */}
          <div style={styles.summaryGrid}>
            <SummaryCard
              label="Total pengeluaran"
              value={fmtMoney(totalAmount)}
              sub={`${totalCount} transaksi`}
              color="#E24B4A"
            />
            {selectedWalletId && !shouldHideWalletBalance((s.wallets || []).find((w) => w.id === selectedWalletId), user) && openingBalance != null && transferIn != null && refundIn != null && closingBalance != null && (
              <SummaryCard
                label="Ringkasan dompet terpilih"
                value={`Akhir ${fmtMoney(closingBalance)}`}
                sub={`Awal ${fmtMoney(openingBalance)} · Dana masuk ${fmtMoney(transferIn)} · Refund ${fmtMoney(refundIn)}`}
                color="#1D9E75"
              />
            )}
            <SummaryCard
              label="Rata-rata per transaksi"
              value={fmtMoney(avgPerTx)}
              color="#BA7517"
            />
            <SummaryCard
              label="Belum diverifikasi"
              value={`${unverifiedCount} transaksi`}
              sub={`Tanpa bukti: ${noReceiptCount}`}
              color="#9333EA"
            />
          </div>

          {/* Export */}
          <div style={styles.exportBar}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Export laporan
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button
                type="button"
                style={{ ...styles.exportBtn, ...styles.exportBtnCsv, ...(filteredTx.length === 0 || exporting ? styles.exportBtnDisabled : {}) }}
                onClick={() => handleExport("csv")}
                disabled={!!exporting || filteredTx.length === 0}
              >
                {exporting === "csv" ? "Mengekspor…" : "Excel (CSV)"}
              </button>
              <button
                type="button"
                style={{ ...styles.exportBtn, ...styles.exportBtnPdf, ...(filteredTx.length === 0 || exporting ? styles.exportBtnDisabled : {}) }}
                onClick={() => handleExport("pdf")}
                disabled={!!exporting || filteredTx.length === 0}
              >
                {exporting === "pdf" ? "Mengekspor…" : "PDF"}
              </button>
            </div>
            {filteredTx.length === 0 ? (
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 6, textAlign: "center" }}>
                Belum ada transaksi di periode ini
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 6, textAlign: "center" }}>
                {filteredTx.length} transaksi · {bounds.start} s/d {bounds.end}
              </div>
            )}
          </div>

          {/* Per outlet */}
          {byOutlet.length > 1 && (
            <div style={{ ...styles.card, marginBottom: 14 }}>
              <div style={styles.sectionTitle}>Per outlet</div>
              {byOutlet.map(o => {
                const pct = totalAmount > 0 ? Math.round((o.total / totalAmount) * 100) : 0;
                return (
                  <div key={o.code} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontSize: 12 }}>{o.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{fmtMoney(o.total)} <span style={{ color: "#aaa", fontWeight: 400 }}>({pct}%)</span></span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: "#f0f0f0" }}>
                      <div style={{ height: 4, borderRadius: 2, background: "#378ADD", width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Daftar transaksi */}
          <div style={styles.sectionTitle}>
            {filteredTx.length > 0
              ? `${filteredTx.length} transaksi`
              : "Tidak ada transaksi"}
          </div>

          {filteredTx.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#bbb" }}>
              <i className="ti ti-receipt-off" style={{ fontSize: 32, display: "block", marginBottom: 8 }} aria-hidden="true" />
              <div style={{ fontSize: 13 }}>Belum ada pengeluaran di periode ini</div>
            </div>
          )}

          {filteredTx.slice(0, 50).map(tx => (
            <TxRow key={tx.id} tx={tx} catMap={catMap} walletMap={walletMap} />
          ))}

          {filteredTx.length > 50 && (
            <div style={{ fontSize: 12, color: "#aaa", textAlign: "center", padding: "12px 0" }}>
              +{filteredTx.length - 50} transaksi lainnya — export CSV/PDF untuk lihat semua
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// STYLES
// ------------------------------------------------------------
const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 999,
  },
  sheet: {
    background: "#fff", borderRadius: "16px 16px 0 0",
    width: "100%", maxWidth: 480, maxHeight: "92vh",
    display: "flex", flexDirection: "column",
  },
  header: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "14px 16px", borderBottom: "0.5px solid #f0f0f0", flexShrink: 0,
  },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: 500 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8,
    border: "0.5px solid #e0e0e0", background: "#f9f9f9",
    fontSize: 16, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  body: { overflowY: "auto", padding: "14px 16px 32px", flex: 1 },
  presetRow: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  presetBtn: {
    padding: "6px 12px", borderRadius: 20,
    border: "0.5px solid #e0e0e0", background: "#f9f9f9",
    fontSize: 12, color: "#888", cursor: "pointer",
  },
  presetBtnActive: {
    background: "#E6F1FB", borderColor: "#378ADD", color: "#0C447C", fontWeight: 500,
  },
  navRow: {
    display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
  },
  navBtn: {
    width: 32, height: 32, borderRadius: 8,
    border: "0.5px solid #e0e0e0", background: "#f9f9f9",
    fontSize: 18, cursor: "pointer", color: "#555",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  inp: {
    padding: "7px 10px", borderRadius: 8,
    border: "0.5px solid #e0e0e0", background: "#f9f9f9",
    fontSize: 12, color: "#1a1a1a", fontFamily: "inherit",
    outline: "none", boxSizing: "border-box",
  },
  outletBtn: {
    padding: "4px 10px", borderRadius: 20,
    border: "0.5px solid #e0e0e0", background: "#f9f9f9",
    fontSize: 11, color: "#888", cursor: "pointer",
  },
  outletBtnActive: {
    background: "#FAEEDA", borderColor: "#BA7517", color: "#633806", fontWeight: 500,
  },
  summaryGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr",
    gap: 10, marginBottom: 14,
  },
  summaryCard: {
    background: "#f9f9f9", borderRadius: 10,
    padding: "12px 14px", border: "0.5px solid #eee",
  },
  exportBar: {
    background: "#f9f9f9", borderRadius: 12,
    border: "0.5px solid #eee", padding: "12px 14px",
    marginBottom: 14,
  },
  exportBtn: {
    padding: "11px 12px", borderRadius: 10, border: "none",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit",
  },
  exportBtnCsv: {
    background: "#DCFCE7", color: "#15803D",
  },
  exportBtnPdf: {
    background: "#FEE2E2", color: "#B91C1C",
  },
  exportBtnDisabled: {
    opacity: 0.45, cursor: "not-allowed",
  },
  card: {
    background: "#fff", borderRadius: 12,
    border: "0.5px solid #eee", padding: 14,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: 500, color: "#aaa",
    marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em",
  },
  txRow: {
    padding: "10px 0", borderBottom: "0.5px solid #f5f5f5",
    cursor: "default",
  },
  badge: {
    display: "inline-block", padding: "1px 7px", borderRadius: 20,
    fontSize: 10, fontWeight: 500,
    background: "#E6F1FB", color: "#0C447C", border: "0.5px solid #85B7EB",
  },
  itemDetail: {
    marginTop: 8, padding: "8px 10px",
    background: "#f9f9f9", borderRadius: 8,
  },
};
