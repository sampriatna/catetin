-- ============================================================================
-- DRAFT 01 — Roles + member_assignments
-- STATUS: JANGAN DIJALANKAN sampai Owner approve file ini
-- Lokasi: supabase/drafts/ (bukan migrations/)
-- ============================================================================

BEGIN;

-- Preflight: pastikan hanya role legacy yang ada sebelum perluas CHECK
DO $$
DECLARE
  bad int;
BEGIN
  select count(*) into bad
  from public.business_members
  where role not in ('owner', 'admin', 'kasir', 'purchasing');
  if bad > 0 then
    raise exception 'Preflight gagal: business_members punya role di luar legacy (%)', bad;
  end if;

  select count(*) into bad
  from public.invites
  where role not in ('admin', 'kasir', 'purchasing');
  if bad > 0 then
    raise exception 'Preflight gagal: invites punya role di luar legacy (%) — bersihkan/approve dulu', bad;
  end if;
END $$;

-- ----------------------------------------------------------------------------
-- Helper updated_at khusus inventory (jangan timpa helper generik modul lain)
-- ----------------------------------------------------------------------------
create or replace function public.inventory_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.inventory_set_updated_at() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Perluas CHECK business_members (+ member netral)
-- unique (business_id, user_id) TETAP
-- ----------------------------------------------------------------------------
alter table public.business_members
  drop constraint if exists business_members_role_check;

alter table public.business_members
  add constraint business_members_role_check
  check (role in ('owner', 'admin', 'kasir', 'purchasing', 'member'));

comment on column public.business_members.role is
  'Legacy/keanggotaan bisnis. Role operasional inventory di member_assignments. member = netral tanpa akses modul legacy otomatis.';

alter table public.invites
  drop constraint if exists invites_role_check;

alter table public.invites
  add constraint invites_role_check
  check (role in (
    'admin', 'kasir', 'purchasing', 'member',
    'dapur', 'bar', 'operasional_samtaro', 'forecasting_inventory'
  ));

-- ----------------------------------------------------------------------------
-- Daftar permission resmi
-- ----------------------------------------------------------------------------
-- receive_stock, opname_stock, request_stock, create_transfer,
-- receive_to_warehouse, manage_items, approve_opname_variance,
-- view_inventory, view_stock_value, edit_opname_threshold,
-- review_purchasing_link

create table if not exists public.member_assignments (
  id                  uuid primary key default gen_random_uuid(),
  business_member_id  uuid not null
                      references public.business_members(id) on delete cascade,
  -- denormalized untuk composite integrity (diisi trigger / RPC)
  business_id         uuid not null references public.businesses(id) on delete cascade,
  role                text not null
                      check (role in (
                        'owner', 'admin', 'kasir', 'purchasing',
                        'dapur', 'bar', 'operasional_samtaro',
                        'forecasting_inventory', 'member'
                      )),
  location_id         uuid null, -- FK ke inventory_locations ditambah di 02
  permissions         text[] not null default '{}',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint member_assignments_permissions_subset check (
    permissions <@ array[
      'receive_stock',
      'opname_stock',
      'request_stock',
      'create_transfer',
      'receive_to_warehouse',
      'manage_items',
      'approve_opname_variance',
      'view_inventory',
      'view_stock_value',
      'edit_opname_threshold',
      'review_purchasing_link'
    ]::text[]
  )
);

comment on table public.member_assignments is
  'Multi-role operasional. FK business_member_id; business_id denormalized wajib sama dengan membership.';

-- Sync/validate business_id = business_members.business_id
create or replace function public.member_assignments_sync_business()
returns trigger
language plpgsql
as $$
declare
  v_biz uuid;
begin
  select business_id into v_biz
  from public.business_members
  where id = new.business_member_id;

  if v_biz is null then
    raise exception 'business_member_id tidak valid';
  end if;

  if new.business_id is distinct from v_biz then
    new.business_id := v_biz;
  end if;
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

create index if not exists idx_member_assignments_biz
  on public.member_assignments (business_id);

create index if not exists idx_member_assignments_member
  on public.member_assignments (business_member_id);

-- Unique (id, business_id) untuk composite FK dari tabel anak
create unique index if not exists uq_member_assignments_id_biz
  on public.member_assignments (id, business_id);

create unique index if not exists uq_business_members_id_biz
  on public.business_members (id, business_id);

-- ----------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER) — INTERNAL, tidak di-grant ke authenticated
-- business_role() LAMA TIDAK DIGANTI
-- ----------------------------------------------------------------------------
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
      and a.business_id = p_business_id
      and (p_role is null or a.role = p_role)
      and (
        p_location_id is null
        or a.location_id is null
        or a.location_id = p_location_id
      )
  );
$$;

create or replace function public.has_assignment_role(p_business_id uuid, p_roles text[])
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
      and m.active and a.active
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
    (
      public.business_role(p_business_id) = 'owner'
      and p_permission <> 'receive_stock'  -- owner punya semua kecuali dipaksa lewat acting outlet receive? Owner boleh semua termasuk receive di app; izinkan:
      or public.business_role(p_business_id) = 'owner'
    )
    or (
      p_permission in ('view_inventory', 'view_stock_value', 'review_purchasing_link')
      and public.business_role(p_business_id) = 'admin'
    )
    or exists (
      select 1
      from public.member_assignments a
      join public.business_members m on m.id = a.business_member_id
      where m.business_id = p_business_id
        and m.user_id = auth.uid()
        and m.active and a.active
        and p_permission = any (a.permissions)
        and (
          p_location_id is null
          or a.location_id is null
          or a.location_id = p_location_id
        )
    );
