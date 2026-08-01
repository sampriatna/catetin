-- ============================================================================
-- DRAFT 04 — Opname / transfer / waste / production / receipts (revisi putaran 3)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–03
-- ============================================================================

BEGIN;

DO $$ BEGIN
  if to_regclass('public.stock_movements') is null then
    raise exception 'Preflight: stock_movements belum ada';
  end if;
END $$;

create table if not exists public.stock_opnames (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null,
  area text not null check (area in ('dapur','bar','campuran','gudang')),
  opname_date date not null default current_date,
  status text not null default 'draft' check (status in (
    'draft','submitted','recount_required','reviewed','approved','rejected'
  )),
  requires_approval boolean not null default false,
  requires_cost_approval boolean not null default false,
  snapshot_at timestamptz null,
  snapshot_last_movement_at timestamptz null,
  submitted_by uuid null references public.profiles(id) on delete set null,
  reviewed_by uuid null references public.profiles(id) on delete set null,
  approved_by uuid null references public.profiles(id) on delete set null,
  assignment_id uuid null,
  acting_role text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_by is null or submitted_by is null or approved_by <> submitted_by),
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete restrict
);
create unique index if not exists uq_stock_opnames_id_biz on public.stock_opnames (id, business_id);
drop trigger if exists trg_stock_opnames_updated on public.stock_opnames;
create trigger trg_stock_opnames_updated before update on public.stock_opnames
  for each row execute function public.inventory_set_updated_at();

create or replace function public.stock_opnames_guard_status()
returns trigger language plpgsql as $$
begin
  if old.status in ('submitted','approved') then
    if tg_op = 'DELETE' then raise exception 'opname % tidak boleh dihapus', old.status; end if;
    if coalesce(current_setting('inventory.opname_rpc', true), '') <> '1' then
      raise exception 'opname % hanya diubah lewat RPC domain', old.status;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stock_opnames_guard_status() from public, anon, authenticated;
drop trigger if exists trg_stock_opnames_guard on public.stock_opnames;
create trigger trg_stock_opnames_guard
  before update or delete on public.stock_opnames
  for each row execute function public.stock_opnames_guard_status();

create table if not exists public.stock_opname_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  opname_id uuid not null,
  item_id uuid not null,
  lot_id uuid null,
  system_qty numeric(18,6) not null default 0,
  physical_qty numeric(18,6) not null check (physical_qty >= 0),
  difference_qty numeric(18,6) not null default 0,
  difference_value numeric(18,4) null,
  unit_cost_override numeric(18,4) null, -- untuk positive adj tanpa avg cost
  reason text null,
  photo_url text null,
  requires_approval boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (opname_id, business_id)
    references public.stock_opnames (id, business_id) on delete cascade,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete restrict
);
create unique index if not exists uq_stock_opname_lines_item_lot
  on public.stock_opname_lines (opname_id, item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));

drop trigger if exists trg_opname_lines_lot on public.stock_opname_lines;
create trigger trg_opname_lines_lot
  before insert or update on public.stock_opname_lines
  for each row execute function public.inventory_line_validate_lot_trg();

-- Submitted lines tidak boleh diubah kecuali via RPC flag
create or replace function public.stock_opname_lines_guard()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from public.stock_opnames where id = coalesce(new.opname_id, old.opname_id);
  if v_status in ('submitted','approved')
     and coalesce(current_setting('inventory.opname_rpc', true), '') <> '1' then
    raise exception 'baris opname % tidak boleh diubah', v_status;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.stock_opname_lines_guard() from public, anon, authenticated;
drop trigger if exists trg_opname_lines_guard on public.stock_opname_lines;
create trigger trg_opname_lines_guard
  before update or delete on public.stock_opname_lines
  for each row execute function public.stock_opname_lines_guard();

