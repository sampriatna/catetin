-- ============================================================================
-- DRAFT 02 — Master data (revisi putaran 3)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01
-- ============================================================================

BEGIN;

DO $$ BEGIN
  if to_regclass('public.member_assignments') is null then
    raise exception 'Preflight: member_assignments belum ada';
  end if;
END $$;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text null,
  name text not null,
  phone text null,
  notes text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);
create unique index if not exists uq_suppliers_id_biz on public.suppliers (id, business_id);
drop trigger if exists trg_suppliers_updated on public.suppliers;
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, code)
);
create unique index if not exists uq_units_id_biz on public.units (id, business_id);

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('warehouse','outlet','system')),
  outlet_code text null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, code)
);
create unique index if not exists uq_inventory_locations_id_biz
  on public.inventory_locations (id, business_id);
drop trigger if exists trg_inventory_locations_updated on public.inventory_locations;
create trigger trg_inventory_locations_updated before update on public.inventory_locations
  for each row execute function public.inventory_set_updated_at();

-- Assignment → location: RESTRICT (jangan SET NULL composite)
alter table public.member_assignments
  drop constraint if exists member_assignments_location_biz_fkey;
alter table public.member_assignments
  add constraint member_assignments_location_biz_fkey
  foreign key (location_id, business_id)
  references public.inventory_locations (id, business_id)
  on delete restrict;

create or replace function public.ensure_fnb_inventory_locations(p_business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.inventory_locations
    (business_id, code, name, type, outlet_code, is_system, is_active)
  values
    (p_business_id,'GUDANG','Gudang Pusat','warehouse',null,false,true),
    (p_business_id,'KBU','KBU','outlet','KBU',false,true),
    (p_business_id,'KSM','Kisamen','outlet','KSM',false,true),
    (p_business_id,'SMT','Samtaro','outlet','SMT',false,true),
    (p_business_id,'IN_TRANSIT','In Transit','system',null,true,true)
  on conflict (business_id, code) do update set
    name = excluded.name, type = excluded.type, outlet_code = excluded.outlet_code,
    is_system = excluded.is_system, is_active = true, updated_at = now();
end;
$$;
revoke all on function public.ensure_fnb_inventory_locations(uuid) from public, anon, authenticated;

create or replace function public.can_access_location(p_location_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.inventory_locations loc
    where loc.id = p_location_id and loc.is_active and (
      public.business_role(loc.business_id) in ('owner','admin')
      or public.has_assignment_role(loc.business_id, array['forecasting_inventory']::text[])
      or public.has_active_assignment(loc.business_id, null, loc.id)
      or (
        loc.outlet_code = 'SMT'
        and public.has_assignment_role(loc.business_id, array['operasional_samtaro']::text[])
      )
    )
  );
$$;
revoke all on function public.can_access_location(uuid) from public, anon, authenticated;
grant execute on function public.can_access_location(uuid) to authenticated;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sku text not null,
  qr_code text null,
  name text not null,
  category text null,
  -- Canonical unit = stock_unit_id; stock_unit text di-sync dari units.code
  stock_unit_id uuid not null,
  stock_unit text not null,
  tracks_expiry boolean not null default false,
  tracks_batch boolean not null default false,
  expiry_mode text not null default 'none'
    check (expiry_mode in ('none','optional','required')),
  default_storage_area text null
    check (default_storage_area is null or default_storage_area in ('dapur','bar','gudang')),
  allowed_usage_areas text[] not null default '{}',
  min_stock numeric(18,6) null,
  target_stock numeric(18,6) null,
  is_semi_finished boolean not null default false,
  is_active boolean not null default true,
  -- Deprecated: gunakan item_unit_conversions
  purchase_unit text null,
  conversion_rate numeric(18,6) null check (conversion_rate is null or conversion_rate > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku),
  constraint inventory_items_usage_areas_check check (
    allowed_usage_areas <@ array['dapur','bar','gudang']::text[]
  ),
  foreign key (stock_unit_id, business_id)
    references public.units (id, business_id) on delete restrict
);
create unique index if not exists uq_inventory_items_id_biz on public.inventory_items (id, business_id);

-- Sync stock_unit text dari units.code
create or replace function public.inventory_items_sync_stock_unit()
returns trigger language plpgsql as $$
declare v_code text;
begin
  select code into v_code from public.units
  where id = new.stock_unit_id and business_id = new.business_id;
  if v_code is null then raise exception 'stock_unit_id tidak valid'; end if;
  new.stock_unit := v_code;
  return new;
end;
$$;
revoke all on function public.inventory_items_sync_stock_unit() from public, anon, authenticated;
drop trigger if exists trg_inventory_items_sync_unit on public.inventory_items;
create trigger trg_inventory_items_sync_unit
  before insert or update of stock_unit_id, business_id, stock_unit
  on public.inventory_items
  for each row execute function public.inventory_items_sync_stock_unit();

drop trigger if exists trg_inventory_items_updated on public.inventory_items;
create trigger trg_inventory_items_updated before update on public.inventory_items
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.item_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null,
  from_unit_id uuid not null,
  to_unit_id uuid not null,
  factor numeric(18,6) not null check (factor > 0),
  notes text null,
  created_at timestamptz not null default now(),
  unique (item_id, from_unit_id, to_unit_id),
  foreign key (item_id, business_id) references public.inventory_items (id, business_id) on delete cascade,
  foreign key (from_unit_id, business_id) references public.units (id, business_id) on delete restrict,
  foreign key (to_unit_id, business_id) references public.units (id, business_id) on delete restrict
);

