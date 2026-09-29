// app/api/dapur/baca-kemasan/route.js — baca foto kemasan (botol sirup, jerigen, kaleng, bungkus)
// untuk mengisi ukuran isi otomatis (mis. 1 btl = 760 ml). Pakai model murah (Haiku) karena tugasnya
// hanya membaca label. Hasil hanya saran: user tetap melihat & bisa mengubah angkanya sebelum simpan.

import Anthropic from "@anthropic-ai/sdk";
import { bearerToken, sbAdmin, sbUser } from "../../../../lib/purchasingAliasesAuth.js";
import { normalisasiIsi } from "../../../../lib/inventoryLogic.js";

export const dynamic = "force-dynamic";

const MODEL = "claude-haiku-4-5";
const MAX_BASE64 = 4_000_000; // ±3 MB gambar; klien sudah mengecilkan ke 1280px

const SCHEMA = {
  type: "object",
  properties: {
    nama_produk: { type: "string" },
    merek: { type: "string" },
    isi: { type: ["number", "null"] },
    satuan_isi: { type: ["string", "null"] },
    yakin: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
    catatan: { type: "string" },
  },
  required: ["nama_produk", "merek", "isi", "satuan_isi", "yakin", "catatan"],
  additionalProperties: false,
};

const SYSTEM = `Kamu membaca foto kemasan bahan F&B (sirup, susu, gula cair, selai, bubuk, kaleng) untuk usaha di Indonesia.
Tugas: temukan isi bersih / volume satu kemasan yang tertulis di label (mis. "Netto 760 ml", "Isi 1 L", "Berat bersih 500 g").
Aturan:
- Hanya pakai angka yang terbaca di foto. Jangan menebak dari ukuran botol atau pengetahuan umum merek.
- Kalau tidak terbaca jelas, isi = null, satuan_isi = null, yakin = "rendah", dan jelaskan singkat di catatan.
- satuan_isi: ml, l, gr, kg, atau pcs (untuk isi per bungkus, mis. 10 sachet).
- nama_produk & merek singkat seperti tertulis (mis. merek "Marjan", nama_produk "Sirup Leci"). Kosongkan bila tidak terbaca.
- catatan: maksimal 1 kalimat, bahasa Indonesia.`;

const ROLES = ["owner", "admin", "purchasing"];

async function requireManager(req, businessId) {
  const token = bearerToken(req);
  if (!token) return { error: Response.json({ error: "Sesi login tidak ditemukan." }, { status: 401 }) };
  if (!businessId) return { error: Response.json({ error: "businessId wajib." }, { status: 400 }) };
  const { data: authData, error: authErr } = await sbUser(token).auth.getUser();
  if (authErr || !authData?.user) return { error: Response.json({ error: "Sesi tidak valid." }, { status: 401 }) };
  const { data: member, error } = await sbAdmin()
    .from("business_members")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!member || !ROLES.includes(member.role)) {
    return { error: Response.json({ error: "Hanya owner/admin/purchasing yang bisa memakai baca kemasan." }, { status: 403 }) };
  }
  return { user: authData.user };
}

export async function POST(req) {
  try {
    const { businessId, image, mediaType } = await req.json();
    const auth = await requireManager(req, businessId);
    if (auth.error) return auth.error;
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: "Baca foto otomatis belum aktif (ANTHROPIC_API_KEY belum diatur). Isi ukuran manual dulu." }, { status: 503 });
    }
    const type = ["image/jpeg", "image/png", "image/webp"].includes(mediaType) ? mediaType : "image/jpeg";
    const data = String(image || "").replace(/^data:[^,]+,/, "");
    if (!data) return Response.json({ error: "Foto kosong." }, { status: 400 });
    if (data.length > MAX_BASE64) return Response.json({ error: "Foto terlalu besar." }, { status: 413 });

    const client = new Anthropic();
    const content = [
      { type: "image", source: { type: "base64", media_type: type, data } },
      { type: "text", text: "Berapa isi satu kemasan ini? Jawab JSON sesuai skema." },
    ];
    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content }],
      });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      // Cadangan bila format terstruktur ditolak: minta JSON biasa lalu ambil objeknya.
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: `${SYSTEM}\nBalas hanya satu objek JSON dengan kunci: nama_produk, merek, isi, satuan_isi, yakin, catatan.`,
        messages: [{ role: "user", content }],
      });
    }
    if (response.stop_reason === "refusal") {
      return Response.json({ error: "Foto tidak bisa dibaca. Isi ukuran manual." }, { status: 422 });
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json);
    const norm = normalisasiIsi(parsed.isi, parsed.satuan_isi);
    return Response.json({
      nama_produk: parsed.nama_produk || "",
      merek: parsed.merek || "",
      isi: norm.isi,
      satuan: norm.satuan,
      yakin: parsed.yakin,
      catatan: parsed.catatan || "",
    });
  } catch (e) {
    console.error("baca-kemasan error:", e);
    return Response.json({ error: "Gagal membaca foto. Coba foto lebih dekat ke label, atau isi manual." }, { status: 500 });
  }
}
