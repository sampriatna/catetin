-- ============================================================
-- NF3 Dapur — akun dapur outlet boleh kelola resep menu, daftar SO, dan bahan KHUSUS outletnya.
-- * inv_menus / inv_menu_lines: menu di lokasi = outlet akun.
-- * inv_so_template: baris di lokasi = outlet akun, bagian dapur atau tanpa bagian (bukan bar).
-- * inv_items: tambah/ubah/hapus hanya bahan yang lokasinya persis outlet itu; bahan bersama
--   (mis. GDG+KBU+KSM) tetap hanya bisa diubah owner/admin/purchasing.
-- Kebijakan lama (owner/admin/purchasing) tidak berubah; ini kebijakan tambahan (OR).
-- ============================================================

begin;

drop policy if exists inv_menus_write_dapur on public.inv_menus;
create policy inv_menus_write_dapur on public.inv_menus for all
  using (public.business_role(business_id) = 'dapur' and lokasi = upper(coalesce(public.business_outlet(business_id), '')))
  with check (public.business_role(business_id) = 'dapur' and lokasi = upper(coalesce(public.business_outlet(business_id), '')));

drop policy if exists inv_menu_lines_write_dapur on public.inv_menu_lines;
create policy inv_menu_lines_write_dapur on public.inv_menu_lines for all
  using (
    public.business_role(business_id) = 'dapur'
    and exists (select 1 from public.inv_menus m where m.id = menu_id and m.business_id = inv_menu_lines.business_id
                and m.lokasi = upper(coalesce(public.business_outlet(m.business_id), '')))
  )
  with check (
    public.business_role(business_id) = 'dapur'
    and exists (select 1 from public.inv_menus m where m.id = menu_id and m.business_id = inv_menu_lines.business_id
                and m.lokasi = upper(coalesce(public.business_outlet(m.business_id), '')))
  );

drop policy if exists inv_so_template_write_dapur on public.inv_so_template;
create policy inv_so_template_write_dapur on public.inv_so_template for all
  using (public.business_role(business_id) = 'dapur' and lokasi = upper(coalesce(public.business_outlet(business_id), ''))
         and (area is null or area = 'dapur'))
  with check (public.business_role(business_id) = 'dapur' and lokasi = upper(coalesce(public.business_outlet(business_id), ''))
         and (area is null or area = 'dapur'));

drop policy if exists inv_items_write_dapur on public.inv_items;
create policy inv_items_write_dapur on public.inv_items for all
  using (public.business_role(business_id) = 'dapur' and lokasi = array[upper(coalesce(public.business_outlet(business_id), ''))])
  with check (public.business_role(business_id) = 'dapur' and lokasi = array[upper(coalesce(public.business_outlet(business_id), ''))]);

commit;
