"use client";
// SO akhir shift: hitung stok fisik di satu lokasi. Pakai daftar SO outlet (nama & satuan staf) bila ada.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SHIFTS, buildSoRows, buildSoLinesFromRows, soToItemQty, itemToSoQty, rowFactor, normSearch, parseQty,
  stockStatus, soDelta, round2, makeClientRef, todayJakarta, formatSoWa, fmtRp, fmtQty,
  parseWaStock, applyWaToRows, wasteFromWa,
} from "../../lib/inventoryLogic";
import { submitEvent, uploadFotos } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, WaButton, Chips, Notice, SearchBox, QtyInput, StatusBadge, FotoPicker, PasteWaPanel } from "./ui";

function draftKey(bizId, lokasi) {
  return `dapur:so2:${bizId}:${lokasi}`;
}
function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeDraft(key, v) {
  try { v ? localStorage.setItem(key, JSON.stringify(v)) : localStorage.removeItem(key); } catch { /* storage tidak tersedia */ }
}

export default function SoForm({ bizId, user, lokasi, items, templates, snapshot, onSaved, onWasteFromWa }) {
  const rows = useMemo(() => buildSoRows(items, templates, lokasi), [items, templates, lokasi]);
  const hasTemplate = rows.some((r) => r.template);
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
  const [fotos, setFotos] = useState([]);
  const [q, setQ] = useState("");
  const [grup, setGrup] = useState("Semua");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [pasteInfo, setPasteInfo] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const refId = useRef(makeClientRef("so"));

  useEffect(() => {
    const d = readDraft(key);
    setCounts(d?.counts || {});
    if (d?.shift) setShift(d.shift);
    setDone(null);
    setErr("");
    setPasteInfo(null);
    setFotos([]);
    refId.current = makeClientRef("so");
  }, [key]);

  useEffect(() => {
    const filled = Object.values(counts).some((v) => String(v ?? "").trim() !== "");
    writeDraft(key, filled ? { counts, shift } : null);
  }, [key, counts, shift]);

  // Bahan di luar daftar SO outlet disembunyikan dulu (masih bisa dibuka) supaya daftar sama dengan kebiasaan staf.
  const baseRows = useMemo(() => (hasTemplate && !showOthers ? rows.filter((r) => r.template || String(counts[r.key] ?? "").trim() !== "") : rows), [rows, hasTemplate, showOthers, counts]);

  const grupList = useMemo(() => ["Semua", ...new Set(baseRows.map((r) => r.grup))], [baseRows]);
  useEffect(() => { if (!grupList.includes(grup)) setGrup("Semua"); }, [grupList, grup]);

  const visible = useMemo(() => {
    const words = normSearch(q).split(" ").filter(Boolean);
    let list = baseRows;
    if (words.length) list = list.filter((r) => { const h = normSearch(`${r.label} ${r.item.nama} ${r.item.kode}`); return words.every((w) => h.includes(w)); });
    if (grup !== "Semua") list = list.filter((r) => r.grup === grup);
    if (onlyEmpty) list = list.filter((r) => String(counts[r.key] ?? "").trim() === "");
    return list;
  }, [baseRows, q, grup, onlyEmpty, counts]);

  const filledCount = rows.filter((r) => String(counts[r.key] ?? "").trim() !== "").length;
  const targetCount = hasTemplate ? rows.filter((r) => r.template).length : rows.length;

  function applyPaste(text) {
    const parsed = parseWaStock(text);
    const res = applyWaToRows(parsed, rows);
    setCounts((c) => ({ ...c, ...res.counts }));
    if (parsed.tanggal) setTanggal(parsed.tanggal);
    const waste = wasteFromWa(parsed, rows);
    setPasteInfo({
      matched: res.matched.length,
      unmatched: res.unmatched.map((u) => u.raw),
      unconvertible: res.unconvertible.map((u) => `${u.raw} → isi manual dalam ${u.row.satuan_so}`),
      notes: parsed.notes,
      tanggal: parsed.tanggal,
      waste,
    });
    if (parsed.notes.length) setCatatan((c) => c || `Menipis (laporan staf): ${parsed.notes.join(", ")}`);
  }

  async function submit() {
    setErr("");
    const { lines, errors } = buildSoLinesFromRows(rows, counts);
    if (errors.length) { setErr(`Periksa: ${errors.slice(0, 5).join(", ")}`); return; }
    if (!lines.length) { setErr("Belum ada bahan yang dihitung."); return; }
    const belum = targetCount - rows.filter((r) => (r.template || !hasTemplate) && String(counts[r.key] ?? "").trim() !== "").length;
    if (belum > 0 && !window.confirm(`${belum} bahan di daftar belum dihitung dan tidak akan disimpan. Lanjut simpan ${lines.length} bahan?`)) return;
    try {
      let foto = [];
      if (fotos.length) {
        setBusy("Upload foto…");
        foto = await uploadFotos(bizId, refId.current, fotos, tanggal);
      }
      setBusy("Menyimpan…");
      const payload = lines.map(({ converted, ...l }) => l);
      const res = await submitEvent(bizId, {
        client_ref: refId.current, jenis: "so", lokasi, tanggal, shift, catatan, created_by_name: user?.name, foto,
      }, payload);
      // Urut sesuai form (grup), pakai nama & satuan staf.
      const filledRows = rows.filter((r) => { const v = parseQty(counts[r.key]); return v !== null && !Number.isNaN(v); });
      let total = 0;
      let belumKonversi = 0;
      const waLines = filledRows.map((r) => {
        const qSo = parseQty(counts[r.key]);
        const conv = soToItemQty(r, qSo);
        if (conv.converted) total += conv.qty * (Number(r.item.harga) || 0); else belumKonversi++;
        const last = lastByItem[r.item.id];
        return {
          grup: hasTemplate ? r.grup : null, nama: r.label, satuan: r.satuan_so, qty: qSo,
          prevQty: last ? itemToSoQty(r, last.qty, last.satuan || r.item.satuan) : null,
          statusQty: conv.converted ? conv.qty : null, statusSatuan: conv.converted && conv.satuan !== r.satuan_so ? conv.satuan : null,
          minStok: conv.converted ? r.item.min_stok : null,
        };
      });
      total = round2(total);
      const text = formatSoWa({ lokasi, tanggal, shift, by: user?.name, lines: waLines, total, catatan, foto: foto.length, belumKonversi });
      setDone({ text, total, count: lines.length, duplicate: !!res?.duplicate });
      setCounts({});
      setCatatan("");
      setFotos([]);
      setPasteInfo(null);
      writeDraft(key, null);
      refId.current = makeClientRef("so");
      onSaved?.();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy("");
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

  if (!rows.length) {
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

      <PasteWaPanel onApply={applyPaste} />
      {pasteInfo && <PasteResult info={pasteInfo} onWaste={onWasteFromWa} onClose={() => setPasteInfo(null)} />}

      <div style={{ ...card, display: "grid", gap: 10 }}>
        <SearchBox value={q} onChange={setQ} />
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {grupList.map((k) => (
            <button key={k} type="button" onClick={() => setGrup(k)}
              style={{ flex: "0 0 auto", padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: `1px solid ${k === grup ? C.brand : C.line}`, background: k === grup ? C.brandSoft : "#fff", color: k === grup ? C.brand : C.ink }}>
              {k}
            </button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.sub }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          Tampilkan yang belum dihitung saja
        </label>
        {hasTemplate && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.sub }}>
            <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
            Tampilkan juga bahan di luar daftar SO outlet ({rows.filter((r) => !r.template).length})
          </label>
        )}
        <div style={{ fontSize: 12, color: C.sub }}>Sudah dihitung {filledCount} dari {targetCount} bahan · isian tersimpan otomatis di HP ini</div>
      </div>

      <div style={{ ...card, padding: 0 }}>
        {visible.map((r, idx) => {
          const it = r.item;
          const last = lastByItem[it.id];
          const raw = counts[r.key];
          const cur = parseQty(raw);
          const curOk = cur !== null && !Number.isNaN(cur);
          const f = rowFactor(r);
          const curItem = curOk && f !== null ? soToItemQty(r, cur).qty : null;
          const st = stockStatus(curItem ?? (last && (last.satuan || it.satuan) === it.satuan ? last.qty : null), it.min_stok);
          const lastSo = last ? itemToSoQty(r, last.qty, last.satuan || it.satuan) : null;
          const d = curOk ? soDelta(lastSo, cur) : null;
          const showHead = grup === "Semua" && hasTemplate && (idx === 0 || visible[idx - 1].grup !== r.grup);
          return (
            <div key={r.key}>
              {showHead && <div style={{ padding: "8px 12px", background: C.bg, fontSize: 12, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>{r.grup}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {r.label} <StatusBadge status={st} />
                  </div>
                  <div style={{ fontSize: 12, color: C.sub }}>
                    <b>{r.satuan_so}</b>
                    {f !== null && f !== 1 ? ` (1 ${r.satuan_so} = ${fmtQty(f, 6)} ${it.satuan})` : ""}
                    {f === null ? <span style={{ color: C.warn }}> · konversi ke {it.satuan} belum diatur</span> : ""}
                    {last ? ` · SO lalu ${lastSo !== null ? `${fmtQty(lastSo)} ${r.satuan_so}` : `${fmtQty(last.qty)} ${last.satuan || it.satuan}`} (${last.tanggal}${last.shift ? ` ${last.shift}` : ""})` : " · belum pernah SO"}
                    {d !== null && d !== 0 ? ` · ${d > 0 ? "+" : ""}${fmtQty(d)}` : ""}
                    {it.min_stok ? ` · min ${fmtQty(it.min_stok)} ${it.satuan}` : ""}
                  </div>
                </div>
                <QtyInput value={raw} onChange={(v) => setCounts((c) => ({ ...c, [r.key]: v }))} />
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div style={{ padding: 14, fontSize: 13, color: C.sub }}>Tidak ada bahan yang cocok.</div>}
      </div>

      <FotoPicker files={fotos} onChange={setFotos} />

      <div style={card}>
        <span style={label}>Catatan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }}
          placeholder="Mis. kulkas mati, stok dipinjam outlet lain…" />
      </div>

      {err && <Notice kind="bad">{err}</Notice>}
      <Btn onClick={submit} disabled={!!busy || filledCount === 0}>
        {busy || `Simpan SO (${filledCount} bahan${fotos.length ? ` · ${fotos.length} foto` : ""})`}
      </Btn>
      {Object.keys(counts).length > 0 && !busy && (
        <Btn kind="danger" onClick={() => { if (window.confirm("Kosongkan semua isian SO?")) setCounts({}); }}>Kosongkan isian</Btn>
      )}
    </div>
  );
}

function PasteResult({ info, onWaste, onClose }) {
  const problems = [...info.unconvertible, ...info.unmatched];
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <Notice kind={problems.length ? "warn" : "ok"}>
        {info.matched} baris terisi otomatis{info.tanggal ? ` · tanggal ${info.tanggal}` : ""}. Cek lagi angkanya sebelum simpan.
      </Notice>
      {info.unconvertible.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <b>Satuan tidak bisa dikonversi — isi manual:</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{info.unconvertible.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      {info.unmatched.length > 0 && (
        <div style={{ fontSize: 13 }}>
          <b>Tidak dikenali (tidak ada di daftar):</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{info.unmatched.map((t) => <li key={t}>{t}</li>)}</ul>
          <div style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>Cari manual di daftar, atau minta purchasing menambahkannya ke daftar SO.</div>
        </div>
      )}
      {info.notes.length > 0 && <div style={{ fontSize: 13 }}><b>Menipis (dari laporan):</b> {info.notes.join(", ")}</div>}
      {(info.waste.rows.length > 0 || info.waste.unmatched.length > 0) && (
        <Btn kind="ghost" onClick={() => onWaste?.(info.waste)}>
          Buka form Waste ({info.waste.rows.length} bahan dari bagian WASTE)
        </Btn>
      )}
      <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", color: C.sub, fontSize: 12, cursor: "pointer", justifySelf: "end" }}>Tutup</button>
    </div>
  );
}
