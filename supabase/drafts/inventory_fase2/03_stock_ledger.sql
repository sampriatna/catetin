-- ============================================================================
-- DRAFT 03 — Stock ledger (source of truth) + internal posting
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–02
--
-- Client TIDAK boleh INSERT/UPDATE/DELETE stock_movements / balances.
-- Status posted HANYA dibuat oleh _post_stock_movement_internal.
-- quantity > 0; arah ditentukan from_location_id / to_location_id.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  if to_regclass('public.inventory_items') is null then
    raise exception 'Preflight: inventory_items belum ada';
  end if;
END $$;

create table if not exists public.stock_movements (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  movement_group_id    uuid not null default gen_random_uuid(),
  movement_type        text not null
                       check (movement_type in (
                         'opening',
                         'purchase_receive',
                         'transfer_out',
                         'transfer_in',
                         'opname_adjustment',
                         'production_consumption',
                         'production_output',
                         'waste',
                         'shrinkage',
                         'damaged',
                         'expired',
                         'manual_adjustment',
                         'compensating_adjustment'
                       )),
  item_id              uuid not null,
  lot_id               uuid null,
  from_location_id     uuid null,
  to_location_id       uuid null,
  quantity             numeric(18,6) not null check (quantity > 0),
  unit_cost            numeric(18,4) null,
  total_value          numeric(18,4) null,
  reference_type       text null,
  reference_id         uuid null,
  notes                text null,
  status               text not null default 'draft'
                       check (status in (
                         'draft', 'posted', 'pending_approval', 'rejected', 'voided'
                       )),
  created_by           uuid null references public.profiles(id) on delete set null,
  assignment_id        uuid null,
  acting_role          text null,
  acting_location_id   uuid null,
  approved_by          uuid null references public.profiles(id) on delete set null,
  posted_by            uuid null references public.profiles(id) on delete set null,
  -- Satu movement hanya boleh punya satu compensating/reversal tertaut
  compensated_by_movement_id uuid null,
  compensates_movement_id    uuid null,
  created_at           timestamptz not null default now(),
  posted_at            timestamptz null,
  check (from_location_id is not null or to_location_id is not null),
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict,
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete restrict,
  foreign key (from_location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (to_location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete set null,
  foreign key (acting_location_id, business_id)
    references public.inventory_locations (id, business_id) on delete set null
);

create unique index if not exists uq_stock_movements_compensates_once
  on public.stock_movements (compensates_movement_id)
  where compensates_movement_id is not null and status = 'posted';

create index if not exists idx_stock_movements_biz_posted
  on public.stock_movements (business_id, posted_at desc)
  where status = 'posted';

create index if not exists idx_stock_movements_group
  on public.stock_movements (movement_group_id);

create index if not exists idx_stock_movements_ref
  on public.stock_movements (reference_type, reference_id);

-- Validasi lot.item_id = movement.item_id
create or replace function public.stock_movements_validate_row()
returns trigger
language plpgsql
as $$
declare
  v_lot_item uuid;
begin
  if new.quantity <= 0 then
    raise exception 'quantity harus > 0';
  end if;

  if new.lot_id is not null then
    select item_id into v_lot_item
    from public.inventory_lots
    where id = new.lot_id and business_id = new.business_id;
    if v_lot_item is null then
      raise exception 'lot tidak valid untuk business';
    end if;
    if v_lot_item is distinct from new.item_id then
      raise exception 'lot tidak cocok dengan item movement';
    end if;
  end if;

  -- Client tidak boleh set posted
  if tg_op = 'INSERT' and new.status = 'posted' then
    raise exception 'status posted hanya boleh dibuat oleh fungsi internal posting';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'posted' then
      raise exception 'movement posted immutable';
    end if;
    if old.status is distinct from 'posted'
       and new.status = 'posted'
       and coalesce(current_setting('inventory.posting', true), '') <> '1' then
      raise exception 'status posted hanya boleh dibuat oleh fungsi internal posting';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.stock_movements_validate_row() from public, anon, authenticated;

drop trigger if exists trg_stock_movements_validate on public.stock_movements;
create trigger trg_stock_movements_validate
  before insert or update on public.stock_movements
  for each row execute function public.stock_movements_validate_row();

create or replace function public.prevent_posted_movement_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'posted' then
    raise exception 'stock_movements posted tidak boleh dihapus';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_posted_movement_delete() from public, anon, authenticated;

drop trigger if exists trg_stock_movements_no_delete_posted on public.stock_movements;
create trigger trg_stock_movements_no_delete_posted
  before delete on public.stock_movements
  for each row execute function public.prevent_posted_movement_delete();

create table if not exists public.stock_balances (
  business_id   uuid not null references public.businesses(id) on delete cascade,
  item_id       uuid not null,
  location_id   uuid not null,
  quantity      numeric(18,6) not null default 0,
  average_cost  numeric(18,4) null,
  total_value   numeric(18,4) null,
  updated_at    timestamptz not null default now(),
  primary key (item_id, location_id),
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete cascade,
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete cascade
);

create table if not exists public.stock_lot_balances (
  business_id   uuid not null references public.businesses(id) on delete cascade,
  lot_id        uuid not null,
  location_id   uuid not null,
  quantity      numeric(18,6) not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (lot_id, location_id),
  foreign key (lot_id, business_id)
    references public.inventory_lots (id, business_id) on delete cascade,
  foreign key (location_id, business_id)
    references public.inventory_locations (id, business_id) on delete cascade
);

-- ============================================================================
-- INTERNAL balance apply
-- ============================================================================
create or replace function public._apply_balance_delta(
  p_business_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_qty_delta numeric,
  p_unit_cost numeric,
  p_is_inbound boolean,
  p_allow_negative boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric(18,6);
  v_avg numeric(18,4);
  v_val numeric(18,4);
  v_new_qty numeric(18,6);
  v_new_avg numeric(18,4);
  v_new_val numeric(18,4);
begin
  if p_location_id is null then
    return;
  end if;

  insert into public.stock_balances as sb
    (business_id, item_id, location_id, quantity, average_cost, total_value, updated_at)
  values
    (p_business_id, p_item_id, p_location_id, 0, null, 0, now())
  on conflict (item_id, location_id) do nothing;

  select quantity, average_cost, total_value
    into v_qty, v_avg, v_val
  from public.stock_balances
  where item_id = p_item_id and location_id = p_location_id
  for update;

  if not p_is_inbound and p_qty_delta < 0 and v_avg is null then
    raise exception 'outbound ditolak: average_cost belum tersedia di lokasi sumber';
  end if;

  v_new_qty := coalesce(v_qty, 0) + p_qty_delta;

  if v_new_qty < 0 and not p_allow_negative then
    raise exception 'stok negatif diblok (item %, lokasi %)', p_item_id, p_location_id;
  end if;

  if p_is_inbound and p_qty_delta > 0 then
    if p_unit_cost is null then
      raise exception 'inbound membutuhkan unit_cost';
    end if;
    v_new_val := coalesce(v_val, 0) + (p_qty_delta * p_unit_cost);
    if v_new_qty > 0 then
      v_new_avg := v_new_val / v_new_qty;
    else
      v_new_avg := p_unit_cost;
      v_new_val := 0;
    end if;
  else
    v_new_avg := v_avg;
    if v_new_qty > 0 and v_avg is not null then
      v_new_val := v_new_qty * v_avg;
    elsif v_new_qty = 0 then
      v_new_val := 0;
    else
      v_new_val := coalesce(v_val, 0) + (p_qty_delta * coalesce(v_avg, 0));
    end if;
  end if;

  update public.stock_balances
  set quantity = v_new_qty,
      average_cost = v_new_avg,
      total_value = v_new_val,
      updated_at = now()
  where item_id = p_item_id and location_id = p_location_id;
end;
$$;

create or replace function public._apply_lot_balance_delta(
  p_business_id uuid,
  p_lot_id uuid,
  p_location_id uuid,
  p_qty_delta numeric,
  p_allow_negative boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric(18,6);
  v_new numeric(18,6);
begin
  if p_lot_id is null or p_location_id is null then
    return;
  end if;

  insert into public.stock_lot_balances as lb
    (business_id, lot_id, location_id, quantity, updated_at)
  values
    (p_business_id, p_lot_id, p_location_id, 0, now())
  on conflict (lot_id, location_id) do nothing;

  select quantity into v_qty
  from public.stock_lot_balances
  where lot_id = p_lot_id and location_id = p_location_id
  for update;

  v_new := coalesce(v_qty, 0) + p_qty_delta;
  if v_new < 0 and not p_allow_negative then
    raise exception 'lot stok negatif diblok';
  end if;

  update public.stock_lot_balances
  set quantity = v_new, updated_at = now()
  where lot_id = p_lot_id and location_id = p_location_id;
end;
$$;

revoke all on function public._apply_balance_delta(uuid, uuid, uuid, numeric, numeric, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public._apply_lot_balance_delta(uuid, uuid, uuid, numeric, boolean)
  from public, anon, authenticated;

-- ============================================================================
-- INTERNAL post — tidak di-grant ke authenticated
-- ============================================================================
create or replace function public._post_stock_movement_internal(p_movement_id uuid)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.stock_movements;
  v_cost numeric(18,4);
  v_from_avg numeric(18,4);
  v_allow_neg boolean;
  v_go_live boolean;
begin
  select * into v_m
  from public.stock_movements
  where id = p_movement_id
  for update;

  if not found then
    raise exception 'movement tidak ditemukan';
  end if;
  if v_m.status = 'posted' then
    raise exception 'movement sudah posted';
  end if;
  if v_m.status = 'pending_approval' then
    raise exception 'pending_approval tidak boleh dipost tanpa approval sah';
  end if;
  if v_m.status <> 'draft' then
    raise exception 'hanya draft yang bisa dipost (status=%)', v_m.status;
  end if;

  v_go_live := public.inventory_is_go_live(v_m.business_id);
  select coalesce(allow_negative, not v_go_live) into v_allow_neg
  from public.inventory_business_state
  where business_id = v_m.business_id;
  v_allow_neg := coalesce(v_allow_neg, not v_go_live);
  if v_go_live then
    v_allow_neg := false;
  end if;

  -- Setelah go-live: opening baru dilarang
  if v_go_live and v_m.movement_type = 'opening' then
    raise exception 'opening tidak boleh dibuat/dipost setelah go-live';
  end if;

  -- Sebelum go-live: batasi movement operasional produksi
  if not v_go_live and v_m.movement_type in (
    'purchase_receive', 'transfer_out', 'transfer_in',
    'production_consumption', 'production_output',
    'waste', 'shrinkage', 'damaged', 'expired',
    'opname_adjustment', 'manual_adjustment', 'compensating_adjustment'
  ) then
    -- Izinkan di sandbox/uat untuk testing; blok keras hanya jika lifecycle tidak dikenal
    -- (kebijakan: sandbox/uat BOLEH post untuk UAT; produksi go_live mengatur opening)
    null;
  end if;

  if v_m.movement_type in ('opening', 'purchase_receive') and v_m.unit_cost is null then
    raise exception '% wajib unit_cost sebelum post', v_m.movement_type;
  end if;

  if v_m.from_location_id is not null then
    select average_cost into v_from_avg
    from public.stock_balances
    where item_id = v_m.item_id and location_id = v_m.from_location_id
    for update;
  end if;

  if v_m.from_location_id is not null and v_m.to_location_id is not null then
    -- transfer / move: bawa cost sumber
    v_cost := coalesce(v_m.unit_cost, v_from_avg);
    if v_cost is null then
      raise exception 'transfer ditolak: average_cost sumber belum ada';
    end if;
  elsif v_m.to_location_id is not null then
    v_cost := v_m.unit_cost;
  else
    v_cost := coalesce(v_m.unit_cost, v_from_avg);
  end if;

  perform set_config('inventory.posting', '1', true);

  if v_m.from_location_id is not null then
    perform public._apply_balance_delta(
      v_m.business_id, v_m.item_id, v_m.from_location_id,
      -v_m.quantity, v_cost, false, v_allow_neg
    );
    perform public._apply_lot_balance_delta(
      v_m.business_id, v_m.lot_id, v_m.from_location_id,
      -v_m.quantity, v_allow_neg
    );
  end if;

  if v_m.to_location_id is not null then
    perform public._apply_balance_delta(
      v_m.business_id, v_m.item_id, v_m.to_location_id,
      v_m.quantity, v_cost, true, v_allow_neg
    );
    perform public._apply_lot_balance_delta(
      v_m.business_id, v_m.lot_id, v_m.to_location_id,
      v_m.quantity, v_allow_neg
    );
  end if;

  update public.stock_movements
  set status = 'posted',
      unit_cost = v_cost,
      total_value = v_m.quantity * v_cost,
      posted_at = now(),
      posted_by = auth.uid()
  where id = p_movement_id
  returning * into v_m;

  perform set_config('inventory.posting', '', true);
  return v_m;
exception
  when others then
    perform set_config('inventory.posting', '', true);
    raise;
end;
$$;

revoke all on function public._post_stock_movement_internal(uuid)
  from public, anon, authenticated;

-- Owner-only compensating adjustment (bukan generic public reverse)
-- Disediakan sebagai INTERNAL; dipanggil dari domain RPC di 07 jika diperlukan.
create or replace function public._create_compensating_adjustment(
  p_movement_id uuid,
  p_notes text,
  p_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.stock_movements;
  v_new_id uuid;
  v_group uuid := gen_random_uuid();
  v_depend int;
begin
  select * into v_m from public.stock_movements where id = p_movement_id for update;
  if not found or v_m.status <> 'posted' then
    raise exception 'hanya posted movement yang bisa dikompensasi';
  end if;
  if v_m.compensated_by_movement_id is not null then
    raise exception 'movement sudah dikompensasi';
  end if;

  -- Jika ada movement posted berikutnya pada item+lokasi setelah posted_at, larang "reverse sederhana"
  select count(*) into v_depend
  from public.stock_movements x
  where x.business_id = v_m.business_id
    and x.item_id = v_m.item_id
    and x.status = 'posted'
    and x.id <> v_m.id
    and x.posted_at > v_m.posted_at
    and (
      x.from_location_id in (v_m.from_location_id, v_m.to_location_id)
      or x.to_location_id in (v_m.from_location_id, v_m.to_location_id)
    );

  if v_depend > 0 then
    raise exception 'ada movement lanjutan; gunakan compensating_adjustment dengan approval (lanjut membuat baris compensating)';
  end if;

  insert into public.stock_movements (
    business_id, movement_group_id, movement_type, item_id, lot_id,
    from_location_id, to_location_id, quantity, unit_cost,
    reference_type, reference_id, notes, status,
    created_by, approved_by, compensates_movement_id, acting_role, acting_location_id, assignment_id
  ) values (
    v_m.business_id, v_group, 'compensating_adjustment', v_m.item_id, v_m.lot_id,
    v_m.to_location_id, v_m.from_location_id, v_m.quantity, v_m.unit_cost,
    'stock_movement', v_m.id, coalesce(p_notes, 'Compensating adjustment'), 'draft',
    auth.uid(), p_approved_by, v_m.id, 'owner', v_m.acting_location_id, v_m.assignment_id
  ) returning id into v_new_id;

  perform public._post_stock_movement_internal(v_new_id);

  update public.stock_movements
  set compensated_by_movement_id = v_new_id
  where id = v_m.id;

  return v_new_id;
end;
$$;

revoke all on function public._create_compensating_adjustment(uuid, text, uuid)
  from public, anon, authenticated;

-- Privilege: authenticated tidak write ledger
revoke insert, update, delete on public.stock_movements from public, anon, authenticated;
revoke insert, update, delete on public.stock_balances from public, anon, authenticated;
revoke insert, update, delete on public.stock_lot_balances from public, anon, authenticated;

COMMIT;
