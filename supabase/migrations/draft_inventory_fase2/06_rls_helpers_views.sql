-- ============================================================================
-- DRAFT 06 — RLS inventory + views quantity vs valuation
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–05
--
-- PENTING:
-- - Tidak mengubah policy legacy app_state / wallets / transactions
-- - Tidak mengubah business_role()
-- - Outlet jangan dapat SELECT langsung ke tabel ber-cost
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Helper: business_id dari location / item
-- ----------------------------------------------------------------------------
create or replace function public.inventory_location_business_id(p_location_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from public.inventory_locations where id = p_location_id;
$$;

create or replace function public.is_inventory_reader(p_business_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.business_role(p_business_id) in ('owner', 'admin')
    or public.has_permission(p_business_id, 'view_inventory', null)
    or public.has_assignment_role(
      p_business_id,
      array['forecasting_inventory','dapur','bar','operasional_samtaro']::text[]
    );
$$;

create or replace function public.is_inventory_valuer(p_business_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.business_role(p_business_id) in ('owner', 'admin')
    or public.has_permission(p_business_id, 'view_stock_value', null)
    or public.has_assignment_role(
      p_business_id,
      array['forecasting_inventory']::text[]
    );
$$;

create or replace function public.is_outlet_inventory_actor(p_business_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.has_active_assignment(p_business_id, 'dapur', p_location_id)
    or public.has_active_assignment(p_business_id, 'bar', p_location_id)
    or public.has_active_assignment(p_business_id, 'operasional_samtaro', p_location_id)
    or public.has_permission(p_business_id, 'receive_stock', p_location_id)
    or public.has_permission(p_business_id, 'opname_stock', p_location_id);
$$;

grant execute on function public.is_inventory_reader(uuid) to authenticated;
grant execute on function public.is_inventory_valuer(uuid) to authenticated;
grant execute on function public.is_outlet_inventory_actor(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Enable RLS
-- ----------------------------------------------------------------------------
alter table public.inventory_locations enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_locations enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_settings enable row level security;
alter table public.inventory_item_audit_log enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_lot_balances enable row level security;
alter table public.stock_opnames enable row level security;
alter table public.stock_opname_lines enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.waste_records enable row level security;
alter table public.inventory_productions enable row level security;
alter table public.inventory_production_lines enable row level security;
alter table public.inventory_opening_locks enable row level security;
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

-- ----------------------------------------------------------------------------
-- 3) Policies — locations / items (master)
-- ----------------------------------------------------------------------------
drop policy if exists inv_loc_select on public.inventory_locations;
create policy inv_loc_select on public.inventory_locations for select
  using (
    public.is_inventory_reader(business_id)
    and (
      public.is_inventory_valuer(business_id)
      or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
      or public.can_access_location(id)
      or code = 'IN_TRANSIT' -- boleh lihat konsep in-transit bila reader outlet terkait transfer
    )
  );

drop policy if exists inv_loc_write on public.inventory_locations;
create policy inv_loc_write on public.inventory_locations for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'manage_items', null)
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'manage_items', null)
  );

drop policy if exists inv_items_select on public.inventory_items;
create policy inv_items_select on public.inventory_items for select
  using (public.is_inventory_reader(business_id));

drop policy if exists inv_items_write on public.inventory_items;
create policy inv_items_write on public.inventory_items for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'manage_items', null)
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'manage_items', null)
  );

drop policy if exists inv_item_loc_select on public.inventory_item_locations;
create policy inv_item_loc_select on public.inventory_item_locations for select
  using (
    exists (
      select 1 from public.inventory_items i
      where i.id = item_id and public.is_inventory_reader(i.business_id)
    )
  );

drop policy if exists inv_item_loc_write on public.inventory_item_locations;
create policy inv_item_loc_write on public.inventory_item_locations for all
  using (
    exists (
      select 1 from public.inventory_items i
      where i.id = item_id
        and (
          public.business_role(i.business_id) = 'owner'
          or public.has_permission(i.business_id, 'manage_items', null)
        )
    )
  )
  with check (
    exists (
      select 1 from public.inventory_items i
      where i.id = item_id
        and (
          public.business_role(i.business_id) = 'owner'
          or public.has_permission(i.business_id, 'manage_items', null)
        )
    )
  );

-- Lots: reader boleh lihat metadata expiry (tanpa cost di view outlet)
drop policy if exists inv_lots_select on public.inventory_lots;
create policy inv_lots_select on public.inventory_lots for select
  using (public.is_inventory_reader(business_id));

