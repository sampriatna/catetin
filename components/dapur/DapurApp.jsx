"use client";
// Modul Dapur: SO shift, waste, produksi, ringkasan stok, kelola bahan & resep.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, LogOut, RefreshCw } from "lucide-react";
import { LOKASI_LABEL, allowedLokasi, defaultLokasi, canManageMaster, isOutletLocked } from "../../lib/inventoryLogic";
import { loadItems, loadRecipes, loadStockSnapshot, loadEvents, loadSoTemplates, loadMenus, loadMenuAliases } from "../../lib/inventoryRepo";
import { C, Notice } from "./ui";
import SoForm from "./SoForm";
import GerakForm from "./GerakForm";
import AuditStok from "./AuditStok";
import ProduksiForm from "./ProduksiForm";
import Ringkasan from "./Ringkasan";
import KelolaBahan from "./KelolaBahan";
import KirimStok from "./KirimStok";
import HariIni from "./HariIni";
import Penjualan from "./Penjualan";
import ResepMenu from "./ResepMenu";

const TABS = [
  { id: "hari", label: "Hari Ini" },
  { id: "so", label: "SO Shift" },
  { id: "waste", label: "Waste" },
  { id: "masuk", label: "Barang Masuk" },
  { id: "produksi", label: "Produksi" },
  { id: "kirim", label: "Kirim Stok" },
  { id: "audit", label: "Audit", owner: true },
  { id: "penjualan", label: "Penjualan", owner: true },
  { id: "menu", label: "Resep Menu", manager: true },
  { id: "ringkasan", label: "Stok & Riwayat" },
  { id: "kelola", label: "Kelola", manager: true },
];

function readTab() {
  try { return new URLSearchParams(window.location.search).get("tab"); } catch { return null; }
}

