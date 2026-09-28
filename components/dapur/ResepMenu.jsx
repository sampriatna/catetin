"use client";
// Resep menu (BOM): bahan per 1 porsi menu yang dijual. Dipakai untuk menghitung
// pemakaian bahan dari data penjualan POS (teori) lalu dibandingkan dengan SO (aktual).

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  LOKASI_LABEL, OUTLET_JUAL, menuCost, normSearch, parseQty, toItemQty, unitOptions, itemsForLokasi, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import { saveMenu, saveMenuAlias } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, Chips, ItemPicker, Notice, SearchBox, unitLabel } from "./ui";

/** Baris konversi satuan untuk bahan: pakai daftar SO (satuan staf + isi) bila ada. */
function unitRow(item, templates, lokasi) {
  const t = (templates || []).find((x) => x.item_id === item.id && x.lokasi === lokasi && x.isi)
    || (templates || []).find((x) => x.item_id === item.id && x.isi);
  return { item, satuan_so: t?.satuan_so || item.satuan, isi: t?.isi ?? null };
}

export default function ResepMenu({ bizId, items, templates, menus, prefill, onPrefillUsed, onChanged }) {
  const [lok, setLok] = useState("KBU");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const itemsById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);

  // Dari tab Penjualan: "Buat resep" untuk nama POS yang belum punya resep.
  useEffect(() => {
    if (!prefill) return;
    setEdit({ lokasi: prefill.lokasi, nama: prefill.nama, harga_jual: prefill.harga_jual || "", lines: [], aliasId: prefill.aliasId });
    setLok(prefill.lokasi);
    onPrefillUsed?.();
  }, [prefill, onPrefillUsed]);

  const list = useMemo(() => {
    const w = normSearch(q);
    return (menus || []).filter((m) => m.lokasi === lok && (!w || normSearch(m.nama).includes(w)));
  }, [menus, lok, q]);

  if (edit) {
    return <MenuEditor bizId={bizId} menu={edit} items={items} itemsById={itemsById} templates={templates}
      onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged?.(); }} />;
  }

  const kosong = list.filter((m) => !m.lines.length).length;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Notice>
        Isi bahan untuk <b>1 porsi</b> setiap menu. Setelah penjualan POS di-upload, sistem menghitung bahan yang seharusnya terpakai
        lalu membandingkannya dengan hasil SO.
      </Notice>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <Chips options={OUTLET_JUAL} value={lok} onChange={setLok} getLabel={(l) => LOKASI_LABEL[l]} />
        <SearchBox value={q} onChange={setQ} placeholder="Cari menu…" />
        <Btn kind="ghost" onClick={() => setEdit({ lokasi: lok, nama: "", harga_jual: "", lines: [] })}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={16} /> Menu baru</span>
        </Btn>
      </div>
      <div style={{ ...card, padding: 0 }}>
        <div style={{ padding: "12px 14px 6px", fontWeight: 800 }}>
          {list.length} menu{kosong ? <span style={{ color: C.warn, fontWeight: 700, fontSize: 12 }}> · {kosong} belum ada bahan</span> : null}
        </div>
        {list.map((m) => {
          const c = menuCost(m, itemsById);
          return (
            <button key={m.id} type="button" onClick={() => setEdit({ ...m, lines: m.lines.map((l) => ({ ...l })) })}
              style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderTop: `1px solid ${C.line}`, background: "#fff", cursor: "pointer" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: m.aktif === false ? C.sub : C.ink }}>{m.nama}{m.aktif === false ? " (nonaktif)" : ""}</div>
                <div style={{ fontSize: 12, color: m.lines.length ? C.sub : C.warn }}>
                  {m.lines.length ? `${m.lines.length} bahan · modal ${fmtRp(c.hpp)}${c.missing ? ` · ${c.missing} bahan belum ada harga` : ""}` : "Belum ada bahan"}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12 }}>
                {m.harga_jual ? <div style={{ fontWeight: 800 }}>{fmtRp(m.harga_jual)}</div> : null}
                {c.foodCost !== null && m.lines.length ? (
                  <div style={{ color: c.foodCost > 40 ? C.bad : c.foodCost > 32 ? C.warn : C.ok, fontWeight: 700 }}>FC {fmtQty(c.foodCost, 1)}%</div>
                ) : null}
              </div>
            </button>
          );
        })}
        {!list.length && <div style={{ padding: "4px 14px 14px", fontSize: 13, color: C.sub }}>Belum ada menu di outlet ini.</div>}
      </div>
    </div>
  );
}

