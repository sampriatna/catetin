"use client";
// SO akhir shift: hitung stok fisik di satu lokasi. Pakai daftar SO outlet (nama & satuan staf) bila ada.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SHIFTS, buildSoRows, rowsForArea, defaultArea, buildSoLinesFromRows, soToItemQty, itemToSoQty, rowFactor, normSearch, parseQty,
  stockStatus, soDelta, round2, makeClientRef, todayJakarta, formatSoWa, fmtRp, fmtQty,
  parseWaStock, applyWaToRows, wasteFromWa, countsFromSoLines, usulanPermintaan, soTidakWajar,
} from "../../lib/inventoryLogic";
import { loadEvents, submitEvent, uploadFotos } from "../../lib/inventoryRepo";
import { C, card, input, label, Btn, WaButton, Chips, Notice, SearchBox, QtyInput, StatusBadge, FotoPicker, PasteWaPanel, AreaChips, dateInput } from "./ui";

function draftKey(bizId, lokasi, area) {
  return `dapur:so2:${bizId}:${lokasi}:${area || "semua"}`;
}
function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function writeDraft(key, v) {
  try { v ? localStorage.setItem(key, JSON.stringify(v)) : localStorage.removeItem(key); } catch { /* storage tidak tersedia */ }
}
const jam = (t) => new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const UBAH_MS = 24 * 3600 * 1000; // staf outlet boleh ubah SO < 24 jam (sama dengan RPC)

