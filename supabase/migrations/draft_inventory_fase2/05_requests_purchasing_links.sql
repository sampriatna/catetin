-- ============================================================================
-- DRAFT 05 — Kebutuhan outlet, PR/PO, purchasing_tx_links, jalur relational
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Prerequisite: 01–04
--
-- Aturan bisnis:
-- - Pembelian normal → wajib PR (purchase_request)
-- - PO kondisional (besar/tempo/penawaran); purchase_order_id nullable
-- - Direct/Emergency tanpa PR → wajib alasan + review
-- - app_tx_id di links = UUID stabil di app_state (tanpa FK nyata)
-- - Jangka panjang: purchasing_transactions relational
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) inventory_requests (kebutuhan outlet — bukan PO)
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_requests (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  request_no           text not null,
  source_location_id   uuid not null references public.inventory_locations(id) on delete restrict,
  area                 text not null
                       check (area in ('dapur', 'bar', 'campuran', 'gudang')),
  requested_by         uuid null references public.profiles(id) on delete set null,
  assignment_id        uuid null references public.member_assignments(id) on delete set null,
  acting_role          text null,
  needed_date          date null,
  status               text not null default 'draft'
                       check (status in (
                         'draft',
                         'submitted',
                         'checking_stock',
                         'fulfilled_from_warehouse',
                         'transfer_created',
                         'needs_purchase',
                         'completed',
                         'rejected'
                       )),
  notes                text null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (business_id, request_no)
);

drop trigger if exists trg_inventory_requests_updated on public.inventory_requests;
create trigger trg_inventory_requests_updated
  before update on public.inventory_requests
  for each row execute function public.set_updated_at();

create table if not exists public.inventory_request_lines (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid not null references public.inventory_requests(id) on delete cascade,
  item_id               uuid not null references public.inventory_items(id) on delete restrict,
  requested_qty         numeric(18,6) not null check (requested_qty > 0),
  available_source_qty  numeric(18,6) null,
  fulfilled_qty         numeric(18,6) null,
  purchase_needed_qty   numeric(18,6) null,
  reason                text not null
                        check (reason in (
                          'min_stock', 'forecast', 'event', 'reservation',
                          'damaged', 'expired', 'sudden_increase', 'manual'
                        )),
  notes                 text null
);

-- ----------------------------------------------------------------------------
-- 2) purchase_requests (+ lines) — kontrol kebutuhan/persetujuan belanja
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_requests (
  id                      uuid primary key default gen_random_uuid(),
  business_id             uuid not null references public.businesses(id) on delete cascade,
  pr_no                   text not null,
  inventory_request_id    uuid null references public.inventory_requests(id) on delete set null,
  status                  text not null default 'draft'
                          check (status in (
                            'draft',
                            'submitted',
                            'approved',
                            'rejected',
                            'partially_ordered',
                            'ordered',
                            'closed',
                            'cancelled'
                          )),
  requested_by            uuid null references public.profiles(id) on delete set null,
  approved_by             uuid null references public.profiles(id) on delete set null,
  needed_date             date null,
  notes                   text null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (business_id, pr_no)
);

drop trigger if exists trg_purchase_requests_updated on public.purchase_requests;
create trigger trg_purchase_requests_updated
  before update on public.purchase_requests
  for each row execute function public.set_updated_at();

create table if not exists public.purchase_request_lines (
  id              uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  item_id         uuid null references public.inventory_items(id) on delete set null,
  description     text not null,
  qty             numeric(18,6) not null check (qty > 0),
  unit            text null,
  estimated_unit_cost numeric(18,4) null,
  inventory_request_line_id uuid null
                      references public.inventory_request_lines(id) on delete set null,
  notes           text null
);

-- ----------------------------------------------------------------------------
-- 3) purchase_orders (+ lines) — schema wajib; pemakaian kondisional
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_orders (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  po_no               text not null,
  purchase_request_id uuid null references public.purchase_requests(id) on delete set null,
  supplier_name       text null,
  status              text not null default 'draft'
                      check (status in (
                        'draft',
                        'sent',
                        'partially_received',
                        'received',
                        'closed',
                        'cancelled'
                      )),
  ordered_at          date null,
  notes               text null,
  created_by          uuid null references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, po_no)
);

