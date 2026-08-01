# Daftar perubahan per file (revisi setelah CHANGES REQUESTED)

## Struktural

| Sebelum | Sesudah |
|---|---|
| `supabase/migrations/draft_inventory_fase2/*` | **Dihapus** |
| — | `supabase/drafts/inventory_fase2/*` (baru) |

## Per file

### `00_README_REVIEW.md`
- Lokasi draft diperbarui.
- Keputusan bisnis final (#15) dikunci.
- Larangan eksekusi ditegaskan.

### `01_roles_and_member_assignments.sql`
- `BEGIN/COMMIT` + preflight role legacy.
- `inventory_set_updated_at()` (bukan helper generik).
- Permission CHECK subset daftar resmi.
- `business_id` denormalized + sync trigger.
- Partial unique indexes.
- `upsert_member_assignment` **tanpa** GRANT authenticated.
- Helper boolean tetap GRANT (untuk RLS); mutasi internal di-revoke.

### `02_inventory_master.sql`
- Tambah `suppliers`, `units`, `item_unit_conversions`.
- Composite FK assignment↔location, item↔location, lot↔item.
- `inventory_business_state` (go-live level bisnis).
- `ensure_fnb_inventory_locations` & `_location_id_for_outlet` di-revoke.
- `default_storage_area` tanpa `campuran`.

### `03_stock_ledger.sql`
- `quantity > 0`; arah via from/to.
- Trigger larang client set `posted`.
- Internal `_post_stock_movement_internal` + `_apply_*` di-revoke.
- Lock row: insert-zero lalu `FOR UPDATE`.
- Blok negatif setelah go-live; cost wajib opening/receive; outbound butuh avg cost.
- Compensating adjustment (bukan reverse publik) + unique once.
- `REVOKE INSERT/UPDATE/DELETE` ledger dari authenticated.

### `04_opname_transfers_waste.sql`
- `stock_transfer_receipts` + `_lines` untuk partial.
- Guard field kirim (`sent_qty`, item, lot, unit_cost).
- Opname unique `(opname_id, item_id, coalesce(lot_id,…))`.
- Guard status submitted/approved.
- Receipts gudang + supplier_id.

### `05_requests_purchasing_links.sql`
- `app_tx_id text` + `source_system`.
- CHECK ketat from_pr / from_po / direct|emergency.
- Validasi line anak header; locked irreversible; approved tidak dihapus.
- FK `inventory_receipts.purchasing_tx_link_id`.
- Orphan validator tanpa cast UUID.
- Admin tidak create link (policy di 06).

### `06_rls_and_quantity_rpcs.sql`
- **Tidak ada** SELECT outlet ke tabel ber-cost.
- RPC quantity-only + valuation terpisah.
- `list_transfer_lines_qty` tanpa unit_cost.

### `07_domain_rpcs.sql` (**baru**)
- RPC domain: send/receive transfer, finalize receipt, submit/approve opname, production, waste, opening, owner compensate.
- Cek user/assignment/permission/lokasi/status/acting role.
- Forecasting dilarang receive outlet.

### `08_invite_claim_transactional.sql`
- Tidak turunkan owner/admin/kasir/purchasing → member.
- Tidak timpa outlet legacy sembarangan.
- Location wajib untuk dapur/bar/ops/kasir; missing → gagal (bukan business-wide).
- Kasir **tanpa** `receive_stock` otomatis.
- `upsert` hanya dipanggil dari RPC invite.

### `99_ROLLBACK_ALL.sql`
- Preflight stop-before-DROP jika member/invite baru/posted/assignment aktif.
- Tidak sisakan stub `can_access_location`.
- Drop `inventory_set_updated_at` khusus.

### `SECURITY_TEST_PLAN.md` (**baru**)
- 15 kelompok kasus keamanan sesuai permintaan review.

### `SCHEMA_SUMMARY.md` / `CHANGES_PER_FILE.md`
- Ringkasan & daftar perubahan untuk review ulang.
