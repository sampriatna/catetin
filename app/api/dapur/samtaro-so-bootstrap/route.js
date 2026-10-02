// Daftar SO Samtaro — bootstrap idempotent production.
// Prinsip: MELENGKAPI, bukan menimpa. Item/template yang sudah ada dipertahankan.
// Kandidat baru hanya ditambahkan bila item yang sama belum ada di daftar SO SMT.

import {
  bearerToken,
  sbAdmin,
  sbUser,
} from "../../../../lib/purchasingAliasesAuth.js";

const BUSINESS_ID = "e23ed572-234c-4995-acad-fa6bff7c58d2";

const ITEMS = [
  // Tambahan owner sebelumnya — tetap dipertahankan.
  { kode: "KOPIBUBUK", nama: "Bubuk Kopi", kategori: "Beverage", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "GULCAIR", nama: "Gula Cair", kategori: "Bumbu", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "SKM", nama: "SKM Pillow", kategori: "Beverage", tipe: "bahan", satuan: "kg", harga: 0, min_stok: 0 },
  { kode: "GLAB", nama: "Gula Aren Bubuk", kategori: "Bumbu", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "POWMTCH", nama: "Powder Matcha", kategori: "Beverage", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "POWHZLNT", nama: "Powder Hazelnut Chocolate", kategori: "Beverage", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "SUSFRES", nama: "Susu freshmilk", kategori: "Beverage", tipe: "bahan", satuan: "l", harga: 0, min_stok: 0 },
  { kode: "SMENTAI", nama: "Saus Mentai", kategori: "Olahan", tipe: "setengah_jadi", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "SSPMAYO", nama: "Saus Spicy Mayo", kategori: "Olahan", tipe: "setengah_jadi", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "SBAKARAN", nama: "Saus Bakaran", kategori: "Olahan", tipe: "setengah_jadi", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "CREMPREM", nama: "Creamer Premium", kategori: "Beverage", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "POWKEJU", nama: "Bubuk Keju", kategori: "Bumbu", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "ATOOM", nama: "Bubuk Atoom Bulan", kategori: "Bumbu", tipe: "bahan", satuan: "pcs", harga: 0, min_stok: 0 },

  // Master yang dipakai daftar kertas Samtaro.
  { kode: "ESBATU", nama: "Es Batu", kategori: "Beverage", tipe: "bahan", satuan: "kantong", harga: 0, min_stok: 0 },
  { kode: "AIRGALON", nama: "Air Galon Isi Ulang", kategori: "Beverage", tipe: "bahan", satuan: "galon", harga: 0, min_stok: 0 },
  { kode: "DIMSUM", nama: "Dimsum", kategori: "Frozen", tipe: "setengah_jadi", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "GYOZA", nama: "Gyoza", kategori: "Frozen", tipe: "setengah_jadi", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "SERBUKNORI", nama: "Serbuk Nori", kategori: "Bumbu", tipe: "bahan", satuan: "bungkus", harga: 0, min_stok: 0 },
  { kode: "MINBAWANG", nama: "Minyak Bawang", kategori: "Bumbu", tipe: "bahan", satuan: "gr", harga: 0, min_stok: 0 },
  { kode: "CHILIOIL", nama: "Chili Oil", kategori: "Bumbu", tipe: "setengah_jadi", satuan: "l", harga: 0, min_stok: 0 },
  { kode: "STRUFFLE", nama: "Saus Black Truffle", kategori: "Olahan", tipe: "setengah_jadi", satuan: "gr", harga: 0, min_stok: 0 },

  { kode: "CUPCHILI25", nama: "Cup Chili Oil 25ml", kategori: "Kemasan", tipe: "kemasan", satuan: "pack", harga: 0, min_stok: 0 },
  { kode: "GELAS14SET", nama: "Gelas Plastik + Tutup 14oz", kategori: "Kemasan", tipe: "kemasan", satuan: "pack", harga: 0, min_stok: 0 },
  { kode: "1CUP", nama: "Kresek 1 Cup", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "2CUP", nama: "Kresek 2 Cup", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "TUTUPSEAL", nama: "Tutup Seal Gelas Plastik", kategori: "Kemasan", tipe: "kemasan", satuan: "pack", harga: 0, min_stok: 0 },
  { kode: "BOXDIMSUM", nama: "Paper Box Dimsum", kategori: "Kemasan", tipe: "kemasan", satuan: "pack", harga: 0, min_stok: 0 },
  { kode: "PAPERBOWL", nama: "Paper Bowl + Tutup", kategori: "Kemasan", tipe: "kemasan", satuan: "pack", harga: 0, min_stok: 0 },
  { kode: "FOIL DIM", nama: "Alumunium Dimsum", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "ALUSHEET", nama: "Alumunium Sheet Roll", kategori: "Kemasan", tipe: "kemasan", satuan: "roll", harga: 0, min_stok: 0 },
  { kode: "SUMPT", nama: "Sumpit Kayu", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "SNDOKPLSTK", nama: "Sendok Makan Plastik", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "SEDTN", nama: "Sedotan", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "TUSUKBAKAR", nama: "Tusuk Bakaran", kategori: "Kemasan", tipe: "kemasan", satuan: "pack", harga: 0, min_stok: 0 },
  { kode: "UK15", nama: "Kresek Uk15", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "UK24", nama: "Kresek Uk24", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "PSAMPAH", nama: "Plastik Sampah", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },

  { kode: "SRNGPLSTK", nama: "Sarung Tangan Plastik", kategori: "Cleaning", tipe: "lainnya", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "GASTORCH", nama: "Botol Gas Torch Isi", kategori: "Peralatan Dapur", tipe: "lainnya", satuan: "botol", harga: 0, min_stok: 0 },
  { kode: "SERBET", nama: "Serbet", kategori: "Peralatan Dapur", tipe: "lainnya", satuan: "pack", harga: 0, min_stok: 0 },
  { kode: "SABUNCUCI", nama: "Sabun Cuci Piring", kategori: "Cleaning", tipe: "lainnya", satuan: "pouch", harga: 0, min_stok: 0 },
  { kode: "COLEK", nama: "Sabun Colek", kategori: "Cleaning", tipe: "lainnya", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "SPONS", nama: "Spons", kategori: "Cleaning", tipe: "lainnya", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "CLINGREFIL", nama: "Cling Refil", kategori: "Kemasan", tipe: "kemasan", satuan: "pouch", harga: 0, min_stok: 0 },
  { kode: "TISU", nama: "Tisu", kategori: "Kemasan", tipe: "kemasan", satuan: "pcs", harga: 0, min_stok: 0 },
  { kode: "WIPOL", nama: "Wipol", kategori: "Cleaning", tipe: "lainnya", satuan: "botol", harga: 0, min_stok: 0 },
  { kode: "KERTASROTI", nama: "Kertas Roti", kategori: "Kemasan", tipe: "kemasan", satuan: "lembar", harga: 0, min_stok: 0 },
];

