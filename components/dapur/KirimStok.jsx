"use client";
// Permintaan & kirim stok gudang → outlet (pengganti form kertas "Permintaan Stok").
// Outlet minta → gudang kirim qty aktual → outlet cek & terima. Gudang juga bisa kirim langsung.

import { showActionToast, toastGagal } from "../../lib/actionToast";
import { tandaiAksiSendiri } from "../../lib/liveNotif";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LOKASI, LOKASI_LABEL, TRANSFER_STATUS, buildSoRows, buildTransferLines, rowsForArea,
  transferLineNilai, normSearch, parseQty, round2, makeClientRef, todayJakarta, formatTransferWa, fmtRp, fmtQty, minStokAt,
  parseWaStock, applyWaToRows,
} from "../../lib/inventoryLogic";
import { loadTransfers, saveTransfer, uploadFotos } from "../../lib/inventoryRepo";
import { CAP, dapurAccess } from "../../lib/dapurAccess";
import { C, card, input, label, Btn, WaButton, Chips, Notice, SearchBox, ItemPicker, QtyInput, FotoPicker, PasteWaPanel, AreaChips, dateInput } from "./ui";

const STATUS_COLOR = {
  diminta: [C.warnSoft, C.warn],
  dikirim: [C.brandSoft, C.brand],
  diterima: [C.okSoft, C.ok],
  batal: [C.bg, C.sub],
};

function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeDraft(key, v) {
  try { v ? localStorage.setItem(key, JSON.stringify(v)) : localStorage.removeItem(key); } catch { /* storage tidak tersedia */ }
}

function waLines(lines, itemsById) {
  return (lines || []).map((l) => ({
    nama: l.label || itemsById[l.item_id]?.nama || "?", satuan: l.satuan,
    qty_minta: l.qty_minta, qty_kirim: l.qty_kirim, qty_terima: l.qty_terima,
  }));
}

