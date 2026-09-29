"use client";
// Halaman pertama modul Dapur: apa yang harus dikerjakan hari ini di lokasi ini (bukan saldo).
// Dapur KBU/KSM & kasir: SO akhir shift, terima kiriman, permintaan, waste, bahan menipis.
// Gudang (purchasing): SO gudang, permintaan outlet, produksi, kiriman di jalan.
// Owner/admin: status SO semua lokasi hari ini + nilai stok.

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Circle, AlertTriangle } from "lucide-react";
import {
  LOKASI, LOKASI_LABEL, PRIORITY, PRIORITY_LABEL, summarizeDapurToday, soAreaStatus, stokMenipis, todayJakarta, fmtJam, fmtRp, fmtQty,
} from "../../lib/inventoryLogic";
import { loadDapurToday } from "../../lib/inventoryRepo";
import { C, card, Notice } from "./ui";
import StockValueCard from "./StockValueCard";
import { CAP, dapurAccess } from "../../lib/dapurAccess";
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

function ActionChip({ label: text, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ flex: "1 1 auto", padding: "10px 12px", borderRadius: 12, border: `1px solid ${C.line}`, background: "#fff", color: C.ink, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
      {text}
    </button>
  );
}

export default function HariIni({ bizId, user, access, lokasi, items, snapshot, onGo }) {
  const acc = access || dapurAccess(user);
  const manager = acc.isOwner;
  const doesGudang = acc.can(CAP.SO) && !acc.isOutlet && !manager; // gudang / purchasing merangkap gudang
  const doesBelanja = acc.can(CAP.BELANJA);
  // Lokasi yang dipantau: outlet → outletnya, gudang → GDG, purchasing murni → semua (info stok minimum), owner → semua.
  const scopeLokasi = acc.isOutlet ? acc.outlet : doesGudang ? "GDG" : null;
  const today = todayJakarta();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    loadDapurToday(bizId, { lokasi: scopeLokasi, today, area: acc.isOutlet ? acc.area : null })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message || String(e)));
    return () => { alive = false; };
  }, [bizId, scopeLokasi, today, acc.isOutlet, acc.area]);

  const st = useMemo(() => (data ? summarizeDapurToday({ ...data, lokasi: scopeLokasi, userId: user?.id, today }) : null), [data, scopeLokasi, user?.id, today]);
  const masukHariIni = useMemo(() => (data?.events || []).filter((e) => e.jenis === "masuk"), [data]);

  // Outlet: stok outletnya. Purchasing / gudang / owner: semua lokasi (belanja & kirim untuk outlet juga).
  const alertLokasi = acc.isOutlet ? [acc.outlet] : acc.lihatLokasi;
  const menipis = useMemo(() => stokMenipis(snapshot, items, alertLokasi).slice(0, 20), [snapshot, items, alertLokasi]);

  if (err) return <Notice kind="bad">Status hari ini belum bisa dimuat: {err}</Notice>;
  if (!st) return <div style={{ padding: 30, textAlign: "center", color: C.sub }}>Memuat…</div>;

  const areaName = acc.area === "dapur" ? "Dapur" : "Bar";
  // Lokasi yang belum pernah di-SO: tugas pertama adalah SO awal (dasar stok & nilai awal).
  const belumPernahSo = (l) => !(snapshot || []).some((r) => r.lokasi === l);
  const extraActions = [
    acc.can(CAP.WASTE) && { tab: "waste", label: "+ Catat waste" },
    acc.can(CAP.PRODUKSI) && { tab: "produksi", label: "+ Produksi" },
    acc.can(CAP.KIRIM_MINTA) && { tab: "kirim", label: "+ Minta stok ke gudang" },
    acc.can(CAP.KIRIM_KIRIM) && { tab: "kirim", label: "+ Kirim stok ke outlet" },
    acc.can(CAP.MASUK) && !doesBelanja && { tab: "masuk", label: "+ Barang masuk" },
  ].filter(Boolean);
  const title = manager ? "Hari ini · semua lokasi" : `Hari ini · ${acc.isOutlet ? `${LOKASI_LABEL[acc.outlet] || acc.outlet} ${areaName}` : acc.label}`;
  // SO outlet dihitung per bagian (dapur/bar); Samtaro tanpa bagian = SO apa pun di outlet itu.
  const soArea = acc.isOutlet ? st.soByArea?.[`${acc.outlet}:${acc.area}`] || st.soByArea?.[`${acc.outlet}:`] : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px 8px", fontWeight: 800 }}>{title}</div>

        {acc.isOutlet && (
          <>
            <Task done={!!soArea} title={belumPernahSo(acc.outlet) ? `SO awal ${areaName}` : `SO ${areaName} akhir shift`}
              sub={soArea ? `Terkirim ${fmtJam(soArea.created_at)} · ${soArea.created_by_name || "—"}` : "Belum SO hari ini"}
              onClick={() => onGo("so")} />
            {st.kirimanMasuk > 0 && (
              <Task urgent title={`Terima kiriman gudang (${st.kirimanMasuk})`} sub="Barang sudah dikirim — cek jumlahnya lalu terima" onClick={() => onGo("kirim")} />
            )}
          </>
        )}

        {doesGudang && (
          <>
            <Task done={st.soMine || st.soCount > 0} title={belumPernahSo("GDG") ? "SO awal Gudang (hitung semua barang)" : "SO Gudang"}
              sub={st.soMine ? `Terkirim ${fmtJam(st.soMineAt)}` : st.soCount ? `Sudah SO ${fmtJam(st.soLast?.created_at)} (${st.soLast?.created_by_name || "—"})` : "Belum SO hari ini"}
              onClick={() => onGo("so")} />
            {st.permintaanMenunggu > 0 && (
              <Task urgent title={`Permintaan outlet (${st.permintaanMenunggu})`} sub="Isi jumlah yang dikirim ke outlet" onClick={() => onGo("kirim")} />
            )}
          </>
        )}

        {doesBelanja && (
          <>
            <Task title="Catat belanja hari ini" sub="Buka catatan keuangan untuk mencatat pengeluaran belanja"
              onClick={() => { window.location.href = "/dashboard"; }} />
            <Task done={masukHariIni.length > 0} title="Barang masuk dari pembelian"
              sub={masukHariIni.length ? `${masukHariIni.length} catatan hari ini · ${fmtRp(masukHariIni.reduce((a, e) => a + Number(e.total_nilai || 0), 0))}` : "Catat barang yang datang supaya stok & nilainya tercatat"}
              onClick={() => onGo("masuk")} />
          </>
        )}

        {manager && (
          <>
            {soAreaStatus(st.soByArea).map((a) => (
              <Task key={a.label} done={!!a.event} title={`SO ${a.label}`}
                sub={a.event ? `Terkirim ${fmtJam(a.event.created_at)} · ${a.event.created_by_name || "—"}` : "Belum ada SO hari ini"}
                onClick={() => onGo("ringkasan")} />
            ))}
            {st.permintaanMenunggu > 0 && (
              <Task urgent title={`Permintaan menunggu gudang (${st.permintaanMenunggu})`}
                sub={st.kirimanMasuk ? `${st.kirimanMasuk} kiriman belum diterima outlet` : "Belum diproses gudang"}
                onClick={() => onGo("kirim")} />
            )}
            <div style={{ padding: "10px 14px", fontSize: 12, color: C.sub, borderBottom: `1px solid ${C.line}` }}>
              Waste hari ini (semua lokasi): {st.wasteCount ? `${st.wasteCount} catatan · ${fmtRp(st.wasteNilai)}` : "belum ada"}
              {st.kirimanMasuk ? ` · ${st.kirimanMasuk} kiriman di jalan` : ""}
            </div>
          </>
        )}

        {!manager && st.wasteCount > 0 && (
          <div style={{ padding: "10px 14px", fontSize: 12, color: C.sub }}>
            Waste hari ini: {st.wasteCount} catatan · {fmtRp(st.wasteNilai)}
          </div>
        )}
      </div>

      {/* Aksi tambahan: bukan tugas wajib, jadi tidak ditandai "belum selesai". */}
      {!manager && extraActions.length > 0 && (
        <div style={{ ...card, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.sub }}>Aksi lain (kalau ada)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {extraActions.map((a) => <ActionChip key={a.tab + a.label} label={a.label} onClick={() => onGo(a.tab)} />)}
          </div>
        </div>
      )}

      {menipis.length > 0 && (
        <div style={{ ...card, display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{doesBelanja && !doesGudang ? "Kebutuhan: di bawah stok minimum" : "Menipis / habis (SO terakhir)"}</div>
          {menipis.map((r) => (
            <div key={`${r.lokasi}-${r.item_id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
              <span>{r.status === "habis" ? "🔴" : "🟠"} {r.item.nama}{acc.isOutlet ? "" : ` · ${r.lokasi}`}</span>
              <span style={{ color: C.sub }}>{fmtQty(r.qty)} / min {fmtQty(r.item.min_stok)} {r.item.satuan}</span>
            </div>
          ))}
          {acc.can(CAP.KIRIM_MINTA) && (
            <button type="button" onClick={() => onGo("kirim")}
              style={{ marginTop: 4, border: "none", background: C.brandSoft, color: C.brand, borderRadius: 10, padding: "9px 12px", fontWeight: 800, cursor: "pointer" }}>
              Buat permintaan stok
            </button>
          )}
        </div>
      )}

      {manager && <AnomaliCard bizId={bizId} items={items} onGo={onGo} />}

      {(manager || doesGudang) && (
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
