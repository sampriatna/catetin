# Schema summary — putaran 3

Lokasi: `supabase/drafts/inventory_fase2/` (bukan `migrations/`).

## Domain RPC (granted)

**Purchasing:** `create_purchasing_tx_link`, `review_purchasing_tx_link`  
**Transfer:** `create_stock_transfer_draft`, `send_stock_transfer`, `receive_stock_transfer`, `resolve_transfer_variance`  
**Receipt:** `create_inventory_receipt_draft`, `save_inventory_receipt_lines`, `mark_inventory_receipt_cost_pending`, `finalize_inventory_receipt`  
**Opname:** `create_stock_opname_draft`, `save_stock_opname_lines`, `submit_stock_opname`, `approve_stock_opname`, `post_stock_opname_if_no_approval`  
**Opening/go-live:** `create_opening_session`, `post_inventory_opening`, `activate_inventory_go_live`  
**Lain:** `record_inventory_waste`, `post_inventory_production`, `owner_compensate_stock_movement`  
**Qty/valuation:** `list_inventory_quantities`, `list_lot_quantities`, `list_stock_movements_qty`, `list_transfer_lines_qty`, `list_inventory_valuation`  
**Invite:** `accept_invite_v2`, `claim_pending_invites_v2`

## Internal (no grant)

`_apply_balance_delta`, `_apply_lot_balance_delta`, `_post_stock_movement_internal`, `_create_compensating_adjustment`, `upsert_member_assignment`, `ensure_fnb_inventory_locations`, `_location_id_for_outlet`, `_require_assignment`, …

## Transfer model

```
Sent:    from → IN_TRANSIT   transfer_out   (1 movement/item)
Receive: IN_TRANSIT → outlet transfer_in    (receive_stock_transfer + receive_stock)
Residual IN_TRANSIT → resolve_transfer_variance
         (returned_to_source / damaged / shrinkage / adjustment_approved)
         — BUKAN received_later; penerimaan lanjutan tetap lewat receive outlet
```

## Invite

- Legacy: `accept_invite` / `claim_pending_invites` — **tetap** (tidak diganti di draft)
- Baru: `accept_invite_v2` / `claim_pending_invites_v2` — additive
- Gate apply `01`/`08`: lihat `INVITE_CUTOVER.md`

## Compensation

`stock_movement_compensations(original, compensating)` — tidak mengubah row posted.
