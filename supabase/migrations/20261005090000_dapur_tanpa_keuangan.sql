-- ============================================================
-- Akun dapur outlet tidak memakai modul keuangan → tidak boleh membaca/mengubah data uang.
-- Kebijakan RESTRICTIVE (di-AND dengan kebijakan lama); role lain tidak berubah.
-- Modul Dapur tidak memakai tabel-tabel ini (dashboard mengarahkan role dapur ke /dapur).
-- ============================================================

begin;

drop policy if exists app_state_no_dapur on public.app_state;
create policy app_state_no_dapur on public.app_state as restrictive for all
  using (public.business_role(business_id) is distinct from 'dapur')
  with check (public.business_role(business_id) is distinct from 'dapur');

drop policy if exists app_transactions_no_dapur on public.app_transactions;
create policy app_transactions_no_dapur on public.app_transactions as restrictive for all
  using (public.business_role(business_id) is distinct from 'dapur')
  with check (public.business_role(business_id) is distinct from 'dapur');

drop policy if exists transaction_drafts_no_dapur on public.transaction_drafts;
create policy transaction_drafts_no_dapur on public.transaction_drafts as restrictive for all
  using (public.business_role(business_id) is distinct from 'dapur')
  with check (public.business_role(business_id) is distinct from 'dapur');

drop policy if exists transactions_no_dapur on public.transactions;
create policy transactions_no_dapur on public.transactions as restrictive for all
  using (public.business_role(business_id) is distinct from 'dapur')
  with check (public.business_role(business_id) is distinct from 'dapur');

commit;
