# Audit — Samtaro Daily Report tanggal 7 duplicate (1× input)

**Outlet:** SMT / Samtaro · **Business date:** 2026-08-07  
**Klaim user:** input/kirim sekali → data muncul double

---

## A. ROOT CAUSE

**Bukan** onSubmit+onClick, dual handler SMT, atau settle yang membuat report kedua.

**Ya — identitas laporan tidak kanonik per slot:**

1. `report.id` historis = hash(`submissionId`) dan `submissionId` mengandung **nonce acak**.
2. Satu aksi user yang tampak sekali bisa menghasilkan dua eksekusi domain dengan submissionId beda (race mutate, sesi baru, merge remote+local, orphan recovery path) → **dua `dailyReports` id berbeda** untuk `SMT|2026-08-07`.
3. Generated cash historis `t_${reportId}_cash` → ikut dobel (**Kasus B**). Setelah PR #9/#12 cash kanonik + enforce SMT, sisa risiko utama adalah **dua report id** / merge kotor sebelum collapse.

Tidak ada tabel terpisah / UNIQUE DB: semua di `app_state.data` JSONB.

---

## B. EVIDENCE (code)

| Bukti | Lokasi |
|-------|--------|
| Tidak ada HTTP report API | `KasirHarianScreen.submit` → `mutate` → `saveAppState` |
| Tombol hanya `type="button"` + `onClick` | `NF3App.jsx` |
| `reportId` dulu dari `reportIdFromSubmissionId(submissionId)` | `lib/kasirHarian.js` (pre-fix) |
| `submissionId` nonce default random | `makeDailyReportSubmissionId` |
| Merge transaksi union by id | `mergeTransactions` di `appState.js` |
| Tidak ada UNIQUE outlet+date di SQL | `supabase/schema.sql` → `app_state` PK `business_id` saja |

**Live DB tanggal 7:** environment ini tidak punya `.env.local` Supabase — audit row-by-row menunggu credentials. Fix berbasis code path + regression.

---

## C. REQUEST FLOW (1 klik)

```
User click "Kirim laporan"
→ KasirHarianScreen.submit (submittingRef guard)
→ submitDailyReport (domain, pure)
→ mutate → applyDailyReportMutation
     → reconcileDailyReportTransactions
     → enforceSingleSmtGeneratedCash (SMT)
→ onCriticalSave → scheduleImmediateSave → saveAppState
     → merge + finalizeMergedDoc
          → collapseDailyReportsBySlot
          → reconcileOrphanLaporanCashTxs
          → enforceSingleSmtGeneratedCash (SMT dates)
→ loadState verify → commitStatus update
```

HTTP khusus laporan: **0**. Persist: **1×** upsert `app_state` (+ 1 read verify).

---

## D. DUPLICATE DATA ANALYSIS (model)

Tanpa dump produksi, pola yang konsisten dengan bug historis:

| Field | Record A | Record B |
|-------|----------|----------|
| outlet | SMT | SMT |
| date | 2026-08-07 | 2026-08-07 |
| id | `dr_<hash1>` | `dr_<hash2>` |
| submissionId | …\|nonce1 | …\|nonce2 |
| cash tx | `t_dr_*_cash` atau kanonik | id berbeda / legacy+canon |

→ **Kasus A** jika 2 report bertahan; **Kasus B** jika report collapse ke 1 tapi cash 2.

---

## E. FIX (patch ini)

1. **`canonicalDailyReportId`** = `dr_<OUTLET>_<YYYY-MM-DD>` — create/upsert selalu id slot.
2. Slot sudah lengkap: **UPSERT / idempotent**, bukan INSERT kedua / reject kaku (kecuali settled / revision flow).
3. **`mergeDailyReports` + `reportsForDate`**: normalisasi tanggal Asia/Jakarta.
4. **`collapseDailyReportsBySlot` + SMT cash enforce** di `finalizeMergedDoc` (setiap save/pull).
5. Tombstone: izinkan **resubmit id kanonik** jika `submittedAt >= deletedAt`.
6. `applyDailyReportMutation`: payload masuk menang (bukan pick-by-higher-total).

---

## F. DATABASE PROTECTION

JSONB tidak bisa UNIQUE per elemen array. Setara UNIQUE di aplikasi:

- id laporan kanonik per slot
- collapse pada setiap merge/save
- cash id kanonik `t_cash_SMT_<DATE>` + enforce SMT

Request A + Request B bersamaan → id sama → 1 report + 1 cash.

---

## G. FINANCIAL SAFETY

- Omset tunai: satu id kanonik; settle idempotent (`already_settled` / existing settle txs).
- Tx manual tidak disentuh enforce.

---

## H. TEST

`lib/kasirHarian.smtDate7.test.mjs` — CASE 1–8 (normal, double click, retry, edit, settle, settle ulang, refresh, concurrent dirty finalize).