export default function SoForm({ bizId, user, access, lokasi, items, templates, snapshot, onSaved, onWasteFromWa, onBuatPermintaan }) {
  const allRows = useMemo(() => buildSoRows(items, templates, lokasi), [items, templates, lokasi]);
  // Daftar dibagi per area (dapur / bar) bila outlet punya akun terpisah; Samtaro tanpa area = satu daftar.
  const hasArea = allRows.some((r) => r.area);
  // Area dari penugasan akun (dapur/bar); hanya owner yang boleh ganti daftar.
  const [area, setArea] = useState(() => (access ? access.area : defaultArea(user)));
  const areaPilih = access ? access.areaPilih : true;
  const effArea = hasArea ? area : null;
  const rows = useMemo(() => rowsForArea(allRows, effArea), [allRows, effArea]);
  const hasTemplate = rows.some((r) => r.template);
  const lastByItem = useMemo(() => {
    const m = {};
    for (const r of snapshot || []) if (r.lokasi === lokasi) m[r.item_id] = r;
    return m;
  }, [snapshot, lokasi]);

  const key = draftKey(bizId, lokasi, effArea);
  const [counts, setCounts] = useState({});
  const [shift, setShift] = useState("Tutup");
  const [tanggal, setTanggal] = useState(todayJakarta());
  const [catatan, setCatatan] = useState("");
  const [extras, setExtras] = useState([]); // barang di luar daftar: { nama, qty, satuan }
  const [fotos, setFotos] = useState([]);
  const [q, setQ] = useState("");
  const [grup, setGrup] = useState("Semua");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [pasteInfo, setPasteInfo] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const [replace, setReplace] = useState(null); // SO lama yang sedang diubah { id, created_at, tanggal, shift }
  const [lastSo, setLastSo] = useState(null);
  const [tick, setTick] = useState(0);
  const refId = useRef(makeClientRef("so"));
  const manager = access ? !access.isOutlet : true;

  // SO terakhir di lokasi & bagian ini → bisa diubah / dikirim ulang ke WA.
  useEffect(() => {
    let alive = true;
    loadEvents(bizId, { lokasi, jenis: "so", limit: 10 })
      .then((evs) => {
        if (!alive) return;
        const ev = (evs || []).find((e) => (e.area || null) === (effArea || null));
        setLastSo(ev && (manager || Date.now() - new Date(ev.created_at).getTime() < UBAH_MS) ? ev : null);
      })
      .catch(() => alive && setLastSo(null));
    return () => { alive = false; };
  }, [bizId, lokasi, effArea, manager, tick]);

  useEffect(() => {
    const d = readDraft(key);
    setCounts(d?.counts || {});
    setExtras(d?.extras || []);
    if (d?.shift) setShift(d.shift);
    setDone(null);
    setReplace(null);
    setErr("");
    setPasteInfo(null);
    setFotos([]);
    refId.current = makeClientRef("so");
  }, [key]);

  useEffect(() => {
    const filled = Object.values(counts).some((v) => String(v ?? "").trim() !== "") || extras.length > 0;
    writeDraft(key, filled ? { counts, shift, extras } : null);
    setSavedAt(filled ? new Date() : null);
  }, [key, counts, shift, extras]);

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
    // Baris WA yang tidak ada di daftar tetap dicatat sebagai "tambahan" supaya tidak hilang.
    if (res.unmatched.length) {
      setExtras((xs) => {
        const have = new Set(xs.map((x) => x.nama.toLowerCase()));
        const add = res.unmatched
          .filter((u) => !have.has(u.label.toLowerCase()))
          .map((u) => ({ nama: u.label, qty: String(u.terms.reduce((a, t) => a + t.qty, 0)).replace(".", ","), satuan: u.terms.find((t) => t.unit)?.unit || "" }));
        return [...xs, ...add];
      });
    }
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

  /** Teks laporan WA dari isian (dipakai saat simpan & kirim ulang). */
  function buildWa(cts, { tanggal: tg, shift: sh, catatan: ct = "", foto = 0, tambahan = [], denganLalu = true }) {
    const filledRows = rows.filter((r) => { const v = parseQty(cts[r.key]); return v !== null && !Number.isNaN(v); });
    let total = 0;
    let belumKonversi = 0;
    const waLines = filledRows.map((r) => {
      const qSo = parseQty(cts[r.key]);
      const conv = soToItemQty(r, qSo);
      if (conv.converted) total += conv.qty * (Number(r.item.harga) || 0); else belumKonversi++;
      const last = denganLalu ? lastByItem[r.item.id] : null;
      return {
        key: r.key, satuanMaster: conv.converted ? conv.satuan : null,
        grup: hasTemplate ? r.grup : null, nama: r.label, satuan: r.satuan_so, qty: qSo,
        prevQty: last ? itemToSoQty(r, last.qty, last.satuan || r.item.satuan) : null,
        statusQty: conv.converted ? conv.qty : null, statusSatuan: conv.converted && conv.satuan !== r.satuan_so ? conv.satuan : null,
        minStok: conv.converted ? r.item.min_stok : null,
      };
    });
    total = round2(total);
    const text = formatSoWa({ lokasi, tanggal: tg, shift: sh, by: user?.name, lines: waLines, total, catatan: ct, foto, belumKonversi, tambahan, area: effArea });
    return { text, total, count: filledRows.length, usulan: usulanPermintaan(waLines) };
  }

  /** Buka SO tersimpan di form untuk diperbaiki; simpan = ganti SO itu. */
  function ubahSo(ev, cts = null) {
    const res = cts ? { counts: cts, missing: [] } : countsFromSoLines(rows, ev.lines);
    setCounts(res.counts);
    setShift(ev.shift || "Tutup");
    setTanggal(ev.tanggal || todayJakarta());
    setCatatan(String(ev.catatan || "").split("\nTambahan (belum di daftar)")[0].replace(/^Tambahan \(belum di daftar\).*$/s, ""));
    setReplace({ id: ev.id, created_at: ev.created_at, tanggal: ev.tanggal, shift: ev.shift });
    setDone(null);
    setErr(res.missing.length ? `Tidak ada di daftar sekarang (isi ulang bila perlu): ${res.missing.join(", ")}` : "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function kirimUlang(ev) {
    const { counts: cts } = countsFromSoLines(rows, ev.lines);
    const w = buildWa(cts, { tanggal: ev.tanggal, shift: ev.shift, catatan: ev.catatan || "", foto: (ev.foto || []).length, denganLalu: false });
    setDone({ ...w, resend: true, ev, counts: cts });
  }

  async function submit() {
    setErr("");
    const { lines, errors } = buildSoLinesFromRows(rows, counts);
    if (errors.length) { setErr(`Periksa: ${errors.slice(0, 5).join(", ")}`); return; }
    if (!lines.length) { setErr("Belum ada bahan yang dihitung."); return; }
    const belum = targetCount - rows.filter((r) => (r.template || !hasTemplate) && String(counts[r.key] ?? "").trim() !== "").length;
    // Pengaman salah ketik satuan (mis. 740 gram diisi di kolom kg → Rp28 juta).
    const cek = soTidakWajar(rows.filter((r) => { const v = parseQty(counts[r.key]); return v !== null && !Number.isNaN(v); }).map((r) => {
      const qSo = parseQty(counts[r.key]);
      const conv = soToItemQty(r, qSo);
      const last = lastByItem[r.item.id];
      return {
        nama: r.label, qty: qSo, satuan: r.satuan_so,
        nilai: conv.converted ? conv.qty * (Number(r.item.harga) || 0) : 0,
        prevQty: last && !replace ? itemToSoQty(r, last.qty, last.satuan || r.item.satuan) : null,
      };
    }));
    if (cek.length && !window.confirm(`Cek lagi angka ini, sepertinya tidak wajar:\n${cek.map((c) => `• ${c.nama}: ${fmtQty(c.qty)} ${c.satuan} (${fmtRp(c.nilai)}${c.prevQty ? ` · SO lalu ${fmtQty(c.prevQty)}` : ""})`).join("\n")}\n\nSudah benar (satuannya ${cek.length > 1 ? "sudah dicek" : "sesuai"})? Tekan OK untuk tetap simpan, Batal untuk memperbaiki.`)) return;
    if (belum > 0 && !window.confirm(`${belum} bahan di daftar belum dihitung dan tidak akan disimpan. Lanjut simpan ${lines.length} bahan?`)) return;
    try {
      let foto = [];
      if (fotos.length) {
        setBusy("Upload foto…");
        foto = await uploadFotos(bizId, refId.current, fotos, tanggal);
      }
      setBusy("Menyimpan…");
      const payload = lines.map(({ converted, ...l }) => l);
      const tambahan = extras.filter((x) => x.nama.trim()).map((x) => ({ nama: x.nama.trim(), qty: x.qty, satuan: x.satuan }));
      const catatanFull = [catatan.trim(), tambahan.length ? `Tambahan (belum di daftar): ${tambahan.map((x) => `${x.nama} ${x.qty} ${x.satuan}`.trim()).join("; ")}` : ""]
        .filter(Boolean).join("\n");
      const res = await submitEvent(bizId, {
        client_ref: refId.current, jenis: "so", lokasi, tanggal, shift, catatan: catatanFull, created_by_name: user?.name, foto, area: effArea,
        ...(replace ? { replaces: replace.id } : {}),
      }, payload);
      // Urut sesuai form (grup), pakai nama & satuan staf. SO yang diubah tidak dibandingkan dengan dirinya sendiri.
      const w = buildWa(counts, { tanggal, shift, catatan, foto: foto.length, tambahan, denganLalu: !replace });
      setDone({
        ...w, count: lines.length, duplicate: !!res?.duplicate, diubah: !!replace,
        ev: { id: res?.id, created_at: new Date().toISOString(), tanggal, shift, catatan: catatanFull }, counts: { ...counts },
      });
      setReplace(null);
      setTick((t) => t + 1);
      setCounts({});
      setCatatan("");
      setExtras([]);
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

  // Usulan permintaan → isi form Minta & Terima (jumlah dalam satuan daftar outlet; gudang tinggal proses).
  const canMinta = !!access?.can?.("kirim.minta") && !!onBuatPermintaan;
  const mintaSiap = (done?.usulan || []).filter((u) => u.minta > 0 && rows.some((r) => r.key === u.key));
  function buatPermintaan() {
    const cts = {};
    for (const u of mintaSiap) {
      const row = rows.find((r) => r.key === u.key);
      const v = itemToSoQty(row, u.minta, u.satuan);
      if (v !== null && v > 0) cts[row.key] = String(round2(v)).replace(".", ",");
    }
    writeDraft(`dapur:minta:${bizId}:${lokasi}:${effArea || "semua"}`, { counts: cts });
    onBuatPermintaan();
  }

  if (done) {
    const bisaUbah = done.ev?.id && (manager || Date.now() - new Date(done.ev.created_at).getTime() < UBAH_MS);
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {done.resend ? (
          <Notice>Laporan SO {done.ev.tanggal} · {done.ev.shift} (jam {jam(done.ev.created_at)}) — kirim ulang ke grup WhatsApp.</Notice>
        ) : (
          <Notice kind="ok">
            SO {done.diubah ? "diperbarui" : "tersimpan"}{done.duplicate ? " (sudah pernah terkirim sebelumnya)" : ""}: {done.count} bahan · nilai stok {fmtRp(done.total)}.
            {" "}Jangan lupa kirim laporannya ke WhatsApp.
          </Notice>
        )}
        <WaButton text={done.text} />
        {canMinta && mintaSiap.length > 0 && (
          <Btn kind="ghost" onClick={buatPermintaan}>📦 Buat permintaan ke gudang ({mintaSiap.length} barang)</Btn>
        )}
        {bisaUbah && <Btn kind="ghost" onClick={() => ubahSo(done.ev, done.counts)}>Ubah SO ini</Btn>}
        <Btn kind="ghost" onClick={() => setDone(null)}>Selesai</Btn>
        <pre style={{ ...card, whiteSpace: "pre-wrap", fontSize: 13, margin: 0, fontFamily: "inherit" }}>{done.text}</pre>
      </div>
    );
  }

  if (!rows.length) {
    return <Notice kind="warn">Belum ada bahan untuk lokasi ini. Minta admin/purchasing mengatur lokasi bahan di menu Kelola Bahan.</Notice>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Shift & tanggal otomatis; pilihan lengkap dibuka hanya saat ditekan. */}
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <button type="button" onClick={() => setEditMeta(!editMeta)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left", color: C.ink }}>
          <span style={{ fontSize: 13 }}>
            <b>{tanggal === todayJakarta() ? "Hari ini" : tanggal}</b> · Shift <b>{shift}</b>
            {hasArea && effArea ? <> · {effArea === "dapur" ? "Daftar Dapur" : "Daftar Bar"}</> : null}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.brand }}>{editMeta ? "Tutup" : "Ubah"}</span>
        </button>
        {editMeta && (
          <>
            {hasArea && areaPilih && (
              <div>
                <span style={label}>Daftar</span>
                <AreaChips value={area} onChange={setArea} />
              </div>
            )}
            <div>
              <span style={label}>Shift</span>
              <Chips options={SHIFTS} value={shift} onChange={setShift} />
            </div>
            <div>
              <span style={label}>Tanggal</span>
              <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} style={dateInput} />
            </div>
          </>
        )}
      </div>

      {replace ? (
        <Notice kind="warn">
          <b>Mengubah SO {replace.tanggal} · {replace.shift}</b> (tersimpan jam {jam(replace.created_at)}). Perbaiki angkanya lalu simpan — SO lama diganti.
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={() => { setReplace(null); setCounts({}); setErr(""); }}
              style={{ border: "none", background: "none", padding: 0, color: C.brand, fontWeight: 800, cursor: "pointer" }}>Batal ubah</button>
          </div>
        </Notice>
      ) : lastSo && filledCount === 0 ? (
        <Notice>
          SO terakhir: <b>{lastSo.tanggal} · {lastSo.shift || "-"}</b> jam {jam(lastSo.created_at)}{lastSo.created_by_name ? ` oleh ${lastSo.created_by_name}` : ""}.
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => ubahSo(lastSo)}
              style={{ border: "none", background: "none", padding: 0, color: C.brand, fontWeight: 800, cursor: "pointer" }}>Ubah SO itu</button>
            <button type="button" onClick={() => kirimUlang(lastSo)}
              style={{ border: "none", background: "none", padding: 0, color: C.brand, fontWeight: 800, cursor: "pointer" }}>Kirim ulang ke WA</button>
          </div>
        </Notice>
      ) : null}

      {Object.keys(lastByItem).length === 0 && !replace && (
        <Notice kind="warn">
          <b>SO awal {lokasi === "GDG" ? "Gudang" : "outlet"}</b> — belum pernah ada SO di sini. Hitung <b>semua</b> barang yang ada (yang habis tekan <b>Habis</b>).
          Angka ini jadi stok & nilai awal; SO berikutnya dibandingkan dengan ini.
        </Notice>
      )}

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
        {hasTemplate && !access?.hanyaDaftarSo && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.sub }}>
            <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
            Tampilkan juga bahan di luar daftar SO outlet ({rows.filter((r) => !r.template).length})
          </label>
        )}
        <div style={{ fontSize: 12, color: C.sub }}>
          Sudah dihitung <b>{filledCount}</b> dari {targetCount} bahan · kosong = belum dihitung, isi <b>0</b> atau tekan <b>Habis</b> kalau stoknya habis
          {savedAt ? <span style={{ color: C.ok, fontWeight: 700 }}> · ✓ Tersimpan otomatis {String(savedAt.getHours()).padStart(2, "0")}.{String(savedAt.getMinutes()).padStart(2, "0")}</span> : null}
        </div>
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
          const showHead = grup === "Semua" && (idx === 0 || visible[idx - 1].grup !== r.grup);
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
                {String(raw ?? "").trim() === "" && (
                  <button type="button" onClick={() => setCounts((c) => ({ ...c, [r.key]: "0" }))} aria-label={`${r.label} habis`}
                    style={{ flex: "0 0 auto", border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 10, padding: "8px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
                    Habis
                  </button>
                )}
                <QtyInput value={raw} placeholder="–" onChange={(v) => setCounts((c) => ({ ...c, [r.key]: v }))} />
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div style={{ padding: 14, fontSize: 13, color: C.sub }}>Tidak ada bahan yang cocok.</div>}
      </div>

      <div style={{ ...card, display: "grid", gap: 8 }}>
        <span style={{ ...label, marginBottom: 0 }}>Barang tambahan (belum ada di daftar) — opsional</span>
        <div style={{ fontSize: 12, color: C.sub }}>
          Mis. menu baru atau barang titipan. Ikut terkirim di laporan WA; purchasing/admin bisa menambahkannya ke daftar SO di Kelola.
        </div>
        {extras.map((x, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input style={{ ...input, flex: 2 }} value={x.nama} placeholder="Nama barang"
              onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, nama: e.target.value } : y)))} />
            <QtyInput value={x.qty} width={70} onChange={(v) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, qty: v } : y)))} />
            <input style={{ ...input, width: 70 }} value={x.satuan} placeholder="pcs"
              onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, satuan: e.target.value } : y)))} />
            <button type="button" aria-label="Hapus" onClick={() => setExtras((xs) => xs.filter((_, j) => j !== i))}
              style={{ border: "none", background: C.badSoft, color: C.bad, borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800 }}>×</button>
          </div>
        ))}
        <Btn kind="ghost" onClick={() => setExtras((xs) => [...xs, { nama: "", qty: "", satuan: "" }])}>+ Tambah barang</Btn>
      </div>

      <FotoPicker files={fotos} onChange={setFotos} />

      <div style={card}>
        <span style={label}>Catatan (opsional)</span>
        <textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} style={{ ...input, resize: "vertical" }}
          placeholder="Mis. kulkas mati, stok dipinjam outlet lain…" />
      </div>

      {err && <Notice kind="bad">{err}</Notice>}
      <Btn onClick={submit} disabled={!!busy || filledCount === 0}>
        {busy || `${replace ? "Simpan perubahan SO" : "Simpan SO"} (${filledCount} bahan${fotos.length ? ` · ${fotos.length} foto` : ""})`}
      </Btn>
      {(Object.keys(counts).length > 0 || extras.length > 0) && !busy && (
        <Btn kind="danger" onClick={() => { if (window.confirm("Kosongkan semua isian SO?")) { setCounts({}); setExtras([]); } }}>Kosongkan isian</Btn>
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
          <b>Tidak ada di daftar — dimasukkan ke "Barang tambahan":</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{info.unmatched.map((t) => <li key={t}>{t}</li>)}</ul>
          <div style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>Kalau sebenarnya ada di daftar dengan nama lain, isi manual di daftar lalu hapus dari tambahan.</div>
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
