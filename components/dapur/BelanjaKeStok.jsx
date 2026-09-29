"use client";
// Belanja purchasing (Catat Belanja) → Barang Masuk stok. Nama di nota dicocokkan ke bahan master lewat padanan
// (diatur sekali, lalu otomatis). Barang yang belum dikenali ditandai supaya purchasing memasangkannya.
// Tanpa AI: pencocokan pakai aturan + padanan tersimpan (inv_purchase_map).

import { showActionToast, toastGagal } from "../../lib/actionToast";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LOKASI_LABEL, cocokkanBelanja, belanjaKey, lokasiBelanja, ringkasBelanja, hargaBeliTidakWajar,
  parseQty, fmtQty, fmtRp, todayJakarta,
} from "../../lib/inventoryLogic";
import { loadBelanjaUntukStok, loadPurchaseMaps, savePurchaseMap, submitEvent } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, Notice, ItemPicker, selectInput } from "./ui";

export default function BelanjaKeStok({ bizId, user, access, items, onSaved }) {
  const [list, setList] = useState(null);
  const [maps, setMaps] = useState([]);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const [done, setDone] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const reload = useCallback(async () => {
    setErr("");
    try {
      const [l, m] = await Promise.all([loadBelanjaUntukStok(bizId, { today: todayJakarta() }), loadPurchaseMaps(bizId)]);
      setList(l);
      setMaps(m);
    } catch (e) {
      setErr(e.message || String(e));
      setList([]);
    }
  }, [bizId]);
  useEffect(() => { reload(); }, [reload]);

  const rows = useMemo(() => (list || []).map((t) => ({ t, r: ringkasBelanja(t, maps, items) })), [list, maps, items]);
  const pending = rows.filter((x) => x.r.pending);
  const selesai = rows.filter((x) => !x.r.pending);

  if (open) {
    return (
      <Editor bizId={bizId} user={user} access={access} items={items} maps={maps} t={open}
        onCancel={() => setOpen(null)}
        onDone={(msg) => { showActionToast(msg, "success"); setOpen(null); setDone(msg); reload(); onSaved?.(); }} />
    );
  }

  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Dari catatan belanja (7 hari)</div>
      <div style={{ fontSize: 12, color: C.sub }}>
        Belanja yang dicatat purchasing masuk ke stok di sini. Nama barang dicocokkan ke bahan master; yang belum dikenali cukup dipasangkan sekali.
      </div>
      {done && <Notice kind="ok">{done}</Notice>}
      {err && <Notice kind="bad">{err}</Notice>}
      {list === null && <div style={{ fontSize: 13, color: C.sub }}>Memuat…</div>}
      {list && pending.length === 0 && <div style={{ fontSize: 13, color: C.sub }}>Semua belanja 7 hari terakhir sudah masuk stok. 👍</div>}
      {pending.map(({ t, r }) => (
        <button key={t.id} type="button" onClick={() => { setDone(null); setOpen(t); }}
          style={{ textAlign: "left", border: `1px solid ${r.perlu ? C.warn : C.line}`, borderRadius: 12, padding: "10px 12px", background: r.perlu ? C.warnSoft : "#fff", cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 14 }}>{t.supplier || t.desc || "Belanja"}</span>
            <span style={{ fontSize: 12, color: C.sub }}>{t.date}</span>
          </div>
          <div style={{ fontSize: 12, color: r.perlu ? C.warn : C.sub, marginTop: 2 }}>
            {r.stok} barang · {r.cocok} dikenali{r.perlu ? ` · ⚠️ ${r.perlu} belum dikenali` : ""}{r.abaikan ? ` · ${r.abaikan} bukan stok` : ""}
            {t.meta?.createdByName ? ` · ${t.meta.createdByName}` : ""}
          </div>
          <div style={{ fontSize: 12, color: C.brand, fontWeight: 800, marginTop: 4 }}>{r.perlu ? "Pasangkan & masukkan ke stok →" : "Masukkan ke stok →"}</div>
        </button>
      ))}
      {selesai.length > 0 && (
        <button type="button" onClick={() => setShowDone(!showDone)}
          style={{ border: "none", background: "none", padding: 0, color: C.sub, fontSize: 12, textAlign: "left", cursor: "pointer" }}>
          {showDone ? "Sembunyikan" : "Lihat"} {selesai.length} belanja yang sudah masuk / bukan stok
        </button>
      )}
      {showDone && selesai.map(({ t, r }) => (
        <div key={t.id} style={{ fontSize: 12, color: C.sub, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
          ✓ {t.date} · {t.supplier || t.desc || "Belanja"} · {t.masuk ? `masuk ${LOKASI_LABEL[t.masuk.lokasi] || t.masuk.lokasi}` : "bukan barang stok"}{r.stok ? ` · ${r.stok} barang` : ""}
        </div>
      ))}
    </div>
  );
}

function Editor({ bizId, user, access, items, maps, t, onCancel, onDone }) {
  const lokasiOptions = access?.lokasiOptions ? access.lokasiOptions("masuk") : ["GDG"];
  const def = lokasiBelanja(t.outlet);
  const [lokasi, setLokasi] = useState(lokasiOptions.includes(def) ? def : lokasiOptions[0]);
  const aktif = useMemo(() => (items || []).filter((i) => i.aktif !== false), [items]);
  const byId = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  const [rows, setRows] = useState(() => (t.meta?.items || []).filter((i) => String(i?.name || "").trim()).map((line, idx) => {
    const m = cocokkanBelanja(line, maps, items);
    return {
      idx, line, m,
      itemId: m.item?.id || null,
      isi: m.isi ? String(m.isi).replace(".", ",") : "",
      abaikan: m.status === "abaikan",
      ubah: false,
    };
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (idx, patch) => setRows((rs) => rs.map((r) => (r.idx === idx ? { ...r, ...patch } : r)));

  const calc = (r) => {
    const it = r.itemId ? byId[r.itemId] : null;
    const isi = parseQty(r.isi);
    const ok = !r.abaikan && it && isi > 0;
    const q = Number(r.line.qty) || 0;
    const p = Number(r.line.unitPrice) || 0;
    return { it, isi, ok, qty: ok ? q * isi : null, harga: ok && p > 0 ? p / isi : null };
  };

  async function simpan() {
    setErr("");
    const kurang = rows.filter((r) => !r.abaikan && !calc(r).ok);
    if (kurang.length) { setErr(`Pasangkan bahan & isi untuk: ${kurang.map((r) => r.line.name).join(", ")} — atau tandai "bukan barang stok".`); return; }
    const stok = rows.filter((r) => !r.abaikan).map((r) => ({ r, c: calc(r) })).filter((x) => x.c.qty > 0);
    const hargaAneh = stok.filter(({ c }) => c.harga > 0 && hargaBeliTidakWajar(c.it.harga, c.harga));
    if (hargaAneh.length && !window.confirm(
      `Cek lagi konversi harga ini:\n${hargaAneh.map(({ c }) => `• ${c.it.nama}: ${fmtRp(c.it.harga)} → ${fmtRp(c.harga)}/${c.it.satuan}`).join("\n")}\n\nBiasanya ini terjadi karena isi dus/botol/kg salah. Sudah benar?`
    )) return;
    setBusy(true);
    try {
      // 1) Simpan padanan yang baru dipasang / diubah (sekali saja, berikutnya otomatis).
      for (const r of rows) {
        const baru = r.abaikan !== (r.m.status === "abaikan") || r.ubah || r.m.status === "belum" || r.m.status === "perlu_isi" || r.m.sumber === "nama";
        if (!baru) continue;
        const k = belanjaKey(r.line.name, r.line.unit);
        await savePurchaseMap(bizId, {
          nama_norm: k.nama_norm, satuan_norm: r.abaikan ? "" : k.satuan_norm, contoh: r.line.name, by: user?.name,
          abaikan: r.abaikan, item_id: r.abaikan ? null : r.itemId, isi: r.abaikan ? null : parseQty(r.isi),
        });
      }
      if (stok.length) {
        // 2) Barang masuk + harga beli aktual + pembaruan modal disimpan atomik di database.
        // Satu request ini menggantikan update harga satu-per-satu setelah event tersimpan.
        await submitEvent(bizId, {
          client_ref: `belanja:${t.id}`, jenis: "masuk", sumber: "pembelian", lokasi, tanggal: t.date,
          catatan: `Dari belanja ${t.supplier || ""}${t.meta?.createdByName ? ` (${t.meta.createdByName})` : ""}`.trim(),
          created_by_name: user?.name,
        }, stok.map(({ r, c }) => ({
          item_id: c.it.id, qty: Math.round(c.qty * 10000) / 10000, satuan: c.it.satuan,
          qty_input: Number(r.line.qty) || 0, satuan_input: r.line.unit || null, label: r.line.name,
          unit_cost: c.harga > 0 ? Math.round(c.harga * 10000) / 10000 : null,
          update_item_cost: true,
        })));
        const adaHarga = stok.some(({ c }) => c.harga > 0);
        onDone(`${stok.length} barang masuk ke stok ${LOKASI_LABEL[lokasi] || lokasi}${adaHarga ? " · harga beli tersimpan · HPP rata-rata diperbarui" : ""}.`);
        return;
      }
      onDone("Belanja ditandai bukan barang stok.");
    } catch (e) {
      setErr(toastGagal(e, "Gagal masukkan ke stok"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 800 }}>{t.supplier || t.desc || "Belanja"} · {t.date}</div>
        <div style={{ fontSize: 12, color: C.sub }}>
          Total {fmtRp(t.amount)}{t.meta?.createdByName ? ` · dicatat ${t.meta.createdByName}` : ""}
        </div>
        <div>
          <span style={label}>Masuk ke stok</span>
          <select style={selectInput} value={lokasi} onChange={(e) => setLokasi(e.target.value)} disabled={lokasiOptions.length < 2}>
            {lokasiOptions.map((l) => <option key={l} value={l}>{LOKASI_LABEL[l] || l}</option>)}
          </select>
        </div>
      </div>

      {rows.map((r) => {
        const c = calc(r);
        const kenal = r.m.status === "cocok" && !r.ubah;
        return (
          <div key={r.idx} style={{ ...card, display: "grid", gap: 8, borderColor: r.abaikan ? C.line : c.ok ? C.line : C.warn }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>{r.line.name}</span>
              <span style={{ fontSize: 12, color: C.sub, whiteSpace: "nowrap" }}>{fmtQty(r.line.qty)} {r.line.unit} · {fmtRp(r.line.unitPrice)}</span>
            </div>
            {r.abaikan ? (
              <div style={{ fontSize: 12, color: C.sub }}>
                Bukan barang stok (ongkir, alat, sabun, dll.) — tidak dimasukkan.{" "}
                <button type="button" onClick={() => set(r.idx, { abaikan: false })} style={linkBtn}>Batal</button>
              </div>
            ) : kenal ? (
              <div style={{ fontSize: 13 }}>
                → <b>{c.it?.nama}</b> · masuk <b>{fmtQty(c.qty)} {c.it?.satuan}</b>
                {c.harga ? <span style={{ color: C.sub }}> · modal {fmtRp(c.harga)}/{c.it?.satuan}</span> : null}
                {" "}<button type="button" onClick={() => set(r.idx, { ubah: true })} style={linkBtn}>Ubah</button>
              </div>
            ) : (
              <>
                {r.m.status === "belum" && !r.itemId && <Notice kind="warn">Belum dikenali — pilih bahan master yang sama (sekali saja, berikutnya otomatis).</Notice>}
                {c.it ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span>→ <b>{c.it.nama}</b> <span style={{ color: C.sub }}>({c.it.satuan})</span></span>
                    <button type="button" onClick={() => set(r.idx, { itemId: null })} style={linkBtn}>Ganti</button>
                  </div>
                ) : (
                  <>
                    {r.m.saran && (
                      <button type="button" onClick={() => set(r.idx, { itemId: r.m.saran.id })}
                        style={{ ...linkBtn, textAlign: "left" }}>Pakai saran: {r.m.saran.nama} ({r.m.saran.satuan})</button>
                    )}
                    <ItemPicker items={aktif} onPick={(it) => set(r.idx, { itemId: it.id, isi: r.isi || "" })} placeholder="Cari bahan master…" />
                  </>
                )}
                {c.it && (
                  <div>
                    <span style={label}>1 {r.line.unit || "satuan"} = … {c.it.satuan}</span>
                    <input style={input} inputMode="decimal" value={r.isi} onChange={(e) => set(r.idx, { isi: e.target.value })}
                      placeholder={`mis. 1 dus = 12 ${c.it.satuan}`} />
                    {c.ok && <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Masuk {fmtQty(c.qty)} {c.it.satuan}{c.harga ? ` · modal ${fmtRp(c.harga)}/${c.it.satuan}` : ""}</div>}
                  </div>
                )}
                <button type="button" onClick={() => set(r.idx, { abaikan: true })} style={{ ...linkBtn, color: C.sub, textAlign: "left" }}>Bukan barang stok</button>
              </>
            )}
            {!r.abaikan && c.ok && c.harga > 0 && (
              <div style={{ fontSize: 12, color: C.sub }}>
                Harga nota otomatis masuk perhitungan rata-rata HPP 5 pembelian terakhir.
              </div>
            )}
          </div>
        );
      })}

      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel}>Batal</Btn>
        <Btn onClick={simpan} disabled={busy}>{busy ? "Menyimpan…" : `Masukkan ke stok ${LOKASI_LABEL[lokasi] || lokasi}`}</Btn>
      </div>
    </div>
  );
}

const linkBtn = { border: "none", background: "none", padding: 0, color: C.brand, fontWeight: 800, fontSize: 12, cursor: "pointer" };
