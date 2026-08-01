# SECURITY_TEST_PLAN — Inventory draft (review-only)

**Jangan jalankan di produksi tanpa sandbox terisolasi.**  
Rencana ini untuk UAT/review setelah migration disetujui & diterapkan di environment uji.

## Setup sandbox

1. Dua bisnis: A (F&B) dan B (dummy).
2. User: Owner A, Admin A, Purchasing A, Kasir KBU A, Dapur KBU A, Bar KBU A, Forecasting A, Receiver KBU A (`receive_stock`), User bisnis B.
3. Seed lokasi A via **RPC owner-only / service role** memanggil `ensure_fnb_inventory_locations` (fungsi tidak di-grant ke authenticated).
4. Jangan gunakan data produksi.

## Kasus wajib

### 1) Isolasi lintas bisnis
- User A mencoba SELECT/INSERT item/lokasi bisnis B → **deny**.
- Composite FK: assignment location bisnis B ke member A → **gagal**.
- Movement item A + location B → **gagal**.

### 2) Outlet tidak bisa baca cost
Sebagai Dapur/Bar/Kasir/Receiver (bukan valuer):

| Target | Harapan |
|---|---|
| `select * from stock_balances` | 0 row / deny |
| `select * from inventory_lots` | deny (ada `initial_unit_cost`) |
| `select * from stock_movements` | deny |
| `select * from stock_transfer_lines` | deny |
| `select * from waste_records` | deny |
| `select difference_value from stock_opname_lines` | deny |
| `list_inventory_quantities(biz)` | OK, tanpa cost |
| `list_transfer_lines_qty(transfer)` | OK, tanpa `unit_cost` |
| `list_inventory_valuation(biz)` | **forbidden** |

### 3) Receiver tidak ubah sent_qty
- `update stock_transfer_lines set sent_qty = …` langsung → gagal (guard / no policy).
- `receive_stock_transfer` hanya menerima `received_qty`, `variance_reason`, `photo`.
- Mencoba ubah `item_id` / `lot_id` / `unit_cost` via client → gagal.

### 4) Forecasting tidak receive atas nama outlet
- User forecasting panggil `receive_stock_transfer` → **exception**.
- User forecasting panggil `send_stock_transfer` → OK (punya `create_transfer`).

### 5) Authenticated tidak panggil fungsi internal
Harus gagal permission untuk:

- `_apply_balance_delta`
- `_apply_lot_balance_delta`
- `_post_stock_movement_internal`
- `upsert_member_assignment`
- `ensure_fnb_inventory_locations`
- `_location_id_for_outlet`
- `_create_compensating_adjustment`
- `_require_assignment`

### 6) Draft tidak jadi posted dari client
- `insert into stock_movements (..., status='posted')` → gagal trigger.
- `update stock_movements set status='posted'` tanpa `inventory.posting` → gagal.
- Tanpa policy write: insert draft langsung oleh authenticated → deny.

### 7) Stok negatif
- Setelah `lifecycle=go_live`, outbound melebihi qty → exception.
- Lot quantity negatif → exception.
- Outbound tanpa `average_cost` sumber → exception.

### 8) Multi-role invite tidak turunkan legacy
- User kasir KBU terima invite dapur KBU → `business_members.role` tetap `kasir`; assignment dapur bertambah.
- User owner terima invite forecasting → role tetap `owner`, bukan `member`.
- User member-only (forecasting) → `business_members.role=member`.

### 9) Missing location → invite gagal
- Invite dapur outlet `XYZ` tanpa lokasi → `accept_invite_v2` exception.
- Tidak boleh jadi assignment business-wide.

### 10) app_tx_id non-UUID
- Link `app_tx_id = 'imp_abc123'` + `source_system='app_state'` → sukses.
- Orphan validator bandingkan text equality.

### 11) PR/PO link rules
- `from_pr` dengan `purchase_order_id` set → CHECK gagal.
- `from_po` tanpa PR → gagal.
- `direct` tanpa reason → gagal; `review_status` awal `pending_review`.
- PR line asing → trigger gagal.
- Admin insert link baru → deny (hanya purchasing/owner create).
- `locked=true` lalu `locked=false` → gagal.
- Approved link delete → gagal.

### 12) Opname
- Client kirim `requires_approval=false` palsu → server hitung ulang di `submit_stock_opname`.
- Selisih 8% / Rp20rb → approval; 2% / Rp300rb → approval; 2% / Rp20rb → tidak.
- Forecasting approve opname sendiri → gagal.
- Warehouse opname forecasting → wajib Owner.
- Edit/hapus submitted langsung → gagal.

### 13) Transfer satu kaki + partial receipt
- Send: 1 movement/item `from→IN_TRANSIT` `transfer_out`.
- Receive 9 dari 10: receipt lines histori; sisa 1 tetap di IN_TRANSIT.
- Receive kedua mencatat receipt terpisah.

### 14) Rollback aman
- Dengan posted movement / active assignment / role member: jalankan `99_ROLLBACK_ALL` → **berhenti di preflight**, tidak DROP.
- Sandbox kosong: rollback menyelesaikan DROP + CHECK legacy; **tidak** menyisakan stub `can_access_location`.

### 15) Kasir tanpa receive_stock otomatis
- Invite kasir → permissions tidak mengandung `receive_stock`.
- `receive_stock_transfer` sebagai kasir tanpa grant eksplisit → gagal.

## Bukti yang dikumpulkan

Untuk tiap kasus: user, SQL/RPC, hasil (deny/allow), timestamp. Simpan di catatan UAT sebelum approve migration produksi.
