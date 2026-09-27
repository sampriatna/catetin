// app/api/invite/route.js
// Buat undangan staf (server-side) — verifikasi owner + insert via service role.

import { createClient } from "@supabase/supabase-js";
import { getAppOriginFromRequest } from "../../../lib/appUrl.js";

function sbAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server env belum lengkap");
  return createClient(url, key);
}

function sbUser(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function appOrigin(req) {
  return getAppOriginFromRequest(req);
}

export async function POST(req) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) {
      return Response.json({ error: "Sesi login tidak ditemukan. Silakan login ulang." }, { status: 401 });
    }

    const { businessId, email, role, outlet, businessName } = await req.json();
    if (!businessId) {
      return Response.json({ error: "Bisnis tidak dipilih." }, { status: 400 });
    }

    const userClient = sbUser(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) {
      return Response.json({ error: "Sesi tidak valid. Login ulang." }, { status: 401 });
    }

    const admin = sbAdmin();
    const { data: member, error: memErr } = await admin
      .from("business_members")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", authData.user.id)
      .eq("active", true)
      .maybeSingle();

    if (memErr) throw memErr;
    if (member?.role !== "owner") {
      return Response.json({ error: "Hanya owner yang bisa mengundang staf." }, { status: 403 });
    }

    const outletRole = role === "kasir" || role === "dapur";
    if (outletRole && !["KBU", "KSM", "SMT"].includes(String(outlet || "").toUpperCase())) {
      return Response.json({ error: `${role === "dapur" ? "Dapur" : "Kasir"} wajib outlet (KBU, KSM, atau SMT).` }, { status: 400 });
    }
    if (!outletRole && outlet) {
      return Response.json({ error: "Purchasing dan Admin tidak pakai outlet — kosongkan outlet." }, { status: 400 });
    }

    const { data: invite, error: invErr } = await admin
      .from("invites")
      .insert({
        business_id: businessId,
        email: email || null,
        role: role || "kasir",
        outlet: outletRole ? String(outlet).toUpperCase() : null,
        invited_by: authData.user.id,
      })
      .select()
      .single();

    if (invErr) {
      const msg = invErr.message || String(invErr);
      if (/relation.*invites.*does not exist/i.test(msg)) {
        return Response.json({
          error: "Tabel invites belum ada di Supabase. Jalankan supabase/schema.sql di SQL Editor.",
        }, { status: 500 });
      }
      if (/function.*accept_invite.*does not exist/i.test(msg)) {
        return Response.json({ error: msg }, { status: 500 });
      }
      throw invErr;
    }

    const inviteUrl = `${appOrigin(req)}/login?invite=${invite.token}`;

    return Response.json({
      ok: true,
      invite,
      inviteUrl,
      businessName: businessName || null,
      message: "Link undangan siap. Kirim manual via WhatsApp.",
    });
  } catch (e) {
    console.error("[api/invite]", e);
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
