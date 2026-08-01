-- ============================================================================
-- DRAFT 02 — Master: locations, items, lots, suppliers, units, settings, go-live
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01
-- ============================================================================

BEGIN;

-- Preflight
DO $$
BEGIN
  if to_regclass('public.member_assignments') is null then
    raise exception 'Preflight: member_assignments belum ada (jalankan 01 dulu)';
  end if;
END $$;

-- ============================================================================
-- suppliers
-- ============================================================================
create table if not exists public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  code         text null,
  name         text not null,
  phone        text null,
  notes        text null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, name)
);

create unique index if not exists uq_suppliers_id_biz on public.suppliers (id, business_id);

drop trigger if exists trg_suppliers_updated on public.suppliers;
create trigger trg_suppliers_updated
  before update on public.suppliers
  for each row execute function public.inventory_set_updated_at();

-- ============================================================================
-- units + conversions
-- ============================================================================
create table if not exists public.units (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  code         text not null,
  name         text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (business_id, code)
);

create unique index if not exists uq_units_id_biz on public.units (id, business_id);

create table if not exists public.inventory_locations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  code         text not null,
  name         text not null,
  type         text not null check (type in ('warehouse', 'outlet', 'system')),
  outlet_code  text null,
  is_system    boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, code)
);

create unique index if not exists uq_inventory_locations_id_biz
  on public.inventory_locations (id, business_id);

drop trigger if exists trg_inventory_locations_updated on public.inventory_locations;
create trigger trg_inventory_locations_updated
  before update on public.inventory_locations
  for each row execute function public.inventory_set_updated_at();

-- FK location pada assignments
alter table public.member_assignments
  drop constraint if exists member_assignments_location_biz_fkey;

alter table public.member_assignments
  add constraint member_assignments_location_biz_fkey
  foreign key (location_id, business_id)
  references public.inventory_locations (id, business_id)
  on delete restrict;

