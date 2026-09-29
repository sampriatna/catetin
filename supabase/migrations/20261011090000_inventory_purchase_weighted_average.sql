-- ============================================================
-- NF3 Dapur — HPP bahan = rata-rata tertimbang 5 pembelian terakhir.
--
-- Setiap nota tetap menyimpan harga beli aktual pada inv_event_lines.harga.
-- Harga master inv_items.harga diperbarui otomatis setelah transaksi selesai:
--   sum(qty * harga aktual) / sum(qty)
-- dari maksimal 5 kejadian pembelian terbaru per bahan.
--
-- Constraint trigger dibuat deferred supaya hasil akhirnya tidak ditimpa lagi
-- oleh implementasi inv_submit_event pada migrasi sebelumnya. Semuanya tetap
-- berada di transaksi database yang sama.
-- ============================================================

begin;

create or replace function public.inv_refresh_purchase_avg_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_avg_cost numeric;
begin
  select e.business_id
  into v_business
  from public.inv_events e
  where e.id = new.event_id
    and e.jenis = 'masuk'
    and e.sumber = 'pembelian';

  if v_business is null
     or new.arah <> 'masuk'
     or coalesce(new.qty, 0) <= 0
     or coalesce(new.harga, 0) <= 0 then
    return null;
  end if;

  if public.business_role(v_business) not in ('owner', 'admin', 'purchasing') then
    raise exception 'HPP pembelian hanya boleh diperbarui owner/admin/purchasing';
  end if;

  -- Serialkan per bahan agar dua nota yang disimpan bersamaan tidak saling menimpa.
  perform 1
  from public.inv_items
  where id = new.item_id and business_id = v_business
  for update;

  select round(sum(r.purchase_value) / nullif(sum(r.purchase_qty), 0), 4)
  into v_avg_cost
  from (
    select
      e.id,
      sum(l.qty) as purchase_qty,
      sum(l.qty * l.harga) as purchase_value
    from public.inv_events e
    join public.inv_event_lines l on l.event_id = e.id
    where e.business_id = v_business
      and e.jenis = 'masuk'
      and e.sumber = 'pembelian'
      and l.item_id = new.item_id
      and l.arah = 'masuk'
      and l.qty > 0
      and l.harga > 0
    group by e.id, e.tanggal, e.created_at
    order by e.tanggal desc, e.created_at desc, e.id desc
    limit 5
  ) r;

  if v_avg_cost > 0 then
    update public.inv_items
    set harga = v_avg_cost,
        updated_at = now()
    where id = new.item_id
      and business_id = v_business
      and harga is distinct from v_avg_cost;
  end if;

  return null;
end;
$$;

revoke all on function public.inv_refresh_purchase_avg_cost() from public, anon, authenticated;

drop trigger if exists inv_event_lines_purchase_avg_cost on public.inv_event_lines;
create constraint trigger inv_event_lines_purchase_avg_cost
after insert or update of event_id, item_id, arah, qty, harga
on public.inv_event_lines
deferrable initially deferred
for each row
execute function public.inv_refresh_purchase_avg_cost();

comment on column public.inv_items.harga is
  'HPP per satuan. Bahan pembelian = rata-rata tertimbang maksimal 5 pembelian terbaru; hasil produksi = biaya batch produksi terakhir.';

commit;
