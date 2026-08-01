-- ============================================================================
-- DRAFT 07 — Domain RPCs (satu-satunya jalan posting ledger)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–06
--
-- Grant HANYA fungsi domain di bawah ke authenticated.
-- post_stock_movement / reverse generik TIDAK ada sebagai RPC publik.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  if to_regclass('public.stock_transfers') is null then
    raise exception 'Preflight: stock_transfers belum ada';
  end if;
END $$;

-- Helper sesi acting assignment
create or replace function public._require_assignment(
  p_business_id uuid,
  p_assignment_id uuid,
  p_permission text,
  p_location_id uuid
)
returns public.member_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.member_assignments;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select a.* into v_a
  from public.member_assignments a
  join public.business_members m on m.id = a.business_member_id
  where a.id = p_assignment_id
    and a.business_id = p_business_id
    and a.active
    and m.user_id = v_uid
    and m.active;

  if not found then
    -- Owner boleh tanpa assignment untuk beberapa aksi
    if public.business_role(p_business_id) = 'owner' then
      return null;
    end if;
    raise exception 'assignment tidak valid untuk user ini';
  end if;

  if p_permission is not null
     and not (p_permission = any (v_a.permissions))
     and public.business_role(p_business_id) <> 'owner' then
    raise exception 'permission % tidak ada pada assignment', p_permission;
  end if;

  if p_location_id is not null
     and v_a.location_id is not null
     and v_a.location_id is distinct from p_location_id
     and v_a.role <> 'forecasting_inventory' then
    raise exception 'assignment tidak mencakup lokasi ini';
  end if;

  return v_a;
end;
$$;

revoke all on function public._require_assignment(uuid, uuid, text, uuid)
  from public, anon, authenticated;

-- ============================================================================
-- send_stock_transfer
-- Satu movement per item: from=sumber → to=IN_TRANSIT, type=transfer_out
-- ============================================================================
create or replace function public.send_stock_transfer(
  p_transfer_id uuid,
  p_assignment_id uuid
)
returns public.stock_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.stock_transfers;
  v_a public.member_assignments;
  v_transit uuid;
  v_group uuid := gen_random_uuid();
  r record;
  v_avg numeric(18,4);
  v_mid uuid;
begin
  select * into v_t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer tidak ditemukan'; end if;
  if v_t.status <> 'draft' then raise exception 'hanya draft yang bisa dikirim'; end if;

  v_a := public._require_assignment(
    v_t.business_id, p_assignment_id, 'create_transfer', v_t.from_location_id
  );

  if public.has_assignment_role(v_t.business_id, array['forecasting_inventory']::text[]) is not true
     and public.business_role(v_t.business_id) <> 'owner' then
    raise exception 'hanya forecasting/owner yang boleh kirim transfer';
  end if;

  v_transit := public.inventory_in_transit_location_id(v_t.business_id);
  if v_transit is null then raise exception 'lokasi IN_TRANSIT belum ada'; end if;

  perform set_config('inventory.transfer_rpc', '1', true);

  for r in
    select * from public.stock_transfer_lines
    where transfer_id = v_t.id
    for update
  loop
    select average_cost into v_avg
    from public.stock_balances
    where item_id = r.item_id and location_id = v_t.from_location_id;

    if v_avg is null then
      raise exception 'average_cost sumber belum ada untuk item %', r.item_id;
    end if;

    update public.stock_transfer_lines
    set unit_cost = v_avg
    where id = r.id;

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, reference_id, status,
      created_by, assignment_id, acting_role, acting_location_id
    ) values (
      v_t.business_id, v_group, 'transfer_out', r.item_id, r.lot_id,
      v_t.from_location_id, v_transit, r.sent_qty, v_avg,
      'stock_transfer', v_t.id, 'draft',
      auth.uid(), p_assignment_id,
      coalesce(v_a.role, 'owner'), v_t.from_location_id
    ) returning id into v_mid;

    perform public._post_stock_movement_internal(v_mid);
  end loop;

  update public.stock_transfers
  set status = 'sent',
      sent_by = auth.uid(),
      sent_at = now()
  where id = v_t.id
  returning * into v_t;

  perform set_config('inventory.transfer_rpc', '', true);
  return v_t;