create table if not exists public.inventory_item_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null,
  location_id uuid not null,
  min_stock_override numeric(18,6) null,
  target_stock_override numeric(18,6) null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, location_id),
  foreign key (item_id, business_id) references public.inventory_items (id, business_id) on delete cascade,
  foreign key (location_id, business_id) references public.inventory_locations (id, business_id) on delete cascade
);
drop trigger if exists trg_inventory_item_locations_updated on public.inventory_item_locations;
create trigger trg_inventory_item_locations_updated before update on public.inventory_item_locations
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null,
  batch_number text null,
  expiry_date date null,
  expiry_unknown boolean not null default false,
  received_at timestamptz not null default now(),
  source_type text null,
  source_id uuid null,
  initial_unit_cost numeric(18,4) null,
  created_at timestamptz not null default now(),
  foreign key (item_id, business_id) references public.inventory_items (id, business_id) on delete restrict,
  check ((expiry_unknown = true and expiry_date is null) or (expiry_unknown = false))
);
create unique index if not exists uq_inventory_lots_id_biz on public.inventory_lots (id, business_id);
create index if not exists idx_inventory_lots_expiry
  on public.inventory_lots (business_id, expiry_date)
  where expiry_date is not null and not expiry_unknown;

-- Reusable lot/item validator
create or replace function public.inventory_validate_item_lot(
  p_business_id uuid, p_item_id uuid, p_lot_id uuid
) returns void language plpgsql as $$
declare v_lot_item uuid;
begin
  if p_lot_id is null then return; end if;
  select item_id into v_lot_item from public.inventory_lots
  where id = p_lot_id and business_id = p_business_id;
  if v_lot_item is null then raise exception 'lot tidak valid untuk business'; end if;
  if v_lot_item is distinct from p_item_id then
    raise exception 'lot tidak cocok dengan item';
  end if;
end;
$$;
revoke all on function public.inventory_validate_item_lot(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.inventory_line_validate_lot_trg()
returns trigger language plpgsql as $$
begin
  perform public.inventory_validate_item_lot(new.business_id, new.item_id, new.lot_id);
  return new;
end;
$$;
revoke all on function public.inventory_line_validate_lot_trg() from public, anon, authenticated;

create table if not exists public.inventory_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  opname_variance_pct numeric(8,4) not null default 5 check (opname_variance_pct >= 0),
  opname_variance_value_idr bigint not null default 100000 check (opname_variance_value_idr >= 0),
  dead_stock_days int not null default 30 check (dead_stock_days > 0),
  expiry_warn_days int not null default 14,
  expiry_near_days int not null default 7,
  expiry_critical_days int not null default 3,
  po_required_min_amount_idr bigint null,
  draft_archive_days int not null default 30 check (draft_archive_days > 0),
  draft_purge_days int not null default 90,
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (expiry_warn_days >= expiry_near_days),
  check (expiry_near_days >= expiry_critical_days),
  check (expiry_critical_days >= 0),
  check (draft_purge_days >= draft_archive_days)
);

create table if not exists public.inventory_business_state (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  lifecycle text not null default 'sandbox'
    check (lifecycle in ('sandbox','uat','go_live')),
  go_live_at timestamptz null,
  go_live_by uuid null references public.profiles(id) on delete set null,
  allow_negative boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.inventory_is_go_live(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.inventory_business_state s
    where s.business_id = p_business_id and s.lifecycle = 'go_live'
  );
$$;
revoke all on function public.inventory_is_go_live(uuid) from public, anon, authenticated;
grant execute on function public.inventory_is_go_live(uuid) to authenticated;

-- Opening session (bukan post berulang bebas)
create table if not exists public.inventory_opening_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  session_key text not null,
  cutoff_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open','validated','posted','cancelled')),
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  posted_at timestamptz null,
  unique (business_id, session_key)
);
create unique index if not exists uq_opening_sessions_id_biz
  on public.inventory_opening_sessions (id, business_id);

create table if not exists public.inventory_opening_session_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  session_id uuid not null,
  location_id uuid not null,
  item_id uuid not null,
  lot_id uuid null,
  quantity numeric(18,6) not null check (quantity > 0),
  unit_cost numeric(18,4) not null,
  batch_number text null,
  expiry_date date null,
  expiry_unknown boolean not null default false,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  foreign key (session_id, business_id)
    references public.inventory_opening_sessions (id, business_id) on delete cascade,
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete restrict,
  unique (session_id, idempotency_key)
);

create unique index if not exists uq_opening_session_lines_item_lot
  on public.inventory_opening_session_lines (
    session_id, location_id, item_id,
    coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.inventory_opening_locks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null,
  opening_session_id uuid null,
  cutoff_at timestamptz not null,
  locked_at timestamptz null,
  locked_by uuid null references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open','locked')),
  notes text null,
  unique (business_id, location_id),
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (opening_session_id, business_id)
    references public.inventory_opening_sessions (id, business_id) on delete restrict
);

create table if not exists public.inventory_item_audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null,
  action text not null,
  before_data jsonb null,
  after_data jsonb null,
  changed_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict
);

create or replace function public._location_id_for_outlet(p_business_id uuid, p_outlet text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.inventory_locations
  where business_id = p_business_id
    and (outlet_code = p_outlet or code = p_outlet)
    and is_active and type = 'outlet'
  limit 1;
$$;
revoke all on function public._location_id_for_outlet(uuid, text) from public, anon, authenticated;

COMMIT;
