-- ============================================================================
-- DRAFT 02 — Locations, items, lots, settings
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01_roles_and_member_assignments.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) inventory_locations
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_locations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  code         text not null,
  name         text not null,
  type         text not null
               check (type in ('warehouse', 'outlet', 'system')),
  outlet_code  text null,
  is_system    boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, code)
);

comment on table public.inventory_locations is
  'Lokasi stok F&B: GUDANG, KBU, KSM, SMT, plus lokasi sistem IN_TRANSIT.';

create index if not exists idx_inventory_locations_biz
  on public.inventory_locations (business_id);

drop trigger if exists trg_inventory_locations_updated on public.inventory_locations;
create trigger trg_inventory_locations_updated
  before update on public.inventory_locations
  for each row execute function public.set_updated_at();

-- FK location pada member_assignments (ditunda dari 01)
alter table public.member_assignments
  drop constraint if exists member_assignments_location_id_fkey;

alter table public.member_assignments
  add constraint member_assignments_location_id_fkey
  foreign key (location_id)
  references public.inventory_locations(id)
  on delete set null;

-- ----------------------------------------------------------------------------
-- 2) Helper seed lokasi F&B (fungsi saja — TIDAK auto-seed produksi)
--    Pemanggilan: select public.ensure_fnb_inventory_locations('<biz-uuid>');
--    Hanya setelah Owner setuju & target business dikonfirmasi.
-- ----------------------------------------------------------------------------
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
    (p_business_id, 'GUDANG',     'Gudang Pusat', 'warehouse', null,  false, true),
    (p_business_id, 'KBU',        'KBU',          'outlet',    'KBU', false, true),
    (p_business_id, 'KSM',        'Kisamen',      'outlet',    'KSM', false, true),
    (p_business_id, 'SMT',        'Samtaro',      'outlet',    'SMT', false, true),
    (p_business_id, 'IN_TRANSIT', 'In Transit',   'system',    null,  true,  true)
  on conflict (business_id, code) do update
    set name = excluded.name,
        type = excluded.type,
        outlet_code = excluded.outlet_code,
        is_system = excluded.is_system,
        is_active = true,
        updated_at = now();
end;
$$;

-- JANGAN panggil ensure_fnb_inventory_locations di migration ini.
-- Contoh (sandbox saja):
--   select public.ensure_fnb_inventory_locations('e23ed572-234c-4995-acad-fa6bff7c58d2');

-- ----------------------------------------------------------------------------
-- 3) can_access_location — implementasi penuh
-- ----------------------------------------------------------------------------
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
        or (
          public.business_role(loc.business_id) = 'admin'
          and public.has_permission(loc.business_id, 'view_inventory', loc.id)
        )
        or public.has_assignment_role(
          loc.business_id,
          array['forecasting_inventory']::text[]
        )
        or public.has_active_assignment(loc.business_id, null, loc.id)
        -- operasional_samtaro: hanya SMT
        or (
          loc.outlet_code = 'SMT'
          and public.has_assignment_role(
            loc.business_id,
            array['operasional_samtaro']::text[]
          )
        )
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- 4) inventory_items
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_items (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses(id) on delete cascade,
  sku                    text not null,
  qr_code                text null,
  name                   text not null,
  category               text null,
  stock_unit             text not null,
  purchase_unit          text null,
  conversion_rate        numeric(18,6) not null default 1
                         check (conversion_rate > 0),
  tracks_expiry          boolean not null default false,
  tracks_batch           boolean not null default false,
  expiry_mode            text not null default 'none'
                         check (expiry_mode in ('none', 'optional', 'required')),
  -- default_storage_area: dapur | bar | gudang — BUKAN 'campuran'
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
  unique (business_id, sku)
);

comment on column public.inventory_items.default_storage_area is
  'Area simpan default (dapur/bar/gudang). Jangan pakai campuran; multi-area via allowed_usage_areas + saldo per location.';

comment on column public.inventory_items.allowed_usage_areas is
  'Contoh: {bar,dapur}. Satu SKU bisa dipakai beberapa area; stok fisik tetap per location_id.';

comment on column public.inventory_items.qr_code is
  'Opsional token pendek. Canonical QR payload aplikasi: https://catatin.nusafishing.com/inventory/item/{id}';

create index if not exists idx_inventory_items_biz
  on public.inventory_items (business_id);

create index if not exists idx_inventory_items_active
  on public.inventory_items (business_id, is_active);

