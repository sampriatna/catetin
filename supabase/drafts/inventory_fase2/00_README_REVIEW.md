# DRAFT Inventory SQL — Review putaran 4 (blocker PR #4)

**STATUS: DRAFT — JANGAN DIJALANKAN / JANGAN DIGABUNG SEBAGAI MIGRATION**

> Catatan: PR #3 sudah ter-merge ke `main` (hanya file draft di git).  
> Merge itu **tidak** menjalankan SQL. Revisi blocker ini tetap di PR #4.  
> **Belum ada file yang di-approve untuk dieksekusi. Jangan merge sampai review.**

Lokasi tetap:

```
supabase/drafts/inventory_fase2/
```

Migration timestamp resmi di `supabase/migrations/` **belum** dibuat.

## Urutan file

| # | File | Status review |
|---|---|---|
| 01 | `01_roles_and_member_assignments.sql` | **GATE cutover invite** — lihat `INVITE_CUTOVER.md` |
| 02 | `02_inventory_master.sql` | revisi |
| 03 | `03_stock_ledger.sql` | revisi blocker |
| 04 | `04_opname_transfers_waste.sql` | revisi |
| 05 | `05_requests_purchasing_links.sql` | revisi blocker |
| 06 | `06_rls_and_quantity_rpcs.sql` | revisi blocker |
| 07 | `07_domain_rpcs.sql` | revisi blocker utama |
| 08 | `08_invite_claim_transactional.sql` | **GATE cutover invite** — lihat `INVITE_CUTOVER.md` |
| 99 | `99_ROLLBACK_ALL.sql` | revisi blocker |

## Gate cutover invite (blocker)

`01` dan `08` **tidak boleh diterapkan** sebelum:

1. Aplikasi memanggil `accept_invite_v2` / `claim_pending_invites_v2`, dan
2. Smoke test invite **legacy** (`accept_invite` / `claim_pending_invites`) lulus.

RPC legacy **tidak diganti** di draft ini. Rencana lengkap: [`INVITE_CUTOVER.md`](./INVITE_CUTOVER.md).

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
- Jangan terapkan `01` / `08` sebelum gate cutover invite lulus.
- Jangan `CREATE OR REPLACE` / drop `accept_invite` / `claim_pending_invites` lama.
- Jangan buat migration timestamp sebelum approve.
- Jangan ubah `.env` / hapus data legacy.
- Jangan ubah file aplikasi lama, `app_state`, wallets, transactions, RPC login lama, atau policy legacy di revisi draft ini.
