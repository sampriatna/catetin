-- ============================================================================
-- DRAFT 07 — Domain RPCs (revisi putaran 3) — BLOCKER UTAMA
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–06
-- Arsitektur: Client → domain RPC → tabel (bukan client write bebas)
-- ============================================================================

BEGIN;

DO $$ BEGIN
  if to_regclass('public.stock_transfers') is null then
    raise exception 'Preflight: stock_transfers belum ada';
  end if;
END $$;

-- ============================================================================
-- _require_assignment — Owner tidak boleh pakai assignment orang lain
-- ============================================================================
create or replace function public._require_assignment(
  p_business_id uuid, p_assignment_id uuid, p_permission text, p_location_id uuid
) returns public.member_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_a public.member_assignments;
  v_uid uuid := auth.uid();
  v_is_owner boolean;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  v_is_owner := public.business_role(p_business_id) = 'owner';

  if p_assignment_id is null then
    if v_is_owner then return null; end if;
    raise exception 'assignment_id wajib';
  end if;

  select a.* into v_a
  from public.member_assignments a
  join public.business_members m on m.id = a.business_member_id
  where a.id = p_assignment_id
    and a.business_id = p_business_id
    and a.active and m.active and m.user_id = v_uid;

  if not found then
    raise exception 'assignment tidak milik user yang login (Owner pun tidak boleh memakai assignment orang lain)';
  end if;

  if p_permission is not null
     and not v_is_owner
     and not (p_permission = any (v_a.permissions)) then
    raise exception 'permission % tidak ada pada assignment', p_permission;
  end if;

  if p_location_id is not null
     and v_a.location_id is not null
     and v_a.location_id is distinct from p_location_id then
    raise exception 'assignment tidak mencakup lokasi ini';
  end if;

  return v_a;
end;
$$;
revoke all on function public._require_assignment(uuid, uuid, text, uuid)
  from public, anon, authenticated;

-- ============================================================================
-- Purchasing link RPCs (create vs review terpisah)
-- ============================================================================
create or replace function public.create_purchasing_tx_link(
  p_business_id uuid,
  p_app_tx_id text,
  p_source_system text,
  p_purchase_kind text,
  p_purchase_request_id uuid,
  p_purchase_request_line_id uuid,
  p_purchase_order_id uuid,
  p_purchase_order_line_id uuid,
  p_direct_reason text
) returns public.purchasing_tx_links
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.business_role(p_business_id);
  v_row public.purchasing_tx_links;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if v_role not in ('owner','purchasing') then
    raise exception 'hanya Purchasing atau Owner yang boleh membuat link';
  end if;
  if p_app_tx_id is null or length(trim(p_app_tx_id)) = 0 then
    raise exception 'app_tx_id wajib';
  end if;

  insert into public.purchasing_tx_links (
    business_id, app_tx_id, source_system, purchase_kind,
    purchase_request_id, purchase_request_line_id,
    purchase_order_id, purchase_order_line_id,
    direct_reason, created_by
  ) values (
    p_business_id, trim(p_app_tx_id), coalesce(nullif(trim(p_source_system),''),'app_state'),
    p_purchase_kind,
    p_purchase_request_id, p_purchase_request_line_id,
    p_purchase_order_id, p_purchase_order_line_id,
    p_direct_reason, auth.uid()
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.review_purchasing_tx_link(
  p_link_id uuid, p_review_status text, p_notes text default null
) returns public.purchasing_tx_links
language plpgsql security definer set search_path = public as $$
declare
  v_row public.purchasing_tx_links;
  v_role text;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if p_review_status not in ('approved','rejected') then
    raise exception 'review_status harus approved atau rejected';
  end if;

  select * into v_row from public.purchasing_tx_links where id = p_link_id for update;
  if not found then raise exception 'link tidak ditemukan'; end if;

  v_role := public.business_role(v_row.business_id);
  if v_role not in ('owner','admin') then
    raise exception 'hanya Admin atau Owner yang boleh review';
  end if;
  if v_role = 'admin' and not public.has_permission(v_row.business_id, 'review_purchasing_link', null) then
    -- admin legacy tetap boleh review via business_role
    null;
  end if;

  -- Admin/Owner TIDAK boleh mengubah PR/PO/kind di sini — hanya review fields
  perform set_config('inventory.purchasing_review_rpc', '1', true);
  update public.purchasing_tx_links
  set review_status = p_review_status,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_link_id
  returning * into v_row;
  perform set_config('inventory.purchasing_review_rpc', '', true);
  return v_row;
exception when others then
  perform set_config('inventory.purchasing_review_rpc', '', true);
  raise;
end;
$$;

-- ============================================================================
-- Transfer draft + send + receive + resolve variance
-- ============================================================================
create or replace function public.create_stock_transfer_draft(
  p_business_id uuid, p_from_location_id uuid, p_to_location_id uuid,
  p_transfer_no text, p_assignment_id uuid, p_notes text default null,
  p_lines jsonb default '[]'::jsonb
) returns public.stock_transfers
language plpgsql security definer set search_path = public as $$
declare
  v_a public.member_assignments;
  v_t public.stock_transfers;
  elem jsonb;
begin
  v_a := public._require_assignment(p_business_id, p_assignment_id, 'create_transfer', p_from_location_id);
  if public.business_role(p_business_id) <> 'owner'
     and not public.has_assignment_role(p_business_id, array['forecasting_inventory']::text[]) then
    raise exception 'hanya forecasting/owner';
  end if;
  if p_from_location_id = p_to_location_id then raise exception 'lokasi harus berbeda'; end if;

  insert into public.stock_transfers (
    business_id, transfer_no, from_location_id, to_location_id,
    created_by, created_assignment_id, notes
  ) values (
    p_business_id, p_transfer_no, p_from_location_id, p_to_location_id,
    auth.uid(), p_assignment_id, p_notes
  ) returning * into v_t;

  for elem in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb))
  loop
    insert into public.stock_transfer_lines (
      business_id, transfer_id, item_id, lot_id, sent_qty, batch_code, expiry_date, notes
    ) values (
      p_business_id, v_t.id,
      (elem->>'item_id')::uuid,
      nullif(elem->>'lot_id','')::uuid,
      (elem->>'sent_qty')::numeric,
      elem->>'batch_code',
      nullif(elem->>'expiry_date','')::date,
      elem->>'notes'
    );
  end loop;
  return v_t;
