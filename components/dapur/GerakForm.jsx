"use client";
// Form pergerakan stok: WASTE (barang terbuang) dan BARANG MASUK (pembelian/retur/koreksi).
// Staf memilih nama yang biasa dipakai (daftar SO outlet), isi jumlah dalam satuan apa pun
// (gram, porsi, ml, pcs…). Nilai Rp dihitung otomatis dari modal — staf tidak perlu tahu HPP.

import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  SHIFTS, WASTE_REASONS, MASUK_SUMBER, buildSoRows, rowsForArea, defaultArea, unitOptions, toItemQty, normSearch,
  parseQty, round2, makeClientRef, todayJakarta, formatWasteWa, formatMasukWa, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import { submitEvent, uploadFotos } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, WaButton, Chips, Notice, SearchBox, QtyInput, FotoPicker, AreaChips, dateInput, selectInput, unitLabel } from "./ui";

function RowPicker({ rows, excludeKeys, onPick }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const words = normSearch(q).split(" ").filter(Boolean);
    if (!words.length) return [];
    const ex = new Set(excludeKeys);
    return rows.filter((r) => !ex.has(r.key))
      .filter((r) => { const h = normSearch(`${r.label} ${r.item.nama} ${r.item.kode}`); return words.every((w) => h.includes(w)); })
      .slice(0, 8);
  }, [rows, q, excludeKeys]);
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Ketik nama barang, mis. ayam, susu, sirup…" />
      {q && (
        <div style={{ marginTop: 6, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
          {!results.length ? (
            <div style={{ padding: 12, fontSize: 13, color: C.sub }}>Tidak ada. Minta purchasing/admin menambahkan di Kelola.</div>
          ) : results.map((r) => (
            <button key={r.key} type="button" onClick={() => { onPick(r); setQ(""); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: `1px solid ${C.line}`, background: "#fff", cursor: "pointer" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{r.label}</div>
              <div style={{ fontSize: 12, color: C.sub }}>{r.label !== r.item.nama ? `${r.item.nama} · ` : ""}{r.grup}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GerakForm({ mode = "waste", bizId, user, lokasi, items, templates, prefill, onPrefillUsed, onSaved }) {
  const waste = mode === "waste";
  const allRows = useMemo(() => buildSoRows(items, templates, lokasi), [items, templates, lokasi]);
  const hasArea = allRows.some((r) => r.area);
  const [area, setArea] = useState(() => defaultArea(user));
  const effArea = hasArea ? area : null;
  const pickRows = useMemo(() => rowsForArea(allRows, effArea), [allRows, effArea]);

  const [lines, setLines] = useState([]); // { row, qty, unit, alasan }
  const [shift, setShift] = useState("Tutup");
  const [sumber, setSumber] = useState("pembelian");
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [catatan, setCatatan] = useState("");
  const [fotos, setFotos] = useState([]);
  const [fromWa, setFromWa] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const refId = useRef(makeClientRef(mode));

  // Bagian WASTE dari laporan WA yang ditempel di form SO (qty sudah satuan master).
  useEffect(() => {
    if (!waste || !prefill) return;
    setLines((ls) => {
      const have = new Set(ls.map((l) => l.row.item.id));
      const add = (prefill.rows || []).filter((r) => !have.has(r.item.id)).map((r) => {
        const row = allRows.find((x) => x.item.id === r.item.id) || { key: `i:${r.item.id}`, item: r.item, label: r.item.nama, satuan_so: r.item.satuan, isi: 1 };
        return { row, qty: String(r.qty).replace(".", ","), unit: r.item.satuan, alasan: WASTE_REASONS[0] };
      });
      return [...ls, ...add];
    });
    setFromWa({ count: (prefill.rows || []).length, unmatched: (prefill.unmatched || []).map((u) => u.raw) });
    onPrefillUsed?.();
  }, [waste, prefill, onPrefillUsed, allRows]);

  const calc = (l) => {
    const q = parseQty(l.qty);
    if (q === null || Number.isNaN(q)) return { conv: null, nilai: 0 };
    const conv = toItemQty(l.row, q, l.unit);
    const nilai = conv.converted ? round2(conv.qty * (Number(l.row.item.harga) || 0)) : 0;
    return { conv, nilai };
  };
  const total = round2(lines.reduce((s, l) => s + calc(l).nilai, 0));
  const update = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit() {
    setErr("");
    if (!lines.length) { setErr("Tambahkan minimal satu barang."); return; }
    const bad = lines.filter((l) => { const q = parseQty(l.qty); return q === null || Number.isNaN(q) || q <= 0; });
    if (bad.length) { setErr(`Isi jumlah yang benar untuk: ${bad.map((l) => l.row.label).join(", ")}`); return; }
    try {
      let foto = [];
      if (fotos.length) { setBusy("Upload foto…"); foto = await uploadFotos(bizId, refId.current, fotos, tanggal); }
      setBusy("Menyimpan…");
      const payload = lines.map((l) => {
        const { conv } = calc(l);
        return { item_id: l.row.item.id, qty: conv.qty, satuan: conv.satuan, qty_input: parseQty(l.qty), satuan_input: l.unit, label: l.row.label, alasan: waste ? l.alasan : null };
      });
      const res = await submitEvent(bizId, {
        client_ref: refId.current, jenis: waste ? "waste" : "masuk", lokasi, tanggal, shift: waste ? shift : null, catatan,
        created_by_name: user?.name, foto, area: effArea, sumber: waste ? null : sumber,
      }, payload);
      const waLines = lines.map((l) => ({ nama: l.row.label, satuan: l.unit, qty: parseQty(l.qty), alasan: l.alasan, nilai: calc(l).nilai }));
      const text = waste
        ? formatWasteWa({ lokasi, tanggal, shift, by: user?.name, lines: waLines, total, catatan, foto: foto.length })
        : formatMasukWa({ lokasi, tanggal, by: user?.name, sumber, lines: waLines, total, catatan, foto: foto.length });
      setDone({ text, total, duplicate: !!res?.duplicate });
      setLines([]); setCatatan(""); setFotos([]); setFromWa(null);
      refId.current = makeClientRef(mode);
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
        <Notice kind="ok">{waste ? "Waste" : "Barang masuk"} tersimpan{done.duplicate ? " (sudah pernah terkirim)" : ""} · nilai {fmtRp(done.total)}.</Notice>
        <pre style={{ ...card, whiteSpace: "pre-wrap", fontSize: 13, margin: 0, fontFamily: "inherit" }}>{done.text}</pre>
        <WaButton text={done.text} />
        <Btn kind="ghost" onClick={() => setDone(null)}>{waste ? "Catat waste lagi" : "Catat barang masuk lagi"}</Btn>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        {!waste && (
          <div>
            <span style={label}>Asal barang</span>
            <Chips options={MASUK_SUMBER.map((s) => s.id)} value={sumber} onChange={setSumber} getLabel={(id) => MASUK_SUMBER.find((s) => s.id === id)?.label} />
          </div>
        )}
        {hasArea && (
          <div>
            <span style={label}>Daftar</span>
            <AreaChips value={area} onChange={setArea} />
          </div>
        )}
        {waste && (
          <div>
            <span style={label}>Shift</span>
            <Chips options={SHIFTS} value={shift} onChange={setShift} />
          </div>
        )}
        <div>
          <span style={label}>Tanggal</span>
          <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} style={dateInput} />
        </div>
      </div>

      {fromWa && (
        <Notice kind={fromWa.unmatched.length ? "warn" : "info"}>
          {fromWa.count} barang diisi dari bagian WASTE laporan WA — pilih penyebabnya lalu simpan.
          {fromWa.unmatched.length > 0 && <> Tidak dikenali: {fromWa.unmatched.join("; ")}.</>}
        </Notice>
      )}

      <div style={{ ...card, display: "grid", gap: 8 }}>
        <span style={label}>{waste ? "Barang yang terbuang" : "Barang yang masuk"}</span>
        <RowPicker rows={pickRows} excludeKeys={lines.map((l) => l.row.key)}
          onPick={(row) => setLines((ls) => [...ls, { row, qty: "", unit: row.satuan_so || row.item.satuan, alasan: WASTE_REASONS[0] }])} />
        {waste && <div style={{ fontSize: 12, color: C.sub }}>Contoh: ayam gosong 2 porsi, susu basi 500 ml, nasi sisa 1,2 kg — isi dengan satuan yang paling gampang.</div>}
      </div>

      {lines.map((l, i) => {
        const { conv, nilai } = calc(l);
        const opts = unitOptions(l.row);
        return (
          <div key={l.row.key} style={{ ...card, display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{l.row.label}</div>
                {l.row.label !== l.row.item.nama && <div style={{ fontSize: 12, color: C.sub }}>{l.row.item.nama}</div>}
              </div>
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus baris"
                style={{ border: "none", background: C.badSoft, borderRadius: 10, padding: 8, cursor: "pointer" }}>
                <Trash2 size={16} color={C.bad} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <QtyInput value={l.qty} onChange={(v) => update(i, { qty: v })} width={96} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {opts.map((u) => (
                  <button key={u} type="button" onClick={() => update(i, { unit: u })}
                    style={{ padding: "7px 10px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${l.unit === u ? C.brand : C.line}`, background: l.unit === u ? C.brand : "#fff", color: l.unit === u ? "#fff" : C.ink }}>
                    {unitLabel(u)}
                  </button>
                ))}
              </div>
            </div>
            {waste && (
              <select value={l.alasan} onChange={(e) => update(i, { alasan: e.target.value })} style={selectInput}>
                {WASTE_REASONS.map((a) => <option key={a}>{a}</option>)}
              </select>
            )}
            {conv && (
              <div style={{ fontSize: 12, color: conv.converted && nilai > 0 ? C.sub : C.warn }}>
                {conv.converted
                  ? (nilai > 0 ? `≈ ${fmtQty(conv.qty, 4)} ${conv.satuan} · ${fmtRp(nilai)} (dari modal)` : `≈ ${fmtQty(conv.qty, 4)} ${conv.satuan} · modal barang ini belum diisi, nilai menyusul`)
                  : "Satuan ini belum ada konversinya — tetap tersimpan, nilai dihitung setelah owner mengisi konversi"}
              </div>
            )}
          </div>
        );
      })}

      <FotoPicker files={fotos} onChange={setFotos} hint={waste ? "Foto barang yang dibuang sebagai bukti." : "Foto nota / barang yang datang."} />
      <div style={card}>
        <span style={label}>Keterangan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }}
          placeholder={waste ? "Mis. freezer mati jam 3 sore" : "Mis. beli di pasar, nota terlampir"} />
      </div>

      {lines.length > 0 && <Notice kind={waste ? "warn" : "info"}>Total nilai {waste ? "waste" : "barang masuk"}: <b>{fmtRp(total)}</b></Notice>}
      {err && <Notice kind="bad">{err}</Notice>}
      <Btn onClick={submit} disabled={!!busy || lines.length === 0}>
        {busy || `${waste ? "Simpan Waste" : "Simpan Barang Masuk"}${fotos.length ? ` · ${fotos.length} foto` : ""}`}
      </Btn>
    </div>
  );
}
