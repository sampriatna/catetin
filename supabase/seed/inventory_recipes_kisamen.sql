-- Resep produksi dari sheet "Data Stok kisamen" → Bahan Olahan Produksi (HPP Kisamen).
-- Bahan yang belum ada dibuat dari "Master Bahan Baku Gudang" di sheet yang sama. Aman dijalankan ulang.
-- qty resep sudah dikonversi ke satuan master (mis. kecap ABC 1 drigen = 6 L, garam 1 pcs = 250 gr, telur 1 pcs ≈ 60 gr).

begin;

-- 1) Bahan & setengah jadi baru
insert into public.inv_items (business_id, kode, nama, kategori, tipe, satuan, harga, lokasi, min_stok, catatan)
select 'e23ed572-234c-4995-acad-fa6bff7c58d2'::uuid, v.* from (values
  ('AYMPAHA', 'Ayam Paha Fresh', 'Protein', 'bahan', 'gr', 45, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('AYMFILLET', 'Ayam Fillet', 'Protein', 'bahan', 'gr', 45, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('KULAYAM', 'Kulit Ayam', 'Protein', 'bahan', 'gr', 25, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('ROYCOJMR', 'Royco Kaldu Jamur', 'Bumbu', 'bahan', 'gr', 142.35, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('SOYJPG', 'Soy Sauce Jepang', 'Bumbu', 'bahan', 'ml', 6.194, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('DARKSOY', 'Dark Soy Sauce', 'Bumbu', 'bahan', 'ml', 88, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('PREMSOY', 'Premium Soy Sauce', 'Bumbu', 'bahan', 'ml', 100, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('CUKAAPEL', 'Cuka Apel', 'Bumbu', 'bahan', 'ml', 50, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('GARLICPWD', 'Garlic Powder', 'Bumbu', 'bahan', 'gr', 120, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('SICHUAN', 'Paper Sichuan', 'Bumbu', 'bahan', 'gr', 250, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('ROASTIP', 'Knorr Roastip', 'Bumbu', 'bahan', 'gr', 80, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('NGOHIONG', 'Ngohiong Bubuk', 'Bumbu', 'bahan', 'gr', 652.17, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('DJRKBBK', 'Daun Jeruk Bubuk', 'Bumbu', 'bahan', 'gr', 25, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('MASAKO', 'Masako', 'Bumbu', 'bahan', 'gr', 30, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('BROWNSGR', 'Brown Sugar', 'Bumbu', 'bahan', 'gr', 33, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('DSALAM', 'Daun Salam', 'Sayur', 'bahan', 'gr', 20, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('EBIBBK', 'Serbuk Ebi', 'Bumbu', 'bahan', 'gr', 110, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('EBI', 'Ebi', 'Protein', 'bahan', 'gr', 200, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('DJRK', 'Daun Jeruk', 'Sayur', 'bahan', 'gr', 25, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('TOMYUM', 'Knorr Tomyum', 'Bumbu', 'bahan', 'gr', 62.5, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('UBIUNGU', 'Ubi Ungu', 'Sayur', 'bahan', 'gr', 10, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('TOBIKO', 'Tobiko (grade A)', 'Protein', 'bahan', 'gr', 400, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('MENTAIPA', 'Saus Mentai Prima Agung', 'Bumbu', 'bahan', 'gr', 50, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('SAPIGLG', 'Daging Sapi Giling', 'Protein', 'bahan', 'gr', 125, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('PASTATOM', 'Pasta Tomat', 'Bumbu', 'bahan', 'gr', 40, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('OREGANO', 'Oregano', 'Bumbu', 'bahan', 'gr', 110, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('SALTPEPPER', 'Salt & Pepper', 'Bumbu', 'bahan', 'gr', 70, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('MINBAWANG', 'Minyak Bawang', 'Bumbu', 'bahan', 'gr', 35, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('CMBEAUTY', 'Cabai Merah Beauty', 'Sayur', 'bahan', 'gr', 55, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('CDOMBA', 'Cabai Domba', 'Sayur', 'bahan', 'gr', 60, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('CUKA', 'Cuka', 'Bumbu', 'bahan', 'ml', 23.85, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('JRKNIPIS', 'Jeruk Nipis', 'Sayur', 'bahan', 'gr', 25, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('TRUFOIL', 'Oil Truffle (Trivelli)', 'Bumbu', 'bahan', 'ml', 800, array['GDG']::text[], null::numeric, 'Dari Master Bahan Gudang (sheet HPP Kisamen)'),
  ('SHIOTARE', 'Shio Tare', 'Olahan', 'setengah_jadi', 'ml', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('SHOYUTARE', 'Shoyu Tare', 'Olahan', 'setengah_jadi', 'ml', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('MINDBWG', 'Minyak Daun Bawang', 'Olahan', 'setengah_jadi', 'ml', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('BMISO', 'Bumbu Miso', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('BSPICY', 'Bumbu Spicy', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('SMENTAI', 'Saus Mentai', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('SSPMAYO', 'Saus Spicy Mayo', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('BOLOGNESE', 'Saus Bolognese', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('SORIGINAL', 'Saus Original', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('SBAKARAN', 'Saus Bakaran', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('STARTAR', 'Saus Tartar', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('STRUFFLE', 'Saus Black Truffle', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('SEAFOAM', 'Sea Salt Foam', 'Olahan', 'setengah_jadi', 'gr', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('CARAMELSJ', 'Caramel (saus)', 'Olahan', 'setengah_jadi', 'ml', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi'),
  ('TOPBEEF', 'Topping Beef (porsi)', 'Olahan', 'setengah_jadi', 'porsi', 0, array['GDG','KSM']::text[], null::numeric, 'Hasil resep produksi (sheet HPP Kisamen) — modal dari produksi')
) as v(kode, nama, kategori, tipe, satuan, harga, lokasi, min_stok, catatan)
on conflict (business_id, kode) do nothing;

-- 2) Koreksi: Gula Pasir tercatat Rp19 per kg (seharusnya per gr) → Rp19.000/kg
update public.inv_items set harga = 19000, catatan = 'Dikoreksi: Rp19/gr = Rp19.000/kg (sheet HPP)', updated_at = now() where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'GLP' and harga = 19;

-- 3) Resep (hapus versi lama bernama sama supaya bisa dijalankan ulang)
delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Dimsum 50 pcs';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Dimsum 50 pcs', 50, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp64703'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'DIMSUM'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('AYMPAHA', 1000.0),
    ('BWP', 50.0),
    ('DBWG', 50.0),
    ('SATIR', 0.024),
    ('SAYAM', 12.0),
    ('MINJEN', 0.0129),
    ('MCN', 8.0),
    ('GRM', 0.048),
    ('TLR', 1.0417),
    ('TAPIOKA', 200.0),
    ('KULDIM', 0.5)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Gyoza 80 pcs';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Gyoza 80 pcs', 80, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp70463'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'GYOZA'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('AYMPAHA', 1000.0),
    ('BWP', 50.0),
    ('DBWG', 50.0),
    ('SATIR', 0.024),
    ('SAYAM', 12.0),
    ('MINJEN', 0.0129),
    ('MCN', 8.0),
    ('GRM', 0.048),
    ('TLR', 1.0417),
    ('TAPIOKA', 200.0),
    ('KULDIM', 0.8)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Udang Keju 85 pcs';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Udang Keju 85 pcs', 85, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp122953'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'UDANGKEJU'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('AYMPAHA', 1000.0),
    ('BAPUTG', 50.0),
    ('DBWG', 50.0),
    ('SATIR', 0.024),
    ('SAYAM', 12.0),
    ('MINJEN', 0.0129),
    ('MCN', 8.0),
    ('GRM', 0.048),
    ('TLR', 1.0417),
    ('TAPIOKA', 200.0),
    ('UDNG', 300.0),
    ('TEPROT', 200.0),
    ('KJUISI', 200.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Dimsum Goreng Keju Lumer 20 pcs';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Dimsum Goreng Keju Lumer 20 pcs', 20, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp97953'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'DIMSUMGRG'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('KJUISI', 200.0),
    ('KULUM', 20.0),
    ('AYMPAHA', 1000.0),
    ('BAPUTG', 50.0),
    ('DBWG', 50.0),
    ('SATIR', 0.024),
    ('SAYAM', 12.0),
    ('MINJEN', 0.0129),
    ('MCN', 8.0),
    ('GRM', 0.048),
    ('TLR', 1.0417),
    ('TAPIOKA', 200.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Paitan';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Paitan', 3.415, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp105579'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BPAITAN'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('DBWG', 200.0),
    ('KULAYAM', 1000.0),
    ('MINGOR', 800.0),
    ('BWP', 300.0),
    ('BWB', 700.0),
    ('JHE', 5.0),
    ('MCN', 60.0),
    ('GRM', 0.2),
    ('ABCASIN', 0.0083),
    ('KNORAY', 0.15),
    ('MINJEN', 0.0484),
    ('GLP', 0.05),
    ('KECIN', 0.0323)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Shoyu';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Shoyu', 926, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp17734'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BSHOYU'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('SOYJPG', 500.0),
    ('DARKSOY', 50.0),
    ('PREMSOY', 50.0),
    ('GLP', 0.06),
    ('MCN', 50.0),
    ('MRIN', 0.05),
    ('CUKAAPEL', 10.0),
    ('KULAYAM', 50.0),
    ('JHE', 5.0),
    ('GARLICPWD', 1.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Madara';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Madara', 3.229, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp127860'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BMADARA'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('BWP', 500.0),
    ('BWB', 30.0),
    ('KECMBRNG', 500.0),
    ('CMK', 600.0),
    ('CRS', 200.0),
    ('CKRG', 100.0),
    ('SICHUAN', 24.0),
    ('CBBK', 100.0),
    ('GRM', 0.1),
    ('KNORAY', 0.02),
    ('ROASTIP', 30.0),
    ('GLP', 0.04),
    ('MINGOR', 1000.0),
    ('ABCASIN', 0.0025),
    ('MINJEN', 0.0242),
    ('SATIR', 0.03)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Hashirama';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Hashirama', 2080, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp82728'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BHASHIRAMA'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('BWB', 500.0),
    ('BWP', 300.0),
    ('KMRI', 50.0),
    ('CIJO', 500.0),
    ('CJPN', 500.0),
    ('NGOHIONG', 20.0),
    ('GRM', 0.12),
    ('GLP', 0.045),
    ('ABCASIN', 0.0075),
    ('MINJEN', 0.0726),
    ('SATIR', 0.045),
    ('DJRKBBK', 45.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Tantamen';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Tantamen', 1515, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp46090'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BTANTAMEN'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('MINGOR', 1000.0),
    ('WIJEN', 500.0),
    ('GRM', 0.06)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Chili Oil';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Chili Oil', 1.891, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp82078'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'CHILIOIL'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('MASAKO', 15.0),
    ('MCN', 30.0),
    ('BROWNSGR', 30.0),
    ('GRM', 0.04),
    ('KNORAY', 0.015),
    ('ANSTR', 2.0),
    ('KYMNS', 8.0),
    ('CNGKH', 1.0),
    ('KPULG', 5.0),
    ('BWP', 100.0),
    ('SICHUAN', 15.0),
    ('MINGOR', 1000.0),
    ('DSALAM', 10.0),
    ('CKRG', 500.0),
    ('CBBK', 100.0),
    ('EBIBBK', 50.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Atomic';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Atomic', 8.52, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp65735'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BATOMIC'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('BWM', 40.0),
    ('BWP', 30.0),
    ('CMK', 30.0),
    ('CRS', 60.0),
    ('CKRG', 30.0),
    ('CBBK', 30.0),
    ('TRSI', 9.0),
    ('EBI', 30.0),
    ('LKS', 50.0),
    ('SRH', 20.0),
    ('DJRK', 10.0),
    ('SAYAM', 60.0),
    ('MCN', 90.0),
    ('GLP', 0.06),
    ('LDA', 20.0),
    ('SATIR', 0.06),
    ('GRM', 0.24),
    ('MINGOR', 1000.0),
    ('TOMYUM', 200.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Marinasi Telur Ajitama';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Marinasi Telur Ajitama', 50, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp86157'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'AJITAMA'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('ABCASIN', 0.0667),
    ('GLP', 0.25),
    ('MRIN', 0.05),
    ('TLR', 50.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Karage Topping';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Karage Topping', 3358, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp55484'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'KRGE'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('AYMFILLET', 1000.0),
    ('ABCASIN', 0.0037),
    ('JHE', 15.0),
    ('TPMZN', 250.0),
    ('BWP', 50.0),
    ('KNORAY', 0.014)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Susu Jagung (Cornmilk)';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Susu Jagung (Cornmilk)', 3907, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp11108'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'CORNMILK'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('JAGUNG', 0.5),
    ('SUSFRES', 0.3),
    ('GLP', 0.03),
    ('GRM', 0.012),
    ('SKM', 0.09)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Selai Ubee';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Selai Ubee', 1492, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp6553'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'UBEE'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('UBIUNGU', 500.0),
    ('GLP', 0.08),
    ('GRM', 0.008),
    ('SKM', 0.03)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Shio Tare';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Shio Tare', 1625, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp5623'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'SHIOTARE'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('KONBU', 3.0),
    ('GRM', 0.168),
    ('KNORAY', 0.042),
    ('ROYCOJMR', 28.0),
    ('SHITAKE', 5.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Shoyu Tare';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Shoyu Tare', 1508, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp14398'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'SHOYUTARE'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('ABCASIN', 0.15),
    ('KONBU', 3.0),
    ('SHITAKE', 5.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Minyak Daun Bawang';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Minyak Daun Bawang', 2500, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp49000'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'MINDBWG'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('MINGOR', 2000.0),
    ('DBWG', 500.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Miso';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Miso', 1072, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp45364'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BMISO'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('BWB', 250.0),
    ('BWP', 250.0),
    ('ABCASIN', 0.0047),
    ('AYMFILLET', 500.0),
    ('MINJEN', 0.0226),
    ('MISO', 30.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Bumbu Spicy';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Bumbu Spicy', 960, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp41905'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BSPICY'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('BWP', 60.0),
    ('MINDBWG', 250.0),
    ('CMK', 250.0),
    ('CRS', 250.0),
    ('BWB', 150.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Saus Mentai';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Saus Mentai', 747, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp52853'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'SMENTAI'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('KEWPIE', 0.5),
    ('DELTOM', 0.1),
    ('DELCHIL', 0.1),
    ('DELBBQ', 0.02),
    ('GARLICPWD', 2.0),
    ('TOBIKO', 20.0),
    ('MINJEN', 0.0081)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Saus Spicy Mayo';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Saus Spicy Mayo', 1550, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp53750'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'SSPMAYO'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('MAMAYO', 1.0),
    ('MENTAIPA', 500.0),
    ('GOURMET', 0.05)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Saus Bolognese';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Saus Bolognese', 693, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp47100'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'BOLOGNESE'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('SAPIGLG', 250.0),
    ('DELTOM', 0.2),
    ('PASTATOM', 20.0),
    ('BWB', 100.0),
    ('BWP', 50.0),
    ('MINGOR', 50.0),
    ('OREGANO', 5.0),
    ('SALTPEPPER', 8.0),
    ('GLP', 0.01)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Saus Original';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Saus Original', 100, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp4524'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'SORIGINAL'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('CMBEAUTY', 20.0),
    ('CMK', 20.0),
    ('CDOMBA', 15.0),
    ('BWP', 20.0),
    ('GLP', 0.01),
    ('GRM', 0.02),
    ('TPMZN', 5.0),
    ('CUKA', 5.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Saus Bakaran';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Saus Bakaran', 1010, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp41076'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'SBAKARAN'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('DELBBQ', 0.5),
    ('SATIR', 0.1),
    ('DELBPP', 0.1),
    ('GOURMET', 0.1),
    ('DELCHIL', 0.2),
    ('MINJEN', 0.0161)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Saus Tartar';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Saus Tartar', 368, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp11300'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'STARTAR'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('MAMAYO', 0.3),
    ('JRKNIPIS', 35.0),
    ('BWB', 15.0),
    ('PARSLEY', 10.0),
    ('GLP', 0.005),
    ('SALTPEPPER', 3.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Saus Black Truffle';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Saus Black Truffle', 54.75, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp3144'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'STRUFFLE'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('MAMAYO', 0.05),
    ('BTRUFBLACK', 1.0),
    ('BTRUFWHITE', 3.0),
    ('TRUFOIL', 0.75)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Sea Salt Foam';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Sea Salt Foam', 400, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp15500'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'SEAFOAM'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('Sea', 0.4),
    ('SUSFRES', 0.2)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Caramel (saus)';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Caramel (saus)', 650, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp6132'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'CARAMELSJ'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('GLA', 150.0)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

delete from public.inv_recipes where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and nama = 'Topping Beef';
with r as (
  insert into public.inv_recipes (business_id, output_item_id, nama, hasil_qty, catatan)
  select 'e23ed572-234c-4995-acad-fa6bff7c58d2', id, 'Topping Beef', 10, 'Dari sheet HPP Kisamen (Bahan Olahan Produksi), total sheet Rp58147'
  from public.inv_items where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and kode = 'TOPBEEF'
  returning id
)
insert into public.inv_recipe_lines (recipe_id, item_id, qty)
select r.id, i.id, v.qty from r, (values
    ('BEEF', 500.0),
    ('SATER', 0.07),
    ('ABCASIN', 0.0008),
    ('MINJEN', 0.0081)
) as v(kode, qty)
join public.inv_items i on i.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and i.kode = v.kode;

commit;
