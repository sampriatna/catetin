# SECURITY_TEST_PLAN — Inventory draft (putaran 3)

**Jangan jalankan di produksi.** Sandbox terisolasi saja.

## Kasus putaran 2 (tetap wajib)

1. Isolasi lintas bisnis  
2. Outlet tidak baca cost (balances/lots/movements/transfer_lines/waste/opname_lines)  
3. Receiver tidak ubah `sent_qty`  
4. Forecasting assignment tidak receive outlet  
5. Authenticated tidak panggil fungsi internal (`_apply_*`, `_post_*`, `upsert_*`, `ensure_*`, `_location_*`)  
6. Client tidak set `posted`  
7. Stok/lot negatif setelah go-live  
8. Multi-role invite tidak turunkan legacy  
9. Missing location → invite gagal  
10. `app_tx_id` non-UUID (`imp_*`)  
11. PR/PO CHECK + Admin bukan create link  
12. Opname threshold OR + self-approve dilarang  
13. Transfer satu kaki + partial receipt  
14. Rollback stop-before-DROP  
15. Kasir tanpa `receive_stock` otomatis  

## Kasus baru putaran 3 (wajib)

### A) Compensating adjustment
- Compensating membuat row baru + `stock_movement_compensations`  
- Original posted **tidak** di-UPDATE  
- Satu original hanya satu kompensasi (`unique original_movement_id`)  
- Boleh dikompensasi meski ada movement lanjutan (compensating path)  
- `from_location_id <> to_location_id` ditegakkan  

### B) cost_pending tidak rollback
- `finalize` dengan line tanpa cost → exception **tanpa** mengubah status di transaksi gagal  
- `mark_inventory_receipt_cost_pending` menyimpan status secara terpisah  
- `save_inventory_receipt_lines` set `cost_pending` / `ready_to_post` tanpa exception  

### C) Finalize receipt gate
- Tanpa line → gagal  
- Tanpa `purchasing_tx_link_id` → gagal  
- Direct/emergency belum approved → gagal  
- PR belum approved → gagal  
- PO tanpa PR / PR beda → gagal  
- Link `received=true` → gagal  
- Sukses → receipt+link locked/received dalam satu transaksi  

### D) Purchasing self-approve
- Tidak ada UPDATE policy langsung pada `purchasing_tx_links`  
- Purchasing panggil `review_purchasing_tx_link` → deny  
- Admin/Owner review OK; Admin tidak bisa ubah PR/PO via review RPC  
- Approved/locked membekukan seluruh field penting  

### E) Stale opname
- Submit → buat receive/transfer di lokasi yang sama → approve → `recount_required`  
- Positive adj tanpa avg cost tanpa `unit_cost_override` → gagal  
- Positive adj dengan override → wajib Owner approval  
- `physical_qty < 0` → gagal  
- Submit tanpa line → gagal  
- Ubah line setelah submitted tanpa RPC flag → gagal  

### F) Opening + go-live
- `post_inventory_opening` dua kali pada session yang sama → reject  
- Lokasi sudah locked → reject opening ulang  
- `activate_inventory_go_live` gagal jika ada lokasi aktif belum locked  
- Gagal jika ada receipt/transfer/opname menggantung  
- Direct UPDATE `inventory_business_state` oleh authenticated → deny (no write policy)  
- Setelah go-live, opening baru ditolak  

### G) Transfer variance
- Payload kosong / `received_qty=0` / duplicate line → reject  
- `resolve_transfer_variance` membuat movement nyata untuk return/damaged/shrinkage/received_later/adjustment_approved  
- Sisa IN_TRANSIT berkurang sesuai resolusi  

### H) Assignment audit
- Owner kirim `assignment_id` milik user lain → exception  
- Owner tanpa assignment → `assignment_id` null di movement  
- Non-owner wajib assignment milik sendiri  

### I) Settings / role-location / unit
- Settings negatif / urutan expiry terbalik → CHECK gagal  
- Assignment dapur tanpa location → CHECK/RPC gagal  
- Forecasting dengan location → gagal  
- `stock_unit` text tidak bisa menyimpang dari `units.code` (sync trigger)  

### J) Composite FK SET NULL
- Hapus assignment yang direferensikan histori → RESTRICT (gagal), bukan null-kan `business_id`  

### K) Lot/expiry required
- Line transfer/receipt/opname/production dengan lot beda item → gagal di trigger  
- Item `expiry_mode=required` tanpa expiry pada receipt/opening/production output → gagal  

### L) Invite email
- Token invite email A dipakai akun email B → gagal  
- Invite tanpa email (token-based) tetap bisa  

### M) Rollback ketat
- Ada 1 row di `suppliers` / draft transfer / draft movement → rollback berhenti sebelum DROP  
- Assignment nonaktif + draft data tetap memblokir rollback  

### N) Draft write path
- Authenticated INSERT langsung ke `stock_transfers` / `inventory_receipts` / `stock_opnames` → deny (no policy)  
- Harus lewat `create_*_draft` RPC  
