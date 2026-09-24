-- Keep app_transactions as the canonical transaction source after the split.
-- save_app_state_v3 must never persist an embedded transactions array again.

create or replace function public.save_app_state_v3(
  p_business_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb default '{}'::jsonb,
  p_remove_keys text[] default '{}'::text[],
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
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb) - 'transactions';
begin
  if p_expected_updated_at is null then
    insert into public.app_state (business_id, data, updated_at)
    values (p_business_id, v_patch, v_updated_at)
    on conflict (business_id) do nothing
    returning updated_at into v_result;
  else
    update public.app_state
    set data = (((coalesce(data, '{}'::jsonb) - 'transactions') - coalesce(p_remove_keys, '{}'::text[])) || v_patch),
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

grant execute on function public.save_app_state_v3(uuid, timestamptz, jsonb, text[], jsonb, text[]) to authenticated;
revoke execute on function public.save_app_state_v3(uuid, timestamptz, jsonb, text[], jsonb, text[]) from anon;
