-- Tambahan SO Samtaro — 2026-10-01
-- Idempotent: aman dijalankan ulang.

begin;

-- Item baru yang belum punya master khusus.
insert into public.inv_items
  (business_id, kode, nama, kategori, tipe, satuan, harga, lokasi, min_stok, catatan)
values
  ('e23ed572-234c-4995-acad-fa6bff7c58d2', 'KOPIBUBUK', 'Bubuk Kopi', 'Beverage', 'bahan', 'gr', 0, array['GDG','SMT'], 0, 'Tambahan SO Samtaro 2026-10-01'),
  ('e23ed572-234c-4995-acad-fa6bff7c58d2', 'POWKEJU', 'Bubuk Keju', 'Bumbu', 'bahan', 'gr', 0, array['GDG','SMT'], 0, 'Tambahan SO Samtaro 2026-10-01')
on conflict (business_id, kode) do nothing;

-- Pastikan item existing bisa dipakai di lokasi SMT.
update public.inv_items i
set lokasi = (
  select array_agg(distinct x order by x)
  from unnest(coalesce(i.lokasi, '{}'::text[]) || array['SMT']::text[]) x
), updated_at = now()
where i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  and i.kode in (
    'KOPIBUBUK','GULCAIR','SKM','GLAB','POWMTCH','POWHZLNT','SUSFRES',
    'SMENTAI','SSPMAYO','SBAKARAN','CREMPREM','POWKEJU','ATOOM'
  )
  and not (coalesce(i.lokasi, '{}'::text[]) @> array['SMT']::text[]);

-- Tambah/rapikan baris SO Samtaro.
insert into public.inv_so_template
  (business_id, lokasi, item_id, label, grup, urut, satuan_so, isi, catatan, aktif, area)
select
  i.business_id, 'SMT', i.id, v.label, 'Stok', v.urut, v.satuan_so, 1, null, true, null
from (values
  ('KOPIBUBUK', 'Bubuk kopi',       50, 'gr'),
  ('GULCAIR',   'Gula cair',        60, 'gr'),
  ('SKM',       'SKM',              70, 'kg'),
  ('GLAB',      'Gula aren',        80, 'gr'),
  ('POWMTCH',   'Matcha',           90, 'gr'),
  ('POWHZLNT',  'Choco Hazelnut',  100, 'gr'),
  ('SUSFRES',   'Fresh milk',      110, 'l'),
  ('SMENTAI',   'Saos mentai',     120, 'gr'),
  ('SSPMAYO',   'Saos spicy mayo', 130, 'gr'),
  ('SBAKARAN',  'Saos bakaran',    140, 'gr'),
  ('CREMPREM',  'Creamer',         150, 'gr'),
  ('POWKEJU',   'Bubuk keju',      160, 'gr'),
  ('ATOOM',     'Atom bulan',       170, 'pcs')
) as v(kode, label, urut, satuan_so)
join public.inv_items i
  on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
 and i.kode = v.kode
on conflict (business_id, lokasi, label) do update
set item_id = excluded.item_id,
    grup = excluded.grup,
    urut = excluded.urut,
    satuan_so = excluded.satuan_so,
    isi = excluded.isi,
    aktif = true,
    area = null;

commit;
