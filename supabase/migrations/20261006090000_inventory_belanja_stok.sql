-- ============================================================
-- NF3 Dapur — belanja purchasing → barang masuk stok.
-- inv_purchase_map: padanan nama barang di nota/belanja (+ satuan beli) ke bahan master,
-- dengan isi konversi (1 satuan beli = isi × satuan master). abaikan = bukan barang stok
-- (ongkir, sabun, gas…) supaya tidak ditanya lagi. Diatur sekali oleh purchasing/owner.
-- Barang masuk dari belanja memakai client_ref "belanja:<id transaksi>" → tidak bisa dobel.
-- ============================================================

begin;

create table if not exists public.inv_purchase_map (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  nama_norm text not null,          -- nama belanja dinormalkan (huruf kecil, spasi tunggal)
  satuan_norm text not null default '',
  item_id uuid references public.inv_items(id) on delete cascade,
  isi numeric check (isi is null or isi > 0),
  abaikan boolean not null default false,
  contoh text,                      -- nama asli terakhir, untuk tampilan
  updated_by uuid default auth.uid(),
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique (business_id, nama_norm, satuan_norm),
  check (abaikan or item_id is not null)
);

alter table public.inv_purchase_map enable row level security;

drop policy if exists inv_purchase_map_select on public.inv_purchase_map;
create policy inv_purchase_map_select on public.inv_purchase_map for select
  using (public.is_business_member(business_id));

drop policy if exists inv_purchase_map_write on public.inv_purchase_map;
create policy inv_purchase_map_write on public.inv_purchase_map for all
  using (public.business_role(business_id) in ('owner', 'admin', 'purchasing'))
  with check (public.business_role(business_id) in ('owner', 'admin', 'purchasing'));

grant select, insert, update, delete on public.inv_purchase_map to authenticated;

commit;
