-- ============================================================
-- NF3 Dapur — akun Dapur per outlet, area SO (dapur / bar), dan riwayat nilai stok.
-- Struktur akun Nusa Food:
--   kasir KBU  = kasir + bar KBU        dapur KBU = dapur KBU
--   kasir KSM  = kasir + minuman KSM    dapur KSM = dapur KSM
--   kasir SMT  = semua di Samtaro       purchasing = gudang (produksi & kirim stok)
-- Role 'dapur' hanya untuk modul Dapur (SO, waste, produksi, permintaan/terima stok) di outletnya.
-- ============================================================

begin;

alter table public.business_members drop constraint if exists business_members_role_check;
alter table public.business_members add constraint business_members_role_check
  check (role in ('owner', 'admin', 'kasir', 'purchasing', 'dapur'));

alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check
  check (role in ('admin', 'kasir', 'purchasing', 'dapur'));

-- Area baris daftar SO: 'dapur' | 'bar' | null (semua akun outlet itu).
alter table public.inv_so_template add column if not exists area text
  check (area is null or area in ('dapur', 'bar'));

-- Kasir & dapur terkunci di outletnya.
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
  if v_role in ('kasir', 'dapur') and v_lokasi <> upper(coalesce(v_outlet, '')) then
    raise exception '% hanya boleh input untuk outlet %', v_role, coalesce(v_outlet, '-');
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

