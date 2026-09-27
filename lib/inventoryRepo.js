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

/** SO terakhir per bahan per lokasi (lihat fungsi SQL inv_stock_snapshot). */
export async function loadStockSnapshot(bizId) {
  const res = await supabase.rpc("inv_stock_snapshot", { p_business: bizId });
  return must(res, "Muat stok") || [];
}

export async function loadEvents(bizId, { lokasi = null, jenis = null, limit = 40 } = {}) {
  let q = supabase
    .from("inv_events")
    .select("id, jenis, lokasi, tanggal, shift, catatan, total_nilai, created_by_name, created_at, foto, lines:inv_event_lines(item_id, arah, qty, satuan, harga, nilai, alasan, qty_input, satuan_input, label)")
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
    .select("id, lokasi, item_id, label, grup, urut, satuan_so, isi, catatan, aktif")
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