end;
$$;

create or replace function public.send_stock_transfer(p_transfer_id uuid, p_assignment_id uuid)
returns public.stock_transfers
language plpgsql security definer set search_path = public as $$
declare
  v_t public.stock_transfers; v_a public.member_assignments;
  v_transit uuid; v_group uuid := gen_random_uuid();
  r record; v_avg numeric(18,4); v_mid uuid; v_cnt int;
begin
  select * into v_t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer tidak ditemukan'; end if;
  if v_t.status <> 'draft' then raise exception 'hanya draft yang bisa dikirim'; end if;

  select count(*) into v_cnt from public.stock_transfer_lines where transfer_id = v_t.id;
  if v_cnt = 0 then raise exception 'transfer tanpa line'; end if;

  v_a := public._require_assignment(v_t.business_id, p_assignment_id, 'create_transfer', v_t.from_location_id);
  if public.business_role(v_t.business_id) <> 'owner'
     and not public.has_assignment_role(v_t.business_id, array['forecasting_inventory']::text[]) then
    raise exception 'hanya forecasting/owner';
  end if;

  v_transit := public.inventory_in_transit_location_id(v_t.business_id);
  if v_transit is null then raise exception 'IN_TRANSIT belum ada'; end if;

  perform set_config('inventory.transfer_rpc', '1', true);
  for r in select * from public.stock_transfer_lines where transfer_id = v_t.id for update
  loop
    select average_cost into v_avg from public.stock_balances
    where item_id = r.item_id and location_id = v_t.from_location_id;
    if v_avg is null then raise exception 'average_cost sumber belum ada untuk item %', r.item_id; end if;
    update public.stock_transfer_lines set unit_cost = v_avg where id = r.id;

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, reference_id, status,
      created_by, assignment_id, acting_role, acting_location_id
    ) values (
      v_t.business_id, v_group, 'transfer_out', r.item_id, r.lot_id,
      v_t.from_location_id, v_transit, r.sent_qty, v_avg,
      'stock_transfer', v_t.id, 'draft',
      auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_t.from_location_id
    ) returning id into v_mid;
    perform public._post_stock_movement_internal(v_mid);
  end loop;

  update public.stock_transfers
  set status = 'sent', sent_by = auth.uid(), sent_at = now()
  where id = v_t.id returning * into v_t;
  perform set_config('inventory.transfer_rpc', '', true);
  return v_t;
exception when others then
  perform set_config('inventory.transfer_rpc', '', true);
  raise;
end;
$$;

create or replace function public.receive_stock_transfer(
  p_transfer_id uuid, p_assignment_id uuid, p_lines jsonb,
  p_notes text default null, p_photo_url text default null
) returns public.stock_transfer_receipts
language plpgsql security definer set search_path = public as $$
declare
  v_t public.stock_transfers; v_a public.member_assignments;
  v_transit uuid; v_group uuid := gen_random_uuid();
  v_receipt public.stock_transfer_receipts;
  elem jsonb; v_line public.stock_transfer_lines;
  v_qty numeric(18,6); v_remain numeric(18,6); v_mid uuid;
  v_all_done boolean; v_seen uuid[] := '{}'; v_line_count int := 0;
begin
  select * into v_t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer tidak ditemukan'; end if;
  if v_t.status not in ('sent','partially_received','variance_pending') then
    raise exception 'transfer tidak dalam status bisa diterima';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'payload lines kosong ditolak';
  end if;

  v_a := public._require_assignment(v_t.business_id, p_assignment_id, 'receive_stock', v_t.to_location_id);
  if v_a is null then
    raise exception 'Owner harus memakai acting assignment outlet yang punya receive_stock';
  end if;
  if v_a.role = 'forecasting_inventory' then
    raise exception 'assignment forecasting_inventory tidak boleh receive atas nama outlet';
  end if;
  if not ('receive_stock' = any (v_a.permissions)) then
    raise exception 'assignment aktif tidak punya receive_stock';
  end if;

  v_transit := public.inventory_in_transit_location_id(v_t.business_id);

  insert into public.stock_transfer_receipts (
    business_id, transfer_id, received_by, received_assignment_id,
    acting_role, notes, photo_url, movement_group_id
  ) values (
    v_t.business_id, v_t.id, auth.uid(), p_assignment_id,
    v_a.role, p_notes, p_photo_url, v_group
  ) returning * into v_receipt;

  perform set_config('inventory.transfer_rpc', '1', true);

  for elem in select * from jsonb_array_elements(p_lines)
  loop
    v_line_count := v_line_count + 1;
    if (elem->>'transfer_line_id') is null then raise exception 'transfer_line_id wajib'; end if;
    if (elem->>'transfer_line_id')::uuid = any (v_seen) then
      raise exception 'duplicate transfer_line_id dalam satu receipt';
    end if;
    v_seen := array_append(v_seen, (elem->>'transfer_line_id')::uuid);

    select * into v_line from public.stock_transfer_lines
    where id = (elem->>'transfer_line_id')::uuid and transfer_id = v_t.id for update;
    if not found then raise exception 'transfer line tidak valid'; end if;

    v_qty := (elem->>'received_qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'received_qty harus > 0'; end if;

    v_remain := v_line.sent_qty - v_line.received_qty_total - v_line.resolved_qty_total;
    if v_qty > v_remain then raise exception 'received_qty melebihi sisa'; end if;

    insert into public.stock_transfer_receipt_lines (
      business_id, receipt_id, transfer_line_id, received_qty, variance_reason, photo_url
    ) values (
      v_t.business_id, v_receipt.id, v_line.id, v_qty,
      elem->>'variance_reason', elem->>'photo_url'
    );

    update public.stock_transfer_lines
    set received_qty_total = received_qty_total + v_qty
    where id = v_line.id;

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, reference_id, status,
      created_by, assignment_id, acting_role, acting_location_id
    ) values (
      v_t.business_id, v_group, 'transfer_in', v_line.item_id, v_line.lot_id,
      v_transit, v_t.to_location_id, v_qty, v_line.unit_cost,
      'stock_transfer_receipt', v_receipt.id, 'draft',
      auth.uid(), p_assignment_id, v_a.role, v_t.to_location_id
    ) returning id into v_mid;
    perform public._post_stock_movement_internal(v_mid);
  end loop;

  if v_line_count = 0 then raise exception 'payload lines kosong'; end if;

  select bool_and(received_qty_total + resolved_qty_total >= sent_qty) into v_all_done
  from public.stock_transfer_lines where transfer_id = v_t.id;

  update public.stock_transfers
  set status = case
    when v_all_done then 'received'
    when exists (
      select 1 from public.stock_transfer_lines
      where transfer_id = v_t.id and received_qty_total + resolved_qty_total < sent_qty
    ) then 'partially_received'
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

