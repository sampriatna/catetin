"use client";
// Upload penjualan POS (ESB "Sales Menu Recapitulation Report" atau CSV/Excel Menu + Qty)
// + pemetaan nama menu POS → resep menu. Hanya owner/admin.

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import {
  LOKASI_LABEL, OUTLET_JUAL, parseSalesRows, suggestMenu, normMenu, todayJakarta, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import {
  loadSalesUploads, loadSalesLines, saveSalesUpload, deleteSalesUpload, saveMenuAlias,
} from "../../lib/inventoryRepo";
import { C, card, dateInput, label, selectInput, Btn, Chips, Notice } from "./ui";

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function readSheetRows(file) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

export default function Penjualan({ bizId, user, menus, aliases, onChanged, onBuatResep }) {
  const [uploads, setUploads] = useState([]);
  const [sales, setSales] = useState([]);
  const [err, setErr] = useState("");
  const today = todayJakarta();

  const reload = useCallback(async () => {
    try {
      const [u, s] = await Promise.all([loadSalesUploads(bizId), loadSalesLines(bizId, addDays(today, -62), today)]);
      setUploads(u); setSales(s);
    } catch (e) {
      setErr(e.message || String(e));
    }
  }, [bizId, today]);
  useEffect(() => { reload(); }, [reload]);

  const afterSave = async () => { await reload(); onChanged?.(); };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {err && <Notice kind="bad">{err}</Notice>}
      <UploadCard bizId={bizId} user={user} onSaved={afterSave} />
      <MappingCard menus={menus} aliases={aliases} sales={sales} onChanged={onChanged} onBuatResep={onBuatResep} />
      <UploadHistory uploads={uploads} onDeleted={afterSave} />
    </div>
  );
}

function UploadCard({ bizId, user, onSaved }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [outlet, setOutlet] = useState(null);
  const [katOutlet, setKatOutlet] = useState({});
  const [dari, setDari] = useState("");
  const [sampai, setSampai] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const parsed = useMemo(() => (rows ? parseSalesRows(rows, { outlet, kategoriOutlet: katOutlet }) : null), [rows, outlet, katOutlet]);
  useEffect(() => {
    if (parsed) { setDari((d) => d || parsed.dari || ""); setSampai((s) => s || parsed.sampai || ""); }
  }, [parsed]);

  const perOutlet = useMemo(() => {
    const m = {};
    for (const l of parsed?.lines || []) {
      m[l.lokasi] = m[l.lokasi] || { menu: 0, qty: 0, omset: 0 };
      m[l.lokasi].menu++; m[l.lokasi].qty += l.qty; m[l.lokasi].omset += l.omset;
    }
    return m;
  }, [parsed]);

  const pick = async (f) => {
    setMsg(null); setFile(f); setRows(null); setOutlet(null); setKatOutlet({}); setDari(""); setSampai("");
    if (!f) return;
    try {
      setRows(await readSheetRows(f));
    } catch (e) {
      setMsg({ kind: "bad", text: `File tidak bisa dibaca: ${e.message || e}` });
    }
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const outOfRange = parsed.lines.some((l) => l.tanggal && (l.tanggal < dari || l.tanggal > sampai));
      if (outOfRange) throw new Error("Ada tanggal di file di luar periode yang dipilih.");
      const res = await saveSalesUpload(bizId, {
        sumber: /recapitulation/i.test(String(rows?.[0]?.[0] || "")) ? "esb" : "file",
        nama_file: file?.name, dari, sampai, created_by_name: user?.name || user?.email || null,
      }, parsed.lines);
      setMsg({ kind: "ok", text: `Tersimpan: ${res.baris} menu, ${fmtQty(res.total_qty)} porsi, ${fmtRp(res.total_omset)}${res.diganti ? ` (menggantikan ${res.diganti} baris lama di periode yang sama)` : ""}.` });
      setFile(null); setRows(null);
      await onSaved();
    } catch (e) {
      setMsg({ kind: "bad", text: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 800 }}>Upload penjualan</div>
      <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
        ESB: <b>Report → Sales Menu Recapitulation</b>, Branch <i>All</i>, export Excel. Bisa per minggu (untuk laporan mingguan) atau per hari
        (supaya audit harian ikut memakai penjualan). Upload ulang periode yang sama = mengganti data lama.
      </div>
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, border: `1px dashed ${C.brand}`, background: C.brandSoft, color: C.brand, fontWeight: 800, cursor: "pointer" }}>
        <FileSpreadsheet size={18} /> {file ? file.name : "Pilih file .xlsx / .csv"}
        <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { pick(e.target.files?.[0] || null); e.target.value = ""; }} />
      </label>

      {parsed && (
        <>
          {parsed.warnings.filter((w) => !/Periode/.test(w)).map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
          {parsed.tanpaOutlet.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ ...label, marginBottom: 0 }}>Kategori ini milik outlet mana?</span>
              {parsed.tanpaOutlet.map((k) => (
                <div key={k.kategori} style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{k.kategori} <span style={{ color: C.sub, fontWeight: 400 }}>· {fmtQty(k.qty)} porsi</span></div>
                  <Chips options={[...OUTLET_JUAL, "-"]} value={katOutlet[k.kategori]} getLabel={(o) => (o === "-" ? "Abaikan" : o)}
                    onChange={(v) => setKatOutlet({ ...katOutlet, [k.kategori]: v })} />
                </div>
              ))}
              <div style={{ fontSize: 12, color: C.sub }}>Atau semua baris file ini untuk satu outlet:</div>
              <Chips options={OUTLET_JUAL} value={outlet} onChange={(v) => setOutlet(outlet === v ? null : v)} />
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><span style={label}>Dari</span><input type="date" value={dari} onChange={(e) => setDari(e.target.value)} style={dateInput} /></div>
            <div><span style={label}>Sampai</span><input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} style={dateInput} /></div>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            {Object.entries(perOutlet).map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>{LOKASI_LABEL[l] || l}</span>
                <span style={{ color: C.sub }}>{v.menu} menu · {fmtQty(v.qty)} porsi · {fmtRp(v.omset)}</span>
              </div>
            ))}
          </div>
          <Notice kind={parsed.perHari ? "ok" : "info"}>
            {parsed.perHari
              ? "Rekap per hari — dipakai audit harian dan laporan mingguan."
              : "Rekap satu periode — dipakai laporan Penjualan vs Pemakaian untuk periode ini. Untuk audit harian, upload per hari."}
          </Notice>
          <Btn onClick={save} disabled={busy || !parsed.lines.length || !dari || !sampai || sampai < dari}>
            {busy ? "Menyimpan…" : `Simpan ${parsed.lines.length} baris penjualan`}
          </Btn>
        </>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  );
}

