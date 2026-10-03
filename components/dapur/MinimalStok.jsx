"use client";
// Minimal stok per lokasi × bahan. Satu SKU, minimum berbeda di tiap outlet/gudang (tabel inv_min_stock).
// Lokasi tanpa pengaturan = "belum diatur" — tidak mengambil nilai lokasi lain.

import { useMemo, useState } from "react";
import {
  LOKASI_LABEL, itemsForLokasi, stockRowsFor, stockStatus, minStokInfo, minStokAt, kekuranganStok, normSearch, fmtQty,
} from "../../lib/inventoryLogic";
import { saveMinStock } from "../../lib/inventoryRepo";
import { C, card, Btn, Chips, Notice, QtyInput, SearchBox, StatusBadge, unitLabel } from "./ui";

const FILTERS = ["Semua", "Perlu restock", "Belum diatur", "Cek nilai lama"];
const ORDER = { habis: 0, menipis: 1, belum: 2, aman: 3 };

export default function MinimalStok({ bizId, user, access, items, templates, snapshot, running, minMap, onChanged }) {
  const lokasiList = access.lihatLokasi?.length ? access.lihatLokasi : [];
  const [lokasi, setLokasi] = useState(() => (access.minStokLokasi?.[0] && lokasiList.includes(access.minStokLokasi[0]) ? access.minStokLokasi[0] : lokasiList[0]));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("Semua");
  const [draft, setDraft] = useState({}); // item_id → teks input (hanya yang diubah)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const canEdit = (access.minStokLokasi || []).includes(lokasi);

  const stokByItem = useMemo(() => {
    const out = {};
    for (const r of stockRowsFor(running, snapshot)) if (r.lokasi === lokasi) out[r.item_id] = Number(r.qty);
    return out;
  }, [running, snapshot, lokasi]);

  // Bahan yang dipakai di lokasi ini: terdaftar di lokasi, ada di daftar SO lokasi, punya stok, atau sudah punya minimum.
  const rows = useMemo(() => {
    const ids = new Set(itemsForLokasi(items, lokasi).map((i) => i.id));
    for (const t of templates || []) if (t.lokasi === lokasi && t.aktif !== false) ids.add(t.item_id);
    for (const id of Object.keys(stokByItem)) ids.add(id);
    for (const k of Object.keys(minMap || {})) if (k.startsWith(`${lokasi}|`)) ids.add(k.slice(lokasi.length + 1));
    return (items || [])
      .filter((it) => ids.has(it.id) && it.aktif !== false)
      .map((it) => {
        const info = minStokInfo(minMap, lokasi, it);
        const min = minStokAt(minMap, lokasi, it);
        const qty = it.id in stokByItem ? stokByItem[it.id] : null;
        const st = min === null ? (qty !== null && qty <= 0 ? "habis" : "belum") : stockStatus(qty, min) || (qty === null ? "belum" : "aman");
        return { it, info, min, qty, st, kurang: kekuranganStok(qty, min), unitBeda: !!info && min === null };
      })
      .sort((a, b) => (ORDER[a.st] ?? 9) - (ORDER[b.st] ?? 9) || a.it.nama.localeCompare(b.it.nama));
  }, [items, templates, stokByItem, minMap, lokasi]);

  const visible = useMemo(() => {
    const words = normSearch(q).split(" ").filter(Boolean);
    return rows.filter((r) => {
      if (words.length && !words.every((w) => normSearch(`${r.it.nama} ${r.it.kode}`).includes(w))) return false;
      if (filter === "Perlu restock") return r.st === "habis" || r.st === "menipis";
      if (filter === "Belum diatur") return r.min === null;
      if (filter === "Cek nilai lama") return r.info?.sumber === "migrasi_global";
      return true;
    });
  }, [rows, q, filter]);

  const dirty = Object.keys(draft);
  const counts = {
    belum: rows.filter((r) => r.min === null).length,
    restock: rows.filter((r) => r.st === "habis" || r.st === "menipis").length,
    lama: rows.filter((r) => r.info?.sumber === "migrasi_global").length,
  };

  function pindahLokasi(l) {
    if (dirty.length && !window.confirm("Perubahan minimal stok belum disimpan. Pindah lokasi dan buang perubahan?")) return;
    setDraft({}); setMsg(null); setLokasi(l);
  }

  async function simpan(itemIds = dirty) {
    if (!itemIds.length) return;
    setBusy(true); setMsg(null);
    let ok = 0;
    const gagal = [];
    const gagalIds = new Set();
    for (const id of itemIds) {
      const it = (items || []).find((x) => x.id === id);
      const r = rows.find((x) => x.it.id === id);
      const val = id in draft ? draft[id] : r?.min;
      try {
        await saveMinStock(bizId, { lokasi, item: it, min: String(val ?? "").trim() === "" ? null : val, byName: user?.name || null });
        ok++;
      } catch (e) {
        gagal.push(`${it?.nama}: ${e.message || e}`);
        gagalIds.add(id);
      }
    }
    setDraft((d) => { const n = { ...d }; for (const id of itemIds) if (!gagalIds.has(id)) delete n[id]; return n; });
    setBusy(false);
    setMsg(gagal.length ? { kind: "bad", text: `${ok} tersimpan, ${gagal.length} gagal: ${gagal.join("; ")}` } : { kind: "ok", text: `${ok} minimal stok ${LOKASI_LABEL[lokasi] || lokasi} tersimpan.` });
    onChanged?.();
  }

  if (!lokasi) return <Notice kind="warn">Tidak ada lokasi yang bisa dilihat.</Notice>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Minimal stok per lokasi</div>
        <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>
          Satu bahan bisa punya minimum berbeda di tiap outlet. Lokasi yang belum diatur tidak memakai angka lokasi lain.
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginTop: 10 }}>
          {lokasiList.map((l) => (
            <button key={l} type="button" onClick={() => pindahLokasi(l)}
              style={{ flex: "0 0 auto", padding: "8px 12px", borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: "pointer",
                border: `1px solid ${l === lokasi ? C.brand : C.line}`, background: l === lokasi ? C.brand : "#fff", color: l === lokasi ? "#fff" : C.ink }}>
              {LOKASI_LABEL[l] || l}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>
          {rows.length} bahan · {counts.restock} perlu restock · {counts.belum} belum diatur
          {counts.lama ? ` · ${counts.lama} dari minimum lama (cek ulang)` : ""}
          {!canEdit && " · hanya lihat"}
        </div>
      </div>

      {counts.lama > 0 && canEdit && (
        <Notice kind="warn">
          {counts.lama} minimum di {LOKASI_LABEL[lokasi] || lokasi} disalin dari minimum lama (dulu satu angka untuk semua outlet).
          Cek dan sesuaikan untuk lokasi ini, lalu Simpan.
        </Notice>
      )}

      <SearchBox value={q} onChange={setQ} />
      <Chips options={FILTERS} value={filter} onChange={setFilter} />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <div style={{ ...card, padding: 0 }}>
        {visible.map(({ it, info, min, qty, st, kurang, unitBeda }) => {
          const val = it.id in draft ? draft[it.id] : (min ?? "");
          return (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {it.nama} <StatusBadge status={st === "habis" || st === "menipis" ? st : null} />
                  {st === "aman" && <span style={{ background: C.okSoft, color: C.ok, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>Aman</span>}
                  {info?.sumber === "migrasi_global" && <span style={{ background: C.warnSoft, color: C.warn, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>Nilai lama</span>}
                </div>
                <div style={{ fontSize: 12, color: C.sub }}>
                  Stok: {qty === null ? "belum pernah SO" : `${fmtQty(qty)} ${unitLabel(it.satuan)}`}
                  {" · "}
                  {min === null
                    ? <span style={{ color: C.warn, fontWeight: 700 }}>{unitBeda ? `Minimal stok perlu diatur ulang (tersimpan ${fmtQty(info.min)} ${info.unit}, satuan sekarang ${it.satuan})` : "Minimal stok belum diatur"}</span>
                    : `Minimal: ${fmtQty(min)} ${unitLabel(it.satuan)}`}
                  {kurang ? <span style={{ color: C.bad, fontWeight: 700 }}>{` · kurang ${fmtQty(kurang)} ${unitLabel(it.satuan)}`}</span> : ""}
                </div>
              </div>
              {canEdit && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}>
                  <QtyInput value={val} placeholder="—" width={76}
                    onChange={(v) => setDraft((d) => ({ ...d, [it.id]: v }))} />
                  <span style={{ fontSize: 12, color: C.sub, width: 34 }}>{unitLabel(it.satuan)}</span>
                </div>
              )}
            </div>
          );
        })}
        {!visible.length && <div style={{ padding: 14, fontSize: 13, color: C.sub }}>Tidak ada bahan yang cocok.</div>}
      </div>

      {canEdit && (
        <div style={{ position: "sticky", bottom: 12, display: "grid", gap: 8 }}>
          {filter === "Cek nilai lama" && counts.lama > 0 && !dirty.length && (
            <Btn kind="ghost" disabled={busy} onClick={() => {
              if (window.confirm(`Pakai ${counts.lama} nilai lama ini sebagai minimal stok ${LOKASI_LABEL[lokasi] || lokasi}?`)) {
                simpan(rows.filter((r) => r.info?.sumber === "migrasi_global" && r.min !== null).map((r) => r.it.id));
              }
            }}>Sudah dicek — pakai nilai lama untuk {LOKASI_LABEL[lokasi] || lokasi}</Btn>
          )}
          <Btn disabled={busy || !dirty.length} onClick={() => simpan()}>
            {busy ? "Menyimpan…" : dirty.length ? `Simpan ${dirty.length} perubahan · ${LOKASI_LABEL[lokasi] || lokasi}` : "Belum ada perubahan"}
          </Btn>
          <div style={{ fontSize: 11, color: C.sub, textAlign: "center" }}>Kosongkan kolom lalu Simpan untuk menghapus minimal stok (jadi “belum diatur”).</div>
        </div>
      )}
    </div>
  );
}
