// app/api/push/subscribe/route.js — simpan/hapus langganan notifikasi HP terkunci (Web Push).
// POST { businessId, subscription } · DELETE { endpoint }

import { sbAdmin } from "../../../../lib/purchasingAliasesAuth.js";
import { requireMember } from "../../../../lib/pushServer.js";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { businessId, subscription, ua } = await req.json();
    const auth = await requireMember(req, businessId);
    if (auth.error) return auth.error;
    const endpoint = String(subscription?.endpoint || "");
    const p256dh = subscription?.keys?.p256dh;
    const key = subscription?.keys?.auth;
    if (!/^https:\/\//.test(endpoint) || !p256dh || !key) {
      return Response.json({ error: "Data langganan tidak lengkap." }, { status: 400 });
    }
    const { error } = await sbAdmin().from("push_subscriptions").upsert({
      business_id: businessId,
      user_id: auth.user.id,
      endpoint,
      p256dh,
      auth: key,
      ua: String(ua || "").slice(0, 200) || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("push subscribe error:", e);
    return Response.json({ error: "Gagal mengaktifkan notifikasi." }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { businessId, endpoint } = await req.json();
    const auth = await requireMember(req, businessId);
    if (auth.error) return auth.error;
    const { error } = await sbAdmin().from("push_subscriptions").delete()
      .eq("endpoint", String(endpoint || "")).eq("user_id", auth.user.id);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("push unsubscribe error:", e);
    return Response.json({ error: "Gagal mematikan notifikasi." }, { status: 500 });
  }
}
