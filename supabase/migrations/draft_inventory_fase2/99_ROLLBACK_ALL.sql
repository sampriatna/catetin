-- ============================================================================
-- DRAFT 99 — ROLLBACK ALL (urutan terbalik)
-- STATUS: JANGAN DIJALANKAN kecuali rollback disengaja setelah draft sempat diterapkan
-- Hanya menghapus objek modul inventory / assignment baru.
-- TIDAK menghapus app_state, transactions, wallets, business_members rows.
-- ============================================================================

-- 07
drop function if exists public.claim_pending_invites_v2();
drop function if exists public.accept_invite_v2(text);
drop function if exists public.upsert_member_assignment(uuid, text, uuid, text[], boolean);
drop function if exists public._location_id_for_outlet(uuid, text);
drop function if exists public._invite_default_permissions(text);
drop function if exists public._invite_legacy_member_role(text);

-- 06 views/functions
drop function if exists public.list_stock_movements_qty(uuid, uuid, int);
drop function if exists public.list_lot_quantities(uuid);
drop function if exists public.list_inventory_quantities(uuid);
drop view if exists public.inventory_valuation_view;
drop view if exists public.inventory_quantity_view;
drop function if exists public.is_outlet_inventory_actor(uuid, uuid);
drop function if exists public.is_inventory_valuer(uuid);
drop function if exists public.is_inventory_reader(uuid);
drop function if exists public.inventory_location_business_id(uuid);

-- 05
drop table if exists public.purchasing_transactions cascade;
drop function if exists public.validate_purchasing_tx_link_orphans(uuid);
drop function if exists public.prevent_unsafe_purchasing_link_mutation() cascade;
drop table if exists public.purchasing_tx_links cascade;
alter table if exists public.inventory_receipts
  drop constraint if exists inventory_receipts_purchase_order_id_fkey;
alter table if exists public.inventory_receipts
  drop constraint if exists inventory_receipts_purchase_request_id_fkey;
drop table if exists public.purchase_order_lines cascade;
drop table if exists public.purchase_orders cascade;
drop table if exists public.purchase_request_lines cascade;
drop table if exists public.purchase_requests cascade;
drop table if exists public.inventory_request_lines cascade;
drop table if exists public.inventory_requests cascade;

-- 04
drop table if exists public.inventory_receipt_lines cascade;
drop table if exists public.inventory_receipts cascade;
drop table if exists public.inventory_opening_locks cascade;
drop table if exists public.inventory_production_lines cascade;
drop table if exists public.inventory_productions cascade;
drop table if exists public.waste_records cascade;
drop function if exists public.inventory_in_transit_location_id(uuid);
drop table if exists public.stock_transfer_lines cascade;
drop table if exists public.stock_transfers cascade;
drop function if exists public.opname_line_requires_approval(uuid, numeric, numeric, numeric);
drop table if exists public.stock_opname_lines cascade;
drop table if exists public.stock_opnames cascade;

-- 03
drop function if exists public.reverse_stock_movement(uuid, text);
drop function if exists public.post_stock_movement(uuid);
drop function if exists public._apply_lot_balance_delta(uuid, uuid, numeric);
drop function if exists public._apply_balance_delta(uuid, uuid, numeric, numeric, boolean);
drop function if exists public.prevent_posted_movement_mutation() cascade;
drop table if exists public.stock_lot_balances cascade;
drop table if exists public.stock_balances cascade;
drop table if exists public.stock_movements cascade;

-- 02
drop function if exists public.ensure_fnb_inventory_locations(uuid);
alter table if exists public.member_assignments
  drop constraint if exists member_assignments_location_id_fkey;
drop table if exists public.inventory_item_audit_log cascade;
drop table if exists public.inventory_settings cascade;
drop table if exists public.inventory_lots cascade;
drop table if exists public.inventory_item_locations cascade;
drop table if exists public.inventory_items cascade;
drop table if exists public.inventory_locations cascade;

-- Restore stub can_access_location? (optional) — drop & recreate false-stub if 01 tetap
create or replace function public.can_access_location(p_location_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select false;
$$;

-- 01
drop policy if exists member_assignments_write on public.member_assignments;
drop policy if exists member_assignments_select on public.member_assignments;
drop function if exists public.has_permission(uuid, text, uuid);
drop function if exists public.has_assignment_role(uuid, text[]);
drop function if exists public.has_active_assignment(uuid, text, uuid);
drop function if exists public.current_business_member_id(uuid);
-- can_access_location dibiarkan stub atau di-drop:
-- drop function if exists public.can_access_location(uuid);
drop table if exists public.member_assignments cascade;

-- Kembalikan CHECK role lama (hanya jika TIDAK ada row dengan role 'member')
-- Preflight:
--   select count(*) from business_members where role = 'member';
--   select count(*) from invites where role not in ('admin','kasir','purchasing');
alter table public.business_members
  drop constraint if exists business_members_role_check;
alter table public.business_members
  add constraint business_members_role_check
  check (role in ('owner', 'admin', 'kasir', 'purchasing'));

alter table public.invites
  drop constraint if exists invites_role_check;
alter table public.invites
  add constraint invites_role_check
  check (role in ('admin', 'kasir', 'purchasing'));

-- set_updated_at mungkin dipakai objek lain — jangan drop kecuali yakin tidak dipakai
-- drop function if exists public.set_updated_at();
