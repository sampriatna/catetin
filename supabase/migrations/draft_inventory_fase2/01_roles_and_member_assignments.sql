-- ============================================================================
-- DRAFT 01 — Roles + member_assignments
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
-- Aman: additive. Tidak DROP data. Unique (business_id, user_id) pada
-- business_members TETAP DIPERTAHANKAN.
-- Tidak mengubah fungsi public.business_role().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Preflight (jalankan manual sebelum ALTER) — hanya SELECT
-- ----------------------------------------------------------------------------
-- select distinct role from public.business_members order by 1;
-- select distinct role from public.invites order by 1;

-- ----------------------------------------------------------------------------
-- 1) Perluas CHECK role business_members
--    Legacy: owner, admin, kasir, purchasing
--    Baru:   member (netral — forecasting & role inventory-only)
-- ----------------------------------------------------------------------------
alter table public.business_members
  drop constraint if exists business_members_role_check;

alter table public.business_members
  add constraint business_members_role_check
  check (role in (
    'owner',
    'admin',
    'kasir',
    'purchasing',
    'member'
  ));

comment on column public.business_members.role is
  'Keanggotaan bisnis / legacy module. Role inventory operasional ada di member_assignments. Role member = netral tanpa akses keuangan otomatis.';

-- ----------------------------------------------------------------------------
-- 2) Perluas CHECK role invites (tanpa owner)
-- ----------------------------------------------------------------------------
alter table public.invites
  drop constraint if exists invites_role_check;

alter table public.invites
  add constraint invites_role_check
  check (role in (
    'admin',
    'kasir',
    'purchasing',
    'member',
    'dapur',
    'bar',
    'operasional_samtaro',
    'forecasting_inventory'
  ));

comment on column public.invites.role is
  'Role undangan. Role inventory (dapur/bar/ops/forecasting) akan dibuat sebagai member_assignments; business_members.role menjadi kasir/purchasing/admin/member sesuai aturan invite.';

-- ----------------------------------------------------------------------------
-- 3) member_assignments — multi-role per membership bisnis
-- ----------------------------------------------------------------------------
create table if not exists public.member_assignments (
  id                  uuid primary key default gen_random_uuid(),
  business_member_id  uuid not null
                      references public.business_members(id) on delete cascade,
  role                text not null
                      check (role in (
                        'owner',
                        'admin',
                        'kasir',
                        'purchasing',
                        'dapur',
                        'bar',
                        'operasional_samtaro',
                        'forecasting_inventory',
                        'member'
                      )),
  -- location_id diisi setelah tabel inventory_locations ada (FK ditambah di 02)
  location_id         uuid null,
  permissions         text[] not null default '{}',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.member_assignments is
  'Assignment role/permission operasional. Satu business_members bisa punya banyak assignment (mis. kasir KBU + dapur KBU + receive_stock).';

-- Partial unique: business-wide (location null)
create unique index if not exists uq_member_assignments_bizwide
  on public.member_assignments (business_member_id, role)
  where location_id is null;

-- Partial unique: per lokasi
create unique index if not exists uq_member_assignments_location
  on public.member_assignments (business_member_id, role, location_id)
  where location_id is not null;

create index if not exists idx_member_assignments_member
  on public.member_assignments (business_member_id);

create index if not exists idx_member_assignments_role_active
  on public.member_assignments (role, active);

-- Permission dikenal (dokumentasi; validasi ketat di helper has_permission)
comment on column public.member_assignments.permissions is
  'Contoh: receive_stock, opname_stock, request_stock, create_transfer, receive_to_warehouse, manage_items, approve_opname_variance, view_inventory, view_stock_value, edit_opname_threshold (owner only via policy).';

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_member_assignments_updated on public.member_assignments;
create trigger trg_member_assignments_updated
  before update on public.member_assignments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4) Helper BARU (inventory / assignment) — tidak mengganti business_role()
-- ----------------------------------------------------------------------------

