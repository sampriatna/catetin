-- ============================================================================
-- DRAFT 04 — Opname, transfers (+ IN_TRANSIT), waste, opening lock structure
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–03
--
-- Opening go-live FISIK tidak dilakukan di fase ini.
-- Tabel lock disiapkan untuk dipakai setelah UAT Fase 5.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) stock_opnames + lines
-- ----------------------------------------------------------------------------
create table if not exists public.stock_opnames (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  location_id     uuid not null references public.inventory_locations(id) on delete restrict,
  area            text not null
                  check (area in ('dapur', 'bar', 'campuran', 'gudang')),
  opname_date     date not null default current_date,
  status          text not null default 'draft'
                  check (status in ('draft', 'submitted', 'reviewed', 'approved', 'rejected')),
  submitted_by    uuid null references public.profiles(id) on delete set null,
  reviewed_by     uuid null references public.profiles(id) on delete set null,
  approved_by     uuid null references public.profiles(id) on delete set null,
  assignment_id   uuid null references public.member_assignments(id) on delete set null,
  acting_role     text null,
  notes           text null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Self-approve dilarang di level app + constraint lunak saat approve
  check (approved_by is null or submitted_by is null or approved_by <> submitted_by)
);

comment on table public.stock_opnames is
  'Header opname. Forecasting tidak boleh approve opname yang diajukan dirinya sendiri. Warehouse opname Forecasting → approve Owner.';

drop trigger if exists trg_stock_opnames_updated on public.stock_opnames;
create trigger trg_stock_opnames_updated
  before update on public.stock_opnames
  for each row execute function public.set_updated_at();

create table if not exists public.stock_opname_lines (
  id                 uuid primary key default gen_random_uuid(),
  opname_id          uuid not null references public.stock_opnames(id) on delete cascade,
  item_id            uuid not null references public.inventory_items(id) on delete restrict,
  lot_id             uuid null references public.inventory_lots(id) on delete restrict,
  system_qty         numeric(18,6) not null default 0,
  physical_qty       numeric(18,6) not null,
  difference_qty     numeric(18,6) not null default 0,
  difference_value   numeric(18,4) null,
  reason             text null,
  photo_url          text null,
  requires_approval  boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists idx_stock_opname_lines_opname
  on public.stock_opname_lines (opname_id);

-- Helper: tentukan requires_approval dari settings (OR logic)
create or replace function public.opname_line_requires_approval(
  p_business_id uuid,
  p_system_qty numeric,
  p_physical_qty numeric,
  p_unit_cost numeric
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pct numeric(8,4);
  v_val_limit bigint;
  v_diff numeric;
  v_base numeric;
  v_pct_diff numeric;
  v_val numeric;
begin
  select opname_variance_pct, opname_variance_value_idr
    into v_pct, v_val_limit
  from public.inventory_settings
  where business_id = p_business_id;

  v_pct := coalesce(v_pct, 5);
  v_val_limit := coalesce(v_val_limit, 100000);

  v_diff := abs(coalesce(p_physical_qty, 0) - coalesce(p_system_qty, 0));
  v_base := greatest(abs(coalesce(p_system_qty, 0)), 0.000001);
  v_pct_diff := (v_diff / v_base) * 100;
  v_val := v_diff * coalesce(p_unit_cost, 0);

  return (v_pct_diff >= v_pct) or (v_val >= v_val_limit);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) stock_transfers + lines (IN_TRANSIT flow)
-- ----------------------------------------------------------------------------
create table if not exists public.stock_transfers (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  transfer_no        text not null,
  from_location_id   uuid not null references public.inventory_locations(id) on delete restrict,
  to_location_id     uuid not null references public.inventory_locations(id) on delete restrict,
  status             text not null default 'draft'
                     check (status in (
                       'draft',
                       'sent',
                       'partially_received',
                       'received',
                       'rejected',
                       'cancelled',
                       'variance_pending'
                     )),
  created_by         uuid null references public.profiles(id) on delete set null,
  created_assignment_id uuid null references public.member_assignments(id) on delete set null,
  sent_by            uuid null references public.profiles(id) on delete set null,
  received_by        uuid null references public.profiles(id) on delete set null,
  received_assignment_id uuid null references public.member_assignments(id) on delete set null,
  sent_at            timestamptz null,
  received_at        timestamptz null,
  notes              text null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (business_id, transfer_no),
  check (from_location_id <> to_location_id)
);

comment on table public.stock_transfers is
  'Transfer stok. Sent: sumber→IN_TRANSIT. Diterima: IN_TRANSIT→tujuan oleh receiver outlet (receive_stock). Forecasting tidak menerima atas nama outlet.';

drop trigger if exists trg_stock_transfers_updated on public.stock_transfers;
create trigger trg_stock_transfers_updated
  before update on public.stock_transfers
  for each row execute function public.set_updated_at();

create table if not exists public.stock_transfer_lines (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references public.stock_transfers(id) on delete cascade,
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  lot_id          uuid null references public.inventory_lots(id) on delete restrict,
  sent_qty        numeric(18,6) not null check (sent_qty > 0),
  received_qty    numeric(18,6) null,
  difference_qty  numeric(18,6) null,
  unit_cost       numeric(18,4) null,
  variance_reason text null,
  variance_resolution text null
                  check (
                    variance_resolution is null
                    or variance_resolution in (
                      'damaged', 'shrinkage', 'returned', 'adjustment_approved', 'pending'
                    )
                  ),
  batch_code      text null,
  expiry_date     date null,
  notes           text null
);

create index if not exists idx_stock_transfer_lines_transfer
  on public.stock_transfer_lines (transfer_id);

-- Resolve lokasi IN_TRANSIT untuk bisnis
create or replace function public.inventory_in_transit_location_id(p_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.inventory_locations
  where business_id = p_business_id and code = 'IN_TRANSIT' and is_system
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 3) waste_records — terhubung movement
-- ----------------------------------------------------------------------------
create table if not exists public.waste_records (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  location_id     uuid not null references public.inventory_locations(id) on delete restrict,
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  lot_id          uuid null references public.inventory_lots(id) on delete restrict,
  movement_id     uuid null references public.stock_movements(id) on delete set null,
  waste_type      text not null
                  check (waste_type in ('waste', 'shrinkage', 'damaged', 'expired')),
  quantity        numeric(18,6) not null check (quantity > 0),
  unit_cost       numeric(18,4) null,
  reason          text null,
  photo_url       text null,
  created_by      uuid null references public.profiles(id) on delete set null,
  assignment_id   uuid null references public.member_assignments(id) on delete set null,
  acting_role     text null,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4) inventory_productions (produksi sederhana gudang)
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_productions (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  location_id       uuid not null references public.inventory_locations(id) on delete restrict,
  production_date   date not null default current_date,
  notes             text null,
  status            text not null default 'draft'
                    check (status in ('draft', 'posted', 'cancelled')),
  movement_group_id uuid null,
  created_by        uuid null references public.profiles(id) on delete set null,
  assignment_id     uuid null references public.member_assignments(id) on delete set null,
  created_at        timestamptz not null default now(),
  posted_at         timestamptz null
);

create table if not exists public.inventory_production_lines (
  id              uuid primary key default gen_random_uuid(),
  production_id   uuid not null references public.inventory_productions(id) on delete cascade,
  line_type       text not null
                  check (line_type in (
                    'production_consumption',
                    'production_output',
                    'waste',
                    'shrinkage'
                  )),
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  lot_id          uuid null references public.inventory_lots(id) on delete restrict,
  quantity        numeric(18,6) not null check (quantity > 0),
  unit_cost       numeric(18,4) null,
  expiry_date     date null,
  expiry_unknown  boolean not null default false,
  notes           text null
);

-- ----------------------------------------------------------------------------
-- 5) Opening lock (struktur saja — go-live setelah UAT Fase 5)
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_opening_locks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  location_id     uuid not null references public.inventory_locations(id) on delete restrict,
  cutoff_at       timestamptz not null,
  locked_at       timestamptz null,
  locked_by       uuid null references public.profiles(id) on delete set null,
  status          text not null default 'open'
                  check (status in ('open', 'locked')),
  notes           text null,
  unique (business_id, location_id)
);