drop policy if exists inv_lots_write on public.inventory_lots;
create policy inv_lots_write on public.inventory_lots for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  );

-- Settings: semua reader lihat; write Owner only
drop policy if exists inv_settings_select on public.inventory_settings;
create policy inv_settings_select on public.inventory_settings for select
  using (public.is_inventory_reader(business_id));

drop policy if exists inv_settings_write on public.inventory_settings;
create policy inv_settings_write on public.inventory_settings for all
  using (public.business_role(business_id) = 'owner')
  with check (public.business_role(business_id) = 'owner');

-- ----------------------------------------------------------------------------
-- 4) stock_balances / movements — BATASI akses cost
--    Outlet: JANGAN grant SELECT pada stock_balances (ada average_cost)
--    Valuer (owner/admin/forecasting): boleh SELECT balances
--    Outlet quantity lewat VIEW tanpa cost
-- ----------------------------------------------------------------------------
drop policy if exists stock_balances_select_valuer on public.stock_balances;
create policy stock_balances_select_valuer on public.stock_balances for select
  using (
    exists (
      select 1 from public.inventory_items i
      where i.id = item_id and public.is_inventory_valuer(i.business_id)
    )
  );

-- Tidak ada policy INSERT/UPDATE/DELETE untuk authenticated pada stock_balances
-- (hanya security definer functions)

drop policy if exists stock_lot_balances_select_valuer on public.stock_lot_balances;
create policy stock_lot_balances_select_valuer on public.stock_lot_balances for select
  using (
    exists (
      select 1
      from public.inventory_lots l
      where l.id = lot_id and public.is_inventory_valuer(l.business_id)
    )
  );

-- Movements: HANYA valuer yang SELECT langsung (ada unit_cost/total_value).
-- Outlet memakai list_stock_movements_qty() tanpa kolom cost.
drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select
  using (public.is_inventory_valuer(business_id));

drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements for insert
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
    or public.has_permission(business_id, 'opname_stock', coalesce(from_location_id, to_location_id))
    or public.has_permission(business_id, 'receive_stock', coalesce(to_location_id, from_location_id))
  );

-- Update hanya draft milik sendiri / forecasting (posted diblok trigger)
drop policy if exists stock_movements_update_draft on public.stock_movements;
create policy stock_movements_update_draft on public.stock_movements for update
  using (
    status in ('draft', 'pending_approval')
    and (
      public.business_role(business_id) = 'owner'
      or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
      or created_by = auth.uid()
    )
  )
  with check (
    status in ('draft', 'pending_approval', 'posted', 'rejected')
  );

-- ----------------------------------------------------------------------------
-- 5) Views — quantity (outlet) vs valuation (owner/admin/forecasting)
-- ----------------------------------------------------------------------------
create or replace view public.inventory_quantity_view
with (security_invoker = true)
as
select
  b.item_id,
  b.location_id,
  i.business_id,
  i.sku,
  i.name as item_name,
  i.stock_unit,
  loc.code as location_code,
  loc.name as location_name,
  b.quantity,
  b.updated_at
from public.stock_balances b
join public.inventory_items i on i.id = b.item_id
join public.inventory_locations loc on loc.id = b.location_id;

comment on view public.inventory_quantity_view is
  'Qty tanpa cost. Untuk dapur/bar/kasir/outlet. Jangan expose average_cost.';

