"use client";
// Modul Dapur: SO shift, waste, produksi, ringkasan stok, kelola bahan & resep.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LogOut, RefreshCw } from "lucide-react";
import { LOKASI_LABEL } from "../../lib/inventoryLogic";
import { CAP, NO_ACCESS_MSG, dapurAccess, recipesForArea, visibleTabs } from "../../lib/dapurAccess";
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

function readTab() {
  try { return new URLSearchParams(window.location.search).get("tab"); } catch { return null; }
}

function writeTab(t) {
  try {
    const u = new URL(window.location.href);
    if (t && t !== "hari") u.searchParams.set("tab", t); else u.searchParams.delete("tab");
    window.history.replaceState(null, "", u.toString());
  } catch { /* abaikan */ }
}

export default function DapurApp({ bizId, user, signOut }) {
  // Semua izin tampilan dari satu tempat (lib/dapurAccess.js).
  const access = useMemo(() => dapurAccess(user), [user]);
  const tabs = useMemo(() => visibleTabs(access), [access]);

  const [tab, setTabState] = useState("hari");
  const [denied, setDenied] = useState("");
  const [lokasi, setLokasi] = useState(access.defaultLokasi);
  const [items, setItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [events, setEvents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [wastePrefill, setWastePrefill] = useState(null);
  const [bukaMinta, setBukaMinta] = useState(false); // dari SO: langsung buka form permintaan (sudah terisi usulan)
  const [menus, setMenus] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [menuPrefill, setMenuPrefill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const tabRefs = useRef({});
  const tabBarRef = useRef(null);
  const [tabMore, setTabMore] = useState(false);

  // Pindah tab hanya ke tab yang diizinkan; selain itu kembali ke Hari Ini dengan pesan.
  const setTab = useCallback((t) => {
    if (access.canTab(t)) {
      setTabState(t); setDenied(""); writeTab(t);
    } else {
      setTabState("hari"); setDenied(NO_ACCESS_MSG); writeTab("hari");
    }
  }, [access]);

  // URL langsung (?tab=…) tetap diperiksa izinnya.
  useEffect(() => {
    const t = readTab();
    if (t) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lokasi mengikuti tab & penugasan: outlet/gudang terkunci, Barang Masuk purchasing boleh pilih.
  const lokasiOptions = useMemo(() => access.lokasiOptions(tab), [access, tab]);
  useEffect(() => {
    if (lokasiOptions.length && !lokasiOptions.includes(lokasi)) setLokasi(lokasiOptions.includes(access.defaultLokasi) ? access.defaultLokasi : lokasiOptions[0]);
  }, [lokasiOptions, lokasi, access.defaultLokasi]);

  // Tab aktif selalu terlihat di layar HP (digeser ke tengah).
  useEffect(() => {
    const el = tabRefs.current[tab];
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    const bar = tabBarRef.current;
    if (bar) setTimeout(() => setTabMore(bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4), 350);
  }, [tab, tabs.length]);

  const reload = useCallback(async () => {
    if (!bizId || access.key === "none") { setLoading(false); return; }
    setLoading(true); setErr("");
    try {
      const [it, rc, sn, ev, tp] = await Promise.all([
        loadItems(bizId), loadRecipes(bizId), loadStockSnapshot(bizId),
        loadEvents(bizId, { lokasi: access.isOutlet ? access.outlet : null, limit: 60 }),
        // Daftar SO outlet opsional: kalau tabel belum dimigrasi, form tetap jalan pakai daftar bahan.
        loadSoTemplates(bizId).catch(() => []),
      ]);
      setItems(it); setRecipes(rc); setSnapshot(sn); setEvents(ev); setTemplates(tp);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [bizId, access]);

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

  // Akun dapur hanya punya modul ini: tombol kembali diganti Keluar.
  const onLogout = user?.role === "dapur" ? signOut : null;

  if (access.key === "none" || !lokasi) {
    return (
      <Shell onLogout={onLogout}>
        <Notice kind="warn">
          {access.key === "none" && user?.role && !["kasir", "dapur"].includes(user.role)
            ? "Peran akun ini belum punya akses ke modul Dapur & Stok."
            : "Akun Anda belum punya outlet. Minta owner/admin mengatur outlet di Kelola Staf."}
        </Notice>
      </Shell>
    );
  }

  const needsLokasi = tab === "so" || tab === "waste" || tab === "masuk" || tab === "produksi";
  const is = (t) => tab === t && access.canTab(t);

  return (
    <Shell onReload={reload} loading={loading} onLogout={onLogout} subtitle={contextLine(access)}>
      {/* Petunjuk geser: tepi kanan memudar selama masih ada tab di kanan. */}
      <div onScroll={(e) => { const el = e.currentTarget; setTabMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4); }}
        ref={tabBarRef}
        style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none",
          WebkitMaskImage: tabMore ? "linear-gradient(to right, #000 82%, transparent)" : "none",
          maskImage: tabMore ? "linear-gradient(to right, #000 82%, transparent)" : "none" }}>
        {tabs.map((t) => (
          <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} type="button" onClick={() => setTab(t.id)}
            style={{ flex: "0 0 auto", padding: "9px 14px", borderRadius: 999, fontWeight: 800, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
              border: tab === t.id ? "none" : `1px solid ${C.line}`, background: tab === t.id ? C.brand : "#fff", color: tab === t.id ? "#fff" : C.ink }}>
            {t.label}
          </button>
        ))}
      </div>

      {denied && <Notice kind="warn">{denied}</Notice>}

      {needsLokasi && lokasiOptions.length > 1 && (
        <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.line}`, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Lokasi</div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {lokasiOptions.map((l) => (
              <button key={l} type="button" onClick={() => setLokasi(l)}
                style={{ flex: "0 0 auto", padding: "8px 12px", borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: "pointer",
                  border: `1px solid ${l === lokasi ? C.brand : C.line}`, background: l === lokasi ? C.brand : "#fff", color: l === lokasi ? "#fff" : C.ink }}>
                {LOKASI_LABEL[l] || l}
              </button>
            ))}
          </div>
        </div>
      )}

      {err && <Notice kind="bad">Gagal memuat data: {err}</Notice>}
      {loading && !items.length ? (
        <div style={{ padding: 30, textAlign: "center", color: C.sub }}>Memuat…</div>
      ) : (
        <>
          {is("hari") && (
            <HariIni bizId={bizId} user={user} access={access} lokasi={lokasi} items={items} snapshot={snapshot} onGo={setTab} />
          )}
          {is("so") && (
            <SoForm bizId={bizId} user={user} access={access} lokasi={lokasi} items={items} templates={templates} snapshot={snapshot} onSaved={reload}
              onWasteFromWa={(w) => { setWastePrefill(w); setTab("waste"); }}
              onBuatPermintaan={() => { setBukaMinta(true); setTab("kirim"); }} />
          )}
          {is("waste") && (
            <GerakForm mode="waste" bizId={bizId} user={user} access={access} lokasi={lokasi} items={items} templates={templates} prefill={wastePrefill}
              onPrefillUsed={clearWastePrefill} onSaved={reload} />
          )}
          {is("masuk") && (
            <GerakForm key={`masuk-${lokasi}`} mode="masuk" bizId={bizId} user={user} access={access} lokasi={lokasi} items={items} templates={templates} onSaved={reload} />
          )}
          {is("audit") && <AuditStok bizId={bizId} user={user} items={items} />}
          {is("produksi") && (
            <ProduksiForm bizId={bizId} user={user} lokasi={lokasi} items={items}
              recipes={recipesForArea(recipes, templates, lokasi, access.area)} snapshot={snapshot} onSaved={reload} />
          )}
          {is("kirim") && <KirimStok bizId={bizId} user={user} access={access} items={items} templates={templates} onSaved={reload}
            bukaMinta={bukaMinta} onDibuka={() => setBukaMinta(false)} />}
          {is("ringkasan") && (
            <Ringkasan bizId={bizId} items={items} snapshot={snapshot} events={events} lokasiScope={access.lihatLokasi}
              canDelete={access.can(CAP.HAPUS_RIWAYAT)} onChanged={reload} />
          )}
          {is("penjualan") && (
            <Penjualan bizId={bizId} user={user} menus={menus} aliases={aliases} onChanged={reloadMenus}
              onBuatResep={(p) => { setMenuPrefill(p); setTab("menu"); }} />
          )}
          {is("menu") && (
            <ResepMenu bizId={bizId} access={access} items={items} templates={templates} menus={menus} prefill={menuPrefill}
              onPrefillUsed={clearMenuPrefill} onChanged={reloadMenus} />
          )}
          {is("kelola") && <KelolaBahan bizId={bizId} access={access} items={items} recipes={recipes} templates={templates} onChanged={reload} />}
        </>
      )}
    </Shell>
  );
}

/** Konteks kerja singkat di header: lokasi & bagian yang terkunci untuk akun ini. */
function contextLine(access) {
  if (access.isOutlet) return `${LOKASI_LABEL[access.outlet] || access.outlet} · ${access.area === "dapur" ? "Dapur" : "Bar / Kasir"}`;
  if (access.isOwner) return "Owner · semua lokasi";
  return access.label;
}

function Shell({ children, onReload, loading, onLogout, subtitle }) {
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
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 700 }}>{subtitle ? `📍 ${subtitle}` : "Stok, SO, waste, produksi"}</div>
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
