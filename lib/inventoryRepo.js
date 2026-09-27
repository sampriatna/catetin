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
    .select("id, jenis, lokasi, tanggal, shift, catatan, total_nilai, created_by_name, created_at, lines:inv_event_lines(item_id, arah, qty, satuan, harga, nilai, alasan)")
    .eq("business_id", bizId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (lokasi) q = q.eq("lokasi", lokasi);
  if (jenis) q = q.eq("jenis", jenis);
  return must(await q, "Muat riwayat") || [];
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
