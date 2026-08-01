# Schema summary (revisi PR #3)

## Lokasi draft

`supabase/drafts/inventory_fase2/` — **bukan** `supabase/migrations/`.

## Objek utama

| Area | Objek |
|---|---|
| Membership | `member_assignments` + partial unique; role `member` pada `business_members` |
| Master | `inventory_locations` (+`IN_TRANSIT`), `inventory_items`, `inventory_item_locations`, `inventory_lots`, `suppliers`, `units`, `item_unit_conversions` |
| State | `inventory_settings`, `inventory_business_state` (sandbox/uat/go_live), `inventory_opening_locks` |
| Ledger | `stock_movements` (qty>0, from/to), `stock_balances`, `stock_lot_balances` |
| Transfer | `stock_transfers`, `stock_transfer_lines`, `stock_transfer_receipts`, `stock_transfer_receipt_lines` |
| Opname | `stock_opnames`, `stock_opname_lines` |
| Gudang | `inventory_receipts`, `inventory_receipt_lines`, `inventory_productions`, `waste_records` |
| Purchasing | `inventory_requests*`, `purchase_requests*`, `purchase_orders*`, `purchasing_tx_links` (`app_tx_id text`), `purchasing_transactions` |

## Domain RPC (granted ke authenticated)

- `send_stock_transfer`
- `receive_stock_transfer`
- `finalize_inventory_receipt`
- `submit_stock_opname`
- `approve_stock_opname`
- `post_stock_opname_if_no_approval`
- `post_inventory_production`
- `record_inventory_waste`
- `post_inventory_opening`
- `owner_compensate_stock_movement`
- `accept_invite_v2` / `claim_pending_invites_v2`
- Quantity: `list_inventory_quantities`, `list_lot_quantities`, `list_stock_movements_qty`, `list_transfer_lines_qty`
- Valuation: `list_inventory_valuation`

## Internal (REVOKE dari authenticated)

`_apply_balance_delta`, `_apply_lot_balance_delta`, `_post_stock_movement_internal`, `upsert_member_assignment`, `ensure_fnb_inventory_locations`, `_location_id_for_outlet`, `_create_compensating_adjustment`, `_require_assignment`, …

## Transfer movement model

```
Sent:     from=GUDANG → to=IN_TRANSIT   type=transfer_out   (1 movement / item)
Receive:  from=IN_TRANSIT → to=OUTLET   type=transfer_in    (1 movement / item / receipt qty)
```

Partial: histori di `stock_transfer_receipts` (+ lines), agregat `received_qty_total` di line.