-- Transfers
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  transfer_no text not null,
  from_location_id uuid not null,
  to_location_id uuid not null,
  status text not null default 'draft' check (status in (
    'draft','sent','partially_received','received','rejected','cancelled','variance_pending'
  )),
  created_by uuid null references public.profiles(id) on delete set null,
  created_assignment_id uuid null,
  sent_by uuid null references public.profiles(id) on delete set null,
  sent_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, transfer_no),
  check (from_location_id <> to_location_id),
  foreign key (from_location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (to_location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (created_assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete restrict
);
create unique index if not exists uq_stock_transfers_id_biz on public.stock_transfers (id, business_id);
drop trigger if exists trg_stock_transfers_updated on public.stock_transfers;
create trigger trg_stock_transfers_updated before update on public.stock_transfers
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  transfer_id uuid not null,
  item_id uuid not null,
  lot_id uuid null,
  sent_qty numeric(18,6) not null check (sent_qty > 0),
  received_qty_total numeric(18,6) not null default 0,
  resolved_qty_total numeric(18,6) not null default 0,
  unit_cost numeric(18,4) null,
  batch_code text null,
  expiry_date date null,
  notes text null,
  foreign key (transfer_id, business_id)
    references public.stock_transfers (id, business_id) on delete cascade,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete restrict
);
create unique index if not exists uq_stock_transfer_lines_id_biz
  on public.stock_transfer_lines (id, business_id);
create unique index if not exists uq_stock_transfer_lines_item_lot
  on public.stock_transfer_lines (transfer_id, item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid));

drop trigger if exists trg_transfer_lines_lot on public.stock_transfer_lines;
create trigger trg_transfer_lines_lot
  before insert or update on public.stock_transfer_lines
  for each row execute function public.inventory_line_validate_lot_trg();

create or replace function public.stock_transfer_lines_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('inventory.transfer_rpc', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.sent_qty is distinct from old.sent_qty
       or new.item_id is distinct from old.item_id
       or new.lot_id is distinct from old.lot_id
       or new.unit_cost is distinct from old.unit_cost
       or new.transfer_id is distinct from old.transfer_id then
      raise exception 'field kirim transfer line hanya diubah lewat RPC send';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stock_transfer_lines_guard() from public, anon, authenticated;
drop trigger if exists trg_stock_transfer_lines_guard on public.stock_transfer_lines;
create trigger trg_stock_transfer_lines_guard
  before update on public.stock_transfer_lines
  for each row execute function public.stock_transfer_lines_guard();

create table if not exists public.stock_transfer_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  transfer_id uuid not null,
  received_by uuid null references public.profiles(id) on delete set null,
  received_assignment_id uuid null,
  acting_role text null,
  received_at timestamptz not null default now(),
  notes text null,
  photo_url text null,
  movement_group_id uuid null,
  foreign key (transfer_id, business_id)
    references public.stock_transfers (id, business_id) on delete cascade,
  foreign key (received_assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete restrict
);
create unique index if not exists uq_stock_transfer_receipts_id_biz
  on public.stock_transfer_receipts (id, business_id);

create table if not exists public.stock_transfer_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  receipt_id uuid not null,
  transfer_line_id uuid not null,
  received_qty numeric(18,6) not null check (received_qty > 0),
  variance_reason text null,
  photo_url text null,
  unique (receipt_id, transfer_line_id),
  foreign key (receipt_id, business_id)
    references public.stock_transfer_receipts (id, business_id) on delete cascade,
  foreign key (transfer_line_id, business_id)
    references public.stock_transfer_lines (id, business_id) on delete restrict
);

-- Resolusi sisa IN_TRANSIT
create table if not exists public.stock_transfer_variance_resolutions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  transfer_id uuid not null,
  transfer_line_id uuid not null,
  resolution text not null check (resolution in (
    'received_later','returned_to_source','damaged','shrinkage','adjustment_approved'
  )),
  quantity numeric(18,6) not null check (quantity > 0),
  reason text null,
  movement_group_id uuid null,
  created_by uuid null references public.profiles(id) on delete set null,
  assignment_id uuid null,
  created_at timestamptz not null default now(),
  foreign key (transfer_id, business_id)
    references public.stock_transfers (id, business_id) on delete restrict,
  foreign key (transfer_line_id, business_id)
    references public.stock_transfer_lines (id, business_id) on delete restrict,
  foreign key (assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete restrict
);

