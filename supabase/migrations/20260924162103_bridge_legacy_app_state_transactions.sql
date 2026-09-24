-- Keep legacy clients safe while they still PATCH the full app_state.transactions array.
-- Only runs when the incoming app_state document actually contains a transactions key.

create or replace function public.sync_legacy_app_state_transactions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not (new.data ? 'transactions') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.app_transactions (business_id, tx_id, data, updated_at)
    select new.business_id, x.value->>'id', x.value, coalesce(new.updated_at, now())
    from jsonb_array_elements(coalesce(new.data->'transactions', '[]'::jsonb)) as x(value)
    where x.value ? 'id' and nullif(x.value->>'id','') is not null
    on conflict (business_id, tx_id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at;
    return new;
  end if;

  with new_tx as (
    select x.value->>'id' as tx_id, x.value as data
    from jsonb_array_elements(coalesce(new.data->'transactions', '[]'::jsonb)) as x(value)
    where x.value ? 'id' and nullif(x.value->>'id','') is not null
  ), old_tx as (
    select x.value->>'id' as tx_id, x.value as data
    from jsonb_array_elements(coalesce(old.data->'transactions', '[]'::jsonb)) as x(value)
    where x.value ? 'id' and nullif(x.value->>'id','') is not null
  )
  insert into public.app_transactions (business_id, tx_id, data, updated_at)
  select new.business_id, n.tx_id, n.data, coalesce(new.updated_at, now())
  from new_tx n
  left join old_tx o using (tx_id)
  where o.tx_id is null or o.data is distinct from n.data
  on conflict (business_id, tx_id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at;

  with new_ids as (
    select x.value->>'id' as tx_id
    from jsonb_array_elements(coalesce(new.data->'transactions', '[]'::jsonb)) as x(value)
    where x.value ? 'id' and nullif(x.value->>'id','') is not null
  ), old_ids as (
    select x.value->>'id' as tx_id
    from jsonb_array_elements(coalesce(old.data->'transactions', '[]'::jsonb)) as x(value)
    where x.value ? 'id' and nullif(x.value->>'id','') is not null
  )
  delete from public.app_transactions a
  where a.business_id = new.business_id
    and a.tx_id in (
      select o.tx_id from old_ids o
      left join new_ids n using (tx_id)
      where n.tx_id is null
    );

  return new;
end;
$$;

drop trigger if exists trg_sync_legacy_app_state_transactions on public.app_state;
create trigger trg_sync_legacy_app_state_transactions
after insert or update of data on public.app_state
for each row
when (new.data ? 'transactions')
execute function public.sync_legacy_app_state_transactions();

-- Close the deployment gap: mirror any legacy transactions written after the first split migration.
insert into public.app_transactions (business_id, tx_id, data, updated_at)
select a.business_id, t.value->>'id', t.value, coalesce(a.updated_at, now())
from public.app_state a
cross join lateral jsonb_array_elements(coalesce(a.data->'transactions', '[]'::jsonb)) as t(value)
where t.value ? 'id' and nullif(t.value->>'id','') is not null
on conflict (business_id, tx_id) do update
set data = excluded.data,
    updated_at = excluded.updated_at;
