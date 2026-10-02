-- ============================================================
-- NF3 Dapur — stok berjalan.
--
-- Stok yang tampil sebelumnya = SO terakhir saja, sehingga barang masuk
-- (dan produksi, kiriman, waste) setelah SO tidak mengubah angka stok & alert
-- "perlu diisi ulang", dan bahan yang belum pernah di-SO tidak tampil sama sekali.
--
-- Stok berjalan = SO terakhir + masuk/produksi hasil/kiriman diterima
--                 − waste/produksi bahan/kiriman keluar SESUDAH SO itu.
-- Bahan tanpa SO: dasar 0 (has_so = false) dan ditandai di aplikasi.
-- Penjualan POS belum ikut (masih mode pemantauan). SO fisik tetap sumber
-- kebenaran untuk audit: tabel & fungsi lain tidak berubah.
-- Hanya menambah fungsi baru (read-only, security invoker → RLS inv_* berlaku).
-- ============================================================

begin;

create or replace function public.inv_stock_running(p_business uuid)
returns table (
  lokasi text, item_id uuid,
  qty numeric,            -- stok berjalan (tidak minus), null bila SO tersimpan bukan satuan master
  qty_raw numeric,        -- sebelum dipotong ke 0 (minus = catatan keluar melebihi stok)
  qty_so numeric,         -- qty SO terakhir (null bila belum pernah SO)
  so_tanggal date,
  masuk numeric,          -- total masuk sejak SO terakhir (satuan master)
  keluar numeric,         -- total keluar sejak SO terakhir (satuan master)
  has_so boolean,
  harga numeric,
  nilai numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with so as (
    select distinct on (e.lokasi, l.item_id)
      e.lokasi, l.item_id, l.qty, e.tanggal, e.created_at,
      (lower(coalesce(l.satuan, i.satuan)) = lower(i.satuan)) as satuan_master
    from public.inv_event_lines l
    join public.inv_events e on e.id = l.event_id
    join public.inv_items i on i.id = l.item_id
    where e.business_id = p_business and e.jenis = 'so'
    order by e.lokasi, l.item_id, e.tanggal desc, e.created_at desc
  ),
  mv as (
    select m.lokasi, m.item_id, m.tipe, m.qty, m.created_at
    from public.inv_stock_movements(
      p_business, date '2000-01-01', ((now() at time zone 'Asia/Jakarta')::date + 1)
    ) m
    where m.tipe in ('masuk', 'prod_in', 'trf_in', 'waste', 'prod_out', 'trf_out')
  ),
  keys as (
    select lokasi, item_id from so
    union
    select lokasi, item_id from mv
  ),
  agg as (
    select k.lokasi, k.item_id, s.qty as qty_so, s.tanggal as so_tanggal,
      (s.item_id is not null) as has_so, coalesce(s.satuan_master, true) as satuan_master,
      coalesce(sum(m.qty) filter (where m.tipe in ('masuk', 'prod_in', 'trf_in')), 0) as masuk,
      coalesce(sum(m.qty) filter (where m.tipe in ('waste', 'prod_out', 'trf_out')), 0) as keluar
    from keys k
    left join so s on s.lokasi = k.lokasi and s.item_id = k.item_id
    left join mv m on m.lokasi = k.lokasi and m.item_id = k.item_id
      and (s.created_at is null or m.created_at > s.created_at)
    group by k.lokasi, k.item_id, s.qty, s.tanggal, s.item_id, s.satuan_master
  )
  select a.lokasi, a.item_id,
    case when a.satuan_master then greatest(coalesce(a.qty_so, 0) + a.masuk - a.keluar, 0) end,
    case when a.satuan_master then coalesce(a.qty_so, 0) + a.masuk - a.keluar end,
    a.qty_so, a.so_tanggal, a.masuk, a.keluar, a.has_so, i.harga,
    case when a.satuan_master
      then round(greatest(coalesce(a.qty_so, 0) + a.masuk - a.keluar, 0) * i.harga, 2) end
  from agg a
  join public.inv_items i on i.id = a.item_id;
$$;

revoke all on function public.inv_stock_running(uuid) from public, anon;
grant execute on function public.inv_stock_running(uuid) to authenticated;

commit;
