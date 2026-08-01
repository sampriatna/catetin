-- ============================================================================
-- DRAFT 03 — Stock ledger (source of truth) + balances cache
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01, 02
--
-- ATURAN KERAS:
-- - Client TIDAK boleh UPDATE/DELETE stock_balances
-- - Client TIDAK boleh UPDATE/DELETE stock_movements berstatus posted
-- - Koreksi = reversal / adjustment baru
-- - cost_pending receipt TIDAK memanggil post purchase_receive
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) stock_movements — baris ledger (movement-first)
-- ----------------------------------------------------------------------------
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
                         'reversal'
                       )),
  item_id              uuid not null references public.inventory_items(id) on delete restrict,
  lot_id               uuid null references public.inventory_lots(id) on delete restrict,
  from_location_id     uuid null references public.inventory_locations(id) on delete restrict,
  to_location_id       uuid null references public.inventory_locations(id) on delete restrict,
  -- quantity bertanda: konvensi postingan lewat RPC mengisi signed_qty_for_location
  quantity             numeric(18,6) not null check (quantity <> 0),
  unit_cost            numeric(18,4) null,
  total_value          numeric(18,4) null,
  reference_type       text null,
  reference_id         uuid null,
  notes                text null,
  status               text not null default 'draft'
                       check (status in (
                         'draft',
                         'posted',
                         'pending_approval',
                         'rejected',
                         'voided'
                       )),
  created_by           uuid null references public.profiles(id) on delete set null,
  assignment_id        uuid null references public.member_assignments(id) on delete set null,
  acting_role          text null,
  acting_location_id   uuid null references public.inventory_locations(id) on delete set null,
  approved_by          uuid null references public.profiles(id) on delete set null,
  posted_by            uuid null references public.profiles(id) on delete set null,
  reverses_movement_id uuid null references public.stock_movements(id) on delete restrict,
  created_at           timestamptz not null default now(),
  posted_at            timestamptz null,
  check (
    from_location_id is not null or to_location_id is not null
  )
);

comment on table public.stock_movements is
  'SOURCE OF TRUTH stok. Setelah status=posted bersifat immutable (egakkan trigger).';

create index if not exists idx_stock_movements_biz_posted
  on public.stock_movements (business_id, posted_at desc)
  where status = 'posted';

create index if not exists idx_stock_movements_group
  on public.stock_movements (movement_group_id);

create index if not exists idx_stock_movements_item
  on public.stock_movements (item_id, status);

create index if not exists idx_stock_movements_ref
  on public.stock_movements (reference_type, reference_id);

create index if not exists idx_stock_movements_lot
  on public.stock_movements (lot_id)
  where lot_id is not null;

-- ----------------------------------------------------------------------------
-- 2) stock_balances — cache agregasi saja
-- ----------------------------------------------------------------------------
create table if not exists public.stock_balances (
  item_id       uuid not null references public.inventory_items(id) on delete cascade,
  location_id   uuid not null references public.inventory_locations(id) on delete cascade,
  quantity      numeric(18,6) not null default 0,
  average_cost  numeric(18,4) null,
  total_value   numeric(18,4) null,
  updated_at    timestamptz not null default now(),
  primary key (item_id, location_id)
);

comment on table public.stock_balances is
  'CACHE saja. Hanya di-update oleh fungsi SECURITY DEFINER post/reverse. Jangan grant UPDATE ke authenticated.';

-- Lot-level quantity cache (untuk expiry & FEFO)
create table if not exists public.stock_lot_balances (
  lot_id        uuid not null references public.inventory_lots(id) on delete cascade,
  location_id   uuid not null references public.inventory_locations(id) on delete cascade,
  quantity      numeric(18,6) not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (lot_id, location_id)
);

