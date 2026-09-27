"use client";
// Catat waste / barang terbuang di satu lokasi.

import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  SHIFTS, WASTE_REASONS, itemsForLokasi, parseQty, round2, makeClientRef, todayJakarta, formatWasteWa, fmtRp,
} from "../../lib/inventoryLogic";
import { submitEvent } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, WaButton, Chips, Notice, ItemPicker, QtyInput } from "./ui";

export default function WasteForm({ bizId, user, lokasi, items, onSaved }) {
  const lokasiItems = useMemo(() => itemsForLokasi(items, lokasi), [items, lokasi]);
  const [rows, setRows] = useState([]);
  const [shift, setShift] = useState("Tutup");
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const refId = useRef(makeClientRef("waste"));

  const total = round2(rows.reduce((s, r) => s + (parseQty(r.qty) || 0) * (Number(r.item.harga) || 0), 0));

  function update(i, patch) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    setErr("");
    const bad = rows.filter((r) => { const q = parseQty(r.qty); return q === null || Number.isNaN(q) || q <= 0; });
    if (!rows.length) { setErr("Tambahkan minimal satu bahan."); return; }
    if (bad.length) { setErr(`Isi jumlah yang benar untuk: ${bad.map((r) => r.item.nama).join(", ")}`); return; }
    setBusy(true);
    try {
      const lines = rows.map((r) => ({ item_id: r.item.id, qty: parseQty(r.qty), alasan: r.alasan }));
      const res = await submitEvent(bizId, {
        client_ref: refId.current, jenis: "waste", lokasi, tanggal, shift, catatan, created_by_name: user?.name,
      }, lines);
      const waLines = rows.map((r) => {
        const q = parseQty(r.qty);
        return { nama: r.item.nama, satuan: r.item.satuan, qty: q, alasan: r.alasan, nilai: q * (Number(r.item.harga) || 0) };
      });
      const text = formatWasteWa({ lokasi, tanggal, shift, by: user?.name, lines: waLines, total, catatan });
      setDone({ text, total, duplicate: !!res?.duplicate });
      setRows([]);
      setCatatan("");
      refId.current = makeClientRef("waste");
      onSaved?.();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <Notice kind="ok">Waste tersimpan{done.duplicate ? " (sudah pernah terkirim)" : ""} · total {fmtRp(done.total)}.</Notice>
        <pre style={{ ...card, whiteSpace: "pre-wrap", fontSize: 13, margin: 0, fontFamily: "inherit" }}>{done.text}</pre>
        <WaButton text={done.text} />
        <Btn kind="ghost" onClick={() => setDone(null)}>Catat waste lagi</Btn>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div>
          <span style={label}>Shift</span>
          <Chips options={SHIFTS} value={shift} onChange={setShift} />
        </div>
        <div>
          <span style={label}>Tanggal</span>
          <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} style={input} />
        </div>
      </div>

      <div style={{ ...card, display: "grid", gap: 10 }}>
        <span style={label}>Tambah bahan yang terbuang</span>
        <ItemPicker items={lokasiItems} excludeIds={rows.map((r) => r.item.id)}
          onPick={(item) => setRows((rs) => [...rs, { item, qty: "", alasan: WASTE_REASONS[0] }])} />
      </div>

      {rows.map((r, i) => (
        <div key={r.item.id} style={{ ...card, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{r.item.nama}</div>
              <div style={{ fontSize: 12, color: C.sub }}>{r.item.satuan} · modal {fmtRp(r.item.harga)}/{r.item.satuan}</div>
            </div>
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Hapus baris"
              style={{ border: "none", background: C.badSoft, borderRadius: 10, padding: 8, cursor: "pointer" }}>
              <Trash2 size={16} color={C.bad} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <QtyInput value={r.qty} onChange={(v) => update(i, { qty: v })} width={100} />
            <select value={r.alasan} onChange={(e) => update(i, { alasan: e.target.value })} style={{ ...input, flex: 1 }}>
              {WASTE_REASONS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>
      ))}

      <div style={card}>
        <span style={label}>Keterangan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }}
          placeholder="Mis. freezer mati jam 3 sore" />
      </div>

      {rows.length > 0 && <Notice kind="warn">Total nilai waste: <b>{fmtRp(total)}</b></Notice>}
      {err && <Notice kind="bad">{err}</Notice>}
      <Btn onClick={submit} disabled={busy || rows.length === 0}>{busy ? "Menyimpan…" : "Simpan Waste"}</Btn>
    </div>
  );
}
