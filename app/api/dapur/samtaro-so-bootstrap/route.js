// Tambahan daftar SO Samtaro — idempotent bootstrap production.
// Dipanggil saat modul Dapur & Stok membuka lokasi SMT agar master + template
// yang diminta owner langsung tersedia tanpa SQL manual.

import {
  bearerToken,
  sbAdmin,
  sbUser,
} from "../../../../lib/purchasingAliasesAuth.js";

const BUSINESS_ID = "e23ed572-234c-4995-acad-fa6bff7c58d2";

const ITEMS = [
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
];

const SO = [
  ["KOPIBUBUK", "Bubuk kopi", 50, "gr"],
  ["GULCAIR", "Gula cair", 60, "gr"],
  ["SKM", "SKM", 70, "kg"],
  ["GLAB", "Gula aren", 80, "gr"],
  ["POWMTCH", "Matcha", 90, "gr"],
  ["POWHZLNT", "Choco Hazelnut", 100, "gr"],
  ["SUSFRES", "Fresh milk", 110, "l"],
  ["SMENTAI", "Saos mentai", 120, "gr"],
  ["SSPMAYO", "Saos spicy mayo", 130, "gr"],
  ["SBAKARAN", "Saos bakaran", 140, "gr"],
  ["CREMPREM", "Creamer", 150, "gr"],
  ["POWKEJU", "Bubuk keju", 160, "gr"],
  ["ATOOM", "Atom bulan", 170, "pcs"],
];

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

    const codes = ITEMS.map((x) => x.kode);
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
      catatan: "Tambahan SO Samtaro 2026-10-01",
    }));

    if (missing.length) {
      const { error } = await admin.from("inv_items").insert(missing);
      if (error) throw error;
    }

    // Item lama dipertahankan nama, satuan, HPP, dan min stoknya; hanya tambahkan SMT ke lokasi.
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

    const templates = SO.map(([kode, label, urut, satuanSo]) => {
      const item = byCode.get(kode);
      if (!item) throw new Error(`Bahan ${kode} belum tersedia.`);
      return {
        business_id: BUSINESS_ID,
        lokasi: "SMT",
        item_id: item.id,
        label,
        grup: "Stok",
        urut,
        satuan_so: satuanSo,
        isi: 1,
        catatan: null,
        aktif: true,
        area: null,
      };
    });

    const { error: tpErr } = await admin
      .from("inv_so_template")
      .upsert(templates, { onConflict: "business_id,lokasi,label" });
    if (tpErr) throw tpErr;

    return Response.json({ ok: true, items: ITEMS.length, templates: templates.length });
  } catch (e) {
    console.error("[api/dapur/samtaro-so-bootstrap]", e);
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
