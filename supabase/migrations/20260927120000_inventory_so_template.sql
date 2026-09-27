-- ============================================================
-- NF3 Dapur — template SO per outlet (nama & satuan seperti laporan WA staf),
-- satuan input asli per baris, dan lampiran foto.
-- ============================================================

begin;

-- ── Template SO per lokasi ──────────────────────────────────
-- label   = nama persis seperti staf menulis di WA ("Ayam reg", "Cumi cb ijo")
-- satuan_so = satuan yang staf pakai saat menghitung (porsi, ekor, karung, ml)
-- isi     = berapa satuan master (inv_items.satuan) per 1 satuan_so. NULL = belum diketahui.
create table if not exists public.inv_so_template (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lokasi text not null check (lokasi in ('GDG', 'KBU', 'KSM', 'SMT')),
  item_id uuid not null references public.inv_items(id) on delete cascade,
  label text not null,
  grup text,
  urut int not null default 0,
  satuan_so text not null,
  isi numeric(18,6),
  catatan text,
  aktif boolean not null default true,
  unique (business_id, lokasi, label)
);

create index if not exists idx_inv_so_template_lokasi on public.inv_so_template (business_id, lokasi, urut);

alter table public.inv_so_template enable row level security;
drop policy if exists inv_so_template_select on public.inv_so_template;
create policy inv_so_template_select on public.inv_so_template
  for select using (public.is_business_member(business_id));
drop policy if exists inv_so_template_write on public.inv_so_template;
create policy inv_so_template_write on public.inv_so_template
  for all
  using (public.business_role(business_id) in ('owner', 'admin', 'purchasing'))
  with check (public.business_role(business_id) in ('owner', 'admin', 'purchasing'));

-- ── Kolom tambahan ──────────────────────────────────────────
alter table public.inv_event_lines add column if not exists qty_input numeric(18,4);
alter table public.inv_event_lines add column if not exists satuan_input text;
alter table public.inv_event_lines add column if not exists label text;
alter table public.inv_events add column if not exists foto text[] not null default '{}';

-- ── RPC: dukung satuan input & foto ─────────────────────────
-- Baris boleh membawa satuan_input/qty_input/label. Jika satuan baris (satuan) beda dengan
-- satuan master (konversi belum diatur), nilai = 0 supaya tidak menyesatkan nilai stok.
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
  v_satuan text;
  v_harga numeric;
  v_total numeric := 0;
  v_out_item uuid;
  v_out_qty numeric;
  v_unit_cost numeric;
  v_masuk_count int := 0;
  v_foto text[];
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

  select coalesce(array_agg(x), '{}') into v_foto
  from jsonb_array_elements_text(coalesce(p_event->'foto', '[]'::jsonb)) as x
  where x like p_business::text || '/%';

  insert into public.inv_events (business_id, client_ref, jenis, lokasi, tanggal, shift, recipe_id, catatan, created_by_name, foto)
  values (
    p_business, v_ref, v_jenis, v_lokasi,
    coalesce((p_event->>'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date),
    nullif(p_event->>'shift', ''),
    nullif(p_event->>'recipe_id', '')::uuid,
    nullif(p_event->>'catatan', ''),
    nullif(p_event->>'created_by_name', ''),
    v_foto
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
    v_satuan := coalesce(nullif(v_line->>'satuan', ''), v_item.satuan);
    v_harga := case when lower(v_satuan) = lower(v_item.satuan) then v_item.harga else 0 end;

    if v_arah = 'masuk' then
      v_masuk_count := v_masuk_count + 1;
      v_out_item := v_item.id;
      v_out_qty := v_qty;
      insert into public.inv_event_lines (event_id, business_id, item_id, arah, qty, satuan, harga, nilai, alasan, qty_input, satuan_input, label)
      values (v_event, p_business, v_item.id, 'masuk', v_qty, v_satuan, 0, 0, nullif(v_line->>'alasan', ''),
              nullif(v_line->>'qty_input', '')::numeric, nullif(v_line->>'satuan_input', ''), nullif(v_line->>'label', ''));
    else
      insert into public.inv_event_lines (event_id, business_id, item_id, arah, qty, satuan, harga, nilai, alasan, qty_input, satuan_input, label)
      values (v_event, p_business, v_item.id, v_arah, v_qty, v_satuan, v_harga,
              round(v_qty * v_harga, 2), nullif(v_line->>'alasan', ''),
              nullif(v_line->>'qty_input', '')::numeric, nullif(v_line->>'satuan_input', ''), nullif(v_line->>'label', ''));
      v_total := v_total + round(v_qty * v_harga, 2);
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

-- Snapshot: nilai hanya dihitung bila satuan baris = satuan master (kolom satuan ditambah).
drop function if exists public.inv_stock_snapshot(uuid);
create function public.inv_stock_snapshot(p_business uuid)
returns table (lokasi text, item_id uuid, qty numeric, tanggal date, shift text, harga numeric, nilai numeric, satuan text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (e.lokasi, l.item_id)
    e.lokasi, l.item_id, l.qty, e.tanggal, e.shift, i.harga,
    case when lower(coalesce(l.satuan, i.satuan)) = lower(i.satuan) then round(l.qty * i.harga, 2) else 0 end as nilai,
    coalesce(l.satuan, i.satuan) as satuan
  from public.inv_event_lines l
  join public.inv_events e on e.id = l.event_id
  join public.inv_items i on i.id = l.item_id
  where e.business_id = p_business and e.jenis = 'so'
  order by e.lokasi, l.item_id, e.tanggal desc, e.created_at desc;
$$;

revoke all on function public.inv_stock_snapshot(uuid) from public, anon;
grant execute on function public.inv_stock_snapshot(uuid) to authenticated;

commit;

-- ── Storage foto (bucket privat, folder pertama = business_id) ─────────
insert into storage.buckets (id, name, public)
values ('inv-foto', 'inv-foto', false)
on conflict (id) do nothing;

-- Folder pertama = business_id. CASE menjamin cast uuid hanya dicoba untuk bucket inv-foto.
create or replace function public.inv_foto_allowed(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_bucket <> 'inv-foto' then false
    when coalesce(split_part(p_name, '/', 1), '') !~ '^[0-9a-fA-F-]{36}$' then false
    else public.is_business_member(split_part(p_name, '/', 1)::uuid)
  end;
$$;
revoke all on function public.inv_foto_allowed(text, text) from public, anon;
grant execute on function public.inv_foto_allowed(text, text) to authenticated;

drop policy if exists inv_foto_select on storage.objects;
create policy inv_foto_select on storage.objects
  for select to authenticated
  using (public.inv_foto_allowed(bucket_id, name));

drop policy if exists inv_foto_insert on storage.objects;
create policy inv_foto_insert on storage.objects
  for insert to authenticated
  with check (public.inv_foto_allowed(bucket_id, name));
