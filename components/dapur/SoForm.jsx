"use client";
// SO akhir shift: hitung stok fisik per bahan di satu lokasi.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SHIFTS, itemsForLokasi, searchItems, buildSoLines, stockStatus, soDelta, sumNilai,
  makeClientRef, todayJakarta, formatSoWa, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import { submitEvent } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, WaButton, Chips, Notice, SearchBox, QtyInput, StatusBadge } from "./ui";

function draftKey(bizId, lokasi) {
  return `dapur:so:${bizId}:${lokasi}`;
}
function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeDraft(key, v) {
  try { v ? localStorage.setItem(key, JSON.stringify(v)) : localStorage.removeItem(key); } catch { /* storage tidak tersedia */ }
}

export default function SoForm({ bizId, user, lokasi, items, snapshot, onSaved }) {
  const lokasiItems = useMemo(() => itemsForLokasi(items, lokasi), [items, lokasi]);
  const lastByItem = useMemo(() => {
    const m = {};
    for (const r of snapshot || []) if (r.lokasi === lokasi) m[r.item_id] = r;
    return m;
  }, [snapshot, lokasi]);

  const key = draftKey(bizId, lokasi);
  const [counts, setCounts] = useState({});
  const [shift, setShift] = useState("Tutup");
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [catatan, setCatatan] = useState("");
  const [q, setQ] = useState("");
  const [kat, setKat] = useState("Semua");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const refId = useRef(makeClientRef("so"));

  useEffect(() => {
    const d = readDraft(key);
    setCounts(d?.counts || {});
    if (d?.shift) setShift(d.shift);
    setDone(null);
    setErr("");
    refId.current = makeClientRef("so");
  }, [key]);

  useEffect(() => {
    const filled = Object.values(counts).some((v) => String(v ?? "").trim() !== "");
    writeDraft(key, filled ? { counts, shift } : null);
  }, [key, counts, shift]);

  const kategoriList = useMemo(() => {
    const s = new Set(lokasiItems.map((i) => i.kategori || "Lainnya"));
    return ["Semua", ...[...s].sort()];
  }, [lokasiItems]);

  const visible = useMemo(() => {
    let list = searchItems(lokasiItems, q);
    if (kat !== "Semua") list = list.filter((i) => (i.kategori || "Lainnya") === kat);
    if (onlyEmpty) list = list.filter((i) => String(counts[i.id] ?? "").trim() === "");
    return list;
  }, [lokasiItems, q, kat, onlyEmpty, counts]);

  const filledCount = lokasiItems.filter((i) => String(counts[i.id] ?? "").trim() !== "").length;
  const itemsById = useMemo(() => Object.fromEntries(lokasiItems.map((i) => [i.id, i])), [lokasiItems]);

  async function submit() {
    setErr("");
    const { lines, errors } = buildSoLines(lokasiItems, counts);
    if (errors.length) { setErr(`Angka tidak valid: ${errors.slice(0, 5).join(", ")}`); return; }
    if (!lines.length) { setErr("Belum ada bahan yang dihitung."); return; }
    const belum = lokasiItems.length - lines.length;
    if (belum > 0 && !window.confirm(`${belum} bahan belum dihitung dan tidak akan disimpan. Lanjut simpan ${lines.length} bahan?`)) return;
    setBusy(true);
    try {
      const res = await submitEvent(bizId, {
        client_ref: refId.current, jenis: "so", lokasi, tanggal, shift, catatan, created_by_name: user?.name,
      }, lines);
      const total = sumNilai(lines, itemsById);
      const waLines = lines.map((l) => {
        const it = itemsById[l.item_id];
        return { nama: it.nama, satuan: it.satuan, qty: l.qty, prevQty: lastByItem[l.item_id]?.qty ?? null, minStok: it.min_stok };
      });
      const text = formatSoWa({ lokasi, tanggal, shift, by: user?.name, lines: waLines, total, catatan });
      setDone({ text, total, count: lines.length, duplicate: !!res?.duplicate });
      setCounts({});
      setCatatan("");
      writeDraft(key, null);
      refId.current = makeClientRef("so");
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
        <Notice kind="ok">
          SO tersimpan{done.duplicate ? " (sudah pernah terkirim sebelumnya)" : ""}: {done.count} bahan · nilai stok {fmtRp(done.total)}.
        </Notice>
        <pre style={{ ...card, whiteSpace: "pre-wrap", fontSize: 13, margin: 0, fontFamily: "inherit" }}>{done.text}</pre>
        <WaButton text={done.text} />
        <Btn kind="ghost" onClick={() => setDone(null)}>Isi SO lagi</Btn>
      </div>
    );
  }

  if (!lokasiItems.length) {
    return <Notice kind="warn">Belum ada bahan untuk lokasi ini. Minta admin/purchasing mengatur lokasi bahan di menu Kelola Bahan.</Notice>;
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
        <SearchBox value={q} onChange={setQ} />
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {kategoriList.map((k) => (
            <button key={k} type="button" onClick={() => setKat(k)}
              style={{ flex: "0 0 auto", padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: `1px solid ${k === kat ? C.brand : C.line}`, background: k === kat ? C.brandSoft : "#fff", color: k === kat ? C.brand : C.ink }}>
              {k}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.sub }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          Tampilkan yang belum dihitung saja
        </label>
        <div style={{ fontSize: 12, color: C.sub }}>Sudah dihitung {filledCount} dari {lokasiItems.length} bahan · isian tersimpan otomatis di HP ini</div>
      </div>

      <div style={{ ...card, padding: 0 }}>
        {visible.map((it) => {
          const last = lastByItem[it.id];
          const raw = counts[it.id];
          const cur = String(raw ?? "").trim() === "" ? null : Number(String(raw).replace(",", "."));
          const st = stockStatus(cur ?? last?.qty ?? null, it.min_stok);
          const d = cur === null ? null : soDelta(last?.qty, cur);
          return (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {it.nama} <StatusBadge status={st} />
                </div>
                <div style={{ fontSize: 12, color: C.sub }}>
                  {it.satuan}
                  {last ? ` · SO lalu ${fmtQty(last.qty)} (${last.tanggal}${last.shift ? ` ${last.shift}` : ""})` : " · belum pernah SO"}
                  {d !== null && d !== 0 ? ` · ${d > 0 ? "+" : ""}${fmtQty(d)}` : ""}
                  {it.min_stok ? ` · min ${fmtQty(it.min_stok)}` : ""}
                </div>
              </div>
              <QtyInput value={raw} onChange={(v) => setCounts((c) => ({ ...c, [it.id]: v }))} />
            </div>
          );
        })}
        {visible.length === 0 && <div style={{ padding: 14, fontSize: 13, color: C.sub }}>Tidak ada bahan yang cocok.</div>}
      </div>

      <div style={card}>
        <span style={label}>Catatan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }}
          placeholder="Mis. kulkas mati, stok dipinjam outlet lain…" />
      </div>

      {err && <Notice kind="bad">{err}</Notice>}
      <Btn onClick={submit} disabled={busy || filledCount === 0}>
        {busy ? "Menyimpan…" : `Simpan SO (${filledCount} bahan)`}
      </Btn>
    </div>
  );
}
