"use client";

import { useState } from "react";
import { Trash2, Loader2, Plus } from "lucide-react";
import { visibleWallets, visibleCategories } from "../lib/rbac";
import {
  getTransactionEditPolicy,
  validateTransactionUpdate,
  buildTransactionPatch,
  transactionTypeLabel,
} from "../lib/transactionEdit";
import { walletBalance } from "../lib/kasirHarian";
import { shouldHideWalletBalance } from "../lib/walletDisplay";
import { resolveTransferIds } from "../lib/transactionNormalize";
import { isPurchasingTx } from "../lib/purchasingExpense";
import {
  normalizePurchasingItems,
  itemsTotalFromList,
  formatPurchasingItemLine,
  purchasingTxTitle,
} from "../lib/purchasingItems";
import { ensurePurchasingCategories } from "../lib/purchasingCategories";

const fmtRp = (n) => `Rp${new Intl.NumberFormat("id-ID").format(Math.round(Number(n) || 0))}`;

function emptyItem() {
  return { name: "", qty: "", unit: "pcs", unitPrice: "" };
}

function PurchasingItemEditor({ items, onChange }) {
  const rows = items.length ? items : [emptyItem()];

  function update(idx, field, val) {
    const next = rows.map((r, i) => (i === idx ? { ...r, [field]: val } : r));
    onChange(next);
  }

  function addRow() {
    onChange([...rows, emptyItem()]);
  }

  function removeRow(idx) {
    onChange(rows.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((item, idx) => {
        const sub = (Number(item.qty) || 0) * (Number(item.unitPrice) || 0);
        return (
          <div key={idx} style={{ padding: 10, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface2)" }}>
            <input
              value={item.name}
              onChange={(e) => update(idx, "name", e.target.value)}
              placeholder="Nama barang (mis. ubi ungu)"
              style={{ ...inp, marginBottom: 6 }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 32px", gap: 6 }}>
              <input
                type="number"
                value={item.qty}
                onChange={(e) => update(idx, "qty", e.target.value)}
                placeholder="Qty"
                style={inpSm}
              />
              <input
                value={item.unit}
                onChange={(e) => update(idx, "unit", e.target.value)}
                placeholder="Satuan"
                style={inpSm}
              />
              <input
                type="number"
                value={item.unitPrice}
                onChange={(e) => update(idx, "unitPrice", e.target.value)}
                placeholder="Harga/satuan"
                style={inpSm}
              />
              <button
                type="button"
                onClick={() => removeRow(idx)}
                disabled={rows.length <= 1}
                style={{ border: "none", background: "none", color: "var(--out)", cursor: rows.length <= 1 ? "default" : "pointer", opacity: rows.length <= 1 ? 0.3 : 1 }}
                aria-label="Hapus baris"
              >
                ✕
              </button>
            </div>
            {sub > 0 && (
              <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4, textAlign: "right" }}>
                Subtotal: {fmtRp(sub)}
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={addRow} style={addRowBtn}>
        <Plus size={14} /> Tambah barang
      </button>
    </div>
  );
}

export default function TransactionEditSheet({ tx, s, onSave, onDelete, onClose }) {
  const user = s.currentUser || { role: "kasir" };
  const policy = getTransactionEditPolicy(tx, user);
  const isPurchasing = isPurchasingTx(tx);
  const myWallets = visibleWallets(s.wallets, user);
  const { from, to } = resolveTransferIds(tx);

  const categories = ensurePurchasingCategories(s.categories || []);
  const inCats = visibleCategories(categories, user, "in");
  const outCats = visibleCategories(categories, user, "out");
  const cats = tx.type === "in" ? inCats : outCats;

  const initialItems = (tx.meta?.items || []).map((i) => ({
    name: i.name || "",
    qty: i.qty ?? "",
    unit: i.unit || "pcs",
    unitPrice: i.unitPrice ?? "",
  }));

  const [form, setForm] = useState({
    amount: String(tx.amount || ""),
    date: tx.date || "",
    desc: tx.desc || "",
    walletId: tx.walletId || tx.wallet_id || "",
    categoryId: tx.categoryId || tx.category_id || "",
    fromWalletId: from || "",
    toWalletId: to || "",
    supplier: tx.supplier || "",
  });
  const [itemRows, setItemRows] = useState(initialItems.length ? initialItems : [emptyItem()]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const normalizedItems = normalizePurchasingItems(itemRows);
  const itemsTotal = itemsTotalFromList(itemRows);
  const displayAmount = itemsTotal > 0 ? itemsTotal : Math.round(Number(form.amount) || 0);

  const previewBalance = () => {
    if (tx.type === "transfer") {
      const fromBal = walletBalance(form.fromWalletId, s.wallets, s.transactions || []);
      const toBal = walletBalance(form.toWalletId, s.wallets, s.transactions || []);
      return { fromBal, toBal };
    }
    const wId = form.walletId;
    if (!wId) return null;
    return { single: walletBalance(wId, s.wallets, s.transactions || []) };
  };

  const balPreview = previewBalance();

  const handleSave = () => {
    setErr("");
    const meta = isPurchasing
      ? {
          ...(tx.meta || {}),
          items: normalizedItems,
          itemsTotal: displayAmount,
        }
      : tx.meta;

    const patch = buildTransactionPatch(
      {
        ...form,
        amount: displayAmount,
        meta,
      },
      tx
    );

    const validationErr = validateTransactionUpdate(tx, patch, {
      wallets: s.wallets,
      transactions: s.transactions,
    });
    if (validationErr) {
      setErr(validationErr);
      return;
    }
    setBusy(true);
    const ok = onSave(tx.id, {
      ...patch,
      editedAt: new Date().toISOString(),
    });
    setBusy(false);
    if (ok) onClose();
    else setErr("Gagal menyimpan perubahan.");
  };

  const handleDelete = () => {
    if (!policy.canDelete) return;
    const label = transactionTypeLabel(tx.type);
    const okConfirm = window.confirm(
      `Hapus ${label} ${fmtRp(tx.amount)}?\n\nSaldo dompet akan kembali seperti sebelum transaksi ini dicatat.`
    );
    if (!okConfirm) return;
    setBusy(true);
    const ok = onDelete(tx.id);
    setBusy(false);
    if (ok) onClose();
    else setErr("Gagal menghapus transaksi.");
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 25, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
        <button type="button" onClick={onClose} style={{ width: 36, height: 36, borderRadius: 99, background: "var(--surface2)", border: "none", cursor: "pointer", color: "var(--ink)" }}>←</button>
        <span style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", flex: 1 }}>Edit {transactionTypeLabel(tx.type)}</span>
        {policy.canDelete && (
          <button type="button" disabled={busy} onClick={handleDelete}
            style={{ width: 36, height: 36, borderRadius: 99, background: "var(--out-soft)", border: "none", cursor: busy ? "wait" : "pointer", display: "grid", placeItems: "center", color: "var(--out)" }}>
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 40px" }} className="scroll-hide">
        {!policy.canEdit ? (
          <div style={{ padding: 20, borderRadius: 14, background: "var(--amber-soft)", color: "#92400E", fontSize: 14, lineHeight: 1.5 }}>
            {policy.reason}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.45 }}>
              {isPurchasing
                ? "Patokan utama: barang dibeli (nama, qty, harga). Kelompok akuntansi hanya Bahan Baku / Kemasan / dll."
                : "Ubah nominal, dompet, tanggal, atau catatan. Saldo dompet menyesuaikan otomatis."}
              {tx.source && <span> · Sumber: {tx.source}</span>}
            </div>

            {isPurchasing && normalizedItems.length > 0 && (
              <div style={hintBox}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 4 }}>Ringkasan</div>
                {normalizedItems.map((i, idx) => (
                  <div key={idx} style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{formatPurchasingItemLine(i)}</div>
                ))}
              </div>
            )}

            {isPurchasing && tx.type === "out" && (
              <>
                <label style={lbl}>Barang dibeli *</label>
                <PurchasingItemEditor items={itemRows} onChange={setItemRows} />
              </>
            )}

            <label style={lbl}>{itemsTotal > 0 ? "Total belanja (dari item)" : "Nominal (Rp) *"}</label>
            <input
              inputMode="numeric"
              value={displayAmount ? Number(displayAmount).toLocaleString("id-ID") : ""}
              onChange={(e) => !itemsTotal && set("amount", e.target.value.replace(/\D/g, ""))}
              readOnly={itemsTotal > 0}
              style={{ ...inp, ...(itemsTotal > 0 ? { background: "var(--surface2)", color: "var(--ink2)" } : {}) }}
            />
            {itemsTotal > 0 && (
              <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: -8 }}>
                Dihitung otomatis dari barang di atas.
              </div>
            )}

            {tx.type === "transfer" ? (
              <>
                <label style={lbl}>Dari dompet *</label>
                <select value={form.fromWalletId} onChange={(e) => set("fromWalletId", e.target.value)} style={inp}>
                  {myWallets.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} — {fmtRp(walletBalance(w.id, s.wallets, s.transactions))}</option>
                  ))}
                </select>
                <label style={lbl}>Ke dompet *</label>
                <select value={form.toWalletId} onChange={(e) => set("toWalletId", e.target.value)} style={inp}>
                  {myWallets.filter((w) => w.id !== form.fromWalletId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name} — {fmtRp(walletBalance(w.id, s.wallets, s.transactions))}</option>
                  ))}
                </select>
                {balPreview && (
                  <div style={hintBox}>
                    Saldo saat ini: {s.wallets.find((w) => w.id === form.fromWalletId)?.name} {fmtRp(balPreview.fromBal)}
                    {" → "}
                    {s.wallets.find((w) => w.id === form.toWalletId)?.name} {fmtRp(balPreview.toBal)}
                  </div>
                )}
              </>
            ) : (
              <>
                <label style={lbl}>{isPurchasing ? "Kelompok belanja *" : "Kategori *"}</label>
                <select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} style={inp}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {isPurchasing && (
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: -8 }}>
                    Bukan nama barang — pilih kelompok seperti Bahan Baku, Kemasan, dll.
                  </div>
                )}
                <label style={lbl}>Dompet *</label>
                <select value={form.walletId} onChange={(e) => set("walletId", e.target.value)} style={inp}>
                  {myWallets.map((w) => (
                    <option key={w.id} value={w.id}>{shouldHideWalletBalance(w, user) ? w.name : `${w.name} — ${fmtRp(walletBalance(w.id, s.wallets, s.transactions))}`}</option>
                  ))}
                </select>
                {tx.type === "out" && isPurchasing && (
                  <>
                    <label style={lbl}>Supplier</label>
                    <input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} style={inp} placeholder="Nama toko / pasar" />
                  </>
                )}
                {balPreview?.single != null && !shouldHideWalletBalance(s.wallets.find((w) => w.id === form.walletId), user) && (
                  <div style={hintBox}>Saldo dompet saat ini: {fmtRp(balPreview.single)}</div>
                )}
              </>
            )}

            <label style={lbl}>Tanggal *</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} style={inp} />

            <label style={lbl}>Catatan tambahan</label>
            <input value={form.desc} onChange={(e) => set("desc", e.target.value)} style={inp} placeholder={isPurchasing ? "Opsional — mis. harga naik" : "Keterangan transaksi"} />

            {err && <div style={{ padding: 12, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>{err}</div>}

            <button type="button" disabled={busy} onClick={handleSave}
              style={{ padding: 14, borderRadius: 14, border: "none", background: busy ? "var(--ink3)" : "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : null}
              Simpan perubahan
            </button>

            {policy.canDelete && (
              <button type="button" disabled={busy} onClick={handleDelete}
                style={{ padding: 14, borderRadius: 14, border: "1px solid #FECACA", background: "var(--out-soft)", color: "var(--out-text)", fontWeight: 700, fontSize: 14, cursor: busy ? "wait" : "pointer" }}>
                Hapus transaksi — saldo kembali normal
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const lbl = { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 6, display: "block" };
const inp = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none", boxSizing: "border-box" };
const inpSm = { ...inp, padding: "8px 10px", fontSize: 13 };
const hintBox = { padding: "10px 12px", borderRadius: 10, background: "var(--surface2)", fontSize: 12, color: "var(--ink2)", lineHeight: 1.45 };
const addRowBtn = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "1px dashed var(--line)", background: "none", color: "var(--brand)", fontWeight: 600, fontSize: 13, cursor: "pointer" };

export { purchasingTxTitle };