// 13 tambahan owner sebelumnya tetap sama.
const OWNER_SO = [
  { kode: "KOPIBUBUK", label: "Bubuk kopi", urut: 50, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "GULCAIR", label: "Gula cair", urut: 60, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "SKM", label: "SKM", urut: 70, satuan: "kg", grup: "Stok", isi: 1 },
  { kode: "GLAB", label: "Gula aren", urut: 80, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "POWMTCH", label: "Matcha", urut: 90, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "POWHZLNT", label: "Choco Hazelnut", urut: 100, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "SUSFRES", label: "Fresh milk", urut: 110, satuan: "l", grup: "Stok", isi: 1 },
  { kode: "SMENTAI", label: "Saos mentai", urut: 120, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "SSPMAYO", label: "Saos spicy mayo", urut: 130, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "SBAKARAN", label: "Saos bakaran", urut: 140, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "CREMPREM", label: "Creamer", urut: 150, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "POWKEJU", label: "Bubuk keju", urut: 160, satuan: "gr", grup: "Stok", isi: 1 },
  { kode: "ATOOM", label: "Atom bulan", urut: 170, satuan: "pcs", grup: "Stok", isi: 1 },
];

// Pelengkap dari kertas No. 7–48.
// Baris yang secara master sudah diwakili OWNER_SO / template lama tidak perlu didobel.
const PAPER_SO = [
  { kode: "ESBATU", label: "Es Batu", urut: 180, satuan: "kantong", grup: "Bahan Minuman", isi: 1 },
  { kode: "AIRGALON", label: "Air Galon Isi Ulang", urut: 190, satuan: "galon", grup: "Bahan Minuman", isi: 1 },

  { kode: "SERBUKNORI", label: "Serbuk Nori", urut: 200, satuan: "bungkus", grup: "Bahan Makanan", isi: 1 },
  { kode: "MINBAWANG", label: "Minyak Bawang", urut: 210, satuan: "thinwall", grup: "Bahan Makanan", isi: null },
  { kode: "CHILIOIL", label: "Chili Oil (500ml)", urut: 220, satuan: "batch", grup: "Bahan Makanan", isi: null },
  { kode: "STRUFFLE", label: "Saus Black trufle", urut: 230, satuan: "batch", grup: "Bahan Makanan", isi: null },

  { kode: "CUPCHILI25", label: "Cup Chili Oil 25ml", urut: 240, satuan: "pack", grup: "Packaging", isi: 1 },
  { kode: "GELAS14SET", label: "Gelas Plastik + Tutup 14oz", urut: 250, satuan: "pack", grup: "Packaging", isi: 1 },
  { kode: "1CUP", label: "Plastik kemasan 1 cup", urut: 260, satuan: "pack", grup: "Packaging", isi: null },
  { kode: "2CUP", label: "Plastik kemasan 2 cup", urut: 270, satuan: "pack", grup: "Packaging", isi: null },
  { kode: "TUTUPSEAL", label: "Tutup Seal Gelas Plastik", urut: 280, satuan: "pack", grup: "Packaging", isi: 1 },
  { kode: "BOXDIMSUM", label: "Paper Box Dimsum", urut: 290, satuan: "pack", grup: "Packaging", isi: 1 },
  { kode: "PAPERBOWL", label: "Paper Bowl + Tutup", urut: 300, satuan: "pack", grup: "Packaging", isi: 1 },
  { kode: "FOIL DIM", label: "Alumunium Tray Dimsum", urut: 310, satuan: "pack", grup: "Packaging", isi: null },
  { kode: "ALUSHEET", label: "Alumunium Sheet Roll", urut: 320, satuan: "roll", grup: "Packaging", isi: 1 },
  { kode: "SUMPT", label: "Sumpit Dimsum", urut: 330, satuan: "pack", grup: "Packaging", isi: null },
  { kode: "SNDOKPLSTK", label: "Sendok Plastik", urut: 340, satuan: "pack", grup: "Packaging", isi: null },
  { kode: "SEDTN", label: "Sedotan", urut: 350, satuan: "pack", grup: "Packaging", isi: null },
  { kode: "TUSUKBAKAR", label: "Tusuk Bakaran", urut: 360, satuan: "pack", grup: "Packaging", isi: 1 },
  { kode: "UK15", label: "Plastik Kresek Kecil", urut: 370, satuan: "pack", grup: "Packaging", isi: null },
  { kode: "UK24", label: "Plastik Kresek Sedang", urut: 380, satuan: "pack", grup: "Packaging", isi: null },

  { kode: "PSAMPAH", label: "Plastik Sampah", urut: 390, satuan: "pack", grup: "Peralatan Dapur", isi: null },
  { kode: "SRNGPLSTK", label: "Sarung Tangan Plastik / Latex", urut: 400, satuan: "pack", grup: "Peralatan Dapur", isi: null },
  { kode: "GASTORCH", label: "Botol Gas Torch Isi", urut: 410, satuan: "botol", grup: "Peralatan Dapur", isi: 1 },
  { kode: "SERBET", label: "Serbet", urut: 420, satuan: "pack", grup: "Peralatan Dapur", isi: 1 },
  { kode: "SABUNCUCI", label: "Sabun cuci piring", urut: 430, satuan: "pouch", grup: "Peralatan Dapur", isi: 1 },
  { kode: "COLEK", label: "Sabun colek", urut: 440, satuan: "pcs", grup: "Peralatan Dapur", isi: 1 },
  { kode: "SPONS", label: "Spons", urut: 450, satuan: "pcs", grup: "Peralatan Dapur", isi: 1 },
  { kode: "CLINGREFIL", label: "Cling Refil", urut: 460, satuan: "pouch", grup: "Peralatan Dapur", isi: 1 },
  { kode: "TISU", label: "Tisu", urut: 470, satuan: "pack", grup: "Peralatan Dapur", isi: null },
  { kode: "WIPOL", label: "Wipol", urut: 480, satuan: "botol", grup: "Peralatan Dapur", isi: 1 },
  { kode: "KERTASROTI", label: "Kertas Roti", urut: 490, satuan: "lembar", grup: "Peralatan Dapur", isi: 1 },
];