-- INTERNAL: seed lokasi (TIDAK di-grant; TIDAK dipanggil di draft ini)
create or replace function public.ensure_fnb_inventory_locations(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_locations
    (business_id, code, name, type, outlet_code, is_system, is_active)
  values
    (p_business_id, 'GUDANG', 'Gudang Pusat', 'warehouse', null, false, true),
    (p_business_id, 'KBU', 'KBU', 'outlet', 'KBU', false, true),
    (p_business_id, 'KSM', 'Kisamen', 'outlet', 'KSM', false, true),
    (p_business_id, 'SMT', 'Samtaro', 'outlet', 'SMT', false, true),
    (p_business_id, 'IN_TRANSIT', 'In Transit', 'system', null, true, true)
  on conflict (business_id, code) do update
    set name = excluded.name,
        type = excluded.type,
        outlet_code = excluded.outlet_code,
        is_system = excluded.is_system,
        is_active = true,
        updated_at = now();
end;
$$;

revoke all on function public.ensure_fnb_inventory_locations(uuid) from public, anon, authenticated;

create or replace function public.can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.inventory_locations loc
    where loc.id = p_location_id
      and loc.is_active
      and (
        public.business_role(loc.business_id) = 'owner'
        or public.business_role(loc.business_id) = 'admin'
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

-- ============================================================================
-- inventory_items
-- ============================================================================
create table if not exists public.inventory_items (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses(id) on delete cascade,
  sku                    text not null,
  qr_code                text null,
  name                   text not null,
  category               text null,
  stock_unit_id          uuid null, -- FK units setelah units ada
  stock_unit             text not null, -- kode satuan dasar (denormalized readable)
  purchase_unit          text null,
  conversion_rate        numeric(18,6) not null default 1 check (conversion_rate > 0),
  tracks_expiry          boolean not null default false,
  tracks_batch           boolean not null default false,
  expiry_mode            text not null default 'none'
                         check (expiry_mode in ('none', 'optional', 'required')),
  default_storage_area   text null
                         check (
                           default_storage_area is null
                           or default_storage_area in ('dapur', 'bar', 'gudang')
                         ),
  allowed_usage_areas    text[] not null default '{}',
  min_stock              numeric(18,6) null,
  target_stock           numeric(18,6) null,
  is_semi_finished       boolean not null default false,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (business_id, sku),
  constraint inventory_items_usage_areas_check check (
    allowed_usage_areas <@ array['dapur', 'bar', 'gudang']::text[]
  )
);

create unique index if not exists uq_inventory_items_id_biz
  on public.inventory_items (id, business_id);

alter table public.inventory_items
  drop constraint if exists inventory_items_stock_unit_biz_fkey;

alter table public.inventory_items
  add constraint inventory_items_stock_unit_biz_fkey
  foreign key (stock_unit_id, business_id)
  references public.units (id, business_id)
  on delete set null;

drop trigger if exists trg_inventory_items_updated on public.inventory_items;
create trigger trg_inventory_items_updated
  before update on public.inventory_items
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.item_unit_conversions (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  item_id          uuid not null,
  from_unit_id     uuid not null,
  to_unit_id       uuid not null, -- biasanya stock unit
  factor           numeric(18,6) not null check (factor > 0),
  notes            text null,
  created_at       timestamptz not null default now(),
  unique (item_id, from_unit_id, to_unit_id),
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete cascade,
  foreign key (from_unit_id, business_id)
    references public.units (id, business_id) on delete restrict,
  foreign key (to_unit_id, business_id)
    references public.units (id, business_id) on delete restrict
);

comment on table public.item_unit_conversions is
  'Contoh: 1 karton = 12 pcs (factor 12 ke stock_unit pcs). Ledger selalu stock_unit.';

create table if not exists public.inventory_item_locations (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id) on delete cascade,
  item_id                 uuid not null,
  location_id             uuid not null,
  min_stock_override      numeric(18,6) null,
  target_stock_override   numeric(18,6) null,
  is_enabled              boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (item_id, location_id),
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete cascade,
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete cascade
);

drop trigger if exists trg_inventory_item_locations_updated on public.inventory_item_locations;
create trigger trg_inventory_item_locations_updated
  before update on public.inventory_item_locations
  for each row execute function public.inventory_set_updated_at();

-- ============================================================================
-- lots (cost column — outlet tidak boleh SELECT langsung; lihat 06)
-- ============================================================================
create table if not exists public.inventory_lots (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  item_id            uuid not null,
  batch_number       text null,
  expiry_date        date null,
  expiry_unknown     boolean not null default false,
  received_at        timestamptz not null default now(),
  source_type        text null,
  source_id          uuid null,
  initial_unit_cost  numeric(18,4) null,
  created_at         timestamptz not null default now(),
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  check (
    (expiry_unknown = true and expiry_date is null)
    or (expiry_unknown = false)
  )
);

create unique index if not exists uq_inventory_lots_id_biz
  on public.inventory_lots (id, business_id);

create index if not exists idx_inventory_lots_expiry
  on public.inventory_lots (business_id, expiry_date)
  where expiry_date is not null and not expiry_unknown;

-- ============================================================================
-- settings + business go-live
-- ============================================================================
create table if not exists public.inventory_settings (
  business_id                    uuid primary key
                                 references public.businesses(id) on delete cascade,
  opname_variance_pct            numeric(8,4) not null default 5,
  opname_variance_value_idr      bigint not null default 100000,
  dead_stock_days                int not null default 30,
  expiry_warn_days               int not null default 14,
  expiry_near_days               int not null default 7,
  expiry_critical_days           int not null default 3,
  po_required_min_amount_idr     bigint null, -- FINAL: NULL; PO by proses formal
  draft_archive_days             int not null default 30,
  draft_purge_days               int not null default 90,
  updated_by                     uuid null references public.profiles(id) on delete set null,
  updated_at                     timestamptz not null default now()
);

create table if not exists public.inventory_business_state (
  business_id     uuid primary key references public.businesses(id) on delete cascade,
  -- sandbox | uat | go_live
  lifecycle       text not null default 'sandbox'
                  check (lifecycle in ('sandbox', 'uat', 'go_live')),
  go_live_at      timestamptz null,
  go_live_by      uuid null references public.profiles(id) on delete set null,
  allow_negative  boolean not null default true, -- setelah go_live dipaksa false oleh trigger/RPC
  updated_at      timestamptz not null default now()
);

comment on table public.inventory_business_state is
  'Go-live level bisnis. Sebelum semua lokasi opening locked + UAT: jangan post movement operasional produksi. Opening produksi TIDAK di PR ini.';

create or replace function public.inventory_is_go_live(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.inventory_business_state s
    where s.business_id = p_business_id and s.lifecycle = 'go_live'
  );
$$;

revoke all on function public.inventory_is_go_live(uuid) from public, anon, authenticated;
grant execute on function public.inventory_is_go_live(uuid) to authenticated;

create table if not exists public.inventory_opening_locks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  location_id     uuid not null,
  cutoff_at       timestamptz not null,
  locked_at       timestamptz null,
  locked_by       uuid null references public.profiles(id) on delete set null,
  status          text not null default 'open'
                  check (status in ('open', 'locked')),
  notes           text null,
  unique (business_id, location_id),
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict
);

create table if not exists public.inventory_item_audit_log (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  item_id      uuid not null,
  action       text not null,
  before_data  jsonb null,
  after_data   jsonb null,
  changed_by   uuid null references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete cascade
);

-- INTERNAL lookup location — tidak di-grant
create or replace function public._location_id_for_outlet(
  p_business_id uuid,
  p_outlet text
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.inventory_locations
  where business_id = p_business_id
    and (outlet_code = p_outlet or code = p_outlet)
    and is_active
    and type = 'outlet'
  limit 1;
$$;

revoke all on function public._location_id_for_outlet(uuid, text) from public, anon, authenticated;

COMMIT;
