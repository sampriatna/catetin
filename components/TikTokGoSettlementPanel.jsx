"use client";

import { useMemo, useState } from "react";
import { canDo } from "../lib/rbac.js";
import {
  TIKTOK_GO_DESTINATION_WALLET_ID,
  TIKTOK_GO_FEE_TYPES,
  applyTikTokGoSettlementMutation,
  buildTikTokGoSettlementMutation,
  computeTikTokGoSummary,
} from "../lib/tiktokGoSettlement.js";

function todayWib() {
  try {
    return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function money(value, currency = "IDR") {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function shortDate(value) {
  if (!value) return "—";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

const emptyFees = () => Object.fromEntries(TIKTOK_GO_FEE_TYPES.map(({ id }) => [id, ""]));

function SummaryBox({ label, value, tone = "normal", note }) {
  const color = tone === "in" ? "var(--in-text)" : tone === "out" ? "var(--out-text)" : "var(--ink)";
  return (
    <div style={{ padding: 10, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
      <div style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div className="money" style={{ fontSize: 13, color, fontWeight: 800 }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: "var(--ink3)", marginTop: 3 }}>{note}</div>}
    </div>
  );
}

export default function TikTokGoSettlementPanel({ s, user, mutate, onCriticalSave }) {
  const currency = s?.profile?.currency || "IDR";
  const summary = useMemo(() => computeTikTokGoSummary({
    transactions: s?.transactions || [],
    wallets: s?.wallets || [],
  }), [s?.transactions, s?.wallets]);
  const [selectedId, setSelectedId] = useState(null);
  const [actualDate, setActualDate] = useState(todayWib());
  const [destinationWalletId, setDestinationWalletId] = useState(TIKTOK_GO_DESTINATION_WALLET_ID);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [fees, setFees] = useState(emptyFees);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const banks = useMemo(() => {
    const rows = (s?.wallets || []).filter(
      (wallet) => wallet.active !== false && wallet.type === "rekening"
    );
    if (!rows.some((wallet) => wallet.id === TIKTOK_GO_DESTINATION_WALLET_ID)) {
      rows.unshift({ id: TIKTOK_GO_DESTINATION_WALLET_ID, name: "Rudi Mandiri" });
    }
    return rows;
  }, [s?.wallets]);
  const selected = summary.rows.find((row) => row.id === selectedId) || null;
  const feeTotal = TIKTOK_GO_FEE_TYPES.reduce(
    (sum, { id }) => sum + Math.max(0, Number(fees[id]) || 0),
    0
  );
  const netAmount = Math.max(0, (selected?.grossAmount || 0) - feeTotal);
  const canSettle = canDo(user?.role, "settleTikTokGo");

  const openForm = (row) => {
    setSelectedId(row.id);
    setActualDate(todayWib());
    setDestinationWalletId(row.destinationWalletId || TIKTOK_GO_DESTINATION_WALLET_ID);
    setEvidenceRef("");
    setFees(emptyFees());
    setError("");
    setMessage("");
  };

  const confirmSettlement = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const mutation = buildTikTokGoSettlementMutation({
        transactions: s?.transactions || [],
        saleTransactionId: selected.id,
        actualSettlementDate: actualDate,
        destinationWalletId,
        evidenceRef,
        fees,
        user,
        today: todayWib(),
      });
      mutate((doc) => applyTikTokGoSettlementMutation(doc, mutation));
      if (typeof onCriticalSave === "function") await onCriticalSave();
      setSelectedId(null);
      setMessage(`Settlement ${money(netAmount, currency)} tercatat sebagai transfer, bukan omzet baru.`);
    } catch (cause) {
      setError(cause?.message || "Settlement TikTok Go gagal disimpan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--surface2)", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>Settlement TikTok Go</div>
          <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--ink3)", marginTop: 3 }}>
            Penjualan diakui saat transaksi. Dana tetap pending sampai bukti masuk bank dikonfirmasi.
          </div>
        </div>
        {summary.pendingCount > 0 && (
          <span style={{ whiteSpace: "nowrap", fontSize: 10, fontWeight: 800, padding: "4px 8px", borderRadius: 99, background: "#FEF3C7", color: "#92400E" }}>
            {summary.pendingCount} pending
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 7 }}>
        <SummaryBox label="Penjualan TikTok Go" value={money(summary.totalSales, currency)} tone="in" />
        <SummaryBox label="Saldo tertahan" value={money(summary.heldBalance, currency)} note="Saldo Dompet TikTok Go" />
        <SummaryBox label="Sudah masuk bank" value={money(summary.totalSettled, currency)} tone="in" />
        <SummaryBox label="Settlement pending" value={money(summary.pendingSettlement, currency)} note="Sebelum potongan yang belum dicatat" />
        <SummaryBox label="Potongan / fee" value={money(summary.totalFees, currency)} tone="out" />
      </div>

      {message && <div style={{ marginTop: 10, padding: 9, borderRadius: 10, background: "var(--in-soft)", color: "var(--in-text)", fontSize: 11, fontWeight: 700 }}>{message}</div>}
      {error && <div role="alert" style={{ marginTop: 10, padding: 9, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 11, fontWeight: 700 }}>{error}</div>}

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {summary.rows.map((row) => (
          <div key={row.id} style={{ padding: 11, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ color: "var(--ink)", fontSize: 13, fontWeight: 800 }}>{money(row.grossAmount, currency)}</div>
                <div style={{ color: "var(--ink3)", fontSize: 10, marginTop: 2 }}>{row.sale.meta?.outlet || "TikTok Go"}</div>
              </div>
              <span style={{ alignSelf: "flex-start", fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 99, background: row.status === "settled" ? "var(--in-soft)" : "#FEF3C7", color: row.status === "settled" ? "var(--in-text)" : "#92400E" }}>
                {row.status === "settled" ? "SETTLED" : "PENDING SETTLEMENT"}
              </span>
            </div>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 10px", fontSize: 10, color: "var(--ink3)" }}>
              <div>Transaksi<br /><b style={{ color: "var(--ink2)" }}>{shortDate(row.transactionDate)}</b></div>
              <div>Estimasi cair<br /><b style={{ color: "var(--ink2)" }}>{shortDate(row.estimatedSettlementDate)}</b></div>
              <div>Settlement aktual<br /><b style={{ color: "var(--ink2)" }}>{shortDate(row.actualSettlementDate)}</b></div>
              <div>Rekening tujuan<br /><b style={{ color: "var(--ink2)" }}>{row.destinationLabel}</b></div>
              <div>Potongan<br /><b style={{ color: "var(--out-text)" }}>{money(row.feeTotal, currency)}</b></div>
              <div>Nilai bersih<br /><b style={{ color: "var(--ink2)" }}>{money(row.netSettlementAmount, currency)}</b></div>
            </div>
            {row.status === "pending" && canSettle && selectedId !== row.id && (
              <button type="button" onClick={() => openForm(row)} style={{ width: "100%", marginTop: 9, padding: 9, border: 0, borderRadius: 10, cursor: "pointer", background: "var(--brand)", color: "#fff", fontSize: 11, fontWeight: 800 }}>
                Konfirmasi dana masuk
              </button>
            )}
          </div>
        ))}
        {summary.rows.length === 0 && (
          <div style={{ color: "var(--ink3)", textAlign: "center", fontSize: 11, padding: 12 }}>
            Belum ada penjualan TikTok Go.
          </div>
        )}
      </div>

      {selected && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid var(--brand)", background: "var(--surface)" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink)", marginBottom: 9 }}>Konfirmasi settlement aktual</div>
          <label style={{ display: "block", color: "var(--ink3)", fontSize: 10, fontWeight: 700, marginBottom: 8 }}>
            Tanggal dana masuk
            <input type="date" value={actualDate} max={todayWib()} onChange={(event) => setActualDate(event.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: 9, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }} />
          </label>
          <label style={{ display: "block", color: "var(--ink3)", fontSize: 10, fontWeight: 700, marginBottom: 8 }}>
            Rekening tujuan
            <select value={destinationWalletId} onChange={(event) => setDestinationWalletId(event.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: 9, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}>
              {banks.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.id === TIKTOK_GO_DESTINATION_WALLET_ID ? "Rudi Mandiri" : wallet.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ color: "var(--ink3)", fontSize: 10, fontWeight: 700, marginBottom: 5 }}>Potongan TikTok Go</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {TIKTOK_GO_FEE_TYPES.map(({ id, label }) => (
              <label key={id} style={{ color: "var(--ink3)", fontSize: 9, fontWeight: 700 }}>
                {label}
                <input type="number" min="0" inputMode="numeric" value={fees[id]} onChange={(event) => setFees((previous) => ({ ...previous, [id]: event.target.value }))} placeholder="0" style={{ display: "block", width: "100%", marginTop: 3, padding: 8, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }} />
              </label>
            ))}
          </div>
          <label style={{ display: "block", color: "var(--ink3)", fontSize: 10, fontWeight: 700, marginTop: 9 }}>
            Bukti / nomor mutasi bank
            <input value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="Wajib diisi, contoh: mutasi 8 Sep 2026" style={{ display: "block", width: "100%", marginTop: 4, padding: 9, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }} />
          </label>
          <div style={{ marginTop: 10, padding: 9, borderRadius: 9, background: "var(--surface2)", fontSize: 11, color: "var(--ink2)" }}>
            Bruto {money(selected.grossAmount, currency)} − potongan {money(feeTotal, currency)} = <b>{money(netAmount, currency)}</b> masuk bank.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 9 }}>
            <button type="button" disabled={busy} onClick={() => setSelectedId(null)} style={{ padding: 9, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink2)", fontWeight: 700, cursor: "pointer" }}>Batal</button>
            <button type="button" disabled={busy} onClick={confirmSettlement} style={{ padding: 9, borderRadius: 9, border: 0, background: busy ? "var(--ink3)" : "var(--brand)", color: "#fff", fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>{busy ? "Menyimpan…" : "Catat transfer"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