export default function DapurApp({ bizId, user, signOut }) {
  const role = user?.role || "kasir";
  const isManager = canManageMaster(role);
  const lokasiOptions = allowedLokasi(user);
  const isOwner = role === "owner" || role === "admin";
  const tabs = TABS.filter((t) => (!t.manager || isManager) && (!t.owner || isOwner));

  const [tab, setTab] = useState("hari");
  const [lokasi, setLokasi] = useState(defaultLokasi(user));
  const [items, setItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [events, setEvents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [wastePrefill, setWastePrefill] = useState(null);
  const [menus, setMenus] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [menuPrefill, setMenuPrefill] = useState(null);
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
        loadEvents(bizId, { lokasi: isOutletLocked(role) ? lokasi : null, limit: 60 }),
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
  const clearMenuPrefill = useCallback(() => setMenuPrefill(null), []);

  // Resep menu & nama POS hanya dimuat untuk tab yang memakainya.
  const needMenus = tab === "penjualan" || tab === "menu";
  const reloadMenus = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([loadMenus(bizId), loadMenuAliases(bizId)]);
      setMenus(m); setAliases(a);
    } catch (e) {
      setErr(e.message || String(e));
    }
  }, [bizId]);
  useEffect(() => { if (needMenus && bizId) reloadMenus(); }, [needMenus, bizId, reloadMenus]);

  const lokasiScope = useMemo(() => (isOutletLocked(role) ? lokasiOptions : ["GDG", "KBU", "KSM", "SMT"]), [role, lokasiOptions]);
  // Akun dapur hanya punya modul ini: tombol kembali diganti Keluar.
  const onLogout = role === "dapur" ? signOut : null;

  if (!lokasi) {
    return (
      <Shell onLogout={onLogout}>
        <Notice kind="warn">Akun Anda belum punya outlet. Minta owner/admin mengatur outlet di Kelola Staf.</Notice>
      </Shell>
    );
  }

  const needsLokasi = tab === "so" || tab === "waste" || tab === "masuk" || tab === "produksi";

  return (
    <Shell onReload={reload} loading={loading} onLogout={onLogout}>
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
          {lokasiOptions.length > 1 ? (
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {lokasiOptions.map((l) => (
                <button key={l} type="button" onClick={() => setLokasi(l)}
                  style={{ flex: "0 0 auto", padding: "8px 12px", borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: "pointer",
                    border: `1px solid ${l === lokasi ? C.brand : C.line}`, background: l === lokasi ? C.brand : "#fff", color: l === lokasi ? "#fff" : C.ink }}>
                  {LOKASI_LABEL[l] || l}
                </button>
              ))}
            </div>
          ) : <div style={{ fontWeight: 800 }}>{LOKASI_LABEL[lokasi] || lokasi}</div>}
        </div>
      )}

      {err && <Notice kind="bad">Gagal memuat data: {err}</Notice>}
      {loading && !items.length ? (
        <div style={{ padding: 30, textAlign: "center", color: C.sub }}>Memuat…</div>
      ) : (
        <>
          {tab === "hari" && (
            <HariIni bizId={bizId} user={user} lokasi={lokasi} items={items} snapshot={snapshot}
              onGo={(t) => setTab(tabs.some((x) => x.id === t) ? t : "so")} />
          )}
          {tab === "so" && (
            <SoForm bizId={bizId} user={user} lokasi={lokasi} items={items} templates={templates} snapshot={snapshot} onSaved={reload}
              onWasteFromWa={(w) => { setWastePrefill(w); setTab("waste"); }} />
          )}
          {tab === "waste" && (
            <GerakForm mode="waste" bizId={bizId} user={user} lokasi={lokasi} items={items} templates={templates} prefill={wastePrefill}
              onPrefillUsed={clearWastePrefill} onSaved={reload} />
          )}
          {tab === "masuk" && (
            <GerakForm key={`masuk-${lokasi}`} mode="masuk" bizId={bizId} user={user} lokasi={lokasi} items={items} templates={templates} onSaved={reload} />
          )}
          {tab === "audit" && isOwner && <AuditStok bizId={bizId} user={user} items={items} />}
          {tab === "produksi" && <ProduksiForm bizId={bizId} user={user} lokasi={lokasi} items={items} recipes={recipes} snapshot={snapshot} onSaved={reload} />}
          {tab === "kirim" && <KirimStok bizId={bizId} user={user} items={items} templates={templates} onSaved={reload} />}
          {tab === "ringkasan" && (
            <Ringkasan bizId={bizId} items={items} snapshot={snapshot} events={events} lokasiScope={lokasiScope}
              canDelete={role === "owner" || role === "admin"} onChanged={reload} />
          )}
          {tab === "penjualan" && isOwner && (
            <Penjualan bizId={bizId} user={user} menus={menus} aliases={aliases} onChanged={reloadMenus}
              onBuatResep={(p) => { setMenuPrefill(p); setTab("menu"); }} />
          )}
          {tab === "menu" && isManager && (
            <ResepMenu bizId={bizId} items={items} templates={templates} menus={menus} prefill={menuPrefill}
              onPrefillUsed={clearMenuPrefill} onChanged={reloadMenus} />
          )}
          {tab === "kelola" && isManager && <KelolaBahan bizId={bizId} items={items} recipes={recipes} templates={templates} onChanged={reload} />}
        </>
      )}
    </Shell>
  );
}

function Shell({ children, onReload, loading, onLogout }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "12px 16px 60px", display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onLogout ? (
            <button type="button" onClick={() => { if (window.confirm("Keluar dari akun ini?")) onLogout(); }} aria-label="Keluar"
              style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 12, background: "#fff", border: `1px solid ${C.line}`, cursor: "pointer" }}>
              <LogOut size={16} color={C.ink} />
            </button>
          ) : (
            <a href="/dashboard" aria-label="Kembali" style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 12, background: "#fff", border: `1px solid ${C.line}` }}>
              <ArrowLeft size={18} color={C.ink} />
            </a>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Dapur & Stok</div>
            <div style={{ fontSize: 12, color: C.sub }}>SO shift · waste · produksi · kirim stok · penjualan</div>
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