-- ----------------------------------------------------------------------------
-- 3) Immutability trigger — larang ubah/hapus posted
-- ----------------------------------------------------------------------------
create or replace function public.prevent_posted_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'stock_movements posted tidak boleh dihapus; buat reversal';
    end if;
    return old;
  end if;

  if old.status = 'posted' then
    -- Izinkan hanya no-op / field non-kritis? → tidak. Semua kolom terkunci.
    if (
      new.quantity is distinct from old.quantity
      or new.unit_cost is distinct from old.unit_cost
      or new.total_value is distinct from old.total_value
      or new.item_id is distinct from old.item_id
      or new.lot_id is distinct from old.lot_id
      or new.from_location_id is distinct from old.from_location_id
      or new.to_location_id is distinct from old.to_location_id
      or new.movement_type is distinct from old.movement_type
      or new.status is distinct from old.status
      or new.posted_at is distinct from old.posted_at
      or new.movement_group_id is distinct from old.movement_group_id
    ) then
      raise exception 'stock_movements posted immutable; buat reversal/adjustment baru';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stock_movements_immutable on public.stock_movements;
create trigger trg_stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.prevent_posted_movement_mutation();

-- ----------------------------------------------------------------------------
-- 4) Apply delta ke cache balances (internal)
-- ----------------------------------------------------------------------------
create or replace function public._apply_balance_delta(
  p_item_id uuid,
  p_location_id uuid,
  p_qty_delta numeric,
  p_unit_cost numeric,
  p_is_inbound boolean
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

  select quantity, average_cost, total_value
    into v_qty, v_avg, v_val
  from public.stock_balances
  where item_id = p_item_id and location_id = p_location_id
  for update;

  if not found then
    v_qty := 0;
    v_avg := null;
    v_val := 0;
  end if;

  v_new_qty := coalesce(v_qty, 0) + p_qty_delta;

  if p_is_inbound and p_qty_delta > 0 then
    -- Weighted average: (old_val + inbound_val) / new_qty
    v_new_val := coalesce(v_val, 0) + (p_qty_delta * coalesce(p_unit_cost, coalesce(v_avg, 0)));
    if v_new_qty > 0 then
      v_new_avg := v_new_val / v_new_qty;
    else
      v_new_avg := coalesce(p_unit_cost, v_avg);
      v_new_val := 0;
    end if;
  else
    -- Outbound / negative: pakai average berjalan; jangan hitung harga baru
    v_new_avg := v_avg;
    if v_new_qty > 0 and v_avg is not null then
      v_new_val := v_new_qty * v_avg;
    else
      v_new_val := case when v_new_qty = 0 then 0 else coalesce(v_val, 0) + (p_qty_delta * coalesce(v_avg, 0)) end;
    end if;
  end if;

  insert into public.stock_balances (item_id, location_id, quantity, average_cost, total_value, updated_at)
  values (p_item_id, p_location_id, v_new_qty, v_new_avg, v_new_val, now())
  on conflict (item_id, location_id) do update
    set quantity = excluded.quantity,
        average_cost = excluded.average_cost,
        total_value = excluded.total_value,
        updated_at = now();
end;
$$;

create or replace function public._apply_lot_balance_delta(
  p_lot_id uuid,
  p_location_id uuid,
  p_qty_delta numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lot_id is null or p_location_id is null then
    return;
  end if;

  insert into public.stock_lot_balances (lot_id, location_id, quantity, updated_at)
  values (p_lot_id, p_location_id, p_qty_delta, now())
  on conflict (lot_id, location_id) do update
    set quantity = public.stock_lot_balances.quantity + excluded.quantity,
        updated_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) Post satu movement (draft → posted) + update cache
-- ----------------------------------------------------------------------------
create or replace function public.post_stock_movement(p_movement_id uuid)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.stock_movements;
  v_cost numeric(18,4);
  v_from_avg numeric(18,4);
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
  if v_m.status not in ('draft', 'pending_approval') then
    raise exception 'status movement tidak bisa dipost: %', v_m.status;
  end if;

  -- purchase_receive wajib unit_cost (cost_pending tidak boleh sampai sini)
  if v_m.movement_type = 'purchase_receive' and v_m.unit_cost is null then
    raise exception 'purchase_receive tidak boleh dipost tanpa unit_cost (selesaikan cost_pending dulu)';
  end if;

  -- Ambil cost sumber untuk outbound bila belum diisi
  if v_m.from_location_id is not null then
    select average_cost into v_from_avg
    from public.stock_balances
    where item_id = v_m.item_id and location_id = v_m.from_location_id;
  end if;

  v_cost := coalesce(v_m.unit_cost, v_from_avg);

  if v_m.from_location_id is not null then
    perform public._apply_balance_delta(
      v_m.item_id, v_m.from_location_id, -abs(v_m.quantity), v_cost, false
    );
    perform public._apply_lot_balance_delta(
      v_m.lot_id, v_m.from_location_id, -abs(v_m.quantity)
    );
  end if;

  if v_m.to_location_id is not null then
    perform public._apply_balance_delta(
      v_m.item_id, v_m.to_location_id, abs(v_m.quantity), v_cost, true
    );
    perform public._apply_lot_balance_delta(
      v_m.lot_id, v_m.to_location_id, abs(v_m.quantity)
    );
  end if;

  update public.stock_movements
  set status = 'posted',
      unit_cost = v_cost,
      total_value = abs(quantity) * v_cost,
      posted_at = now(),
      posted_by = auth.uid()
  where id = p_movement_id
  returning * into v_m;

  return v_m;
end;
$$;

-- Reverse posted movement (buat baris reversal baru; tidak edit lama)
create or replace function public.reverse_stock_movement(
  p_movement_id uuid,
  p_notes text default null
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
begin
  select * into v_m from public.stock_movements where id = p_movement_id;
  if not found or v_m.status <> 'posted' then
    raise exception 'hanya movement posted yang bisa di-reversal';
  end if;

  insert into public.stock_movements (
    business_id, movement_group_id, movement_type, item_id, lot_id,
    from_location_id, to_location_id, quantity, unit_cost,
    reference_type, reference_id, notes, status,
    created_by, reverses_movement_id, acting_role, acting_location_id, assignment_id
  ) values (
    v_m.business_id, v_group, 'reversal', v_m.item_id, v_m.lot_id,
    v_m.to_location_id, v_m.from_location_id, v_m.quantity, v_m.unit_cost,
    'stock_movement', v_m.id, coalesce(p_notes, 'Reversal'), 'draft',
    auth.uid(), v_m.id, v_m.acting_role, v_m.acting_location_id, v_m.assignment_id
  ) returning id into v_new_id;

  perform public.post_stock_movement(v_new_id);
  return v_new_id;
end;
$$;

revoke all on function public._apply_balance_delta(uuid, uuid, numeric, numeric, boolean) from public, anon, authenticated;
revoke all on function public._apply_lot_balance_delta(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.post_stock_movement(uuid) to authenticated;
grant execute on function public.reverse_stock_movement(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6) Privilege cache tables — authenticated hanya SELECT lewat view (06)
--    Di sini kita siapkan revoke write langsung.
-- ----------------------------------------------------------------------------
revoke insert, update, delete on public.stock_balances from anon, authenticated;
revoke insert, update, delete on public.stock_lot_balances from anon, authenticated;

-- Insert draft movements: lewat policy di 06; update posted diblok trigger

-- ----------------------------------------------------------------------------
-- Contoh alur (DOKUMENTASI — jangan dijalankan sebagai seed)
-- ----------------------------------------------------------------------------
-- -- Opening:
-- insert into stock_movements (..., movement_type='opening', to_location_id=GUDANG, quantity=100, unit_cost=12000, status='draft');
-- select post_stock_movement('<id>');
--
-- -- Receive (setelah cost lengkap):
-- insert ... movement_type='purchase_receive', to_location_id=GUDANG, unit_cost=...
-- select post_stock_movement('<id>');
--
-- -- Transfer sent (group):
-- insert transfer_out from GUDANG; insert transfer_in to IN_TRANSIT; post keduanya.
-- -- Receive outlet:
-- insert transfer_out from IN_TRANSIT; insert transfer_in to KBU; post.

-- ----------------------------------------------------------------------------
-- ROLLBACK cuplikan
-- ----------------------------------------------------------------------------
-- drop function if exists public.reverse_stock_movement(uuid, text);
-- drop function if exists public.post_stock_movement(uuid);
-- drop function if exists public._apply_lot_balance_delta(uuid, uuid, numeric);
-- drop function if exists public._apply_balance_delta(uuid, uuid, numeric, numeric, boolean);
-- drop function if exists public.prevent_posted_movement_mutation();
-- drop table if exists public.stock_lot_balances;
-- drop table if exists public.stock_balances;
-- drop table if exists public.stock_movements;
