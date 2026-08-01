# DRAFT Migration — Modul Inventory Catatin/NF3 (Fase 2+)

**STATUS: DRAFT UNTUK REVIEW — JANGAN DIJALANKAN**

Dokumen ini dan seluruh file `0x_*.sql` di folder ini adalah rancangan saja.
Tidak ada migration, seed produksi, RPC live, atau perubahan data yang dijalankan oleh agen.

## Urutan migration (saat disetujui nanti)

| # | File | Isi |
|---|---|---|
| 01 | `01_roles_and_member_assignments.sql` | Perluas CHECK role `business_members`/`invites`, role netral `member`, tabel `member_assignments`, partial unique indexes, helper assignment (baru; **tidak** mengubah `business_role()`) |
| 02 | `02_inventory_locations_items_lots.sql` | Lokasi (termasuk `IN_TRANSIT`), master item, area, item-lokasi, lots/batch, settings, audit master |
| 03 | `03_stock_ledger.sql` | `stock_movements` (source of truth), `stock_balances` cache, fungsi post/reverse, larangan edit posted |
| 04 | `04_opname_transfers_waste.sql` | Opname, transfer + in-transit, waste records, opening lock (struktur saja; go-live setelah UAT Fase 5) |
| 05 | `05_requests_purchasing_links.sql` | Kebutuhan outlet, PR/PO (+ lines), `purchasing_tx_links`, jalur menuju `purchasing_transactions` |
| 06 | `06_rls_helpers_views.sql` | RLS inventory, view quantity vs valuation, grant |
| 07 | `07_invite_claim_transactional.sql` | Draft RPC invite/claim transactional (members + assignments) — **pengganti claim lama hanya setelah review** |
| 99 | `99_ROLLBACK_ALL.sql` | Rollback terbalik (drop objek draft saja; kembalikan CHECK role) |

Jalankan **satu file per langkah** di SQL Editor hanya setelah Owner menyetujui isi file tersebut.
Jangan jalankan `99_ROLLBACK` kecuali rollback disengaja.

## Prinsip desain yang dikunci

1. `business_members` tetap `unique (business_id, user_id)` — kompatibilitas login/RLS lama.
2. Multi-role lewat `member_assignments` (FK ke `business_member_id`).
3. `business_role()` **tidak diganti**; inventory pakai helper baru.
4. Ledger (`stock_movements`) = source of truth; `stock_balances` = cache via fungsi DB.
5. Expiry via `inventory_lots`; alert 14/7/3/0.
6. Transfer memakai lokasi sistem `IN_TRANSIT`.
7. `cost_pending` tidak mem-post `purchase_receive`.
8. Quantity vs valuation dipisah (view + RLS).
9. PO schema disiapkan; pemakaian PO kondisional.
10. Opening go-live **bukan** di Fase 3 — setelah UAT Fase 5.

## Contoh data flow (tanpa seed produksi)

Lihat komentar di akhir masing-masing file SQL dan bagian "Contoh alur" di bawah.

### Transfer Gudang → KBU

1. Forecasting membuat `stock_transfers` draft + lines.
2. Sent: movement group  
   - `transfer_out` dari GUDANG  
   - `transfer_in` ke `IN_TRANSIT`  
   (qty sama, unit_cost dari average sumber)
3. Receiver outlet (permission `receive_stock`) menekan Diterima:  
   - `transfer_out` dari `IN_TRANSIT`  
   - `transfer_in` ke KBU (qty aktual)  
4. Selisih residual di `IN_TRANSIT` → alasan + penyelesaian (`damaged` / `shrinkage` / return / koreksi approved).

### Receive pembelian

1. Purchasing catat belanja + `purchasing_tx_links` (wajib PR kecuali direct/emergency).
2. Forecasting buat receipt draft (`cost_pending` OK).
3. Cost lengkap → post `purchase_receive` ke ledger + update weighted average + lot/expiry.

### Opening (nanti, pasca Fase 5 UAT)