-- Catatan: stock_balances RLS hanya valuer → outlet perlu path qty.
-- Solusi: fungsi security definer yang mengembalikan qty tanpa cost.
create or replace function public.list_inventory_quantities(p_business_id uuid)
returns table (
  item_id uuid,
  location_id uuid,
  sku text,
  item_name text,
  stock_unit text,
  location_code text,
  quantity numeric,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.item_id,
    b.location_id,
    i.sku,
    i.name,
    i.stock_unit,
    loc.code,
    b.quantity,
    b.updated_at
  from public.stock_balances b
  join public.inventory_items i on i.id = b.item_id
  join public.inventory_locations loc on loc.id = b.location_id
  where i.business_id = p_business_id
    and public.is_inventory_reader(p_business_id)
    and (
      public.is_inventory_valuer(p_business_id)
      or public.can_access_location(b.location_id)
    );
$$;

grant execute on function public.list_inventory_quantities(uuid) to authenticated;

create or replace view public.inventory_valuation_view
with (security_invoker = true)
as
select
  b.item_id,
  b.location_id,
  i.business_id,
  i.sku,
  i.name as item_name,
  i.stock_unit,
  loc.code as location_code,
  b.quantity,
  b.average_cost,
  b.total_value,
  b.updated_at
from public.stock_balances b
join public.inventory_items i on i.id = b.item_id
join public.inventory_locations loc on loc.id = b.location_id;

comment on view public.inventory_valuation_view is
  'Qty + average_cost + total_value. Hanya owner/admin/forecasting (via RLS stock_balances).';

-- Lot qty tanpa cost untuk outlet
create or replace function public.list_lot_quantities(p_business_id uuid)
returns table (
  lot_id uuid,
  item_id uuid,
  location_id uuid,
  batch_number text,
  expiry_date date,
  expiry_unknown boolean,
  quantity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lb.lot_id,
    l.item_id,
    lb.location_id,
    l.batch_number,
    l.expiry_date,
    l.expiry_unknown,
    lb.quantity
  from public.stock_lot_balances lb
  join public.inventory_lots l on l.id = lb.lot_id
  where l.business_id = p_business_id
    and public.is_inventory_reader(p_business_id)
    and (
      public.is_inventory_valuer(p_business_id)
      or public.can_access_location(lb.location_id)
    );
$$;

grant execute on function public.list_lot_quantities(uuid) to authenticated;

-- Histori movement tanpa cost untuk outlet
create or replace function public.list_stock_movements_qty(
  p_business_id uuid,
  p_location_id uuid,
  p_limit int default 100
)
returns table (
  id uuid,
  movement_group_id uuid,
  movement_type text,
  item_id uuid,
  lot_id uuid,
  from_location_id uuid,
  to_location_id uuid,
  quantity numeric,
  reference_type text,
  reference_id uuid,
  status text,
  acting_role text,
  posted_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id, m.movement_group_id, m.movement_type, m.item_id, m.lot_id,
    m.from_location_id, m.to_location_id, m.quantity,
    m.reference_type, m.reference_id, m.status, m.acting_role,
    m.posted_at, m.created_at
  from public.stock_movements m
  where m.business_id = p_business_id
    and public.is_inventory_reader(p_business_id)
    and (
      public.is_inventory_valuer(p_business_id)
      or (
        public.can_access_location(p_location_id)
        and (m.from_location_id = p_location_id or m.to_location_id = p_location_id)
      )
    )
  order by coalesce(m.posted_at, m.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

grant execute on function public.list_stock_movements_qty(uuid, uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) Opname / transfer / receipt policies (ringkas)
-- ----------------------------------------------------------------------------
drop policy if exists stock_opnames_select on public.stock_opnames;
create policy stock_opnames_select on public.stock_opnames for select
  using (
    public.is_inventory_valuer(business_id)
    or public.can_access_location(location_id)
  );

drop policy if exists stock_opnames_write on public.stock_opnames;
create policy stock_opnames_write on public.stock_opnames for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'opname_stock', location_id)
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'opname_stock', location_id)
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  );

drop policy if exists stock_opname_lines_all on public.stock_opname_lines;
create policy stock_opname_lines_all on public.stock_opname_lines for all
  using (
    exists (
      select 1 from public.stock_opnames o
      where o.id = opname_id
        and (
          public.is_inventory_valuer(o.business_id)
          or public.can_access_location(o.location_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.stock_opnames o
      where o.id = opname_id
        and (
          public.business_role(o.business_id) = 'owner'
          or public.has_permission(o.business_id, 'opname_stock', o.location_id)
          or public.has_assignment_role(o.business_id, array['forecasting_inventory']::text[])
        )
    )
  );

-- Transfer: create = forecasting; receive = receive_stock di tujuan (bukan forecasting atas nama outlet)
drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers for select
  using (
    public.is_inventory_valuer(business_id)
    or public.can_access_location(from_location_id)
    or public.can_access_location(to_location_id)
  );

drop policy if exists stock_transfers_insert on public.stock_transfers;
create policy stock_transfers_insert on public.stock_transfers for insert
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'create_transfer', null)
  );

drop policy if exists stock_transfers_update on public.stock_transfers;
create policy stock_transfers_update on public.stock_transfers for update
  using (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'create_transfer', null)
    or public.has_permission(business_id, 'receive_stock', to_location_id)
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'create_transfer', null)
    or public.has_permission(business_id, 'receive_stock', to_location_id)
  );

