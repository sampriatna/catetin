-- ============================================================
-- NF3 Dapur — master bahan, resep produksi, SO shift, waste, produksi
-- Tabel baru (prefix inv_) — tidak menyentuh app_state / app_transactions.
-- Semua simpan lewat RPC inv_submit_event (atomik + idempoten via client_ref).
-- ============================================================

begin;

-- Outlet member aktif (dipakai aturan: kasir hanya boleh input untuk outletnya)
create or replace function public.business_outlet(b uuid)
returns text language sql security definer stable set search_path = public as $$
  select outlet from public.business_members
  where business_id = b and user_id = auth.uid() and active
  limit 1;
$$;

-- ── Master bahan ────────────────────────────────────────────
create table if not exists public.inv_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kode text not null,
  nama text not null,
  kategori text,
  tipe text not null default 'bahan'
    check (tipe in ('bahan', 'setengah_jadi', 'kemasan', 'lainnya')),
  satuan text not null default 'pcs',
  harga numeric(18,4) not null default 0,
  lokasi text[] not null default '{}',
  min_stok numeric(18,4),
  aktif boolean not null default true,
  catatan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, kode)
);

create index if not exists idx_inv_items_business on public.inv_items (business_id, aktif);

comment on table public.inv_items is
  'Master bahan dapur. harga = modal per satuan (bahan: dari master/purchasing, setengah jadi: dari produksi terakhir). lokasi kosong = semua lokasi.';

-- ── Resep produksi ──────────────────────────────────────────
create table if not exists public.inv_recipes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  output_item_id uuid not null references public.inv_items(id) on delete restrict,
  nama text not null,
  hasil_qty numeric(18,4) not null check (hasil_qty > 0),
  catatan text,
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inv_recipe_lines (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.inv_recipes(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  qty numeric(18,4) not null check (qty > 0)
);

create index if not exists idx_inv_recipes_business on public.inv_recipes (business_id);
create index if not exists idx_inv_recipe_lines_recipe on public.inv_recipe_lines (recipe_id);

-- ── Kejadian (SO / waste / produksi) ────────────────────────
create table if not exists public.inv_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_ref text not null,
  jenis text not null check (jenis in ('so', 'waste', 'produksi')),
  lokasi text not null,
  tanggal date not null,
  shift text,
  recipe_id uuid references public.inv_recipes(id) on delete set null,
  catatan text,
  total_nilai numeric(18,2) not null default 0,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (business_id, client_ref)
);

create table if not exists public.inv_event_lines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.inv_events(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null references public.inv_items(id) on delete restrict,
  arah text not null check (arah in ('hitung', 'keluar', 'masuk')),
  qty numeric(18,4) not null check (qty >= 0),
  satuan text,
  harga numeric(18,4) not null default 0,
  nilai numeric(18,2) not null default 0,
  alasan text
);

