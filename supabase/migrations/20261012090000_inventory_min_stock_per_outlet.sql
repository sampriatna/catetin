-- ============================================================
-- NF3 Dapur — minimal stok per OUTLET × SKU.
--
-- Sebelumnya minimal stok = kolom global inv_items.min_stok, sehingga satu SKU (mis. SKM)
-- memakai minimum yang sama di KBU, Kisamen, Samtaro, dan Gudang.
--
-- Sekarang: tabel inv_min_stock, satu baris per (business, lokasi, item).
--   * Master SKU tetap satu (inv_items), tidak ada SKU baru per outlet.
--   * Lokasi tanpa baris = "minimal stok belum diatur" (TIDAK mengambil nilai outlet lain / global).
--   * unit = satuan master saat minimum disimpan; bila satuan master berubah, aplikasi
--     menganggap minimum perlu diatur ulang (tidak dibandingkan lintas satuan).
--
-- Aman untuk data lama:
--   * inv_items.min_stok TIDAK dihapus/diubah (dibiarkan untuk kompatibilitas; aplikasi tidak lagi membacanya).
--   * Histori stok, SO, transaksi, satuan tidak disentuh.
--   * Backfill sekali: nilai global lama disalin HANYA ke lokasi tempat bahan itu benar-benar dipakai
--     (ada di daftar SO lokasi itu atau pernah di-SO di sana), ditandai sumber = 'migrasi_global'
--     supaya terlihat di aplikasi untuk dicek ulang. Bisa dibatalkan:
--       delete from public.inv_min_stock where sumber = 'migrasi_global';
-- ============================================================

begin;

create table if not exists public.inv_min_stock (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lokasi text not null,                                           -- outlet_id: GDG / KBU / KSM / SMT
  item_id uuid not null references public.inv_items(id) on delete cascade, -- sku_id
  min_stock numeric(18,4) not null check (min_stock >= 0),
  unit text not null,                                             -- satuan master saat disimpan
  sumber text not null default 'manual' check (sumber in ('manual', 'migrasi_global')),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_by_name text,
  unique (business_id, lokasi, item_id)
);

create index if not exists idx_inv_min_stock_business on public.inv_min_stock (business_id, lokasi);

comment on table public.inv_min_stock is
  'Minimal stok per lokasi (outlet/gudang) × bahan. Tidak ada baris = belum diatur. Menggantikan inv_items.min_stok (global, tidak dipakai lagi).';
comment on column public.inv_items.min_stok is
  'LEGACY — minimal stok global, tidak dipakai aplikasi lagi. Lihat inv_min_stock (per lokasi).';

-- updated_by/updated_at selalu dari sesi yang menyimpan (bukan dari klien).
create or replace function public.inv_min_stock_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end;
$$;

drop trigger if exists trg_inv_min_stock_touch on public.inv_min_stock;
create trigger trg_inv_min_stock_touch before insert or update on public.inv_min_stock
  for each row execute function public.inv_min_stock_touch();

alter table public.inv_min_stock enable row level security;

-- Semua anggota bisnis boleh melihat (status stok tampil untuk staf).
drop policy if exists inv_min_stock_select on public.inv_min_stock;
create policy inv_min_stock_select on public.inv_min_stock
  for select using (public.is_business_member(business_id));

-- Owner/admin: semua lokasi.
drop policy if exists inv_min_stock_write_owner on public.inv_min_stock;
create policy inv_min_stock_write_owner on public.inv_min_stock
  for all
  using (public.business_role(business_id) in ('owner', 'admin'))
  with check (public.business_role(business_id) in ('owner', 'admin'));

-- Semua purchasing (Dodi, Mahmud, Dul/Jagasatru): semua lokasi — purchasing menyesuaikan minimum tiap outlet.
drop policy if exists inv_min_stock_write_gudang on public.inv_min_stock;
drop policy if exists inv_min_stock_write_purchasing on public.inv_min_stock;
create policy inv_min_stock_write_purchasing on public.inv_min_stock
  for all
  using (public.business_role(business_id) = 'purchasing')
  with check (public.business_role(business_id) = 'purchasing');

-- PIC dapur outlet: hanya outletnya sendiri.
drop policy if exists inv_min_stock_write_dapur on public.inv_min_stock;
create policy inv_min_stock_write_dapur on public.inv_min_stock
  for all
  using (public.business_role(business_id) = 'dapur' and lokasi = upper(coalesce(public.business_outlet(business_id), '')))
  with check (public.business_role(business_id) = 'dapur' and lokasi = upper(coalesce(public.business_outlet(business_id), '')));

-- Backfill sekali dari kolom global lama, hanya ke lokasi tempat bahan dipakai.
insert into public.inv_min_stock (business_id, lokasi, item_id, min_stock, unit, sumber, updated_by, updated_by_name)
select distinct on (x.business_id, x.lokasi, x.item_id)
  x.business_id, x.lokasi, x.item_id, i.min_stok, i.satuan, 'migrasi_global', null, 'Migrasi (minimum global lama)'
from (
  select t.business_id, t.lokasi, t.item_id from public.inv_so_template t where t.aktif is not false
  union
  select e.business_id, e.lokasi, l.item_id
  from public.inv_event_lines l join public.inv_events e on e.id = l.event_id
  where e.jenis = 'so'
) x
join public.inv_items i on i.id = x.item_id and i.business_id = x.business_id
where coalesce(i.min_stok, 0) > 0 and x.lokasi in ('GDG', 'KBU', 'KSM', 'SMT')
on conflict (business_id, lokasi, item_id) do nothing;

commit;
