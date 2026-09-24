-- Compatibility bridge for stale clients that still PATCH app_state with an
-- embedded transactions array. Copy only changed transaction rows into the
-- split table, honor tombstones, then strip the embedded array before app_state
-- is persisted. This prevents role-filtered legacy payloads from replacing the
-- canonical transaction source.

create or replace function public.bridge_legacy_app_state_transactions_v2()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_changed integer := 0;
  v_deleted integer := 0;
  v_version text;
begin
  if new.data ? 'transactions' then
    with incoming as (
      select x.value->>'id' as tx_id, x.value as data
      from jsonb_array_elements(coalesce(new.data->'transactions', '[]'::jsonb)) as x(value)
      where x.value ? 'id' and nullif(x.value->>'id','') is not null
    ), changed as (
      select i.tx_id, i.data
      from incoming i
      left join public.app_transactions a
        on a.business_id = new.business_id
       and a.tx_id = i.tx_id
      where a.tx_id is null or a.data is distinct from i.data
    )
    insert into public.app_transactions (business_id, tx_id, data, updated_at)
    select new.business_id, c.tx_id, c.data, coalesce(new.updated_at, clock_timestamp())
    from changed c
    on conflict (business_id, tx_id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at
      where public.app_transactions.data is distinct from excluded.data;

    get diagnostics v_changed = row_count;

    if jsonb_typeof(new.data->'deletedTransactionIds') = 'array' then
      delete from public.app_transactions a
      where a.business_id = new.business_id
        and a.tx_id in (
          select value
          from jsonb_array_elements_text(new.data->'deletedTransactionIds')
        );
      get diagnostics v_deleted = row_count;
    end if;

    new.data := new.data - 'transactions';

    if v_changed > 0 or v_deleted > 0 then
      v_version := ((extract(epoch from clock_timestamp()) * 1000)::bigint)::text || '-legacy';
      new.data := jsonb_set(new.data, '{_txVersion}', to_jsonb(v_version), true);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bridge_legacy_app_state_transactions_v2 on public.app_state;
create trigger trg_bridge_legacy_app_state_transactions_v2
before insert or update of data on public.app_state
for each row
execute function public.bridge_legacy_app_state_transactions_v2();
