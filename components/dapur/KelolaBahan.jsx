"use client";
// Kelola master bahan & resep produksi (owner/admin/purchasing).

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { LOKASI, TIPE_LABEL, searchItems, fmtRp, fmtQty } from "../../lib/inventoryLogic";
import { saveItem, saveRecipe } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, Chips, Notice, SearchBox, ItemPicker, QtyInput } from "./ui";

const EMPTY_ITEM = { kode: "", nama: "", kategori: "", tipe: "bahan", satuan: "pcs", harga: "", lokasi: [], min_stok: "", aktif: true, catatan: "" };

function ItemEditor({ bizId, item, onDone, onCancel }) {
  const [f, setF] = useState({ ...EMPTY_ITEM, ...item, harga: item?.harga ?? "", min_stok: item?.min_stok ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true); setErr("");
    try { await saveItem(bizId, f); onDone(); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>{item?.id ? "Ubah bahan" : "Tambah bahan"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <div><span style={label}>Kode</span><input style={input} value={f.kode} onChange={(e) => set("kode", e.target.value.toUpperCase())} /></div>
        <div><span style={label}>Nama baku</span><input style={input} value={f.nama} onChange={(e) => set("nama", e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><span style={label}>Kategori</span><input style={input} value={f.kategori || ""} onChange={(e) => set("kategori", e.target.value)} /></div>
        <div>
          <span style={label}>Tipe</span>
          <select style={input} value={f.tipe} onChange={(e) => set("tipe", e.target.value)}>
            {Object.entries(TIPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div><span style={label}>Satuan hitung</span><input style={input} value={f.satuan} onChange={(e) => set("satuan", e.target.value)} /></div>
        <div><span style={label}>Modal / satuan</span><input style={input} inputMode="decimal" value={f.harga} onChange={(e) => set("harga", e.target.value.replace(",", "."))} /></div>
        <div><span style={label}>Stok minimum</span><input style={input} inputMode="decimal" value={f.min_stok ?? ""} onChange={(e) => set("min_stok", e.target.value.replace(",", "."))} /></div>
      </div>
      <div style={{ fontSize: 12, color: C.sub }}>
        Satuan hitung = satuan yang dipakai saat SO (mis. pcs, gr, botol). Modal harus per satuan hitung yang sama.
        {f.tipe === "setengah_jadi" ? " Modal barang setengah jadi ter-update otomatis setiap produksi." : ""}
      </div>
      <div>
        <span style={label}>Dihitung di lokasi (kosong = semua)</span>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {LOKASI.map((l) => (
            <label key={l} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={f.lokasi.includes(l)}
                onChange={(e) => set("lokasi", e.target.checked ? [...f.lokasi, l] : f.lokasi.filter((x) => x !== l))} />
              {l}
            </label>
          ))}
        </div>
      </div>
      <div><span style={label}>Catatan</span><input style={input} value={f.catatan || ""} onChange={(e) => set("catatan", e.target.value)} /></div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" checked={f.aktif !== false} onChange={(e) => set("aktif", e.target.checked)} /> Aktif
      </label>
      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel}>Batal</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Btn>
      </div>
    </div>
  );
}

function RecipeEditor({ bizId, recipe, items, onDone, onCancel }) {
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const [nama, setNama] = useState(recipe?.nama || "");
  const [out, setOut] = useState(recipe ? byId[recipe.output_item_id] || null : null);
  const [hasil, setHasil] = useState(recipe ? String(recipe.hasil_qty) : "");
  const [lines, setLines] = useState((recipe?.lines || []).filter((l) => byId[l.item_id]).map((l) => ({ item: byId[l.item_id], qty: String(l.qty) })));
  const [aktif, setAktif] = useState(recipe?.aktif !== false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    try {
      await saveRecipe(bizId, {
        id: recipe?.id, nama, output_item_id: out?.id, hasil_qty: String(hasil).replace(",", "."), aktif,
        lines: lines.map((l) => ({ item_id: l.item.id, qty: String(l.qty).replace(",", ".") })),
      });
      onDone();
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>{recipe?.id ? "Ubah resep" : "Resep baru"}</div>
      <div><span style={label}>Nama resep</span><input style={input} value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Mis. Ungkep Ayam Reguler" /></div>
      <div>
        <span style={label}>Hasil (barang setengah jadi)</span>
        {out ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, fontWeight: 700 }}>{out.nama} <span style={{ color: C.sub, fontWeight: 400 }}>({out.satuan})</span></div>
            <button type="button" onClick={() => setOut(null)} style={{ border: "none", background: C.badSoft, borderRadius: 10, padding: 8, cursor: "pointer" }}><Trash2 size={16} color={C.bad} /></button>
          </div>
        ) : (
          <ItemPicker items={items.filter((i) => i.tipe === "setengah_jadi")} onPick={setOut} placeholder="Cari barang setengah jadi…" />
        )}
      </div>
      <div><span style={label}>Hasil per 1 batch {out ? `(${out.satuan})` : ""}</span><QtyInput value={hasil} onChange={setHasil} width="100%" /></div>
      <div>
        <span style={label}>Bahan per 1 batch</span>
        <div style={{ display: "grid", gap: 8 }}>
          {lines.map((l, i) => (
            <div key={l.item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ flex: 1, fontSize: 14 }}>{l.item.nama} <span style={{ color: C.sub }}>({l.item.satuan})</span></div>
              <QtyInput value={l.qty} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
              <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={{ border: "none", background: C.badSoft, borderRadius: 10, padding: 8, cursor: "pointer" }}><Trash2 size={16} color={C.bad} /></button>
            </div>
          ))}
          <ItemPicker items={items} excludeIds={[...lines.map((l) => l.item.id), out?.id].filter(Boolean)}
            placeholder="Tambah bahan resep…" onPick={(it) => setLines((ls) => [...ls, { item: it, qty: "" }])} />
        </div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} /> Aktif
      </label>
      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel}>Batal</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan resep"}</Btn>
      </div>
    </div>
  );
}

