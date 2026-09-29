// app/api/push/notify/route.js — kabari HP terkunci setelah ada permintaan/kiriman stok atau SO baru.
// Dipanggil aplikasi setelah simpan berhasil: POST { businessId, kind: "transfer"|"so", id }.
// Isi notifikasi dibaca ulang dari database (bukan dari pengirim), penerima ditentukan lib/liveNotif.js
// sama persis dengan pop-up di aplikasi. Pelaku aksi tidak ikut dikabari.

import { sbAdmin } from "../../../../lib/purchasingAliasesAuth.js";
import { pushReady, requireMember, sendTo, subscribersOf } from "../../../../lib/pushServer.js";
import { notifSo, notifTransfer } from "../../../../lib/liveNotif.js";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { businessId, kind, id } = await req.json();
    const auth = await requireMember(req, businessId);
    if (auth.error) return auth.error;
    if (!pushReady()) return Response.json({ ok: true, sent: 0, note: "VAPID_PRIVATE_KEY belum diatur" });
    if (!id || !["transfer", "so"].includes(kind)) return Response.json({ error: "kind/id tidak valid." }, { status: 400 });

    const admin = sbAdmin();
    const table = kind === "transfer" ? "inv_transfers" : "inv_events";
    const { data: row, error } = await admin.from(table).select("*").eq("id", id).eq("business_id", businessId).maybeSingle();
    if (error) throw error;
    if (!row) return Response.json({ error: "Data tidak ditemukan." }, { status: 404 });

    const penerima = await subscribersOf(businessId);
    let sent = 0;
    for (const { user, subs } of penerima) {
      if (user.id === auth.user.id) continue;
      const n = kind === "transfer" ? notifTransfer(row, user) : notifSo(row, user);
      if (!n) continue;
      sent += await sendTo(subs, { title: n.title, body: n.body, href: n.href, tag: n.key });
    }
    return Response.json({ ok: true, sent });
  } catch (e) {
    console.error("push notify error:", e);
    return Response.json({ error: "Gagal mengirim notifikasi." }, { status: 500 });
  }
}
