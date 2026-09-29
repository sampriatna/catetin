-- ============================================================
-- NF3 Dapur — harga beli aktual tersimpan atomik bersama barang masuk.
--
-- Sebelumnya Belanja → Stok membuat event memakai harga master lama, lalu
-- memperbarui inv_items satu per satu dari browser. Akibatnya nilai event
-- pembelian bisa salah dan proses lebih lambat/parsial bila koneksi putus.
--
-- Sekarang baris pembelian boleh membawa:
--   unit_cost        = harga beli aktual per satuan master
--   update_item_cost = perbarui modal operasional inv_items.harga
-- Harga event selalu menyimpan unit_cost aktual. Modal master hanya boleh
-- diubah owner/admin/purchasing dan pembelian lama tidak menimpa harga baru.
-- Tidak ada perubahan form atau langkah kerja staf outlet.
-- ============================================================

begin;

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
  v_line_cost numeric;
  v_update_cost boolean;
  v_total numeric := 0;
  v_out_item uuid;
  v_out_qty numeric;
  v_unit_cost numeric;
  v_masuk_count int := 0;
  v_foto text[];
  v_area text := nullif(p_event->>'area', '');
  v_sumber text := nullif(p_event->>'sumber', '');
  v_replaces uuid := nullif(p_event->>'replaces', '')::uuid;
  v_old public.inv_events;
  v_tanggal date := coalesce((p_event->>'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date);
  v_costs_updated int := 0;
  v_costs_skipped_old int := 0;
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
    return jsonb_build_object('id', v_existing, 'duplicate', true, 'costs_updated', 0, 'costs_skipped_old', 0);
  end if;

  -- Ubah SO: pertahankan perilaku migrasi sebelumnya.
  if v_replaces is not null then
    if v_jenis <> 'so' then
      raise exception 'hanya SO yang bisa diubah';
    end if;
    select * into v_old from public.inv_events where id = v_replaces and business_id = p_business for update;
    if not found then
      raise exception 'SO lama tidak ditemukan (mungkin sudah diubah)';
    end if;
    if v_old.jenis <> 'so' or v_old.lokasi <> v_lokasi or v_old.area is distinct from v_area then
      raise exception 'SO lama beda lokasi/bagian';
    end if;
    if v_role not in ('owner', 'admin', 'purchasing') and v_old.created_at < now() - interval '24 hours' then
      raise exception 'SO lebih dari 24 jam hanya bisa diubah owner/admin';
    end if;
    delete from public.inv_events where id = v_replaces;
  end if;

  select coalesce(array_agg(x), '{}') into v_foto
  from jsonb_array_elements_text(coalesce(p_event->'foto', '[]'::jsonb)) as x
  where x like p_business::text || '/%';

  insert into public.inv_events (business_id, client_ref, jenis, lokasi, tanggal, shift, recipe_id, catatan, created_by_name, foto, area, sumber)
  values (
    p_business, v_ref, v_jenis, v_lokasi, v_tanggal,
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
    v_line_cost := nullif(v_line->>'unit_cost', '')::numeric;
    v_update_cost := coalesce(nullif(v_line->>'update_item_cost', '')::boolean, false);

    if v_line_cost is not null and v_line_cost <= 0 then
      raise exception 'harga beli harus lebih dari 0 (%)', v_item.nama;
    end if;
    if (v_line_cost is not null or v_update_cost)
       and not (v_jenis = 'masuk' and v_sumber = 'pembelian' and v_role in ('owner', 'admin', 'purchasing')) then
      raise exception 'harga beli hanya boleh diisi owner/admin/purchasing untuk pembelian';
    end if;

    -- Pembelian menyimpan harga aktual; event lain tetap memakai modal master saat kejadian.
    v_harga := case
      when v_jenis = 'masuk' and v_sumber = 'pembelian' and v_line_cost is not null then v_line_cost
      when lower(v_satuan) = lower(v_item.satuan) then v_item.harga
      else 0 end;

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

    if v_jenis = 'masuk' and v_sumber = 'pembelian' and v_update_cost and v_line_cost is not null
       and abs(v_line_cost - coalesce(v_item.harga, 0)) > 0.0001 then
      -- Belanja lama tetap bernilai sesuai nota, tetapi tidak boleh menimpa modal yang sudah lebih baru.
      if v_tanggal < (v_item.updated_at at time zone 'Asia/Jakarta')::date then
        v_costs_skipped_old := v_costs_skipped_old + 1;
      else
        update public.inv_items
        set harga = v_line_cost, updated_at = now()
        where id = v_item.id;
        v_costs_updated := v_costs_updated + 1;
      end if;
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

  return jsonb_build_object(
    'id', v_event,
    'duplicate', false,
    'total_nilai', v_total,
    'unit_cost', v_unit_cost,
    'costs_updated', v_costs_updated,
    'costs_skipped_old', v_costs_skipped_old
  );
end;
$$;

revoke all on function public.inv_submit_event(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.inv_submit_event(uuid, jsonb, jsonb) to authenticated;

commit;
