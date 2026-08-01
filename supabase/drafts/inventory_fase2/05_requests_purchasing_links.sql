-- ============================================================================
-- DRAFT 05 — Kebutuhan, PR/PO, purchasing_tx_links (app_tx_id text)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–04
-- ============================================================================

BEGIN;

DO $$
BEGIN
  if to_regclass('public.inventory_receipts') is null then
    raise exception 'Preflight: inventory_receipts belum ada';
  end if;
END $$;

create table if not exists public.inventory_requests (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  request_no           text not null,
  source_location_id   uuid not null,
  area                 text not null check (area in ('dapur', 'bar', 'campuran', 'gudang')),
  requested_by         uuid null references public.profiles(id) on delete set null,
  assignment_id        uuid null,
  acting_role          text null,
  needed_date          date null,
  status               text not null default 'draft'
                       check (status in (
                         'draft', 'submitted', 'checking_stock',
                         'fulfilled_from_warehouse', 'transfer_created',
                         'needs_purchase', 'completed', 'rejected'
                       )),
  notes                text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (business_id, request_no),
  foreign key (source_location_id, business_id)
    references public.inventory_locations (id, business_id) on delete restrict,
  foreign key (assignment_id, business_id)
    references public.member_assignments (id, business_id) on delete set null
);

create unique index if not exists uq_inventory_requests_id_biz
  on public.inventory_requests (id, business_id);

drop trigger if exists trg_inventory_requests_updated on public.inventory_requests;
create trigger trg_inventory_requests_updated
  before update on public.inventory_requests
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.inventory_request_lines (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  request_id            uuid not null,
  item_id               uuid not null,
  requested_qty         numeric(18,6) not null check (requested_qty > 0),
  available_source_qty  numeric(18,6) null,
  fulfilled_qty         numeric(18,6) null,
  purchase_needed_qty   numeric(18,6) null,
  reason                text not null check (reason in (
                          'min_stock', 'forecast', 'event', 'reservation',
                          'damaged', 'expired', 'sudden_increase', 'manual'
                        )),
  notes                 text null,
  foreign key (request_id, business_id)
    references public.inventory_requests (id, business_id) on delete cascade,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete restrict
);

create unique index if not exists uq_inventory_request_lines_id_biz
  on public.inventory_request_lines (id, business_id);

-- PR
create table if not exists public.purchase_requests (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id) on delete cascade,
  pr_no                   text not null,
  inventory_request_id    uuid null,
  status                  text not null default 'draft'
                          check (status in (
                            'draft', 'submitted', 'approved', 'rejected',
                            'partially_ordered', 'ordered', 'closed', 'cancelled'
                          )),
  requested_by            uuid null references public.profiles(id) on delete set null,
  approved_by             uuid null references public.profiles(id) on delete set null,
  needed_date             date null,
  notes                   text null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (business_id, pr_no),
  foreign key (inventory_request_id, business_id)
    references public.inventory_requests (id, business_id) on delete set null
);

create unique index if not exists uq_purchase_requests_id_biz
  on public.purchase_requests (id, business_id);

drop trigger if exists trg_purchase_requests_updated on public.purchase_requests;
create trigger trg_purchase_requests_updated
  before update on public.purchase_requests
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.purchase_request_lines (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references public.businesses(id) on delete cascade,
  purchase_request_id       uuid not null,
  item_id                   uuid null,
  description               text not null,
  qty                       numeric(18,6) not null check (qty > 0),
  unit                      text null,
  estimated_unit_cost       numeric(18,4) null,
  inventory_request_line_id uuid null,
  notes                     text null,
  foreign key (purchase_request_id, business_id)
    references public.purchase_requests (id, business_id) on delete cascade,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete set null,
  foreign key (inventory_request_line_id, business_id)
    references public.inventory_request_lines (id, business_id) on delete set null
);

create unique index if not exists uq_purchase_request_lines_id_biz
  on public.purchase_request_lines (id, business_id);

