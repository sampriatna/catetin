// app/api/parse/route.js
// Server route — parsing AI voice + scan nota.
// ANTHROPIC_API_KEY hanya ada di server, tidak pernah ke browser.

const MODEL = "claude-sonnet-4-6";

// Baca foto nota berisi banyak item bisa >10 detik.
export const maxDuration = 60;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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

    if (mode === "purchasing_receipt") {
      if (!image || !IMAGE_TYPES.has(media)) {
        return Response.json({ error: "Format foto tidak didukung. Pakai JPG/PNG atau screenshot." }, { status: 400 });
      }
      const result = await callClaude({
        model: MODEL, max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: image } },
            { type: "text", text: `Gambar ini berisi catatan BELANJA purchasing resto Indonesia: bisa foto struk/nota toko, atau screenshot pesan WhatsApp daftar pengeluaran.
Ambil SEMUA baris barang yang dibeli, urut sesuai gambar. Angka di tiap baris adalah HARGA TOTAL baris itu (bukan harga satuan).
Format angka Indonesia: titik = pemisah ribuan (1.296.000 = 1296000, 12.500 = 12500).
Qty & satuan ada di depan nama, contoh "6dus Fresh milk" = qty 6 unit dus; "10lbr kertas roti" = qty 10 unit lbr; "1ikt" = 1 ikat. Tanpa qty (mis. "Bensin Disel 20.000") = qty 1 unit "pcs".
JANGAN masukkan sebagai item: baris total, kas kecil, saku, sisa, saldo, kembalian, tanggal, nama pengirim.
Kelompok akuntansi (pilih SATU yang paling cocok untuk mayoritas belanja, nama persis): ${catList}.
Balas HANYA JSON tanpa markdown:
{"category":"<kelompok dari daftar>","supplier":"<nama toko/pasar jika tertulis, else kosong>","date":"YYYY-MM-DD persis seperti tertulis, else kosong","writtenTotal":<angka total yang tertulis di gambar, else 0>,"items":[{"name":"<nama barang>","qty":<angka>,"unit":"<satuan>","subtotal":<harga total baris, bulat>}],"desc":"<ringkas, mis. Belanja harian 23/09>"}` },
          ],
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

    return Response.json({ error: "mode tidak dikenal" }, { status: 400 });

  } catch (e) {
    console.error("Parse error:", e);
    return Response.json({ error: "Gagal memproses", detail: String(e) }, { status: 500 });
  }
}
