-- ============================================================
-- NF3 — notifikasi saat HP terkunci (Web Push).
-- Satu baris per HP/browser yang menekan "Izinkan notifikasi".
-- * Hanya server (service role, lewat /api/push/*) yang membaca/menulis: server memeriksa login &
--   keanggotaan bisnis dulu. RLS aktif tanpa kebijakan = tertutup untuk akses langsung dari HP.
-- * HP yang dipakai bergantian akun: langganan dipindah ke akun yang terakhir mengaktifkan.
-- Tidak mengubah tabel lain.
-- ============================================================

begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_biz_idx on public.push_subscriptions (business_id);

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;

commit;
