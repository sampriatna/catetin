"use client";
// Audit stok harian (Tahap A): buku pergerakan per barang + temuan kejanggalan.
// Mode "Pemantauan harian" — belum memakai data penjualan. SO staf tidak pernah diubah;
// selisih antara stok seharusnya dan SO disimpan sebagai data audit.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LOKASI, LOKASI_LABEL, OUTLET_JUAL, PRIORITY, PRIORITY_LABEL, auditMovements, daysBetween, salesUsageReport, usageMessage, todayJakarta, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import { loadStockMovements, loadSalesUploads } from "../../lib/inventoryRepo";
import { C, card, dateInput, label, Chips, Notice } from "./ui";

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Hari-hari per outlet yang punya rekap penjualan harian ("KBU|2026-09-01"). */
export function salesDaysFrom(uploads) {
  const set = new Set();
  for (const u of uploads || []) {
    if (!u.per_hari) continue;
    const days = [u.dari, ...daysBetween(u.dari, u.sampai)];
    for (const l of u.lokasi || []) for (const d of days) set.add(`${l}|${d}`);
  }
  return set;
}

/** Muat pergerakan 21 hari, audit 7 hari terakhir (riwayat sebelumnya dipakai sebagai pola normal). */
export function useStockAudit(bizId, items, { days = 7 } = {}) {
  const [state, setState] = useState({ loading: true, err: "", findings: [], ledger: [], uploads: [] });
  const itemsById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  const load = useCallback(async () => {
    if (!bizId) return;
    const today = todayJakarta();
    try {
      const [mv, uploads] = await Promise.all([
        loadStockMovements(bizId, addDays(today, -20), today),
        loadSalesUploads(bizId).catch(() => []),
      ]);
      const { findings, ledger } = auditMovements(mv, itemsById, { from: addDays(today, -(days - 1)), salesDays: salesDaysFrom(uploads) });
      setState({ loading: false, err: "", findings, ledger, uploads });
    } catch (e) {
      setState({ loading: false, err: e.message || String(e), findings: [], ledger: [], uploads: [] });
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
        <b>Audit harian</b> — dihitung dari SO, waste, barang masuk, produksi, kiriman{audit.uploads.some((u) => u.per_hari) ? ", dan penjualan harian" : ""} 7 hari terakhir.
        {audit.uploads.some((u) => u.per_hari) ? " Hari tanpa rekap penjualan harian" : " Belum ada rekap penjualan harian, jadi temuan"} "berkurang" berstatus <i>menunggu data penjualan</i>. Angka SO staf tidak diubah.
      </Notice>

      <UsageReport bizId={bizId} itemsById={itemsById} uploads={audit.uploads} />

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
                    <span>{l.tanggal.slice(5)}</span><span>{fmtQty(l.prev)}</span><span>{fmtQty(l.masuk)}</span><span>{fmtQty(l.keluar + (l.jual || 0))}</span>
                    <span>{fmtQty(l.expected)}</span>
                    <span style={{ fontWeight: 800, color: l.variance > 0 ? C.warn : C.ink }}>{fmtQty(l.cur)}</span>
                  </div>
                ))}
                <div style={{ color: C.sub, marginTop: 6 }}>Satuan: {itemsById[f.item_id]?.satuan}. "Keluar" = waste + dipakai produksi + dikirim + terjual (penjualan harian × resep).</div>
              </div>
            )}
          </div>
        ))}
        {!list.length && <div style={{ padding: "4px 14px 14px", fontSize: 13, color: C.sub }}>Tidak ada temuan. SO minimal 2 kali per barang supaya bisa dibandingkan.</div>}
      </div>
    </div>
  );
}

