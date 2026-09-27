"use client";
// app/(app)/settings/staf/page.jsx
// Daftar semua staf di bisnis ini. Hanya owner/admin yang akses.

import { useState, useEffect } from "react";
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
const isPurchasingArea = (m) => m?.role === "purchasing" && !!m?.outlet && !KASIR_OUTLETS.has(String(m.outlet).toUpperCase());

export default function StafPage() {
  const { bizId, s } = useApp();
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const isManager = canDo(s?.currentUser?.role, "kelolaStaf");
  const canInvite = canDo(s?.currentUser?.role, "undangStaf");

  useEffect(() => {
    if (!bizId) return;
    let alive = true;
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
    await supabase.from("business_members")
      .update({ active: !current }).eq("id", memberId);
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, active: !current } : m));
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

      {loadErr && (
        <div style={{ background: "#FEE2E2", color: "#B91C1C", padding: "12px 14px", borderRadius: 12, fontSize: 13, marginBottom: 12 }}>
          {loadErr}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9CA3AF" }}>Memuat...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {invites.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 4 }}>
                Undangan belum diterima
              </div>
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
                      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                          background: rc.bg, color: rc.text }}>{ROLE_LABEL[inv.role] || inv.role}</span>
                        {inv.outlet && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                          background: "#EEF2FF", color: "#4338CA" }}>
                          {inv.role === "purchasing" ? `Lokasi: ${inv.outlet}` : inv.outlet}
                        </span>}
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99,
                          background: "#FEF3C7", color: "#B45309" }}>Menunggu daftar/login</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 8 }}>
                Anggota aktif
              </div>
            </>
          )}
          {members.map(m => {
            const rc = ROLE_COLOR[m.role] || ROLE_COLOR.kasir;
            const isMe = m.profiles?.id === s?.currentUser?.id;
            return (
              <div key={m.id} style={{ background: "#fff", border: "1px solid #E8E8F0", borderRadius: 16,
                padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
                opacity: m.active ? 1 : .5 }}>
                {/* avatar */}
                <div style={{ width: 40, height: 40, borderRadius: 99, background: "#EEF2FF",
                  display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800, color: "#6366F1", flexShrink: 0 }}>
                  {(m.profiles?.name || "?")[0].toUpperCase()}
                </div>
                {/* info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "#1A1A2E", fontSize: 14 }}>
                    {m.profiles?.name || "—"} {isMe && <span style={{ fontSize: 11, color: "#9CA3AF" }}>(kamu)</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                      background: rc.bg, color: rc.text }}>{ROLE_LABEL[m.role] || m.role}</span>
                    {m.outlet && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        background: "#EEF2FF", color: "#4338CA" }}>
                        {m.role === "purchasing" ? `Lokasi: ${m.outlet}` : m.outlet}
                      </span>
                    )}
                    {isPurchasingArea(m) && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                        background: "#E0F2FE", color: "#0C4A6E" }}>Lokasi khusus</span>
                    )}
                    {!m.active && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99,
                      background: "#F3F4F6", color: "#9CA3AF" }}>nonaktif</span>}
                  </div>
                </div>
                {/* toggle aktif — tidak bisa nonaktifkan diri sendiri atau owner lain */}
                {!isMe && m.role !== "owner" && (
                  <button onClick={() => toggleActive(m.id, m.active)}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #E8E8F0",
                      background: m.active ? "#FEE2E2" : "#DCFCE7", fontWeight: 600, fontSize: 12,
                      color: m.active ? "#B91C1C" : "#15803D", cursor: "pointer" }}>
                    {m.active ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
