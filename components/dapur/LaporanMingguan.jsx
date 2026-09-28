"use client";
// Laporan audit mingguan (Tahap C): pilih minggu (termasuk minggu-minggu lalu → audit mundur),
// hitung di server dari SO/waste/masuk/kiriman/penjualan, ringkasan AI, kirim ke WA.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { LOKASI_LABEL, PRIORITY_LABEL, formatAuditWa, todayJakarta, weekRange, fmtRp } from "../../lib/inventoryLogic";
import { buildAuditReport, deleteAuditReport, loadAuditReports } from "../../lib/inventoryRepo";
import { C, card, Btn, Chips, Notice, WaButton } from "./ui";

const fmtRange = (r) => `${r.from.slice(8)}/${r.from.slice(5, 7)} – ${r.to.slice(8)}/${r.to.slice(5, 7)}`;

export default function LaporanMingguan({ bizId, user }) {
  const today = todayJakarta();
  const weeks = useMemo(() => [0, -1, -2, -3].map((o) => ({ id: String(o), ...weekRange(today, o), label: o === 0 ? "Minggu ini" : o === -1 ? "Minggu lalu" : `${-o} minggu lalu` })), [today]);
  const [wid, setWid] = useState("-1");
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(true);

  const reload = useCallback(async () => {
    try { setReports(await loadAuditReports(bizId)); } catch (e) { setMsg({ kind: "bad", text: e.message || String(e) }); }
  }, [bizId]);
  useEffect(() => { reload(); }, [reload]);

  const week = weeks.find((w) => w.id === wid) || weeks[1];
  const report = reports.find((r) => r.dari === week.from && r.sampai === week.to);

  const build = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await buildAuditReport(bizId, week.from, week.to, user?.name || user?.email || null);
      if (res.aiError) setMsg({ kind: "warn", text: "Ringkasan AI belum bisa dibuat, dipakai ringkasan otomatis." });
      await reload();
    } catch (e) {
      setMsg({ kind: "bad", text: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!report || !window.confirm(`Hapus laporan ${fmtRange(week)}?`)) return;
    await deleteAuditReport(report.id);
    await reload();
  };

  const s = report?.data;
  const n = report?.narasi;

  return (
    <div style={{ ...card, padding: 0 }}>
      <button type="button" onClick={() => setOpen(!open)}
        style={{ display: "flex", justifyContent: "space-between", width: "100%", border: "none", background: "#fff", padding: "12px 14px", cursor: "pointer", borderRadius: 14 }}>
        <span style={{ fontWeight: 800 }}>Laporan audit mingguan</span>
        <span style={{ color: C.brand, fontWeight: 800, fontSize: 12 }}>{open ? "Tutup" : "Buka"}</span>
      </button>
      {open && (
        <div style={{ display: "grid", gap: 10, padding: "0 14px 14px" }}>
          <Chips options={weeks.map((w) => w.id)} value={wid} onChange={setWid}
            getLabel={(id) => { const w = weeks.find((x) => x.id === id); return `${w.label} · ${fmtRange(w)}`; }} />
          <Btn onClick={build} disabled={busy} kind={report ? "ghost" : "primary"}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} /> {busy ? "Menghitung & menulis ringkasan…" : report ? "Hitung ulang laporan" : "Buat laporan minggu ini"}
            </span>
          </Btn>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

          {s && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                <Tile label="Perlu dicek" value={s.totals?.temuan ?? 0} color={s.totals?.temuan ? C.warn : C.ok} />
                <Tile label="Waste" value={fmtRp(s.totals?.wasteRp)} color={C.bad} />
                <Tile label="Lebih dari resep" value={fmtRp(s.totals?.lebihRp)} color={s.totals?.lebihRp ? C.bad : C.sub} />
              </div>

              {n && (
                <div style={{ background: C.brandSoft, borderRadius: 12, padding: 12, display: "grid", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 800, color: C.brand, fontSize: 12 }}>{n.sumber === "ai" ? "Ringkasan AI" : "Ringkasan otomatis"}</div>
                  <div>{n.ringkasan}</div>
                  {n.poin?.length > 0 && (
                    <div><b>Perlu diperiksa</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{n.poin.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
                  )}
                  {n.tindakan?.length > 0 && (
                    <div><b>Langkah minggu depan</b><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{n.tindakan.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
                  )}
                </div>
              )}

              <div style={{ display: "grid", gap: 4 }}>
                {Object.entries(s.lokasi || {}).map(([l, v]) => (
                  <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, borderBottom: `1px solid ${C.line}`, padding: "6px 0" }}>
                    <span style={{ fontWeight: 800 }}>{LOKASI_LABEL[l] || l}</span>
                    <span style={{ color: C.sub, textAlign: "right" }}>
                      SO {v.so}× · waste {fmtRp(v.wasteRp)}{v.temuan ? ` · ${v.temuan} temuan` : ""}{v.lebihRp ? ` · lebih ${fmtRp(v.lebihRp)}` : ""}
                    </span>
                  </div>
                ))}
              </div>

              {s.findings?.filter((f) => f.priority !== "INFO").slice(0, 5).map((f) => (
                <div key={f.key} style={{ fontSize: 12, lineHeight: 1.45 }}>
                  <b>{PRIORITY_LABEL[f.priority]}</b> · {f.nama} ({f.lokasi}, {f.tanggal}) — {f.message}
                </div>
              ))}

              <div style={{ fontSize: 11, color: C.sub }}>
                Dihitung {new Date(report.updated_at).toLocaleString("id-ID")}{report.created_by_name ? ` oleh ${report.created_by_name}` : ""}.
                {s.totals?.sudahDicek ? ` ${s.totals.sudahDicek} temuan sudah ditandai dicek.` : ""}
                {!s.totals?.penjualan ? " Belum ada data penjualan untuk periode ini." : ""}
              </div>
              <WaButton text={formatAuditWa(s, n)} label="Kirim laporan ke WhatsApp" />
              <button type="button" onClick={del} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "none", color: C.bad, fontSize: 12, fontWeight: 800, cursor: "pointer", justifySelf: "start" }}>
                <Trash2 size={14} /> Hapus laporan ini
              </button>
            </>
          )}
          {!s && !busy && <div style={{ fontSize: 12, color: C.sub }}>Belum ada laporan untuk minggu ini. Laporan bisa dibuat untuk minggu-minggu lalu juga (audit mundur) — angka SO tidak diubah.</div>}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, color }) {
  return (
    <div style={{ background: C.bg, borderRadius: 12, padding: "8px 6px", textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 900, color }}>{value}</div>
      <div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>{label}</div>
    </div>
  );
}