exception when others then
  perform set_config('inventory.transfer_rpc', '', true);
  raise;
end;
$$;

-- ============================================================================
-- receive_stock_transfer — partial via stock_transfer_receipts
-- Payload lines: [{transfer_line_id, received_qty, variance_reason, photo_url}]
-- Satu movement per item: from=IN_TRANSIT → to=outlet, type=transfer_in
-- Forecasting DILARANG receive atas nama outlet
-- ============================================================================
create or replace function public.receive_stock_transfer(
  p_transfer_id uuid,
  p_assignment_id uuid,
  p_lines jsonb,
  p_notes text default null,
  p_photo_url text default null
)
returns public.stock_transfer_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.stock_transfers;
  v_a public.member_assignments;
  v_transit uuid;
  v_group uuid := gen_random_uuid();
  v_receipt public.stock_transfer_receipts;
  elem jsonb;
  v_line public.stock_transfer_lines;
  v_qty numeric(18,6);
  v_remain numeric(18,6);
  v_mid uuid;
  v_all_done boolean;
begin
  select * into v_t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer tidak ditemukan'; end if;
  if v_t.status not in ('sent', 'partially_received', 'variance_pending') then
    raise exception 'transfer tidak dalam status bisa diterima';
  end if;

  -- Forecasting tidak boleh receive outlet
  if public.has_assignment_role(v_t.business_id, array['forecasting_inventory']::text[])
     and public.business_role(v_t.business_id) <> 'owner' then
    -- Jika user HANYA forecasting (tanpa receive_stock di outlet), tolak
    null;
  end if;

  v_a := public._require_assignment(
    v_t.business_id, p_assignment_id, 'receive_stock', v_t.to_location_id
  );

  if v_a.role = 'forecasting_inventory' then
    raise exception 'forecasting tidak boleh menekan Diterima atas nama outlet';
  end if;

  if not public.has_permission(v_t.business_id, 'receive_stock', v_t.to_location_id)
     and public.business_role(v_t.business_id) <> 'owner' then
    raise exception 'butuh permission receive_stock di outlet tujuan';
  end if;

  v_transit := public.inventory_in_transit_location_id(v_t.business_id);

  insert into public.stock_transfer_receipts (
    business_id, transfer_id, received_by, received_assignment_id,
    acting_role, notes, photo_url, movement_group_id
  ) values (
    v_t.business_id, v_t.id, auth.uid(), p_assignment_id,
    coalesce(v_a.role, 'owner'), p_notes, p_photo_url, v_group
  ) returning * into v_receipt;

  perform set_config('inventory.transfer_rpc', '1', true);

  for elem in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    select * into v_line
    from public.stock_transfer_lines
    where id = (elem->>'transfer_line_id')::uuid
      and transfer_id = v_t.id
    for update;

    if not found then raise exception 'transfer line tidak valid'; end if;

    v_qty := (elem->>'received_qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'received_qty tidak valid'; end if;

    v_remain := v_line.sent_qty - v_line.received_qty_total;
    if v_qty > v_remain then
      raise exception 'received_qty melebihi sisa (line %)', v_line.id;
    end if;

    if v_qty < v_remain and coalesce(elem->>'variance_reason', '') = '' and v_qty <> v_remain then
      -- partial tanpa menutup sisa: variance_reason opsional sampai final short
      null;
    end if;

    insert into public.stock_transfer_receipt_lines (
      business_id, receipt_id, transfer_line_id, received_qty, variance_reason, photo_url
    ) values (
      v_t.business_id, v_receipt.id, v_line.id, v_qty,
      elem->>'variance_reason', elem->>'photo_url'
    );

    update public.stock_transfer_lines
    set received_qty_total = received_qty_total + v_qty
    where id = v_line.id;

    if v_qty > 0 then
      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_t.business_id, v_group, 'transfer_in', v_line.item_id, v_line.lot_id,
        v_transit, v_t.to_location_id, v_qty, v_line.unit_cost,
        'stock_transfer_receipt', v_receipt.id, 'draft',
        auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), v_t.to_location_id
      ) returning id into v_mid;

      perform public._post_stock_movement_internal(v_mid);
    end if;
  end loop;

  select bool_and(received_qty_total >= sent_qty) into v_all_done
  from public.stock_transfer_lines where transfer_id = v_t.id;

  update public.stock_transfers
  set status = case
    when v_all_done then 'received'
    else 'partially_received'
  end
  where id = v_t.id;

  perform set_config('inventory.transfer_rpc', '', true);
  return v_receipt;
