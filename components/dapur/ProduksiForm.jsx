"use client";
// Produksi: bahan baku → barang setengah jadi. Modal per satuan hasil dihitung otomatis.

import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  parseQty, scaleRecipe, productionCost, makeClientRef, todayJakarta, formatProduksiWa, fmtRp, fmtQty, round2,
} from "../../lib/inventoryLogic";
import { submitEvent } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, WaButton, Notice, ItemPicker, QtyInput } from "./ui";

export default function ProduksiForm({ bizId, user, lokasi, items, recipes, snapshot, onSaved }) {
  const active = useMemo(() => (items || []).filter((i) => i.aktif !== false), [items]);
  const byId = useMemo(() => Object.fromEntries(active.map((i) => [i.id, i])), [active]);
  const activeRecipes = useMemo(() => (recipes || []).filter((r) => r.aktif !== false && byId[r.output_item_id]), [recipes, byId]);

  const [recipeId, setRecipeId] = useState("");
  const [batch, setBatch] = useState("1");
  const [hasilItem, setHasilItem] = useState(null);
  const [hasilQty, setHasilQty] = useState("");
  const [bahan, setBahan] = useState([]); // [{ item, qty }]
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const refId = useRef(makeClientRef("prod"));

  const recipe = activeRecipes.find((r) => r.id === recipeId) || null;

  function applyRecipe(r, b) {
    if (!r) return;
    const s = scaleRecipe(r, parseQty(b) || 0);
    setHasilItem(byId[r.output_item_id] || null);
    setHasilQty(String(s.hasil));
    setBahan(s.bahan.filter((l) => byId[l.item_id]).map((l) => ({ item: byId[l.item_id], qty: String(l.qty) })));
  }

  const cost = productionCost(
    bahan.map((b) => ({ qty: parseQty(b.qty) || 0, harga: b.item.harga })),
    parseQty(hasilQty) || 0
  );
  const zeroPrice = bahan.filter((b) => !(Number(b.item.harga) > 0)).map((b) => b.item.nama);

  async function submit() {
    setErr("");
    const hq = parseQty(hasilQty);
    if (!hasilItem) { setErr("Pilih barang hasil produksi."); return; }
    if (!(hq > 0)) { setErr("Isi jumlah hasil produksi."); return; }
    const bad = bahan.filter((b) => { const q = parseQty(b.qty); return q === null || Number.isNaN(q) || q <= 0; });
    if (!bahan.length) { setErr("Tambahkan bahan yang dipakai."); return; }
    if (bad.length) { setErr(`Isi jumlah bahan: ${bad.map((b) => b.item.nama).join(", ")}`); return; }
    if (bahan.some((b) => b.item.id === hasilItem.id)) { setErr("Barang hasil tidak boleh sekaligus jadi bahan."); return; }
    setBusy(true);
    try {
      const lines = [
        ...bahan.map((b) => ({ item_id: b.item.id, arah: "keluar", qty: parseQty(b.qty) })),
        { item_id: hasilItem.id, arah: "masuk", qty: hq },
      ];
      const res = await submitEvent(bizId, {
        client_ref: refId.current, jenis: "produksi", lokasi, tanggal, recipe_id: recipe?.id || null,
        catatan, created_by_name: user?.name,
      }, lines);
      const lastSo = (snapshot || []).find((r) => r.lokasi === lokasi && r.item_id === hasilItem.id);
      const perUnit = res?.unit_cost != null ? round2(res.unit_cost) : cost.perUnit;
      const text = formatProduksiWa({
        lokasi, tanggal, by: user?.name, resep: recipe?.nama,
        bahan: bahan.map((b) => ({ nama: b.item.nama, satuan: b.item.satuan, qty: parseQty(b.qty), nilai: parseQty(b.qty) * (Number(b.item.harga) || 0) })),
        hasil: { nama: hasilItem.nama, satuan: hasilItem.satuan, qty: hq },
        total: res?.total_nilai ?? cost.total, perUnit,
        stokHasil: lastSo ? round2(Number(lastSo.qty) + hq) : null,
        catatan,
      });
      setDone({ text, perUnit, duplicate: !!res?.duplicate, nama: hasilItem.nama, satuan: hasilItem.satuan });
      setRecipeId(""); setHasilItem(null); setHasilQty(""); setBahan([]); setCatatan(""); setBatch("1");
      refId.current = makeClientRef("prod");
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
          Produksi tersimpan{done.duplicate ? " (sudah pernah terkirim)" : ""}. Modal {done.nama} sekarang {fmtRp(done.perUnit)}/{done.satuan}.
        </Notice>
        <pre style={{ ...card, whiteSpace: "pre-wrap", fontSize: 13, margin: 0, fontFamily: "inherit" }}>{done.text}</pre>
        <WaButton text={done.text} />
        <Btn kind="ghost" onClick={() => setDone(null)}>Catat produksi lagi</Btn>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div>
          <span style={label}>Resep</span>
          <select value={recipeId} style={input}
            onChange={(e) => {
              const id = e.target.value;
              setRecipeId(id);
              const r = activeRecipes.find((x) => x.id === id);
              if (r) applyRecipe(r, batch); else { setHasilItem(null); setBahan([]); setHasilQty(""); }
            }}>
            <option value="">— Tanpa resep (isi manual) —</option>
            {activeRecipes.map((r) => <option key={r.id} value={r.id}>{r.nama}</option>)}
          </select>
          {activeRecipes.length === 0 && (
            <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>Belum ada resep. Admin/purchasing bisa membuat resep di menu Kelola.</div>
          )}
        </div>
        {recipe && (
          <div>
            <span style={label}>Jumlah batch (1 batch = {fmtQty(recipe.hasil_qty)} {byId[recipe.output_item_id]?.satuan})</span>
            <QtyInput value={batch} width="100%" onChange={(v) => { setBatch(v); applyRecipe(recipe, v); }} />
          </div>
        )}
        <div>
          <span style={label}>Tanggal</span>
          <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} style={input} />
        </div>
      </div>

      <div style={{ ...card, display: "grid", gap: 10 }}>
        <span style={label}>Hasil produksi</span>
        {hasilItem ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{hasilItem.nama}</div>
              <div style={{ fontSize: 12, color: C.sub }}>{hasilItem.satuan} · modal sekarang {fmtRp(hasilItem.harga)}</div>
            </div>
            <QtyInput value={hasilQty} onChange={setHasilQty} width={100} />
            {!recipe && (
              <button type="button" onClick={() => setHasilItem(null)} aria-label="Ganti hasil"
                style={{ border: "none", background: C.badSoft, borderRadius: 10, padding: 8, cursor: "pointer" }}>
                <Trash2 size={16} color={C.bad} />
              </button>
            )}
          </div>
        ) : (
          <ItemPicker items={active.filter((i) => i.tipe === "setengah_jadi")} placeholder="Cari barang setengah jadi…"
            onPick={(it) => setHasilItem(it)} />
        )}
        <div style={{ fontSize: 12, color: C.sub }}>Isi jumlah hasil aktual (setelah ditimbang/dihitung), bukan target.</div>
      </div>

      <div style={{ ...card, display: "grid", gap: 10 }}>
        <span style={label}>Bahan terpakai</span>
        {bahan.map((b, i) => (
          <div key={b.item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{b.item.nama}</div>
              <div style={{ fontSize: 12, color: C.sub }}>{b.item.satuan} · {fmtRp(b.item.harga)}/{b.item.satuan}</div>
            </div>
            <QtyInput value={b.qty} onChange={(v) => setBahan((bs) => bs.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
            <button type="button" onClick={() => setBahan((bs) => bs.filter((_, j) => j !== i))} aria-label="Hapus bahan"
              style={{ border: "none", background: C.badSoft, borderRadius: 10, padding: 8, cursor: "pointer" }}>
              <Trash2 size={16} color={C.bad} />
            </button>
          </div>
        ))}
        <ItemPicker items={active} excludeIds={[...bahan.map((b) => b.item.id), hasilItem?.id].filter(Boolean)}
          placeholder="Tambah bahan…" onPick={(it) => setBahan((bs) => [...bs, { item: it, qty: "" }])} />
      </div>

      <div style={card}>
        <span style={label}>Catatan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }} />
      </div>

      {bahan.length > 0 && (
        <Notice kind="info">
          Total modal bahan <b>{fmtRp(cost.total)}</b>
          {parseQty(hasilQty) > 0 && hasilItem ? <> · modal per {hasilItem.satuan} <b>{fmtRp(cost.perUnit)}</b></> : null}
        </Notice>
      )}
      {zeroPrice.length > 0 && <Notice kind="warn">Harga belum diisi untuk: {zeroPrice.join(", ")}. Modal hasil jadi terlalu murah.</Notice>}
      {err && <Notice kind="bad">{err}</Notice>}
      <Btn onClick={submit} disabled={busy}>{busy ? "Menyimpan…" : "Simpan Produksi"}</Btn>
    </div>
  );
}
