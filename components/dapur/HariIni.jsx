"use client";
// Halaman pertama modul Dapur: apa yang harus dikerjakan hari ini di lokasi ini (bukan saldo).
// Dapur KBU/KSM & kasir: SO akhir shift, terima kiriman, permintaan, waste, bahan menipis.
// Gudang (purchasing): SO gudang, permintaan outlet, produksi, kiriman di jalan.
// Owner/admin: status SO semua lokasi hari ini + nilai stok.

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Circle, AlertTriangle } from "lucide-react";
import {
  LOKASI, LOKASI_LABEL, PRIORITY, PRIORITY_LABEL, canManageMaster, isOutletLocked, summarizeDapurToday, soAreaStatus, stockStatus, todayJakarta, fmtJam, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import { loadDapurToday } from "../../lib/inventoryRepo";
import { C, card, Notice } from "./ui";
import StockValueCard from "./StockValueCard";
import { useStockAudit, FindingRow, PRIORITY_COLOR } from "./AuditStok";

function Task({ done, urgent, title, sub, onClick }) {
  const Icon = done ? CheckCircle2 : urgent ? AlertTriangle : Circle;
  const color = done ? C.ok : urgent ? C.warn : C.sub;
  return (
    <button type="button" onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "12px 14px", border: "none",
        borderBottom: `1px solid ${C.line}`, background: urgent && !done ? C.warnSoft : "#fff", cursor: "pointer" }}>
      <Icon size={22} color={color} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{sub}</div>}
      </div>
      <ChevronRight size={16} color={C.sub} />
    </button>
  );
}