exception when others then
  perform set_config('inventory.transfer_rpc', '', true);
  raise;
end;
$$;

-- ============================================================================
-- finalize_inventory_receipt — cost lengkap → post purchase_receive
-- ============================================================================
create or replace function public.finalize_inventory_receipt(
  p_receipt_id uuid,
  p_assignment_id uuid
)
returns public.inventory_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.inventory_receipts;
  v_a public.member_assignments;
  v_group uuid := gen_random_uuid();
  line record;
  v_lot uuid;
  v_mid uuid;
begin
  select * into v_r from public.inventory_receipts where id = p_receipt_id for update;
  if not found then raise exception 'receipt tidak ditemukan'; end if;
  if v_r.status not in ('draft', 'cost_pending', 'ready_to_post') then
    raise exception 'status receipt tidak bisa difinalkan';
  end if;

  v_a := public._require_assignment(
    v_r.business_id, p_assignment_id, 'receive_to_warehouse', v_r.location_id
  );

  if exists (
    select 1 from public.inventory_receipt_lines
    where receipt_id = v_r.id and unit_cost is null
  ) then
    update public.inventory_receipts set status = 'cost_pending' where id = v_r.id;
    raise exception 'masih ada line tanpa unit_cost (cost_pending); belum boleh post stok';
  end if;

  for line in
    select * from public.inventory_receipt_lines where receipt_id = v_r.id
  loop
    v_lot := line.lot_id;
    if v_lot is null and (line.batch_number is not null or line.expiry_date is not null or line.expiry_unknown) then
      insert into public.inventory_lots (
        business_id, item_id, batch_number, expiry_date, expiry_unknown,
        received_at, source_type, source_id, initial_unit_cost
      ) values (
        v_r.business_id, line.item_id, line.batch_number, line.expiry_date, line.expiry_unknown,
        now(), 'inventory_receipt', v_r.id, line.unit_cost
      ) returning id into v_lot;

      update public.inventory_receipt_lines set lot_id = v_lot where id = line.id;
    end if;

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, reference_id, status,
      created_by, assignment_id, acting_role, acting_location_id
    ) values (
      v_r.business_id, v_group, 'purchase_receive', line.item_id, v_lot,
      null, v_r.location_id, line.quantity, line.unit_cost,
      'inventory_receipt', v_r.id, 'draft',
      auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), v_r.location_id
    ) returning id into v_mid;

    perform public._post_stock_movement_internal(v_mid);
  end loop;

  update public.inventory_receipts
  set status = 'posted', posted_at = now()
  where id = v_r.id
  returning * into v_r;

  return v_r;
end;
$$;

-- ============================================================================
-- submit_stock_opname — hitung system/diff/approval server-side
-- ============================================================================
create or replace function public.submit_stock_opname(
  p_opname_id uuid,
  p_assignment_id uuid
)
returns public.stock_opnames
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.stock_opnames;
  v_a public.member_assignments;
  v_pct numeric(8,4);
  v_limit bigint;
  v_avg numeric(18,4);
  v_sys numeric(18,6);
  v_diff numeric(18,6);
  v_val numeric(18,4);
  v_req boolean;
  v_any_req boolean := false;
  line record;