export default function KirimStok({ bizId, user, access, items, templates, minMap, onSaved, bukaMinta = false, onDibuka }) {
  // Izin dari lib/dapurAccess.js: outlet minta & terima untuk outletnya, gudang memproses & kirim, owner semua.
  const acc = access || dapurAccess(user);
  const canMinta = acc.can(CAP.KIRIM_MINTA);
  const canKirim = acc.can(CAP.KIRIM_KIRIM);
  const seeAll = acc.can(CAP.KIRIM_SEMUA);
  const canTerimaAll = acc.isOwner;
  const myOutlet = acc.outlet || "";
  const itemsById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [view, setView] = useState({ mode: "list" }); // list | baru(minta|kirim) | kirim(t) | terima(t)
  // Dari SO: form permintaan dibuka langsung (isian usulan sudah disiapkan di draft).
  useEffect(() => {
    if (!bukaMinta) return;
    if (canMinta) setView({ mode: "baru", action: "minta" });
    onDibuka?.();
  }, [bukaMinta, canMinta, onDibuka]);
  const [done, setDone] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true); setErr("");
    try { setList(await loadTransfers(bizId)); } catch (e) { setErr(e.message || String(e)); } finally { setLoading(false); }
  }, [bizId]);
  useEffect(() => { reload(); }, [reload]);
  // Ada perubahan permintaan/kiriman dari HP lain (realtime) → segarkan daftar.
  useEffect(() => {
    const on = () => reload();
    window.addEventListener("nf3:inv-transfer", on);
    return () => window.removeEventListener("nf3:inv-transfer", on);
  }, [reload]);

  const finish = (res) => { showActionToast(res?.msg, "success"); setDone(res); setView({ mode: "list" }); reload(); onSaved?.(); };

  if (done) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <Notice kind="ok">{done.msg}</Notice>
        <pre style={{ ...card, whiteSpace: "pre-wrap", fontSize: 13, margin: 0, fontFamily: "inherit" }}>{done.text}</pre>
        <WaButton text={done.text} />
        <Btn kind="ghost" onClick={() => setDone(null)}>Kembali ke daftar</Btn>
      </div>
    );
  }

  if (view.mode === "baru") {
    return <FormBaru bizId={bizId} user={user} access={acc} action={view.action} items={items} templates={templates}
      itemsById={itemsById} minMap={minMap} onCancel={() => setView({ mode: "list" })} onDone={finish} />;
  }
  if (view.mode === "kirim") {
    return <FormKirim bizId={bizId} user={user} t={view.t} items={items} itemsById={itemsById}
      onCancel={() => setView({ mode: "list" })} onDone={finish} />;
  }
  if (view.mode === "terima") {
    return <FormTerima bizId={bizId} user={user} t={view.t} itemsById={itemsById}
      onCancel={() => setView({ mode: "list" })} onDone={finish} />;
  }

  // Kasir hanya melihat kiriman untuk outletnya; manajer melihat semua.
  // Outlet hanya melihat kiriman outletnya dan bagiannya (dapur/bar); kiriman tanpa bagian terlihat keduanya.
  const scoped = list.filter((t) => seeAll || ((t.ke === myOutlet || t.dari === myOutlet) && (!acc.area || !t.area || t.area === acc.area)));
  const groups = [
    ["diminta", scoped.filter((t) => t.status === "diminta")],
    ["dikirim", scoped.filter((t) => t.status === "dikirim")],
    ["diterima", scoped.filter((t) => t.status === "diterima").slice(0, 15)],
    ["batal", scoped.filter((t) => t.status === "batal").slice(0, 5)],
  ];

  async function batal(t) {
    if (!window.confirm("Batalkan permintaan ini?")) return;
    try {
      tandaiAksiSendiri(t.id, "batal");
      await saveTransfer(bizId, "batal", { id: t.id }, []);
      showActionToast("Permintaan dibatalkan.", "success");
      reload();
    } catch (e) { setErr(toastGagal(e, "Gagal membatalkan")); }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: canMinta && canKirim ? "1fr 1fr" : "1fr", gap: 8 }}>
        {canMinta && <Btn onClick={() => setView({ mode: "baru", action: "minta" })}>+ Permintaan stok</Btn>}
        {canKirim && <Btn kind={canMinta ? "ghost" : "primary"} onClick={() => setView({ mode: "baru", action: "kirim" })}>+ Kirim langsung ke outlet</Btn>}
      </div>
      {err && <Notice kind="bad">{err}</Notice>}
      {loading && !list.length && <div style={{ padding: 20, textAlign: "center", color: C.sub }}>Memuat…</div>}
      {groups.map(([st, ts]) => ts.length > 0 && (
        <div key={st} style={{ ...card, padding: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, padding: "12px 14px 6px" }}>{TRANSFER_STATUS[st]} ({ts.length})</div>
          {ts.map((t) => (
            <TransferCard key={t.id} t={t} itemsById={itemsById}
              canKirim={canKirim && t.status === "diminta"}
              canTerima={t.status === "dikirim" && (canTerimaAll || (acc.can(CAP.KIRIM_TERIMA) && t.ke === myOutlet))}
              canBatal={t.status === "diminta" && (canKirim || t.diminta_by === user?.id)}
              onKirim={() => setView({ mode: "kirim", t })}
              onTerima={() => setView({ mode: "terima", t })}
              onBatal={() => batal(t)} />
          ))}
        </div>
      ))}
      {!loading && !scoped.length && (
        <Notice>Belum ada permintaan/kiriman stok. Outlet membuat <b>Permintaan stok</b>, gudang memproses kiriman, lalu outlet menekan <b>Cek & terima</b> saat barang datang.</Notice>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const [bg, fg] = STATUS_COLOR[status] || STATUS_COLOR.batal;
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999 }}>{TRANSFER_STATUS[status] || status}</span>;
}