-- PO (schema wajib; pemakaian kondisional)
create table if not exists public.purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  po_no               text not null,
  purchase_request_id uuid null,
  supplier_id         uuid null,
  status              text not null default 'draft'
                      check (status in (
                        'draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled'
                      )),
  ordered_at          date null,
  notes               text null,
  created_by          uuid null references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, po_no),
  foreign key (purchase_request_id, business_id)
    references public.purchase_requests (id, business_id) on delete set null,
  foreign key (supplier_id, business_id)
    references public.suppliers (id, business_id) on delete set null
);

create unique index if not exists uq_purchase_orders_id_biz
  on public.purchase_orders (id, business_id);

drop trigger if exists trg_purchase_orders_updated on public.purchase_orders;
create trigger trg_purchase_orders_updated
  before update on public.purchase_orders
  for each row execute function public.inventory_set_updated_at();

create table if not exists public.purchase_order_lines (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses(id) on delete cascade,
  purchase_order_id        uuid not null,
  purchase_request_line_id uuid null,
  item_id                  uuid null,
  description              text not null,
  qty                      numeric(18,6) not null check (qty > 0),
  unit                     text null,
  unit_cost                numeric(18,4) null,
  notes                    text null,
  foreign key (purchase_order_id, business_id)
    references public.purchase_orders (id, business_id) on delete cascade,
  foreign key (purchase_request_line_id, business_id)
    references public.purchase_request_lines (id, business_id) on delete set null,
  foreign key (item_id, business_id)
    references public.inventory_items (id, business_id) on delete set null
);

create unique index if not exists uq_purchase_order_lines_id_biz
  on public.purchase_order_lines (id, business_id);

-- Validasi PR line milik PR header; PO line milik PO; PR line pada PO milik PR yang sama
create or replace function public.purchase_lines_validate_parent()
returns trigger
language plpgsql
as $$
declare
  v_pr uuid;
  v_po_pr uuid;
  v_line_pr uuid;
begin
  if tg_table_name = 'purchase_request_lines' then
    null; -- covered by composite FK
  elsif tg_table_name = 'purchase_order_lines' then
    if new.purchase_request_line_id is not null then
      select purchase_request_id into v_line_pr
      from public.purchase_request_lines
      where id = new.purchase_request_line_id and business_id = new.business_id;

      select purchase_request_id into v_po_pr
      from public.purchase_orders
      where id = new.purchase_order_id and business_id = new.business_id;

      if v_line_pr is null then
        raise exception 'purchase_request_line tidak ditemukan';
      end if;
      if v_po_pr is not null and v_line_pr is distinct from v_po_pr then
        raise exception 'PR line bukan anak dari PR yang direferensikan PO';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.purchase_lines_validate_parent() from public, anon, authenticated;

drop trigger if exists trg_po_lines_parent on public.purchase_order_lines;
create trigger trg_po_lines_parent
  before insert or update on public.purchase_order_lines
  for each row execute function public.purchase_lines_validate_parent();

-- FK mundur receipts → PR/PO
alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_pr_biz_fkey;
alter table public.inventory_receipts
  add constraint inventory_receipts_pr_biz_fkey
  foreign key (purchase_request_id, business_id)
  references public.purchase_requests (id, business_id) on delete set null;

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_po_biz_fkey;
alter table public.inventory_receipts
  add constraint inventory_receipts_po_biz_fkey
  foreign key (purchase_order_id, business_id)
  references public.purchase_orders (id, business_id) on delete set null;