begin
  select * into v_o from public.stock_opnames where id = p_opname_id for update;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status <> 'draft' then raise exception 'hanya draft yang bisa disubmit'; end if;

  v_a := public._require_assignment(
    v_o.business_id, p_assignment_id, 'opname_stock', v_o.location_id
  );

  select opname_variance_pct, opname_variance_value_idr
    into v_pct, v_limit
  from public.inventory_settings where business_id = v_o.business_id;
  v_pct := coalesce(v_pct, 5);
  v_limit := coalesce(v_limit, 100000);

  perform set_config('inventory.opname_rpc', '1', true);

  for line in
    select * from public.stock_opname_lines where opname_id = v_o.id for update
  loop
    if line.lot_id is not null then
      select quantity into v_sys from public.stock_lot_balances
      where lot_id = line.lot_id and location_id = v_o.location_id;
    else
      select quantity into v_sys from public.stock_balances
      where item_id = line.item_id and location_id = v_o.location_id;
    end if;
    v_sys := coalesce(v_sys, 0);
    v_diff := line.physical_qty - v_sys;

    select average_cost into v_avg from public.stock_balances
    where item_id = line.item_id and location_id = v_o.location_id;
    v_val := abs(v_diff) * coalesce(v_avg, 0);

    v_req := (
      (abs(v_diff) / greatest(abs(v_sys), 0.000001) * 100) >= v_pct
    ) or (v_val >= v_limit);

    if v_req then v_any_req := true; end if;

    update public.stock_opname_lines
    set system_qty = v_sys,
        difference_qty = v_diff,
        difference_value = v_val,
        requires_approval = v_req
    where id = line.id;
  end loop;

  update public.stock_opnames
  set status = 'submitted',
      submitted_by = auth.uid(),
      assignment_id = p_assignment_id,
      acting_role = coalesce(v_a.role, 'owner'),
      requires_approval = v_any_req
  where id = v_o.id
  returning * into v_o;

  perform set_config('inventory.opname_rpc', '', true);
  return v_o;
exception when others then
  perform set_config('inventory.opname_rpc', '', true);
  raise;
end;
$$;

-- ============================================================================
-- approve_stock_opname
-- ============================================================================
create or replace function public.approve_stock_opname(
  p_opname_id uuid,
  p_assignment_id uuid
)
returns public.stock_opnames
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.stock_opnames;
  v_a public.member_assignments;
  v_loc public.inventory_locations;
  v_group uuid := gen_random_uuid();
  line record;
  v_mid uuid;
  v_avg numeric(18,4);
  v_qty numeric(18,6);
begin
  select * into v_o from public.stock_opnames where id = p_opname_id for update;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status <> 'submitted' then raise exception 'opname belum submitted'; end if;

  select * into v_loc from public.inventory_locations where id = v_o.location_id;

  v_a := public._require_assignment(
    v_o.business_id, p_assignment_id, 'approve_opname_variance', v_o.location_id
  );

  if v_o.submitted_by = auth.uid() then
    raise exception 'tidak boleh approve opname sendiri';
  end if;

  if v_loc.type = 'warehouse'
     and v_o.acting_role = 'forecasting_inventory'
     and public.business_role(v_o.business_id) <> 'owner' then
    raise exception 'warehouse opname forecasting wajib diapprove Owner';
  end if;

  if public.business_role(v_o.business_id) <> 'owner'
     and not public.has_permission(v_o.business_id, 'approve_opname_variance', v_o.location_id) then
    raise exception 'tidak punya approve_opname_variance';
  end if;

  perform set_config('inventory.opname_rpc', '1', true);

  for line in select * from public.stock_opname_lines where opname_id = v_o.id
  loop
    if line.difference_qty = 0 then continue; end if;

    select average_cost into v_avg from public.stock_balances
    where item_id = line.item_id and location_id = v_o.location_id;

    v_qty := abs(line.difference_qty);

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, reference_id, status, notes,
      created_by, approved_by, assignment_id, acting_role, acting_location_id
    ) values (
      v_o.business_id, v_group, 'opname_adjustment', line.item_id, line.lot_id,
      case when line.difference_qty < 0 then v_o.location_id else null end,
      case when line.difference_qty > 0 then v_o.location_id else null end,
      v_qty, v_avg,
      'stock_opname', v_o.id, 'draft', line.reason,
      auth.uid(), auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), v_o.location_id
    ) returning id into v_mid;

    perform public._post_stock_movement_internal(v_mid);
  end loop;

  update public.stock_opnames
  set status = 'approved', approved_by = auth.uid()
  where id = v_o.id
  returning * into v_o;

  perform set_config('inventory.opname_rpc', '', true);
  return v_o;