create or replace function public.resolve_transfer_variance(
  p_transfer_id uuid, p_assignment_id uuid, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_t public.stock_transfers; v_a public.member_assignments;
  v_transit uuid; v_group uuid := gen_random_uuid();
  elem jsonb; v_line public.stock_transfer_lines;
  v_qty numeric(18,6); v_remain numeric(18,6); v_res text; v_mid uuid;
begin
  select * into v_t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer tidak ditemukan'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'payload kosong';
  end if;

  v_a := public._require_assignment(v_t.business_id, p_assignment_id, 'create_transfer', null);
  if public.business_role(v_t.business_id) <> 'owner'
     and not public.has_assignment_role(v_t.business_id, array['forecasting_inventory']::text[]) then
    raise exception 'hanya forecasting/owner menyelesaikan variance';
  end if;

  v_transit := public.inventory_in_transit_location_id(v_t.business_id);
  perform set_config('inventory.transfer_rpc', '1', true);

  for elem in select * from jsonb_array_elements(p_lines)
  loop
    v_res := elem->>'resolution';
    if v_res not in ('received_later','returned_to_source','damaged','shrinkage','adjustment_approved') then
      raise exception 'resolution tidak valid';
    end if;
    v_qty := (elem->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'quantity resolusi harus > 0'; end if;

    select * into v_line from public.stock_transfer_lines
    where id = (elem->>'transfer_line_id')::uuid and transfer_id = v_t.id for update;
    if not found then raise exception 'line tidak valid'; end if;

    v_remain := v_line.sent_qty - v_line.received_qty_total - v_line.resolved_qty_total;
    if v_qty > v_remain then raise exception 'qty resolusi melebihi sisa IN_TRANSIT'; end if;

    insert into public.stock_transfer_variance_resolutions (
      business_id, transfer_id, transfer_line_id, resolution, quantity,
      reason, movement_group_id, created_by, assignment_id
    ) values (
      v_t.business_id, v_t.id, v_line.id, v_res, v_qty,
      elem->>'reason', v_group, auth.uid(), p_assignment_id
    );

    if v_res = 'received_later' then
      -- sama seperti receive ke outlet
      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_t.business_id, v_group, 'transfer_in', v_line.item_id, v_line.lot_id,
        v_transit, v_t.to_location_id, v_qty, v_line.unit_cost,
        'stock_transfer_variance', v_t.id, 'draft',
        auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_t.to_location_id
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);
      update public.stock_transfer_lines
      set received_qty_total = received_qty_total + v_qty where id = v_line.id;

    elsif v_res = 'returned_to_source' then
      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_t.business_id, v_group, 'transfer_in', v_line.item_id, v_line.lot_id,
        v_transit, v_t.from_location_id, v_qty, v_line.unit_cost,
        'stock_transfer_variance', v_t.id, 'draft',
        auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_t.from_location_id
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);
      update public.stock_transfer_lines
      set resolved_qty_total = resolved_qty_total + v_qty where id = v_line.id;

    elsif v_res in ('damaged','shrinkage') then
      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status, notes,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_t.business_id, v_group, v_res, v_line.item_id, v_line.lot_id,
        v_transit, null, v_qty, v_line.unit_cost,
        'stock_transfer_variance', v_t.id, 'draft', elem->>'reason',
        auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_transit
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);
      update public.stock_transfer_lines
      set resolved_qty_total = resolved_qty_total + v_qty where id = v_line.id;

    elsif v_res = 'adjustment_approved' then
      if public.business_role(v_t.business_id) <> 'owner' then
        raise exception 'adjustment_approved wajib Owner';
      end if;
      insert into public.stock_movements (
        business_id, movement_group_id, movement_type, item_id, lot_id,
        from_location_id, to_location_id, quantity, unit_cost,
        reference_type, reference_id, status, notes, approved_by,
        created_by, assignment_id, acting_role, acting_location_id
      ) values (
        v_t.business_id, v_group, 'manual_adjustment', v_line.item_id, v_line.lot_id,
        v_transit, null, v_qty, v_line.unit_cost,
        'stock_transfer_variance', v_t.id, 'draft', elem->>'reason', auth.uid(),
        auth.uid(), p_assignment_id, 'owner', v_transit
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);
      update public.stock_transfer_lines
      set resolved_qty_total = resolved_qty_total + v_qty where id = v_line.id;
    end if;
  end loop;

  update public.stock_transfers
  set status = case
    when (select bool_and(received_qty_total + resolved_qty_total >= sent_qty)
          from public.stock_transfer_lines where transfer_id = v_t.id)
    then 'received' else 'variance_pending' end
  where id = v_t.id;

  perform set_config('inventory.transfer_rpc', '', true);
  return v_group;
exception when others then
  perform set_config('inventory.transfer_rpc', '', true);
  raise;
end;
$$;

-- ============================================================================
-- Receipt: mark cost_pending (tanpa exception) + finalize
-- ============================================================================
create or replace function public.mark_inventory_receipt_cost_pending(p_receipt_id uuid)
returns public.inventory_receipts
language plpgsql security definer set search_path = public as $$
declare v_r public.inventory_receipts;
begin
  select * into v_r from public.inventory_receipts where id = p_receipt_id for update;
  if not found then raise exception 'receipt tidak ditemukan'; end if;
  if public.business_role(v_r.business_id) <> 'owner'
     and not public.has_permission(v_r.business_id, 'receive_to_warehouse', v_r.location_id) then
    raise exception 'forbidden';
  end if;
  update public.inventory_receipts set status = 'cost_pending'
  where id = p_receipt_id returning * into v_r;
  return v_r;
