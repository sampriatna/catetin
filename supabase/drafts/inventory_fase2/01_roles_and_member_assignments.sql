-- ============================================================================
-- DRAFT 01 — Roles + member_assignments (revisi putaran 3)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve file ini
--
-- GATE CUTOVER INVITE (WAJIB):
--   File ini MEMPERLUAS invites.role / business_members.role CHECK + assignments.
--   Apply cutover: 01 → 02 → 08 (staging dulu). RPC legacy tetap utuh.
--   Sebelum apply: role inventory BELUM ditampilkan/dibuat dari app legacy.
--   Setelah apply: smoke invite legacy WAJIB hijau; jika gagal → STOP + rollback.
--   Jangan deploy app v2 sebelum 01→02→08 ada. Lihat: INVITE_CUTOVER.md
-- ============================================================================

BEGIN;

DO $$
DECLARE bad int;
BEGIN
  select count(*) into bad from public.business_members
  where role not in ('owner','admin','kasir','purchasing','member');
  -- Izinkan 'member' jika draft sebelumnya sempat diuji di sandbox; di produksi bersih harus 0 role asing.
  select count(*) into bad from public.business_members
  where role not in ('owner','admin','kasir','purchasing','member');
  if bad > 0 then
    raise exception 'Preflight: business_members role tidak dikenal (%)', bad;
  end if;
END $$;

create or replace function public.inventory_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.inventory_set_updated_at() from public, anon, authenticated;

alter table public.business_members drop constraint if exists business_members_role_check;
alter table public.business_members
  add constraint business_members_role_check
  check (role in ('owner','admin','kasir','purchasing','member'));

alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites
  add constraint invites_role_check
  check (role in (
    'admin','kasir','purchasing','member',
    'dapur','bar','operasional_samtaro','forecasting_inventory'
  ));

create unique index if not exists uq_business_members_id_biz
  on public.business_members (id, business_id);

create table if not exists public.member_assignments (
  id                  uuid primary key default gen_random_uuid(),
  business_member_id  uuid not null
                      references public.business_members(id) on delete cascade,
  business_id         uuid not null references public.businesses(id) on delete cascade,
  role                text not null
                      check (role in (
                        'owner','admin','kasir','purchasing',
                        'dapur','bar','operasional_samtaro',
                        'forecasting_inventory','member'
                      )),
  location_id         uuid null,
  permissions         text[] not null default '{}',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint member_assignments_permissions_subset check (
    permissions <@ array[
      'receive_stock','opname_stock','request_stock','create_transfer',
      'receive_to_warehouse','manage_items','approve_opname_variance',
      'view_inventory','view_stock_value','edit_opname_threshold',
      'review_purchasing_link'
    ]::text[]
  ),
  -- Role outlet wajib location; forecasting wajib business-wide (null)
  constraint member_assignments_role_location_check check (
    (
      role in ('dapur','bar','kasir','operasional_samtaro')
      and location_id is not null
    )
    or (
      role = 'forecasting_inventory'
      and location_id is null
    )
    or (
      role in ('owner','admin','purchasing','member')
    )
  )
);

create or replace function public.member_assignments_sync_business()
returns trigger language plpgsql as $$
declare v_biz uuid;
begin
  select business_id into v_biz from public.business_members where id = new.business_member_id;
  if v_biz is null then raise exception 'business_member_id tidak valid'; end if;
  new.business_id := v_biz;
  return new;
end;
$$;
revoke all on function public.member_assignments_sync_business() from public, anon, authenticated;

drop trigger if exists trg_member_assignments_sync_biz on public.member_assignments;
create trigger trg_member_assignments_sync_biz
  before insert or update of business_member_id, business_id
  on public.member_assignments
  for each row execute function public.member_assignments_sync_business();

drop trigger if exists trg_member_assignments_updated on public.member_assignments;
create trigger trg_member_assignments_updated
  before update on public.member_assignments
  for each row execute function public.inventory_set_updated_at();

create unique index if not exists uq_member_assignments_bizwide
  on public.member_assignments (business_member_id, role)
  where location_id is null;

create unique index if not exists uq_member_assignments_location
  on public.member_assignments (business_member_id, role, location_id)
  where location_id is not null;

create unique index if not exists uq_member_assignments_id_biz
  on public.member_assignments (id, business_id);

create index if not exists idx_member_assignments_biz on public.member_assignments (business_id);

