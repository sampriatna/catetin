"use client";
// Komponen & gaya bersama modul Dapur.

import { useEffect, useMemo, useState } from "react";
import { Camera, ClipboardPaste, Search, Share2, X } from "lucide-react";
import { searchItems, fmtQty } from "../../lib/inventoryLogic";
import { openWhatsAppShare } from "../../lib/shareWa";

export const C = {
  brand: "#185FA5",
  brandSoft: "#E8F1FA",
  ink: "#111827",
  sub: "#6B7280",
  line: "#E5E7EB",
  bg: "#F3F4F8",
  card: "#FFFFFF",
  ok: "#15803D",
  okSoft: "#DCFCE7",
  warn: "#B45309",
  warnSoft: "#FEF3C7",
  bad: "#B91C1C",
  badSoft: "#FEE2E2",
};

export const card = { background: C.card, borderRadius: 14, border: `1px solid ${C.line}`, padding: 14 };
export const input = {
  width: "100%", maxWidth: "100%", minWidth: 0, display: "block", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.line}`,
  fontSize: 15, color: C.ink, background: "#fff", outline: "none", boxSizing: "border-box",
  WebkitAppearance: "none", appearance: "none",
};
// Input tanggal di iPhone punya lebar bawaan yang bisa keluar dari kartu.
export const dateInput = { ...input, textAlign: "left", minHeight: 44 };
// Dropdown tetap memakai panah bawaan.
export const selectInput = { ...input, WebkitAppearance: "menulist", appearance: "auto" };
export const unitLabel = (u) => (u === "l" ? "L" : u);
export const label = { fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6, display: "block" };

export function Btn({ children, onClick, kind = "primary", disabled, style, type = "button" }) {
  const base = {
    padding: "13px 16px", borderRadius: 12, border: "none", fontWeight: 700, fontSize: 15,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, width: "100%",
  };
  const kinds = {
    primary: { background: C.brand, color: "#fff" },
    ghost: { background: C.brandSoft, color: C.brand },
    danger: { background: C.badSoft, color: C.bad },
    wa: { background: "#25D366", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...base, ...kinds[kind], ...style }}>
      {children}
    </button>
  );
}

export function WaButton({ text, label = "Kirim laporan ke WhatsApp" }) {
  if (!text) return null;
  return (
    <Btn kind="wa" onClick={() => openWhatsAppShare(text)}>
      <Share2 size={18} /> {label}
    </Btn>
  );
}

export function Chips({ options, value, onChange, getLabel = (o) => o }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o === value;
        return (
          <button key={o} type="button" onClick={() => onChange(o)}
            style={{
              padding: "8px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${active ? C.brand : C.line}`, background: active ? C.brand : "#fff",
              color: active ? "#fff" : C.ink,
            }}>
            {getLabel(o)}
          </button>
        );
      })}
    </div>
  );
}

export function Notice({ kind = "info", children }) {
  const map = {
    info: [C.brandSoft, C.brand],
    ok: [C.okSoft, C.ok],
    warn: [C.warnSoft, C.warn],
    bad: [C.badSoft, C.bad],
  };
  const [bg, fg] = map[kind] || map.info;
  return <div style={{ background: bg, color: fg, borderRadius: 12, padding: "10px 12px", fontSize: 13, lineHeight: 1.45 }}>{children}</div>;
}

