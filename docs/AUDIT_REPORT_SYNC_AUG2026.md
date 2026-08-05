# Audit & patch — Sync laporan omzet (Kisamen revisi stuck + Samtaro dobel)

## Temuan alur data (sebelum patch)

Tidak ada Apps Script. Persistensi: `app_state.data` (JSONB) via Supabase.

```
Kasir submit → mutate lokal (dailyReports + tx)
  → scheduleImmediateSave / saveAppState (load → merge → upsert)
  → owner/admin baca dailyReports (SettleLaporanScreen)
Admin hapus → filter array + tombstone + cancel notif revisi
  → critical save (sebelumnya fire-and-forget)
  → kasir isi ulang → submit baru
```

### Akar masalah (dari kode)

1. **`mergeById` staff messages: remote menimpa local**  
   Setelah hapus, `cancelled`/`fulfilledAt` di perangkat admin hilang saat merge dengan notif revisi lama di awan.

2. **`applyRevisionNoticesFromMessages`** mencocokkan revisi by `outlet+date` (bukan hanya id) dan **tidak mengabaikan** pesan cancelled di filter awal → laporan isi-ulang dipaksa lagi `revision_requested` (“Menunggu revisi kasir”).

3. **Hapus tidak await save / tidak refetch** → tombstone belum ke awan; HP lain menghidupkan laporan lama.

4. **Retry timeout** bisa pakai submissionId baru (setelah reload) → INSERT kedua (Samtaro dobel).

## Patch (minimal)

| Area | Perubahan |
|------|-----------|
| `reportKey` | `businessId:outlet:YYYY-MM-DD` (Asia/Jakarta) |
| Upsert | `submitDailyReport` + `applyDailyReportMutation` by reportKey |
| Idempotency | submissionId sama → return laporan ada |
| Lock | `withAppStateSaveLock` di `saveAppState` |
| Delete | await critical save + reload awan; tombstone + cancel revisi |
| Merge notif | `mergeStaffMessages` pertahankan cancelled |
| applyRevision | skip cancelled; jangan paksa revisi ke id baru yang lebih baru |
| Frontend | sessionStorage submissionId; status kirim/timeout |
| Tanggal | `normalizeReportDate` Asia/Jakarta |

## Audit data

```bash
npm run audit:report-sync   # butuh .env.local service role
```

Jangan DELETE produksi dari audit — tampilkan canonical dulu.

## Tes

```bash
npm run test:kasir
```

Skenario: double click, timeout retry, simultan, hapus+isi ulang, outlet beda, format tanggal, settled locked.