create index if not exists idx_inv_events_lookup on public.inv_events (business_id, jenis, lokasi, tanggal desc);
create index if not exists idx_inv_event_lines_event on public.inv_event_lines (event_id);
create index if not exists idx_inv_event_lines_item on public.inv_event_lines (business_id, item_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table public.inv_items enable row level security;
alter table public.inv_recipes enable row level security;
alter table public.inv_recipe_lines enable row level security;
alter table public.inv_events enable row level security;
alter table public.inv_event_lines enable row level security;

drop policy if exists inv_items_select on public.inv_items;
create policy inv_items_select on public.inv_items
  for select using (public.is_business_member(business_id));
drop policy if exists inv_items_write on public.inv_items;
create policy inv_items_write on public.inv_items
  for all
  using (public.business_role(business_id) in ('owner', 'admin', 'purchasing'))
  with check (public.business_role(business_id) in ('owner', 'admin', 'purchasing'));

drop policy if exists inv_recipes_select on public.inv_recipes;
create policy inv_recipes_select on public.inv_recipes
  for select using (public.is_business_member(business_id));
drop policy if exists inv_recipes_write on public.inv_recipes;
create policy inv_recipes_write on public.inv_recipes
  for all
  using (public.business_role(business_id) in ('owner', 'admin', 'purchasing'))
  with check (public.business_role(business_id) in ('owner', 'admin', 'purchasing'));

drop policy if exists inv_recipe_lines_select on public.inv_recipe_lines;
create policy inv_recipe_lines_select on public.inv_recipe_lines
  for select using (exists (
    select 1 from public.inv_recipes r
    where r.id = recipe_id and public.is_business_member(r.business_id)));
drop policy if exists inv_recipe_lines_write on public.inv_recipe_lines;
create policy inv_recipe_lines_write on public.inv_recipe_lines
  for all
  using (exists (
    select 1 from public.inv_recipes r
    where r.id = recipe_id and public.business_role(r.business_id) in ('owner', 'admin', 'purchasing')))
  with check (exists (
    select 1 from public.inv_recipes r
    where r.id = recipe_id and public.business_role(r.business_id) in ('owner', 'admin', 'purchasing')));

-- Event: baca semua anggota; tulis hanya lewat RPC; hapus owner/admin (koreksi salah input)
drop policy if exists inv_events_select on public.inv_events;
create policy inv_events_select on public.inv_events
  for select using (public.is_business_member(business_id));
drop policy if exists inv_events_delete on public.inv_events;
create policy inv_events_delete on public.inv_events
  for delete using (public.business_role(business_id) in ('owner', 'admin'));

drop policy if exists inv_event_lines_select on public.inv_event_lines;
create policy inv_event_lines_select on public.inv_event_lines
  for select using (public.is_business_member(business_id));

-- ── RPC simpan event (atomik, idempoten) ────────────────────
-- p_event: {client_ref, jenis, lokasi, tanggal, shift, recipe_id, catatan, created_by_name}
-- p_lines: [{item_id, arah, qty, alasan}] — harga diambil dari inv_items (snapshot)
-- Produksi: baris 'keluar' = bahan terpakai, tepat satu baris 'masuk' = hasil.
--   Modal hasil per satuan = total nilai bahan / qty hasil → disimpan ke inv_items.harga hasil.
create or replace function public.inv_submit_event(p_business uuid, p_event jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.business_role(p_business);
  v_outlet text := public.business_outlet(p_business);
  v_jenis text := p_event->>'jenis';
  v_lokasi text := upper(coalesce(p_event->>'lokasi', ''));
  v_ref text := p_event->>'client_ref';
  v_existing uuid;
  v_event uuid;
  v_line jsonb;
  v_item public.inv_items;
  v_qty numeric;
  v_arah text;
  v_total numeric := 0;
  v_out_item uuid;
  v_out_qty numeric;
  v_unit_cost numeric;
  v_masuk_count int := 0;
begin
  if v_role is null then
    raise exception 'bukan anggota bisnis ini';
  end if;
  if v_jenis not in ('so', 'waste', 'produksi') then
    raise exception 'jenis tidak dikenal: %', v_jenis;
  end if;
  if v_lokasi not in ('GDG', 'KBU', 'KSM', 'SMT') then
    raise exception 'lokasi tidak dikenal: %', v_lokasi;
  end if;
  if v_role = 'kasir' and v_lokasi <> upper(coalesce(v_outlet, '')) then
    raise exception 'kasir hanya boleh input untuk outlet %', coalesce(v_outlet, '-');
  end if;
  if coalesce(v_ref, '') = '' then
    raise exception 'client_ref wajib';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'minimal satu baris bahan';
  end if;

  select id into v_existing from public.inv_events
  where business_id = p_business and client_ref = v_ref;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'duplicate', true);
  end if;

  insert into public.inv_events (business_id, client_ref, jenis, lokasi, tanggal, shift, recipe_id, catatan, created_by_name)
  values (
    p_business, v_ref, v_jenis, v_lokasi,
    coalesce((p_event->>'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date),
    nullif(p_event->>'shift', ''),
    nullif(p_event->>'recipe_id', '')::uuid,
    nullif(p_event->>'catatan', ''),
    nullif(p_event->>'created_by_name', '')
  )
  returning id into v_event;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.inv_items
    where id = (v_line->>'item_id')::uuid and business_id = p_business;
    if not found then
      raise exception 'bahan tidak ditemukan: %', v_line->>'item_id';
    end if;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    if v_qty < 0 then
      raise exception 'qty tidak boleh minus (%)', v_item.nama;
    end if;
    v_arah := case v_jenis
      when 'so' then 'hitung'
      when 'waste' then 'keluar'
      else coalesce(v_line->>'arah', 'keluar') end;
    if v_jenis = 'produksi' and v_arah not in ('keluar', 'masuk') then
      raise exception 'arah produksi harus keluar/masuk';
    end if;
    if v_jenis = 'waste' and v_qty = 0 then
      continue;
    end if;

    if v_arah = 'masuk' then
      v_masuk_count := v_masuk_count + 1;
      v_out_item := v_item.id;
      v_out_qty := v_qty;
      insert into public.inv_event_lines (event_id, business_id, item_id, arah, qty, satuan, harga, nilai, alasan)
      values (v_event, p_business, v_item.id, 'masuk', v_qty, v_item.satuan, 0, 0, nullif(v_line->>'alasan', ''));
    else
      insert into public.inv_event_lines (event_id, business_id, item_id, arah, qty, satuan, harga, nilai, alasan)
      values (v_event, p_business, v_item.id, v_arah, v_qty, v_item.satuan, v_item.harga,
              round(v_qty * v_item.harga, 2), nullif(v_line->>'alasan', ''));
      v_total := v_total + round(v_qty * v_item.harga, 2);
    end if;
  end loop;

  if v_jenis = 'produksi' then
    if v_masuk_count <> 1 or coalesce(v_out_qty, 0) <= 0 then
      raise exception 'produksi wajib satu hasil dengan qty > 0';
    end if;
    v_unit_cost := v_total / v_out_qty;
    update public.inv_event_lines
      set harga = v_unit_cost, nilai = v_total
      where event_id = v_event and arah = 'masuk';
    update public.inv_items
      set harga = v_unit_cost, updated_at = now()
      where id = v_out_item;
  end if;

  update public.inv_events set total_nilai = v_total where id = v_event;

  return jsonb_build_object('id', v_event, 'duplicate', false, 'total_nilai', v_total, 'unit_cost', v_unit_cost);
end;
$$;

revoke all on function public.inv_submit_event(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.inv_submit_event(uuid, jsonb, jsonb) to authenticated;

-- ── Stok per lokasi = SO terakhir per bahan ─────────────────
-- security invoker: RLS inv_* tetap berlaku untuk pemanggil.
create or replace function public.inv_stock_snapshot(p_business uuid)
returns table (lokasi text, item_id uuid, qty numeric, tanggal date, shift text, harga numeric, nilai numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (e.lokasi, l.item_id)
    e.lokasi, l.item_id, l.qty, e.tanggal, e.shift, i.harga, round(l.qty * i.harga, 2) as nilai
  from public.inv_event_lines l
  join public.inv_events e on e.id = l.event_id
  join public.inv_items i on i.id = l.item_id
  where e.business_id = p_business and e.jenis = 'so'
  order by e.lokasi, l.item_id, e.tanggal desc, e.created_at desc;
$$;

grant execute on function public.inv_stock_snapshot(uuid) to authenticated;

commit;
