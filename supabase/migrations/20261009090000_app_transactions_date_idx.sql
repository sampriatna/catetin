-- ============================================================
-- Indeks tanggal transaksi — hanya mempercepat pencarian per tanggal (NF3 Assistant, Belanja → Stok).
-- Tidak mengubah data. Diukur: baca 1 tahun transaksi 1,2 dtk → ±0,03 dtk per 1000 baris.
-- (Di produksi dibuat dengan CREATE INDEX CONCURRENTLY supaya tidak mengunci simpan transaksi.)
-- ============================================================

create index if not exists app_transactions_biz_date_idx
  on public.app_transactions (business_id, (data->>'date'));
