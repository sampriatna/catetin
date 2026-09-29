-- ============================================================
-- NF3 Dapur — notifikasi langsung (pop-up + bunyi) untuk permintaan/kiriman stok & SO baru.
-- Menambahkan inv_transfers & inv_events ke publikasi Supabase Realtime.
-- Aman: Realtime tetap memakai RLS SELECT yang ada (is_business_member), jadi HP hanya
-- menerima perubahan milik bisnisnya sendiri. Tidak ada kolom/aturan data yang berubah.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inv_transfers') then
    alter publication supabase_realtime add table public.inv_transfers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inv_events') then
    alter publication supabase_realtime add table public.inv_events;
  end if;
end $$;
