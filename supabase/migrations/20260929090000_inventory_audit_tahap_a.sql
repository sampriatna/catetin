-- ============================================================
-- NF3 Dapur — Tahap A audit stok harian (tanpa data penjualan)
-- * inv_events.area: SO/waste per area (dapur / bar) → status SO per area (KBU Kitchen, KBU Bar, …)
-- * jenis 'masuk' (barang masuk): pembelian / retur / koreksi / lainnya, dengan sumber
-- * inv_stock_movements: semua pergerakan per barang per lokasi dalam satuan master
--   (SO, waste, masuk, hasil & pemakaian produksi, kiriman keluar/diterima) untuk audit.
-- Angka SO tidak pernah dikoreksi; selisih dihitung dari pergerakan.
-- ============================================================

begin;

alter table public.inv_events add column if not exists area text check (area is null or area in ('dapur', 'bar'));
alter table public.inv_events add column if not exists sumber text;
alter table public.inv_events drop constraint if exists inv_events_jenis_check;
alter table public.inv_events add constraint inv_events_jenis_check check (jenis in ('so', 'waste', 'produksi', 'masuk'));

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
  v_area text := nullif(p_event->>'area', '');
  v_sumber text := nullif(p_event->>'sumber', '');
begin
  if v_role is null then
    raise exception 'bukan anggota bisnis ini';
  end if;
  if v_jenis not in ('so', 'waste', 'produksi', 'masuk') then
    raise exception 'jenis tidak dikenal: %', v_jenis;
  end if;
  if v_lokasi not in ('GDG', 'KBU', 'KSM', 'SMT') then
    raise exception 'lokasi tidak dikenal: %', v_lokasi;
  end if;
  if v_role in ('kasir', 'dapur') and v_lokasi <> upper(coalesce(v_outlet, '')) then
    raise exception '% hanya boleh input untuk outlet %', v_role, coalesce(v_outlet, '-');
  end if;
  if coalesce(v_ref, '') = '' then
    raise exception 'client_ref wajib';
  end if;
  if v_area is not null and v_area not in ('dapur', 'bar') then
    raise exception 'area tidak dikenal: %', v_area;
  end if;
  if v_jenis = 'masuk' and coalesce(v_sumber, '') not in ('pembelian', 'retur', 'koreksi', 'lainnya') then
    raise exception 'sumber barang masuk wajib (pembelian/retur/koreksi/lainnya)';
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

  insert into public.inv_events (business_id, client_ref, jenis, lokasi, tanggal, shift, recipe_id, catatan, created_by_name, foto, area, sumber)
  values (
    p_business, v_ref, v_jenis, v_lokasi,
    coalesce((p_event->>'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date),
    nullif(p_event->>'shift', ''),
    nullif(p_event->>'recipe_id', '')::uuid,
    nullif(p_event->>'catatan', ''),
    nullif(p_event->>'created_by_name', ''),
    v_foto,
    v_area,
    case when v_jenis = 'masuk' then v_sumber end
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
      when 'masuk' then 'masuk'
      else coalesce(v_line->>'arah', 'keluar') end;
    if v_jenis = 'produksi' and v_arah not in ('keluar', 'masuk') then
      raise exception 'arah produksi harus keluar/masuk';
    end if;
    if v_jenis in ('waste', 'masuk') and v_qty = 0 then
      continue;
    end if;
    v_satuan := coalesce(nullif(v_line->>'satuan', ''), v_item.satuan);
    v_harga := case when lower(v_satuan) = lower(v_item.satuan) then v_item.harga else 0 end;

    if v_jenis = 'produksi' and v_arah = 'masuk' then
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

-- Pergerakan stok (satuan master). Baris SO/waste yang satuannya belum terkonversi dilewati.
-- tipe: so | waste | masuk | prod_in | prod_out | trf_in | trf_out
create or replace function public.inv_stock_movements(p_business uuid, p_from date, p_to date)
returns table (tanggal date, lokasi text, item_id uuid, tipe text, qty numeric, area text, oleh text, created_at timestamptz, ref_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select e.tanggal, e.lokasi, l.item_id,
    case e.jenis when 'so' then 'so' when 'waste' then 'waste' when 'masuk' then 'masuk'
      else case l.arah when 'masuk' then 'prod_in' else 'prod_out' end end,
    l.qty, e.area, e.created_by_name, e.created_at, e.id
  from public.inv_event_lines l
  join public.inv_events e on e.id = l.event_id
  join public.inv_items i on i.id = l.item_id
  where e.business_id = p_business and e.tanggal between p_from and p_to
    and lower(coalesce(l.satuan, i.satuan)) = lower(i.satuan)
  union all
  select (t.dikirim_at at time zone 'Asia/Jakarta')::date, t.dari, l.item_id, 'trf_out',
    l.qty_kirim * l.isi, null, t.dikirim_by_name, t.dikirim_at, t.id
  from public.inv_transfer_lines l join public.inv_transfers t on t.id = l.transfer_id
  where t.business_id = p_business and t.status in ('dikirim', 'diterima') and l.isi is not null and l.qty_kirim > 0
    and (t.dikirim_at at time zone 'Asia/Jakarta')::date between p_from and p_to
  union all
  select (t.diterima_at at time zone 'Asia/Jakarta')::date, t.ke, l.item_id, 'trf_in',
    l.qty_terima * l.isi, null, t.diterima_by_name, t.diterima_at, t.id
  from public.inv_transfer_lines l join public.inv_transfers t on t.id = l.transfer_id
  where t.business_id = p_business and t.status = 'diterima' and l.isi is not null and l.qty_terima > 0
    and (t.diterima_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
$$;

revoke all on function public.inv_stock_movements(uuid, date, date) from public, anon;
grant execute on function public.inv_stock_movements(uuid, date, date) to authenticated;

commit;
