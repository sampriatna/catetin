-- Split the large transactions array out of app_state.
-- The browser transport keeps the old app_state API shape for NF3App, while
-- saves persist only the compact core document plus changed transaction rows.

create table if not exists public.app_transactions (
  business_id uuid not null references public.businesses(id) on delete cascade,
  tx_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (business_id, tx_id)
);

alter table public.app_transactions enable row level security;

drop policy if exists app_transactions_select on public.app_transactions;
create policy app_transactions_select on public.app_transactions
for select using (public.is_business_member(business_id));

drop policy if exists app_transactions_insert on public.app_transactions;
create policy app_transactions_insert on public.app_transactions
for insert with check (public.is_business_member(business_id));

drop policy if exists app_transactions_update on public.app_transactions;
create policy app_transactions_update on public.app_transactions
for update using (public.is_business_member(business_id))
with check (public.is_business_member(business_id));

drop policy if exists app_transactions_delete on public.app_transactions;
create policy app_transactions_delete on public.app_transactions
for delete using (public.is_business_member(business_id));

insert into public.app_transactions (business_id, tx_id, data, updated_at)
select a.business_id, t.value->>'id', t.value, coalesce(a.updated_at, now())
from public.app_state a
cross join lateral jsonb_array_elements(coalesce(a.data->'transactions', '[]'::jsonb)) as t(value)
where t.value ? 'id' and nullif(t.value->>'id','') is not null
on conflict (business_id, tx_id) do update
set data = excluded.data,
    updated_at = excluded.updated_at;

create or replace function public.get_app_transactions(p_business_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(data order by tx_id), '[]'::jsonb)
  from public.app_transactions
  where business_id = p_business_id;
$$;

grant execute on function public.get_app_transactions(uuid) to authenticated;
revoke execute on function public.get_app_transactions(uuid) from anon;

create or replace function public.save_app_state_v2(
  p_business_id uuid,
  p_expected_updated_at timestamptz,
  p_data jsonb,
  p_tx_upserts jsonb default '[]'::jsonb,
  p_tx_delete_ids text[] default '{}'::text[]
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated_at timestamptz := clock_timestamp();
  v_result timestamptz;
begin
  if p_expected_updated_at is null then
    insert into public.app_state (business_id, data, updated_at)
    values (p_business_id, p_data, v_updated_at)
    on conflict (business_id) do nothing
    returning updated_at into v_result;
  else
    update public.app_state
    set data = p_data,
        updated_at = v_updated_at
    where business_id = p_business_id
      and updated_at = p_expected_updated_at
    returning updated_at into v_result;
  end if;

  if v_result is null then
    return null;
  end if;

  insert into public.app_transactions (business_id, tx_id, data, updated_at)
  select p_business_id, x.value->>'id', x.value, v_updated_at
  from jsonb_array_elements(coalesce(p_tx_upserts, '[]'::jsonb)) as x(value)
  where x.value ? 'id' and nullif(x.value->>'id','') is not null
  on conflict (business_id, tx_id) do update
  set data = excluded.data,
      updated_at = excluded.updated_at;

  if coalesce(array_length(p_tx_delete_ids, 1), 0) > 0 then
    delete from public.app_transactions
    where business_id = p_business_id
      and tx_id = any(p_tx_delete_ids);
  end if;

  return v_result;
end;
$$;

grant execute on function public.save_app_state_v2(uuid, timestamptz, jsonb, jsonb, text[]) to authenticated;
revoke execute on function public.save_app_state_v2(uuid, timestamptz, jsonb, jsonb, text[]) from anon;