-- Ambil business_member.id aktif untuk user di bisnis
create or replace function public.current_business_member_id(p_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from public.business_members m
  where m.business_id = p_business_id
    and m.user_id = auth.uid()
    and m.active
  limit 1;
$$;

create or replace function public.has_active_assignment(
  p_business_id uuid,
  p_role text default null,
  p_location_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.member_assignments a
    join public.business_members m on m.id = a.business_member_id
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.active
      and a.active
      and (p_role is null or a.role = p_role)
      and (
        p_location_id is null
        or a.location_id is null  -- business-wide assignment
        or a.location_id = p_location_id
      )
  );
$$;

create or replace function public.has_assignment_role(
  p_business_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.member_assignments a
    join public.business_members m on m.id = a.business_member_id
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.active
      and a.active
      and a.role = any (p_roles)
  );
$$;

create or replace function public.has_permission(
  p_business_id uuid,
  p_permission text,
  p_location_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Owner legacy selalu penuh (kecuali aturan khusus di app untuk self-approve)
    public.business_role(p_business_id) = 'owner'
    or exists (
      select 1
      from public.member_assignments a
      join public.business_members m on m.id = a.business_member_id
      where m.business_id = p_business_id
        and m.user_id = auth.uid()
        and m.active
        and a.active
        and p_permission = any (a.permissions)
        and (
          p_location_id is null
          or a.location_id is null
          or a.location_id = p_location_id
        )
    )
    -- Role forecasting default permissions (bila permissions[] kosong / belum diisi)
    or (
      p_permission in (
        'view_inventory', 'view_stock_value', 'create_transfer',
        'receive_to_warehouse', 'manage_items', 'approve_opname_variance',
        'opname_stock', 'request_stock'
      )
      and public.has_assignment_role(
        p_business_id,
        array['forecasting_inventory']::text[]
      )
      and p_permission <> 'edit_opname_threshold'
      -- forecasting TIDAK boleh receive atas nama outlet
      and p_permission <> 'receive_stock'
    )
    -- Admin keuangan: view saja
    or (
      p_permission in ('view_inventory', 'view_stock_value')
      and public.business_role(p_business_id) = 'admin'
    );
$$;

-- can_access_location didefinisikan ulang di 02 setelah inventory_locations ada
-- (stub aman sementara)
create or replace function public.can_access_location(
  p_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

grant execute on function public.current_business_member_id(uuid) to authenticated;
grant execute on function public.has_active_assignment(uuid, text, uuid) to authenticated;
grant execute on function public.has_assignment_role(uuid, text[]) to authenticated;
grant execute on function public.has_permission(uuid, text, uuid) to authenticated;
grant execute on function public.can_access_location(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5) RLS awal member_assignments (diperketat lagi di 06 bila perlu)
-- ----------------------------------------------------------------------------
alter table public.member_assignments enable row level security;

drop policy if exists member_assignments_select on public.member_assignments;
create policy member_assignments_select on public.member_assignments
  for select using (
    exists (
      select 1 from public.business_members m
      where m.id = business_member_id
        and public.is_business_member(m.business_id)
    )
  );

drop policy if exists member_assignments_write on public.member_assignments;
create policy member_assignments_write on public.member_assignments
  for all using (
    exists (
      select 1 from public.business_members m
      where m.id = business_member_id
        and public.business_role(m.business_id) = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.business_members m
      where m.id = business_member_id
        and public.business_role(m.business_id) = 'owner'
    )
  );

-- ----------------------------------------------------------------------------
-- ROLLBACK cuplikan (lihat juga 99_ROLLBACK_ALL.sql)
-- ----------------------------------------------------------------------------
-- drop policy if exists member_assignments_write on public.member_assignments;
-- drop policy if exists member_assignments_select on public.member_assignments;
-- drop function if exists public.can_access_location(uuid);
-- drop function if exists public.has_permission(uuid, text, uuid);
-- drop function if exists public.has_assignment_role(uuid, text[]);
-- drop function if exists public.has_active_assignment(uuid, text, uuid);
-- drop function if exists public.current_business_member_id(uuid);
-- drop table if exists public.member_assignments;
-- alter table public.business_members drop constraint if exists business_members_role_check;
-- alter table public.business_members add constraint business_members_role_check
--   check (role in ('owner','admin','kasir','purchasing'));
-- alter table public.invites drop constraint if exists invites_role_check;
-- alter table public.invites add constraint invites_role_check
--   check (role in ('admin','kasir','purchasing'));