function MenuEditor({ bizId, menu, items, itemsById, templates, onCancel, onSaved }) {
  const [m, setM] = useState({ ...menu });
  const [lines, setLines] = useState(() => (menu.lines || []).map((l, i) => {
    const item = itemsById[l.item_id];
    const row = item ? unitRow(item, templates, menu.lokasi) : null;
    const unit = l.satuan_input || item?.satuan;
    return { key: `${l.item_id}-${i}`, row, unit, qty: String(l.qty_input ?? l.qty) };
  }).filter((l) => l.row));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Bahan outlet + bahan gudang (mis. bumbu yang dikirim dari gudang), tanpa dobel.
  const pickable = useMemo(() => {
    const seen = new Set();
    return itemsForLokasi(items, m.lokasi).concat(itemsForLokasi(items, "GDG")).filter((i) => !seen.has(i.id) && seen.add(i.id));
  }, [items, m.lokasi]);
  const calc = (l) => {
    const qv = parseQty(l.qty);
    if (qv === null || Number.isNaN(qv) || qv <= 0) return null;
    return toItemQty(l.row, qv, l.unit);
  };
  const cost = menuCost({ harga_jual: m.harga_jual, lines: lines.map((l) => { const c = calc(l); return c?.converted ? { item_id: l.row.item.id, qty: c.qty } : null; }).filter(Boolean) }, itemsById);
  const bad = lines.filter((l) => { const c = calc(l); return !c || !c.converted; });

  const save = async () => {
    setErr("");
    if (bad.length) { setErr(`Periksa jumlah/satuan: ${bad.map((l) => l.row.item.nama).join(", ")}`); return; }
    setBusy(true);
    try {
      const saved = await saveMenu(bizId, {
        ...m,
        lines: lines.map((l) => { const c = calc(l); return { item_id: l.row.item.id, qty: c.qty, qty_input: parseQty(l.qty), satuan_input: l.unit }; }),
      });
      // Dibuat dari nama POS yang belum punya resep → langsung dihubungkan.
      if (menu.aliasId) await saveMenuAlias(menu.aliasId, { menu_id: saved.id });
      onSaved();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>{m.id ? "Ubah resep menu" : "Menu baru"} · {LOKASI_LABEL[m.lokasi]}</div>
        {!m.id && <Chips options={OUTLET_JUAL} value={m.lokasi} onChange={(v) => setM({ ...m, lokasi: v })} />}
        <div>
          <span style={label}>Nama menu (sama seperti di POS lebih mudah)</span>
          <input value={m.nama} onChange={(e) => setM({ ...m, nama: e.target.value })} style={input} placeholder="Ramen Atomic" />
        </div>
        <div>
          <span style={label}>Harga jual (opsional, untuk food cost %)</span>
          <input inputMode="numeric" value={m.harga_jual ?? ""} onChange={(e) => setM({ ...m, harga_jual: e.target.value.replace(/[^\d]/g, "") })} style={input} placeholder="35000" />
        </div>
      </div>

      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Bahan untuk 1 porsi</div>
        {lines.map((l, i) => {
          const c = calc(l);
          const opts = unitOptions(l.row);
          return (
            <div key={l.key} style={{ borderTop: i ? `1px solid ${C.line}` : "none", paddingTop: i ? 10 : 0, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{l.row.item.nama}</span>
                <button type="button" aria-label="Hapus bahan" onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  style={{ border: "none", background: "none", cursor: "pointer", padding: 4 }}><Trash2 size={16} color={C.bad} /></button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  style={{ ...input, width: 90, textAlign: "right", padding: "9px 10px" }} placeholder="0" />
                {opts.map((u) => (
                  <button key={u} type="button" onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, unit: u } : x)))}
                    style={{ padding: "7px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: "pointer",
                      border: `1px solid ${u === l.unit ? C.brand : C.line}`, background: u === l.unit ? C.brand : "#fff", color: u === l.unit ? "#fff" : C.ink }}>
                    {unitLabel(u)}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: c && !c.converted ? C.warn : C.sub }}>
                {!c ? "Isi jumlah" : c.converted
                  ? `= ${fmtQty(c.qty, 5)} ${unitLabel(l.row.item.satuan)} · ${fmtRp(c.qty * (Number(l.row.item.harga) || 0))}`
                  : `Satuan ${unitLabel(l.unit)} belum bisa diubah ke ${unitLabel(l.row.item.satuan)} — isi "isi per satuan" di daftar SO, atau pakai satuan ${unitLabel(l.row.item.satuan)}.`}
              </div>
            </div>
          );
        })}
        <ItemPicker items={pickable} excludeIds={lines.map((l) => l.row.item.id)} placeholder="Tambah bahan…"
          onPick={(it) => setLines([...lines, { key: `${it.id}-${Date.now()}`, row: unitRow(it, templates, m.lokasi), unit: it.satuan, qty: "" }])} />
      </div>

      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12, color: C.sub }}>Modal per porsi</div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{fmtRp(cost.hpp)}</div>
        </div>
        {cost.foodCost !== null && <div style={{ fontWeight: 800, color: cost.foodCost > 40 ? C.bad : cost.foodCost > 32 ? C.warn : C.ok }}>Food cost {fmtQty(cost.foodCost, 1)}%</div>}
      </div>

      {err && <Notice kind="bad">{err}</Notice>}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" checked={m.aktif !== false} onChange={(e) => setM({ ...m, aktif: e.target.checked })} /> Menu masih dijual
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel} style={{ flex: 1 }}>Batal</Btn>
        <Btn onClick={save} disabled={busy || !m.nama.trim()} style={{ flex: 2 }}>{busy ? "Menyimpan…" : "Simpan resep"}</Btn>
      </div>
    </div>
  );
}