1. Cut-off datetime sama semua lokasi.
2. Import/opname → movements `opening` (+ lots bila expiry).
3. `inventory_opening_locks` mengunci periode.
4. Setelah lock, hanya movement baru.

## File aplikasi yang nanti perlu disesuaikan (belum diubah sekarang)

| Area | File |
|---|---|
| Membership / session | `lib/membershipResolve.js`, `components/layout/BusinessProvider.jsx`, `lib/repo.js` |
| RBAC / nav | `lib/rbac.js`, `lib/accountUi.js`, `lib/businessFeatures.js` |
| Invite | `app/api/invite/route.js`, `app/(app)/settings/invite/page.jsx`, `app/(app)/settings/staf/page.jsx` |
| Purchasing link | `components/PurchasingForm.jsx`, `lib/purchasingExpense.js`, API/RPC write path baru |
| Share WA | `lib/shareWa.js` |
| Shell UI | `app/(app)/dashboard/NF3App.jsx` (entry kartu/nav additive) |
| Baru | `lib/inventory/*`, `app/(app)/inventory/*`, `app/api/inventory/*` |

## Risiko migration & regression

| Risiko | Mitigasi |
|---|---|
| Perluas CHECK role gagal jika ada role ilegal | Query cek distinct role sebelum ALTER |
| RPC claim diganti terlalu cepat | File 07 terpisah; deploy app dulu atau feature-flag |
| Helper baru salah grant | Inventory RLS only; legacy tetap `business_role()` |
| Client menulis `stock_balances` | Revoke UPDATE dari authenticated; hanya SECURITY DEFINER |
| Orphan `purchasing_tx_links` | Constraint + validation function; write via server |
| Regression kasir/purchasing/admin | Jalankan `npm run test:kasir`, `test:sdm`, `test:laporan` + smoke login tiap role lama |

## Keputusan bisnis yang masih terbuka

1. **Threshold nominal wajib PO** — setting `inventory_settings.po_required_min_amount_idr` (NULL sampai Owner putuskan).
2. **Sub-location** (KBU-DAPUR vs KBU-BAR) — fase awal 1 location/outlet; bedakan area lewat `allowed_usage_areas` + opname `area`, bukan default `campuran`.
3. **Permission enum final** — saat ini `text[]` + konvensi nama; belum CHECK ketat per elemen array.
4. **Mirror assignment untuk kasir legacy** — invite kasir membuat assignment role `kasir` (permissions kosong); `receive_stock` ditambah Owner secara eksplisit.
5. **Host QR production** — path `/inventory/item/{uuid}`; host `catatin.nusafishing.com` perlu dikonfirmasi.
6. **Retention draft** movement/transfer/receipt yang tidak pernah dipost.
7. **Kolom `unit_cost` pada `stock_transfer_lines`** — outlet dengan policy update transfer bisa melihat row (termasuk cost) via SELECT policy transfer lines. Mitigasi fase app: jangan render cost; mitigasi DB lanjutan (opsional): pecah view/RPC receive tanpa cost.
8. **Apakah `admin` boleh menulis `purchasing_tx_links`** — draft mengizinkan owner/purchasing/admin untuk review; konfirmasi apakah admin hanya approve/review atau juga create link.

## Yang sengaja TIDAK dijalankan di draft ini

- Tidak ada `SELECT ensure_fnb_inventory_locations(...)` ke bisnis produksi.
- Tidak ada INSERT master item / opening.
- Tidak ada `CREATE OR REPLACE` atas `accept_invite` / `claim_pending_invites` lama (hanya `*_v2`).
- Tidak ada perubahan `.env` / deploy.

## Larangan eksplisit untuk reviewer/operator

- Jangan `psql` / SQL Editor jalankan file ini sebelum Owner approve per file.
- Jangan seed lokasi/item ke produksi dari contoh komentar.
- Jangan hapus data `app_state` / `transactions` / `business_members`.
- Jangan ubah `.env`.
