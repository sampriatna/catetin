# Audit — Duplikasi Samtaro via sync (bukan double-tap)

## Urutan kejadian lapangan

1. Laporan Samtaro dikirim.
2. UI menampilkan `sRef is not defined`.
3. Draft/laporan hilang dari tampilan lokal.
4. Pengguna hanya menekan sinkron (bukan kirim ulang).
5. Data pusat tetap punya dua laporan / omzet dobel.

## Validasi hipotesis

| Klaim | Hasil validasi kode |
|-------|---------------------|
| Sync melakukan SQL INSERT laporan baru | **Tidak akurat secara skema.** Persistensi = 1 dokumen `app_state` JSONB per bisnis (`saveAppState` merge+CAS). |
| Ada antrean offline terpisah yang INSERT lagi | **Tidak ada** queue HTTP terpisah. “Pending” = `commitStatus`/`syncStatus` + `pendingSavePayloadRef`. |
| `sRef` error setelah mutate, sebelum critical save | **Benar (historis).** Logging SMT memakai `sRef` di `KasirHarianScreen` (tidak ada di scope) → `ReferenceError` setelah `applyDailyReportMutation`, sebelum `onCriticalSave`. |
| Sync flush pending gagal | **Benar (bug).** `reloadFromCloud` meng-set `skipSaveRef=true` *sebelum* `flushSave()`, sehingga flush menjadi no-op. |
| Sinkron “create” kedua | **Jalur berbahaya:** mutate lokal (id A) sempat tersimpan via debounce **atau** tidak; UI unlock/pending; sync merge / orphan path / id legacy berbeda → dua objek laporan atau dua cash di JSONB sebelum collapse. |

**Kesimpulan:** Bukan INSERT REST kedua, tetapi **race submit→error UI→pending lokal→sync merge** yang dapat menyisakan dua identitas laporan/cash di dokumen pusat (terutama sebelum id kanonik + collapse slot).

## Perilaku yang benar (patch)

1. Critical save **sebelum** diagnostik SMT; diagnostik di `try/catch`.
2. Sync: **flush pending force dulu**, baru `skipSave` + pull.
3. Pull: `bindLocalReportsToCloudRecords` by id/slot/`idempotencyKey` — sync ≠ create.
4. `reconcileSmtOmzetSyncState` + `collapseDailyReportsBySlot` = unique per outlet+tanggal.
5. Key stabil SMT `biz\|SMT\|date\|omzet` tidak di-regen oleh sync.
6. Error UI tidak menghapus identitas; status `pending` → setelah sync `synced` + `serverRecordId`.

## Data duplikat yang sudah ada

Jalankan audit read-only (tidak menghapus):

```bash
npm run audit:samtaro-dup
# atau tanggal spesifik:
node scripts/auditSamtaroDuplicates.mjs --date=2026-08-08
```

Output memuat per record: id, waktu, outlet, tanggal, nominal, `idempotencyKey`, `sourceGuess`, `primaryRecordId`, dan `cleanupPreview` (rekomendasi aman, tanpa eksekusi hapus).

## Rekomendasi pembersihan aman

1. Backup baris `app_state` bisnis terkait.
2. Tetapkan record utama = `primaryRecordId` (status tertinggi / terbaru).
3. Tombstone report id loser + cash id non-kanonik; relink ke `t_cash_SMT_<DATE>`.
4. Biarkan save merge / `finalizeMergedDoc` collapse — jangan DELETE mentah tanpa cek settle tx.
5. Kasir cukup sync; jangan kirim ulang nominal yang sama.
