# Ringkasan objek draft (untuk review cepat)

## Perubahan CHECK role

| Tabel | Sebelum | Sesudah |
|---|---|---|
| `business_members.role` | owner, admin, kasir, purchasing | + **`member`** (netral) |
| `invites.role` | admin, kasir, purchasing | + member, dapur, bar, operasional_samtaro, forecasting_inventory |

`unique (business_id, user_id)` pada `business_members` **tidak diubah**.

## Tabel baru

| Tabel | Fungsi |
|---|---|
| `member_assignments` | Multi-role + permissions; FK `business_member_id` |
| `inventory_locations` | GUDANG/KBU/KSM/SMT/`IN_TRANSIT` |
| `inventory_items` | Master SKU + area + expiry/batch flags |
| `inventory_item_locations` | Enable + override min/target |
| `inventory_lots` | Batch/expiry (`expiry_unknown`) |
| `inventory_settings` | Threshold opname, dead stock, expiry tiers, PO min amount |
| `inventory_item_audit_log` | Audit master item |
| `stock_movements` | **Source of truth** ledger |
| `stock_balances` / `stock_lot_balances` | Cache via RPC saja |
| `stock_opnames` / `stock_opname_lines` | Opname |
| `stock_transfers` / `stock_transfer_lines` | Transfer + variance |
| `waste_records` | Waste terhubung movement |
| `inventory_productions` / `_lines` | Produksi sederhana |
| `inventory_opening_locks` | Struktur lock (go-live nanti) |
| `inventory_receipts` / `_lines` | Receive gudang + `cost_pending` |
| `inventory_requests` / `_lines` | Kebutuhan outlet |
| `purchase_requests` / `_lines` | PR wajib belanja normal |
| `purchase_orders` / `_lines` | PO kondisional |
| `purchasing_tx_links` | Jembatan app_state UUID ↔ PR/PO |
| `purchasing_transactions` | Skeleton migrasi keluar JSONB |

## Helper baru (legacy `business_role()` utuh)

- `current_business_member_id`
- `has_active_assignment` / `has_assignment_role` / `has_permission` / `can_access_location`
- `is_inventory_reader` / `is_inventory_valuer` / `is_outlet_inventory_actor`
- `post_stock_movement` / `reverse_stock_movement`
- `list_inventory_quantities` / `list_lot_quantities` / `list_stock_movements_qty`
- `accept_invite_v2` / `claim_pending_invites_v2` / `upsert_member_assignment`

## Partial unique indexes `member_assignments`

```sql
unique (business_member_id, role) where location_id is null
unique (business_member_id, role, location_id) where location_id is not null
```

## Akses qty vs nilai

| Path | Isi | Siapa |
|---|---|---|
| `list_inventory_quantities` | qty saja | reader lokasi |
| `inventory_valuation_view` / `stock_balances` RLS | qty + avg cost + value | owner, admin, forecasting |
| `list_stock_movements_qty` | histori tanpa cost | outlet + valuer |
