# Bukti validasi teknis — Samtaro sync / checklist

## Deploy status (saat patch #15)

| Item | Nilai |
|------|--------|
| PR #15 | **MERGED** → `main` @ `012804b` |
| Vercel Production | deployment SHA `012804b` (2026-08-08T14:24:46Z) |
| Risiko HP staf | Bundle PWA/cache lama → wajib cek **Versi aplikasi** di Pengaturan |

## Bukti per klaim

### 1) Critical save sebelum diagnostik `sRef`
- Kode: `KasirHarianScreen.submit` — blok `onCriticalSave` dipanggil **sebelum** `SMT_AFTER_SAVE` (diagnostik di `try/catch`).
- Tes: `lib/pendingSectionHeal.test.mjs` → `critical save sebelum diagnostik`.

### 2) `sRef is not defined` hilang di build produksi
- Referensi `sRef` di dalam `KasirHarianScreen` dihapus; diganti `getLatestState`.
- Produksi `012804b` sudah memuat patch ini. HP harus menampilkan SHA tersebut (atau lebih baru) di Pengaturan setelah hard-reload.

### 3) `skipSave` tidak aktif sebelum pending di-flush
- `reloadFromCloud`: `await flushSave({ force: true })` **lalu** `skipSaveRef.current = true`.
- `flushSave({ force })` mengabaikan skipSave saat force.

### 4) `cloudSyncBusyRef` mencegah sync ganda
- Guard di awal `reloadFromCloud` + `recoverPendingKasirSections`: jika busy → return + toast.

### 5) `bindLocalReportsToCloudRecords` = bind, bukan create
- Tes: `preserve tidak menyimpan identitas lokal kedua`, `bind mengisi serverRecordId pusat`.

### 6) Setelah sync: `serverRecordId` + `syncStatus: synced` + pending bersih
- `healPendingSectionStatuses` + `reconcileSmtOmzetSyncState`.
- Tes: `lib/kasirHarian.smtSync.test.mjs` (36) + `pendingSectionHeal.test.mjs` (16).

### 7) Refresh / login ulang
- Status disimpan di `app_state` JSONB; heal saat pull membersihkan `commitStatus=failed` palsu jika status bisnis sudah `submitted+`.

### 8) Satu laporan per outlet+tanggal
- `collapseDailyReportsBySlot` + id kanonik `dr_SMT_<DATE>`.
- Tes sync ×5 → `reportCount === 1`.

## UI checklist

| Lama | Baru |
|------|------|
| Gagal ke awan | Belum tersinkron ke pusat — data tetap tersimpan di perangkat. |
| Proses (saat pending) | Sinkronkan sekarang |
| (setelah bind) | Sudah tersimpan di pusat. |
