// lib/inventoryRepo.js — akses Supabase untuk modul Dapur (tabel inv_*).

import { supabase } from "./supabaseClient";

function must(res, label) {
  if (res.error) {
    const msg = res.error.message || String(res.error);
    throw new Error(`${label}: ${msg}`);
  }
  return res.data;
}

export async function loadItems(bizId) {
  const res = await supabase
    .from("inv_items")
    .select("id, kode, nama, kategori, tipe, satuan, harga, lokasi, min_stok, aktif, catatan, updated_at")
    .eq("business_id", bizId)
    .order("nama");
  return must(res, "Muat bahan") || [];
}

export async function loadRecipes(bizId) {
  const res = await supabase
    .from("inv_recipes")
    .select("id, nama, output_item_id, hasil_qty, catatan, aktif, lines:inv_recipe_lines(id, item_id, qty)")
    .eq("business_id", bizId)
    .order("nama");
  return must(res, "Muat resep") || [];
}

/** Nilai stok per lokasi per hari, N hari terakhir (lihat inv_stock_value_series). */
export async function loadStockValueSeries(bizId, days = 14) {
  const res = await supabase.rpc("inv_stock_value_series", { p_business: bizId, p_days: days });
  return must(res, "Muat riwayat nilai stok") || [];
}

/** SO terakhir per bahan per lokasi (lihat fungsi SQL inv_stock_snapshot). */
export async function loadStockSnapshot(bizId) {
  const res = await supabase.rpc("inv_stock_snapshot", { p_business: bizId });
  return must(res, "Muat stok") || [];
}

