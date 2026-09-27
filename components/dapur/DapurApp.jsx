"use client";
// Modul Dapur: SO shift, waste, produksi, ringkasan stok, kelola bahan & resep.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { LOKASI_LABEL, allowedLokasi, defaultLokasi, canManageMaster } from "../../lib/inventoryLogic";
import { loadItems, loadRecipes, loadStockSnapshot, loadEvents, loadSoTemplates } from "../../lib/inventoryRepo";
import { C, Chips, Notice } from "./ui";
import SoForm from "./SoForm";
import WasteForm from "./WasteForm";
import ProduksiForm from "./ProduksiForm";
import Ringkasan from "./Ringkasan";
import KelolaBahan from "./KelolaBahan";

const TABS = [
  { id: "so", label: "SO Shift" },
  { id: "waste", label: "Waste" },
  { id: "produksi", label: "Produksi" },
  { id: "ringkasan", label: "Stok & Riwayat" },
  { id: "kelola", label: "Kelola", manager: true },
];

function readTab() {
  try { return new URLSearchParams(window.location.search).get("tab"); } catch { return null; }
}

export default function DapurApp({ bizId, user }) {
  const role = user?.role || "kasir";
  const isManager = canManageMaster(role);
  const lokasiOptions = allowedLokasi(user);
  const tabs = TABS.filter((t) => !t.manager || isManager);

  const [tab, setTab] = useState("so");
  const [lokasi, setLokasi] = useState(defaultLokasi(user));
  const [items, setItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [events, setEvents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [wastePrefill, setWastePrefill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = readTab();
    if (t && tabs.some((x) => x.id === t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(async () => {
    if (!bizId) return;
    setLoading(true); setErr("");
    try {
      const [it, rc, sn, ev, tp] = await Promise.all([
        loadItems(bizId), loadRecipes(bizId), loadStockSnapshot(bizId),
        loadEvents(bizId, { lokasi: role === "kasir" ? lokasi : null, limit: 60 }),
        // Daftar SO outlet opsional: kalau tabel belum dimigrasi, form tetap jalan pakai daftar bahan.
        loadSoTemplates(bizId).catch(() => []),
      ]);
      setItems(it); setRecipes(rc); setSnapshot(sn); setEvents(ev); setTemplates(tp);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [bizId, role, lokasi]);

  useEffect(() => { reload(); }, [reload]);
  const clearWastePrefill = useCallback(() => setWastePrefill(null), []);

  const lokasiScope = useMemo(() => (role === "kasir" ? lokasiOptions : ["GDG", "KBU", "KSM", "SMT"]), [role, lokasiOptions]);

  if (!lokasi) {
    return (
      <Shell>
        <Notice kind="warn">Akun Anda belum punya outlet. Minta owner/admin mengatur outlet di Kelola Staf.</Notice>
      </Shell>
    );
  }

  const needsLokasi = tab === "so" || tab === "waste" || tab === "produksi";

  return (
    <Shell onReload={reload} loading={loading}>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{ flex: "0 0 auto", padding: "9px 14px", borderRadius: 999, fontWeight: 800, fontSize: 13, cursor: "pointer",
              border: "none", background: tab === t.id ? C.brand : "#fff", color: tab === t.id ? "#fff" : C.ink }}>
            {t.label}
          </button>
        ))}
      </div>

      {needsLokasi && (
        <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.line}`, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Lokasi</div>
          {lokasiOptions.length > 1
            ? <Chips options={lokasiOptions} value={lokasi} onChange={setLokasi} getLabel={(l) => LOKASI_LABEL[l] || l} />
            : <div style={{ fontWeight: 800 }}>{LOKASI_LABEL[lokasi] || lokasi}</div>}
        </div>
      )}

      {err && <Notice kind="bad">Gagal memuat data: {err}</Notice>}
      {loading && !items.length ? (
        <div style={{ padding: 30, textAlign: "center", color: C.sub }}>Memuat…</div>
      ) : (
        <>
          {tab === "so" && (
            <SoForm bizId={bizId} user={user} lokasi={lokasi} items={items} templates={templates} snapshot={snapshot} onSaved={reload}
              onWasteFromWa={(w) => { setWastePrefill(w); setTab("waste"); }} />
          )}
          {tab === "waste" && (
            <WasteForm bizId={bizId} user={user} lokasi={lokasi} items={items} prefill={wastePrefill}
              onPrefillUsed={clearWastePrefill} onSaved={reload} />
          )}
          {tab === "produksi" && <ProduksiForm bizId={bizId} user={user} lokasi={lokasi} items={items} recipes={recipes} snapshot={snapshot} onSaved={reload} />}
          {tab === "ringkasan" && (
            <Ringkasan items={items} snapshot={snapshot} events={events} lokasiScope={lokasiScope}
              canDelete={role === "owner" || role === "admin"} onChanged={reload} />
          )}
          {tab === "kelola" && isManager && <KelolaBahan bizId={bizId} items={items} recipes={recipes} templates={templates} onChanged={reload} />}
        </>
      )}
    </Shell>
  );
}

function Shell({ children, onReload, loading }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "12px 16px 60px", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/dashboard" aria-label="Kembali" style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 12, background: "#fff", border: `1px solid ${C.line}` }}>
            <ArrowLeft size={18} color={C.ink} />
          </a>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Dapur & Stok</div>
            <div style={{ fontSize: 12, color: C.sub }}>SO shift · waste · produksi</div>
          </div>
          {onReload && (
            <button type="button" onClick={onReload} aria-label="Muat ulang" disabled={loading}
              style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 12, background: "#fff", border: `1px solid ${C.line}`, cursor: "pointer" }}>
              <RefreshCw size={16} color={C.ink} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
