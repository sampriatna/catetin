# Rencana cutover invite — kompatibel legacy

**STATUS: WAJIB DIBACA SEBELUM CUTOVER STAGING / PRODUCTION**

Draft ini **tidak** mengganti `public.accept_invite(text)` maupun
`public.claim_pending_invites()`. Aplikasi Catatin lama tetap memanggil RPC
legacy sampai app PR terpisah (dengan feature flag) di-deploy setelah SQL v2 ada.

Revisi PR draft ini **tidak** mengubah aplikasi lama, RPC legacy, `app_state`,
wallets, transactions, atau database produksi. **Jangan merge sebagai migration
dan jangan eksekusi SQL** dari PR review ini.

## Dependensi file

| File | Peran untuk invite v2 |
|---|---|
| `01_roles_and_member_assignments.sql` | CHECK role `member` + role invite inventory; tabel/helpers `member_assignments`, `upsert_member_assignment`, permission helpers |
| `02_inventory_master.sql` | Lokasi / helper outlet yang dipakai v2 (`_location_id_for_outlet`, locations F&B) |
| `08_invite_claim_transactional.sql` | **Additive:** `accept_invite_v2` / `claim_pending_invites_v2` saja — bergantung pada `01` + `02` |

Karena itu staging/production apply invite path harus **`01 → 02 → 08`**, bukan
deploy app v2 dulu. App tidak boleh memanggil RPC yang belum dibuat.

## Prasyarat (sebelum apply SQL cutover)

1. **Role inventory belum boleh ditampilkan atau dibuat** dari aplikasi legacy
   (UI invite / create-member hanya `admin` / `kasir` / `purchasing` seperti sekarang).
2. Owner approve draft `01`, `02`, `08` untuk jendela cutover terkendali.
3. Draft **tidak** berisi `CREATE OR REPLACE` / `DROP` terhadap
   `accept_invite` / `claim_pending_invites`.

## Urutan cutover yang kompatibel

```
1. Role inventory BELUM ditampilkan / dibuat dari aplikasi legacy
2. Staging: apply berurutan 01 → 02 → 08
   (RPC accept_invite + claim_pending_invites legacy tetap utuh)
3. Smoke test invite LEGACY (admin / kasir / purchasing) lewat RPC lama
   → jika gagal: STOP + rollback SQL cutover (lihat di bawah)
4. Deploy app PR terpisah yang memanggil RPC v2 (sebaiknya feature flag;
   flag off = masih legacy; flag on = v2)
5. Smoke test role LEGACY melalui v2 (admin / kasir / purchasing)
6. Smoke test role INVENTORY melalui v2 (dapur / bar / ops / forecasting)
7. Baru enable role inventory di UI / create-invite
8. Production: urutan yang sama dalam satu controlled cutover
```

Jangan hapus RPC legacy sampai Owner putuskan deprecation terpisah setelah
production stabil.

## Rollback / stop condition

**Setelah apply `01 → 02 → 08` di staging (atau production), jika smoke test
invite legacy (langkah 3) gagal → STOP segera.**

Stop berarti:

- Jangan deploy app yang memanggil v2.
- Jangan enable role inventory di UI.
- Jangan lanjut ke langkah 4–8.
- Jangan apply file inventory lain di lingkungan yang sama sampai akar masalah jelas.

Rollback SQL cutover invite (hanya di lingkungan yang baru di-apply; **bukan**
dari PR review ini, dan **bukan** terhadap DB produksi di luar controlled window):

1. Pastikan belum ada row `business_members.role = 'member'` dan belum ada
   `member_assignments` / invite role inventory yang dibuat di jendela itu
   (jika ada → rollback data dulu atau abort dan eskalasi Owner; jangan DROP buta).
2. Jalankan bagian rollback yang relevan dari `99_ROLLBACK_ALL.sql` **hanya**
   untuk objek yang di-apply di jendela cutover (`08` functions v2, lalu objek
   `02`/`01` sesuai preflight ketat di file itu).
3. Verifikasi ulang: `accept_invite` / `claim_pending_invites` masih ada dan
   smoke legacy admin/kasir/purchasing hijau sebelum membuka traffic.

Jika smoke legacy gagal **setelah** app v2 sudah ter-deploy: matikan feature
flag (kembali ke RPC legacy), STOP enable inventory roles, lalu investigasi —
jangan hapus RPC legacy.

## Kontrak kompatibilitas (wajib dipertahankan)

- `accept_invite(p_token)` dan `claim_pending_invites()` **tetap ada** dan
  berperilaku seperti sekarang untuk role `admin` / `kasir` / `purchasing`.
- `accept_invite_v2` memetakan role inventory → `business_members.role = 'member'`
  (atau upgrade legacy yang diizinkan) + `member_assignments`.
- Unique `(business_id, user_id)` pada `business_members` tidak diubah.
- `business_role()` / login / policy finance legacy tidak diganti di draft ini.

## Smoke tests

### A) Legacy RPC — wajib lulus segera setelah `01 → 02 → 08` (sebelum deploy app v2)

- [ ] Invite `admin` → `accept_invite` → `business_members.role = admin`, active
- [ ] Invite `kasir` + outlet → `accept_invite` → role kasir, outlet terisi
- [ ] Invite `purchasing` → `accept_invite` → role purchasing
- [ ] Login tanpa `?invite=` → `claim_pending_invites` klaim by email profil
- [ ] Token kadaluarsa / sudah accepted → error yang sama seperti produksi
- [ ] On conflict user sudah member → active/role/outlet ter-update seperti legacy
- [ ] Omzet / kasir / admin keuangan / purchasing login setelah claim tetap jalan

Jika salah satu gagal → **STOP + rollback** (bagian di atas).

### B) Legacy roles via v2 — setelah deploy app (flag on) di staging

- [ ] Invite `admin` / `kasir` / `purchasing` diterima lewat `accept_invite_v2`
- [ ] Claim by email lewat `claim_pending_invites_v2` untuk role legacy
- [ ] Hasil `business_members` + login finance setara jalur legacy

### C) Inventory roles via v2 — sebelum enable UI inventory

- [ ] Invite `dapur` / `bar` / `operasional_samtaro` → v2 →
      `business_members.role = member` + assignment + `location_id`
- [ ] Invite `forecasting_inventory` → v2 → assignment business-wide
      (`location_id` null)
- [ ] Email invite tidak cocok dengan profil login → v2 menolak

Baru setelah A+B+C hijau: **enable role inventory** di aplikasi, lalu ulangi
urutan yang sama untuk production dalam controlled cutover.

## Larangan di revisi SQL inventory (PR draft)

- Jangan `CREATE OR REPLACE` / drop RPC invite legacy.
- Jangan ubah file aplikasi lama, `app_state`, wallets, transactions,
  RPC login lama, atau policy RLS finance.
- Jangan eksekusi SQL / seed / touch database produksi dari PR review.
- Jangan buat migration timestamp sampai Owner approve + cutover terkendali.