drop trigger if exists trg_inventory_items_updated on public.inventory_items;
create trigger trg_inventory_items_updated
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- Constraint lembut: usage areas hanya nilai dikenal
alter table public.inventory_items
  drop constraint if exists inventory_items_usage_areas_check;

alter table public.inventory_items
  add constraint inventory_items_usage_areas_check
  check (
    allowed_usage_areas <@ array['dapur', 'bar', 'gudang']::text[]
  );

-- ----------------------------------------------------------------------------
-- 5) inventory_item_locations
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_item_locations (
  id                      uuid primary key default gen_random_uuid(),
  item_id                 uuid not null references public.inventory_items(id) on delete cascade,
  location_id             uuid not null references public.inventory_locations(id) on delete cascade,
  min_stock_override      numeric(18,6) null,
  target_stock_override   numeric(18,6) null,
  is_enabled              boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (item_id, location_id)
);

drop trigger if exists trg_inventory_item_locations_updated on public.inventory_item_locations;
create trigger trg_inventory_item_locations_updated
  before update on public.inventory_item_locations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6) inventory_lots — wajib untuk expiry/batch
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_lots (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  item_id            uuid not null references public.inventory_items(id) on delete restrict,
  batch_number       text null,
  expiry_date        date null,
  expiry_unknown     boolean not null default false,
  received_at        timestamptz not null default now(),
  source_type        text null,
  source_id          uuid null,
  initial_unit_cost  numeric(18,4) null,
  created_at         timestamptz not null default now(),
  check (
    (expiry_unknown = true and expiry_date is null)
    or (expiry_unknown = false)
  )
);

comment on table public.inventory_lots is
  'Lot/batch per item. Expiry alert 14/7/3/0 dihitung dari sini, bukan dari stock_balances. Jika expiry tidak diketahui: expiry_unknown=true, jangan isi tanggal perkiraan.';

create index if not exists idx_inventory_lots_item
  on public.inventory_lots (item_id);

create index if not exists idx_inventory_lots_expiry
  on public.inventory_lots (expiry_date)
  where expiry_date is not null and expiry_unknown = false;

-- ----------------------------------------------------------------------------
-- 7) inventory_settings (threshold, dead stock, PO threshold, expiry)
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_settings (
  business_id                    uuid primary key
                                 references public.businesses(id) on delete cascade,
  opname_variance_pct            numeric(8,4) not null default 5
                                 check (opname_variance_pct >= 0),
  opname_variance_value_idr      bigint not null default 100000
                                 check (opname_variance_value_idr >= 0),
  dead_stock_days                int not null default 30
                                 check (dead_stock_days > 0),
  expiry_warn_days               int not null default 14,
  expiry_near_days               int not null default 7,
  expiry_critical_days           int not null default 3,
  -- Threshold nominal wajib PO — NULL = belum ditentukan Owner
  po_required_min_amount_idr     bigint null,
  updated_by                     uuid null references public.profiles(id) on delete set null,
  updated_at                     timestamptz not null default now()
);

comment on column public.inventory_settings.po_required_min_amount_idr is
  'Keputusan Owner belum final. NULL = PO tidak dipaksa by amount; PO tetap tersedia untuk pesanan formal.';

comment on column public.inventory_settings.opname_variance_pct is
  'Hanya Owner yang boleh mengubah (egakkan di RLS/app). Approval jika selisih >= pct OR nilai >= opname_variance_value_idr.';

-- ----------------------------------------------------------------------------
-- 8) inventory_item_audit_log
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_item_audit_log (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  item_id      uuid not null references public.inventory_items(id) on delete cascade,
  action       text not null,
  before_data  jsonb null,
  after_data   jsonb null,
  changed_by   uuid null references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_inventory_item_audit_item
  on public.inventory_item_audit_log (item_id, created_at desc);

-- ----------------------------------------------------------------------------
-- ROLLBACK cuplikan
-- ----------------------------------------------------------------------------
-- drop function if exists public.ensure_fnb_inventory_locations(uuid);
-- alter table public.member_assignments drop constraint if exists member_assignments_location_id_fkey;
-- drop table if exists public.inventory_item_audit_log;
-- drop table if exists public.inventory_settings;
-- drop table if exists public.inventory_lots;
-- drop table if exists public.inventory_item_locations;
-- drop table if exists public.inventory_items;
-- drop table if exists public.inventory_locations;
