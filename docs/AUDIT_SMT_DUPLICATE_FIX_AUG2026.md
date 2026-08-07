# Audit & fix — Duplikasi laporan/omset Samtaro (SMT)

## A. Root cause

1. **ID transaksi tunai mengikuti `reportId`** (`t_<reportId>_cash`).  
   Setelah hapus + kirim ulang, `submissionId` baru → `reportId` baru → **cash tx id baru**. Jika tx lama belum tertombstone di awan (race save), merge menggabungkan **dua cash** untuk slot yang sama.

2. **Tombstone slot memakai `activity > deletedAt` (strict)**.  
   Kirim ulang di timestamp yang sama dengan hapus bisa tertelan filter → laporan baru hilang → kasir kirim lagi → dobel.

3. **Delete kasir tidak `await` critical save**.  
   Tombstone belum sempat ke awan sebelum resubmit → race merge menghidupkan tx lama.

4. **`reconcileOrphanLaporanCashTxs` bisa menghapus cash laporan aktif** jika slot masih bertombstone dan laporan baru sempat terfilter.

Duplicate terjadi terutama di **transactions (omset tunai laci)**; `dailyReports` biasanya sudah di-collapse per outlet+tanggal, tetapi UI laci/omset terlihat double.

## B. File / fungsi

| Area | File | Fungsi |
|------|------|--------|
| Domain | `lib/kasirHarian.js` | `submitDailyReport`, `deleteDailyReport`, `canonicalLaporanCashTxId`, `reconcileDailyReportTransactions`, `applyDailyReportMutation`, `reconcileOrphanLaporanCashTxs` |
| Tombstone | `lib/dailyReportDelete.js` | `filterDeletedDailyReports` |
| UI | `NF3App.jsx` | `doDeleteOwn`, `doDelete` |
| Audit | `lib/dailyReportAudit.js` | `auditDailyReportSlot`, `auditDailyReportDuplicates` |

## C. Kenapa delete + resubmit masih double

Hapus membersihkan array lokal, tetapi identity cash berubah saat resubmit. Tanpa tombstone tx yang tersimpan di awan + merge remote∪local, cash lama + cash baru hidup berdampingan. Tombol “Hapus laporan & bersihkan duplikat omset” sudah mengumpulkan tx, tetapi race save / filter tombstone membuat cleanup tidak atomic end-to-end.

## D–F. Klasifikasi & strategi fix

- Duplikat: **transactions** (utama), kadang **dailyReports** mentah sebelum merge.
- Race/retry: ya (save delete vs resubmit; nonce submission baru setelah hapus).
- Fix aman:
  1. Cash tx id **kanonik per slot** `t_cash_<OUTLET>_<DATE>` (upsert, bukan push).
  2. Metadata `sourceReportId` / `outletCode` / `reportDate` / `transactionKind`.
  3. `reconcileDailyReportTransactions` idempotent.
  4. Tombstone slot: id lama diblok; laporan baru `activity >= deletedAt` lolos.
  5. Delete await critical save; bersihkan seluruh slot.
  6. Audit read-only — tanpa DELETE produksi otomatis.