end;
$$;

create or replace function public.finalize_inventory_receipt(
  p_receipt_id uuid, p_assignment_id uuid
) returns public.inventory_receipts
language plpgsql security definer set search_path = public as $$
declare
  v_r public.inventory_receipts; v_a public.member_assignments;
  v_link public.purchasing_tx_links; v_pr public.purchase_requests;
  v_group uuid := gen_random_uuid(); line record; v_lot uuid; v_mid uuid;
  v_cnt int; v_item public.inventory_items;
begin
  select * into v_r from public.inventory_receipts where id = p_receipt_id for update;
  if not found then raise exception 'receipt tidak ditemukan'; end if;
  if v_r.status = 'posted' then raise exception 'receipt sudah posted'; end if;

  v_a := public._require_assignment(
    v_r.business_id, p_assignment_id, 'receive_to_warehouse', v_r.location_id
  );

  select count(*) into v_cnt from public.inventory_receipt_lines where receipt_id = v_r.id;
  if v_cnt = 0 then raise exception 'receipt wajib punya minimal 1 line'; end if;

  if exists (select 1 from public.inventory_receipt_lines where receipt_id = v_r.id and unit_cost is null) then
    -- Jangan raise setelah update dalam transaksi yang sama untuk cost_pending:
    -- panggil mark terpisah; di sini tolak finalize.
    raise exception 'masih ada line tanpa unit_cost — panggil mark_inventory_receipt_cost_pending lalu lengkapi cost';
  end if;

  if v_r.purchasing_tx_link_id is null then
    raise exception 'purchasing_tx_link_id wajib sebelum finalize';
  end if;
  select * into v_link from public.purchasing_tx_links where id = v_r.purchasing_tx_link_id for update;
  if not found then raise exception 'purchasing link tidak ditemukan'; end if;
  if v_link.received then raise exception 'link sudah pernah received'; end if;

  if v_link.purchase_kind in ('direct','emergency') then
    if v_link.review_status <> 'approved' then
      raise exception 'direct/emergency wajib approved sebelum receive stok';
    end if;
  elsif v_link.purchase_kind = 'from_pr' then
    select * into v_pr from public.purchase_requests where id = v_link.purchase_request_id;
    if v_pr.status <> 'approved' then raise exception 'PR belum approved'; end if;
  elsif v_link.purchase_kind = 'from_po' then
    select * into v_pr from public.purchase_requests where id = v_link.purchase_request_id;
    if v_pr.status <> 'approved' then raise exception 'PR belum approved'; end if;
    if v_link.purchase_order_id is null then raise exception 'PO wajib'; end if;
    if not exists (
      select 1 from public.purchase_orders po
      where po.id = v_link.purchase_order_id
        and po.purchase_request_id = v_link.purchase_request_id
    ) then raise exception 'PO tidak konsisten dengan PR'; end if;
  end if;

  for line in select * from public.inventory_receipt_lines where receipt_id = v_r.id
  loop
    select * into v_item from public.inventory_items where id = line.item_id;
    if v_item.expiry_mode = 'required' then
      if line.lot_id is null and line.expiry_date is null and not line.expiry_unknown then
        raise exception 'item % wajib expiry/lot', v_item.sku;
      end if;
      if line.expiry_unknown then
        raise exception 'item % expiry_mode=required tidak boleh expiry_unknown', v_item.sku;
      end if;
    end if;

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
      auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_r.location_id
    ) returning id into v_mid;
    perform public._post_stock_movement_internal(v_mid);
  end loop;

  perform set_config('inventory.purchasing_receive_rpc', '1', true);
  perform set_config('inventory.purchasing_lock_rpc', '1', true);
  update public.purchasing_tx_links
  set received = true, locked = true
  where id = v_link.id;
  perform set_config('inventory.purchasing_receive_rpc', '', true);
  perform set_config('inventory.purchasing_lock_rpc', '', true);

  update public.inventory_receipts
  set status = 'posted', posted_at = now(), locked = true
  where id = v_r.id returning * into v_r;

  return v_r;
end;
$$;

-- ============================================================================
-- Opname snapshot + recount
-- ============================================================================
create or replace function public.create_stock_opname_draft(
  p_business_id uuid, p_location_id uuid, p_area text, p_assignment_id uuid, p_notes text default null
) returns public.stock_opnames
language plpgsql security definer set search_path = public as $$
declare v_a public.member_assignments; v_o public.stock_opnames;
begin
  v_a := public._require_assignment(p_business_id, p_assignment_id, 'opname_stock', p_location_id);
  insert into public.stock_opnames (
    business_id, location_id, area, notes, assignment_id, acting_role, created_at
  ) values (
    p_business_id, p_location_id, p_area, p_notes, p_assignment_id, coalesce(v_a.role,'owner'), now()
  ) returning * into v_o;
  return v_o;
end;
$$;

create or replace function public.save_stock_opname_lines(
  p_opname_id uuid, p_assignment_id uuid, p_lines jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_o public.stock_opnames; v_a public.member_assignments; elem jsonb; n int := 0;
begin
  select * into v_o from public.stock_opnames where id = p_opname_id for update;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status not in ('draft','recount_required') then
    raise exception 'hanya draft/recount_required yang bisa diisi line';
  end if;
  v_a := public._require_assignment(v_o.business_id, p_assignment_id, 'opname_stock', v_o.location_id);

  delete from public.stock_opname_lines where opname_id = v_o.id;
  for elem in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb))
  loop
    insert into public.stock_opname_lines (
      business_id, opname_id, item_id, lot_id, physical_qty, reason, photo_url, unit_cost_override
    ) values (
      v_o.business_id, v_o.id,
      (elem->>'item_id')::uuid,
      nullif(elem->>'lot_id','')::uuid,
      (elem->>'physical_qty')::numeric,
      elem->>'reason', elem->>'photo_url',
      nullif(elem->>'unit_cost_override','')::numeric
    );
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'opname wajib punya minimal 1 line'; end if;
  return n;
