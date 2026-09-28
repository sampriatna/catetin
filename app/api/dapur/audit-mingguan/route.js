// app/api/dapur/audit-mingguan/route.js — audit stok per periode (biasanya seminggu) + narasi AI.
// Angka dihitung dari data dengan izin user (RLS), AI hanya menulis ringkasan dari angka itu.
// Tanpa ANTHROPIC_API_KEY / bila AI gagal → narasi otomatis (fallbackAuditNarrative).

import Anthropic from "@anthropic-ai/sdk";
import { bearerToken, requireOwnerAdmin, sbUser } from "../../../../lib/purchasingAliasesAuth.js";
import { fallbackAuditNarrative, salesDaysFrom, weeklyAuditSummary } from "../../../../lib/inventoryLogic.js";

export const dynamic = "force-dynamic";

const MODEL = "claude-opus-5-5";

const NARASI_SCHEMA = {
  type: "object",
  properties: {
    ringkasan: { type: "string" },
    poin: { type: "array", items: { type: "string" } },
    tindakan: { type: "array", items: { type: "string" } },
  },
  required: ["ringkasan", "poin", "tindakan"],
  additionalProperties: false,
};

const SYSTEM = `Kamu auditor stok untuk usaha F&B di Indonesia (gudang + outlet KBU, Kisamen/KSM, Samtaro/SMT).
Tulis dalam bahasa Indonesia yang singkat dan jelas untuk pemilik usaha.
Aturan:
- Hanya pakai angka yang ada di data. Jangan mengarang angka atau nama barang.
- Bahasa netral, tidak menuduh orang. Gunakan "perlu dicek", "kemungkinan", bukan "dicuri" atau "staf curang".
- Hasil SO fisik adalah sumber kebenaran; jangan menyarankan mengubah angka SO.
- Sebutkan tingkat keyakinan bila rendah (mis. belum ada data penjualan).
- ringkasan: 2-3 kalimat. poin: maksimal 5, urut dari nilai Rp terbesar/prioritas tertinggi. tindakan: 2-4 langkah praktis minggu depan.`;

async function aiNarrative(summary) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: NARASI_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Data audit (JSON):\n${JSON.stringify(summary)}` }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text);
  return { ...parsed, sumber: "ai", model: response.model };
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

export async function POST(req) {
  try {
    const { businessId, dari, sampai, userName } = await req.json();
    if (!isDate(dari) || !isDate(sampai) || sampai < dari) {
      return Response.json({ error: "Periode tidak valid." }, { status: 400 });
    }
    if ((new Date(sampai) - new Date(dari)) / 86400000 > 62) {
      return Response.json({ error: "Periode maksimal 2 bulan." }, { status: 400 });
    }
    const auth = await requireOwnerAdmin(req, businessId);
    if (auth.error) return auth.error;

    const db = sbUser(bearerToken(req));
    const [items, mv, uploads, notes] = await Promise.all([
      db.from("inv_items").select("id, nama, satuan, harga").eq("business_id", businessId),
      db.rpc("inv_stock_movements", { p_business: businessId, p_from: addDays(dari, -21), p_to: sampai }),
      db.from("inv_sales_uploads").select("dari, sampai, lokasi, per_hari").eq("business_id", businessId).gte("sampai", addDays(dari, -21)).lte("dari", sampai),
      db.from("inv_audit_notes").select("finding_key, status, catatan").eq("business_id", businessId),
    ]);
    for (const r of [items, mv, uploads, notes]) if (r.error) throw new Error(r.error.message);

    const itemsById = Object.fromEntries((items.data || []).map((i) => [i.id, i]));
    const noteMap = Object.fromEntries((notes.data || []).map((n) => [n.finding_key, { status: n.status, catatan: n.catatan }]));
    const summary = weeklyAuditSummary(mv.data || [], itemsById, { from: dari, to: sampai, salesDays: salesDaysFrom(uploads.data), notes: noteMap });

    let narasi = null;
    let aiError = null;
    try {
      narasi = await aiNarrative(summary);
    } catch (e) {
      aiError = e?.message || String(e);
      console.error("audit-mingguan AI error:", e);
    }
    if (!narasi) narasi = fallbackAuditNarrative(summary);

    const saved = await db
      .from("inv_audit_reports")
      .upsert({
        business_id: businessId, dari, sampai, data: summary, narasi, sumber_narasi: narasi.sumber,
        created_by_name: userName || auth.user.email || null, updated_at: new Date().toISOString(),
      }, { onConflict: "business_id,dari,sampai" })
      .select("id, dari, sampai, data, narasi, sumber_narasi, created_by_name, updated_at")
      .single();
    if (saved.error) throw new Error(saved.error.message);

    return Response.json({ report: saved.data, aiError });
  } catch (e) {
    console.error("audit-mingguan error:", e);
    return Response.json({ error: e?.message || "Gagal membuat laporan audit." }, { status: 500 });
  }
}