/** Penjualan vs pemakaian: teori (terjual × resep menu) dibanding aktual (SO) per bahan per outlet. */
function UsageReport({ bizId, itemsById, uploads }) {
  const today = todayJakarta();
  const periods = useMemo(() => {
    const seen = new Set();
    const out = [{ id: "7", label: "7 hari terakhir", from: addDays(today, -6), to: today }];
    for (const u of uploads || []) {
      const k = `${u.dari}|${u.sampai}`;
      if (seen.has(k) || u.dari === u.sampai) continue;
      seen.add(k);
      out.push({ id: k, label: `${u.dari.slice(5)} s/d ${u.sampai.slice(5)}`, from: u.dari, to: u.sampai });
    }
    return out.slice(0, 6);
  }, [uploads, today]);
  const [pid, setPid] = useState(null);
  const [custom, setCustom] = useState(null);
  const [lok, setLok] = useState("Semua");
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { if (!pid && periods.length) setPid(periods[1]?.id || periods[0].id); }, [periods, pid]);
  const period = custom || periods.find((p) => p.id === pid) || periods[0];

  useEffect(() => {
    if (!open || !period) return;
    let alive = true;
    setRows(null); setErr("");
    loadStockMovements(bizId, addDays(period.from, -21), period.to)
      .then((mv) => alive && setRows(salesUsageReport(mv, itemsById, { from: period.from, to: period.to })))
      .catch((e) => alive && setErr(e.message || String(e)));
    return () => { alive = false; };
  }, [bizId, itemsById, period?.from, period?.to, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (rows || []).filter((r) => lok === "Semua" || r.lokasi === lok);
  const important = list.filter((r) => r.priority !== "INFO");
  const shown = showAll ? list : important;
  const totalLebih = list.filter((r) => r.selisih > 0).reduce((s, r) => s + r.rp, 0);
  const hasSales = (uploads || []).length > 0;

  return (
    <div style={{ ...card, padding: 0 }}>
      <button type="button" onClick={() => setOpen(!open)}
        style={{ display: "flex", justifyContent: "space-between", width: "100%", border: "none", background: "#fff", padding: "12px 14px", cursor: "pointer", borderRadius: 14 }}>
        <span style={{ fontWeight: 800 }}>Penjualan vs Pemakaian bahan</span>
        <span style={{ color: C.brand, fontWeight: 800, fontSize: 12 }}>{open ? "Tutup" : "Buka"}</span>
      </button>
      {open && (
        <div style={{ display: "grid", gap: 10, padding: "0 14px 12px" }}>
          {!hasSales && <Notice kind="warn">Belum ada data penjualan. Upload di tab <b>Penjualan</b>.</Notice>}
          <Chips options={periods.map((p) => p.id)} value={custom ? null : pid} getLabel={(id) => periods.find((p) => p.id === id)?.label}
            onChange={(v) => { setCustom(null); setPid(v); }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><span style={label}>Dari</span><input type="date" value={period?.from || ""} style={dateInput}
              onChange={(e) => setCustom({ id: "c", from: e.target.value, to: period?.to || today })} /></div>
            <div><span style={label}>Sampai</span><input type="date" value={period?.to || ""} style={dateInput}
              onChange={(e) => setCustom({ id: "c", from: period?.from || today, to: e.target.value })} /></div>
          </div>
          <Chips options={["Semua", ...OUTLET_JUAL]} value={lok} onChange={setLok} />
          {err && <Notice kind="bad">{err}</Notice>}
          {!rows && !err && <div style={{ color: C.sub, fontSize: 13 }}>Menghitung…</div>}
          {rows && (
            <>
              <div style={{ fontSize: 13 }}>
                {list.length ? <>{list.length} bahan dihitung · <b>{important.length}</b> perlu diperiksa{totalLebih > 0 ? <> · pemakaian melebihi resep senilai <b>{fmtRp(totalLebih)}</b></> : null}</> : "Belum ada bahan yang bisa dibandingkan (butuh resep menu, penjualan, dan minimal 2 SO)."}
              </div>
              {shown.map((r) => {
                const it = itemsById[r.item_id];
                const [bg, fg] = PRIORITY_COLOR[r.priority] || PRIORITY_COLOR.INFO;
                return (
                  <div key={`${r.lokasi}-${r.item_id}`} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8, display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999 }}>{PRIORITY_LABEL[r.priority]}</span>
                      <span style={{ fontWeight: 800, fontSize: 14 }}>{it?.nama}</span>
                      <span style={{ fontSize: 12, color: C.sub }}>· {r.lokasi}</span>
                      {r.rp ? <span style={{ fontSize: 12, fontWeight: 800, color: r.rp > 0 ? C.bad : C.sub, marginLeft: "auto" }}>{r.rp > 0 ? "+" : "−"}{fmtRp(Math.abs(r.rp))}</span> : null}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.45 }}>{usageMessage(r, it)}</div>
                    {r.aktual !== null && (
                      <div style={{ fontSize: 11, color: C.sub }}>
                        SO {r.awalTgl} {fmtQty(r.awal)} + masuk {fmtQty(r.masuk)} − keluar {fmtQty(r.keluar)} − SO {r.akhirTgl} {fmtQty(r.akhir)} = {fmtQty(r.aktual)} {it?.satuan} · keyakinan {r.confidence === "HIGH" ? "tinggi" : r.confidence === "MEDIUM" ? "sedang" : "rendah"}
                      </div>
                    )}
                  </div>
                );
              })}
              {list.length > important.length && (
                <button type="button" onClick={() => setShowAll(!showAll)} style={{ border: "none", background: "none", color: C.brand, fontWeight: 800, fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0 }}>
                  {showAll ? "Hanya yang perlu diperiksa" : `Tampilkan semua (${list.length})`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
