"use client";
// Kelola master bahan, resep produksi, daftar SO, dan cek lokasi barang (owner/admin, purchasing, gudang).

import { useMemo, useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { LOKASI, LOKASI_LABEL, TIPE_LABEL, searchItems, normSearch, rowFactor, fmtRp, fmtQty, isiDariKemasan } from "../../lib/inventoryLogic";
import { bacaKemasan, deleteItem, saveItem, saveRecipe, saveSoTemplate } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, Chips, Notice, SearchBox, ItemPicker, QtyInput, selectInput } from "./ui";

const MODES = ["Bahan", "Resep", "Daftar SO", "Cek Lokasi"];
const OUTLETS = ["KBU", "KSM", "SMT"];

const EMPTY_ITEM = { kode: "", nama: "", kategori: "", tipe: "bahan", satuan: "pcs", harga: "", lokasi: [], min_stok: "", aktif: true, catatan: "" };

// ── Foto kemasan → ukuran isi otomatis (AI murah di server; hasil tetap bisa diubah) ──

const KEMASAN_RE = /Kemasan:\s*([\d.,]+)\s*(ml|gr)\b/i;

/** Ukuran kemasan yang pernah dicatat di catatan bahan ("Kemasan: 760 ml"). */
function kemasanDariCatatan(catatan) {
  const m = KEMASAN_RE.exec(String(catatan || ""));
  if (!m) return null;
  const isi = Number(m[1].replace(",", "."));
  return isi > 0 ? { isi, satuan: m[2].toLowerCase() } : null;
}

function catatanDenganKemasan(catatan, hasil) {
  const teks = `Kemasan: ${fmtQty(hasil.isi, 3)} ${hasil.satuan}${hasil.merek ? ` (${hasil.merek})` : ""}`;
  const lama = String(catatan || "").replace(/Kemasan:[^;]*;?\s*/i, "").trim();
  return lama ? `${teks}; ${lama}` : teks;
}