comment on table public.purchase_orders is
  'PO disiapkan di schema. Tidak wajib untuk belanja kecil harian. Wajib secara proses bila Owner menetapkan threshold / pesanan formal.';

drop trigger if exists trg_purchase_orders_updated on public.purchase_orders;
create trigger trg_purchase_orders_updated
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

create table if not exists public.purchase_order_lines (
  id                   uuid primary key default gen_random_uuid(),
  purchase_order_id    uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_request_line_id uuid null
                       references public.purchase_request_lines(id) on delete set null,
  item_id              uuid null references public.inventory_items(id) on delete set null,
  description          text not null,
  qty                  numeric(18,6) not null check (qty > 0),
  unit                 text null,
  unit_cost            numeric(18,4) null,
  notes                text null
);

-- FK mundur ke receipts (dari 04)
alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_purchase_request_id_fkey;
alter table public.inventory_receipts
  add constraint inventory_receipts_purchase_request_id_fkey
  foreign key (purchase_request_id) references public.purchase_requests(id) on delete set null;

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_purchase_order_id_fkey;
alter table public.inventory_receipts
  add constraint inventory_receipts_purchase_order_id_fkey
  foreign key (purchase_order_id) references public.purchase_orders(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 4) purchasing_tx_links — jembatan app_state JSONB ↔ PR/PO
-- ----------------------------------------------------------------------------
create table if not exists public.purchasing_tx_links (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses(id) on delete cascade,
  -- UUID stabil dari transaksi di app_state.data.transactions[].id
  -- TIDAK ada FK nyata ke JSONB
  app_tx_id                uuid not null,
  purchase_kind            text not null
                           check (purchase_kind in (
                             'from_pr',
                             'from_po',
                             'direct',
                             'emergency'
                           )),
  purchase_request_id      uuid null references public.purchase_requests(id) on delete restrict,
  purchase_request_line_id uuid null references public.purchase_request_lines(id) on delete restrict,
  purchase_order_id        uuid null references public.purchase_orders(id) on delete restrict,
  purchase_order_line_id   uuid null references public.purchase_order_lines(id) on delete restrict,
  direct_reason            text null,
  review_status            text not null default 'none'
                           check (review_status in (
                             'none', 'pending_review', 'approved', 'rejected'
                           )),
  reviewed_by              uuid null references public.profiles(id) on delete set null,
  reviewed_at              timestamptz null,
  is_active                boolean not null default true,
  locked                   boolean not null default false,
  created_by               uuid null references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (
    (
      purchase_kind in ('from_pr', 'from_po')
      and purchase_request_id is not null
    )
    or (
      purchase_kind in ('direct', 'emergency')
      and direct_reason is not null
      and length(trim(direct_reason)) > 0
    )
  )
);

comment on table public.purchasing_tx_links is
  'Relasi audit purchasing app_state ↔ PR/PO. app_tx_id harus UUID stabil. Satu transaksi hanya satu link aktif. Write via server/RPC, bukan dua save client terpisah.';

-- Satu link aktif per app_tx_id
create unique index if not exists uq_purchasing_tx_links_active_tx
  on public.purchasing_tx_links (business_id, app_tx_id)
  where is_active;

drop trigger if exists trg_purchasing_tx_links_updated on public.purchasing_tx_links;
create trigger trg_purchasing_tx_links_updated
  before update on public.purchasing_tx_links
  for each row execute function public.set_updated_at();

-- Blokir hapus/nonaktif sembarangan jika locked / sudah review
create or replace function public.prevent_unsafe_purchasing_link_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked or old.review_status in ('approved') then
      raise exception 'purchasing_tx_links terkunci/sudah direview tidak boleh dihapus';
    end if;
    return old;
  end if;

  if old.locked and (
    new.app_tx_id is distinct from old.app_tx_id
    or new.purchase_request_id is distinct from old.purchase_request_id
    or new.purchase_order_id is distinct from old.purchase_order_id
    or new.is_active is distinct from old.is_active
  ) then
    raise exception 'purchasing_tx_links terkunci tidak boleh diubah field kunci';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_purchasing_tx_links_guard on public.purchasing_tx_links;
