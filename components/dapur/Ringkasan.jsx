"use client";
// Ringkasan: nilai stok per lokasi (dari SO terakhir), bahan menipis, waste 7 hari, riwayat input.

import { useMemo, useState } from "react";
import {
  LOKASI, LOKASI_LABEL, stockValueByLokasi, stockStatus, stockRowsFor, runningBreakdown, fmtRp, fmtQty, todayJakarta,
} from "../../lib/inventoryLogic";
import { deleteEvent, fotoUrls } from "../../lib/inventoryRepo";
import { C, card, Notice, StatusBadge } from "./ui";
import StockValueCard from "./StockValueCard";

const JENIS_LABEL = { so: "SO", waste: "Waste", produksi: "Produksi", masuk: "Barang Masuk" };

function daysAgo(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function Ringkasan({ bizId, items, snapshot, running, events, lokasiScope, canDelete, onChanged }) {
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");
  const byId = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  const scope = lokasiScope?.length ? lokasiScope : LOKASI;

  const snap = useMemo(() => (snapshot || []).filter((r) => scope.includes(r.lokasi)), [snapshot, scope]);
  const values = useMemo(() => stockValueByLokasi(snap), [snap]);
  // Lokasi tanpa SO sama sekali: nilai "belum dihitung" (bukan Rp0, karena 0 berarti data valid bernilai nol).
  const soLokasi = useMemo(() => new Set(snap.map((r) => r.lokasi)), [snap]);
  // Alert memakai stok berjalan (SO terakhir + barang masuk − keluar); tanpa fungsi itu, jatuh ke SO terakhir.
  const stockRows = useMemo(() => stockRowsFor(running, snapshot).filter((r) => scope.includes(r.lokasi)), [running, snapshot, scope]);
  const alerts = useMemo(() => stockRows
    .map((r) => ({ ...r, item: byId[r.item_id], status: stockStatus(r.qty, byId[r.item_id]?.min_stok) }))
    .filter((r) => r.item && r.item.aktif !== false && (r.status === "habis" || r.status === "menipis"))
    .sort((a, b) => (a.status === b.status ? a.item.nama.localeCompare(b.item.nama) : a.status === "habis" ? -1 : 1)),
  [stockRows, byId]);
  // Bahan yang stoknya sudah bergerak sejak SO terakhir (atau belum pernah di-SO) — supaya barang masuk kelihatan.
  const bergerak = useMemo(() => (running || [])
    .filter((r) => scope.includes(r.lokasi) && byId[r.item_id] && byId[r.item_id].aktif !== false && r.qty_raw !== null && (!r.has_so || Number(r.masuk) > 0 || Number(r.keluar) > 0))
    .sort((a, b) => (Number(a.has_so) - Number(b.has_so)) || byId[a.item_id].nama.localeCompare(byId[b.item_id].nama)),
  [running, scope, byId]);

  const since = daysAgo(todayJakarta(), 6);
  const waste7 = useMemo(() => {
    const out = {};
    for (const e of events || []) {
      if (e.jenis !== "waste" || e.tanggal < since || !scope.includes(e.lokasi)) continue;
      out[e.lokasi] = (out[e.lokasi] || 0) + Number(e.total_nilai || 0);
    }
    return out;
  }, [events, since, scope]);

  async function remove(ev) {
    if (!window.confirm(`Hapus ${JENIS_LABEL[ev.jenis]} ${ev.lokasi} ${ev.tanggal}? Data tidak bisa dikembalikan.`)) return;
    setBusyId(ev.id); setErr("");
    try { await deleteEvent(ev.id); onChanged?.(); } catch (e) { setErr(e.message || String(e)); } finally { setBusyId(null); }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {bizId && <StockValueCard bizId={bizId} lokasiScope={scope} />}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Nilai stok & waste 7 hari</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {scope.map((l) => (
            <div key={l} style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>{LOKASI_LABEL[l]}</div>
              {soLokasi.has(l)
                ? <div style={{ fontSize: 16, fontWeight: 800 }}>{fmtRp(values[l])}</div>
                : <div style={{ fontSize: 13, fontWeight: 700, color: C.sub, padding: "3px 0" }}>Belum dihitung</div>}
              {waste7[l] ? <div style={{ fontSize: 11, color: C.bad }}>Waste 7 hari {fmtRp(waste7[l])}</div> : null}
            </div>
          ))}
        </div>
        {scope.length > 1 && (
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
            <span>Total</span><span>{soLokasi.size ? fmtRp(values.total) : "Belum dihitung"}</span>
          </div>
        )}
        <div style={{ fontSize: 11, color: C.sub, marginTop: 8 }}>
          Dihitung dari SO terakhir tiap bahan × modal saat ini. Bahan yang belum pernah di-SO belum ikut terhitung.
        </div>
      </div>

      {/* Kartu stok minimum baru berarti setelah ada SO yang bisa dijadikan dasar. */}
      {snap.length > 0 && (
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Perlu diisi ulang{alerts.length ? ` (${alerts.length})` : ""}</div>
        {alerts.length === 0 ? (
          <div style={{ fontSize: 13, color: C.sub }}>Tidak ada bahan di bawah stok minimum (SO terakhir + barang masuk − keluar sejak SO).</div>
        ) : alerts.slice(0, 30).map((a) => (
          <div key={`${a.lokasi}-${a.item_id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.line}`, fontSize: 13 }}>
            <span>{a.item.nama} <span style={{ color: C.sub }}>· {a.lokasi}</span></span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {fmtQty(a.qty)} / min {fmtQty(a.item.min_stok)} {a.item.satuan} <StatusBadge status={a.status} />
            </span>
          </div>
        ))}
      </div>
      )}

      {bergerak.length > 0 && (
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Stok tercatat sekarang ({bergerak.length})</div>
        <div style={{ fontSize: 11, color: C.sub, marginBottom: 8 }}>
          SO terakhir + barang masuk/produksi/kiriman − waste/keluar sejak SO itu. Angka resmi tetap hasil SO fisik berikutnya.
        </div>
        {bergerak.slice(0, 40).map((r) => {
          const it = byId[r.item_id];
          return (
            <div key={`${r.lokasi}-${r.item_id}`} style={{ padding: "6px 0", borderBottom: `1px solid ${C.line}`, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{it.nama} <span style={{ color: C.sub }}>· {r.lokasi}</span></span>
                <b>{fmtQty(r.qty_raw < 0 ? 0 : r.qty_raw)} {it.satuan}</b>
              </div>
              <div style={{ fontSize: 11, color: r.has_so ? C.sub : C.warn }}>
                {runningBreakdown(r, fmtQty)} {it.satuan}{r.qty_raw < 0 ? " · catatan keluar melebihi stok, cek SO" : ""}
              </div>
            </div>
          );
        })}
        {bergerak.length > 40 && <div style={{ fontSize: 11, color: C.sub, paddingTop: 6 }}>+{bergerak.length - 40} bahan lain.</div>}
      </div>
      )}

      <div style={{ ...card, padding: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, padding: "12px 14px 6px" }}>Riwayat input</div>
        {err && <div style={{ padding: "0 14px 8px" }}><Notice kind="bad">{err}</Notice></div>}
        {(events || []).filter((e) => scope.includes(e.lokasi)).map((ev) => (
          <div key={ev.id} style={{ borderTop: `1px solid ${C.line}` }}>
            <button type="button" onClick={() => setOpenId(openId === ev.id ? null : ev.id)}
              style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "#fff", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{JENIS_LABEL[ev.jenis]} · {ev.lokasi}{ev.shift ? ` · ${ev.shift}` : ""}</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{fmtRp(ev.total_nilai)}</span>
              </div>
              <div style={{ fontSize: 12, color: C.sub }}>{ev.tanggal} · {ev.created_by_name || "—"} · {(ev.lines || []).length} baris{ev.foto?.length ? ` · 📷 ${ev.foto.length}` : ""}</div>
            </button>
            {openId === ev.id && (
              <div style={{ padding: "0 14px 12px", fontSize: 13 }}>
                {(ev.lines || []).map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
                    <span>{l.arah === "masuk" ? "➕ " : l.arah === "keluar" && ev.jenis === "produksi" ? "➖ " : ""}{l.label || byId[l.item_id]?.nama || "?"}{l.alasan ? ` (${l.alasan})` : ""}</span>
                    <span>
                      {l.satuan_input && l.satuan_input !== l.satuan ? `${fmtQty(l.qty_input)} ${l.satuan_input} = ` : ""}
                      {fmtQty(l.qty)} {l.satuan} · {fmtRp(l.nilai)}
                    </span>
                  </div>
                ))}
                {ev.catatan && <div style={{ color: C.sub, marginTop: 6 }}>📝 {ev.catatan}</div>}
                {ev.foto?.length > 0 && <FotoList paths={ev.foto} />}
                {canDelete && (
                  <button type="button" disabled={busyId === ev.id} onClick={() => remove(ev)}
                    style={{ marginTop: 8, border: "none", background: C.badSoft, color: C.bad, borderRadius: 10, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}>
                    {busyId === ev.id ? "Menghapus…" : "Hapus input ini"}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {!(events || []).some((e) => scope.includes(e.lokasi)) && (
          <div style={{ padding: "0 14px 14px", fontSize: 13, color: C.sub }}>Belum ada input.</div>
        )}
      </div>
    </div>
  );
}

function FotoList({ paths }) {
  const [urls, setUrls] = useState(null);
  const [err, setErr] = useState("");
  if (!urls) {
    return (
      <button type="button" onClick={() => fotoUrls(paths).then(setUrls).catch((e) => setErr(e.message || String(e)))}
        style={{ marginTop: 8, marginRight: 8, border: `1px solid ${C.line}`, background: "#fff", borderRadius: 10, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }}>
        📷 Lihat {paths.length} foto{err ? ` — gagal: ${err}` : ""}
      </button>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt={`Foto ${i + 1}`} style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 10, border: `1px solid ${C.line}` }} />
        </a>
      ))}
    </div>
  );
}