create or replace function public.inv_transfer_save(p_business uuid, p_action text, p_transfer jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.business_role(p_business);
  v_outlet text := upper(coalesce(public.business_outlet(p_business), ''));
  v_manager boolean;
  v_id uuid := nullif(p_transfer->>'id', '')::uuid;
  v_ref text := nullif(p_transfer->>'client_ref', '');
  v_name text := nullif(p_transfer->>'by_name', '');
  v_t public.inv_transfers;
  v_line jsonb;
  v_item public.inv_items;
  v_qty numeric;
  v_isi numeric;
  v_satuan text;
  v_line_id uuid;
  v_foto text[];
  v_total numeric;
  v_n int := 0;
begin
  if v_role is null then
    raise exception 'bukan anggota bisnis ini';
  end if;
  v_manager := v_role in ('owner', 'admin', 'purchasing');
  if p_action not in ('minta', 'kirim', 'terima', 'batal') then
    raise exception 'aksi tidak dikenal: %', p_action;
  end if;

  select coalesce(array_agg(x), '{}') into v_foto
  from jsonb_array_elements_text(coalesce(p_transfer->'foto', '[]'::jsonb)) as x
  where x like p_business::text || '/%';

  -- ── Buat baru: permintaan outlet, atau kirim langsung dari gudang ──
  if v_id is null then
    if p_action not in ('minta', 'kirim') then
      raise exception 'id wajib untuk aksi %', p_action;
    end if;
    if v_ref is null then
      raise exception 'client_ref wajib';
    end if;
    select * into v_t from public.inv_transfers where business_id = p_business and client_ref = v_ref;
    if found then
      return jsonb_build_object('id', v_t.id, 'duplicate', true, 'status', v_t.status, 'total_nilai', v_t.total_nilai);
    end if;
    if p_action = 'kirim' and not v_manager then
      raise exception 'hanya owner/admin/purchasing yang bisa kirim langsung';
    end if;
    if p_action = 'minta' and v_role in ('kasir', 'dapur') and upper(coalesce(p_transfer->>'ke', '')) <> v_outlet then
      raise exception '% hanya boleh meminta untuk outlet %', v_role, nullif(v_outlet, '');
    end if;
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'minimal satu barang';
    end if;

    insert into public.inv_transfers (business_id, client_ref, dari, ke, status, tanggal, catatan, foto,
      diminta_by, diminta_by_name, diminta_at, dikirim_by, dikirim_by_name, dikirim_at)
    values (
      p_business, v_ref,
      upper(coalesce(nullif(p_transfer->>'dari', ''), 'GDG')),
      upper(coalesce(p_transfer->>'ke', '')),
      case when p_action = 'minta' then 'diminta' else 'dikirim' end,
      coalesce((p_transfer->>'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date),
      nullif(p_transfer->>'catatan', ''), v_foto,
      case when p_action = 'minta' then auth.uid() end, case when p_action = 'minta' then v_name end, case when p_action = 'minta' then now() end,
      case when p_action = 'kirim' then auth.uid() end, case when p_action = 'kirim' then v_name end, case when p_action = 'kirim' then now() end
    )
    returning * into v_t;
  else
    select * into v_t from public.inv_transfers where id = v_id and business_id = p_business for update;
    if not found then
      raise exception 'permintaan tidak ditemukan';
    end if;
    -- Kirim ulang aksi yang sama (tombol ditekan dua kali) → kembalikan hasil lama.
    if (p_action = 'kirim' and v_t.status in ('dikirim', 'diterima'))
       or (p_action = 'terima' and v_t.status = 'diterima')
       or (p_action = 'batal' and v_t.status = 'batal') then
      return jsonb_build_object('id', v_t.id, 'duplicate', true, 'status', v_t.status, 'total_nilai', v_t.total_nilai);
    end if;
  end if;

  -- ── Batal: hanya permintaan yang belum dikirim ──
  if p_action = 'batal' then
    if v_t.status <> 'diminta' then
      raise exception 'hanya permintaan yang belum dikirim yang bisa dibatalkan';
    end if;
    if not v_manager and v_t.diminta_by is distinct from auth.uid() then
      raise exception 'hanya peminta atau owner/admin/purchasing yang bisa membatalkan';
    end if;
    update public.inv_transfers set status = 'batal', catatan = coalesce(nullif(p_transfer->>'catatan', ''), catatan) where id = v_t.id;
    return jsonb_build_object('id', v_t.id, 'duplicate', false, 'status', 'batal');
  end if;

  -- ── Minta / kirim baru: tulis baris ──
  if v_id is null then
    for v_line in select * from jsonb_array_elements(p_lines) loop
      select * into v_item from public.inv_items where id = (v_line->>'item_id')::uuid and business_id = p_business;
      if not found then
        raise exception 'barang tidak ditemukan: %', v_line->>'item_id';
      end if;
      v_qty := coalesce((v_line->>'qty')::numeric, 0);
      if v_qty < 0 then
        raise exception 'qty tidak boleh minus (%)', v_item.nama;
      end if;
      continue when v_qty = 0;
      v_satuan := coalesce(nullif(v_line->>'satuan', ''), v_item.satuan);
      v_isi := case when lower(v_satuan) = lower(v_item.satuan) then 1 else nullif(v_line->>'isi', '')::numeric end;
      v_n := v_n + 1;
      insert into public.inv_transfer_lines (transfer_id, business_id, item_id, label, satuan, isi, qty_minta, qty_kirim, harga, urut)
      values (v_t.id, p_business, v_item.id, nullif(v_line->>'label', ''), v_satuan, v_isi,
        case when p_action = 'minta' then v_qty end,
        case when p_action = 'kirim' then v_qty end,
        v_item.harga, v_n);
    end loop;
    if v_n = 0 then
      raise exception 'minimal satu barang dengan jumlah > 0';
    end if;

  -- ── Kirim atas permintaan: isi qty aktual, boleh tambah barang ──
  elsif p_action = 'kirim' then
    if not v_manager then
      raise exception 'hanya owner/admin/purchasing yang bisa mengirim';
    end if;
    if v_t.status <> 'diminta' then
      raise exception 'status % tidak bisa dikirim', v_t.status;
    end if;
    update public.inv_transfer_lines set qty_kirim = 0 where transfer_id = v_t.id;
    for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
      v_qty := coalesce((v_line->>'qty')::numeric, 0);
      if v_qty < 0 then
        raise exception 'qty tidak boleh minus';
      end if;
      v_line_id := nullif(v_line->>'line_id', '')::uuid;
      if v_line_id is not null then
        update public.inv_transfer_lines l set qty_kirim = v_qty,
          harga = (select i.harga from public.inv_items i where i.id = l.item_id)
        where l.id = v_line_id and l.transfer_id = v_t.id;
        if not found then
          raise exception 'baris tidak ditemukan';
        end if;
      elsif v_qty > 0 then
        select * into v_item from public.inv_items where id = (v_line->>'item_id')::uuid and business_id = p_business;
        if not found then
          raise exception 'barang tidak ditemukan: %', v_line->>'item_id';
        end if;
        v_satuan := coalesce(nullif(v_line->>'satuan', ''), v_item.satuan);
        v_isi := case when lower(v_satuan) = lower(v_item.satuan) then 1 else nullif(v_line->>'isi', '')::numeric end;
        insert into public.inv_transfer_lines (transfer_id, business_id, item_id, label, satuan, isi, qty_kirim, harga, urut)
        values (v_t.id, p_business, v_item.id, nullif(v_line->>'label', ''), v_satuan, v_isi, v_qty, v_item.harga,
          (select coalesce(max(urut), 0) + 1 from public.inv_transfer_lines where transfer_id = v_t.id));
      end if;
    end loop;
    if not exists (select 1 from public.inv_transfer_lines where transfer_id = v_t.id and qty_kirim > 0) then
      raise exception 'tidak ada barang yang dikirim (semua 0) — batalkan saja permintaannya';
    end if;
    update public.inv_transfers set status = 'dikirim', dikirim_by = auth.uid(), dikirim_by_name = v_name, dikirim_at = now(),
      catatan = coalesce(nullif(p_transfer->>'catatan', ''), catatan), foto = foto || v_foto
    where id = v_t.id;

  -- ── Terima: outlet tujuan cek qty yang datang ──
  elsif p_action = 'terima' then
    if v_t.status <> 'dikirim' then
      raise exception 'status % tidak bisa diterima', v_t.status;
    end if;
    if not v_manager and v_t.ke <> v_outlet then
      raise exception 'hanya outlet % yang bisa menerima', v_t.ke;
    end if;
    update public.inv_transfer_lines set qty_terima = qty_kirim where transfer_id = v_t.id;
    for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
      v_qty := (v_line->>'qty')::numeric;
      if v_qty is null or v_qty < 0 then
        raise exception 'qty terima tidak valid';
      end if;
      update public.inv_transfer_lines set qty_terima = v_qty
      where id = nullif(v_line->>'line_id', '')::uuid and transfer_id = v_t.id;
    end loop;
    update public.inv_transfers set status = 'diterima', diterima_by = auth.uid(), diterima_by_name = v_name, diterima_at = now(),
      catatan = case when nullif(p_transfer->>'catatan', '') is null then catatan
                     else concat_ws(E'\n', catatan, 'Terima: ' || (p_transfer->>'catatan')) end,
      foto = foto || v_foto
    where id = v_t.id;
  end if;

  -- Nilai = qty (kirim, lalu terima bila sudah) × isi × modal. Tanpa konversi → 0.
  update public.inv_transfer_lines l
    set nilai = round(coalesce(l.qty_terima, l.qty_kirim, l.qty_minta, 0) * coalesce(l.isi, 0) * l.harga, 2)
  where l.transfer_id = v_t.id;
  select coalesce(sum(nilai), 0) into v_total from public.inv_transfer_lines where transfer_id = v_t.id;
  update public.inv_transfers set total_nilai = v_total where id = v_t.id returning * into v_t;

  return jsonb_build_object('id', v_t.id, 'duplicate', false, 'status', v_t.status, 'total_nilai', v_t.total_nilai);
end;
$$;

revoke all on function public.inv_transfer_save(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.inv_transfer_save(uuid, text, jsonb, jsonb) to authenticated;

-- Nilai stok per lokasi per hari (SO terakhir sampai hari itu × modal saat ini).
-- Modal saat ini dipakai untuk semua hari supaya naik/turun mencerminkan jumlah barang, bukan perubahan harga.
create or replace function public.inv_stock_value_series(p_business uuid, p_days int default 14)
returns table (tanggal date, lokasi text, nilai numeric, jml_item int)
language sql
stable
security invoker
set search_path = public
as $$
  with days as (
    select d::date as d
    from generate_series(
      (now() at time zone 'Asia/Jakarta')::date - (greatest(1, least(p_days, 90)) - 1),
      (now() at time zone 'Asia/Jakarta')::date,
      interval '1 day') as g(d)
  ),
  so as (
    select e.lokasi, l.item_id, e.tanggal, e.created_at, l.qty, coalesce(l.satuan, i.satuan) as satuan, i.satuan as satuan_master, i.harga
    from public.inv_event_lines l
    join public.inv_events e on e.id = l.event_id
    join public.inv_items i on i.id = l.item_id
    where e.business_id = p_business and e.jenis = 'so'
  )
  select days.d, s.lokasi,
    round(sum(case when lower(s.satuan) = lower(s.satuan_master) then s.qty * s.harga else 0 end), 2),
    count(*)::int
  from days
  cross join lateral (
    select distinct on (so.lokasi, so.item_id) so.*
    from so
    where so.tanggal <= days.d
    order by so.lokasi, so.item_id, so.tanggal desc, so.created_at desc
  ) s
  group by days.d, s.lokasi
  order by days.d, s.lokasi;
$$;

revoke all on function public.inv_stock_value_series(uuid, int) from public, anon;
grant execute on function public.inv_stock_value_series(uuid, int) to authenticated;

commit;
