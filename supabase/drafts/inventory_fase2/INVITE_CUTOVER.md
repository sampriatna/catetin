# Rencana cutover invite — kompatibel legacy

**STATUS: WAJIB DIBACA SEBELUM MENERAPKAN `01` / `08`**

Draft ini **tidak** mengganti `public.accept_invite(text)` maupun
`public.claim_pending_invites()`. Aplikasi Catatin lama (`lib/repo.js`,
login, API invite) tetap memanggil RPC legacy sampai cutover aplikasi selesai.

## Mengapa `01` + `08` diblok sebelum cutover app

| Perubahan | Risiko jika app masih pakai RPC lama |
|---|---|
| `01` memperluas `invites.role` CHECK (dapur/bar/ops/forecasting/`member`) | Owner bisa membuat invite role inventory; `accept_invite` lama menulis `invites.role` langsung ke `business_members.role` → CHECK gagal atau role salah |
| `01` menambah `member` di `business_members.role` | Aman bagi legacy **hanya** jika invite inventory tidak dibuat lewat jalur lama |
| `08` menambah `accept_invite_v2` / `claim_pending_invites_v2` | Aman (additive), tapi **tidak berguna** sampai app memanggil v2; invite inventory tetap butuh v2 |

Karena itu: **jangan terapkan `01_roles_and_member_assignments.sql` dan
`08_invite_claim_transactional.sql` sebelum gate di bawah lulus.**

File inventory lain (`02`–`07`) boleh direview terpisah; mereka tidak
mengganti RPC invite. Urutan production tetap menunggu approve per file.

## Gate sebelum apply `01` / `08`

Semua harus hijau:

1. **App memanggil RPC v2** untuk accept/claim (bukan hanya deploy SQL v2).
   - Accept token → `accept_invite_v2`
   - Claim by email → `claim_pending_invites_v2`
2. **Smoke test invite legacy lulus** di lingkungan yang sama dengan DB target
   (lihat checklist di bawah) — memastikan RPC lama masih utuh dan role
   finance (`admin` / `kasir` / `purchasing`) tidak rusak.
3. **Tidak ada** `CREATE OR REPLACE` / `DROP` terhadap
   `accept_invite` / `claim_pending_invites` di draft inventory.
4. Owner approve eksplisit untuk file `01` dan `08`.

## Urutan cutover yang kompatibel

```
A. Review & approve draft SQL (tanpa eksekusi)
B. App PR terpisah: ganti pemanggilan → accept_invite_v2 / claim_pending_invites_v2
   (revisi ini TIDAK mengubah file aplikasi)
C. Deploy app yang sudah memanggil v2 (atau feature-flag dual-call yang
   selesai cutover ke v2-only sebelum apply 01)
D. Smoke test invite LEGACY (admin/kasir/purchasing) — harus lulus
E. Smoke test invite INVENTORY via v2 (dapur/bar/ops/forecasting) — di staging
F. Baru apply 01, lalu 08 (atau 01+08 dalam satu jendela setelah gate)
G. Jangan hapus RPC legacy sampai Owner putuskan deprecation terpisah
```

## Kontrak kompatibilitas (wajib dipertahankan)

- `accept_invite(p_token)` dan `claim_pending_invites()` **tetap ada** dan
  berperilaku seperti sekarang untuk role `admin` / `kasir` / `purchasing`.
- `accept_invite_v2` memetakan role inventory → `business_members.role = 'member'`
  (atau upgrade legacy yang diizinkan) + `member_assignments`.
- Unique `(business_id, user_id)` pada `business_members` tidak diubah.
- `business_role()` / login / policy finance legacy tidak diganti di draft ini.

## Smoke test invite legacy (wajib sebelum apply 01/08)

Jalankan sebagai authenticated user yang sesuai; **bukan** bagian dari revisi
SQL ini (tidak ada eksekusi DB di PR draft).

- [ ] Invite `admin` → `accept_invite` → row `business_members.role = admin`, active
- [ ] Invite `kasir` + outlet → `accept_invite` → role kasir, outlet terisi
- [ ] Invite `purchasing` → `accept_invite` → role purchasing
- [ ] Login tanpa `?invite=` → `claim_pending_invites` klaim by email profil
- [ ] Token kadaluarsa / sudah accepted → error yang sama seperti produksi
- [ ] On conflict user sudah member → active/role/outlet ter-update seperti legacy
- [ ] Omzet / kasir / admin keuangan / purchasing login setelah claim tetap jalan

Setelah app di v2, ulang smoke di atas lewat **v2** untuk role legacy, plus:

- [ ] Invite `dapur`/`bar`/`operasional_samtaro` → v2 → `business_members.role=member` + assignment + location
- [ ] Invite `forecasting_inventory` → v2 → assignment business-wide (`location_id` null)
- [ ] Email invite tidak cocok dengan profil login → v2 menolak

## Larangan di revisi SQL inventory

- Jangan `CREATE OR REPLACE` RPC invite legacy.
- Jangan ubah `lib/repo.js`, login, API invite, `app_state`, wallets, transactions,
  atau policy RLS finance di PR draft ini.
- Jangan buat migration timestamp sampai cutover app + approve Owner.
