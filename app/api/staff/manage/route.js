// app/api/staff/manage/route.js
// Super Admin (owner) mengelola akun staf: nama, role/outlet, status, dan password.
// Password lama tidak pernah dibaca/ditampilkan; owner hanya bisa menetapkan password baru.

import { requireOwnerAdmin } from "../../../../lib/purchasingAliasesAuth.js";

const STAFF_ROLES = new Set(["admin", "kasir", "purchasing", "dapur"]);
const OUTLETS = new Set(["KBU", "KSM", "SMT"]);

function normalizeOutlet(role, outlet) {
  const raw = String(outlet || "").trim();
  if (role === "kasir" || role === "dapur") {
    const code = raw.toUpperCase();
    if (!OUTLETS.has(code)) {
      throw new Error(`${role === "dapur" ? "Dapur" : "Kasir"} wajib outlet KBU, KSM, atau SMT.`);
    }
    return code;
  }
  if (role === "purchasing") {
    // Purchasing boleh kosong (umum/gudang) atau punya lokasi khusus seperti Jagasatru.
    return raw || null;
  }
  return null;
}

export async function PATCH(req) {
  try {
    const body = await req.json();
    const {
      businessId,
      memberId,
      name,
      role,
      outlet,
      active,
      newPassword,
    } = body || {};

    if (!businessId || !memberId) {
      return Response.json({ error: "businessId dan memberId wajib." }, { status: 400 });
    }

    const access = await requireOwnerAdmin(req, businessId);
    if (access.error) return access.error;

    // "Super Admin" di NF3 = owner. Admin Keuangan tetap tidak boleh reset password staf.
    if (access.role !== "owner") {
      return Response.json({ error: "Hanya Owner / Super Admin yang boleh mengubah akun staf." }, { status: 403 });
    }

    const admin = access.admin;
    const { data: target, error: targetErr } = await admin
      .from("business_members")
      .select("id, user_id, role, outlet, active")
      .eq("id", memberId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (targetErr) throw targetErr;
    if (!target) {
      return Response.json({ error: "Staf tidak ditemukan di bisnis ini." }, { status: 404 });
    }
    if (target.role === "owner") {
      return Response.json({ error: "Akun Owner tidak boleh diubah dari Kelola Staf." }, { status: 400 });
    }
    if (target.user_id === access.user.id) {
      return Response.json({ error: "Gunakan Pengaturan Akun untuk mengubah akun kamu sendiri." }, { status: 400 });
    }

    const nextRole = role == null ? target.role : String(role).trim().toLowerCase();
    if (!STAFF_ROLES.has(nextRole)) {
      return Response.json({ error: "Role staf tidak valid." }, { status: 400 });
    }

    let nextOutlet;
    try {
      nextOutlet = normalizeOutlet(nextRole, outlet);
    } catch (e) {
      return Response.json({ error: e.message }, { status: 400 });
    }

    const cleanName = String(name || "").trim();
    if (!cleanName) {
      return Response.json({ error: "Nama staf wajib diisi." }, { status: 400 });
    }

    const password = String(newPassword || "");
    if (password && password.length < 6) {
      return Response.json({ error: "Password baru minimal 6 karakter." }, { status: 400 });
    }

    const nextActive = typeof active === "boolean" ? active : target.active;

    const { error: memberErr } = await admin
      .from("business_members")
      .update({
        role: nextRole,
        outlet: nextOutlet,
        active: nextActive,
      })
      .eq("id", target.id)
      .eq("business_id", businessId);
    if (memberErr) throw memberErr;

    const { error: profileErr } = await admin
      .from("profiles")
      .update({ name: cleanName })
      .eq("id", target.user_id);
    if (profileErr) throw profileErr;

    let passwordChanged = false;
    if (password) {
      const { error: passwordErr } = await admin.auth.admin.updateUserById(
        target.user_id,
        { password }
      );
      if (passwordErr) throw passwordErr;
      passwordChanged = true;
    }

    return Response.json({
      ok: true,
      member: {
        id: target.id,
        user_id: target.user_id,
        role: nextRole,
        outlet: nextOutlet,
        active: nextActive,
        name: cleanName,
      },
      passwordChanged,
    });
  } catch (e) {
    console.error("[api/staff/manage]", e);
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