end;
$$;

create or replace function public.submit_stock_opname(p_opname_id uuid, p_assignment_id uuid)
returns public.stock_opnames
language plpgsql security definer set search_path = public as $$
declare
  v_o public.stock_opnames; v_a public.member_assignments;
  v_pct numeric(8,4); v_limit bigint; v_avg numeric(18,4);
  v_sys numeric(18,6); v_diff numeric(18,6); v_val numeric(18,4);
  v_req boolean; v_any_req boolean := false; v_cost_req boolean := false;
  v_last timestamptz; line record; v_cnt int;
begin
  select * into v_o from public.stock_opnames where id = p_opname_id for update;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status not in ('draft','recount_required') then raise exception 'status tidak bisa submit'; end if;
  v_a := public._require_assignment(v_o.business_id, p_assignment_id, 'opname_stock', v_o.location_id);

  select count(*) into v_cnt from public.stock_opname_lines where opname_id = v_o.id;
  if v_cnt = 0 then raise exception 'opname tanpa line'; end if;

  select opname_variance_pct, opname_variance_value_idr into v_pct, v_limit
  from public.inventory_settings where business_id = v_o.business_id;
  v_pct := coalesce(v_pct, 5); v_limit := coalesce(v_limit, 100000);

  select max(posted_at) into v_last from public.stock_movements
  where business_id = v_o.business_id and status = 'posted'
    and (from_location_id = v_o.location_id or to_location_id = v_o.location_id);

  perform set_config('inventory.opname_rpc', '1', true);
  for line in select * from public.stock_opname_lines where opname_id = v_o.id for update
  loop
    if line.physical_qty < 0 then raise exception 'physical_qty tidak boleh negatif'; end if;
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

    if v_diff > 0 and v_avg is null then
      if line.unit_cost_override is null then
        raise exception 'positive adjustment tanpa average cost wajib unit_cost_override + Owner approval';
      end if;
      v_cost_req := true; v_any_req := true; v_req := true;
      v_val := abs(v_diff) * line.unit_cost_override;
    else
      v_val := abs(v_diff) * coalesce(v_avg, 0);
      v_req := ((abs(v_diff) / greatest(abs(v_sys), 0.000001) * 100) >= v_pct)
               or (v_val >= v_limit);
      if v_req then v_any_req := true; end if;
    end if;

    update public.stock_opname_lines
    set system_qty = v_sys, difference_qty = v_diff,
        difference_value = v_val, requires_approval = v_req
    where id = line.id;
  end loop;

  update public.stock_opnames
  set status = 'submitted', submitted_by = auth.uid(), assignment_id = p_assignment_id,
      acting_role = coalesce(v_a.role,'owner'),
      requires_approval = v_any_req, requires_cost_approval = v_cost_req,
      snapshot_at = now(), snapshot_last_movement_at = v_last
  where id = v_o.id returning * into v_o;

  perform set_config('inventory.opname_rpc', '', true);
  return v_o;
exception when others then
  perform set_config('inventory.opname_rpc', '', true);
  raise;
end;
$$;

create or replace function public.approve_stock_opname(p_opname_id uuid, p_assignment_id uuid)
returns public.stock_opnames
language plpgsql security definer set search_path = public as $$
declare
  v_o public.stock_opnames; v_a public.member_assignments; v_loc public.inventory_locations;
  v_group uuid := gen_random_uuid(); line record; v_mid uuid; v_avg numeric(18,4);
  v_qty numeric(18,6); v_latest timestamptz; v_cost numeric(18,4);
begin
  select * into v_o from public.stock_opnames where id = p_opname_id for update;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status <> 'submitted' then raise exception 'opname belum submitted'; end if;

  -- Stale snapshot check
  select max(posted_at) into v_latest from public.stock_movements
  where business_id = v_o.business_id and status = 'posted'
    and (from_location_id = v_o.location_id or to_location_id = v_o.location_id);
  if v_latest is not null and v_o.snapshot_last_movement_at is not null
     and v_latest > v_o.snapshot_last_movement_at then
    perform set_config('inventory.opname_rpc', '1', true);
    update public.stock_opnames set status = 'recount_required' where id = v_o.id returning * into v_o;
    perform set_config('inventory.opname_rpc', '', true);
    raise exception 'stok berubah setelah snapshot — status recount_required, hitung ulang';
  end if;
  if v_latest is not null and v_o.snapshot_last_movement_at is null then
    perform set_config('inventory.opname_rpc', '1', true);
    update public.stock_opnames set status = 'recount_required' where id = v_o.id returning * into v_o;
    perform set_config('inventory.opname_rpc', '', true);
    raise exception 'ada movement baru setelah snapshot kosong — recount_required';
  end if;
  if v_o.snapshot_at is not null and exists (
    select 1 from public.stock_movements m
    where m.business_id = v_o.business_id and m.status = 'posted'
      and m.posted_at > v_o.snapshot_at
      and (m.from_location_id = v_o.location_id or m.to_location_id = v_o.location_id)
  ) then
    perform set_config('inventory.opname_rpc', '1', true);
    update public.stock_opnames set status = 'recount_required' where id = v_o.id returning * into v_o;
    perform set_config('inventory.opname_rpc', '', true);
    raise exception 'movement setelah snapshot_at — recount_required';
  end if;

  select * into v_loc from public.inventory_locations where id = v_o.location_id;
  v_a := public._require_assignment(v_o.business_id, p_assignment_id, 'approve_opname_variance', v_o.location_id);

  if v_o.submitted_by = auth.uid() then raise exception 'tidak boleh approve opname sendiri'; end if;
  if v_o.requires_cost_approval and public.business_role(v_o.business_id) <> 'owner' then
    raise exception 'positive adj tanpa avg cost wajib Owner approval';
  end if;
  if v_loc.type = 'warehouse' and v_o.acting_role = 'forecasting_inventory'
     and public.business_role(v_o.business_id) <> 'owner' then
    raise exception 'warehouse opname forecasting wajib Owner';
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
    v_cost := coalesce(v_avg, line.unit_cost_override);
    if v_cost is null and line.difference_qty > 0 then
      raise exception 'positive adj tanpa cost';
    end if;
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
      v_qty, v_cost, 'stock_opname', v_o.id, 'draft', line.reason,
      auth.uid(), auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_o.location_id
    ) returning id into v_mid;
    perform public._post_stock_movement_internal(v_mid);
  end loop;

  update public.stock_opnames
  set status = 'approved', approved_by = auth.uid()
  where id = v_o.id returning * into v_o;
  perform set_config('inventory.opname_rpc', '', true);
  return v_o;
