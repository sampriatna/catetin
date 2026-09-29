-- ============================================================================
-- DRAFT 99 — ROLLBACK ALL (revisi putaran 3)
-- Preflight: berhenti SEBELUM DROP jika TABEL BARU punya row apa pun
-- ============================================================================

BEGIN;

DO $$
DECLARE
  c bigint;
  tbl text;
  tables text[] := array[
    'stock_movement_compensations',
    'stock_movements',
    'stock_balances',
    'stock_lot_balances',
    'stock_transfer_variance_resolutions',
    'stock_transfer_receipt_lines',
    'stock_transfer_receipts',
    'stock_transfer_lines',
    'stock_transfers',
    'stock_opname_lines',
    'stock_opnames',
    'waste_records',
    'inventory_production_lines',
    'inventory_productions',
    'inventory_receipt_lines',
    'inventory_receipts',
    'inventory_opening_session_lines',
    'inventory_opening_sessions',
    'inventory_opening_locks',
    'inventory_request_lines',
    'inventory_requests',
    'purchase_order_lines',
    'purchase_orders',
    'purchase_request_lines',
    'purchase_requests',
    'purchasing_tx_links',
    'purchasing_transactions',
    'inventory_item_audit_log',
    'inventory_lots',
    'inventory_item_locations',
    'item_unit_conversions',
    'inventory_items',
    'inventory_locations',
    'inventory_settings',
    'inventory_business_state',
    'units',
    'suppliers',
    'member_assignments'
  ];
BEGIN
  if to_regclass('public.business_members') is not null then
    select count(*) into c from public.business_members where role = 'member';
    if c > 0 then
      raise exception 'ROLLBACK DIBATALKAN: business_members.role=member masih ada (%)', c;
    end if;
  end if;

  if to_regclass('public.invites') is not null then
    select count(*) into c from public.invites
    where role in ('dapur','bar','operasional_samtaro','forecasting_inventory','member');
    if c > 0 then
      raise exception 'ROLLBACK DIBATALKAN: invite role baru masih ada (%)', c;
    end if;
  end if;

  foreach tbl in array tables loop
    if to_regclass(format('public.%I', tbl)) is not null then
      execute format('select count(*) from public.%I', tbl) into c;
      if c > 0 then
        raise exception 'ROLLBACK DIBATALKAN: tabel %.% masih berisi % row — gunakan prosedur hapus data eksplisit, bukan CASCADE massal',
          'public', tbl, c;
      end if;
    end if;
  end loop;
END $$;

-- Domain RPCs (drop if exist)
drop function if exists public.save_inventory_receipt_lines(uuid, uuid, jsonb);
drop function if exists public.create_inventory_receipt_draft(uuid, uuid, text, uuid, uuid, uuid, text);
drop function if exists public.owner_compensate_stock_movement(uuid, text);
drop function if exists public.post_inventory_production(uuid, uuid);
drop function if exists public.record_inventory_waste(uuid, uuid, uuid, uuid, text, numeric, text, text, uuid);
drop function if exists public.activate_inventory_go_live(uuid);
drop function if exists public.post_inventory_opening(uuid, uuid);
drop function if exists public.create_opening_session(uuid, text, timestamptz);
drop function if exists public.post_stock_opname_if_no_approval(uuid, uuid);
drop function if exists public.approve_stock_opname(uuid, uuid);
drop function if exists public.submit_stock_opname(uuid, uuid);
drop function if exists public.save_stock_opname_lines(uuid, uuid, jsonb);
drop function if exists public.create_stock_opname_draft(uuid, uuid, text, uuid, text);
drop function if exists public.finalize_inventory_receipt(uuid, uuid);
drop function if exists public.mark_inventory_receipt_cost_pending(uuid);
drop function if exists public.resolve_transfer_variance(uuid, uuid, jsonb);
drop function if exists public.receive_stock_transfer(uuid, uuid, jsonb, text, text);
drop function if exists public.send_stock_transfer(uuid, uuid);
drop function if exists public.create_stock_transfer_draft(uuid, uuid, uuid, text, uuid, text, jsonb);
drop function if exists public.review_purchasing_tx_link(uuid, text, text);
drop function if exists public.create_purchasing_tx_link(uuid, text, text, text, uuid, uuid, uuid, uuid, text);
drop function if exists public._require_assignment(uuid, uuid, text, uuid);