function TransferCard({ t, itemsById, canKirim, canTerima, canBatal, onKirim, onTerima, onBatal }) {
  // Permintaan yang masih berjalan langsung terbuka; yang selesai/batal cukup diringkas.
  const aktif = t.status === "diminta" || t.status === "dikirim";
  const [open, setOpen] = useState(aktif);
  const who = t.diterima_by_name || t.dikirim_by_name || t.diminta_by_name || "—";
  const lines = t.lines || [];
  const num = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", paddingLeft: 8 };
  const qty = (v) => (v == null ? "–" : fmtQty(v));
  return (
    <div style={{ borderTop: `1px solid ${C.line}` }}>
      <button type="button" onClick={() => setOpen(!open)}
        style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: "none", background: "#fff", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{t.dari} → {t.ke}{t.area ? ` · ${t.area === "dapur" ? "Dapur" : "Bar"}` : ""}</span>
          <StatusPill status={t.status} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: C.sub }}>
          <span>{t.tanggal} · {lines.length} barang · {who}{t.status !== "diminta" ? ` · ${fmtRp(t.total_nilai)}` : ""}</span>
          <span style={{ color: C.brand, fontWeight: 700, whiteSpace: "nowrap" }}>{open ? "Tutup ▴" : "Lihat barang ▾"}</span>
        </div>
      </button>
      {open && (
        <div style={{ padding: "0 14px 10px", fontSize: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 64px 64px 64px", columnGap: 0, rowGap: 0, alignItems: "baseline" }}>
            <span style={{ color: C.sub, fontSize: 11, fontWeight: 700, paddingBottom: 4 }}>Barang</span>
            {["Minta", "Kirim", "Terima"].map((h) => (
              <span key={h} style={{ ...num, color: C.sub, fontSize: 11, fontWeight: 700, paddingBottom: 4 }}>{h}</span>
            ))}
            {lines.map((l) => {
              const beda = l.qty_terima != null && Number(l.qty_terima) !== Number(l.qty_kirim);
              const cell = { padding: "5px 0", borderTop: `1px solid ${C.line}` };
              return [
                <span key={`${l.id}n`} style={{ ...cell, minWidth: 0, overflowWrap: "anywhere" }}>
                  {l.label || itemsById[l.item_id]?.nama || "?"} <span style={{ color: C.sub }}>({l.satuan})</span>
                </span>,
                <span key={`${l.id}m`} style={{ ...cell, ...num }}>{qty(l.qty_minta)}</span>,
                <span key={`${l.id}k`} style={{ ...cell, ...num }}>{qty(l.qty_kirim)}</span>,
                <span key={`${l.id}t`} style={{ ...cell, ...num, color: beda ? C.bad : C.ink }}>{qty(l.qty_terima)}</span>,
              ];
            })}
          </div>
          {t.catatan && <div style={{ color: C.sub, marginTop: 6, whiteSpace: "pre-wrap" }}>📝 {t.catatan}</div>}
        </div>
      )}
      {(canKirim || canTerima || canBatal) && (
        <div style={{ display: "flex", gap: 8, padding: "0 14px 12px" }}>
          {canKirim && <Btn onClick={onKirim} style={{ padding: "9px 12px", fontSize: 13 }}>Proses kirim</Btn>}
          {canTerima && <Btn onClick={onTerima} style={{ padding: "9px 12px", fontSize: 13 }}>Cek & terima</Btn>}
          {canBatal && <Btn kind="danger" onClick={onBatal} style={{ padding: "9px 12px", fontSize: 13 }}>Batalkan</Btn>}
        </div>
      )}
    </div>
  );
}

// ── Permintaan baru (outlet) / kirim langsung (gudang) ─────