export default function KelolaBahan({ bizId, items, recipes, onChanged }) {
  const [mode, setMode] = useState("Bahan");
  const [q, setQ] = useState("");
  const [tipe, setTipe] = useState("all");
  const [editing, setEditing] = useState(null); // item | {} | recipe
  const byId = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);

  const list = useMemo(() => {
    let l = searchItems(items || [], q);
    if (tipe === "cek") l = l.filter((i) => /cek/i.test(i.catatan || "") || !(Number(i.harga) > 0));
    else if (tipe !== "all") l = l.filter((i) => i.tipe === tipe);
    return l;
  }, [items, q, tipe]);

  const done = () => { setEditing(null); onChanged?.(); };

  if (editing && mode === "Bahan") return <ItemEditor bizId={bizId} item={editing.id ? editing : null} onDone={done} onCancel={() => setEditing(null)} />;
  if (editing && mode === "Resep") return <RecipeEditor bizId={bizId} recipe={editing.id ? editing : null} items={(items || []).filter((i) => i.aktif !== false)} onDone={done} onCancel={() => setEditing(null)} />;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Chips options={["Bahan", "Resep"]} value={mode} onChange={setMode} />
      {mode === "Bahan" ? (
        <>
          <Btn kind="ghost" onClick={() => setEditing({})}>+ Tambah bahan</Btn>
          <div style={{ ...card, display: "grid", gap: 8 }}>
            <SearchBox value={q} onChange={setQ} />
            <select style={input} value={tipe} onChange={(e) => setTipe(e.target.value)}>
              <option value="all">Semua tipe</option>
              {Object.entries(TIPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              <option value="cek">Perlu dicek (harga 0 / catatan cek)</option>
            </select>
            <div style={{ fontSize: 12, color: C.sub }}>{list.length} bahan</div>
          </div>
          <div style={{ ...card, padding: 0 }}>
            {list.map((it) => (
              <button key={it.id} type="button" onClick={() => setEditing(it)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: `1px solid ${C.line}`, background: it.aktif === false ? C.bg : "#fff", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{it.nama}{it.aktif === false ? " (nonaktif)" : ""}</span>
                  <span style={{ fontSize: 13 }}>{fmtRp(it.harga)}/{it.satuan}</span>
                </div>
                <div style={{ fontSize: 12, color: C.sub }}>
                  {it.kode} · {TIPE_LABEL[it.tipe] || it.tipe} · {it.lokasi?.length ? it.lokasi.join(", ") : "semua lokasi"}
                  {it.min_stok ? ` · min ${fmtQty(it.min_stok)}` : ""}
                </div>
                {it.catatan && <div style={{ fontSize: 12, color: C.warn }}>{it.catatan}</div>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <Btn kind="ghost" onClick={() => setEditing({})}>+ Resep baru</Btn>
          <div style={{ ...card, padding: 0 }}>
            {(recipes || []).map((r) => (
              <button key={r.id} type="button" onClick={() => setEditing(r)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: `1px solid ${C.line}`, background: "#fff", cursor: "pointer" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.nama}{r.aktif === false ? " (nonaktif)" : ""}</div>
                <div style={{ fontSize: 12, color: C.sub }}>
                  Hasil {fmtQty(r.hasil_qty)} {byId[r.output_item_id]?.satuan} {byId[r.output_item_id]?.nama} · {(r.lines || []).length} bahan
                </div>
              </button>
            ))}
            {!(recipes || []).length && <div style={{ padding: 14, fontSize: 13, color: C.sub }}>Belum ada resep. Resep dipakai supaya produksi cukup isi jumlah batch.</div>}
          </div>
        </>
      )}
    </div>
  );
}