$$;

-- Fix has_permission owner logic (bersihkan OR ganda di atas) — replace bersih:
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
    public.business_role(p_business_id) = 'owner'
    or (
      p_permission in ('view_inventory', 'view_stock_value', 'review_purchasing_link')
      and public.business_role(p_business_id) = 'admin'
    )
    or exists (
      select 1
      from public.member_assignments a
      join public.business_members m on m.id = a.business_member_id
      where m.business_id = p_business_id
        and m.user_id = auth.uid()
        and m.active and a.active
        and p_permission = any (a.permissions)
        and (
          p_location_id is null
          or a.location_id is null
          or a.location_id = p_location_id
        )
    );
$$;

-- Stub; diganti di 02 setelah locations ada
create or replace function public.can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;

-- upsert INTERNAL — tidak di-grant; hanya dipanggil invite/owner RPC
create or replace function public.upsert_member_assignment(
  p_business_member_id uuid,
  p_role text,
  p_location_id uuid,
  p_permissions text[],
  p_active boolean default true
)
returns public.member_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz uuid;
  v_row public.member_assignments;
begin
  select business_id into v_biz
  from public.business_members where id = p_business_member_id;
  if v_biz is null then
    raise exception 'business_member tidak ditemukan';
  end if;

  if p_location_id is null then
    insert into public.member_assignments (
      business_member_id, business_id, role, location_id, permissions, active
    ) values (
      p_business_member_id, v_biz, p_role, null, coalesce(p_permissions, '{}'), p_active
    )
    on conflict (business_member_id, role) where (location_id is null)
    do update set
      permissions = excluded.permissions,
      active = excluded.active,
      updated_at = now()
    returning * into v_row;
  else
    insert into public.member_assignments (
      business_member_id, business_id, role, location_id, permissions, active
    ) values (
      p_business_member_id, v_biz, p_role, p_location_id, coalesce(p_permissions, '{}'), p_active
    )
    on conflict (business_member_id, role, location_id) where (location_id is not null)
    do update set
      permissions = excluded.permissions,
      active = excluded.active,
      updated_at = now()
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- REVOKE SEMUA helper ini dari client
revoke all on function public.current_business_member_id(uuid) from public, anon, authenticated;
revoke all on function public.has_active_assignment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.has_assignment_role(uuid, text[]) from public, anon, authenticated;
revoke all on function public.has_permission(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.can_access_location(uuid) from public, anon, authenticated;
revoke all on function public.upsert_member_assignment(uuid, text, uuid, text[], boolean) from public, anon, authenticated;

-- Helper permission boleh dipanggil dari RLS (evaluasi sebagai definer) — RLS tidak butuh GRANT execute ke authenticated untuk policy menggunakan fungsi di schema public... 
-- Di Postgres, RLS policies dijalankan sebagai pemilik tabel / dengan hak pemanggil; fungsi SECURITY DEFINER dipanggil jika EXECUTE diizinkan untuk role pemanggil.
-- Supabase: policy memakai auth.uid() dan fungsi harus EXECUTE untuk authenticated AGAR policy bisa memanggilnya.
-- Keputusan review: tutup SECURITY DEFINER dari authenticated untuk fungsi INTERNAL berbahaya.
-- Untuk has_permission / can_access_location yang dipakai RLS: tetap perlu GRANT EXECUTE ke authenticated
-- ATAU pakai policy yang tidak memanggilnya dari client context...
-- Reviewer minta: REVOKE ALL FROM authenticated, lalu grant HANYA RPC domain.
-- Jadi RLS harus memakai ekspresi yang tidak bergantung pada grant client, ATAU kita grant hanya helper baca yang dipakai RLS.
--
-- Kompromi aman sesuai review: grant EXECUTE hanya untuk helper boolean yang dipakai RLS (has_*, can_access_location, is_*),
-- BUKAN fungsi mutasi/internal (_apply_*, upsert_*, post_*, ensure_*).

grant execute on function public.current_business_member_id(uuid) to authenticated;
grant execute on function public.has_active_assignment(uuid, text, uuid) to authenticated;
grant execute on function public.has_assignment_role(uuid, text[]) to authenticated;
grant execute on function public.has_permission(uuid, text, uuid) to authenticated;
grant execute on function public.can_access_location(uuid) to authenticated;
-- upsert_member_assignment TETAP tanpa grant

alter table public.member_assignments enable row level security;

drop policy if exists member_assignments_select on public.member_assignments;
create policy member_assignments_select on public.member_assignments
  for select using (public.is_business_member(business_id));

drop policy if exists member_assignments_write on public.member_assignments;
create policy member_assignments_write on public.member_assignments
  for all using (public.business_role(business_id) = 'owner')
  with check (public.business_role(business_id) = 'owner');

COMMIT;
