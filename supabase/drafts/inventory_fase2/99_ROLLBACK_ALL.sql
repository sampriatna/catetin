-- ============================================================================
-- DRAFT 99 — ROLLBACK ALL (aman: preflight dulu, baru DROP)
-- STATUS: JANGAN DIJALANKAN kecuali rollback disengaja
-- ============================================================================

BEGIN;

-- Preflight: hentikan SEBELUM DROP bila data baru sudah dipakai
DO $$
DECLARE
  c int;
BEGIN
  if to_regclass('public.business_members') is not null then
    select count(*) into c from public.business_members where role = 'member';
    if c > 0 then
      raise exception 'ROLLBACK DIBATALKAN: masih ada business_members.role=member (%)', c;
    end if;
  end if;

  if to_regclass('public.invites') is not null then
    select count(*) into c from public.invites
    where role in ('dapur','bar','operasional_samtaro','forecasting_inventory','member');
    if c > 0 then
      raise exception 'ROLLBACK DIBATALKAN: masih ada invite role baru (%)', c;
    end if;
  end if;

  if to_regclass('public.stock_movements') is not null then
    select count(*) into c from public.stock_movements where status = 'posted';
    if c > 0 then
      raise exception 'ROLLBACK DIBATALKAN: masih ada stock_movements posted (%)', c;
    end if;
  end if;

  if to_regclass('public.member_assignments') is not null then
    select count(*) into c from public.member_assignments where active;
    if c > 0 then
      raise exception 'ROLLBACK DIBATALKAN: masih ada member_assignments aktif (%)', c;
    end if;
  end if;
END $$;

-- Domain RPCs
drop function if exists public.owner_compensate_stock_movement(uuid, text);
drop function if exists public.post_inventory_opening(uuid, uuid, jsonb, uuid, text);
drop function if exists public.record_inventory_waste(uuid, uuid, uuid, uuid, text, numeric, text, text, uuid);
drop function if exists public.post_inventory_production(uuid, uuid);
drop function if exists public.post_stock_opname_if_no_approval(uuid, uuid);
drop function if exists public.approve_stock_opname(uuid, uuid);
drop function if exists public.submit_stock_opname(uuid, uuid);
drop function if exists public.finalize_inventory_receipt(uuid, uuid);
drop function if exists public.receive_stock_transfer(uuid, uuid, jsonb, text, text);
drop function if exists public.send_stock_transfer(uuid, uuid);
drop function if exists public._require_assignment(uuid, uuid, text, uuid);

-- Invite v2
drop function if exists public.claim_pending_invites_v2();
drop function if exists public.accept_invite_v2(text);
drop function if exists public._invite_default_permissions(text);
drop function if exists public._invite_legacy_member_role(text);

-- Quantity RPCs
drop function if exists public.list_transfer_lines_qty(uuid);
drop function if exists public.list_inventory_valuation(uuid);
drop function if exists public.list_stock_movements_qty(uuid, uuid, int);
drop function if exists public.list_lot_quantities(uuid);
drop function if exists public.list_inventory_quantities(uuid);
drop function if exists public.is_inventory_valuer(uuid);
drop function if exists public.is_inventory_reader(uuid);

-- Purchasing
drop function if exists public.validate_purchasing_tx_link_orphans(uuid);
drop function if exists public.purchasing_tx_links_prevent_delete() cascade;
drop function if exists public.purchasing_tx_links_validate() cascade;
drop function if exists public.purchase_lines_validate_parent() cascade;
drop table if exists public.purchasing_transactions cascade;
drop table if exists public.purchasing_tx_links cascade;
drop table if exists public.purchase_order_lines cascade;
drop table if exists public.purchase_orders cascade;
drop table if exists public.purchase_request_lines cascade;
drop table if exists public.purchase_requests cascade;
drop table if exists public.inventory_request_lines cascade;
drop table if exists public.inventory_requests cascade;

-- Opname / transfer / waste
drop table if exists public.inventory_receipt_lines cascade;
drop table if exists public.inventory_receipts cascade;
drop table if exists public.inventory_production_lines cascade;
drop table if exists public.inventory_productions cascade;
drop table if exists public.waste_records cascade;
drop table if exists public.stock_transfer_receipt_lines cascade;
drop table if exists public.stock_transfer_receipts cascade;
drop function if exists public.stock_transfer_lines_guard() cascade;
drop table if exists public.stock_transfer_lines cascade;
drop table if exists public.stock_transfers cascade;
drop function if exists public.inventory_in_transit_location_id(uuid);
drop function if exists public.stock_opnames_guard_status() cascade;
drop table if exists public.stock_opname_lines cascade;
drop table if exists public.stock_opnames cascade;

-- Ledger
drop function if exists public._create_compensating_adjustment(uuid, text, uuid);
drop function if exists public._post_stock_movement_internal(uuid);
drop function if exists public._apply_lot_balance_delta(uuid, uuid, uuid, numeric, boolean);
drop function if exists public._apply_balance_delta(uuid, uuid, uuid, numeric, numeric, boolean, boolean);
drop function if exists public.prevent_posted_movement_delete() cascade;
drop function if exists public.stock_movements_validate_row() cascade;
drop table if exists public.stock_lot_balances cascade;
drop table if exists public.stock_balances cascade;
drop table if exists public.stock_movements cascade;

-- Master
drop function if exists public._location_id_for_outlet(uuid, text);
drop function if exists public.inventory_is_go_live(uuid);
drop function if exists public.ensure_fnb_inventory_locations(uuid);
drop table if exists public.inventory_item_audit_log cascade;
drop table if exists public.inventory_opening_locks cascade;
drop table if exists public.inventory_business_state cascade;
drop table if exists public.inventory_settings cascade;
drop table if exists public.inventory_lots cascade;
drop table if exists public.inventory_item_locations cascade;
drop table if exists public.item_unit_conversions cascade;
drop table if exists public.inventory_items cascade;
drop table if exists public.inventory_locations cascade;
drop table if exists public.units cascade;
drop table if exists public.suppliers cascade;

-- Assignments / helpers
drop function if exists public.can_access_location(uuid);
drop function if exists public.has_permission(uuid, text, uuid);
drop function if exists public.has_assignment_role(uuid, text[]);
drop function if exists public.has_active_assignment(uuid, text, uuid);
drop function if exists public.current_business_member_id(uuid);
drop function if exists public.upsert_member_assignment(uuid, text, uuid, text[], boolean);
drop function if exists public.member_assignments_sync_business() cascade;
drop table if exists public.member_assignments cascade;
drop function if exists public.inventory_set_updated_at() cascade;

drop index if exists public.uq_business_members_id_biz;

-- Kembalikan CHECK role lama (aman karena preflight memastikan tidak ada role baru)
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

-- TIDAK meninggalkan stub can_access_location

COMMIT;
