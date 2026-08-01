-- ============================================================================
-- DRAFT 08 — Invite / claim v2 (revisi putaran 3 — keamanan email)
-- STATUS: JANGAN DIJALANKAN sampai Owner approve
--
-- GATE CUTOVER INVITE (WAJIB):
--   Additive saja: membuat accept_invite_v2 / claim_pending_invites_v2.
--   Bergantung pada 01 (assignments/helpers) + 02 (location/outlet helpers).
--   Apply cutover: 01 → 02 → 08. JANGAN CREATE OR REPLACE / DROP
--   public.accept_invite / public.claim_pending_invites.
--   Setelah apply: smoke legacy dulu; baru deploy app v2 (feature flag).
--   Jika smoke legacy gagal → STOP + rollback. Lihat: INVITE_CUTOVER.md
-- ============================================================================

BEGIN;

create or replace function public._invite_legacy_member_role(p_invite_role text)
returns text language sql immutable as $$
  select case
    when p_invite_role in ('admin','kasir','purchasing') then p_invite_role
    else 'member'
  end;
$$;
revoke all on function public._invite_legacy_member_role(text) from public, anon, authenticated;

create or replace function public._invite_default_permissions(p_assignment_role text)
returns text[] language sql immutable as $$
  select case p_assignment_role
    when 'dapur' then array['opname_stock','request_stock','view_inventory']::text[]
    when 'bar' then array['opname_stock','request_stock','view_inventory']::text[]
    when 'operasional_samtaro' then array[
      'opname_stock','request_stock','view_inventory','receive_stock'
    ]::text[]
    when 'forecasting_inventory' then array[
      'view_inventory','view_stock_value','create_transfer',
      'receive_to_warehouse','manage_items','approve_opname_variance',
      'opname_stock','request_stock'
    ]::text[]
    when 'kasir' then array['view_inventory']::text[]
    when 'admin' then array['view_inventory','view_stock_value','review_purchasing_link']::text[]
    else array[]::text[]
  end;
$$;
revoke all on function public._invite_default_permissions(text) from public, anon, authenticated;

create or replace function public.accept_invite_v2(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invites;
  v_member public.business_members;
  v_existing public.business_members;
  v_legacy_role text;
  v_assign_role text;
  v_location_id uuid;
  v_needs_location boolean;
  v_assignment public.member_assignments;
  v_new_legacy text;
  v_email text;
begin
  if v_uid is null then raise exception 'Harus login dulu'; end if;

  select * into v_inv from public.invites
  where token = p_token and not accepted and expires_at > now()
  limit 1 for update;
  if v_inv.id is null then raise exception 'Undangan tidak valid atau sudah kadaluarsa'; end if;

  -- Email invite wajib cocok jika terisi
  if v_inv.email is not null and length(trim(v_inv.email)) > 0 then
    select email into v_email from public.profiles where id = v_uid;
    if v_email is null or lower(trim(v_email)) <> lower(trim(v_inv.email)) then
      raise exception 'Email akun login (%) tidak cocok dengan undangan (%)',
        coalesce(v_email,'(kosong)'), v_inv.email;
    end if;
  end if;

  v_assign_role := v_inv.role;
  v_legacy_role := public._invite_legacy_member_role(v_inv.role);
  v_needs_location := v_assign_role in ('dapur','bar','operasional_samtaro','kasir');

  v_location_id := null;
  if v_needs_location then
    if v_inv.outlet is null or trim(v_inv.outlet) = '' then
      raise exception 'Invite % wajib outlet/location', v_assign_role;
    end if;
    v_location_id := public._location_id_for_outlet(v_inv.business_id, v_inv.outlet);
    if v_location_id is null then
      raise exception 'Location untuk outlet % tidak ditemukan — invite gagal', v_inv.outlet;
    end if;
  end if;
  if v_assign_role = 'forecasting_inventory' then v_location_id := null; end if;

  select * into v_existing from public.business_members
  where business_id = v_inv.business_id and user_id = v_uid for update;

  if found then
    v_new_legacy := v_existing.role;
    if v_existing.role = 'member' and v_legacy_role in ('admin','kasir','purchasing') then
      v_new_legacy := v_legacy_role;
    elsif v_existing.role in ('kasir','purchasing') and v_legacy_role = 'admin' then
      v_new_legacy := 'admin';
    end if;

    update public.business_members
    set active = true,
        role = v_new_legacy,
        outlet = case
          when v_assign_role = 'kasir' and v_inv.outlet is not null then v_inv.outlet
          else public.business_members.outlet
        end
    where id = v_existing.id
    returning * into v_member;
  else
    insert into public.business_members (business_id, user_id, role, outlet, active)
    values (
      v_inv.business_id, v_uid, v_legacy_role,
      case when v_assign_role = 'kasir' then v_inv.outlet else null end,
      true
    ) returning * into v_member;
  end if;

  v_assignment := public.upsert_member_assignment(
    v_member.id, v_assign_role, v_location_id,
    public._invite_default_permissions(v_assign_role), true
  );

  update public.invites set accepted = true where id = v_inv.id;

  return jsonb_build_object('member', to_jsonb(v_member), 'assignment', to_jsonb(v_assignment));
end;
$$;
revoke all on function public.accept_invite_v2(text) from public, anon;
grant execute on function public.accept_invite_v2(text) to authenticated;

create or replace function public.claim_pending_invites_v2()
returns setof jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_email text; v_inv public.invites;
begin
  if v_uid is null then raise exception 'Harus login dulu'; end if;
  select email into v_email from public.profiles where id = v_uid;
  if v_email is null or trim(v_email) = '' then return; end if;
  for v_inv in
    select * from public.invites
    where lower(trim(email)) = lower(trim(v_email))
      and not accepted and expires_at > now()
    for update
  loop
    return next public.accept_invite_v2(v_inv.token);
  end loop;
end;
$$;
revoke all on function public.claim_pending_invites_v2() from public, anon;
grant execute on function public.claim_pending_invites_v2() to authenticated;

COMMIT;
