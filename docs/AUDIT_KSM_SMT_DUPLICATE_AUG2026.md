# Audit — Kisamen 1 Agu & Samtaro 3 Agu 2026 (duplicate / belum masuk)

**Mode:** audit read-only dulu · patch kode minimal · **tanpa DELETE produksi**  
**Target:** `KSM` / 2026-08-01 · `SMT` / 2026-08-03  
**Business:** `e23ed572-234c-4995-acad-fa6bff7c58d2`

---

## Hasil audit data produksi

| Item | Nilai |
|------|--------|
| Outlet / tanggal | Kisamen `KSM` · 2026-08-01 |
| Report id | **BELUM TERBACA** (tidak ada service role di agent cloud) |
| submissionId / idempotencyKey | **BELUM TERBACA** |
| created_at / updated_at / status | **BELUM TERBACA** |
| Nominal omzet / tx dompet | **BELUM TERBACA** |
| Lengkap? | **BELUM TERBACA** |

| Item | Nilai |
|------|--------|
| Outlet / tanggal | Samtaro `SMT` · 2026-08-03 |
| Report id | **BELUM TERBACA** |
| submissionId / idempotencyKey | **BELUM TERBACA** |
| created_at / updated_at / status | **BELUM TERBACA** |
| Nominal omzet / tx dompet | **BELUM TERBACA** |
| Lengkap? | **BELUM TERBACA** |

Jalankan di laptop (`.env.local` + service role):

```bash
npm run audit:ksm-smt
# atau SQL: supabase/audit-ksm-smt-aug2026.sql
```

---

## Akar masalah (dari kode)

Keluhan “terdeteksi double padahal laporan belum valid” cocok dengan kombinasi:

1. **Slot conflict mengunci meskipun record tidak lengkap**  
   `submitDailyReport` menolak setiap baris `outlet+date` yang sudah ada — termasuk status `submitting`, tanpa timestamp, atau omset tunai tanpa transaksi laci. User mendapat “sudah dikirim” sementara daftar/admin tidak melihat laporan final.

2. **Sukses UI sebelum persist awan** (sisa celah setelah PR #5)  
   Toast sukses bisa muncul sebelum `saveAppState` selesai. Jika simpan gagal, form bisa terkunci / status membingungkan; idempotency key sesi tetap ada tetapi UX mengunci retry.

3. **Bukan duplicate lintas outlet**  
   Pengecekan sudah memakai `outlet + date` (bukan tanggal saja). Key idempotency sekarang: `businessId|outlet|date|userId|nonce`. Laporan KSM 1 Agu ≠ laporan outlet lain di 1 Agu; SMT 3 Agu ≠ outlet lain di 3 Agu.

Tidak ada Apps Script di repo ini — persistensi lewat `app_state` JSONB (Supabase).

---

## File & fungsi

| Lapisan | File | Fungsi |
|---------|------|--------|
| Domain | `lib/kasirHarian.js` | `submitDailyReport`, `isCompleteDailyReport`, `makeDailyReportSubmissionId`, `findDailyReportInSlot` |
| UI | `app/(app)/dashboard/NF3App.jsx` | `KasirHarianScreen.submit`, `scheduleImmediateSave`, unlock + tombol retry |
| Sync | `lib/appState.js` / `lib/dailyReportMerge.js` | preserve laporan lokal (sudah di PR #5) |

---

## Patch yang diterapkan (minimal)

- Hanya laporan **lengkap** yang mengunci slot outlet+tanggal.
- Record incomplete diganti (`submit_replace_incomplete`) — bukan ditolak sebagai duplicate.
- Idempotent hit hanya jika prior lengkap.
- Idempotency key menyertakan `businessId` + outlet (bukan tanggal saja).
- Submit menunggu critical save; gagal → unlock + pesan jelas + **Coba kirim ulang (aman)** (submissionId sama).
- Tes: cross-outlet same date, incomplete KSM/SMT rebuild, complete reject.

---

## Langkah uji setelah patch

1. `npm run test:kasir`
2. Kasir Kisamen: buka tanggal **1 Agu 2026** → kirim sekali → harus 1 laporan + 1 omset tunai laci KSM.
3. Refresh / tap ☁️ → tidak dobel.
4. Kirim ulang tanggal sama → ditolak dengan pesan memuat outlet `KSM`.
5. Kasir Samtaro: tanggal **3 Agu 2026** → sama (laci SMT).
6. Pastikan laporan KBU/outlet lain di tanggal sama **tetap ada** dan tidak tertimpa.
7. Simulasikan gagal jaringan saat submit → tombol kirim aktif lagi; retry memakai key yang sama.
8. (Opsional) `npm run audit:ksm-smt` setelah deploy untuk verifikasi baris produksi.
