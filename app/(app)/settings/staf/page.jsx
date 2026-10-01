"use client";
// app/(app)/settings/staf/page.jsx
// Daftar semua staf di bisnis ini. Owner = Super Admin: bisa edit akun + set password baru.

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "../../../../components/layout/BusinessProvider";
import { supabase } from "../../../../lib/supabaseClient";
import { listBusinessMembers, listPendingInvites } from "../../../../lib/repo";
import { canDo, ROLE_LABEL } from "../../../../lib/rbac";

const ROLE_COLOR = {
  owner:      { bg: "#EDE9FE", text: "#6D28D9" },
  admin:      { bg: "#EEF2FF", text: "#4338CA" },
  kasir:      { bg: "#DCFCE7", text: "#15803D" },
  purchasing: { bg: "#FEF3C7", text: "#D97706" },
  dapur:      { bg: "#FFEDD5", text: "#C2410C" },
};
const KASIR_OUTLETS = new Set(["KBU", "KSM", "SMT"]);
const STAFF_ROLES = ["admin", "kasir", "purchasing", "dapur"];
const isPurchasingArea = (m) => m?.role === "purchasing" && !!m?.outlet && !KASIR_OUTLETS.has(String(m.outlet).toUpperCase());

export default function StafPage() {
  const { bizId, s } = useApp();
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [editing, setEditing] = useState(null);
  const [actionErr, setActionErr] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  const isManager = canDo(s?.currentUser?.role, "kelolaStaf");
  const canInvite = canDo(s?.currentUser?.role, "undangStaf");
  const isSuperAdmin = s?.currentUser?.role === "owner";

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setLoadErr("");
    try {
      const [mems, pending] = await Promise.all([
        listBusinessMembers(bizId),
        listPendingInvites(bizId),
      ]);
      setMembers(mems);
      setInvites(pending);
    } catch (e) {
      setLoadErr(e.message || "Gagal memuat staf");
      setMembers([]);
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => {
    let alive = true;
    if (!bizId) return () => { alive = false; };
    setLoading(true);
    setLoadErr("");
    Promise.all([listBusinessMembers(bizId), listPendingInvites(bizId)])
      .then(([mems, pending]) => {
        if (!alive) return;
        setMembers(mems);
        setInvites(pending);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadErr(e.message || "Gagal memuat staf");
        setMembers([]);
        setInvites([]);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [bizId]);

  const toggleActive = async (memberId, current) => {
    setActionErr("");
    setActionMsg("");
    const { error } = await supabase.from("business_members")
      .update({ active: !current }).eq("id", memberId);
    if (error) {
      setActionErr(error.message || "Gagal mengubah status staf.");
      return;
    }
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, active: !current } : m));
  };

  const saveStaff = async (form) => {
    setActionErr("");
    setActionMsg("");
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Sesi login habis. Silakan login ulang.");

    const res = await fetch("/api/staff/manage", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        businessId: bizId,
        memberId: form.memberId,
        name: form.name,
        role: form.role,
        outlet: form.outlet,
        active: form.active,
        newPassword: form.newPassword,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Gagal menyimpan (${res.status})`);

    setEditing(null);
    setActionMsg(
      json.passwordChanged
        ? "Data staf dan password baru sudah disimpan."
        : "Data staf sudah disimpan."
    );
    await load();
  };

  if (!isManager) return (
    <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>
      Hanya owner/admin yang bisa melihat halaman ini.
    </div>
  );

  return (
    <div style={{ padding: "20px 16px 80px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#1A1A2E", margin: 0 }}>Kelola Staf</h1>
          <p style={{ fontSize: 13, color: "#6B7280", margin: "4px 0 0" }}>
            {members.length} anggota{invites.length ? ` · ${invites.length} undangan menunggu` : ""}
          </p>
        </div>
        {canInvite && (
          <button onClick={() => router.push("/settings/invite")}
            style={{ padding: "9px 16px", borderRadius: 10, background: "#6366F1", color: "#fff",
              fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer" }}>
            + Undang
          </button>
        )}
      </div>

      {isSuperAdmin && (
        <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", color: "#4338CA",
          padding: "10px 12px", borderRadius: 12, fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>
          <strong>Super Admin aktif.</strong> Ketuk <strong>Edit</strong> untuk ubah nama, role, outlet, status, atau menetapkan password baru staf.
          Password lama tidak bisa dilihat.
        </div>
      )}

      {loadErr && <Alert kind="error">{loadErr}</Alert>}
      {actionErr && <Alert kind="error">{actionErr}</Alert>}
      {actionMsg && <Alert kind="ok">{actionMsg}</Alert>}

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>Memuat...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {invites.length > 0 && (
            <>
              <div style={sectionLabel}>Undangan belum diterima</div>
              {invites.map((inv) => {
                const rc = ROLE_COLOR[inv.role] || ROLE_COLOR.kasir;
                return (
                  <div key={inv.id} style={{ background: "#FFFBEB", border: "1px dashed #FCD34D", borderRadius: 16,
                    padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 99, background: "#FEF3C7",
                      display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }}>⏳</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "#92400E", fontSize: 14 }}>
                        {inv.email || "Link undangan (tanpa email)"}
                      </div>
                      <div style={badgeRow}>
                        <Badge bg={rc.bg} color={rc.text}>{ROLE_LABEL[inv.role] || inv.role}</Badge>
                        {inv.outlet && (
                          <Badge bg="#EEF2FF" color="#4338CA">
                            {inv.role === "purchasing" ? `Lokasi: ${inv.outlet}` : inv.outlet}
                          </Badge>
                        )}
                        <Badge bg="#FEF3C7" color="#B45309">Menunggu daftar/login</Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ ...sectionLabel, marginTop: 8 }}>Anggota aktif</div>
            </>
          )}

          {members.map(m => {
            const rc = ROLE_COLOR[m.role] || ROLE_COLOR.kasir;
            const isMe = m.profiles?.id === s?.currentUser?.id;
            const canEdit = isSuperAdmin && !isMe && m.role !== "owner";
            return (
              <div key={m.id} style={{ background: "#fff", border: "1px solid #E8E8F0", borderRadius: 16,
                padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
                opacity: m.active ? 1 : .58 }}>
                <div style={{ width: 40, height: 40, borderRadius: 99, background: "#EEF2FF",
                  display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800, color: "#6366F1", flexShrink: 0 }}>
                  {(m.profiles?.name || "?")[0].toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "#1A1A2E", fontSize: 14 }}>
                    {m.profiles?.name || "—"} {isMe && <span style={{ fontSize: 11, color: "#9CA3AF" }}>(kamu)</span>}
                  </div>
                  {m.profiles?.email && (
                    <div style={{ color: "#9CA3AF", fontSize: 11, marginTop: 2, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.profiles.email}
                    </div>
                  )}
                  <div style={badgeRow}>
                    <Badge bg={rc.bg} color={rc.text}>{ROLE_LABEL[m.role] || m.role}</Badge>
                    {m.outlet && (
                      <Badge bg="#EEF2FF" color="#4338CA">
                        {m.role === "purchasing" ? `Lokasi: ${m.outlet}` : m.outlet}
                      </Badge>
                    )}
                    {isPurchasingArea(m) && <Badge bg="#E0F2FE" color="#0C4A6E">Lokasi khusus</Badge>}
                    {!m.active && <Badge bg="#F3F4F6" color="#9CA3AF">nonaktif</Badge>}
                  </div>
                </div>

                {!isMe && m.role !== "owner" && (
                  <div style={{ display: "grid", gap: 6, flexShrink: 0 }}>
                    {canEdit && (
                      <button onClick={() => {
                        setActionErr("");
                        setActionMsg("");
                        setEditing(m);
                      }} style={editBtn}>
                        Edit
                      </button>
                    )}
                    <button onClick={() => toggleActive(m.id, m.active)}
                      style={{ ...toggleBtn, background: m.active ? "#FEE2E2" : "#DCFCE7",
                        color: m.active ? "#B91C1C" : "#15803D" }}>
                      {m.active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EditStaffModal
          member={editing}
          onClose={() => setEditing(null)}
          onSave={saveStaff}
        />
      )}
    </div>
  );
}

function EditStaffModal({ member, onClose, onSave }) {
  const [name, setName] = useState(member.profiles?.name || "");
  const [role, setRole] = useState(member.role || "kasir");
  const [outlet, setOutlet] = useState(member.outlet || "");
  const [active, setActive] = useState(member.active !== false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const outletRequired = role === "kasir" || role === "dapur";
  const purchasing = role === "purchasing";

  const changeRole = (next) => {
    setRole(next);
    if (next === "admin") setOutlet("");
    if (next === "purchasing" && KASIR_OUTLETS.has(String(outlet).toUpperCase())) setOutlet("");
    if ((next === "kasir" || next === "dapur") && !KASIR_OUTLETS.has(String(outlet).toUpperCase())) {
      setOutlet("KBU");
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!name.trim()) {
      setErr("Nama staf wajib diisi.");
      return;
    }
    if (outletRequired && !KASIR_OUTLETS.has(String(outlet).toUpperCase())) {
      setErr("Pilih outlet KBU, KSM, atau SMT.");
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setErr("Password baru minimal 6 karakter.");
      return;
    }

    setBusy(true);
    try {
      await onSave({
        memberId: member.id,
        name: name.trim(),
        role,
        outlet: role === "admin" ? "" : outlet,
        active,
        newPassword,
      });
    } catch (e2) {
      setErr(e2.message || "Gagal menyimpan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" style={modalBackdrop} onMouseDown={(e) => {
      if (e.target === e.currentTarget && !busy) onClose();
    }}>
      <form onSubmit={submit} style={modalCard}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1A1A2E" }}>Edit Staf</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 3 }}>
              {member.profiles?.email || "Akun staf"}
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ border: "none", background: "#F3F4F6", width: 34, height: 34, borderRadius: 10,
              fontSize: 18, cursor: "pointer", color: "#6B7280" }}>
            ×
          </button>
        </div>

        <Field label="Nama">
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle}
            autoComplete="off" />
        </Field>

        <Field label="Role">
          <select value={role} onChange={(e) => changeRole(e.target.value)} style={inputStyle}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>
            ))}
          </select>
        </Field>

        {outletRequired && (
          <Field label="Outlet">
            <select value={outlet} onChange={(e) => setOutlet(e.target.value)} style={inputStyle}>
              {["KBU", "KSM", "SMT"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
        )}

        {purchasing && (
          <Field label="Lokasi Purchasing (opsional)">
            <input value={outlet} onChange={(e) => setOutlet(e.target.value)} style={inputStyle}
              placeholder="Kosong = purchasing umum/gudang" autoComplete="off" />
          </Field>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
          fontSize: 13, color: "#374151", cursor: "pointer" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>
            <strong>Akun aktif</strong>
            <span style={{ display: "block", color: "#9CA3AF", fontSize: 11, marginTop: 2 }}>
              Nonaktif = staf tidak bisa memakai akses bisnis ini.
            </span>
          </span>
        </label>

        <div style={{ borderTop: "1px solid #E8E8F0", paddingTop: 14, marginTop: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#1A1A2E" }}>Ganti Password</div>
          <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 3, marginBottom: 8, lineHeight: 1.4 }}>
            Password lama tidak ditampilkan. Isi hanya kalau kamu ingin menetapkan password baru.
          </div>
          <input
            type={showPassword ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={inputStyle}
            placeholder="Password baru · minimal 6 karakter"
            autoComplete="new-password"
          />
          <label style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 8,
            color: "#6B7280", fontSize: 11, cursor: "pointer" }}>
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
            Tampilkan password saat mengetik
          </label>
        </div>

        {err && <Alert kind="error">{err}</Alert>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ ...secondaryBtn, opacity: busy ? .6 : 1 }}>
            Batal
          </button>
          <button type="submit" disabled={busy}
            style={{ ...primaryBtn, opacity: busy ? .6 : 1 }}>
            {busy ? "Menyimpan…" : "Simpan Perubahan"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase",
        letterSpacing: ".05em" }}>{label}</span>
      {children}
    </label>
  );
}

function Badge({ bg, color, children }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: bg, color }}>
      {children}
    </span>
  );
}

function Alert({ kind, children }) {
  const ok = kind === "ok";
  return (
    <div style={{ background: ok ? "#DCFCE7" : "#FEE2E2", color: ok ? "#166534" : "#B91C1C",
      padding: "10px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.4, marginBottom: 10 }}>
      {children}
    </div>
  );
}

const sectionLabel = {
  fontSize: 12, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase",
  letterSpacing: "0.06em", marginTop: 4,
};

const badgeRow = {
  display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap",
};

const editBtn = {
  padding: "7px 12px", borderRadius: 8, border: "1px solid #C7D2FE",
  background: "#EEF2FF", color: "#4338CA", fontWeight: 700, fontSize: 12, cursor: "pointer",
};

const toggleBtn = {
  padding: "7px 12px", borderRadius: 8, border: "1px solid #E8E8F0",
  fontWeight: 600, fontSize: 12, cursor: "pointer",
};

const modalBackdrop = {
  position: "fixed", inset: 0, zIndex: 1000, background: "rgba(17,24,39,.42)",
  display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "18px 12px",
};

const modalCard = {
  width: "100%", maxWidth: 460, maxHeight: "90vh", overflowY: "auto",
  background: "#fff", borderRadius: 20, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,.22)",
  display: "grid", gap: 14,
};

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10,
  border: "1px solid #E5E7EB", background: "#F9FAFB", color: "#111827",
  fontSize: 14, outline: "none",
};

const primaryBtn = {
  padding: "11px 12px", borderRadius: 10, border: "none",
  background: "#6366F1", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer",
};

const secondaryBtn = {
  padding: "11px 12px", borderRadius: 10, border: "1px solid #E5E7EB",
  background: "#fff", color: "#374151", fontWeight: 700, fontSize: 13, cursor: "pointer",
};
