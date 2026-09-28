-- ============================================================
-- NF3 Dapur — Tahap C: audit mingguan + catatan tindak lanjut
-- * inv_audit_reports: laporan audit per periode (angka + narasi AI), satu per periode per bisnis.
--   Dihitung ulang kapan saja dari data lama (SO tidak pernah diubah), jadi audit mundur bisa dibuat.
-- * inv_audit_notes: hasil pengecekan owner per temuan (wajar / perlu tindakan / selesai).
-- Hanya owner/admin.
-- ============================================================

begin;

create table if not exists public.inv_audit_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  dari date not null,
  sampai date not null check (sampai >= dari),
  data jsonb not null default '{}'::jsonb,
  narasi jsonb,
  sumber_narasi text,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, dari, sampai)
);

create table if not exists public.inv_audit_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  finding_key text not null,
  status text not null check (status in ('wajar', 'tindak', 'selesai')),
  catatan text,
  created_by uuid default auth.uid(),
  created_by_name text,
  updated_at timestamptz not null default now(),
  unique (business_id, finding_key)
);

alter table public.inv_audit_reports enable row level security;
alter table public.inv_audit_notes enable row level security;

drop policy if exists inv_audit_reports_owner on public.inv_audit_reports;
create policy inv_audit_reports_owner on public.inv_audit_reports
  for all
  using (public.business_role(business_id) in ('owner', 'admin'))
  with check (public.business_role(business_id) in ('owner', 'admin'));

drop policy if exists inv_audit_notes_owner on public.inv_audit_notes;
create policy inv_audit_notes_owner on public.inv_audit_notes
  for all
  using (public.business_role(business_id) in ('owner', 'admin'))
  with check (public.business_role(business_id) in ('owner', 'admin'));

commit;