exception when others then
  perform set_config('inventory.opname_rpc', '', true);
  raise;
end;
$$;

create or replace function public.post_stock_opname_if_no_approval(
  p_opname_id uuid, p_assignment_id uuid
) returns public.stock_opnames
language plpgsql security definer set search_path = public as $$
declare
  v_o public.stock_opnames; v_a public.member_assignments;
  v_group uuid := gen_random_uuid(); line record; v_mid uuid;
  v_avg numeric(18,4); v_qty numeric(18,6); v_latest timestamptz; v_cost numeric(18,4);
begin
  select * into v_o from public.stock_opnames where id = p_opname_id for update;
  if not found then raise exception 'opname tidak ditemukan'; end if;
  if v_o.status <> 'submitted' then raise exception 'opname belum submitted'; end if;
  if v_o.requires_approval or v_o.requires_cost_approval then
    raise exception 'opname membutuhkan approval';
  end if;

  select max(posted_at) into v_latest from public.stock_movements
  where business_id = v_o.business_id and status = 'posted'
    and (from_location_id = v_o.location_id or to_location_id = v_o.location_id);
  if (v_latest is not null and (
        (v_o.snapshot_last_movement_at is not null and v_latest > v_o.snapshot_last_movement_at)
        or (v_o.snapshot_at is not null and v_latest > v_o.snapshot_at)
      )) then
    perform set_config('inventory.opname_rpc', '1', true);
    update public.stock_opnames set status = 'recount_required' where id = v_o.id;
    perform set_config('inventory.opname_rpc', '', true);
    raise exception 'stok berubah setelah snapshot — recount_required';
  end if;

  v_a := public._require_assignment(v_o.business_id, p_assignment_id, 'opname_stock', v_o.location_id);
  perform set_config('inventory.opname_rpc', '1', true);

  for line in select * from public.stock_opname_lines where opname_id = v_o.id
  loop
    if line.difference_qty = 0 then continue; end if;
    select average_cost into v_avg from public.stock_balances
    where item_id = line.item_id and location_id = v_o.location_id;
    v_cost := coalesce(v_avg, line.unit_cost_override);
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
      v_qty, v_cost, 'stock_opname', v_o.id, 'draft', line.reason,
      auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_o.location_id
    ) returning id into v_mid;
    perform public._post_stock_movement_internal(v_mid);
  end loop;

  update public.stock_opnames
  set status = 'approved', approved_by = auth.uid()
  where id = v_o.id returning * into v_o;
  perform set_config('inventory.opname_rpc', '', true);
  return v_o;
exception when others then
  perform set_config('inventory.opname_rpc', '', true);
  raise;
end;
$$;

-- ============================================================================
-- Opening session + go-live
-- ============================================================================
create or replace function public.create_opening_session(
  p_business_id uuid, p_session_key text, p_cutoff_at timestamptz
) returns public.inventory_opening_sessions
language plpgsql security definer set search_path = public as $$
declare v_s public.inventory_opening_sessions;
begin
  if public.inventory_is_go_live(p_business_id) then raise exception 'sudah go-live'; end if;
  if public.business_role(p_business_id) <> 'owner'
     and not public.has_assignment_role(p_business_id, array['forecasting_inventory']::text[]) then
    raise exception 'forbidden';
  end if;
  insert into public.inventory_opening_sessions (business_id, session_key, cutoff_at, created_by)
  values (p_business_id, p_session_key, p_cutoff_at, auth.uid())
  returning * into v_s;
  return v_s;
end;
$$;

create or replace function public.post_inventory_opening(
  p_session_id uuid, p_assignment_id uuid
) returns public.inventory_opening_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_s public.inventory_opening_sessions; v_a public.member_assignments;
  line record; v_group uuid := gen_random_uuid(); v_lot uuid; v_mid uuid;
  v_item public.inventory_items; v_loc uuid; v_cnt int;