/** Nama menu POS yang belum dihubungkan ke resep, urut dari yang paling laku. */
function MappingCard({ menus, aliases, sales, onChanged, onBuatResep }) {
  const [lok, setLok] = useState("Semua");
  const [busyId, setBusyId] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [err, setErr] = useState("");
  const menuById = useMemo(() => Object.fromEntries((menus || []).map((m) => [m.id, m])), [menus]);

  const sold = useMemo(() => {
    const m = {};
    for (const s of sales || []) {
      const k = `${s.lokasi}|${s.nama_norm || normMenu(s.nama_pos)}`;
      m[k] = m[k] || { qty: 0, omset: 0 };
      m[k].qty += Number(s.qty) || 0; m[k].omset += Number(s.omset) || 0;
    }
    return m;
  }, [sales]);

  const rows = useMemo(() => (aliases || [])
    .map((a) => ({ ...a, ...(sold[`${a.lokasi}|${a.nama_norm}`] || { qty: 0, omset: 0 }), sug: a.menu_id ? null : suggestMenu(a.nama_pos, menus, a.lokasi) }))
    .filter((a) => lok === "Semua" || a.lokasi === lok)
    .sort((a, b) => b.omset - a.omset || b.qty - a.qty), [aliases, sold, menus, lok]);

  const todo = rows.filter((a) => !a.menu_id && !a.abaikan);
  const done = rows.filter((a) => a.menu_id || a.abaikan);
  const omsetAll = rows.reduce((s, a) => s + a.omset, 0);
  const omsetOk = done.reduce((s, a) => s + a.omset, 0);

  const set = async (a, patch) => {
    setBusyId(a.id); setErr("");
    try { await saveMenuAlias(a.id, patch); await onChanged?.(); } catch (e) { setErr(e.message || String(e)); } finally { setBusyId(null); }
  };

  const autoAll = async () => {
    const list = todo.filter((a) => a.sug && a.sug.score >= 0.99);
    for (const a of list) {
      // eslint-disable-next-line no-await-in-loop
      await set(a, { menu_id: a.sug.menu.id, abaikan: false });
    }
  };
  const exact = todo.filter((a) => a.sug && a.sug.score >= 0.99).length;

  const Row = ({ a }) => {
    const opts = (menus || []).filter((m) => m.lokasi === a.lokasi && m.aktif !== false);
    return (
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.line}`, display: "grid", gap: 6, opacity: busyId === a.id ? 0.5 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>{a.nama_pos} <span style={{ color: C.sub, fontWeight: 600, fontSize: 12 }}>· {a.lokasi}</span></span>
          <span style={{ fontSize: 12, color: C.sub, whiteSpace: "nowrap" }}>{fmtQty(a.qty)} porsi</span>
        </div>
        {a.menu_id || a.abaikan ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <span style={{ color: a.abaikan ? C.sub : C.ok, fontWeight: 700 }}>{a.abaikan ? "Diabaikan (tidak memakai stok)" : `→ ${menuById[a.menu_id]?.nama || "?"}`}</span>
            <button type="button" onClick={() => set(a, { menu_id: null, abaikan: false })} style={{ border: "none", background: "none", color: C.brand, fontWeight: 800, cursor: "pointer" }}>Ubah</button>
          </div>
        ) : (
          <>
            {a.sug && (
              <Btn kind="ghost" onClick={() => set(a, { menu_id: a.sug.menu.id, abaikan: false })} style={{ padding: "9px 12px", fontSize: 13 }}>
                Pakai resep: {a.sug.menu.nama}
              </Btn>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <select value="" onChange={(e) => e.target.value && set(a, { menu_id: e.target.value, abaikan: false })} style={{ ...selectInput, fontSize: 13, padding: "8px 10px", flex: 1 }}>
                <option value="">Pilih resep…</option>
                {opts.map((m) => <option key={m.id} value={m.id}>{m.nama}</option>)}
              </select>
              <button type="button" onClick={() => onBuatResep?.({ lokasi: a.lokasi, nama: a.nama_pos, aliasId: a.id, harga_jual: a.qty ? Math.round(a.omset / a.qty) : "" })}
                style={{ flex: "0 0 auto", border: `1px solid ${C.line}`, background: "#fff", borderRadius: 10, padding: "0 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Buat resep</button>
              <button type="button" onClick={() => set(a, { menu_id: null, abaikan: true })}
                style={{ flex: "0 0 auto", border: `1px solid ${C.line}`, background: "#fff", borderRadius: 10, padding: "0 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", color: C.sub }}>Abaikan</button>
            </div>
          </>
        )}
      </div>
    );
  };

  if (!(aliases || []).length) return null;

  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ padding: "12px 14px 8px", display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 800 }}>Cocokkan menu POS ↔ resep</div>
        <div style={{ fontSize: 12, color: C.sub }}>
          {omsetAll ? `${fmtQty((omsetOk / omsetAll) * 100, 0)}% omset 2 bulan terakhir sudah punya resep. ` : ""}
          Menu yang tidak memakai stok (mis. biaya kemasan, add-on tanpa bahan) pilih <b>Abaikan</b>.
        </div>
        <Chips options={["Semua", ...OUTLET_JUAL]} value={lok} onChange={setLok} />
        {exact > 0 && <Btn kind="ghost" onClick={autoAll} disabled={!!busyId}>Hubungkan {exact} nama yang sama persis</Btn>}
        {err && <Notice kind="bad">{err}</Notice>}
      </div>
      <div style={{ padding: "0 14px 6px", fontSize: 12, fontWeight: 800, color: todo.length ? C.warn : C.ok }}>
        {todo.length ? `${todo.length} belum punya resep` : "Semua menu sudah dicocokkan"}
      </div>
      {todo.slice(0, 40).map((a) => <Row key={a.id} a={a} />)}
      {todo.length > 40 && <div style={{ padding: "8px 14px", fontSize: 12, color: C.sub }}>+{todo.length - 40} lainnya (yang paling laku ditampilkan dulu)</div>}
      <button type="button" onClick={() => setShowDone(!showDone)}
        style={{ width: "100%", border: "none", borderTop: `1px solid ${C.line}`, background: "#fff", padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 800, color: C.brand, cursor: "pointer" }}>
        {showDone ? "Sembunyikan" : "Lihat"} yang sudah dicocokkan ({done.length})
      </button>
      {showDone && done.map((a) => <Row key={a.id} a={a} />)}
    </div>
  );
}

function UploadHistory({ uploads, onDeleted }) {
  const [busy, setBusy] = useState(null);
  if (!uploads.length) return null;
  const del = async (u) => {
    if (!window.confirm(`Hapus penjualan ${u.dari} s/d ${u.sampai}?`)) return;
    setBusy(u.id);
    try { await deleteSalesUpload(u.id); await onDeleted(); } finally { setBusy(null); }
  };
  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ padding: "12px 14px 6px", fontWeight: 800 }}>Riwayat upload</div>
      {uploads.map((u) => (
        <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${C.line}`, opacity: busy === u.id ? 0.5 : 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{u.dari === u.sampai ? u.dari : `${u.dari} s/d ${u.sampai}`} · {(u.lokasi || []).join(", ")}</div>
            <div style={{ fontSize: 12, color: C.sub }}>
              {u.per_hari ? "Per hari" : "Rekap periode"} · {u.baris} menu · {fmtQty(u.total_qty)} porsi · {fmtRp(u.total_omset)}{u.created_by_name ? ` · ${u.created_by_name}` : ""}
            </div>
          </div>
          <button type="button" aria-label="Hapus upload" onClick={() => del(u)} style={{ border: "none", background: "none", cursor: "pointer", padding: 4 }}>
            <Trash2 size={16} color={C.bad} />
          </button>
        </div>
      ))}
    </div>
  );
}
