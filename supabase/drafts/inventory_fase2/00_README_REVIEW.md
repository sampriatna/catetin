# DRAFT Inventory SQL — Review putaran 3

**STATUS: DRAFT — JANGAN DIJALANKAN / JANGAN DIGABUNG SEBAGAI MIGRATION**

> Catatan: PR #3 sudah ter-merge ke `main` (hanya file draft di git).  
> Merge itu **tidak** menjalankan SQL. Revisi ini lewat **branch & PR baru**.  
> **Belum ada file yang di-approve untuk dieksekusi.**

Lokasi tetap:

```
supabase/drafts/inventory_fase2/
```

Migration timestamp resmi di `supabase/migrations/` **belum** dibuat.

## Urutan file

| # | File | Status review |
|---|---|---|
| 01 | `01_roles_and_member_assignments.sql` | revisi |
| 02 | `02_inventory_master.sql` | revisi |
| 03 | `03_stock_ledger.sql` | revisi blocker |
| 04 | `04_opname_transfers_waste.sql` | revisi |
| 05 | `05_requests_purchasing_links.sql` | revisi blocker |
| 06 | `06_rls_and_quantity_rpcs.sql` | revisi blocker |
| 07 | `07_domain_rpcs.sql` | revisi blocker utama |
| 08 | `08_invite_claim_transactional.sql` | revisi keamanan |
| 99 | `99_ROLLBACK_ALL.sql` | revisi blocker |

## Keputusan bisnis terkunci (ringkas)

- `po_required_min_amount_idr = NULL`; PO by proses formal
- 1 location / outlet; Dapur/Bar = area
- Kasir **tanpa** `receive_stock` otomatis
- Admin **hanya** review purchasing link (RPC), bukan create/ganti PR-PO
- Purchasing **tidak** self-approve
- Negative stock diblok setelah go-live
- Opening produksi tidak dijalankan di draft ini
- QR host dari env; production `catatin.nusafishing.com`
- Draft archive 30 hari / purge 90 hari

## Arsitektur write path

```
Client → domain RPC (auth + assignment + permission) → tabel
```

Bukan client write bebas, bukan service-role tanpa cek user.

## Larangan

- Jangan jalankan SQL folder ini sebelum approve per file.
- Jangan buat migration timestamp sebelum approve.
- Jangan ubah `.env` / hapus data legacy.
