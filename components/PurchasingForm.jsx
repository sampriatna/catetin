// ============================================================
// components/PurchasingForm.jsx
// Form input pengeluaran purchasing untuk NF3
// ============================================================
// Props:
//   s       — view/state dari NF3App (wallets, categories, currentUser, dst)
//   onSave  — addTx() dari NF3App
//   onClose — tutup overlay
//
// Integrasi di NF3App.jsx (ganti baris catat):
//   import PurchasingForm from "../../../components/PurchasingForm";
//   {catat && user.role === "purchasing"
//     ? <PurchasingForm s={view} onSave={addTx} onClose={() => setCatat(false)} />
//     : catat && <CatatTransaksi s={view} onSave={addTx} onClose={() => setCatat(false)} />}
// ============================================================

"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Mic, Loader2, Sparkles } from "lucide-react";
import { visibleWallets, visibleCategories } from "../lib/rbac";
import { addPurchasingExpense, PURCHASING_OUTLETS, formatRupiah, checkPurchasingFloor, purchasingOutletOptions } from "../lib/purchasingExpense";
import { ensurePurchasingCategories } from "../lib/purchasingCategories";
import { walletBalance } from "../lib/kasirHarian";
import { walletOptionLabel } from "../lib/walletDisplay";
import { todayLocal } from "../lib/laporanKeuangan";
import { aiParse } from "../lib/appState";
import { supabase } from "../lib/supabaseClient";