drop policy if exists stock_transfer_lines_all on public.stock_transfer_lines;
create policy stock_transfer_lines_all on public.stock_transfer_lines for all
  using (
    exists (
      select 1 from public.stock_transfers t
      where t.id = transfer_id
        and (
          public.is_inventory_valuer(t.business_id)
          or public.can_access_location(t.from_location_id)
          or public.can_access_location(t.to_location_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.stock_transfers t
      where t.id = transfer_id
        and (
          public.business_role(t.business_id) = 'owner'
          or public.has_permission(t.business_id, 'create_transfer', null)
          or public.has_permission(t.business_id, 'receive_stock', t.to_location_id)
        )
    )
  );

-- Admin read-only: covered by is_inventory_valuer; no insert policies for admin on movements/transfers

-- Purchasing: baca PR/kebutuhan; tulis link terbatas
drop policy if exists inv_requests_select on public.inventory_requests;
create policy inv_requests_select on public.inventory_requests for select
  using (
    public.is_inventory_valuer(business_id)
    or public.business_role(business_id) = 'purchasing'
    or public.can_access_location(source_location_id)
  );

drop policy if exists inv_requests_write on public.inventory_requests;
create policy inv_requests_write on public.inventory_requests for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'request_stock', source_location_id)
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'request_stock', source_location_id)
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  );

drop policy if exists pr_select on public.purchase_requests;
create policy pr_select on public.purchase_requests for select
  using (
    public.is_business_member(business_id)
    and (
      public.is_inventory_valuer(business_id)
      or public.business_role(business_id) = 'purchasing'
      or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
    )
  );

drop policy if exists pr_write on public.purchase_requests;
create policy pr_write on public.purchase_requests for all
  using (
    public.business_role(business_id) in ('owner', 'purchasing')
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  )
  with check (
    public.business_role(business_id) in ('owner', 'purchasing')
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  );

drop policy if exists po_select on public.purchase_orders;
create policy po_select on public.purchase_orders for select
  using (
    public.is_inventory_valuer(business_id)
    or public.business_role(business_id) = 'purchasing'
  );

drop policy if exists po_write on public.purchase_orders;
create policy po_write on public.purchase_orders for all
  using (public.business_role(business_id) in ('owner', 'purchasing'))
  with check (public.business_role(business_id) in ('owner', 'purchasing'));

drop policy if exists ptx_links_select on public.purchasing_tx_links;
create policy ptx_links_select on public.purchasing_tx_links for select
  using (
    public.is_inventory_valuer(business_id)
    or public.business_role(business_id) = 'purchasing'
  );

drop policy if exists ptx_links_write on public.purchasing_tx_links;
create policy ptx_links_write on public.purchasing_tx_links for all
  using (public.business_role(business_id) in ('owner', 'purchasing', 'admin'))
  with check (public.business_role(business_id) in ('owner', 'purchasing', 'admin'));

-- Receipts: forecasting write; admin/owner read
drop policy if exists inv_receipts_select on public.inventory_receipts;
create policy inv_receipts_select on public.inventory_receipts for select
  using (public.is_inventory_valuer(business_id));

drop policy if exists inv_receipts_write on public.inventory_receipts;
create policy inv_receipts_write on public.inventory_receipts for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'receive_to_warehouse', location_id)
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'receive_to_warehouse', location_id)
  );

-- Waste / productions / opening locks / audit / line tables: valuer read + role write
drop policy if exists waste_select on public.waste_records;
create policy waste_select on public.waste_records for select
  using (
    public.is_inventory_valuer(business_id)
    or public.can_access_location(location_id)
  );

drop policy if exists waste_write on public.waste_records;
create policy waste_write on public.waste_records for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
    or public.is_outlet_inventory_actor(business_id, location_id)
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
    or public.is_outlet_inventory_actor(business_id, location_id)
  );

drop policy if exists prod_select on public.inventory_productions;
create policy prod_select on public.inventory_productions for select
  using (public.is_inventory_valuer(business_id));

drop policy if exists prod_write on public.inventory_productions;
create policy prod_write on public.inventory_productions for all
  using (
    public.business_role(business_id) = 'owner'
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  )
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_assignment_role(business_id, array['forecasting_inventory']::text[])
  );

drop policy if exists opening_locks_select on public.inventory_opening_locks;
create policy opening_locks_select on public.inventory_opening_locks for select
  using (public.is_inventory_valuer(business_id));