export function SearchBox({ value, onChange, placeholder = "Cari bahan…" }) {
  return (
    <div style={{ position: "relative" }}>
      <Search size={16} color={C.sub} style={{ position: "absolute", left: 12, top: 13 }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...input, paddingLeft: 34 }} />
      {value ? (
        <button type="button" onClick={() => onChange("")} aria-label="Hapus pencarian"
          style={{ position: "absolute", right: 8, top: 8, border: "none", background: "transparent", padding: 4, cursor: "pointer" }}>
          <X size={16} color={C.sub} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Pilih bahan dari daftar (tanpa ketik bebas). Tampil sebagai kolom cari + hasil.
 * items: bahan yang boleh dipilih. onPick(item).
 */
export function ItemPicker({ items, onPick, placeholder = "Ketik untuk cari bahan…", excludeIds = [] }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const ex = new Set(excludeIds);
    return searchItems(items, q).filter((i) => !ex.has(i.id)).slice(0, 8);
  }, [items, q, excludeIds]);
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder={placeholder} />
      {q ? (
        <div style={{ marginTop: 6, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
          {results.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: C.sub }}>
              Tidak ada di daftar bahan. Minta admin/purchasing menambahkan di menu Kelola Bahan.
            </div>
          ) : results.map((it) => (
            <button key={it.id} type="button" onClick={() => { onPick(it); setQ(""); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: `1px solid ${C.line}`, background: "#fff", cursor: "pointer" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{it.nama}</div>
              <div style={{ fontSize: 12, color: C.sub }}>{it.kode} · {it.satuan}{it.kategori ? ` · ${it.kategori}` : ""}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function QtyInput({ value, onChange, placeholder = "0", width = 90 }) {
  return (
    <input inputMode="decimal" value={value ?? ""} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...input, width, textAlign: "right", padding: "9px 10px",
        // Kosong (belum diisi) dibedakan dari angka 0.
        borderStyle: String(value ?? "").trim() === "" ? "dashed" : "solid" }} />
  );
}

export function StatusBadge({ status }) {
  if (!status || status === "aman") return null;
  const map = { habis: [C.badSoft, C.bad, "Habis"], menipis: [C.warnSoft, C.warn, "Menipis"] };
  const [bg, fg, t] = map[status];
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>{t}</span>;
}

export function QtyText({ qty, satuan }) {
  return <span>{fmtQty(qty)} {satuan}</span>;
}

/** Lampiran foto (kamera/galeri). files: File[]; onChange(File[]). */
export function FotoPicker({ files, onChange, max = 4, hint = "Foto kulkas/rak/timbangan sebagai bukti." }) {
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const urls = (files || []).map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const full = (files || []).length >= max;
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <span style={{ ...label, marginBottom: 0 }}>Lampiran foto ({(files || []).length}/{max})</span>
      <div style={{ fontSize: 12, color: C.sub }}>{hint}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {previews.map((u, i) => (
          <div key={u} style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={`Foto ${i + 1}`} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, border: `1px solid ${C.line}` }} />
            <button type="button" aria-label="Hapus foto" onClick={() => onChange(files.filter((_, j) => j !== i))}
              style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 999, border: "none", background: C.bad, color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}>
              <X size={12} />
            </button>
          </div>
        ))}
        {!full && (
          <label style={{ width: 72, height: 72, borderRadius: 10, border: `1px dashed ${C.brand}`, display: "grid", placeItems: "center", cursor: "pointer", background: C.brandSoft }}>
            <Camera size={22} color={C.brand} />
            <input type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                e.target.value = "";
                onChange([...(files || []), ...picked].slice(0, max));
              }} />
          </label>
        )}
      </div>
    </div>
  );
}

/** Panel tempel teks laporan WA. onApply(text). */
export function PasteWaPanel({ onApply, busyLabel = "Isi otomatis" }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <Btn kind="ghost" onClick={() => setOpen(true)}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><ClipboardPaste size={16} /> Tempel dari WA</span>
      </Btn>
    );
  }
  return (
    <div style={{ ...card, display: "grid", gap: 8 }}>
      <span style={{ ...label, marginBottom: 0 }}>Tempel laporan SO dari WhatsApp</span>
      <div style={{ fontSize: 12, color: C.sub }}>
        Salin pesan SO seperti biasa (mis. <i>Beras : 1,5 karung</i>, <i>Pakcoy : 1.5 Kg</i>), tempel di sini. Bagian <b>WASTE</b> otomatis masuk ke form waste.
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} style={{ ...input, resize: "vertical", fontSize: 13 }}
        placeholder={"*BAHAN*\nMie : 6.5 Kg\nBiji Wijen : -\n\n*WASTE*\nPakcoy : 200 gram"} />
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="ghost" onClick={() => { setOpen(false); setText(""); }} style={{ flex: 1 }}>Batal</Btn>
        <Btn onClick={() => { onApply(text); setOpen(false); setText(""); }} disabled={!text.trim()} style={{ flex: 2 }}>{busyLabel}</Btn>
      </div>
    </div>
  );
}

/** Pilih area daftar SO: Semua / Dapur / Bar (nilai null = semua). */
export function AreaChips({ value, onChange }) {
  const opts = ["semua", "dapur", "bar"];
  const lbl = { semua: "Semua", dapur: "Dapur", bar: "Bar / Kasir" };
  return <Chips options={opts} value={value || "semua"} onChange={(v) => onChange(v === "semua" ? null : v)} getLabel={(o) => lbl[o]} />;
}