const SO = [...OWNER_SO, ...PAPER_SO];

function normLabel(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export async function POST(req) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return Response.json({ error: "Sesi login tidak ditemukan." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const businessId = body?.businessId || BUSINESS_ID;
    if (businessId !== BUSINESS_ID) {
      return Response.json({ error: "Bootstrap ini hanya untuk Nusa Food." }, { status: 400 });
    }

    const userClient = sbUser(token);
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) {
      return Response.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const admin = sbAdmin();
    const { data: member, error: memErr } = await admin
      .from("business_members")
      .select("role, outlet, active")
      .eq("business_id", BUSINESS_ID)
      .eq("user_id", authData.user.id)
      .eq("active", true)
      .maybeSingle();

    if (memErr) throw memErr;
    const allowed =
      member &&
      (["owner", "admin", "purchasing"].includes(member.role) ||
        String(member.outlet || "").toUpperCase() === "SMT");
    if (!allowed) {
      return Response.json({ error: "Akun tidak punya akses Samtaro." }, { status: 403 });
    }

    const codes = [...new Set(ITEMS.map((x) => x.kode))];
    const { data: existingRows, error: existingErr } = await admin
      .from("inv_items")
      .select("id, kode, lokasi")
      .eq("business_id", BUSINESS_ID)
      .in("kode", codes);
    if (existingErr) throw existingErr;

    const existing = new Map((existingRows || []).map((x) => [x.kode, x]));
    const missing = ITEMS.filter((x) => !existing.has(x.kode)).map((x) => ({
      business_id: BUSINESS_ID,
      ...x,
      lokasi: ["GDG", "SMT"],
      catatan: "Tambahan SO Samtaro — pelengkap, bukan overwrite",
    }));

    if (missing.length) {
      const { error } = await admin.from("inv_items").insert(missing);
      if (error) throw error;
    }

    // Master lama: jangan ubah nama, satuan, HPP, atau min stok. Hanya tambahkan lokasi SMT bila perlu.
    for (const row of existingRows || []) {
      const lokasi = Array.isArray(row.lokasi) ? row.lokasi : [];
      if (!lokasi.includes("SMT")) {
        const { error } = await admin
          .from("inv_items")
          .update({ lokasi: [...new Set([...lokasi, "SMT"])] })
          .eq("id", row.id);
        if (error) throw error;
      }
    }

    const { data: allRows, error: allErr } = await admin
      .from("inv_items")
      .select("id, kode, satuan")
      .eq("business_id", BUSINESS_ID)
      .in("kode", codes);
    if (allErr) throw allErr;
    const byCode = new Map((allRows || []).map((x) => [x.kode, x]));

    const candidates = SO.map((row) => {
      const item = byCode.get(row.kode);
      if (!item) throw new Error(`Bahan ${row.kode} belum tersedia.`);
      return {
        business_id: BUSINESS_ID,
        lokasi: "SMT",
        item_id: item.id,
        label: row.label,
        grup: row.grup,
        urut: row.urut,
        satuan_so: row.satuan,
        isi: row.isi,
        catatan: row.isi == null ? "Konversi kemasan belum diatur" : null,
        aktif: true,
        area: null,
      };
    });

    // PENTING: jangan overwrite template lama.
    // Dedup berdasarkan item master ATAU label normalisasi agar nama beda sedikit tidak membuat baris ganda.
    const { data: currentTemplates, error: currentErr } = await admin
      .from("inv_so_template")
      .select("item_id, label")
      .eq("business_id", BUSINESS_ID)
      .eq("lokasi", "SMT");
    if (currentErr) throw currentErr;

    const existingItemIds = new Set((currentTemplates || []).map((x) => x.item_id));
    const existingLabels = new Set((currentTemplates || []).map((x) => normLabel(x.label)));

    const toInsert = candidates.filter(
      (row) => !existingItemIds.has(row.item_id) && !existingLabels.has(normLabel(row.label))
    );

    if (toInsert.length) {
      const { error: tpErr } = await admin.from("inv_so_template").insert(toInsert);
      if (tpErr) throw tpErr;
    }

    return Response.json({
      ok: true,
      masterCandidates: ITEMS.length,
      templateCandidates: candidates.length,
      addedTemplates: toInsert.length,
      preservedExistingTemplates: (currentTemplates || []).length,
    });
  } catch (e) {
    console.error("[api/dapur/samtaro-so-bootstrap]", e);
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