export default function HariIni({ bizId, user, lokasi, items, snapshot, onGo }) {
  const role = user?.role || "kasir";
  const manager = role === "owner" || role === "admin";
  const scopeLokasi = isOutletLocked(role) ? lokasi : role === "purchasing" ? "GDG" : null;
  const today = todayJakarta();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    loadDapurToday(bizId, { lokasi: scopeLokasi, today })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message || String(e)));
    return () => { alive = false; };
  }, [bizId, scopeLokasi, today]);

  const st = useMemo(() => (data ? summarizeDapurToday({ ...data, lokasi: scopeLokasi, userId: user?.id, today }) : null), [data, scopeLokasi, user?.id, today]);

  const itemsById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  const alertLokasi = scopeLokasi ? [scopeLokasi] : LOKASI;
  const menipis = useMemo(() => (snapshot || [])
    .filter((r) => alertLokasi.includes(r.lokasi))
    .map((r) => ({ ...r, item: itemsById[r.item_id] }))
    .filter((r) => r.item && (r.satuan || r.item.satuan) === r.item.satuan)
    .map((r) => ({ ...r, status: stockStatus(r.qty, r.item.min_stok) }))
    .filter((r) => r.status === "habis" || r.status === "menipis")
    .slice(0, 12), [snapshot, itemsById, alertLokasi]);

  if (err) return <Notice kind="bad">Status hari ini belum bisa dimuat: {err}</Notice>;
  if (!st) return <div style={{ padding: 30, textAlign: "center", color: C.sub }}>Memuat…</div>;

  const title = scopeLokasi ? `Hari ini · ${LOKASI_LABEL[scopeLokasi] || scopeLokasi}` : "Hari ini · semua lokasi";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px 8px", fontWeight: 800 }}>{title}</div>

        {scopeLokasi && (
          <>
            <Task done={st.soMine} title={scopeLokasi === "GDG" ? "SO Gudang" : "SO akhir shift"}
              sub={st.soMine ? `Terkirim ${fmtJam(st.soMineAt)}` : st.soCount ? `Akun lain sudah SO ${fmtJam(st.soLast?.created_at)} (${st.soLast?.created_by_name || "—"}) · daftar Anda belum` : "Belum SO hari ini"}
              onClick={() => onGo("so")} />
            {scopeLokasi !== "GDG" && (
              <Task urgent={st.kirimanMasuk > 0} title={st.kirimanMasuk ? `Terima kiriman gudang (${st.kirimanMasuk})` : "Terima kiriman gudang"}
                sub={st.kirimanMasuk ? "Barang sudah dikirim — cek jumlahnya lalu terima" : "Tidak ada kiriman yang menunggu"}
                onClick={() => onGo("kirim")} />
            )}
            <Task urgent={scopeLokasi === "GDG" && st.permintaanMenunggu > 0}
              title={scopeLokasi === "GDG" ? `Permintaan outlet${st.permintaanMenunggu ? ` (${st.permintaanMenunggu})` : ""}` : "Permintaan stok ke gudang"}
              sub={scopeLokasi === "GDG"
                ? (st.permintaanMenunggu ? "Isi jumlah yang dikirim ke outlet" : st.kirimanMasuk ? `${st.kirimanMasuk} kiriman belum diterima outlet` : "Tidak ada permintaan menunggu")
                : (st.permintaanMenunggu ? `${st.permintaanMenunggu} permintaan belum dikirim gudang` : "Minta barang yang menipis")}
              onClick={() => onGo("kirim")} />
            <Task done={st.wasteCount > 0} title="Waste hari ini"
              sub={st.wasteCount ? `${st.wasteCount} catatan · ${fmtRp(st.wasteNilai)}` : "Belum ada barang terbuang dicatat (isi kalau ada)"}
              onClick={() => onGo("waste")} />
            {(role === "purchasing" || role === "dapur" || canManageMaster(role)) && (
              <Task done={st.produksiCount > 0} title="Produksi"
                sub={st.produksiCount ? `${st.produksiCount} produksi dicatat hari ini` : "Pilih resep + jumlah batch → modal otomatis"}
                onClick={() => onGo("produksi")} />
            )}
          </>
        )}

        {!scopeLokasi && (
          <>
            {soAreaStatus(st.soByArea).map((a) => (
              <Task key={a.label} done={!!a.event} title={`SO ${a.label}`}
                sub={a.event ? `Terkirim ${fmtJam(a.event.created_at)} · ${a.event.created_by_name || "—"}` : "Belum ada SO hari ini"}
                onClick={() => onGo("ringkasan")} />
            ))}
            <Task urgent={st.permintaanMenunggu > 0} title={`Permintaan menunggu gudang (${st.permintaanMenunggu})`}
              sub={st.kirimanMasuk ? `${st.kirimanMasuk} kiriman belum diterima outlet` : "Tidak ada kiriman di jalan"}
              onClick={() => onGo("kirim")} />
            <Task done={st.wasteCount === 0} urgent={st.wasteNilai > 0} title="Waste hari ini (semua lokasi)"
              sub={st.wasteCount ? `${st.wasteCount} catatan · ${fmtRp(st.wasteNilai)}` : "Belum ada waste tercatat"}
              onClick={() => onGo("ringkasan")} />
          </>
        )}
      </div>

      {menipis.length > 0 && (
        <div style={{ ...card, display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Menipis / habis (SO terakhir)</div>
          {menipis.map((r) => (
            <div key={`${r.lokasi}-${r.item_id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
              <span>{r.status === "habis" ? "🔴" : "🟠"} {r.item.nama}{scopeLokasi ? "" : ` · ${r.lokasi}`}</span>
              <span style={{ color: C.sub }}>{fmtQty(r.qty)} / min {fmtQty(r.item.min_stok)} {r.item.satuan}</span>
            </div>
          ))}
          {scopeLokasi && scopeLokasi !== "GDG" && (
            <button type="button" onClick={() => onGo("kirim")}
              style={{ marginTop: 4, border: "none", background: C.brandSoft, color: C.brand, borderRadius: 10, padding: "9px 12px", fontWeight: 800, cursor: "pointer" }}>
              Buat permintaan stok
            </button>
          )}
        </div>
      )}

      {manager && <AnomaliCard bizId={bizId} items={items} onGo={onGo} />}

      {(manager || role === "purchasing") && (
        <StockValueCard bizId={bizId} lokasiScope={scopeLokasi ? [scopeLokasi] : LOKASI} />
      )}
    </div>
  );
}

/** Ringkasan temuan audit 7 hari untuk owner/admin. */
function AnomaliCard({ bizId, items, onGo }) {
  const audit = useStockAudit(bizId, items);
  const itemsById = useMemo(() => Object.fromEntries((items || []).map((i) => [i.id, i])), [items]);
  if (audit.loading) return null;
  if (audit.err) return <Notice kind="warn">Audit belum bisa dihitung: {audit.err}</Notice>;
  const n = audit.findings.length;
  const pending = audit.findings.filter((f) => f.status === "Menunggu data penjualan").length;
  const top = audit.findings.filter((f) => f.priority !== "INFO").slice(0, 3);
  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ padding: "12px 14px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 800 }}>Insight stok · 7 hari</span>
        <button type="button" onClick={() => onGo("audit")} style={{ border: "none", background: "none", color: C.brand, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>Semua ›</button>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "0 14px 10px", flexWrap: "wrap" }}>
        {[...PRIORITY].reverse().map((p) => {
          const c = audit.findings.filter((f) => f.priority === p).length;
          const [bg, fg] = PRIORITY_COLOR[p];
          return <span key={p} style={{ background: bg, color: fg, fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999 }}>{PRIORITY_LABEL[p]} {c}</span>;
        })}
      </div>
      <div style={{ padding: "0 14px 10px", fontSize: 13, color: C.ink }}>
        {n === 0
          ? "Belum ada kejanggalan. Temuan muncul setelah barang di-SO minimal 2 kali."
          : `${n} hal perlu diperiksa${pending ? `, ${pending} menunggu data penjualan untuk dipastikan` : ""}.`}
      </div>
      {top.map((f, i) => <FindingRow key={i} f={f} itemsById={itemsById} />)}
    </div>
  );
}
