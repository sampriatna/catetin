# DRAFT Inventory SQL — Review (revisi setelah PR #3 CHANGES REQUESTED)

**STATUS: DRAFT — JANGAN DIJALANKAN / JANGAN DIGABUNG**

Lokasi sementara (bukan `supabase/migrations/`):

```
supabase/drafts/inventory_fase2/
```

Setelah final & disetujui per file, baru dibuat migration timestamp resmi satu per satu di `supabase/migrations/`.

## Urutan file

| # | File |
|---|---|
| 01 | `01_roles_and_member_assignments.sql` |
| 02 | `02_inventory_master.sql` |
| 03 | `03_stock_ledger.sql` |
| 04 | `04_opname_transfers_waste.sql` |
| 05 | `05_requests_purchasing_links.sql` |
| 06 | `06_rls_and_quantity_rpcs.sql` |
| 07 | `07_domain_rpcs.sql` |
| 08 | `08_invite_claim_transactional.sql` |
| 99 | `99_ROLLBACK_ALL.sql` |
| — | `SECURITY_TEST_PLAN.md` |
| — | `SCHEMA_SUMMARY.md` |

Setiap file final memakai `BEGIN` … preflight … DDL … `COMMIT`.

## Keputusan bisnis final (terkunci)

| Topik | Keputusan |
|---|---|
| `po_required_min_amount_idr` | `NULL` awal; PO wajib by proses formal/tempo/quotation, bukan nominal otomatis |
| Lokasi | 1 inventory location per outlet; Dapur/Bar = area, bukan sub-location |
| Permissions | `text[]` + CHECK subset daftar resmi |
| Kasir + receive | **Tidak** otomatis `receive_stock` |
| QR host | Dari config/env; production: `catatin.nusafishing.com` |
| Draft archive | 30 hari; purge 90 hari jika belum posted & tidak direferensikan |
| Admin purchasing link | **Hanya review/approve**, bukan create/ganti PR-PO |
| Negative stock | Diblok setelah go-live bisnis |
| Opening produksi | **Tidak** ada di PR ini |

## Perubahan besar vs draft sebelumnya

1. Folder keluar dari `migrations/`.
2. Semua `SECURITY DEFINER` di-revoke dari PUBLIC/anon/authenticated; hanya domain RPC di-grant.
3. Ledger tidak bisa ditulis client; posting hanya lewat RPC domain.
4. Transfer: 1 movement per kaki (`from`→`to`); partial receive lewat `stock_transfer_receipts`.
5. Integritas lintas-tabel satu bisnis (composite FK / trigger).
6. Cost tidak bocor (tidak ada SELECT outlet ke tabel ber-cost).
7. `app_tx_id text` + `source_system` (kompatibel `imp_<hash>`).
8. Master `suppliers`, `units`, `item_unit_conversions`.
9. Opname hitung server-side; go-live level bisnis.
10. Rollback aman dengan preflight stop-before-DROP.

## File aplikasi (nanti, belum diubah)

`lib/membershipResolve.js`, `BusinessProvider.jsx`, `lib/repo.js`, `lib/rbac.js`, `lib/accountUi.js`, `lib/businessFeatures.js`, invite pages/API, `PurchasingForm.jsx`, `lib/purchasingExpense.js`, `lib/shareWa.js`, `NF3App.jsx`, plus modul baru `lib/inventory/*` & `app/(app)/inventory/*`.

## Larangan operator

- Jangan jalankan SQL di folder ini sebelum approve per file.
- Jangan seed lokasi/item ke produksi dari contoh.
- Jangan hapus `app_state` / data legacy.
- Jangan ubah `.env`.
