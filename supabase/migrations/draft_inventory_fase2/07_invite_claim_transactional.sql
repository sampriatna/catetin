-- ============================================================================
-- DRAFT 07 — Invite / claim transactional (members + assignments)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve + app siap
-- Prerequisite: 01–02 (locations optional untuk location_id assignment)
--
-- TIDAK mengganti business_role().
-- TIDAK menghapus unique (business_id, user_id) pada business_members.
-- Mengganti accept_invite / claim_pending_invites HANYA setelah review.
-- ============================================================================

-- Mapping role undangan → (business_members.role, assignment.role, default permissions)
-- drapur/bar/ops/forecasting → business_members.role = 'member' (netral)
-- kasir/purchasing/admin tetap legacy role pada business_members

create or replace function public._invite_legacy_member_role(p_invite_role text)
returns text
language sql
immutable
as $$
  select case
    when p_invite_role in ('admin', 'kasir', 'purchasing') then p_invite_role
    when p_invite_role in ('dapur', 'bar', 'operasional_samtaro', 'forecasting_inventory', 'member')
      then 'member'
    else 'member'
  end;
$$;

create or replace function public._invite_default_permissions(p_assignment_role text)
returns text[]
language sql
immutable
as $$
  select case p_assignment_role
    when 'dapur' then array['opname_stock', 'request_stock', 'view_inventory']::text[]
    when 'bar' then array['opname_stock', 'request_stock', 'view_inventory']::text[]
    when 'operasional_samtaro' then array['opname_stock', 'request_stock', 'view_inventory', 'receive_stock']::text[]
    when 'forecasting_inventory' then array[
      'view_inventory', 'view_stock_value', 'create_transfer',
      'receive_to_warehouse', 'manage_items', 'approve_opname_variance',
      'opname_stock', 'request_stock'
    ]::text[]
    when 'kasir' then array[]::text[]  -- receive_stock ditambah eksplisit oleh Owner
    else array[]::text[]
  end;
$$;

-- Resolve location dari outlet code undangan
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
    and (
      outlet_code = p_outlet
      or code = p_outlet
    )
    and is_active
  limit 1;
$$;

-- Upsert assignment menghormati partial unique indexes
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
  v_row public.member_assignments;
begin
  if p_location_id is null then
    insert into public.member_assignments (
      business_member_id, role, location_id, permissions, active
    ) values (
      p_business_member_id, p_role, null, coalesce(p_permissions, '{}'), p_active
    )
    on conflict (business_member_id, role) where (location_id is null)
    do update set
      permissions = excluded.permissions,
      active = excluded.active,
      updated_at = now()
    returning * into v_row;
  else
    insert into public.member_assignments (
      business_member_id, role, location_id, permissions, active
    ) values (
      p_business_member_id, p_role, p_location_id, coalesce(p_permissions, '{}'), p_active
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

-- ----------------------------------------------------------------------------
-- accept_invite_v2 — transactional members + assignment
-- (biarkan accept_invite lama tetap ada sampai cutover)
-- ----------------------------------------------------------------------------
create or replace function public.accept_invite_v2(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invites;
  v_member public.business_members;
  v_legacy_role text;
  v_assign_role text;
  v_location_id uuid;
  v_assignment public.member_assignments;
begin
  if v_uid is null then
    raise exception 'Harus login dulu';
  end if;

  select * into v_inv
  from public.invites
  where token = p_token and not accepted and expires_at > now()
  limit 1
  for update;

  if v_inv.id is null then
    raise exception 'Undangan tidak valid atau sudah kadaluarsa';
  end if;

  v_legacy_role := public._invite_legacy_member_role(v_inv.role);
  v_assign_role := v_inv.role;

  -- Satu membership bisnis (unique business_id, user_id tetap)
  insert into public.business_members (business_id, user_id, role, outlet, active)
  values (v_inv.business_id, v_uid, v_legacy_role, v_inv.outlet, true)
  on conflict (business_id, user_id)
  do update set
    active = true,
    -- Jangan turunkan owner/admin yang sudah ada hanya karena invite staf
    role = case
      when public.business_members.role in ('owner', 'admin') then public.business_members.role
      else excluded.role
    end,
    outlet = coalesce(excluded.outlet, public.business_members.outlet)
  returning * into v_member;

  v_location_id := null;
  if v_assign_role in ('dapur', 'bar', 'operasional_samtaro', 'kasir') then
    v_location_id := public._location_id_for_outlet(v_inv.business_id, v_inv.outlet);
  end if;

  -- forecasting: business-wide (location null)
  if v_assign_role = 'forecasting_inventory' then
    v_location_id := null;
  end if;

  -- Assignment untuk role inventory / mirror kasir bila diundang sebagai kasir+permission later
  if v_assign_role in (
    'dapur', 'bar', 'operasional_samtaro', 'forecasting_inventory', 'kasir', 'purchasing', 'admin', 'member'
  ) then
    v_assignment := public.upsert_member_assignment(
      v_member.id,
      v_assign_role,
      v_location_id,
      public._invite_default_permissions(v_assign_role),
      true
    );
  end if;

  update public.invites set accepted = true where id = v_inv.id;

  return jsonb_build_object(
    'member', to_jsonb(v_member),
    'assignment', to_jsonb(v_assignment)
  );
end;
$$;

grant execute on function public.accept_invite_v2(text) to authenticated;

-- ----------------------------------------------------------------------------
-- claim_pending_invites_v2
-- ----------------------------------------------------------------------------
create or replace function public.claim_pending_invites_v2()
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.invites;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Harus login dulu';
  end if;

  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or trim(v_email) = '' then
    return;
  end if;

  for v_inv in
    select * from public.invites
    where lower(trim(email)) = lower(trim(v_email))
      and not accepted
      and expires_at > now()
    for update
  loop
    v_result := public.accept_invite_v2(v_inv.token);
    return next v_result;
  end loop;
end;
$$;

grant execute on function public.claim_pending_invites_v2() to authenticated;

-- Catatan cutover aplikasi:
-- 1) Deploy app yang memanggil accept_invite_v2 / claim_pending_invites_v2
-- 2) Baru redirect RPC lama → v2 (opsional create or replace accept_invite wrapping v2)
-- 3) Jangan drop accept_invite lama di hari yang sama tanpa smoke test login staf

-- ----------------------------------------------------------------------------
-- ROLLBACK cuplikan
-- ----------------------------------------------------------------------------
-- drop function if exists public.claim_pending_invites_v2();
-- drop function if exists public.accept_invite_v2(text);
-- drop function if exists public.upsert_member_assignment(uuid, text, uuid, text[], boolean);
-- drop function if exists public._location_id_for_outlet(uuid, text);
-- drop function if exists public._invite_default_permissions(text);
-- drop function if exists public._invite_legacy_member_role(text);