comment on table public.inventory_opening_locks is
  'JANGAN lock produksi sebelum receive/transfer/opname/production/purchasing-link lolos UAT (setelah Fase 5).';

-- Warehouse goods receipt header (cost_pending → finalize → post movements)
create table if not exists public.inventory_receipts (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  location_id     uuid not null references public.inventory_locations(id) on delete restrict,
  receipt_no      text not null,
  status          text not null default 'draft'
                  check (status in (
                    'draft',
                    'cost_pending',
                    'ready_to_post',
                    'posted',
                    'cancelled'
                  )),
  purchase_request_id uuid null, -- FK ditambah di 05
  purchase_order_id   uuid null, -- FK ditambah di 05
  purchasing_tx_link_id uuid null,
  notes           text null,
  created_by      uuid null references public.profiles(id) on delete set null,
  assignment_id   uuid null references public.member_assignments(id) on delete set null,
  posted_at       timestamptz null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, receipt_no)
);

comment on column public.inventory_receipts.status is
  'cost_pending = boleh simpan & tandai diperiksa, BELUM menambah stok ledger. posted = purchase_receive sudah di-post.';

create table if not exists public.inventory_receipt_lines (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.inventory_receipts(id) on delete cascade,
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  lot_id          uuid null references public.inventory_lots(id) on delete set null,
  quantity        numeric(18,6) not null check (quantity > 0),
  unit_cost       numeric(18,4) null,
  batch_number    text null,
  expiry_date     date null,
  expiry_unknown  boolean not null default false,
  notes           text null
);

drop trigger if exists trg_inventory_receipts_updated on public.inventory_receipts;
create trigger trg_inventory_receipts_updated
  before update on public.inventory_receipts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Contoh alur transfer (dokumentasi)
-- ----------------------------------------------------------------------------
-- Sent 10:
--   GUDANG -10, IN_TRANSIT +10 (satu movement_group_id)
-- Terima 9:
--   IN_TRANSIT -9, KBU +9
-- Sisa 1 di IN_TRANSIT → variance_resolution (damaged/shrinkage/returned/...)

-- ----------------------------------------------------------------------------
-- ROLLBACK cuplikan
-- ----------------------------------------------------------------------------
-- drop table if exists public.inventory_receipt_lines;
-- drop table if exists public.inventory_receipts;
-- drop table if exists public.inventory_opening_locks;
-- drop table if exists public.inventory_production_lines;
-- drop table if exists public.inventory_productions;
-- drop table if exists public.waste_records;
-- drop function if exists public.inventory_in_transit_location_id(uuid);
-- drop table if exists public.stock_transfer_lines;
-- drop table if exists public.stock_transfers;
-- drop function if exists public.opname_line_requires_approval(uuid, numeric, numeric, numeric);
-- drop table if exists public.stock_opname_lines;
-- drop table if exists public.stock_opnames;
