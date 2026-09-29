// lib/pushServer.js — kirim notifikasi HP terkunci (Web Push) dari server. Hanya dipakai di app/api/push/*.

import webpush from "web-push";
import { bearerToken, sbAdmin, sbUser } from "./purchasingAliasesAuth.js";
import { resolveAuthMembership } from "./membershipResolve.js";
import { VAPID_PUBLIC_KEY } from "./pushConfig.js";

let configured = false;

/** Siap kirim? (VAPID_PRIVATE_KEY sudah diisi di Vercel). */
export function pushReady() {
  if (configured) return true;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@nusafishing.com", VAPID_PUBLIC_KEY, priv);
  configured = true;
  return true;
}

/** Login + anggota aktif bisnis ini. */
export async function requireMember(req, businessId) {
  const token = bearerToken(req);
  if (!token) return { error: Response.json({ error: "Sesi login tidak ditemukan." }, { status: 401 }) };
  if (!businessId) return { error: Response.json({ error: "businessId wajib." }, { status: 400 }) };
  const { data: authData, error: authErr } = await sbUser(token).auth.getUser();
  if (authErr || !authData?.user) return { error: Response.json({ error: "Sesi tidak valid." }, { status: 401 }) };
  const { data: member, error } = await sbAdmin()
    .from("business_members")
    .select("role, outlet")
    .eq("business_id", businessId)
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!member) return { error: Response.json({ error: "Bukan anggota bisnis ini." }, { status: 403 }) };
  return { user: authData.user, member };
}

/**
 * Penerima yang punya langganan di bisnis ini, lengkap dengan peran efektif (sama seperti di aplikasi).
 * @returns {Promise<Array<{ user: {id, role, outlet}, subs: object[] }>>}
 */
export async function subscribersOf(businessId) {
  const admin = sbAdmin();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("business_id", businessId);
  if (error) throw error;
  if (!subs?.length) return [];
  const ids = [...new Set(subs.map((s) => s.user_id))];
  const { data: members, error: mErr } = await admin
    .from("business_members")
    .select("user_id, role, outlet")
    .eq("business_id", businessId)
    .eq("active", true)
    .in("user_id", ids);
  if (mErr) throw mErr;
  const out = [];
  for (const m of members || []) {
    let email = "";
    try {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      email = data?.user?.email || "";
    } catch {
      /* peran tanpa pemetaan email */
    }
    const r = resolveAuthMembership({ role: m.role, outlet: m.outlet, email });
    out.push({ user: { id: m.user_id, role: r.role, outlet: r.outlet }, subs: subs.filter((s) => s.user_id === m.user_id) });
  }
  return out;
}

/** Kirim ke semua HP satu penerima; langganan kedaluwarsa (404/410) dihapus. */
export async function sendTo(subs, payload) {
  const admin = sbAdmin();
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 3600, urgency: "high", topic: String(payload.tag || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined },
      );
      sent += 1;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("push gagal:", e?.statusCode, e?.body || e?.message);
      }
    }
  }));
  return sent;
}