-- Helpers (SECURITY DEFINER) — grant hanya boolean untuk RLS
create or replace function public.current_business_member_id(p_business_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.id from public.business_members m
  where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  limit 1;
$$;

create or replace function public.has_active_assignment(
  p_business_id uuid, p_role text default null, p_location_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.member_assignments a
    join public.business_members m on m.id = a.business_member_id
    where m.business_id = p_business_id and m.user_id = auth.uid()
      and m.active and a.active and a.business_id = p_business_id
      and (p_role is null or a.role = p_role)
      and (p_location_id is null or a.location_id is null or a.location_id = p_location_id)
  );
$$;

create or replace function public.has_assignment_role(p_business_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.member_assignments a
    join public.business_members m on m.id = a.business_member_id
    where m.business_id = p_business_id and m.user_id = auth.uid()
      and m.active and a.active and a.role = any (p_roles)
  );
$$;

create or replace function public.has_permission(
  p_business_id uuid, p_permission text, p_location_id uuid default null
) returns boolean language sql stable security definer set search_path = public as $$
  select
    public.business_role(p_business_id) = 'owner'
    or (
      p_permission in ('view_inventory','view_stock_value','review_purchasing_link')
      and public.business_role(p_business_id) = 'admin'
    )
    or exists (
      select 1 from public.member_assignments a
      join public.business_members m on m.id = a.business_member_id
      where m.business_id = p_business_id and m.user_id = auth.uid()
        and m.active and a.active
        and p_permission = any (a.permissions)
        and (p_location_id is null or a.location_id is null or a.location_id = p_location_id)
    );
$$;

create or replace function public.can_access_location(p_location_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select false;
$$;

-- INTERNAL upsert — NO grant
create or replace function public.upsert_member_assignment(
  p_business_member_id uuid, p_role text, p_location_id uuid,
  p_permissions text[], p_active boolean default true
) returns public.member_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_biz uuid; v_row public.member_assignments;
begin
  select business_id into v_biz from public.business_members where id = p_business_member_id;
  if v_biz is null then raise exception 'business_member tidak ditemukan'; end if;

  -- Enforce role/location sebelum insert
  if p_role in ('dapur','bar','kasir','operasional_samtaro') and p_location_id is null then
    raise exception 'role % wajib location_id', p_role;
  end if;
  if p_role = 'forecasting_inventory' and p_location_id is not null then
    raise exception 'forecasting_inventory harus business-wide (location_id null)';
  end if;

  if p_location_id is null then
    insert into public.member_assignments (
      business_member_id, business_id, role, location_id, permissions, active
    ) values (p_business_member_id, v_biz, p_role, null, coalesce(p_permissions,'{}'), p_active)
    on conflict (business_member_id, role) where (location_id is null)
    do update set permissions = excluded.permissions, active = excluded.active, updated_at = now()
    returning * into v_row;
  else
    insert into public.member_assignments (
      business_member_id, business_id, role, location_id, permissions, active
    ) values (p_business_member_id, v_biz, p_role, p_location_id, coalesce(p_permissions,'{}'), p_active)
    on conflict (business_member_id, role, location_id) where (location_id is not null)
    do update set permissions = excluded.permissions, active = excluded.active, updated_at = now()
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke all on function public.current_business_member_id(uuid) from public, anon, authenticated;
revoke all on function public.has_active_assignment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.has_assignment_role(uuid, text[]) from public, anon, authenticated;
revoke all on function public.has_permission(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.can_access_location(uuid) from public, anon, authenticated;
revoke all on function public.upsert_member_assignment(uuid, text, uuid, text[], boolean)
  from public, anon, authenticated;

grant execute on function public.current_business_member_id(uuid) to authenticated;
grant execute on function public.has_active_assignment(uuid, text, uuid) to authenticated;
grant execute on function public.has_assignment_role(uuid, text[]) to authenticated;
grant execute on function public.has_permission(uuid, text, uuid) to authenticated;
grant execute on function public.can_access_location(uuid) to authenticated;

alter table public.member_assignments enable row level security;
drop policy if exists member_assignments_select on public.member_assignments;
create policy member_assignments_select on public.member_assignments
  for select using (public.is_business_member(business_id));
drop policy if exists member_assignments_write on public.member_assignments;
create policy member_assignments_write on public.member_assignments
  for all using (public.business_role(business_id) = 'owner')
  with check (public.business_role(business_id) = 'owner');

COMMIT;
