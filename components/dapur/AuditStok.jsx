"use client";
// Audit stok harian (Tahap A): buku pergerakan per barang + temuan kejanggalan.
// Mode "Pemantauan harian" — belum memakai data penjualan. SO staf tidak pernah diubah;
// selisih antara stok seharusnya dan SO disimpan sebagai data audit.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LOKASI, LOKASI_LABEL, PRIORITY, PRIORITY_LABEL, auditMovements, todayJakarta, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import { loadStockMovements } from "../../lib/inventoryRepo";
import { C, card, Chips, Notice } from "./ui";

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Muat pergerakan 21 hari, audit 7 hari terakhir (riwayat sebelumnya dipakai sebagai pola normal). */
export function useStockAudit(bizId, items, { days = 7 } = {}) {
  const [state, setState] = useState({ loading: true, err: "", findings: [], ledger: [] });
  const itemsById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  const load = useCallback(async () => {
    if (!bizId) return;
    const today = todayJakarta();
    try {
      const mv = await loadStockMovements(bizId, addDays(today, -20), today);
      const { findings, ledger } = auditMovements(mv, itemsById, { from: addDays(today, -(days - 1)) });
      setState({ loading: false, err: "", findings, ledger });
    } catch (e) {
      setState({ loading: false, err: e.message || String(e), findings: [], ledger: [] });
    }
  }, [bizId, itemsById, days]);
  useEffect(() => { load(); }, [load]);
  return state;
}

export const PRIORITY_COLOR = {
  CRITICAL: [C.badSoft, C.bad],
  WARNING: [C.warnSoft, C.warn],
  WATCH: [C.brandSoft, C.brand],
  INFO: [C.bg, C.sub],
};

export function PriorityPill({ p }) {
  const [bg, fg] = PRIORITY_COLOR[p] || PRIORITY_COLOR.INFO;
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999 }}>{PRIORITY_LABEL[p] || p}</span>;
}

export function FindingRow({ f, itemsById, showLokasi = true }) {
  const item = itemsById[f.item_id];
  return (
    <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.line}`, display: "grid", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <PriorityPill p={f.priority} />
        <span style={{ fontWeight: 800, fontSize: 14 }}>{item?.nama || "?"}</span>
        {showLokasi && <span style={{ fontSize: 12, color: C.sub }}>· {LOKASI_LABEL[f.lokasi] || f.lokasi}</span>}
        <span style={{ fontSize: 12, color: C.sub }}>· {f.tanggal}</span>
      </div>
      <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.45 }}>{f.message}</div>
      <div style={{ fontSize: 11, color: C.sub }}>
        Keyakinan {f.confidence === "HIGH" ? "tinggi" : f.confidence === "MEDIUM" ? "sedang" : "rendah"} · {f.status}{f.rp ? ` · ${fmtRp(Math.abs(f.rp))}` : ""}
      </div>
    </div>
  );
}

export default function AuditStok({ bizId, items }) {
  const audit = useStockAudit(bizId, items);
  const itemsById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  const [lok, setLok] = useState("Semua");
  const [pri, setPri] = useState("Semua");
  const [openItem, setOpenItem] = useState(null);

  const list = useMemo(() => audit.findings
    .filter((f) => lok === "Semua" || f.lokasi === lok)
    .filter((f) => pri === "Semua" || f.priority === pri), [audit.findings, lok, pri]);
  const counts = useMemo(() => Object.fromEntries(PRIORITY.map((p) => [p, audit.findings.filter((f) => (lok === "Semua" || f.lokasi === lok) && f.priority === p).length])), [audit.findings, lok]);

  if (audit.loading) return <div style={{ padding: 30, textAlign: "center", color: C.sub }}>Menghitung audit…</div>;
  if (audit.err) return <Notice kind="bad">Audit belum bisa dimuat: {audit.err}</Notice>;

  const ledgerFor = (f) => audit.ledger.filter((l) => l.item_id === f.item_id && l.lokasi === f.lokasi).slice(-7);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Notice>
        <b>Mode pemantauan harian</b> — dihitung dari SO, waste, barang masuk, produksi, dan kiriman 7 hari terakhir. Data penjualan belum dipakai, jadi temuan "berkurang" berstatus <i>menunggu data penjualan</i>. Angka SO staf tidak diubah.
      </Notice>

      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {["Semua", ...LOKASI].map((l) => (
            <button key={l} type="button" onClick={() => setLok(l)}
              style={{ flex: "0 0 auto", padding: "7px 12px", borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: "pointer",
                border: `1px solid ${l === lok ? C.brand : C.line}`, background: l === lok ? C.brand : "#fff", color: l === lok ? "#fff" : C.ink }}>
              {l === "Semua" ? "Semua lokasi" : l}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[...PRIORITY].reverse().map((p) => {
            const [bg, fg] = PRIORITY_COLOR[p];
            const active = pri === p;
            return (
              <button key={p} type="button" onClick={() => setPri(active ? "Semua" : p)}
                style={{ border: `2px solid ${active ? fg : "transparent"}`, background: bg, borderRadius: 12, padding: "8px 4px", cursor: "pointer" }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: fg }}>{counts[p]}</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: fg }}>{PRIORITY_LABEL[p]}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ ...card, padding: 0 }}>
        <div style={{ padding: "12px 14px 6px", fontWeight: 800 }}>Perlu diperiksa ({list.length})</div>
        {list.map((f, i) => (
          <div key={`${f.type}-${f.lokasi}-${f.item_id}-${f.tanggal}-${i}`}>
            <button type="button" onClick={() => setOpenItem(openItem === i ? null : i)}
              style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: 0, cursor: "pointer" }}>
              <FindingRow f={f} itemsById={itemsById} showLokasi={lok === "Semua"} />
            </button>
            {openItem === i && (
              <div style={{ padding: "0 14px 12px", fontSize: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto repeat(5, 1fr)", gap: "4px 8px", color: C.sub, fontWeight: 700 }}>
                  <span>Tgl</span><span>SO lalu</span><span>+Masuk</span><span>−Keluar</span><span>Seharusnya</span><span>SO</span>
                </div>
                {ledgerFor(f).map((l) => (
                  <div key={`${l.tanggal}-${l.cur}-${l.expected}`} style={{ display: "grid", gridTemplateColumns: "auto repeat(5, 1fr)", gap: "4px 8px", padding: "3px 0" }}>
                    <span>{l.tanggal.slice(5)}</span><span>{fmtQty(l.prev)}</span><span>{fmtQty(l.masuk)}</span><span>{fmtQty(l.keluar)}</span>
                    <span>{fmtQty(l.expected)}</span>
                    <span style={{ fontWeight: 800, color: l.variance > 0 ? C.warn : C.ink }}>{fmtQty(l.cur)}</span>
                  </div>
                ))}
                <div style={{ color: C.sub, marginTop: 6 }}>Satuan: {itemsById[f.item_id]?.satuan}. "Keluar" = waste + dipakai produksi + dikirim.</div>
              </div>
            )}
          </div>
        ))}
        {!list.length && <div style={{ padding: "4px 14px 14px", fontSize: 13, color: C.sub }}>Tidak ada temuan. SO minimal 2 kali per barang supaya bisa dibandingkan.</div>}
      </div>
    </div>
  );
}