drop policy if exists opening_locks_write on public.inventory_opening_locks;
create policy opening_locks_write on public.inventory_opening_locks for all
  using (public.business_role(business_id) = 'owner')
  with check (public.business_role(business_id) = 'owner');

drop policy if exists item_audit_select on public.inventory_item_audit_log;
create policy item_audit_select on public.inventory_item_audit_log for select
  using (public.is_inventory_valuer(business_id));

drop policy if exists item_audit_insert on public.inventory_item_audit_log;
create policy item_audit_insert on public.inventory_item_audit_log for insert
  with check (
    public.business_role(business_id) = 'owner'
    or public.has_permission(business_id, 'manage_items', null)
  );

-- Line-level policies (PR/PO/request/receipt/production) — select via parent membership
drop policy if exists pr_lines_all on public.purchase_request_lines;
create policy pr_lines_all on public.purchase_request_lines for all
  using (
    exists (
      select 1 from public.purchase_requests p
      where p.id = purchase_request_id and public.is_business_member(p.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.purchase_requests p
      where p.id = purchase_request_id
        and public.business_role(p.business_id) in ('owner', 'purchasing')
    )
  );

drop policy if exists po_lines_all on public.purchase_order_lines;
create policy po_lines_all on public.purchase_order_lines for all
  using (
    exists (
      select 1 from public.purchase_orders p
      where p.id = purchase_order_id
        and (
          public.is_inventory_valuer(p.business_id)
          or public.business_role(p.business_id) = 'purchasing'
        )
    )
  )
  with check (
    exists (
      select 1 from public.purchase_orders p
      where p.id = purchase_order_id
        and public.business_role(p.business_id) in ('owner', 'purchasing')
    )
  );

drop policy if exists inv_req_lines_all on public.inventory_request_lines;
create policy inv_req_lines_all on public.inventory_request_lines for all
  using (
    exists (
      select 1 from public.inventory_requests r
      where r.id = request_id
        and (
          public.is_inventory_valuer(r.business_id)
          or public.business_role(r.business_id) = 'purchasing'
          or public.can_access_location(r.source_location_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.inventory_requests r
      where r.id = request_id
        and (
          public.business_role(r.business_id) = 'owner'
          or public.has_permission(r.business_id, 'request_stock', r.source_location_id)
          or public.has_assignment_role(r.business_id, array['forecasting_inventory']::text[])
        )
    )
  );

drop policy if exists receipt_lines_all on public.inventory_receipt_lines;
create policy receipt_lines_all on public.inventory_receipt_lines for all
  using (
    exists (
      select 1 from public.inventory_receipts r
      where r.id = receipt_id and public.is_inventory_valuer(r.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.inventory_receipts r
      where r.id = receipt_id
        and (
          public.business_role(r.business_id) = 'owner'
          or public.has_permission(r.business_id, 'receive_to_warehouse', r.location_id)
        )
    )
  );

drop policy if exists prod_lines_all on public.inventory_production_lines;
create policy prod_lines_all on public.inventory_production_lines for all
  using (
    exists (
      select 1 from public.inventory_productions p
      where p.id = production_id and public.is_inventory_valuer(p.business_id)
    )
  )
  with check (
    exists (
      select 1 from public.inventory_productions p
      where p.id = production_id
        and (
          public.business_role(p.business_id) = 'owner'
          or public.has_assignment_role(p.business_id, array['forecasting_inventory']::text[])
        )
    )
  );

drop policy if exists purchasing_tx_select on public.purchasing_transactions;
create policy purchasing_tx_select on public.purchasing_transactions for select
  using (
    public.is_inventory_valuer(business_id)
    or public.business_role(business_id) = 'purchasing'
  );

drop policy if exists purchasing_tx_write on public.purchasing_transactions;
create policy purchasing_tx_write on public.purchasing_transactions for all
  using (public.business_role(business_id) in ('owner', 'purchasing', 'admin'))
  with check (public.business_role(business_id) in ('owner', 'purchasing', 'admin'));

-- ----------------------------------------------------------------------------
-- Catatan app-layer (self-approve opname)
-- ----------------------------------------------------------------------------
-- Egakkan di RPC approve_opname:
--   if approved_by = submitted_by then raise
--   if acting_role = forecasting_inventory and location.type = warehouse
--      and submitted_by = forecasting user → require owner approve

-- ----------------------------------------------------------------------------
-- ROLLBACK cuplikan: drop policy / view / function di 99
-- ----------------------------------------------------------------------------