begin
  select * into v_s from public.inventory_opening_sessions where id = p_session_id for update;
  if not found then raise exception 'session tidak ditemukan'; end if;
  if v_s.status = 'posted' then raise exception 'session sudah dipost (idempotent reject)'; end if;
  if public.inventory_is_go_live(v_s.business_id) then raise exception 'sudah go-live'; end if;

  v_a := public._require_assignment(v_s.business_id, p_assignment_id, 'manage_items', null);
  select count(*) into v_cnt from public.inventory_opening_session_lines where session_id = v_s.id;
  if v_cnt = 0 then raise exception 'opening session tanpa line'; end if;

  for line in select * from public.inventory_opening_session_lines where session_id = v_s.id
  loop
    if exists (
      select 1 from public.inventory_opening_locks l
      where l.business_id = v_s.business_id and l.location_id = line.location_id and l.status = 'locked'
    ) then
      raise exception 'lokasi % sudah opening-locked', line.location_id;
    end if;

    select * into v_item from public.inventory_items where id = line.item_id;
    if v_item.expiry_mode = 'required' then
      if line.expiry_date is null or line.expiry_unknown then
        raise exception 'opening item % wajib expiry_date', v_item.sku;
      end if;
    end if;

    v_lot := line.lot_id;
    if v_lot is null and (line.batch_number is not null or line.expiry_date is not null or line.expiry_unknown) then
      insert into public.inventory_lots (
        business_id, item_id, batch_number, expiry_date, expiry_unknown,
        source_type, source_id, initial_unit_cost
      ) values (
        v_s.business_id, line.item_id, line.batch_number, line.expiry_date, line.expiry_unknown,
        'opening_session', v_s.id, line.unit_cost
      ) returning id into v_lot;
    end if;

    insert into public.stock_movements (
      business_id, movement_group_id, movement_type, item_id, lot_id,
      from_location_id, to_location_id, quantity, unit_cost,
      reference_type, reference_id, status,
      created_by, assignment_id, acting_role, acting_location_id
    ) values (
      v_s.business_id, v_group, 'opening', line.item_id, v_lot,
      null, line.location_id, line.quantity, line.unit_cost,
      'opening_session', v_s.id, 'draft',
      auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), line.location_id
    ) returning id into v_mid;
    perform public._post_stock_movement_internal(v_mid);
  end loop;

  -- Lock semua lokasi yang muncul di session
  for v_loc in select distinct location_id from public.inventory_opening_session_lines where session_id = v_s.id
  loop
    insert into public.inventory_opening_locks (
      business_id, location_id, opening_session_id, cutoff_at, locked_at, locked_by, status
    ) values (
      v_s.business_id, v_loc, v_s.id, v_s.cutoff_at, now(), auth.uid(), 'locked'
    )
    on conflict (business_id, location_id) do update
      set status = 'locked', locked_at = now(), locked_by = auth.uid(),
          opening_session_id = excluded.opening_session_id, cutoff_at = excluded.cutoff_at;
  end loop;

  update public.inventory_opening_sessions
  set status = 'posted', posted_at = now()
  where id = v_s.id returning * into v_s;
  return v_s;
end;
$$;

create or replace function public.activate_inventory_go_live(p_business_id uuid)
returns public.inventory_business_state
language plpgsql security definer set search_path = public as $$
declare
  v_state public.inventory_business_state;
  v_unlocked int; v_hanging int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if public.business_role(p_business_id) <> 'owner' then
    raise exception 'hanya Owner yang boleh activate go-live';
  end if;

  select count(*) into v_unlocked
  from public.inventory_locations loc
  where loc.business_id = p_business_id and loc.is_active and not loc.is_system
    and not exists (
      select 1 from public.inventory_opening_locks l
      where l.business_id = p_business_id and l.location_id = loc.id and l.status = 'locked'
    );
  if v_unlocked > 0 then
    raise exception 'masih ada % lokasi aktif belum opening-locked', v_unlocked;
  end if;

  select count(*) into v_hanging from (
    select 1 from public.inventory_receipts
    where business_id = p_business_id and status in ('draft','cost_pending','ready_to_post')
    union all
    select 1 from public.stock_transfers
    where business_id = p_business_id and status in ('draft','sent','partially_received','variance_pending')
    union all
    select 1 from public.stock_opnames
    where business_id = p_business_id and status in ('draft','submitted','recount_required')
  ) x;
  if v_hanging > 0 then
    raise exception 'masih ada dokumen kritis menggantung (%)', v_hanging;
  end if;

  insert into public.inventory_business_state (business_id, lifecycle, go_live_at, go_live_by, allow_negative)
  values (p_business_id, 'go_live', now(), auth.uid(), false)
  on conflict (business_id) do update
    set lifecycle = 'go_live', go_live_at = now(), go_live_by = auth.uid(),
        allow_negative = false, updated_at = now()
  returning * into v_state;
  return v_state;
end;
$$;

-- Waste / production (ringkas, tetap via RPC)
create or replace function public.record_inventory_waste(
  p_business_id uuid, p_location_id uuid, p_item_id uuid, p_lot_id uuid,
  p_waste_type text, p_quantity numeric, p_reason text, p_photo_url text, p_assignment_id uuid
) returns public.waste_records
language plpgsql security definer set search_path = public as $$
declare v_a public.member_assignments; v_avg numeric(18,4); v_mid uuid; v_w public.waste_records;
begin
  if p_waste_type not in ('waste','shrinkage','damaged','expired') then raise exception 'waste_type invalid'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity harus > 0'; end if;
  v_a := public._require_assignment(p_business_id, p_assignment_id, 'opname_stock', p_location_id);
  select average_cost into v_avg from public.stock_balances
  where item_id = p_item_id and location_id = p_location_id;

  insert into public.stock_movements (
    business_id, movement_type, item_id, lot_id, from_location_id, to_location_id,
    quantity, unit_cost, reference_type, status, notes,
    created_by, assignment_id, acting_role, acting_location_id
  ) values (
    p_business_id, p_waste_type, p_item_id, p_lot_id, p_location_id, null,
    p_quantity, v_avg, 'waste_record', 'draft', p_reason,
    auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), p_location_id
  ) returning id into v_mid;
  perform public._post_stock_movement_internal(v_mid);

  insert into public.waste_records (
    business_id, location_id, item_id, lot_id, movement_id, waste_type, quantity,
    unit_cost, reason, photo_url, created_by, assignment_id, acting_role
  ) values (
    p_business_id, p_location_id, p_item_id, p_lot_id, v_mid, p_waste_type, p_quantity,
    v_avg, p_reason, p_photo_url, auth.uid(), p_assignment_id, coalesce(v_a.role,'owner')
  ) returning * into v_w;
  return v_w;
end;
$$;

create or replace function public.post_inventory_production(p_production_id uuid, p_assignment_id uuid)
returns public.inventory_productions
language plpgsql security definer set search_path = public as $$
declare
  v_p public.inventory_productions; v_a public.member_assignments;
  v_group uuid := gen_random_uuid(); line record; v_mid uuid; v_avg numeric(18,4);
  v_lot uuid; v_item public.inventory_items;
