-- ============================================================
-- NF3 Dapur — permintaan & kiriman stok dipisah per bagian (dapur / bar)
-- * inv_transfers.area: 'dapur' | 'bar' | null (tanpa bagian, mis. Samtaro atau kiriman umum)
-- * inv_transfer_save: simpan area; akun dapur selalu 'dapur', kasir 'bar' atau tanpa bagian;
--   penerimaan ditolak bila bagian tidak cocok. Owner/admin/purchasing bebas.
-- Data lama (area null) tetap terlihat oleh kedua bagian di outlet itu.
-- ============================================================

begin;

alter table public.inv_transfers add column if not exists area text check (area is null or area in ('dapur', 'bar'));

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
  v_area text := nullif(p_transfer->>'area', '');
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
    if v_area is not null and v_area not in ('dapur', 'bar') then
      raise exception 'bagian tidak dikenal: %', v_area;
    end if;
    -- Akun outlet hanya untuk bagiannya: dapur → dapur, kasir → bar (atau tanpa bagian, mis. Samtaro).
    if v_role = 'dapur' then
      v_area := 'dapur';
    elsif v_role = 'kasir' and v_area is distinct from 'bar' then
      v_area := null;
    end if;
    if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'minimal satu barang';
    end if;

    insert into public.inv_transfers (business_id, client_ref, dari, ke, status, tanggal, catatan, foto,
      diminta_by, diminta_by_name, diminta_at, dikirim_by, dikirim_by_name, dikirim_at, area)
    values (
      p_business, v_ref,
      upper(coalesce(nullif(p_transfer->>'dari', ''), 'GDG')),
      upper(coalesce(p_transfer->>'ke', '')),
      case when p_action = 'minta' then 'diminta' else 'dikirim' end,
      coalesce((p_transfer->>'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date),
      nullif(p_transfer->>'catatan', ''), v_foto,
      case when p_action = 'minta' then auth.uid() end, case when p_action = 'minta' then v_name end, case when p_action = 'minta' then now() end,
      case when p_action = 'kirim' then auth.uid() end, case when p_action = 'kirim' then v_name end, case when p_action = 'kirim' then now() end,
      v_area
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
    if v_role = 'dapur' and v_t.area = 'bar' then
      raise exception 'kiriman ini untuk bagian bar';
    end if;
    if v_role = 'kasir' and v_t.area = 'dapur' then
      raise exception 'kiriman ini untuk bagian dapur';
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


commit;