function FormBaru({ bizId, user, access, action, items, templates, itemsById, minMap, onCancel, onDone }) {
  const tujuanOptions = (access.isOutlet ? [access.outlet] : LOKASI).filter((l) => l !== "GDG");
  const [ke, setKe] = useState(tujuanOptions[0] || "KBU");
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [catatan, setCatatan] = useState("");
  const [fotos, setFotos] = useState([]);
  const [q, setQ] = useState("");
  const [grup, setGrup] = useState("Semua");
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [pasteMsg, setPasteMsg] = useState(null);
  const refId = useRef(makeClientRef(action));

  // Daftar barang = daftar SO outlet tujuan (nama & satuan yang dipakai staf), lalu barang lain di belakang.
  const allRows = useMemo(() => buildSoRows(items, templates, ke), [items, templates, ke]);
  const hasArea = allRows.some((r) => r.area);
  const [area, setArea] = useState(() => access.area);
  const effArea = hasArea ? area : null;
  const rows = useMemo(() => rowsForArea(allRows, effArea), [allRows, effArea]);
  const key = `dapur:${action}:${bizId}:${ke}:${effArea || "semua"}`;
  const [counts, setCounts] = useState({});
  useEffect(() => { setCounts(readDraft(key)?.counts || {}); }, [key]);
  useEffect(() => {
    const filled = Object.values(counts).some((v) => String(v ?? "").trim() !== "");
    writeDraft(key, filled ? { counts } : null);
  }, [key, counts]);

  const grupList = useMemo(() => ["Semua", ...new Set(rows.map((r) => r.grup))], [rows]);
  const visible = useMemo(() => {
    const words = normSearch(q).split(" ").filter(Boolean);
    let l = rows;
    if (words.length) l = l.filter((r) => { const h = normSearch(`${r.label} ${r.item.nama} ${r.item.kode}`); return words.every((w) => h.includes(w)); });
    if (grup !== "Semua") l = l.filter((r) => r.grup === grup);
    if (onlyFilled) l = l.filter((r) => String(counts[r.key] ?? "").trim() !== "");
    return l;
  }, [rows, q, grup, onlyFilled, counts]);
  const filled = rows.filter((r) => { const v = parseQty(counts[r.key]); return v !== null && v > 0; }).length;

  function applyPaste(text) {
    const parsed = parseWaStock(text);
    const res = applyWaToRows(parsed, rows);
    setCounts((c) => ({ ...c, ...res.counts }));
    setPasteMsg({ n: res.matched.length, bad: [...res.unconvertible.map((u) => u.raw), ...res.unmatched.map((u) => u.raw)] });
  }

  async function submit() {
    setErr("");
    const { lines, errors } = buildTransferLines(rows, counts);
    if (errors.length) { setErr(`Angka tidak valid: ${errors.slice(0, 5).join(", ")}`); return; }
    if (!lines.length) { setErr("Isi jumlah minimal satu barang."); return; }
    try {
      let foto = [];
      if (fotos.length) { setBusy("Upload foto…"); foto = await uploadFotos(bizId, refId.current, fotos, tanggal); }
      setBusy("Menyimpan…");
      const res = await saveTransfer(bizId, action, {
        client_ref: refId.current, dari: "GDG", ke, tanggal, catatan, by_name: user?.name, foto, area: effArea,
      }, lines);
      const wl = lines.map((l) => ({ nama: l.label, satuan: l.satuan, [action === "minta" ? "qty_minta" : "qty_kirim"]: l.qty }));
      const total = round2(lines.reduce((s, l) => s + transferLineNilai(l.qty, l.isi, itemsById[l.item_id]?.harga), 0));
      const text = formatTransferWa({ tahap: action, ke, tanggal, by: user?.name, lines: wl, total, catatan, foto: foto.length });
      writeDraft(key, null);
      onDone({ text, msg: `${action === "minta" ? "Permintaan terkirim ke gudang" : "Kiriman tercatat"}${res?.duplicate ? " (sudah pernah tersimpan)" : ""}: ${lines.length} barang.` });
    } catch (e) {
      setErr(toastGagal(e, "Gagal menyimpan"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>{action === "minta" ? "Permintaan stok ke gudang" : "Kirim langsung dari gudang"}</div>
        <div>
          <span style={label}>Untuk outlet</span>
          {tujuanOptions.length > 1
            ? <Chips options={tujuanOptions} value={ke} onChange={setKe} getLabel={(l) => LOKASI_LABEL[l] || l} />
            : <div style={{ fontWeight: 800 }}>{LOKASI_LABEL[ke] || ke}</div>}
        </div>
        {hasArea && !access.isOutlet && (
          <div>
            <span style={label}>Daftar</span>
            <AreaChips value={area} onChange={setArea} />
          </div>
        )}
        <div>
          <span style={label}>{action === "minta" ? "Tanggal butuh" : "Tanggal kirim"}</span>
          <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} style={dateInput} />
        </div>
      </div>

      <PasteWaPanel onApply={applyPaste} busyLabel="Isi dari pesan" />
      {pasteMsg && (
        <Notice kind={pasteMsg.bad.length ? "warn" : "ok"}>
          {pasteMsg.n} barang terisi dari pesan.{pasteMsg.bad.length ? ` Isi manual: ${pasteMsg.bad.join("; ")}` : ""}
        </Notice>
      )}

      <div style={{ ...card, display: "grid", gap: 10 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Cari barang…" />
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
          <input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} /> Tampilkan yang diisi saja ({filled})
        </label>
      </div>

      <div style={{ ...card, padding: 0 }}>
        {visible.map((r, idx) => {
          const showHead = grup === "Semua" && (idx === 0 || visible[idx - 1].grup !== r.grup);
          return (
            <div key={r.key}>
              {showHead && <div style={{ padding: "8px 12px", background: C.bg, fontSize: 12, fontWeight: 800, color: C.sub, textTransform: "uppercase" }}>{r.grup}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: C.sub }}><b>{r.satuan_so}</b>{(() => { const m = minStokAt(minMap, ke, r.item); return m !== null ? ` · min ${LOKASI_LABEL[ke] || ke} ${fmtQty(m)} ${r.item.satuan}` : ""; })()}</div>
                </div>
                <QtyInput value={counts[r.key]} onChange={(v) => setCounts((c) => ({ ...c, [r.key]: v }))} />
              </div>
            </div>
          );
        })}
        {!visible.length && <div style={{ padding: 14, fontSize: 13, color: C.sub }}>Tidak ada barang yang cocok.</div>}
      </div>

      <FotoPicker files={fotos} onChange={setFotos} hint={action === "minta" ? "Opsional, mis. foto form kertas." : "Foto barang yang dikirim."} />
      <div style={card}>
        <span style={label}>Catatan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }}
          placeholder={action === "minta" ? "Mis. untuk event Sabtu, tolong kirim pagi" : "Mis. dikirim via ojol, ayam dipisah"} />
      </div>
      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel}>Batal</Btn>
        <Btn onClick={submit} disabled={!!busy || filled === 0}>{busy || `${action === "minta" ? "Kirim permintaan" : "Simpan kiriman"} (${filled})`}</Btn>
      </div>
    </div>
  );
}