export async function loadEvents(bizId, { lokasi = null, jenis = null, limit = 40 } = {}) {
  let q = supabase
    .from("inv_events")
    .select("id, jenis, lokasi, tanggal, shift, catatan, total_nilai, created_by, created_by_name, created_at, foto, area, sumber, lines:inv_event_lines(item_id, arah, qty, satuan, harga, nilai, alasan, qty_input, satuan_input, label)")
    .eq("business_id", bizId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (lokasi) q = q.eq("lokasi", lokasi);
  if (jenis) q = q.eq("jenis", jenis);
  return must(await q, "Muat riwayat") || [];
}

/** Daftar SO per outlet (nama & satuan seperti laporan WA staf). */
export async function loadSoTemplates(bizId) {
  const res = await supabase
    .from("inv_so_template")
    .select("id, lokasi, item_id, label, grup, urut, satuan_so, isi, catatan, aktif, area")
    .eq("business_id", bizId)
    .order("lokasi")
    .order("urut");
  return must(res, "Muat daftar SO") || [];
}

export async function saveSoTemplate(bizId, row) {
  const data = {
    business_id: bizId,
    lokasi: row.lokasi,
    item_id: row.item_id,
    label: String(row.label || "").trim(),
    grup: row.grup || null,
    urut: Number(row.urut) || 0,
    satuan_so: String(row.satuan_so || "").trim(),
    isi: row.isi === "" || row.isi === null || row.isi === undefined ? null : Number(String(row.isi).replace(",", ".")),
    catatan: row.catatan || null,
    aktif: row.aktif !== false,
    area: row.area === "dapur" || row.area === "bar" ? row.area : null,
  };
  if (!data.label || !data.satuan_so || !data.item_id) throw new Error("Nama, bahan, dan satuan wajib diisi");
  if (data.isi !== null && !(data.isi > 0)) throw new Error("Isi konversi harus lebih dari 0");
  const q = row.id
    ? supabase.from("inv_so_template").update(data).eq("id", row.id).select().single()
    : supabase.from("inv_so_template").insert(data).select().single();
  return must(await q, "Simpan daftar SO");
}

const FOTO_BUCKET = "inv-foto";

/** Kecilkan foto HP (maks 1280px, JPEG) sebelum upload supaya hemat kuota. */
async function compressImage(file, max = 1280, quality = 0.7) {
  if (typeof window === "undefined" || !file.type?.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob || file;
  } catch {
    return file;
  }
}

/** Upload foto lampiran SO/waste. Return daftar path (folder pertama = bizId). */
export async function uploadFotos(bizId, clientRef, files, tanggal) {
  const paths = [];
  for (let i = 0; i < (files || []).length; i++) {
    const blob = await compressImage(files[i]);
    const path = `${bizId}/${tanggal || "tanpa-tanggal"}/${clientRef}-${i + 1}.jpg`;
    const res = await supabase.storage.from(FOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    // Kirim ulang setelah gagal di tengah jalan: file dengan nama sama sudah ada → pakai yang lama.
    if (res.error && !/exist|duplicate/i.test(res.error.message || "")) must(res, "Upload foto");
    paths.push(path);
  }
  return paths;
}

export async function fotoUrls(paths) {
  if (!paths?.length) return [];
  const res = await supabase.storage.from(FOTO_BUCKET).createSignedUrls(paths, 3600);
  return (must(res, "Buka foto") || []).map((x) => x.signedUrl).filter(Boolean);
}

/** Data ringan untuk status hari ini (checklist beranda & tab Hari Ini). */
/** Semua pergerakan stok (satuan master) dalam rentang tanggal — bahan audit. */
export async function loadStockMovements(bizId, from, to) {
  const res = await supabase.rpc("inv_stock_movements", { p_business: bizId, p_from: from, p_to: to });
  return must(res, "Muat pergerakan stok") || [];
}

export async function loadDapurToday(bizId, { lokasi = null, today } = {}) {
  let ev = supabase
    .from("inv_events")
    .select("id, jenis, lokasi, tanggal, total_nilai, created_by, created_by_name, created_at, area")
    .eq("business_id", bizId)
    .eq("tanggal", today);
  if (lokasi && lokasi !== "GDG") ev = ev.eq("lokasi", lokasi);
  const tr = supabase
    .from("inv_transfers")
    .select("id, status, dari, ke, tanggal, created_at")
    .eq("business_id", bizId)
    .in("status", ["diminta", "dikirim"]);
  const [e, t] = await Promise.all([ev, tr]);
  return { events: must(e, "Muat status stok") || [], transfers: must(t, "Muat kiriman") || [] };
}

export async function loadTransfers(bizId, { limit = 60 } = {}) {
  const res = await supabase
    .from("inv_transfers")
    .select("id, dari, ke, status, tanggal, catatan, foto, total_nilai, diminta_by, diminta_by_name, diminta_at, dikirim_by_name, dikirim_at, diterima_by_name, diterima_at, created_at, lines:inv_transfer_lines(id, item_id, label, satuan, isi, qty_minta, qty_kirim, qty_terima, harga, nilai, urut)")
    .eq("business_id", bizId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (must(res, "Muat permintaan stok") || []).map((t) => ({ ...t, lines: [...(t.lines || [])].sort((a, b) => a.urut - b.urut) }));
}

/** action: minta | kirim | terima | batal (lihat RPC inv_transfer_save). */
export async function saveTransfer(bizId, action, transfer, lines) {
  const res = await supabase.rpc("inv_transfer_save", {
    p_business: bizId,
    p_action: action,
    p_transfer: transfer,
    p_lines: lines || [],
  });
  return must(res, "Simpan");
}

export async function submitEvent(bizId, event, lines) {
  const res = await supabase.rpc("inv_submit_event", {
    p_business: bizId,
    p_event: event,
    p_lines: lines,
  });
  return must(res, "Simpan");
}

export async function deleteEvent(eventId) {
  return must(await supabase.from("inv_events").delete().eq("id", eventId), "Hapus");
}

export async function saveItem(bizId, item) {
  const row = {
    business_id: bizId,
    kode: String(item.kode || "").trim().toUpperCase(),
    nama: String(item.nama || "").trim(),
    kategori: item.kategori || null,
    tipe: item.tipe || "bahan",
    satuan: String(item.satuan || "pcs").trim(),
    harga: Number(item.harga) || 0,
    lokasi: Array.isArray(item.lokasi) ? item.lokasi : [],
    min_stok: item.min_stok === "" || item.min_stok === null || item.min_stok === undefined ? null : Number(item.min_stok),
    aktif: item.aktif !== false,
    catatan: item.catatan || null,
    updated_at: new Date().toISOString(),
  };
  if (!row.kode || !row.nama) throw new Error("Kode dan nama wajib diisi");
  const q = item.id
    ? supabase.from("inv_items").update(row).eq("id", item.id).select().single()
    : supabase.from("inv_items").insert(row).select().single();
  return must(await q, "Simpan bahan");
}

/** Simpan resep + baris bahan (ganti semua baris). */
export async function saveRecipe(bizId, recipe) {
  const head = {
    business_id: bizId,
    nama: String(recipe.nama || "").trim(),
    output_item_id: recipe.output_item_id,
    hasil_qty: Number(recipe.hasil_qty) || 0,
    catatan: recipe.catatan || null,
    aktif: recipe.aktif !== false,
    updated_at: new Date().toISOString(),
  };
  if (!head.nama || !head.output_item_id || head.hasil_qty <= 0) {
    throw new Error("Nama resep, hasil, dan jumlah hasil wajib diisi");
  }
  const lines = (recipe.lines || []).filter((l) => l.item_id && Number(l.qty) > 0);
  if (!lines.length) throw new Error("Resep minimal punya satu bahan");
  const saved = recipe.id
    ? must(await supabase.from("inv_recipes").update(head).eq("id", recipe.id).select().single(), "Simpan resep")
    : must(await supabase.from("inv_recipes").insert(head).select().single(), "Simpan resep");
  must(await supabase.from("inv_recipe_lines").delete().eq("recipe_id", saved.id), "Simpan resep");
  must(
    await supabase.from("inv_recipe_lines").insert(lines.map((l) => ({ recipe_id: saved.id, item_id: l.item_id, qty: Number(l.qty) }))),
    "Simpan bahan resep"
  );
  return saved;
}

// ── Tahap B: resep menu (BOM) & penjualan POS ─────────────

export async function loadMenus(bizId) {
  const res = await supabase
    .from("inv_menus")
    .select("id, lokasi, nama, kategori, harga_jual, catatan, aktif, updated_at, lines:inv_menu_lines(id, item_id, qty, qty_input, satuan_input, urut)")
    .eq("business_id", bizId)
    .order("lokasi")
    .order("nama");
  return (must(res, "Muat resep menu") || []).map((m) => ({ ...m, lines: [...(m.lines || [])].sort((a, b) => a.urut - b.urut) }));
}

/** Simpan menu + baris bahan per porsi (qty dalam satuan master bahan; ganti semua baris). */
export async function saveMenu(bizId, menu) {
  const head = {
    business_id: bizId,
    lokasi: menu.lokasi,
    nama: String(menu.nama || "").trim(),
    kategori: menu.kategori || null,
    harga_jual: menu.harga_jual === "" || menu.harga_jual === null || menu.harga_jual === undefined ? null : Number(menu.harga_jual),
    catatan: menu.catatan || null,
    aktif: menu.aktif !== false,
    updated_at: new Date().toISOString(),
  };
  if (!head.nama || !head.lokasi) throw new Error("Nama menu dan outlet wajib diisi");
  const lines = (menu.lines || []).filter((l) => l.item_id && Number(l.qty) > 0);
  const saved = menu.id
    ? must(await supabase.from("inv_menus").update(head).eq("id", menu.id).select().single(), "Simpan menu")
    : must(await supabase.from("inv_menus").insert(head).select().single(), "Simpan menu");
  must(await supabase.from("inv_menu_lines").delete().eq("menu_id", saved.id), "Simpan resep menu");
  if (lines.length) {
    must(await supabase.from("inv_menu_lines").insert(lines.map((l, i) => ({
      menu_id: saved.id, business_id: bizId, item_id: l.item_id, qty: Number(l.qty),
      qty_input: l.qty_input === undefined || l.qty_input === "" ? null : Number(l.qty_input), satuan_input: l.satuan_input || null, urut: i,
    }))), "Simpan bahan menu");
  }
  return saved;
}

export async function loadMenuAliases(bizId) {
  const res = await supabase
    .from("inv_menu_aliases")
    .select("id, lokasi, nama_pos, nama_norm, menu_id, abaikan, updated_at")
    .eq("business_id", bizId)
    .order("nama_pos");
  return must(res, "Muat nama menu POS") || [];
}

/** Hubungkan nama POS ke menu resep, atau tandai diabaikan (tidak memakai stok). */
export async function saveMenuAlias(id, { menu_id = null, abaikan = false }) {
  const res = await supabase
    .from("inv_menu_aliases")
    .update({ menu_id, abaikan, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  return must(res, "Simpan pemetaan menu");
}

export async function loadSalesUploads(bizId, { limit = 30 } = {}) {
  const res = await supabase
    .from("inv_sales_uploads")
    .select("id, sumber, nama_file, dari, sampai, lokasi, per_hari, baris, total_qty, total_omset, created_by_name, created_at")
    .eq("business_id", bizId)
    .order("sampai", { ascending: false })
    .limit(limit);
  return must(res, "Muat riwayat upload") || [];
}

/** Rekap penjualan per menu dalam rentang tanggal (baris rekap periode tercatat di tanggal akhir periode). */
export async function loadSalesLines(bizId, from, to) {
  const res = await supabase
    .from("inv_sales_lines")
    .select("lokasi, tanggal, dari, sampai, nama_pos, nama_norm, kategori, qty, omset")
    .eq("business_id", bizId)
    .gte("tanggal", from)
    .lte("tanggal", to)
    .limit(20000);
  return must(res, "Muat penjualan") || [];
}

export async function saveSalesUpload(bizId, upload, lines) {
  const res = await supabase.rpc("inv_sales_save", { p_business: bizId, p_upload: upload, p_lines: lines });
  return must(res, "Simpan penjualan");
}

export async function deleteSalesUpload(id) {
  return must(await supabase.from("inv_sales_uploads").delete().eq("id", id), "Hapus upload");
}