exception when others then
  perform set_config('inventory.opname_rpc', '', true);
  raise;
end;
$$;

-- Auto-post opname tanpa approval besar (dipanggil opsional setelah submit jika !requires_approval)
create or replace function public.post_stock_opname_if_no_approval(
  p_opname_id uuid,
  p_assignment_id uuid
)
returns public.stock_opnames
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.stock_opnames;
begin
  select * into v_o from public.stock_opnames where id = p_opname_id;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status <> 'submitted' then raise exception 'opname belum submitted'; end if;
  if v_o.requires_approval then
    raise exception 'opname membutuhkan approval';
  end if;
  -- Pakai approve path dengan pengecualian self untuk selisih kecil? 
  -- Selisih kecil: izinkan submitter "approve" teknis via flag owner-equivalent small path
  perform set_config('inventory.opname_rpc', '1', true);
  update public.stock_opnames
  set submitted_by = null  -- bypass self-check untuk small auto — LEBIH AMAN: set approved_by terpisah
  where id = p_opname_id;
  perform set_config('inventory.opname_rpc', '', true);

  return public.approve_stock_opname(p_opname_id, p_assignment_id);
end;
$$;

-- Catatan: post_stock_opname_if_no_approval di atas menyentuh submitted_by — terlalu hacky.
-- Ganti implementasi bersih: duplikasi post lines tanpa self-check untuk !requires_approval
create or replace function public.post_stock_opname_if_no_approval(
  p_opname_id uuid,
  p_assignment_id uuid
)
returns public.stock_opnames
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.stock_opnames;
  v_a public.member_assignments;
  v_group uuid := gen_random_uuid();
  line record;
  v_mid uuid;
  v_avg numeric(18,4);
  v_qty numeric(18,6);
begin
  select * into v_o from public.stock_opnames where id = p_opname_id for update;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status <> 'submitted' then raise exception 'opname belum submitted'; end if;
  if v_o.requires_approval then raise exception 'opname membutuhkan approval'; end if;

  v_a := public._require_assignment(
    v_o.business_id, p_assignment_id, 'opname_stock', v_o.location_id
  );

  perform set_config('inventory.opname_rpc', '1', true);

  for line in select * from public.stock_opname_lines where opname_id = v_o.id
  loop
    if line.difference_qty = 0 then continue; end if;
    select average_cost into v_avg from public.stock_balances
    where item_id = line.item_id and location_id = v_o.location_id;
    v_qty := abs(line.difference_qty);

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, reference_id, status, notes,
      created_by, assignment_id, acting_role, acting_location_id
    ) values (
      v_o.business_id, v_group, 'opname_adjustment', line.item_id, line.lot_id,
      case when line.difference_qty < 0 then v_o.location_id else null end,
      case when line.difference_qty > 0 then v_o.location_id else null end,
      v_qty, v_avg,
      'stock_opname', v_o.id, 'draft', line.reason,
      auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), v_o.location_id
    ) returning id into v_mid;

    perform public._post_stock_movement_internal(v_mid);
  end loop;

  update public.stock_opnames
  set status = 'approved', approved_by = auth.uid()
  where id = v_o.id
  returning * into v_o;

  perform set_config('inventory.opname_rpc', '', true);
  return v_o;
exception when others then
  perform set_config('inventory.opname_rpc', '', true);
  raise;
end;
$$;

-- ============================================================================
-- post_inventory_production
-- ============================================================================
create or replace function public.post_inventory_production(
  p_production_id uuid,
  p_assignment_id uuid
)
returns public.inventory_productions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.inventory_productions;
  v_a public.member_assignments;
  v_group uuid := gen_random_uuid();
  line record;
  v_mid uuid;
  v_avg numeric(18,4);
  v_lot uuid;
