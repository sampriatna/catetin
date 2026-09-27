"use client";
// app/(app)/settings/invite/page.jsx
// Form undang staf → buat invite di Supabase → tampilkan link untuk dikirim via WhatsApp.
// Alur: owner isi email + role + penempatan kerja (outlet kasir / lokasi pembelian purchasing) → dapat link /login?invite=TOKEN.

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../../../../components/layout/BusinessProvider";
import { canDo } from "../../../../lib/rbac";
import { isFnBBusiness } from "../../../../lib/businessFeatures";

const ALL_ROLES = [
  { v: "kasir", l: "Kasir", d: "Catat pemasukan & pengeluaran outlet" },
  { v: "dapur", l: "Dapur", d: "SO, waste, produksi & terima stok di outletnya — tanpa akses uang" },
  { v: "purchasing", l: "Purchasing", d: "Belanja / kas kecil" },
  { v: "admin", l: "Admin Keuangan", d: "Transfer antar kas, settle, kelola dompet (tanpa undang)" },
];

export default function InvitePage() {
  const { s, inviteStaff, authUser, business, loading: appLoading } = useApp();
  const router = useRouter();

  // Bisnis non-F&B (mis. NF Nusa Fishing) tidak pakai Kasir/outlet — sistemnya beda.
  const isFnb = isFnBBusiness(business);
  const roles = useMemo(
    () => (isFnb ? ALL_ROLES : ALL_ROLES.filter((r) => r.v !== "kasir" && r.v !== "dapur")),
    [isFnb]
  );

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("kasir");
  const [outlet, setOutlet] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  // FNB: default tetap "kasir". Non-F&B (Fishing) yang sudah termuat: pindah dari kasir → admin.
  useEffect(() => {
    if (business && !isFnb && role === "kasir") setRole("admin");
  }, [business, isFnb, role]);

  const canInvite = canDo(s?.currentUser?.role || authUser?.role, "undangStaf");

  const submit = async (e) => {
    e.preventDefault();
    if ((role === "kasir" || role === "dapur") && !outlet.trim()) {
      setErr(`${role === "dapur" ? "Dapur" : "Kasir"} wajib pilih outlet (KBU, KSM, atau SMT).`);
      return;
    }
    const outletForInvite = role === "kasir" || role === "dapur" || role === "purchasing" ? outlet.trim() || null : null;
    setLoading(true); setErr(""); setResult(null);
    try {
      const inv = await inviteStaff({ email: email.trim() || null, role, outlet: outletForInvite });
      setResult(inv);
    } catch (e2) {
      setErr(e2.message || "Gagal membuat undangan");
    } finally {
      setLoading(false);
    }
  };

  const pickRole = (r) => {
    setRole(r);
    if (r !== "kasir" && r !== "dapur") setOutlet("");
  };

  const link = result?.inviteUrl;
  const waText = result
    ? encodeURIComponent(
        `Halo! Kamu diundang bergabung ke ${s?.business?.name || "NF3"} sebagai ${role}${outlet ? ` (${outlet})` : ""}.\n\nBuka link ini untuk daftar & langsung masuk:\n${link}`
      )
    : "";

  if (appLoading) return (
    <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>Memuat…</div>
  );

  if (!canInvite) return (
    <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>
      Hanya owner yang bisa mengundang staf baru.
      {authUser?.role && <div style={{ fontSize: 12, marginTop: 8 }}>Role Anda saat ini: <b>{authUser.role}</b></div>}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F0F0F8", padding: "20px 16px 80px" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <button onClick={() => router.push("/settings/staf")}
            style={{ width: 38, height: 38, borderRadius: 99, border: "none", background: "#fff", cursor: "pointer", fontSize: 18 }}>←</button>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1A1A2E", margin: 0 }}>Undang Staf</h1>
        </div>

        {!result ? (
          <form onSubmit={submit} style={{ background: "#fff", borderRadius: 20, padding: 24, border: "1px solid #E8E8F0", display: "flex", flexDirection: "column", gap: 16 }}>
            <Field label="Email (opsional)">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="staf@email.com" style={inp} />
              <div style={hint}>Boleh dikosongkan — link tetap bisa dikirim via WhatsApp.</div>
            </Field>

            <Field label="Peran">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {roles.map((r) => (
                  <button key={r.v} type="button" onClick={() => pickRole(r.v)}
                    style={{ textAlign: "left", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                      border: `1.5px solid ${role === r.v ? "#6366F1" : "#E8E8F0"}`,
                      background: role === r.v ? "#EEF2FF" : "#fff" }}>
                    <div style={{ fontWeight: 700, color: role === r.v ? "#4338CA" : "#1A1A2E", fontSize: 14 }}>{r.l}</div>
                    <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{r.d}</div>
                  </button>
                ))}
              </div>
            </Field>

            {role === "kasir" || role === "dapur" ? (
              <Field label={`Outlet (wajib untuk ${role === "dapur" ? "Dapur" : "Kasir"})`}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {["KBU", "KSM", "SMT"].map((o) => (
                    <button key={o} type="button" onClick={() => setOutlet(o)}
                      style={{ flex: 1, padding: "10px 0", borderRadius: 10, cursor: "pointer", fontWeight: 700,
                        border: `1.5px solid ${outlet === o ? "#6366F1" : "#E8E8F0"}`,
                        background: outlet === o ? "#EEF2FF" : "#fff", color: outlet === o ? "#4338CA" : "#6B7280" }}>
                      {o}
                    </button>
                  ))}
                </div>
                <input value={outlet} onChange={(e) => setOutlet(e.target.value.toUpperCase())}
                  placeholder="KBU, KSM, atau SMT" style={inp} />
              </Field>
            ) : role === "purchasing" ? (
              <Field label="Lokasi pembelian purchasing (opsional)">
                <input value={outlet} onChange={(e) => setOutlet(e.target.value)}
                  placeholder="Contoh: Jagasatru" style={inp} />
                <div style={hint}>Isi lokasi pembelian jika purchasing khusus area tertentu. Kosong = purchasing umum.</div>
              </Field>
            ) : (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: role === "purchasing" ? "#ECFDF5" : "#EEF2FF", border: `1px solid ${role === "purchasing" ? "#A7F3D0" : "#C7D2FE"}`, fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                Admin Keuangan tidak pakai outlet — kelola semua outlet dari satu akun.
              </div>
            )}

            {err && <div style={{ padding: "10px 14px", borderRadius: 10, background: "#FEE2E2", color: "#B91C1C", fontSize: 13 }}>{err}</div>}

            <button type="submit" disabled={loading}
              style={{ padding: 14, borderRadius: 12, border: "none", background: "#6366F1", color: "#fff",
                fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Membuat undangan…" : "Buat Link Undangan →"}
            </button>
          </form>
        ) : (
          <div style={{ background: "#fff", borderRadius: 20, padding: 24, border: "1px solid #E8E8F0" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#15803D", marginBottom: 4 }}>Undangan dibuat ✓</div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>
              Kirim link ini ke calon staf. Saat dibuka, mereka daftar lalu langsung masuk sebagai <b>{role}</b>{outlet ? ` (${outlet})` : ""}.
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input readOnly value={link || ""} style={{ ...inp, flex: 1, fontSize: 12 }} />
              <button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                style={{ padding: "0 16px", borderRadius: 12, border: "1px solid #E8E8F0", background: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {copied ? "Tersalin" : "Salin"}
              </button>
            </div>

            <a href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer"
              style={{ display: "block", textAlign: "center", padding: 13, borderRadius: 12, background: "#22C55E", color: "#fff", fontWeight: 700, textDecoration: "none", marginBottom: 10 }}>
              Kirim via WhatsApp
            </a>
            <button onClick={() => { setResult(null); setEmail(""); setOutlet(""); }}
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #E8E8F0", background: "#fff", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}>
              Undang staf lain
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9CA3AF", marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);
const inp = {
  width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #E8E8F0",
  background: "#F9F9FC", fontSize: 14, color: "#1A1A2E", outline: "none", boxSizing: "border-box",
};
const hint = { fontSize: 11, color: "#9CA3AF", marginTop: 4 };