-- ============================================================================
-- purchasing_tx_links — app_tx_id TEXT
-- ============================================================================
create table if not exists public.purchasing_tx_links (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses(id) on delete cascade,
  app_tx_id                text not null,
  source_system            text not null default 'app_state',
  purchase_kind            text not null
                           check (purchase_kind in ('from_pr', 'from_po', 'direct', 'emergency')),
  purchase_request_id      uuid null,
  purchase_request_line_id uuid null,
  purchase_order_id        uuid null,
  purchase_order_line_id   uuid null,
  direct_reason            text null,
  review_status            text not null default 'none'
                           check (review_status in ('none', 'pending_review', 'approved', 'rejected')),
  reviewed_by              uuid null references public.profiles(id) on delete set null,
  reviewed_at              timestamptz null,
  is_active                boolean not null default true,
  locked                   boolean not null default false,
  created_by               uuid null references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (purchase_request_id, business_id)
    references public.purchase_requests (id, business_id) on delete restrict,
  foreign key (purchase_request_line_id, business_id)
    references public.purchase_request_lines (id, business_id) on delete restrict,
  foreign key (purchase_order_id, business_id)
    references public.purchase_orders (id, business_id) on delete restrict,
  foreign key (purchase_order_line_id, business_id)
    references public.purchase_order_lines (id, business_id) on delete restrict,
  constraint purchasing_tx_links_kind_check check (
    (
      purchase_kind = 'from_pr'
      and purchase_request_id is not null
      and purchase_order_id is null
      and direct_reason is null
    ) or (
      purchase_kind = 'from_po'
      and purchase_request_id is not null
      and purchase_order_id is not null
      and direct_reason is null
    ) or (
      purchase_kind in ('direct', 'emergency')
      and purchase_request_id is null
      and purchase_order_id is null
      and purchase_request_line_id is null
      and purchase_order_line_id is null
      and direct_reason is not null
      and length(trim(direct_reason)) > 0
    )
  )
);

create unique index if not exists uq_purchasing_tx_links_id_biz
  on public.purchasing_tx_links (id, business_id);

create unique index if not exists uq_purchasing_tx_links_active_tx
  on public.purchasing_tx_links (business_id, source_system, app_tx_id)
  where is_active;

drop trigger if exists trg_purchasing_tx_links_updated on public.purchasing_tx_links;
create trigger trg_purchasing_tx_links_updated
  before update on public.purchasing_tx_links
  for each row execute function public.inventory_set_updated_at();

create or replace function public.purchasing_tx_links_validate()
returns trigger
language plpgsql
as $$
declare
  v_pr uuid;
  v_po uuid;
  v_po_pr uuid;
begin
  if new.purchase_kind in ('direct', 'emergency') and tg_op = 'INSERT' then
    new.review_status := 'pending_review';
  end if;

  if new.purchase_request_line_id is not null then
    select purchase_request_id into v_pr
    from public.purchase_request_lines
    where id = new.purchase_request_line_id and business_id = new.business_id;
    if v_pr is distinct from new.purchase_request_id then
      raise exception 'PR line bukan anak dari purchase_request_id';
    end if;
  end if;

  if new.purchase_order_line_id is not null then
    select purchase_order_id into v_po
    from public.purchase_order_lines
    where id = new.purchase_order_line_id and business_id = new.business_id;
    if v_po is distinct from new.purchase_order_id then
      raise exception 'PO line bukan anak dari purchase_order_id';
    end if;
  end if;

  if new.purchase_kind = 'from_po' then
    select purchase_request_id into v_po_pr
    from public.purchase_orders
    where id = new.purchase_order_id and business_id = new.business_id;
    if v_po_pr is not null and v_po_pr is distinct from new.purchase_request_id then
      raise exception 'PO tidak mengacu ke PR yang sama';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.locked and new.locked = false then
      raise exception 'locked=true tidak boleh dikembalikan menjadi false';
    end if;
    if old.locked or old.review_status = 'approved' then
      if new.app_tx_id is distinct from old.app_tx_id
         or new.purchase_request_id is distinct from old.purchase_request_id
         or new.purchase_order_id is distinct from old.purchase_order_id
         or new.purchase_kind is distinct from old.purchase_kind
         or new.is_active is distinct from old.is_active then
        raise exception 'link approved/locked tidak boleh diedit';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.purchasing_tx_links_validate() from public, anon, authenticated;

