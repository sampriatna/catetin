// app/api/parse/route.js
// Server route — parsing AI voice + scan nota.
// ANTHROPIC_API_KEY hanya ada di server, tidak pernah ke browser.

const MODEL = "claude-sonnet-4-6";

async function callClaude(body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  const raw = (data.content || [])
    .filter(b => b.type === "text").map(b => b.text).join("")
    .replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

export async function POST(req) {
  try {
    const { mode, text, image, media, categories = [] } = await req.json();
    const catList = categories
      .map(c => `${c.name}(${c.type === "in" ? "pemasukan" : "pengeluaran"})`)
      .join(", ");

    if (mode === "purchasing") {
      const result = await callClaude({
        model: MODEL, max_tokens: 1200,
        messages: [{
          role: "user",
          content: `Kamu mesin pencatat BELANJA purchasing resto Indonesia. Ubah kalimat jadi transaksi belanja.
Kelompok akuntansi (pilih SATU yang paling cocok, nama persis): ${catList}.
Aturan: ribu/rb=x1000, juta/jt=x1000000. "ayam", "ubi", "minyak" = NAMA BARANG (masuk items), BUKAN kategori.
Balas HANYA JSON tanpa markdown:
{"category":"<kelompok dari daftar>","amount":<total bulat>,"supplier":"<toko/pasar jika disebut>","items":[{"name":"<nama barang>","qty":<angka>,"unit":"kg|pcs|liter|...","unitPrice":<harga satuan bulat>}],"desc":"<ringkas opsional>"}

Kalimat: "${text}"`,
        }],
      });
      return Response.json(result);
    }

    if (mode === "text") {
      const result = await callClaude({
        model: MODEL, max_tokens: 1000,
        messages: [{
          role: "user",
          content: `Kamu mesin pencatat keuangan UMKM Indonesia. Ubah kalimat jadi SATU transaksi.
Kategori tersedia: ${catList}.
Aturan konversi: ribu/rb=x1000, juta/jt/sejuta=x1000000, setengah juta=500000, ratus ribu=x100000.
Kata kunci pemasukan: jual/laku/dapat/terima/masuk/penjualan.
Kata kunci pengeluaran: beli/bayar/kulakan/gaji/modal keluar/bayar/pengeluaran.
Balas HANYA JSON tanpa markdown: {"type":"in"|"out","category":"<nama persis dari daftar>","amount":<angka bulat>,"desc":"<ringkas>"}

Kalimat: "${text}"`,
        }],
      });
      return Response.json(result);
    }

    if (mode === "receipt") {
      const result = await callClaude({
        model: MODEL, max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: image } },
            { type: "text", text: `Baca nota/struk ini. Kategori: ${categories.map(c => c.name).join(", ")}.
Balas HANYA JSON tanpa markdown: {"type":"out","category":"<yang paling cocok>","amount":<total bulat>,"desc":"<merchant + ringkas>","date":"YYYY-MM-DD atau kosong"}` },
          ],
        }],
      });
      return Response.json(result);
    }

    if (mode === "cicilan") {
      const result = await callClaude({
        model: MODEL, max_tokens: 800,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: image } },
            { type: "text", text: `Ini screenshot pilihan cicilan PayLater (Shopee SPayLater / Kredivo / dll) atau rincian pesanan.
Ambil: harga/total yang dicicil (pokok), nama produk singkat, dan SEMUA opsi tenor beserta nominal per bulan.
Angka Rupiah: titik = pemisah ribuan (Rp4.247.027 = 4247027).
Balas HANYA JSON tanpa markdown:
{"pokok":<angka bulat>,"label":"<nama produk singkat>","options":[{"tenor":<bulan>,"perBulan":<angka bulat>}]}` },
          ],
        }],
      });
      return Response.json(result);
    }

    return Response.json({ error: "mode tidak dikenal" }, { status: 400 });

  } catch (e) {
    console.error("Parse error:", e);
    return Response.json({ error: "Gagal memproses", detail: String(e) }, { status: 500 });
  }
}
