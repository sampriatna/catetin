# Investigasi SMT — 1 klik submit → double (P0)

**Scope:** hanya Samtaro / `SMT` · `w_laci_smt`  
**Bukan:** resubmit pagi sebagai akar utama · bukan refactor global

---

## 1. File yang terlibat flow SMT

| Lapisan | File | Peran |
|---------|------|--------|
| UI submit | `NF3App.jsx` → `KasirHarianScreen.submit` | 1 tombol `type="button"` `onClick={submit}` (bukan form onSubmit) |
| Domain | `lib/kasirHarian.js` | `submitDailyReport` → `cashTxForReport` → `applyDailyReportMutation` → `reconcileDailyReportTransactions` |
| Persist | `lib/appState.js` | 1× `saveAppState` JSONB (bukan API `saveDailyReport` terpisah) |
| Mapping | `LACI_BY_OUTLET.SMT = w_laci_smt` | Shared dengan pola KBU/KSM |
| Login | `membershipResolve.js` | `samtarospace@gmail.com` → outlet `SMT` |

**Tidak ditemukan** cabang `if (outlet === 'SMT') { ... create tx ... }` yang membuat jalur kedua.

---

## 2. Trace 1 klik (arsitektur aktual)

Tidak ada server handler terpisah per laporan. Alur:

```
[CLIENT] button onClick → submit()
[CLIENT] submittingRef = true (sync guard)
[CLIENT] submitDailyReport(state, payload)     // pure
[CLIENT] mutate → applyDailyReportMutation     // report + cash
[CLIENT] await scheduleImmediateSave            // 1× upsert app_state
[CLIENT] (opsional) apply lagi commitStatus
```

| Tahap | Harusnya | Catatan |
|-------|----------|---------|
| click | 1 | `type="button"` + `onClick` saja — **bukan** onSubmit+onClick |
| `submitDailyReport` | 1 | Guard `submittingRef` |
| `applyDailyReportMutation` | 1–2 | Ke-2 hanya update `commitStatus` (setelah patch false-success) |
| `reconcileDailyReportTransactions` | per apply | Idempotent jika id kanonik |
| `saveAppState` | 1 | Critical save |

Simulasi node (kode main + PR #9): **1 submit → 1 report + 1 cash `t_cash_SMT_<DATE>`**.  
Parallel 2 submissionId berbeda → tetap **1 report + 1 cash** (slot + id kanonik).

---

## 3. Klasifikasi duplicate

**Kasus B (utama, historis & data produksi):**  
`dailyReports` matching slot ≈ **1** (sering sudah di-collapse)  
`generated cash` laci SMT = **2** → saldo omzet terasa 2×

Bukti efek:

```
opening 250_000 + 1× cash 500_000 = 750_000
opening 250_000 + 2× cash 500_000 = 1_250_000  ← efek omzet double
```

**Bukan Kasus C** (UI-only) bila saldo laci ikut naik 2×.

---

## 4. Root cause konkret

**Klasifikasi: Kasus B** — 1 `dailyReport` slot, **2 generated cash** di `w_laci_smt`.

**Bukan:**
- `onSubmit` + `onClick` (tombol = `type="button"` + `onClick={submit}` saja)
- cabang `if (outlet === 'SMT')` yang create tx kedua
- legacy handler Samtaro + handler generic berjalan bersamaan
- alias outlet ganda ke SMT

**Ya (konkret):**
Generated cash historis memakai id **`t_${reportId}_cash`**, dengan `reportId` dari hash(`submissionId`) + **nonce acak**.

Akibat pada **satu aksi user yang tampak sekali**:

1. Dua hasil domain dengan `submissionId`/reportId beda (race mutate sebelum lock sempat set, merge remote legacy + local baru, atau state kotor sudah berisi `t_dr_*_cash`) → **dua cash id berbeda** di laci SMT.
2. Upsert `dailyReport` by `reportKey` sering menyisakan **1 laporan** → UI/saldo: “1 input, omzet 2×” = **Kasus B**.
3. PR #9 (`t_cash_SMT_<DATE>`) mencegah push baru — **tetapi** legacy `t_dr_*_cash` + kanonik masih bisa hidup berdampingan di JSONB sampai di-collapse.

**Fungsi penyebab efek dobel:** bukan “handler SMT dipanggil 2×”, melainkan **dua baris transaksi generated** (era `t_${reportId}_cash` / sisa legacy berdampingan kanonik) yang sama-sama masuk `w_laci_smt` untuk tanggal sama.

**Kenapa keluhan fokus Samtaro:** path kode **sama** KBU/KSM/SMT. SMT paling sering kena (sync gagal / hapus-isi ulang / volume). Patch ini **hanya** menambah `enforceSingleSmtGeneratedCash` di jalur apply SMT.

---

## 5. Patch paling kecil (hanya SMT)

1. Guard SMT: setelah mutate laporan SMT, **paksa 1 cash kanonik** per `SMT|date` (hapus legacy `t_dr_*_cash` untuk slot itu).
2. Logging korelasi SMT: `clientActionId` + hitungan `submitDailyReport` / `apply` / cash count.
3. Regression test **khusus SMT**: 1× submit → 1+1; 2× payload identik → 1+1.
4. Tidak ubah behavior KBU/KSM; tidak migration global; tidak hapus tx manual.

---

## 6. Jawaban checklist user

| # | Jawaban |
|---|--------|
| API terpanggil berapa kali? | **0** endpoint khusus laporan — 1× `saveAppState` upsert |
| saveDailyReport berapa kali? | = `submitDailyReport` di client: **harusnya 1** |
| pembuat transaksi berapa kali? | `cashTxForReport` + `reconcile` (id sama) → **1 cash** jika kanonik |
| dailyReports tersimpan? | **1** per `businessId:SMT:date` |
| transactions tersimpan? | **1** kanonik; bila double = **legacy+canon** atau 2 legacy id |
| fungsi penyebab pemanggilan kedua? | Bukan handler SMT khusus; **dua apply/submit dengan reportId/cash id beda** (era pre-kanonik) / sisa legacy di JSONB |