drop function if exists public.claim_pending_invites_v2();
drop function if exists public.accept_invite_v2(text);
drop function if exists public._invite_default_permissions(text);
drop function if exists public._invite_legacy_member_role(text);

drop function if exists public.list_transfer_lines_qty(uuid);
drop function if exists public.list_inventory_valuation(uuid);
drop function if exists public.list_stock_movements_qty(uuid, uuid, int);
drop function if exists public.list_lot_quantities(uuid);
drop function if exists public.list_inventory_quantities(uuid);
drop function if exists public.is_inventory_valuer(uuid);
drop function if exists public.is_inventory_reader(uuid);

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

drop table if exists public.inventory_receipt_lines cascade;
drop table if exists public.inventory_receipts cascade;
drop table if exists public.inventory_production_lines cascade;
drop table if exists public.inventory_productions cascade;
drop table if exists public.waste_records cascade;
drop table if exists public.stock_transfer_variance_resolutions cascade;
drop table if exists public.stock_transfer_receipt_lines cascade;
drop table if exists public.stock_transfer_receipts cascade;
drop function if exists public.stock_transfer_lines_guard() cascade;
drop table if exists public.stock_transfer_lines cascade;
drop table if exists public.stock_transfers cascade;
drop function if exists public.inventory_in_transit_location_id(uuid);
drop function if exists public.stock_opname_lines_guard() cascade;
drop function if exists public.stock_opnames_guard_status() cascade;
drop table if exists public.stock_opname_lines cascade;
drop table if exists public.stock_opnames cascade;

drop function if exists public._create_compensating_adjustment(uuid, text, uuid);
drop function if exists public._post_stock_movement_internal(uuid);
drop function if exists public._apply_lot_balance_delta(uuid, uuid, uuid, numeric, boolean);
drop function if exists public._apply_balance_delta(uuid, uuid, uuid, numeric, numeric, boolean, boolean);
drop function if exists public.prevent_posted_movement_delete() cascade;
drop function if exists public.stock_movements_validate_row() cascade;
drop table if exists public.stock_movement_compensations cascade;
drop table if exists public.stock_lot_balances cascade;
drop table if exists public.stock_balances cascade;
drop table if exists public.stock_movements cascade;

drop function if exists public._location_id_for_outlet(uuid, text);
drop function if exists public.inventory_is_go_live(uuid);
drop function if exists public.ensure_fnb_inventory_locations(uuid);
drop function if exists public.inventory_line_validate_lot_trg() cascade;
drop function if exists public.inventory_validate_item_lot(uuid, uuid, uuid);
drop function if exists public.inventory_items_sync_stock_unit() cascade;
drop table if exists public.inventory_item_audit_log cascade;
drop table if exists public.inventory_opening_locks cascade;
drop table if exists public.inventory_opening_session_lines cascade;
drop table if exists public.inventory_opening_sessions cascade;
drop table if exists public.inventory_business_state cascade;
drop table if exists public.inventory_settings cascade;
drop table if exists public.inventory_lots cascade;
drop table if exists public.inventory_item_locations cascade;
drop table if exists public.item_unit_conversions cascade;
drop table if exists public.inventory_items cascade;
drop table if exists public.inventory_locations cascade;
drop table if exists public.units cascade;
drop table if exists public.suppliers cascade;

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

alter table public.business_members drop constraint if exists business_members_role_check;
alter table public.business_members
  add constraint business_members_role_check
  check (role in ('owner','admin','kasir','purchasing'));

alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites
  add constraint invites_role_check
  check (role in ('admin','kasir','purchasing'));

COMMIT;
