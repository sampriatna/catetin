# Audit — False success checklist malam → missing pagi → double

## Gejala lapangan

1. Malam: staf isi SDM + omset + sosmed → checklist “Semua tugas selesai ✓”
2. Pagi: Adel bilang laporan belum masuk
3. Staf isi ulang → transaksi/omset **dobel**

## Akar masalah (dua tahap)

### BUG A — False success / partial durability

| Temuan | Detail |
|--------|--------|
| Checklist lokal | `done` hanya cek `s.dailyReports` / `sdmReports` / `sosmedReports` di React state |
| SDM & sosmed | `setSaved` / toast sukses **sebelum** `saveAppState` (debounce 1s, fire-and-forget) |
| Omset await palsu | `await onCriticalSave()` tetapi `flushSave` **menelan error** → Promise resolve → toast sukses |
| Critical skip = sukses | `scheduleImmediateSave` `resolve(null)` saat `skipSave` / `!allowSave` |
| Lost update JSONB | `read → merge → upsert` tanpa CAS `updated_at` → writer B bisa menimpa report A |

Daily report + txs ada di **satu** dokumen `app_state` — bukan save terpisah. “Partial” yang terasa di lapangan = **UI sukses tanpa commit awan**, atau **lost update** menghapus perubahan malam.

### BUG B — Resubmit → double

Setelah laporan “hilang” di awan tapi cash masih ada (atau lokal sempat punya cash), isi ulang membuat submission baru. PR #9 canonical `t_cash_<OUTLET>_<DATE>` membatasi dobel cash; tanpa orphan recovery + false-success fix, checklist tetap mendorong isi ulang.

## Patch (PR ini)

1. **flushSave re-reject** — await critical save gagal jika awan gagal (tidak false success).
2. **Critical skip → reject** — bukan resolve null.
3. **CAS `updated_at`** pada `saveAppState` — cegah lost update; retry merge.
4. **SDM / sosmed / settle** await `onCriticalSave`; `commitStatus: committing→committed|failed`.
5. **Checklist** hijau hanya jika `isSectionCloudCommitted` (bukan sekadar ada di state lokal).
6. **Read-back** setelah submit omset (`findCommittedDailyReport` dari cloud).
7. **Orphan recovery** — cash tanpa report → pulihkan stub, resubmit upsert (bukan cash kedua).
8. **`today()` → Asia/Jakarta** (`todayLocal`).
9. Logging stage: `STARTED` → `REPORT_SAVED` → `COMMITTED` / `FAILED`.

## Uji

```bash
npm run test:kasir
```

## Operasional pagi

Jika checklist semalam hijau tapi Adel tidak lihat:
1. Tap ☁️ sync dulu — jangan isi ulang.
2. Jika “Omset di laci tanpa laporan” → buka Laporan Omset → kirim ulang (aman / recovery).
3. Cek log `[daily_report]` stage `COMMITTED` vs `FAILED` di perangkat staf.