drop trigger if exists trg_purchasing_tx_links_validate on public.purchasing_tx_links;
create trigger trg_purchasing_tx_links_validate
  before insert or update on public.purchasing_tx_links
  for each row execute function public.purchasing_tx_links_validate();

create or replace function public.purchasing_tx_links_prevent_delete()
returns trigger
language plpgsql
as $$
begin
  if old.locked or old.review_status = 'approved' then
    raise exception 'link approved/locked tidak boleh dihapus';
  end if;
  return old;
end;
$$;

revoke all on function public.purchasing_tx_links_prevent_delete() from public, anon, authenticated;

drop trigger if exists trg_purchasing_tx_links_del on public.purchasing_tx_links;
create trigger trg_purchasing_tx_links_del
  before delete on public.purchasing_tx_links
  for each row execute function public.purchasing_tx_links_prevent_delete();

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_ptx_link_biz_fkey;
alter table public.inventory_receipts
  add constraint inventory_receipts_ptx_link_biz_fkey
  foreign key (purchasing_tx_link_id, business_id)
  references public.purchasing_tx_links (id, business_id) on delete set null;

-- Orphan validator — bandingkan TEXT, tanpa cast UUID
create or replace function public.validate_purchasing_tx_link_orphans(p_business_id uuid)
returns table (link_id uuid, app_tx_id text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  with tx_ids as (
    select elem->>'id' as tx_id
    from public.app_state s,
         lateral jsonb_array_elements(coalesce(s.data->'transactions', '[]'::jsonb)) elem
    where s.business_id = p_business_id
      and coalesce(elem->>'id', '') <> ''
  )
  select l.id, l.app_tx_id, 'orphan_app_tx_missing'::text
  from public.purchasing_tx_links l
  where l.business_id = p_business_id
    and l.is_active
    and not exists (select 1 from tx_ids t where t.tx_id = l.app_tx_id);
$$;

revoke all on function public.validate_purchasing_tx_link_orphans(uuid) from public, anon, authenticated;
-- Domain/admin RPC di 07 akan membungkus ini; sementara tidak grant ke authenticated

create table if not exists public.purchasing_transactions (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses(id) on delete cascade,
  app_tx_id                text null,
  source_system            text not null default 'app_state',
  occurred_at              date not null default current_date,
  amount                   bigint not null check (amount > 0),
  supplier_id              uuid null,
  outlet_code              text null,
  category_name            text null,
  wallet_id_text           text null,
  description              text null,
  receipt_url              text null,
  purchase_kind            text not null default 'from_pr'
                           check (purchase_kind in ('from_pr', 'from_po', 'direct', 'emergency')),
  purchase_request_id      uuid null,
  purchase_request_line_id uuid null,
  purchase_order_id        uuid null,
  status                   text not null default 'recorded'
                           check (status in ('recorded', 'linked', 'paid', 'received', 'voided')),
  created_by               uuid null references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (supplier_id, business_id)
    references public.suppliers (id, business_id) on delete set null,
  foreign key (purchase_request_id, business_id)
    references public.purchase_requests (id, business_id) on delete set null,
  foreign key (purchase_request_line_id, business_id)
    references public.purchase_request_lines (id, business_id) on delete set null,
  foreign key (purchase_order_id, business_id)
    references public.purchase_orders (id, business_id) on delete set null
);

create unique index if not exists uq_purchasing_transactions_app_tx
  on public.purchasing_transactions (business_id, source_system, app_tx_id)
  where app_tx_id is not null;

drop trigger if exists trg_purchasing_transactions_updated on public.purchasing_transactions;
create trigger trg_purchasing_transactions_updated
  before update on public.purchasing_transactions
  for each row execute function public.inventory_set_updated_at();

COMMIT;