begin
  select * into v_p from public.inventory_productions where id = p_production_id for update;
  if not found then raise exception 'production tidak ditemukan'; end if;
  if v_p.status <> 'draft' then raise exception 'hanya draft'; end if;
  v_a := public._require_assignment(v_p.business_id, p_assignment_id, 'receive_to_warehouse', v_p.location_id);

  for line in select * from public.inventory_production_lines where production_id = v_p.id
  loop
    if line.line_type = 'production_output' then
      select * into v_item from public.inventory_items where id = line.item_id;
      if v_item.expiry_mode = 'required' and (line.expiry_date is null or line.expiry_unknown) then
        raise exception 'output % wajib expiry', v_item.sku;
      end if;
      if line.unit_cost is null then raise exception 'production_output wajib unit_cost'; end if;
      v_lot := line.lot_id;
      if v_lot is null and (line.expiry_date is not null or line.expiry_unknown) then
        insert into public.inventory_lots (
          business_id, item_id, expiry_date, expiry_unknown, source_type, source_id, initial_unit_cost
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
        auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_p.location_id
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);
    else
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
        auth.uid(), p_assignment_id, coalesce(v_a.role,'owner'), v_p.location_id
      ) returning id into v_mid;
      perform public._post_stock_movement_internal(v_mid);
    end if;
  end loop;

  update public.inventory_productions
  set status = 'posted', posted_at = now(), movement_group_id = v_group
  where id = v_p.id returning * into v_p;
  return v_p;
end;
$$;

create or replace function public.owner_compensate_stock_movement(p_movement_id uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_m public.stock_movements;
begin
  select * into v_m from public.stock_movements where id = p_movement_id;
  if not found then raise exception 'movement tidak ditemukan'; end if;
  if public.business_role(v_m.business_id) <> 'owner' then raise exception 'hanya Owner'; end if;
  return public._create_compensating_adjustment(p_movement_id, p_notes, auth.uid());
end;
$$;

-- Draft helpers tambahan (minimal set)
create or replace function public.create_inventory_receipt_draft(
  p_business_id uuid, p_location_id uuid, p_receipt_no text,
  p_supplier_id uuid, p_purchasing_tx_link_id uuid, p_assignment_id uuid, p_notes text default null
) returns public.inventory_receipts
language plpgsql security definer set search_path = public as $$
declare
  v_a public.member_assignments; v_r public.inventory_receipts;
  v_link public.purchasing_tx_links; v_pr uuid; v_po uuid;
begin
  v_a := public._require_assignment(p_business_id, p_assignment_id, 'receive_to_warehouse', p_location_id);
  if p_purchasing_tx_link_id is null then
    raise exception 'purchasing_tx_link_id wajib pada receipt';
  end if;
  select * into v_link from public.purchasing_tx_links where id = p_purchasing_tx_link_id;
  if not found or v_link.business_id <> p_business_id then raise exception 'link invalid'; end if;
  v_pr := v_link.purchase_request_id;
  v_po := v_link.purchase_order_id;
  insert into public.inventory_receipts (
    business_id, location_id, receipt_no, supplier_id, purchasing_tx_link_id,
    purchase_request_id, purchase_order_id, notes, created_by, assignment_id
  ) values (
    p_business_id, p_location_id, p_receipt_no, p_supplier_id, p_purchasing_tx_link_id,
    v_pr, v_po, p_notes, auth.uid(), p_assignment_id
  ) returning * into v_r;
  return v_r;
end;
$$;

create or replace function public.save_inventory_receipt_lines(
  p_receipt_id uuid, p_assignment_id uuid, p_lines jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare v_r public.inventory_receipts; elem jsonb; n int := 0;
begin
  select * into v_r from public.inventory_receipts where id = p_receipt_id for update;
  if not found then raise exception 'receipt tidak ditemukan'; end if;
  if v_r.status not in ('draft','cost_pending','ready_to_post') then raise exception 'status tidak editable'; end if;
  perform public._require_assignment(v_r.business_id, p_assignment_id, 'receive_to_warehouse', v_r.location_id);
  delete from public.inventory_receipt_lines where receipt_id = v_r.id;
  for elem in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb))
  loop
    insert into public.inventory_receipt_lines (
      business_id, receipt_id, item_id, quantity, unit_cost, batch_number,
      expiry_date, expiry_unknown, notes
    ) values (
      v_r.business_id, v_r.id, (elem->>'item_id')::uuid, (elem->>'quantity')::numeric,
      nullif(elem->>'unit_cost','')::numeric, elem->>'batch_number',
      nullif(elem->>'expiry_date','')::date, coalesce((elem->>'expiry_unknown')::boolean,false),
      elem->>'notes'
    );
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'minimal 1 line'; end if;
  if exists (select 1 from public.inventory_receipt_lines where receipt_id = v_r.id and unit_cost is null) then
    update public.inventory_receipts set status = 'cost_pending' where id = v_r.id;
  else
    update public.inventory_receipts set status = 'ready_to_post' where id = v_r.id;
  end if;
  return n;
end;
$$;

-- Grants domain RPCs
do $$
declare
  fns text[] := array[
    'create_purchasing_tx_link(uuid,text,text,text,uuid,uuid,uuid,uuid,text)',
    'review_purchasing_tx_link(uuid,text,text)',
    'create_stock_transfer_draft(uuid,uuid,uuid,text,uuid,text,jsonb)',
    'send_stock_transfer(uuid,uuid)',
    'receive_stock_transfer(uuid,uuid,jsonb,text,text)',
    'resolve_transfer_variance(uuid,uuid,jsonb)',
    'mark_inventory_receipt_cost_pending(uuid)',
    'finalize_inventory_receipt(uuid,uuid)',
    'create_stock_opname_draft(uuid,uuid,text,uuid,text)',
    'save_stock_opname_lines(uuid,uuid,jsonb)',
    'submit_stock_opname(uuid,uuid)',
    'approve_stock_opname(uuid,uuid)',
    'post_stock_opname_if_no_approval(uuid,uuid)',
    'create_opening_session(uuid,text,timestamptz)',
    'post_inventory_opening(uuid,uuid)',
    'activate_inventory_go_live(uuid)',
    'record_inventory_waste(uuid,uuid,uuid,uuid,text,numeric,text,text,uuid)',
    'post_inventory_production(uuid,uuid)',
    'owner_compensate_stock_movement(uuid,text)',
    'create_inventory_receipt_draft(uuid,uuid,text,uuid,uuid,uuid,text)',
    'save_inventory_receipt_lines(uuid,uuid,jsonb)'
  ];
  f text;
begin
  foreach f in array fns loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

COMMIT;
