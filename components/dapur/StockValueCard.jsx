"use client";
// Kartu Nilai Stok: berapa uang yang "tertahan" jadi barang di tiap lokasi (dari SO terakhir × modal),
// naik/turun dibanding kemarin & 7 hari lalu, plus total Saldo + Stok untuk owner.

import { useEffect, useMemo, useState } from "react";
import { LOKASI, LOKASI_LABEL, summarizeValueSeries, fmtRp } from "../../lib/inventoryLogic";
import { loadStockValueSeries, loadStockSnapshot } from "../../lib/inventoryRepo";
import { C, card } from "./ui";

const BAR = "#185FA5";      // satu hue (brand) untuk magnitudo
const BAR_LAST = "#0C3F70"; // hari ini sedikit lebih gelap

function Delta({ v, label }) {
  if (v === null || v === undefined) return <span style={{ color: C.sub }}>{label}: –</span>;
  if (v === 0) return <span style={{ color: C.sub }}>{label}: tetap</span>;
  const up = v > 0;
  return (
    <span style={{ color: up ? C.ok : C.bad, fontWeight: 700 }}>
      {up ? "▲" : "▼"} {label} {up ? "+" : "−"}{fmtRp(Math.abs(v)).replace("Rp", "Rp ")}
    </span>
  );
}

/** Sparkline batang harian. Hari tanpa SO digambar sebagai titik kecil abu-abu (bukan 0). */
function Spark({ values, dates, width = 112, height = 28 }) {
  const n = values.length;
  if (!n) return null;
  const max = Math.max(...values.filter((v) => v !== null), 1);
  const gap = 2;
  const w = Math.max(2, (width - gap * (n - 1)) / n);
  return (
    <svg width={width} height={height} role="img" aria-label="Nilai stok per hari" style={{ display: "block" }}>
      {values.map((v, i) => {
        const x = i * (w + gap);
        const tip = `${dates[i]}: ${v === null ? "belum ada SO" : fmtRp(v)}`;
        if (v === null) {
          return <circle key={i} cx={x + w / 2} cy={height - 2} r={1.5} fill={C.line}><title>{tip}</title></circle>;
        }
        const h = Math.max(2, (v / max) * (height - 2));
        return (
          <g key={i}>
            <rect x={x} y={0} width={w} height={height} fill="transparent"><title>{tip}</title></rect>
            <rect x={x} y={height - h} width={w} height={h} rx={Math.min(2, w / 2)} fill={i === n - 1 ? BAR_LAST : BAR}><title>{tip}</title></rect>
          </g>
        );
      })}
    </svg>
  );
}

export default function StockValueCard({ bizId, lokasiScope = LOKASI, saldo = null, hide = false, onOpen, days = 14 }) {
  const [rows, setRows] = useState(null);
  const [zero, setZero] = useState(0);
  const [err, setErr] = useState("");

  const scopeKey = lokasiScope.join(",");
  useEffect(() => {
    const scope = scopeKey.split(",");
    let alive = true;
    Promise.all([loadStockValueSeries(bizId, days), loadStockSnapshot(bizId).catch(() => [])])
      .then(([series, snap]) => {
        if (!alive) return;
        setRows(series);
        setZero(snap.filter((r) => scope.includes(r.lokasi) && Number(r.qty) > 0 && !(Number(r.nilai) > 0)).length);
      })
      .catch((e) => alive && setErr(e.message || String(e)));
    return () => { alive = false; };
  }, [bizId, days, scopeKey]);

  const sum = useMemo(() => summarizeValueSeries(rows || [], scopeKey.split(",")), [rows, scopeKey]);

  if (err) return <div style={{ ...card, fontSize: 13, color: C.sub }}>Nilai stok belum bisa dimuat: {err}</div>;
  if (!rows) return <div style={{ ...card, fontSize: 13, color: C.sub }}>Memuat nilai stok…</div>;
  return <StockValueView sum={sum} lokasiScope={scopeKey.split(",")} saldo={saldo} hide={hide} zero={zero} onOpen={onOpen} />;
}

/** Tampilan murni (tanpa data fetch) — dipakai kartu di atas. */
export function StockValueView({ sum, lokasiScope, saldo = null, hide = false, zero = 0, onOpen }) {
  const money = (v) => (hide ? "••••" : v === null || v === undefined ? "–" : fmtRp(v));
  const hasData = sum.last !== null;
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: C.sub }}>NILAI STOK</span>
        {onOpen && <button type="button" onClick={onOpen} style={{ border: "none", background: "none", color: C.brand, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Detail ›</button>}
      </div>
      {!hasData ? (
        <div style={{ fontSize: 13, color: C.sub }}>Belum ada SO. Nilai stok muncul setelah gudang/outlet mengirim SO pertama.</div>
      ) : (
        <>
          <div>
            <div className="money" style={{ fontSize: 28, fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>{money(sum.last)}</div>
            <div style={{ fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
              {!hide && <Delta v={sum.d1} label="kemarin" />}
              {!hide && <Delta v={sum.d7} label="7 hari" />}
            </div>
          </div>
          {saldo !== null && (
            <div style={{ background: C.bg, borderRadius: 10, padding: "8px 10px", fontSize: 13, display: "grid", gap: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.sub }}>Uang (saldo)</span><span>{money(saldo)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.sub }}>Stok (barang)</span><span>{money(sum.last)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}><span>Uang + Stok</span><span>{money(round(saldo + sum.last))}</span></div>
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {lokasiScope.map((l) => {
              const p = sum.perLokasi[l] || {};
              return (
                <div key={l} style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                      <span style={{ fontWeight: 700 }}>{LOKASI_LABEL[l] || l}</span>
                      {p.last === null || p.last === undefined
                        ? <span style={{ fontWeight: 700, color: C.sub }}>Belum dihitung</span>
                        : <span style={{ fontWeight: 700 }}>{money(p.last)}</span>}
                    </div>
                    <div style={{ fontSize: 11, textAlign: "right" }}>{hide ? "" : <Delta v={p.d7} label="7 hari" />}</div>
                  </div>
                  <Spark values={sum.byLokasi[l] || []} dates={sum.dates} />
                </div>
              );
            })}
          </div>
        </>
      )}
      {zero > 0 && (
        <div style={{ fontSize: 12, color: C.warn }}>
          ⚠️ {zero} barang terhitung Rp0 (modal atau konversi satuan belum diisi) — nilai sebenarnya lebih besar.
        </div>
      )}
      <div style={{ fontSize: 11, color: C.sub }}>Dari SO terakhir tiap barang × modal saat ini. Hari tanpa SO = titik abu-abu.</div>
    </div>
  );
}

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
