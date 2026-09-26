-- ============================================================================
-- DRAFT 06 — RLS + quantity/valuation RPCs (revisi putaran 3)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–05
--
-- Write dokumen/ledger: HANYA lewat domain RPC (security definer).
-- Tidak ada UPDATE policy purchasing_tx_links untuk Purchasing.
-- ============================================================================

BEGIN;

DO $$ BEGIN
  if to_regclass('public.stock_balances') is null then
    raise exception 'Preflight: stock_balances belum ada';
  end if;
END $$;

create or replace function public.is_inventory_reader(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.business_role(p_business_id) in ('owner','admin')
    or public.has_permission(p_business_id, 'view_inventory', null)
    or public.has_assignment_role(
      p_business_id, array['forecasting_inventory','dapur','bar','operasional_samtaro']::text[]
    );
$$;

create or replace function public.is_inventory_valuer(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.business_role(p_business_id) in ('owner','admin')
    or public.has_permission(p_business_id, 'view_stock_value', null)
    or public.has_assignment_role(p_business_id, array['forecasting_inventory']::text[]);
$$;

revoke all on function public.is_inventory_reader(uuid) from public, anon, authenticated;
revoke all on function public.is_inventory_valuer(uuid) from public, anon, authenticated;
grant execute on function public.is_inventory_reader(uuid) to authenticated;
grant execute on function public.is_inventory_valuer(uuid) to authenticated;

-- Enable RLS
alter table public.suppliers enable row level security;
alter table public.units enable row level security;
alter table public.item_unit_conversions enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_locations enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_settings enable row level security;
alter table public.inventory_business_state enable row level security;
alter table public.inventory_opening_sessions enable row level security;
alter table public.inventory_opening_session_lines enable row level security;
alter table public.inventory_opening_locks enable row level security;
alter table public.inventory_item_audit_log enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_movement_compensations enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_lot_balances enable row level security;
alter table public.stock_opnames enable row level security;
alter table public.stock_opname_lines enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_transfer_receipts enable row level security;
alter table public.stock_transfer_receipt_lines enable row level security;
alter table public.stock_transfer_variance_resolutions enable row level security;
alter table public.waste_records enable row level security;
alter table public.inventory_productions enable row level security;
alter table public.inventory_production_lines enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_lines enable row level security;
alter table public.inventory_requests enable row level security;
alter table public.inventory_request_lines enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchasing_tx_links enable row level security;
alter table public.purchasing_transactions enable row level security;

-- SELECT policies (no cost tables for outlet)
drop policy if exists inv_loc_select on public.inventory_locations;
create policy inv_loc_select on public.inventory_locations for select using (
  public.is_inventory_reader(business_id)
  and (public.is_inventory_valuer(business_id) or public.can_access_location(id) or code = 'IN_TRANSIT')
);

drop policy if exists inv_items_select on public.inventory_items;
create policy inv_items_select on public.inventory_items for select
  using (public.is_inventory_reader(business_id));

drop policy if exists inv_item_loc_select on public.inventory_item_locations;
create policy inv_item_loc_select on public.inventory_item_locations for select
  using (public.is_inventory_reader(business_id));

drop policy if exists units_select on public.units;
create policy units_select on public.units for select using (public.is_inventory_reader(business_id));

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select using (
  public.is_inventory_valuer(business_id) or public.business_role(business_id) = 'purchasing'
);

-- COST TABLES: valuer only
drop policy if exists inv_lots_select on public.inventory_lots;
create policy inv_lots_select on public.inventory_lots for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists stock_balances_select on public.stock_balances;
create policy stock_balances_select on public.stock_balances for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists stock_lot_balances_select on public.stock_lot_balances;
create policy stock_lot_balances_select on public.stock_lot_balances for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists transfer_lines_select on public.stock_transfer_lines;
create policy transfer_lines_select on public.stock_transfer_lines for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists waste_select on public.waste_records;
create policy waste_select on public.waste_records for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists opname_lines_select on public.stock_opname_lines;
create policy opname_lines_select on public.stock_opname_lines for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists receipt_lines_select on public.inventory_receipt_lines;
create policy receipt_lines_select on public.inventory_receipt_lines for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists comps_select on public.stock_movement_compensations;
create policy comps_select on public.stock_movement_compensations for select
  using (public.is_inventory_valuer(business_id));

drop policy if exists transfers_select on public.stock_transfers;
create policy transfers_select on public.stock_transfers for select using (
  public.is_inventory_valuer(business_id)
  or public.can_access_location(from_location_id)
  or public.can_access_location(to_location_id)
);

drop policy if exists transfer_receipts_select on public.stock_transfer_receipts;
create policy transfer_receipts_select on public.stock_transfer_receipts for select using (
  public.is_inventory_valuer(business_id)
  or exists (
    select 1 from public.stock_transfers t
    where t.id = transfer_id and public.can_access_location(t.to_location_id)
  )
);

drop policy if exists transfer_receipt_lines_select on public.stock_transfer_receipt_lines;
create policy transfer_receipt_lines_select on public.stock_transfer_receipt_lines for select using (
  public.is_inventory_valuer(business_id)
  or exists (
    select 1 from public.stock_transfer_receipts r
    join public.stock_transfers t on t.id = r.transfer_id
    where r.id = receipt_id and public.can_access_location(t.to_location_id)
  )
);

drop policy if exists opnames_select on public.stock_opnames;
create policy opnames_select on public.stock_opnames for select using (
  public.is_inventory_valuer(business_id) or public.can_access_location(location_id)
);

drop policy if exists inv_settings_select on public.inventory_settings;
create policy inv_settings_select on public.inventory_settings for select
  using (public.is_inventory_reader(business_id));
-- TIDAK ada write policy settings / business_state — hanya Owner RPC

drop policy if exists biz_state_select on public.inventory_business_state;
create policy biz_state_select on public.inventory_business_state for select
  using (public.is_inventory_reader(business_id));

drop policy if exists inv_requests_select on public.inventory_requests;
create policy inv_requests_select on public.inventory_requests for select using (
  public.is_inventory_valuer(business_id)
  or public.business_role(business_id) = 'purchasing'
  or public.can_access_location(source_location_id)
);

drop policy if exists pr_select on public.purchase_requests;
create policy pr_select on public.purchase_requests for select using (
  public.is_inventory_valuer(business_id) or public.business_role(business_id) = 'purchasing'
);
drop policy if exists po_select on public.purchase_orders;
create policy po_select on public.purchase_orders for select using (
  public.is_inventory_valuer(business_id) or public.business_role(business_id) = 'purchasing'
);

-- purchasing_tx_links: SELECT only — create/review via RPC
drop policy if exists ptx_select on public.purchasing_tx_links;
create policy ptx_select on public.purchasing_tx_links for select using (
  public.is_inventory_valuer(business_id) or public.business_role(business_id) = 'purchasing'
);
drop policy if exists ptx_insert_purchasing on public.purchasing_tx_links;
drop policy if exists ptx_update_review on public.purchasing_tx_links;

drop policy if exists receipts_select on public.inventory_receipts;
create policy receipts_select on public.inventory_receipts for select
  using (public.is_inventory_valuer(business_id));

drop policy if exists opening_sessions_select on public.inventory_opening_sessions;
create policy opening_sessions_select on public.inventory_opening_sessions for select
  using (public.is_inventory_valuer(business_id));
drop policy if exists opening_locks_select on public.inventory_opening_locks;
create policy opening_locks_select on public.inventory_opening_locks for select
  using (public.is_inventory_valuer(business_id));

-- Quantity RPCs
create or replace function public.list_inventory_quantities(p_business_id uuid)
returns table (
  item_id uuid, location_id uuid, sku text, item_name text, stock_unit text,
  location_code text, quantity numeric, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_inventory_reader(p_business_id) then raise exception 'forbidden'; end if;
  return query
  select b.item_id, b.location_id, i.sku, i.name, i.stock_unit, loc.code, b.quantity, b.updated_at
  from public.stock_balances b
  join public.inventory_items i on i.id = b.item_id
  join public.inventory_locations loc on loc.id = b.location_id
  where i.business_id = p_business_id
    and (public.is_inventory_valuer(p_business_id) or public.can_access_location(b.location_id));
end;
$$;

create or replace function public.list_lot_quantities(p_business_id uuid)
returns table (
  lot_id uuid, item_id uuid, location_id uuid, batch_number text,
  expiry_date date, expiry_unknown boolean, quantity numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_inventory_reader(p_business_id) then raise exception 'forbidden'; end if;
  return query
  select lb.lot_id, l.item_id, lb.location_id, l.batch_number, l.expiry_date, l.expiry_unknown, lb.quantity
  from public.stock_lot_balances lb
  join public.inventory_lots l on l.id = lb.lot_id
  where l.business_id = p_business_id
    and (public.is_inventory_valuer(p_business_id) or public.can_access_location(lb.location_id));
end;
$$;

create or replace function public.list_stock_movements_qty(
  p_business_id uuid, p_location_id uuid, p_limit int default 100
) returns table (
  id uuid, movement_group_id uuid, movement_type text, item_id uuid, lot_id uuid,
  from_location_id uuid, to_location_id uuid, quantity numeric,
  reference_type text, reference_id uuid, status text, acting_role text,
  posted_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_inventory_reader(p_business_id) then raise exception 'forbidden'; end if;
  if not (public.is_inventory_valuer(p_business_id) or public.can_access_location(p_location_id)) then
    raise exception 'forbidden location';
  end if;
  return query
  select m.id, m.movement_group_id, m.movement_type, m.item_id, m.lot_id,
         m.from_location_id, m.to_location_id, m.quantity, m.reference_type, m.reference_id,
         m.status, m.acting_role, m.posted_at, m.created_at
  from public.stock_movements m
  where m.business_id = p_business_id
    and (m.from_location_id = p_location_id or m.to_location_id = p_location_id)
  order by coalesce(m.posted_at, m.created_at) desc
  limit greatest(1, least(coalesce(p_limit,100), 500));
end;
$$;

create or replace function public.list_inventory_valuation(p_business_id uuid)
returns table (
  item_id uuid, location_id uuid, sku text, item_name text,
  quantity numeric, average_cost numeric, total_value numeric, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not public.is_inventory_valuer(p_business_id) then raise exception 'forbidden: valuation'; end if;
  return query
  select b.item_id, b.location_id, i.sku, i.name, b.quantity, b.average_cost, b.total_value, b.updated_at
  from public.stock_balances b
  join public.inventory_items i on i.id = b.item_id
  where i.business_id = p_business_id;
end;
$$;

create or replace function public.list_transfer_lines_qty(p_transfer_id uuid)
returns table (
  line_id uuid, item_id uuid, lot_id uuid, sku text, item_name text,
  sent_qty numeric, received_qty_total numeric, resolved_qty_total numeric,
  batch_code text, expiry_date date
) language plpgsql stable security definer set search_path = public as $$
declare v_t public.stock_transfers;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select * into v_t from public.stock_transfers where id = p_transfer_id;
  if not found then raise exception 'transfer tidak ditemukan'; end if;
  if not (
    public.is_inventory_valuer(v_t.business_id)
    or public.can_access_location(v_t.to_location_id)
    or public.can_access_location(v_t.from_location_id)
  ) then raise exception 'forbidden'; end if;
  return query
  select l.id, l.item_id, l.lot_id, i.sku, i.name,
         l.sent_qty, l.received_qty_total, l.resolved_qty_total, l.batch_code, l.expiry_date
  from public.stock_transfer_lines l
  join public.inventory_items i on i.id = l.item_id
  where l.transfer_id = p_transfer_id;
end;
$$;

revoke all on function public.list_inventory_quantities(uuid) from public, anon;
revoke all on function public.list_lot_quantities(uuid) from public, anon;
revoke all on function public.list_stock_movements_qty(uuid, uuid, int) from public, anon;
revoke all on function public.list_inventory_valuation(uuid) from public, anon;
revoke all on function public.list_transfer_lines_qty(uuid) from public, anon;
grant execute on function public.list_inventory_quantities(uuid) to authenticated;
grant execute on function public.list_lot_quantities(uuid) to authenticated;
grant execute on function public.list_stock_movements_qty(uuid, uuid, int) to authenticated;
grant execute on function public.list_inventory_valuation(uuid) to authenticated;
grant execute on function public.list_transfer_lines_qty(uuid) to authenticated;

COMMIT;
