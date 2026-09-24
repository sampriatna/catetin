-- Recovery migration applied to production on 2026-09-24.
-- Keeps the categories schema aligned with lib/repo.js CATEGORY_SELECT.
-- Intentionally schema-only: does not delete, reset, or seed category data.

alter table public.categories
  add column if not exists accounting_group text default null,
  add column if not exists description text default null;

comment on column public.categories.accounting_group is
  'Kelompok akuntansi: hpp | beban_operasional | aset | pribadi | lain';

comment on column public.categories.description is
  'Panduan singkat untuk staf purchasing';

notify pgrst, 'reload schema';
