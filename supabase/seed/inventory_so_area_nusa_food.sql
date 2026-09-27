-- Jalankan SETELAH migrasi 20260928120000_inventory_dapur_roles.sql.
-- Area: akun dapur vs kasir/bar per outlet. Samtaro (SMT) tanpa area = satu akun untuk semua.
update public.inv_so_template set area = case
    when lokasi = 'KBU' and grup = 'Bar' then 'bar'
    when lokasi = 'KBU' then 'dapur'
    when lokasi = 'KSM' and grup = 'Minuman' then 'bar'
    when lokasi = 'KSM' then 'dapur'
    else null end
where business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2' and area is null and lokasi in ('KBU', 'KSM');