// ── Gudang memproses permintaan: isi qty aktual ─────────────

function FormKirim({ bizId, user, t, items, itemsById, onCancel, onDone }) {
  const [qty, setQty] = useState(() => Object.fromEntries((t.lines || []).map((l) => [l.id, l.qty_minta == null ? "" : String(Number(l.qty_minta)).replace(".", ",")])));
  const [extra, setExtra] = useState([]); // { item, qty }
  const [catatan, setCatatan] = useState("");
  const [fotos, setFotos] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const refId = useRef(makeClientRef("kirim"));

  const total = round2(
    (t.lines || []).reduce((s, l) => s + transferLineNilai(parseQty(qty[l.id]) || 0, l.isi, itemsById[l.item_id]?.harga), 0)
    + extra.reduce((s, x) => s + transferLineNilai(parseQty(x.qty) || 0, 1, x.item.harga), 0)
  );

  async function submit() {
    setErr("");
    const bad = [...(t.lines || []).filter((l) => Number.isNaN(parseQty(qty[l.id]))).map((l) => l.label || itemsById[l.item_id]?.nama),
      ...extra.filter((x) => Number.isNaN(parseQty(x.qty))).map((x) => x.item.nama)];
    if (bad.length) { setErr(`Angka tidak valid: ${bad.join(", ")}`); return; }
    const lines = [
      ...(t.lines || []).map((l) => ({ line_id: l.id, qty: parseQty(qty[l.id]) || 0 })),
      ...extra.filter((x) => (parseQty(x.qty) || 0) > 0).map((x) => ({ item_id: x.item.id, label: x.item.nama, satuan: x.item.satuan, qty: parseQty(x.qty) })),
    ];
    if (!lines.some((l) => l.qty > 0)) { setErr("Semua jumlah 0 — kalau tidak ada yang dikirim, batalkan permintaannya."); return; }
    try {
      let foto = [];
      if (fotos.length) { setBusy("Upload foto…"); foto = await uploadFotos(bizId, refId.current, fotos, todayJakarta()); }
      setBusy("Menyimpan…");
      const res = await saveTransfer(bizId, "kirim", { id: t.id, catatan, by_name: user?.name, foto }, lines);
      const wl = [
        ...(t.lines || []).map((l) => ({ nama: l.label || itemsById[l.item_id]?.nama, satuan: l.satuan, qty_minta: l.qty_minta, qty_kirim: parseQty(qty[l.id]) || 0 })),
        ...extra.filter((x) => (parseQty(x.qty) || 0) > 0).map((x) => ({ nama: x.item.nama, satuan: x.item.satuan, qty_minta: 0, qty_kirim: parseQty(x.qty) })),
      ];
      const text = formatTransferWa({ tahap: "kirim", ke: t.ke, dari: t.dari, tanggal: todayJakarta(), by: user?.name, lines: wl, total: res?.total_nilai ?? total, catatan, foto: foto.length });
      onDone({ text, msg: `Kiriman ke ${t.ke} tercatat${res?.duplicate ? " (sudah pernah tersimpan)" : ""}. Outlet tinggal menekan "Cek & terima" saat barang datang.` });
    } catch (e) {
      setErr(toastGagal(e, "Gagal menyimpan"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ fontWeight: 800 }}>Proses kiriman {t.dari} → {LOKASI_LABEL[t.ke] || t.ke}</div>
        <div style={{ fontSize: 12, color: C.sub }}>Diminta {t.diminta_by_name || "—"} · {t.tanggal}. Isi jumlah yang benar-benar dikirim (0 kalau tidak ada).</div>
        {t.catatan && <div style={{ fontSize: 13, marginTop: 6 }}>📝 {t.catatan}</div>}
      </div>
      <div style={{ ...card, padding: 0 }}>
        {(t.lines || []).map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{l.label || itemsById[l.item_id]?.nama}</div>
              <div style={{ fontSize: 12, color: C.sub }}>diminta {l.qty_minta == null ? "–" : fmtQty(l.qty_minta)} {l.satuan}</div>
            </div>
            <QtyInput value={qty[l.id]} onChange={(v) => setQty((s) => ({ ...s, [l.id]: v }))} />
          </div>
        ))}
        {extra.map((x, i) => (
          <div key={x.item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{x.item.nama} <span style={{ color: C.brand, fontSize: 11 }}>tambahan</span></div>
              <div style={{ fontSize: 12, color: C.sub }}>{x.item.satuan}</div>
            </div>
            <QtyInput value={x.qty} onChange={(v) => setExtra((xs) => xs.map((y, j) => (j === i ? { ...y, qty: v } : y)))} />
          </div>
        ))}
      </div>
      <div style={{ ...card, display: "grid", gap: 8 }}>
        <span style={label}>Tambah barang yang tidak diminta</span>
        <ItemPicker items={(items || []).filter((i) => i.aktif !== false)} excludeIds={[...(t.lines || []).map((l) => l.item_id), ...extra.map((x) => x.item.id)]}
          onPick={(item) => setExtra((xs) => [...xs, { item, qty: "" }])} />
      </div>
      <FotoPicker files={fotos} onChange={setFotos} hint="Foto barang yang dikirim." />
      <div style={card}>
        <span style={label}>Catatan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }} placeholder="Mis. beras tinggal 1,5 karung" />
      </div>
      <Notice kind="info">Nilai kiriman: <b>{fmtRp(total)}</b> (barang tanpa konversi satuan dihitung Rp 0)</Notice>
      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel}>Kembali</Btn>
        <Btn onClick={submit} disabled={!!busy}>{busy || "Kirim"}</Btn>
      </div>
    </div>
  );
}