create trigger trg_purchasing_tx_links_guard
  before update or delete on public.purchasing_tx_links
  for each row execute function public.prevent_unsafe_purchasing_link_mutation();

-- Validasi orphan (dipanggil job/admin) — membandingkan ke app_state JSONB
create or replace function public.validate_purchasing_tx_link_orphans(p_business_id uuid)
returns table (link_id uuid, app_tx_id uuid, reason text)
language sql
stable
security definer
set search_path = public
as $$
  with tx_ids as (
    select (elem->>'id')::uuid as tx_id
    from public.app_state s,
         lateral jsonb_array_elements(coalesce(s.data->'transactions', '[]'::jsonb)) elem
    where s.business_id = p_business_id
      and (elem->>'id') ~* '^[0-9a-f-]{36}$'
  )
  select l.id, l.app_tx_id, 'orphan_app_tx_missing'::text
  from public.purchasing_tx_links l
  where l.business_id = p_business_id
    and l.is_active
    and not exists (select 1 from tx_ids t where t.tx_id = l.app_tx_id);
$$;

grant execute on function public.validate_purchasing_tx_link_orphans(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Jalur jangka panjang: purchasing_transactions (skeleton, belum wajib dipakai)
-- ----------------------------------------------------------------------------
create table if not exists public.purchasing_transactions (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses(id) on delete cascade,
  -- Selama masa transisi, bisa mirror dari app_state
  app_tx_id                uuid null,
  occurred_at              date not null default current_date,
  amount                   bigint not null check (amount > 0),
  supplier_name            text null,
  outlet_code              text null,
  category_name            text null,
  wallet_id_text           text null,
  description              text null,
  receipt_url              text null,
  purchase_kind            text not null default 'from_pr'
                           check (purchase_kind in ('from_pr', 'from_po', 'direct', 'emergency')),
  purchase_request_id      uuid null references public.purchase_requests(id) on delete set null,
  purchase_request_line_id uuid null references public.purchase_request_lines(id) on delete set null,
  purchase_order_id        uuid null references public.purchase_orders(id) on delete set null,
  status                   text not null default 'recorded'
                           check (status in (
                             'recorded', 'linked', 'paid', 'received', 'voided'
                           )),
  created_by               uuid null references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.purchasing_transactions is
  'SKELETON migrasi keluar dari JSONB. Fase awal tetap tulis app_state + purchasing_tx_links; jangan jadikan JSONB desain permanen inventory.';

create unique index if not exists uq_purchasing_transactions_app_tx
  on public.purchasing_transactions (business_id, app_tx_id)
  where app_tx_id is not null;

drop trigger if exists trg_purchasing_transactions_updated on public.purchasing_transactions;
create trigger trg_purchasing_transactions_updated
  before update on public.purchasing_transactions
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Contoh alur (dokumentasi)
-- ----------------------------------------------------------------------------
-- Normal kecil: inventory_request → PR approved → purchasing tx + link(from_pr) → receipt post
-- Formal: PR approved → PO → purchasing tx + link(from_po|from_pr) → receipt
-- Emergency: purchasing tx + link(emergency, reason) → review → receipt

-- ----------------------------------------------------------------------------
-- ROLLBACK cuplikan
-- ----------------------------------------------------------------------------
-- drop table if exists public.purchasing_transactions;
-- drop function if exists public.validate_purchasing_tx_link_orphans(uuid);
-- drop function if exists public.prevent_unsafe_purchasing_link_mutation();
-- drop table if exists public.purchasing_tx_links;
-- alter table public.inventory_receipts drop constraint if exists inventory_receipts_purchase_order_id_fkey;
-- alter table public.inventory_receipts drop constraint if exists inventory_receipts_purchase_request_id_fkey;
-- drop table if exists public.purchase_order_lines;
-- drop table if exists public.purchase_orders;
-- drop table if exists public.purchase_request_lines;
-- drop table if exists public.purchase_requests;
-- drop table if exists public.inventory_request_lines;
-- drop table if exists public.inventory_requests;