begin
  select * into v_p from public.inventory_productions where id = p_production_id for update;
  if not found then raise exception 'production tidak ditemukan'; end if;
  if v_p.status <> 'draft' then raise exception 'hanya draft'; end if;

  v_a := public._require_assignment(
    v_p.business_id, p_assignment_id, 'receive_to_warehouse', v_p.location_id
  );

  for line in select * from public.inventory_production_lines where production_id = v_p.id
  loop
    if line.line_type = 'production_consumption' then
      select average_cost into v_avg from public.stock_balances
      where item_id = line.item_id and location_id = v_p.location_id;

      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_p.business_id, v_group, 'production_consumption', line.item_id, line.lot_id,
        v_p.location_id, null, line.quantity, v_avg,
        'inventory_production', v_p.id, 'draft',
        auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), v_p.location_id
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);

    elsif line.line_type = 'production_output' then
      if line.unit_cost is null then
        raise exception 'production_output wajib unit_cost';
      end if;
      v_lot := line.lot_id;
      if v_lot is null and (line.expiry_date is not null or line.expiry_unknown) then
        insert into public.inventory_lots (
          business_id, item_id, expiry_date, expiry_unknown,
          source_type, source_id, initial_unit_cost
        ) values (
          v_p.business_id, line.item_id, line.expiry_date, line.expiry_unknown,
          'inventory_production', v_p.id, line.unit_cost
        ) returning id into v_lot;
      end if;

      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_p.business_id, v_group, 'production_output', line.item_id, v_lot,
        null, v_p.location_id, line.quantity, line.unit_cost,
        'inventory_production', v_p.id, 'draft',
        auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), v_p.location_id
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);

    elsif line.line_type in ('waste', 'shrinkage') then
      select average_cost into v_avg from public.stock_balances
      where item_id = line.item_id and location_id = v_p.location_id;

      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_p.business_id, v_group, line.line_type, line.item_id, line.lot_id,
        v_p.location_id, null, line.quantity, v_avg,
        'inventory_production', v_p.id, 'draft',
        auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), v_p.location_id
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);
    end if;
  end loop;

  update public.inventory_productions
  set status = 'posted', posted_at = now(), movement_group_id = v_group
  where id = v_p.id
  returning * into v_p;

  return v_p;
end;
$$;

-- ============================================================================
-- record_inventory_waste
-- ============================================================================
create or replace function public.record_inventory_waste(
  p_business_id uuid,
  p_location_id uuid,
  p_item_id uuid,
  p_lot_id uuid,
  p_waste_type text,
  p_quantity numeric,
  p_reason text,
  p_photo_url text,
  p_assignment_id uuid
)
returns public.waste_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.member_assignments;
  v_avg numeric(18,4);
  v_mid uuid;
  v_w public.waste_records;
begin
  if p_waste_type not in ('waste', 'shrinkage', 'damaged', 'expired') then
    raise exception 'waste_type tidak valid';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity harus > 0';
  end if;

  v_a := public._require_assignment(p_business_id, p_assignment_id, 'opname_stock', p_location_id);

  select average_cost into v_avg from public.stock_balances
  where item_id = p_item_id and location_id = p_location_id;

  insert into public.stock_movements (
    business_id, movement_type, item_id, lot_id,
    from_location_id, to_location_id, quantity, unit_cost,
    reference_type, status, notes,
    created_by, assignment_id, acting_role, acting_location_id
  ) values (
    p_business_id, p_waste_type, p_item_id, p_lot_id,
    p_location_id, null, p_quantity, v_avg,
    'waste_record', 'draft', p_reason,
    auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), p_location_id
  ) returning id into v_mid;

  perform public._post_stock_movement_internal(v_mid);

  insert into public.waste_records (
    business_id, location_id, item_id, lot_id, movement_id,
    waste_type, quantity, unit_cost, reason, photo_url,
    created_by, assignment_id, acting_role
  ) values (
    p_business_id, p_location_id, p_item_id, p_lot_id, v_mid,
    p_waste_type, p_quantity, v_avg, p_reason, p_photo_url,
    auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner')
  ) returning * into v_w;

  return v_w;
end;
$$;