// ── Outlet cek barang datang ────────────────────────────────

function FormTerima({ bizId, user, t, itemsById, onCancel, onDone }) {
  const kirimLines = (t.lines || []).filter((l) => Number(l.qty_kirim) > 0);
  const [qty, setQty] = useState(() => Object.fromEntries(kirimLines.map((l) => [l.id, String(Number(l.qty_kirim)).replace(".", ",")])));
  const [catatan, setCatatan] = useState("");
  const [fotos, setFotos] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const refId = useRef(makeClientRef("terima"));

  const beda = kirimLines.filter((l) => { const v = parseQty(qty[l.id]); return v !== null && !Number.isNaN(v) && v !== Number(l.qty_kirim); });

  async function submit() {
    setErr("");
    const bad = kirimLines.filter((l) => { const v = parseQty(qty[l.id]); return v === null || Number.isNaN(v); });
    if (bad.length) { setErr(`Isi jumlah yang datang untuk: ${bad.map((l) => l.label || itemsById[l.item_id]?.nama).join(", ")}`); return; }
    if (beda.length && !catatan.trim() && !window.confirm(`${beda.length} barang jumlahnya beda dengan kiriman. Simpan tanpa catatan?`)) return;
    try {
      let foto = [];
      if (fotos.length) { setBusy("Upload foto…"); foto = await uploadFotos(bizId, refId.current, fotos, todayJakarta()); }
      setBusy("Menyimpan…");
      const lines = kirimLines.map((l) => ({ line_id: l.id, qty: parseQty(qty[l.id]) }));
      const res = await saveTransfer(bizId, "terima", { id: t.id, catatan, by_name: user?.name, foto }, lines);
      const wl = kirimLines.map((l) => ({ nama: l.label || itemsById[l.item_id]?.nama, satuan: l.satuan, qty_kirim: l.qty_kirim, qty_terima: parseQty(qty[l.id]) }));
      const text = formatTransferWa({ tahap: "terima", ke: t.ke, dari: t.dari, tanggal: todayJakarta(), by: user?.name, lines: wl, total: res?.total_nilai ?? 0, catatan, foto: foto.length });
      onDone({ text, msg: `Barang diterima di ${t.ke}${beda.length ? ` — ${beda.length} barang selisih` : ", semua sesuai"}.` });
    } catch (e) {
      setErr(toastGagal(e, "Gagal menyimpan"));
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={{ fontWeight: 800 }}>Cek barang datang: {t.dari} → {LOKASI_LABEL[t.ke] || t.ke}</div>
        <div style={{ fontSize: 12, color: C.sub }}>Dikirim {t.dikirim_by_name || "—"}. Hitung barang yang datang; ubah angkanya kalau kurang/lebih.</div>
        {t.catatan && <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>📝 {t.catatan}</div>}
      </div>
      <div style={{ ...card, padding: 0 }}>
        {kirimLines.map((l) => {
          const v = parseQty(qty[l.id]);
          const diff = v !== null && !Number.isNaN(v) && v !== Number(l.qty_kirim);
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${C.line}`, background: diff ? C.badSoft : "#fff" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{l.label || itemsById[l.item_id]?.nama}</div>
                <div style={{ fontSize: 12, color: C.sub }}>dikirim {fmtQty(l.qty_kirim)} {l.satuan}{diff ? ` · selisih ${fmtQty(round2(v - Number(l.qty_kirim)))}` : ""}</div>
              </div>
              <QtyInput value={qty[l.id]} onChange={(val) => setQty((s) => ({ ...s, [l.id]: val }))} />
            </div>
          );
        })}
      </div>
      <FotoPicker files={fotos} onChange={setFotos} hint="Foto barang yang datang (terutama kalau rusak/kurang)." />
      <div style={card}>
        <span style={label}>Catatan {beda.length ? "(wajib jelaskan selisih)" : "(opsional)"}</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }} placeholder="Mis. bebek kurang 1, sirup bocor" />
      </div>
      {err && <Notice kind="bad">{err}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
        <Btn kind="ghost" onClick={onCancel}>Kembali</Btn>
        <Btn onClick={submit} disabled={!!busy}>{busy || (beda.length ? `Terima (${beda.length} selisih)` : "Terima, semua sesuai")}</Btn>
      </div>
    </div>
  );
}
