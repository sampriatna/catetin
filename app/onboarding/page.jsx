"use client";
// Onboarding — staf lewat undangan saja. Buat bisnis baru hanya ecommerce/UMKM (bukan F&B outlet).

import { useState, useEffect } from "react";
import { readStoredSession } from "../../lib/authBootstrap";
import {
  createBusiness,
  claimPendingInvites,
  listMyBusinesses,
  fetchMyPendingInvites,
  pickDefaultBusinessId,
} from "../../lib/repo";
import {
  assertBusinessTypeAllowed,
  OWNER_PRESETS,
  STAFF_ONBOARDING_MSG,
} from "../../lib/onboardingPolicy.js";

const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin Keuangan",
  purchasing: "Purchasing",
  kasir: "Kasir",
};

function toSlug(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return base || "bisnis-" + Date.now().toString(36).slice(-4);
}

export default function OnboardingPage() {
  const defaultPreset = OWNER_PRESETS[0];
  const [name, setName] = useState(defaultPreset.name);
  const [type, setType] = useState(defaultPreset.type);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [gate, setGate] = useState("checking"); // checking | no-session | invited | no-business | error
  const [pendingInvites, setPendingInvites] = useState([]);
  const [userEmail, setUserEmail] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [confirmSeparate, setConfirmSeparate] = useState(false);

  useEffect(() => {
    (async () => {
      const sess = readStoredSession();
      if (!sess?.user) {
        setGate("no-session");
        return;
      }
      setUserEmail(sess.user.email || "");

      try {
        // Existing members must not depend on the optional invitation service.
        const existing = await listMyBusinesses();
        if (existing.length) {
          window.location.href = `/dashboard?biz=${pickDefaultBusinessId(existing)}`;
          return;
        }

        const claimed = await claimPendingInvites();
        if (claimed?.length) {
          window.location.href = `/dashboard?biz=${claimed[0].business_id}`;
          return;
        }

        const list = await listMyBusinesses();
        if (list.length) {
          const pick = pickDefaultBusinessId(list);
          window.location.href = `/dashboard?biz=${pick}`;
          return;
        }

        const { count, invites } = await fetchMyPendingInvites();
        if (count > 0) {
          setPendingInvites(invites);
          setGate("invited");
          return;
        }

        setGate("no-business");
      } catch (e) {
        setErr(e.message || "Gagal memuat");
        setGate("error");
      }
    })();
  }, []);

  const retryJoin = async () => {
    setRetrying(true);
    setErr("");
    try {
      const claimed = await claimPendingInvites();
      if (claimed?.length) {
        window.location.href = `/dashboard?biz=${claimed[0].business_id}`;
        return;
      }
      const list = await listMyBusinesses();
      if (list.length) {
        window.location.href = `/dashboard?biz=${pickDefaultBusinessId(list)}`;
        return;
      }
      setErr("Belum bisa bergabung. Pastikan email login sama persis dengan email undangan.");
    } catch (e) {
      setErr(e.message || "Gagal bergabung");
    } finally {
      setRetrying(false);
    }
  };

  const pickPreset = (p) => {
    setName(p.name);
    setType(p.type);
    setErr("");
    setConfirmSeparate(false);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || !confirmSeparate) return;
    setLoading(true);
    setErr("");

    try {
      assertBusinessTypeAllowed(type);
    } catch (e) {
      setErr(e.message);
      setLoading(false);
      return;
    }

    let slug = toSlug(trimmed);
    try {
      let biz;
      try {
        biz = await createBusiness(slug, trimmed, type);
      } catch (e1) {
        if (String(e1.message).includes("unique") || String(e1.message).includes("duplicate")) {
          slug = toSlug(trimmed) + "-" + Math.random().toString(36).slice(-4);
          biz = await createBusiness(slug, trimmed, type);
        } else {
          throw e1;
        }
      }
      window.location.href = `/dashboard?biz=${biz.id}`;
    } catch (e) {
      setErr(e.message || "Gagal membuat bisnis");
      setLoading(false);
    }
  };

  if (gate === "checking") {
    return (
      <Shell subtitle="Memuat…">
        <div style={{ textAlign: "center", color: "#6B7280", fontSize: 14 }}>Memuat…</div>
      </Shell>
    );
  }

  if (gate === "no-session") {
    return (
      <Shell subtitle="Akses NF3">
        <div style={{ textAlign: "center" }}>
          <p style={{ marginBottom: 16, color: "#6B7280", lineHeight: 1.5 }}>{STAFF_ONBOARDING_MSG}</p>
          <button onClick={() => { window.location.href = "/login"; }} style={btnPrimary}>Masuk / terima undangan</button>
        </div>
      </Shell>
    );
  }

  if (gate === "error") {
    return (
      <Shell subtitle="Gagal memuat">
        <div style={{ color: "#B91C1C", fontSize: 13, marginBottom: 16 }}>{err}</div>
        <button onClick={() => window.location.reload()} style={{ ...btnPrimary, width: "100%" }}>Coba lagi</button>
      </Shell>
    );
  }

  if (gate === "invited") {
    return (
      <Shell subtitle="Undangan staf">
        <div style={{ fontSize: 18, fontWeight: 800, color: "#1A1A2E", marginBottom: 12 }}>
          Anda sudah diundang
        </div>
        <div style={{
          padding: "12px 14px", borderRadius: 12, background: "#FFFBEB",
          border: "1px solid #FDE68A", color: "#92400E", fontSize: 13, marginBottom: 16, lineHeight: 1.5,
        }}>
          Anda <strong>tidak perlu</strong> membuat bisnis baru. Owner sudah mengundang Anda — cukup gabung dengan akun ini.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {pendingInvites.map((inv, i) => (
            <div key={i} style={{
              padding: "12px 14px", borderRadius: 12, border: "1px solid #E8E8F0", background: "#F9F9FC",
            }}>
              <div style={{ fontWeight: 700, color: "#1A1A2E" }}>{inv.businessName || "Bisnis"}</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>
                Peran: {ROLE_LABEL[inv.role] || inv.role}
                {inv.outlet ? ` · Outlet ${inv.outlet}` : ""}
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 16 }}>
          Email login: <strong>{userEmail}</strong>
          <br />
          Harus sama dengan email yang diundang owner.
        </div>

        {err && <ErrBox>{err}</ErrBox>}

        <button onClick={retryJoin} disabled={retrying} style={{ ...btnPrimary, width: "100%", opacity: retrying ? 0.6 : 1 }}>
          {retrying ? "Bergabung…" : "Gabung ke Bisnis →"}
        </button>
      </Shell>
    );
  }

  return (
    <Shell subtitle="Belum terhubung ke bisnis">
      <div style={{ fontSize: 18, fontWeight: 800, color: "#1A1A2E", marginBottom: 10 }}>
        Staf outlet NF3?
      </div>
      <div style={{
        padding: "12px 14px", borderRadius: 12, background: "#EEF2FF",
        border: "1px solid #C7D2FE", color: "#4338CA", fontSize: 13, lineHeight: 1.55, marginBottom: 16,
      }}>
        {STAFF_ONBOARDING_MSG}
      </div>

      <button
        type="button"
        onClick={() => { window.location.href = "/login"; }}
        style={{ ...btnPrimary, width: "100%", marginBottom: 20 }}
      >
        Saya punya link undangan →
      </button>

      <button
        type="button"
        onClick={() => setShowOwnerForm((v) => !v)}
        style={{
          width: "100%", padding: "10px 14px", borderRadius: 12, border: "1px solid #E8E8F0",
          background: "#fff", color: "#6B7280", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}
      >
        {showOwnerForm ? "▲ Sembunyikan" : "▼ Saya buka bisnis baru (bukan staf outlet NF)"}
      </button>

      {showOwnerForm && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #E8E8F0" }}>
          <div style={{ fontSize: 12, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A",
            borderRadius: 10, padding: "10px 12px", marginBottom: 14, lineHeight: 1.45 }}>
            <strong>Bukan untuk outlet NF3.</strong> Nusa Food (F&B) sudah ada — staf outlet harus lewat undangan owner.
            Di sini hanya untuk bisnis terpisah (mis. Nusa Fishing e-commerce).
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Pilih jenis bisnis
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {OWNER_PRESETS.map((p) => (
              <button key={p.name} type="button" onClick={() => pickPreset(p)} disabled={loading}
                style={{
                  padding: "12px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                  display: "flex", alignItems: "flex-start", gap: 10,
                  border: `1.5px solid ${name === p.name ? "#6366F1" : "#E8E8F0"}`,
                  background: name === p.name ? "#EEF2FF" : "#fff",
                  opacity: loading ? 0.6 : 1,
                }}>
                <span style={{ fontSize: 22 }}>{p.icon}</span>
                <span>
                  <span style={{ display: "block", fontWeight: 700, color: name === p.name ? "#4338CA" : "#1A1A2E" }}>{p.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: "#6B7280", marginTop: 2 }}>{p.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Nama bisnis
          </div>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setErr(""); }}
            placeholder="Nama bisnis"
            disabled={loading}
            style={inp}
          />

          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, fontSize: 13, color: "#374151", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={confirmSeparate}
              onChange={(e) => setConfirmSeparate(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>Saya bukan staf outlet NF3 dan memang ingin buat bisnis terpisah (bukan Nusa Food / F&B outlet).</span>
          </label>

          {err && <div style={{ marginTop: 12 }}><ErrBox>{err}</ErrBox></div>}

          <button
            onClick={create}
            disabled={loading || !name.trim() || !confirmSeparate}
            style={{ ...btnPrimary, width: "100%", marginTop: 16, opacity: loading || !name.trim() || !confirmSeparate ? 0.5 : 1 }}
          >
            {loading ? "Membuat bisnis…" : "Buat Bisnis & Masuk →"}
          </button>
        </div>
      )}
    </Shell>
  );
}

function ErrBox({ children }) {
  return (
    <div style={{ padding: "10px 14px", borderRadius: 10, background: "#FEE2E2", color: "#B91C1C", fontSize: 13 }}>
      {children}
    </div>
  );
}

function Shell({ subtitle, children }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#4F46E5" }}>NF3</div>
          <div style={{ fontSize: 14, color: "#6B7280", marginTop: 4 }}>{subtitle || "Setup bisnis kamu"}</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 20, padding: 24, border: "1px solid #E8E8F0" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

const inp = {
  width: "100%", padding: "12px 14px", borderRadius: 12,
  border: "1px solid #E8E8F0", background: "#F9F9FC",
  fontSize: 14, color: "#1A1A2E", outline: "none", boxSizing: "border-box",
};
const btnPrimary = {
  padding: "14px 20px", borderRadius: 12, border: "none",
  background: "#6366F1", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
};