create or replace function public.inventory_in_transit_location_id(p_business_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.inventory_locations
  where business_id = p_business_id and code = 'IN_TRANSIT' and is_system limit 1;
$$;
revoke all on function public.inventory_in_transit_location_id(uuid) from public, anon, authenticated;

create table if not exists public.waste_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null,
  item_id uuid not null,
  lot_id uuid null,
  movement_id uuid null,
  waste_type text not null check (waste_type in ('waste','shrinkage','damaged','expired')),
  quantity numeric(18,6) not null check (quantity > 0),
  unit_cost numeric(18,4) null,
  reason text null,
  photo_url text null,
  created_by uuid null references public.profiles(id) on delete set null,
  assignment_id uuid null,
  acting_role text null,
  created_at timestamptz not null default now(),
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete restrict,
  foreign key (movement_id, business_id)
    references public.stock_movements (id, business_id) on delete restrict,
  foreign key (assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete restrict
);
drop trigger if exists trg_waste_lot on public.waste_records;
create trigger trg_waste_lot before insert or update on public.waste_records
  for each row execute function public.inventory_line_validate_lot_trg();

create table if not exists public.inventory_productions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null,
  production_date date not null default current_date,
  notes text null,
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  movement_group_id uuid null,
  created_by uuid null references public.profiles(id) on delete set null,
  assignment_id uuid null,
  created_at timestamptz not null default now(),
  posted_at timestamptz null,
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete restrict
);
create unique index if not exists uq_inventory_productions_id_biz
  on public.inventory_productions (id, business_id);

create table if not exists public.inventory_production_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  production_id uuid not null,
  line_type text not null check (line_type in (
    'production_consumption','production_output','waste','shrinkage'
  )),
  item_id uuid not null,
  lot_id uuid null,
  quantity numeric(18,6) not null check (quantity > 0),
  unit_cost numeric(18,4) null,
  expiry_date date null,
  expiry_unknown boolean not null default false,
  notes text null,
  foreign key (production_id, business_id)
    references public.inventory_productions (id, business_id) on delete cascade,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete restrict
);
drop trigger if exists trg_prod_lines_lot on public.inventory_production_lines;
create trigger trg_prod_lines_lot before insert or update on public.inventory_production_lines
  for each row execute function public.inventory_line_validate_lot_trg();

create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null,
  receipt_no text not null,
  supplier_id uuid null,
  status text not null default 'draft' check (status in (
    'draft','cost_pending','ready_to_post','posted','cancelled'
  )),
  purchase_request_id uuid null,
  purchase_order_id uuid null,
  purchasing_tx_link_id uuid null,
  notes text null,
  locked boolean not null default false,
  created_by uuid null references public.profiles(id) on delete set null,
  assignment_id uuid null,
  posted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, receipt_no),
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (supplier_id, business_id)
    references public.suppliers (id, business_id) on delete restrict,
  foreign key (assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete restrict
);
create unique index if not exists uq_inventory_receipts_id_biz on public.inventory_receipts (id, business_id);
drop trigger if exists trg_inventory_receipts_updated on public.inventory_receipts;
create trigger trg_inventory_receipts_updated before update on public.inventory_receipts
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  receipt_id uuid not null,
  item_id uuid not null,
  lot_id uuid null,
  quantity numeric(18,6) not null check (quantity > 0),
  unit_cost numeric(18,4) null,
  batch_number text null,
  expiry_date date null,
  expiry_unknown boolean not null default false,
  notes text null,
  foreign key (receipt_id, business_id)
    references public.inventory_receipts (id, business_id) on delete cascade,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete restrict
);
drop trigger if exists trg_receipt_lines_lot on public.inventory_receipt_lines;
create trigger trg_receipt_lines_lot before insert or update on public.inventory_receipt_lines
  for each row execute function public.inventory_line_validate_lot_trg();

COMMIT;