// ------------------------------------------------------------
// Helper: upload struk ke Supabase Storage
// ------------------------------------------------------------
async function uploadReceipt(file, businessId) {
  if (!file) return null;
  try {
    const ext      = file.name.split(".").pop();
    const path     = `${businessId}/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage
      .from("receipts")
      .upload(path, file, { upsert: false });
    if (error) { console.warn("[PurchasingForm] upload struk gagal:", error.message); return null; }
    const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(data.path);
    return urlData?.publicUrl || null;
  } catch (e) {
    console.warn("[PurchasingForm] upload error:", e);
    return null;
  }
}

// ------------------------------------------------------------
// Helper: format input nominal (tambah titik ribuan)
// ------------------------------------------------------------
function parseNominal(str) {
  return parseInt(str.replace(/\D/g, ""), 10) || 0;
}
function formatNominal(val) {
  if (!val) return "";
  return Number(val).toLocaleString("id-ID");
}

function calcItemsTotal(items) {
  return (items || []).reduce(
    (sum, i) => sum + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0),
    0
  );
}

function normItemText(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeParsedItems(items, amount) {
  const cleaned = (items || [])
    .filter((i) => i?.name)
    .map((i) => ({
      name: String(i.name).trim(),
      qty: Math.max(0, Number(i.qty) || 0),
      unit: String(i.unit || "pcs").trim() || "pcs",
      unitPrice: Math.max(0, Math.round(Number(i.unitPrice) || 0)),
    }))
    .filter((i) => i.name);

  // Dedup untuk hasil AI yang kadang mengulang barang yang sama.
  // Jika sama persis (nama+qty+unit), ambil nominal yang lebih kecil agar tidak overcount.
  const byKey = new Map();
  for (const item of cleaned) {
    const key = `${normItemText(item.name)}|${item.qty}|${normItemText(item.unit)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    const prevSubtotal = (Number(prev.qty) || 0) * (Number(prev.unitPrice) || 0);
    const curSubtotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
    if (curSubtotal > 0 && (prevSubtotal <= 0 || curSubtotal < prevSubtotal)) {
      byKey.set(key, item);
    }
  }
  const deduped = [...byKey.values()];

  const targetAmount = Math.round(Number(amount) || 0);
  const totalNow = calcItemsTotal(deduped);
  if (!(targetAmount > 0) || totalNow <= Math.round(targetAmount * 1.15)) {
    return deduped;
  }

  // Guard kasus "6 pcs total 30rb" yang kebaca jadi unitPrice 30rb.
  const normalized = deduped.map((i) => {
    const qty = Number(i.qty) || 0;
    const unitPrice = Number(i.unitPrice) || 0;
    if (qty > 1 && unitPrice > 0) {
      return { ...i, unitPrice: Math.max(1, Math.round(unitPrice / qty)) };
    }
    return i;
  });
  const normalizedTotal = calcItemsTotal(normalized);
  if (normalizedTotal > 0 && normalizedTotal < totalNow && normalizedTotal <= Math.round(targetAmount * 1.15)) {
    return normalized;
  }
  return deduped;
}

/** Total yang dipakai simpan: dari item jika ada harga baris, else input manual. */
function resolvePurchasingAmount(draft) {
  const itemsTotal = calcItemsTotal(draft.items);
  return itemsTotal > 0 ? itemsTotal : Math.round(Number(draft.amount) || 0);
}

// ------------------------------------------------------------
// Komponen item baris belanja
// ------------------------------------------------------------
function ItemRow({ item, index, onChange, onRemove }) {
  const subtotal = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 64px 84px 28px", gap: 5, alignItems: "center" }}>
        <input
          style={styles.inp}
          placeholder="Nama item"
          value={item.name}
          onChange={e => onChange(index, "name", e.target.value)}
        />
        <input
          style={styles.inp}
          type="number"
          placeholder="Qty"
          value={item.qty}
          onChange={e => onChange(index, "qty", e.target.value)}
        />
        <input
          style={styles.inp}
          placeholder="Satuan"
          value={item.unit}
          onChange={e => onChange(index, "unit", e.target.value)}
        />
        <input
          style={styles.inp}
          type="number"
          placeholder="Harga"
          value={item.unitPrice}
          onChange={e => onChange(index, "unitPrice", e.target.value)}
        />
        <button style={styles.delBtn} onClick={() => onRemove(index)} aria-label="Hapus baris">✕</button>
      </div>
      {subtotal > 0 && (
        <div style={{ fontSize: 11, color: "#888", textAlign: "right", marginTop: 3, paddingRight: 28 }}>
          Subtotal: {formatRupiah(subtotal)}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// STEP 1 — Form input
// ------------------------------------------------------------
function StepForm({ s, draft, setDraft, onNext, onClose }) {
  const categories = useMemo(
    () => ensurePurchasingCategories(s.categories || []),
    [s.categories]
  );
  const myWallets = visibleWallets(s.wallets, s.currentUser);
  const cats      = visibleCategories(categories, s.currentUser, "out");
  const outletOptions = useMemo(() => purchasingOutletOptions(s.currentUser), [s.currentUser]);
  const setupBlocked = cats.length === 0 || myWallets.length === 0;

  const fileRef   = useRef(null);
  const recRef    = useRef(null);
  const [preview, setPreview] = useState(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceErr, setVoiceErr] = useState("");

  const today = todayLocal();

  async function applyVoiceText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    setVoiceErr("");
    setVoiceBusy(true);
    try {
      const r = await aiParse({ mode: "purchasing", text: trimmed, categories: cats });
      const cat = cats.find(c => c.name.toLowerCase() === (r.category || "").toLowerCase()) || cats[0];
      const parsedItems = sanitizeParsedItems(r.items || [], r.amount).map((i) => ({
        ...i,
        qty: i.qty || "",
        unitPrice: i.unitPrice || "",
      }));
      const itemsTotal = parsedItems.reduce(
        (s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0),
        0
      );
      setDraft(d => {
        const nextItems = parsedItems.length ? parsedItems : d.items;
        const amount = itemsTotal > 0 ? itemsTotal : (r.amount || d.amount);
        return {
          ...d,
          amount,
          desc: r.desc || trimmed,
          categoryId: cat?.id || d.categoryId,
          supplier: r.supplier || d.supplier,
          items: nextItems,
        };
      });
    } catch {
      setVoiceErr("Gagal memahami suara. Coba lagi atau isi manual.");
    } finally {
      setVoiceBusy(false);
    }
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceErr("Browser belum support suara. Ketik di kotak di bawah.");
      return;
    }
    setVoiceErr("");
    const rec = new SR();
    recRef.current = rec;
    rec.lang = "id-ID";
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onerror = () => { setListening(false); setVoiceErr("Suara tidak terdengar. Coba lagi."); };
    rec.onend = () => setListening(false);
    rec.onresult = (e) => {
      setListening(false);
      applyVoiceText(e.results[0][0].transcript);
    };
    rec.start();
  }

  function set(key, val) {
    setDraft(d => ({ ...d, [key]: val }));
  }

  function handleNominal(e) {
    const raw = parseNominal(e.target.value);
    set("amount", raw);
    e.target.value = formatNominal(raw);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    set("receiptFile", file);
    setPreview(URL.createObjectURL(file));
  }

  function syncItems(items, prev) {
    const itemsTotal = calcItemsTotal(items);
    return {
      ...prev,
      items,
      amount: itemsTotal > 0 ? itemsTotal : prev.amount,
    };
  }

  function handleItemChange(idx, field, val) {
    setDraft(d => {
      const items = [...d.items];
      items[idx] = { ...items[idx], [field]: val };
      return syncItems(items, d);
    });
  }

  function addItem() {
    setDraft(d => syncItems([...d.items, { name: "", qty: "", unit: "", unitPrice: "" }], d));
  }

  function removeItem(idx) {
    setDraft(d => syncItems(d.items.filter((_, i) => i !== idx), d));
  }

  const itemsTotal = calcItemsTotal(draft.items);
  const amountFromItems = itemsTotal > 0;
  const displayAmount = resolvePurchasingAmount(draft);

  const canNext = displayAmount > 0 && draft.walletId && draft.categoryId
    && draft.outlet && draft.supplier.trim() !== "" && draft.date;

  return (
    <div style={styles.overlay}>
      <div style={styles.sheet}>

        {/* Header */}
        <div style={styles.header}>
          <button style={styles.iconBtn} onClick={onClose}>←</button>
          <span style={styles.headerTitle}>Catat pengeluaran</span>
          <span style={{ fontSize: 12, color: "#888" }}>1/2</span>
        </div>
        <div style={styles.stepBar}>
          <div style={{ ...styles.stepDot, background: "#378ADD" }} />
          <div style={{ ...styles.stepDot, background: "#e0e0e0" }} />
        </div>

        <div style={styles.body}>

          {setupBlocked && (
            <div style={{ ...styles.warnBox, marginBottom: 14, background: "#fcebeb", borderColor: "#f09595", color: "#791F1F" }}>
              {cats.length === 0 && myWallets.length === 0
                ? "Kategori belanja & dompet belum siap — hubungi Admin Keuangan."
                : cats.length === 0
                  ? "Kategori belanja belum tersedia — hubungi Admin Keuangan."
                  : "Belum ada dompet belanja aktif — minta Admin Keuangan aktifkan Kas Kecil / dompet purchasing."}
            </div>
          )}

          {/* Input suara — purchasing pakai bicara, bukan scan AI nota */}
          <div style={{ ...styles.card, marginBottom: 14, background: "#F5F3FF", border: "1px solid #C7D2FE" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Sparkles size={18} color="#6366F1" />
              <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>Bicara — isi otomatis</span>
            </div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 12, lineHeight: 1.45 }}>
              Ucapkan barang + nominal. Contoh: &quot;Beli ayam paha fillet 220 ribu dari Suplier&quot;
            </div>
            <button
              type="button"
              onClick={startVoice}
              disabled={voiceBusy || listening}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "none",
                background: "linear-gradient(135deg,#6366F1,#4F46E5)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                cursor: voiceBusy || listening ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                opacity: voiceBusy || listening ? 0.75 : 1,
              }}
            >
              {voiceBusy ? <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> : <Mic size={18} />}
              {listening ? "Mendengarkan…" : voiceBusy ? "Memproses…" : "Tap & bicara"}
            </button>
            <input
              placeholder="…atau ketik lalu Enter"
              onKeyDown={e => {
                if (e.key === "Enter" && e.target.value.trim()) {
                  applyVoiceText(e.target.value.trim());
                  e.target.value = "";
                }
              }}
              style={{ ...styles.inp, marginTop: 10 }}
            />
            {voiceErr && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#B91C1C" }}>{voiceErr}</div>
            )}
          </div>

          {/* Lokasi pembelian */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Lokasi pembelian <span style={{ color: "#e24b4a" }}>*</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {outletOptions.map(o => (
                <button
                  key={o.code}
                  style={{ ...styles.pill, ...(draft.outlet === o.code ? styles.pillActiveBlue : {}) }}
                  onClick={() => set("outlet", o.code)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Kategori */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Kategori <span style={{ color: "#e24b4a" }}>*</span></label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {cats.map(c => (
                <button
                  key={c.id}
                  style={{ ...styles.pill, ...(draft.categoryId === c.id ? styles.pillActiveAmber : {}) }}
                  onClick={() => set("categoryId", c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
            {draft.categoryId && (() => {
              const sel = cats.find(c => c.id === draft.categoryId);
              if (!sel?.description) return null;
              return (
                <p style={{ fontSize: 12, color: "#888780", marginTop: 8, marginBottom: 0, lineHeight: 1.45 }}>
                  {sel.description}
                </p>
              );
            })()}
          </div>

          {/* Dompet / sumber dana */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Sumber dana <span style={{ color: "#e24b4a" }}>*</span></label>
            <select
              style={styles.inp}
              value={draft.walletId}
              onChange={e => set("walletId", e.target.value)}
            >
              <option value="">Pilih dompet...</option>
              {myWallets.map(w => {
                const bal = walletBalance(w.id, s.wallets, s.transactions || []);
                const label = walletOptionLabel(w, bal, "IDR", s.currentUser, (n) => formatRupiah(n));
                return <option key={w.id} value={w.id}>{label}</option>;
              })}
            </select>
          </div>

          {/* Supplier */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Beli dari <span style={{ color: "#e24b4a" }}>*</span></label>
            <input
              style={styles.inp}
              placeholder="Pasar Jagasatru, Toko Pak Haji, dll."
              value={draft.supplier}
              onChange={e => set("supplier", e.target.value)}
            />
          </div>

          {/* Tanggal + catatan */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Tanggal <span style={{ color: "#e24b4a" }}>*</span></label>
            <input
              style={styles.inp}
              type="date"
              value={draft.date || today}
              onChange={e => set("date", e.target.value)}
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Catatan</label>
            <textarea
              style={{ ...styles.inp, resize: "none", lineHeight: 1.5 }}
              rows={2}
              placeholder="Misal: stok weekend, harga naik dari biasanya..."
              value={draft.desc}
              onChange={e => set("desc", e.target.value)}
            />
          </div>

          {/* Detail item */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              Detail item{" "}
              <span style={{ color: "#aaa", fontWeight: 400 }}>(opsional, disarankan)</span>
            </label>
            {draft.items.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 56px 64px 84px 28px", gap: 5, marginBottom: 6 }}>
                {["Item", "Qty", "Satuan", "Harga/unit", ""].map((h, i) => (
                  <span key={i} style={{ fontSize: 10, color: "#aaa", textAlign: i > 0 ? "center" : "left" }}>{h}</span>
                ))}
              </div>
            )}
            {draft.items.map((item, idx) => (
              <ItemRow
                key={idx}
                item={item}
                index={idx}
                onChange={handleItemChange}
                onRemove={removeItem}
              />
            ))}
            <button style={styles.addItemBtn} onClick={addItem}>
              + Tambah item
            </button>
            <div style={styles.divider} />
            <label style={styles.label}>
              Total belanja <span style={{ color: "#e24b4a" }}>*</span>
            </label>
            <div style={{ position: "relative" }}>
              <span style={styles.prefix}>Rp</span>
              <input
                style={{
                  ...styles.inp,
                  paddingLeft: 32,
                  fontSize: 16,
                  fontWeight: 500,
                  ...(amountFromItems ? styles.inpReadonly : {}),
                }}
                type="text"
                inputMode="numeric"
                placeholder="0"
                readOnly={amountFromItems}
                value={displayAmount ? formatNominal(displayAmount) : ""}
                onChange={e => {
                  if (amountFromItems) return;
                  set("amount", parseNominal(e.target.value));
                }}
                onBlur={e => {
                  if (amountFromItems) return;
                  handleNominal(e);
                }}
              />
            </div>
            <p style={{ fontSize: 11, color: "#888", marginTop: 6, marginBottom: 0, lineHeight: 1.45 }}>
              {amountFromItems
                ? "Dihitung otomatis dari qty × harga item di atas."
                : "Isi manual, atau tambahkan qty & harga per item — total akan terisi otomatis."}
            </p>
          </div>

          {/* Foto struk — arsip manual saja (bukan AI scan nota) */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              Lampiran struk{" "}
              <span style={{ color: "#aaa", fontWeight: 400 }}>(opsional, arsip — bukan scan AI)</span>
            </label>
            {preview
              ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <img src={preview} alt="Struk" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, border: "0.5px solid #ddd" }} />
                  <button
                    style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: "#e24b4a", color: "#fff", fontSize: 11, cursor: "pointer" }}
                    onClick={() => { setPreview(null); set("receiptFile", null); }}
                  >✕</button>
                </div>
              )
              : (
                <div style={styles.uploadBox} onClick={() => fileRef.current?.click()}>
                  <span style={{ fontSize: 22, color: "#bbb" }}>📷</span>
                  <span style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>Tap untuk foto atau pilih dari galeri</span>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFile} />
                </div>
              )
            }
          </div>

        </div>

        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

        {/* Footer */}
        <div style={styles.footer}>
          <button
            style={{ ...styles.btnPrimary, opacity: canNext && !setupBlocked ? 1 : 0.4 }}
            disabled={!canNext || setupBlocked}
            onClick={onNext}
          >
            Lanjut tinjau →
          </button>
          <div style={styles.poweredBy}>Powered by NF3</div>
        </div>

      </div>
    </div>
  );
}

// ------------------------------------------------------------
// STEP 2 — Review sebelum simpan
// ------------------------------------------------------------
function StepReview({ s, draft, onSave, onBack, onClose, onNew }) {
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [error,  setError]    = useState(null);

  const categories = useMemo(
    () => ensurePurchasingCategories(s.categories || []),
    [s.categories]
  );
  const cats      = visibleCategories(categories, s.currentUser, "out");
  const catName   = cats.find(c => c.id === draft.categoryId)?.name || draft.categoryId;
  const myWallets = visibleWallets(s.wallets, s.currentUser);
  const wallet    = myWallets.find(w => w.id === draft.walletId);
  const outletLabel = PURCHASING_OUTLETS.find(o => o.code === draft.outlet)?.label || draft.outlet;

  const displayAmount = resolvePurchasingAmount(draft);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const floorErr = checkPurchasingFloor(
        draft.walletId,
        displayAmount,
        s.wallets || [],
        s.transactions || [],
        s.currentUser
      );
      if (floorErr) throw new Error(floorErr);

      // Upload struk dulu kalau ada
      let receiptUrl = null;
      if (draft.receiptFile) {
        receiptUrl = await uploadReceipt(draft.receiptFile, s.business?.id);
      }

      // Normalisasi items — buang baris kosong
      const items = draft.items
        .filter(i => i.name.trim() !== "")
        .map(i => ({
          name:      i.name.trim(),
          qty:       Number(i.qty)       || 0,
          unit:      i.unit.trim()       || "pcs",
          unitPrice: Number(i.unitPrice) || 0,
          subtotal:  (Number(i.qty) || 0) * (Number(i.unitPrice) || 0),
        }));

      const ok = await addPurchasingExpense(onSave, {
        amount:     displayAmount,
        walletId:   draft.walletId,
        categoryId: draft.categoryId,
        outlet:     draft.outlet,
        supplier:   draft.supplier,
        date:       draft.date,
        desc:       draft.desc,
        receiptUrl,
        items,
        source:     "purchasing:manual",
      });

      if (ok === false) throw new Error("Transaksi ditolak — periksa role atau saldo dompet.");
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // --- Success state ---
  if (saved) {
    return (
      <div style={styles.overlay}>
        <div style={styles.sheet}>
          <div style={{ textAlign: "center", padding: "40px 24px" }}>
            <div style={styles.successIcon}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>Transaksi tersimpan</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
              {formatRupiah(displayAmount)} dicatat untuk lokasi {outletLabel}
            </div>
            <div style={{ ...styles.card, textAlign: "left", marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8, fontWeight: 500 }}>Ringkasan</div>
              <Row label="Lokasi pembelian"   val={outletLabel} />
              <Row label="Kategori" val={catName} />
              <Row label="Dari"     val={draft.supplier} />
              <Row label="Dompet"   val={wallet?.name || "—"} />
            </div>
            <button style={{ ...styles.btnPrimary, marginBottom: 8 }} onClick={() => { setSaved(false); onNew?.(); }}>
              Catat transaksi baru
            </button>
            <button style={styles.btnSecondary} onClick={onClose}>Selesai</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Review state ---
  return (
    <div style={styles.overlay}>
      <div style={styles.sheet}>

        <div style={styles.header}>
          <button style={styles.iconBtn} onClick={onBack}>←</button>
          <span style={styles.headerTitle}>Tinjau transaksi</span>
          <button style={{ ...styles.iconBtn, fontSize: 12, color: "#378ADD", border: "none", background: "none" }} onClick={onBack}>Edit</button>
        </div>
        <div style={styles.stepBar}>
          <div style={{ ...styles.stepDot, background: "#1D9E75" }} />
          <div style={{ ...styles.stepDot, background: "#378ADD" }} />
        </div>

        <div style={styles.body}>

          {/* Total */}
          <div style={{ ...styles.card, marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4, fontWeight: 500 }}>Total pengeluaran</div>
            <div style={{ fontSize: 28, fontWeight: 500 }}>{formatRupiah(displayAmount)}</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
              {draft.date} &nbsp;·&nbsp; {wallet?.name || "—"}
            </div>
          </div>

          {/* Info transaksi */}
          <div style={{ ...styles.card, marginBottom: 10 }}>
            <div style={styles.sectionTitle}>Info transaksi</div>
            <Row label="Lokasi pembelian" val={<Badge color="blue">{outletLabel}</Badge>} />
            <Row label="Kategori"     val={<Badge color="amber">{catName}</Badge>} />
            <Row label="Beli dari"    val={draft.supplier} />
            <Row label="Dompet"       val={wallet?.name || "—"} />
            <Row label="Dicatat oleh" val={s.currentUser?.name || "—"} last />
          </div>

          {/* Detail item */}
          {draft.items.filter(i => i.name.trim()).length > 0 && (
            <div style={{ ...styles.card, marginBottom: 10 }}>
              <div style={styles.sectionTitle}>Detail item</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Item", "Qty", "Satuan", "Subtotal"].map(h => (
                      <th key={h} style={{ textAlign: h === "Item" ? "left" : "right", color: "#aaa", fontWeight: 500, fontSize: 10, paddingBottom: 6, borderBottom: "0.5px solid #eee" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.items.filter(i => i.name.trim()).map((item, idx) => {
                    const sub = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
                    return (
                      <tr key={idx}>
                        <td style={{ padding: "6px 0", borderBottom: "0.5px solid #f5f5f5" }}>{item.name}</td>
                        <td style={{ textAlign: "right", padding: "6px 0", color: "#888", borderBottom: "0.5px solid #f5f5f5" }}>{item.qty}</td>
                        <td style={{ textAlign: "right", padding: "6px 0", color: "#888", borderBottom: "0.5px solid #f5f5f5" }}>{item.unit}</td>
                        <td style={{ textAlign: "right", padding: "6px 0", fontWeight: 500, borderBottom: "0.5px solid #f5f5f5" }}>{formatRupiah(sub)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Catatan */}
          {draft.desc && (
            <div style={{ ...styles.card, marginBottom: 10 }}>
              <div style={styles.sectionTitle}>Catatan</div>
              <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>{draft.desc}</div>
            </div>
          )}

          {/* Struk */}
          {draft.receiptFile && (
            <div style={{ ...styles.card, marginBottom: 10 }}>
              <div style={styles.sectionTitle}>Foto struk</div>
              <div style={{ fontSize: 12, color: "#888" }}>1 foto terlampir — akan diupload saat simpan</div>
            </div>
          )}

          {error && (
            <div style={{ ...styles.warnBox, background: "#fcebeb", borderColor: "#f09595", color: "#791F1F", marginBottom: 10 }}>
              {error}
            </div>
          )}

        </div>

        <div style={styles.footer}>
          <button
            style={{ ...styles.btnPrimary, background: "#1D9E75", marginBottom: 8, opacity: saving ? 0.7 : 1 }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Menyimpan..." : "✓ Simpan transaksi"}
          </button>
          <button style={styles.btnSecondary} onClick={onBack}>← Kembali edit</button>
          <div style={styles.poweredBy}>Powered by NF3 · Tersimpan ke Supabase</div>
        </div>

      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Sub-komponen kecil
// ------------------------------------------------------------
function Row({ label, val, last }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: last ? "none" : "0.5px solid #f5f5f5" }}>
      <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{val}</span>
    </div>
  );
}

function Badge({ children, color }) {
  const map = {
    blue:  { bg: "#E6F1FB", border: "#85B7EB", text: "#0C447C" },
    amber: { bg: "#FAEEDA", border: "#EF9F27", text: "#633806" },
    green: { bg: "#E1F5EE", border: "#5DCAA5", text: "#085041" },
  };
  const c = map[color] || map.blue;
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500, background: c.bg, border: `0.5px solid ${c.border}`, color: c.text }}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------
// KOMPONEN UTAMA
// ------------------------------------------------------------
const EMPTY_DRAFT = {
  amount:      0,
  walletId:    "",
  categoryId:  "",
  outlet:      "",
  supplier:    "",
  date:        todayLocal(),
  desc:        "",
  receiptFile: null,
  items:       [],
};

export default function PurchasingForm({ s, onSave, onClose }) {
  const [step,  setStep]  = useState(1);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const categories = useMemo(
    () => ensurePurchasingCategories(s.categories || []),
    [s.categories]
  );
  const myWallets = visibleWallets(s.wallets, s.currentUser);
  const cats = visibleCategories(categories, s.currentUser, "out");
  const outletOptions = useMemo(() => purchasingOutletOptions(s.currentUser), [s.currentUser]);

  useEffect(() => {
    setDraft((d) => ({
      ...d,
      walletId: d.walletId || myWallets[0]?.id || "",
      categoryId: d.categoryId || cats[0]?.id || "",
      outlet: d.outlet || outletOptions[0]?.code || PURCHASING_OUTLETS[0]?.code || "",
      date: d.date || todayLocal(),
    }));
  }, [myWallets, cats, outletOptions]);

  const resetDraft = () => {
    setDraft({
      ...EMPTY_DRAFT,
      walletId: myWallets[0]?.id || "",
      categoryId: cats[0]?.id || "",
      outlet: outletOptions[0]?.code || PURCHASING_OUTLETS[0]?.code || "",
      date: todayLocal(),
    });
    setStep(1);
  };

  if (step === 1) {
    return (
      <StepForm
        s={s}
        draft={draft}
        setDraft={setDraft}
        onNext={() => setStep(2)}
        onClose={onClose}
      />
    );
  }
  return (
    <StepReview
      s={s}
      draft={draft}
      onSave={onSave}
      onBack={() => setStep(1)}
      onClose={onClose}
      onNew={resetDraft}
    />
  );
}

// ------------------------------------------------------------
// STYLES
// ------------------------------------------------------------
const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 999,
  },
  sheet: {
    background: "#fff", borderRadius: "16px 16px 0 0",
    width: "100%", maxWidth: 480, maxHeight: "92vh",
    display: "flex", flexDirection: "column",
  },
  header: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "14px 16px 0", flexShrink: 0,
  },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: 500 },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8,
    border: "0.5px solid #e0e0e0", background: "#f9f9f9",
    fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  },
  stepBar: {
    display: "flex", gap: 6, padding: "10px 16px 6px", flexShrink: 0,
  },
  stepDot: { flex: 1, height: 3, borderRadius: 2 },
  body: {
    overflowY: "auto", padding: "8px 16px 0", flex: 1,
  },
  footer: {
    padding: "12px 16px 20px", flexShrink: 0,
    borderTop: "0.5px solid #f0f0f0",
  },
  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: 500, color: "#888", display: "block", marginBottom: 5 },
  inp: {
    width: "100%", padding: "8px 10px",
    borderRadius: 8, border: "0.5px solid #e0e0e0",
    background: "#f9f9f9", fontSize: 13, color: "#1a1a1a",
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  },
  inpReadonly: {
    background: "#E6F1FB",
    borderColor: "#85B7EB",
    color: "#0C447C",
    cursor: "default",
  },
  prefix: {
    position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
    fontSize: 13, color: "#888", fontWeight: 500, pointerEvents: "none",
  },
  pill: {
    padding: "7px 10px", borderRadius: 8, border: "0.5px solid #e0e0e0",
    background: "#f9f9f9", fontSize: 12, fontWeight: 500, color: "#888",
    cursor: "pointer", textAlign: "center", width: "100%",
  },
  pillActiveBlue:  { background: "#E6F1FB", borderColor: "#378ADD", color: "#0C447C" },
  pillActiveAmber: { background: "#FAEEDA", borderColor: "#BA7517", color: "#633806" },
  pillActiveGreen: { background: "#E1F5EE", borderColor: "#0F6E56", color: "#085041" },
  addItemBtn: {
    width: "100%", padding: 7, borderRadius: 8,
    border: "0.5px dashed #ccc", background: "transparent",
    fontSize: 12, color: "#888", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  },
  delBtn: {
    background: "none", border: "none", color: "#bbb",
    cursor: "pointer", fontSize: 14, padding: 2,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  divider: { border: "none", borderTop: "0.5px solid #eee", margin: "10px 0" },
  card: {
    background: "#fff", borderRadius: 12,
    border: "0.5px solid #eee", padding: 14,
  },
  sectionTitle: { fontSize: 11, fontWeight: 500, color: "#aaa", marginBottom: 8 },
  warnBox: {
    background: "#FAEEDA", border: "0.5px solid #BA7517",
    borderRadius: 8, padding: "10px 12px",
    fontSize: 12, color: "#633806", lineHeight: 1.5, marginBottom: 10,
  },
  uploadBox: {
    border: "0.5px dashed #ccc", borderRadius: 8,
    padding: 14, textAlign: "center", cursor: "pointer",
    background: "#f9f9f9", display: "flex", flexDirection: "column", alignItems: "center",
  },
  btnPrimary: {
    width: "100%", padding: 13, borderRadius: 8,
    background: "#185FA5", border: "none",
    color: "#fff", fontSize: 14, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  },
  btnSecondary: {
    width: "100%", padding: 11, borderRadius: 8,
    background: "transparent", border: "0.5px solid #ddd",
    color: "#333", fontSize: 13, fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    marginBottom: 8,
  },
  poweredBy: { fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 6 },
  successIcon: {
    width: 56, height: 56, borderRadius: "50%",
    background: "#E1F5EE", color: "#0F6E56",
    fontSize: 24, display: "flex", alignItems: "center",
    justifyContent: "center", margin: "0 auto 12px",
  },
};