-- ============================================================================
-- post_inventory_opening — sandbox/UAT only; diblok setelah go-live
-- ============================================================================
create or replace function public.post_inventory_opening(
  p_business_id uuid,
  p_location_id uuid,
  p_lines jsonb,
  p_assignment_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.member_assignments;
  v_group uuid := gen_random_uuid();
  elem jsonb;
  v_mid uuid;
  v_lot uuid;
begin
  if public.inventory_is_go_live(p_business_id) then
    raise exception 'opening dilarang setelah go-live';
  end if;

  if public.business_role(p_business_id) <> 'owner'
     and not public.has_assignment_role(p_business_id, array['forecasting_inventory']::text[]) then
    raise exception 'hanya owner/forecasting';
  end if;

  v_a := public._require_assignment(p_business_id, p_assignment_id, 'manage_items', p_location_id);

  for elem in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    if (elem->>'unit_cost') is null then
      raise exception 'opening wajib unit_cost';
    end if;

    v_lot := null;
    if coalesce((elem->>'expiry_unknown')::boolean, false)
       or elem ? 'expiry_date'
       or elem ? 'batch_number' then
      insert into public.inventory_lots (
        business_id, item_id, batch_number, expiry_date, expiry_unknown,
        source_type, initial_unit_cost
      ) values (
        p_business_id,
        (elem->>'item_id')::uuid,
        elem->>'batch_number',
        nullif(elem->>'expiry_date', '')::date,
        coalesce((elem->>'expiry_unknown')::boolean, false),
        'opening',
        (elem->>'unit_cost')::numeric
      ) returning id into v_lot;
    end if;

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, status, notes,
      created_by, assignment_id, acting_role, acting_location_id
    ) values (
      p_business_id, v_group, 'opening', (elem->>'item_id')::uuid, v_lot,
      null, p_location_id, (elem->>'quantity')::numeric, (elem->>'unit_cost')::numeric,
      'opening', 'draft', p_notes,
      auth.uid(), p_assignment_id, coalesce(v_a.role, 'owner'), p_location_id
    ) returning id into v_mid;

    perform public._post_stock_movement_internal(v_mid);
  end loop;

  return v_group;
end;
$$;

-- Owner compensating adjustment RPC
create or replace function public.owner_compensate_stock_movement(
  p_movement_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.stock_movements;
begin
  select * into v_m from public.stock_movements where id = p_movement_id;
  if not found then raise exception 'movement tidak ditemukan'; end if;
  if public.business_role(v_m.business_id) <> 'owner' then
    raise exception 'hanya Owner';
  end if;
  return public._create_compensating_adjustment(p_movement_id, p_notes, auth.uid());
end;
$$;

-- REVOKE + GRANT domain saja
revoke all on function public.send_stock_transfer(uuid, uuid) from public, anon;
revoke all on function public.receive_stock_transfer(uuid, uuid, jsonb, text, text) from public, anon;
revoke all on function public.finalize_inventory_receipt(uuid, uuid) from public, anon;
revoke all on function public.submit_stock_opname(uuid, uuid) from public, anon;
revoke all on function public.approve_stock_opname(uuid, uuid) from public, anon;
revoke all on function public.post_stock_opname_if_no_approval(uuid, uuid) from public, anon;
revoke all on function public.post_inventory_production(uuid, uuid) from public, anon;
revoke all on function public.record_inventory_waste(uuid, uuid, uuid, uuid, text, numeric, text, text, uuid) from public, anon;
revoke all on function public.post_inventory_opening(uuid, uuid, jsonb, uuid, text) from public, anon;
revoke all on function public.owner_compensate_stock_movement(uuid, text) from public, anon;

grant execute on function public.send_stock_transfer(uuid, uuid) to authenticated;
grant execute on function public.receive_stock_transfer(uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.finalize_inventory_receipt(uuid, uuid) to authenticated;
grant execute on function public.submit_stock_opname(uuid, uuid) to authenticated;
grant execute on function public.approve_stock_opname(uuid, uuid) to authenticated;
grant execute on function public.post_stock_opname_if_no_approval(uuid, uuid) to authenticated;
grant execute on function public.post_inventory_production(uuid, uuid) to authenticated;
grant execute on function public.record_inventory_waste(uuid, uuid, uuid, uuid, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.post_inventory_opening(uuid, uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.owner_compensate_stock_movement(uuid, text) to authenticated;

COMMIT;