function FotoKemasan({ bizId, onHasil }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  async function pilih(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setInfo(null);
    try {
      const h = await bacaKemasan(bizId, file);
      if (h.isi) {
        onHasil(h);
        setInfo({ kind: h.yakin === "rendah" ? "warn" : "ok", text: `Terbaca ${[h.merek, h.nama_produk].filter(Boolean).join(" ") || "kemasan"}: ${fmtQty(h.isi, 3)} ${h.satuan}${h.yakin === "rendah" ? " — kurang yakin, cek labelnya." : ". Cek lagi sebelum simpan."}` });
      } else {
        setInfo({ kind: "warn", text: `Ukuran tidak terbaca${h.catatan ? `: ${h.catatan}` : ""}. Foto lebih dekat ke tulisan netto/isi, atau isi manual.` });
      }
    } catch (err) {
      setInfo({ kind: "bad", text: err.message || String(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={pilih} />
      <Btn kind="ghost" onClick={() => ref.current?.click()} disabled={busy}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Camera size={18} /> {busy ? "Membaca foto…" : "Foto kemasan (isi ukuran otomatis)"}
        </span>
      </Btn>
      {info && <Notice kind={info.kind}>{info.text}</Notice>}
    </div>
  );
}

/** outlet: akun dapur outlet — hanya bahan yang lokasinya persis outlet itu yang bisa diubah (sama dengan RLS). */
function ItemEditor({ bizId, item, outlet = null, onDone, onCancel }) {
  const [f, setF] = useState({
    ...EMPTY_ITEM, ...(outlet && !item?.id ? { lokasi: [outlet] } : {}), ...item,
    harga: item?.harga ?? "", min_stok: item?.min_stok ?? "",
  });
  const bisaUbah = !outlet || !item?.id || (Array.isArray(item.lokasi) && item.lokasi.length === 1 && item.lokasi[0] === outlet);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dipakai, setDipakai] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true); setErr("");
    try { await saveItem(bizId, f); onDone(); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }
  async function hapus() {
    if (!window.confirm(`Hapus "${item.nama}" (${item.kode}) dari master bahan?\nBaris daftar SO untuk bahan ini ikut terhapus. Tidak bisa dibatalkan.`)) return;
    setBusy(true); setErr(""); setDipakai(false);
    try { await deleteItem(item.id); onDone(); } catch (e) {
      setErr(e.message || String(e));
      setDipakai(e.code === "DIPAKAI");
    } finally { setBusy(false); }
  }
  async function nonaktifkan() {
    setBusy(true); setErr("");
    try { await saveItem(bizId, { ...f, aktif: false }); onDone(); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>{item?.id ? (bisaUbah ? "Ubah bahan" : "Lihat bahan") : "Tambah bahan"}</div>
      {!bisaUbah && (
        <Notice kind="warn">Bahan ini dipakai juga di lokasi lain ({(item.lokasi || []).join(", ") || "semua"}), jadi hanya owner/purchasing yang bisa mengubahnya.</Notice>
      )}
      <fieldset disabled={!bisaUbah} style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 10, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <div><span style={label}>Kode</span><input style={input} value={f.kode} onChange={(e) => set("kode", e.target.value.toUpperCase())} /></div>
        <div><span style={label}>Nama baku</span><input style={input} value={f.nama} onChange={(e) => set("nama", e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><span style={label}>Kategori</span><input style={input} value={f.kategori || ""} onChange={(e) => set("kategori", e.target.value)} /></div>
        <div>
          <span style={label}>Tipe</span>
          <select style={selectInput} value={f.tipe} onChange={(e) => set("tipe", e.target.value)}>
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
      {outlet ? (
        <div style={{ fontSize: 13, color: C.sub }}>
          Lokasi: <b>{(f.lokasi || []).map((l) => LOKASI_LABEL[l] || l).join(", ") || "semua lokasi"}</b>{bisaUbah ? " (khusus outlet ini)" : ""}
        </div>
      ) : (
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
      )}
      {!outlet && <FotoKemasan bizId={bizId} onHasil={(h) => {
        setF((x) => ({
          ...x,
          nama: x.nama || [h.nama_produk, h.merek].filter(Boolean).join(" "),
          catatan: catatanDenganKemasan(x.catatan, h),
        }));
      }} />}
      <div>
        <span style={label}>Catatan</span>
        <input style={input} value={f.catatan || ""} onChange={(e) => set("catatan", e.target.value)} placeholder="mis. Kemasan: 760 ml (Marjan)" />
      </div>
      <div style={{ fontSize: 12, color: C.sub }}>
        Ukuran kemasan di catatan dipakai otomatis saat bahan ini ditambahkan ke daftar SO (mis. sirup dihitung ml, stok per botol).
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" checked={f.aktif !== false} onChange={(e) => set("aktif", e.target.checked)} /> Aktif
      </label>
      </fieldset>
      {err && <Notice kind="bad">{err}</Notice>}
      {dipakai && f.aktif !== false && <Btn kind="ghost" onClick={nonaktifkan} disabled={busy}>Nonaktifkan bahan ini</Btn>}
      {bisaUbah ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Btn kind="ghost" onClick={onCancel}>Batal</Btn>
          <Btn onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Btn>
        </div>
      ) : <Btn kind="ghost" onClick={onCancel}>Kembali</Btn>}
      {item?.id && bisaUbah && (
        <button type="button" onClick={hapus} disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", background: "transparent", color: C.bad, fontWeight: 700, fontSize: 14, padding: 8, cursor: "pointer" }}>
          <Trash2 size={16} /> Hapus bahan
        </button>
      )}
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

export default function KelolaBahan({ bizId, access, items, recipes, templates, onChanged }) {
  // Akun dapur outlet: hanya bahan & daftar SO outletnya (resep produksi & cek lokasi untuk owner/gudang).
  const outlet = access?.isOutlet ? access.outlet : null;
  const modes = outlet ? ["Bahan", "Daftar SO"] : MODES;
  const [mode, setMode] = useState("Bahan");
  const [q, setQ] = useState("");
  const [tipe, setTipe] = useState("all");
  const [editing, setEditing] = useState(null); // item | {} | recipe
  const byId = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);

  const list = useMemo(() => {
    let l = searchItems(items || [], q);
    if (outlet) l = l.filter((i) => !Array.isArray(i.lokasi) || !i.lokasi.length || i.lokasi.includes(outlet));
    if (tipe === "cek") l = l.filter((i) => /cek/i.test(i.catatan || "") || !(Number(i.harga) > 0));
    else if (tipe === "nonaktif") l = l.filter((i) => i.aktif === false);
    else if (tipe !== "all") l = l.filter((i) => i.tipe === tipe);
    return l;
  }, [items, q, tipe, outlet]);

  const done = () => { setEditing(null); onChanged?.(); };

  if (editing && mode === "Bahan") return <ItemEditor bizId={bizId} item={editing.id ? editing : null} outlet={outlet} onDone={done} onCancel={() => setEditing(null)} />;
  if (mode === "Daftar SO" || mode === "Cek Lokasi") {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <Chips options={modes} value={mode} onChange={(m) => { setEditing(null); setMode(m); }} />
        {mode === "Daftar SO"
          ? <DaftarSo bizId={bizId} outlet={outlet} items={items || []} templates={templates || []} onChanged={onChanged} />
          : <CekLokasi bizId={bizId} items={items || []} templates={templates || []} recipes={recipes || []} onChanged={onChanged} />}
      </div>
    );
  }
  if (editing && mode === "Resep") return <RecipeEditor bizId={bizId} recipe={editing.id ? editing : null} items={(items || []).filter((i) => i.aktif !== false)} onDone={done} onCancel={() => setEditing(null)} />;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Chips options={modes} value={mode} onChange={setMode} />
      {mode === "Bahan" ? (
        <>
          <Btn kind="ghost" onClick={() => setEditing({})}>+ Tambah bahan</Btn>
          <div style={{ ...card, display: "grid", gap: 8 }}>
            <SearchBox value={q} onChange={setQ} />
            <select style={selectInput} value={tipe} onChange={(e) => setTipe(e.target.value)}>
              <option value="all">Semua tipe</option>
              {Object.entries(TIPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              <option value="cek">Perlu dicek (harga 0 / catatan cek)</option>
              <option value="nonaktif">Nonaktif (mis. duplikat)</option>
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

// ── Daftar SO per outlet: nama & satuan staf + konversi ke satuan master ──

function TemplateEditor({ bizId, row, lokasi, outlet = null, items, templates, onDone, onCancel }) {
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const [f, setF] = useState({
    lokasi, label: "", grup: "", urut: "", satuan_so: "", isi: "", catatan: "", aktif: true,
    ...row, isi: row?.isi ?? "", urut: row?.urut ?? "",
  });
  const [item, setItem] = useState(row?.item_id ? byId[row.item_id] || null : null);
  const [balik, setBalik] = useState(() => {
    const n = Number(row?.isi);
    return n > 0 && n < 1 ? String(Math.round((1 / n) * 1000) / 1000) : "";
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [kemasanBaru, setKemasanBaru] = useState(null); // hasil foto → dicatat juga di master bahan
  const [samakan, setSamakan] = useState(true);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // Baris outlet lain untuk bahan & satuan hitung yang sama yang belum punya konversi.
  const saudara = useMemo(() => (templates || []).filter((t) =>
    item && t.item_id === item.id && t.id !== row?.id && (!outlet || (t.lokasi === outlet && (!t.area || t.area === "dapur"))) &&
    String(t.satuan_so || "").toLowerCase() === String(f.satuan_so || "").toLowerCase() &&
    rowFactor({ isi: t.isi, satuan_so: t.satuan_so, item }) === null
  ), [templates, item, row, f.satuan_so]);

  /** Ukuran kemasan (mis. 760 ml) → isi konversi baris ini. */
  function pakaiKemasan(ukuran, satuan, itm = item, satuanSo = f.satuan_so) {
    if (!itm) return false;
    let so = satuanSo;
    if (!so && !["ml", "gr"].includes(String(itm.satuan).toLowerCase())) so = satuan; // sirup master btl → staf hitung ml
    const isi = isiDariKemasan(ukuran, satuan, so, itm.satuan);
    if (isi === null) return false;
    setF((x) => ({ ...x, satuan_so: so, isi: String(isi) }));
    setBalik(isi < 1 ? String(ukuran) : "");
    return true;
  }

  function pilihItem(itm) {
    setItem(itm);
    const k = kemasanDariCatatan(itm?.catatan);
    if (k && (f.isi === "" || f.isi === null)) pakaiKemasan(k.isi, k.satuan, itm);
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      await saveSoTemplate(bizId, { ...f, item_id: item?.id });
      if (samakan && f.isi !== "" && f.isi !== null) {
        for (const t of saudara) await saveSoTemplate(bizId, { ...t, isi: f.isi });
      }
      if (kemasanBaru && item && !outlet) await saveItem(bizId, { ...item, catatan: catatanDenganKemasan(item.catatan, kemasanBaru) });
      onDone();
    } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>{row?.id ? "Ubah baris daftar SO" : "Tambah ke daftar SO"} · {LOKASI_LABEL[lokasi] || lokasi}</div>
      <div><span style={label}>Nama seperti ditulis staf</span><input style={input} value={f.label} onChange={(e) => set("label", e.target.value)} /></div>
      <div>
        <span style={label}>Bahan di master</span>
        {item ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 14 }}><b>{item.nama}</b> <span style={{ color: C.sub }}>({item.kode} · {item.satuan} · {fmtRp(item.harga)}/{item.satuan})</span></div>
            <button type="button" onClick={() => setItem(null)} style={{ border: "none", background: "transparent", color: C.brand, fontWeight: 700, cursor: "pointer" }}>Ganti</button>
          </div>
        ) : <ItemPicker items={items.filter((i) => i.aktif !== false)} onPick={pilihItem} />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><span style={label}>Grup</span><input style={input} value={f.grup || ""} onChange={(e) => set("grup", e.target.value)} placeholder="Dapur / Bar / Topping" /></div>
        <div><span style={label}>Urutan</span><input style={input} inputMode="numeric" value={f.urut} onChange={(e) => set("urut", e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><span style={label}>Satuan hitung staf</span><input style={input} value={f.satuan_so} onChange={(e) => set("satuan_so", e.target.value)} placeholder="porsi / karung / ml" /></div>
        <div>
          <span style={label}>1 {f.satuan_so || "satuan"} = … {item?.satuan || ""}</span>
          <input style={input} inputMode="decimal" value={f.isi} onChange={(e) => set("isi", e.target.value)} placeholder="kosong = belum tahu" />
        </div>
      </div>
      {item && f.satuan_so && (
        <div>
          <span style={label}>Atau isi kebalikannya: 1 {item.satuan} = … {f.satuan_so} (mis. 1 btl = 750 ml)</span>
          <input style={input} inputMode="decimal" value={balik} placeholder="ukuran kemasan"
            onChange={(e) => {
              setBalik(e.target.value);
              const n = Number(String(e.target.value).replace(",", "."));
              set("isi", n > 0 ? String(Math.round((1 / n) * 1e6) / 1e6) : "");
            }} />
        </div>
      )}
      {item && !outlet && (
        <FotoKemasan bizId={bizId} onHasil={(h) => {
          if (pakaiKemasan(h.isi, h.satuan)) setKemasanBaru(h);
          else setErr(`Ukuran ${fmtQty(h.isi, 3)} ${h.satuan} tidak cocok dengan satuan hitung "${f.satuan_so || "-"}" / master "${item.satuan}". Isi manual.`);
        }} />
      )}
      {item && saudara.length > 0 && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={samakan} onChange={(e) => setSamakan(e.target.checked)} />
          Pakai konversi ini juga di {saudara.map((t) => t.lokasi).filter((v, i, a) => a.indexOf(v) === i).join(", ")} (belum diatur)
        </label>
      )}
      <div style={{ fontSize: 12, color: C.sub }}>
        Contoh: Beras dihitung per <b>karung</b>, master dalam <b>kg</b> → isi 25. Sirup dihitung <b>ml</b>, master <b>btl</b> → isi = 1/volume botol (botol 750 ml → 0,001333).
        Kalau satuan sama atau kg↔gr / L↔ml, isi boleh dikosongkan. Selama konversi belum ada, SO tetap tersimpan tapi tidak masuk nilai stok.
      </div>
      <div>
        <span style={label}>Dihitung oleh</span>
        <select style={selectInput} value={f.area || ""} onChange={(e) => set("area", e.target.value || null)}>
          <option value="">Semua akun outlet ini</option>
          <option value="dapur">Akun Dapur</option>
          {!outlet && <option value="bar">Akun Kasir / Bar</option>}
        </select>
      </div>
      <div><span style={label}>Catatan</span><input style={input} value={f.catatan || ""} onChange={(e) => set("catatan", e.target.value)} /></div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" checked={f.aktif !== false} onChange={(e) => set("aktif", e.target.checked)} /> Aktif (tampil di form SO)
      </label>
      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel}>Batal</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Btn>
      </div>
    </div>
  );
}

function DaftarSo({ bizId, outlet = null, items, templates, onChanged }) {
  const [lokasi, setLokasi] = useState(outlet || "KBU");
  const [q, setQ] = useState("");
  const [onlyTodo, setOnlyTodo] = useState(false);
  const [editing, setEditing] = useState(null);
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const rows = useMemo(() => {
    const words = normSearch(q).split(" ").filter(Boolean);
    return templates
      .filter((t) => t.lokasi === lokasi && byId[t.item_id])
      .filter((t) => !outlet || !t.area || t.area === "dapur") // akun dapur: baris bar diatur kasir/owner
      .map((t) => ({ ...t, item: byId[t.item_id], factor: rowFactor({ isi: t.isi, satuan_so: t.satuan_so, item: byId[t.item_id] }) }))
      .filter((t) => !onlyTodo || t.factor === null)
      .filter((t) => !words.length || words.every((w) => normSearch(`${t.label} ${t.item.nama} ${t.grup || ""}`).includes(w)))
      .sort((a, b) => (a.urut || 0) - (b.urut || 0));
  }, [templates, lokasi, byId, q, onlyTodo, outlet]);
  const todo = templates.filter((t) => t.lokasi === lokasi && byId[t.item_id] && rowFactor({ isi: t.isi, satuan_so: t.satuan_so, item: byId[t.item_id] }) === null).length;

  if (editing) {
    const nextUrut = Math.max(0, ...templates.filter((t) => t.lokasi === lokasi).map((t) => t.urut || 0)) + 10;
    return <TemplateEditor bizId={bizId} lokasi={lokasi} outlet={outlet} items={items} templates={templates}
      row={editing.id ? editing : { urut: nextUrut, ...(outlet ? { area: "dapur" } : {}) }}
      onDone={() => { setEditing(null); onChanged?.(); }} onCancel={() => setEditing(null)} />;
  }

  return (
    <>
      {outlet
        ? <div style={{ fontWeight: 800 }}>Daftar SO {LOKASI_LABEL[outlet] || outlet} · bagian dapur</div>
        : <Chips options={LOKASI} value={lokasi} onChange={setLokasi} getLabel={(l) => LOKASI_LABEL[l] || l} />}
      <Notice kind={todo ? "warn" : "info"}>
        Daftar ini = urutan, nama, dan satuan yang dipakai staf saat SO (sama seperti laporan WA).
        {todo ? ` ${todo} baris belum punya konversi ke satuan master — nilainya belum masuk nilai stok.` : " Semua baris sudah punya konversi."}
      </Notice>
      <Btn kind="ghost" onClick={() => setEditing({})}>+ Tambah ke daftar SO</Btn>
      <div style={{ ...card, display: "grid", gap: 8 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Cari di daftar SO…" />
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.sub }}>
          <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} /> Hanya yang konversinya belum diatur
        </label>
      </div>
      <div style={{ ...card, padding: 0 }}>
        {rows.map((t) => (
          <button key={t.id} type="button" onClick={() => setEditing(t)}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: `1px solid ${C.line}`, background: t.aktif === false ? C.bg : "#fff", cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{t.label}{t.aktif === false ? " (nonaktif)" : ""}</span>
              <span style={{ fontSize: 12, color: C.sub }}>{t.grup}{t.area ? ` · ${t.area === "dapur" ? "Dapur" : "Bar"}` : ""}</span>
            </div>
            <div style={{ fontSize: 12, color: t.factor === null ? C.warn : C.sub }}>
              {t.item.nama} · hitung per {t.satuan_so} ·{" "}
              {t.factor === null ? `konversi ke ${t.item.satuan} belum diatur` : `1 ${t.satuan_so} = ${fmtQty(t.factor, 6)} ${t.item.satuan}`}
            </div>
            {t.catatan && <div style={{ fontSize: 12, color: C.warn }}>{t.catatan}</div>}
          </button>
        ))}
        {!rows.length && <div style={{ padding: 14, fontSize: 13, color: C.sub }}>Belum ada daftar SO untuk lokasi ini — form SO memakai semua bahan lokasi.</div>}
      </div>
    </>
  );
}

/**
 * Barang yang terdaftar di outlet (inv_items.lokasi) tapi tidak ada di daftar SO outlet itu — mis. bahan produksi
 * gudang (ceker, kulit dimsum) yang ikut tercatat di outlet. Staf outlet sudah tidak melihatnya; di sini owner/gudang
 * bisa merapikan master dengan menghapus outlet dari lokasi barang.
 */
function CekLokasi({ bizId, items, templates, recipes, onChanged }) {
  const [lok, setLok] = useState("KBU");
  const [tipe, setTipe] = useState("produksi");
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const bahanProduksi = useMemo(() => new Set((recipes || []).flatMap((r) => (r.lines || []).map((l) => l.item_id))), [recipes]);
  const diDaftar = useMemo(() => new Set((templates || []).filter((t) => t.lokasi === lok && t.aktif !== false).map((t) => t.item_id)), [templates, lok]);
  const list = useMemo(() => (items || [])
    .filter((i) => i.aktif !== false && Array.isArray(i.lokasi) && i.lokasi.includes(lok) && !diDaftar.has(i.id))
    .filter((i) => (tipe === "produksi" ? bahanProduksi.has(i.id) : tipe === "kemasan" ? ["kemasan", "lainnya"].includes(i.tipe) : !bahanProduksi.has(i.id) && !["kemasan", "lainnya"].includes(i.tipe)))
    .sort((a, b) => a.nama.localeCompare(b.nama)), [items, lok, tipe, diDaftar, bahanProduksi]);

  const lepas = async (it) => {
    setBusy(it.id); setErr("");
    try {
      await saveItem(bizId, { ...it, lokasi: it.lokasi.filter((l) => l !== lok) });
      await onChanged?.();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Notice>
        Barang yang tercatat ada di outlet tapi <b>tidak ada di daftar SO outlet</b>. Staf outlet sudah tidak melihatnya di SO/Waste.
        Kalau barang itu memang tidak dipakai di outlet (mis. bahan produksi gudang), tekan <b>Lepas dari {lok}</b>. Kalau dipakai, tambahkan ke Daftar SO.
      </Notice>
      <div style={{ ...card, display: "grid", gap: 8 }}>
        <Chips options={OUTLETS} value={lok} onChange={setLok} getLabel={(l) => LOKASI_LABEL[l] || l} />
        <Chips options={["produksi", "lain", "kemasan"]} value={tipe} onChange={setTipe}
          getLabel={(t) => ({ produksi: "Bahan produksi gudang", lain: "Bahan lain", kemasan: "Kemasan & kebersihan" })[t]} />
      </div>
      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ ...card, padding: 0 }}>
        <div style={{ padding: "12px 14px 6px", fontWeight: 800 }}>{list.length} barang</div>
        {list.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderTop: `1px solid ${C.line}`, opacity: busy === it.id ? 0.5 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{it.nama}</div>
              <div style={{ fontSize: 12, color: C.sub }}>{it.kode} · {it.satuan} · lokasi: {it.lokasi.join(", ")}</div>
            </div>
            <button type="button" disabled={!!busy} onClick={() => lepas(it)}
              style={{ flex: "0 0 auto", border: `1px solid ${C.line}`, background: "#fff", color: C.bad, borderRadius: 10, padding: "7px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              Lepas dari {lok}
            </button>
          </div>
        ))}
        {!list.length && <div style={{ padding: "4px 14px 14px", fontSize: 13, color: C.sub }}>Tidak ada. Lokasi barang di outlet ini sudah sesuai daftar SO.</div>}
      </div>
    </div>
  );
}
