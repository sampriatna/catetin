# Audit & rekomendasi — Laporan Kisamen 1–2 Agustus 2026

**Status:** audit kode selesai · koreksi data produksi **BELUM** dijalankan  
**Outlet:** Kisamen (`KSM`) · Laci: `w_laci_ksm`  
**Tanggal keluhan:** 1 & 2 Agustus 2026

---

## 1. Akar masalah (berdasarkan kode, bukan tebakan)

Ada **kombinasi frontend + merge sync (app_state JSONB)**, bukan bug SQL settlement terpisah.

### A. Merge cloud pull asimetris (penyebab utama laporan “hilang” + dompet dobel)

File: `lib/appState.js` → `mergeAppStateFromCloudPull` (sebelum patch)

- **Transaksi:** digabung remote ∪ local → tx lokal yang belum tersimpan di awan **tetap ada**.
- **Laporan omset:** hanya diambil dari awan (`mergeDailyReports(remote, [])`) → laporan lokal yang baru disubmit **bisa hilang** jika save belum selesai / gagal / race realtime.

Akibat yang cocok dengan keluhan Kisamen:

1. Kasir tekan “Kirim laporan” → `mutate` menambah `dailyReports` + tx `Laporan harian` ke Laci Kisamen.
2. UI menampilkan toast **“✓ Laporan omset tersimpan”** (sebelum konfirmasi awan).
3. Cloud pull / realtime / tab refresh memanggil `mergeAppStateFromCloudPull`.
4. Laporan hilang dari `dailyReports`, tetapi tx laci tetap.
5. Form terbuka lagi (useEffect melihat tidak ada laporan) → kasir kirim ulang → **tx kedua** masuk laci.

### B. Tidak ada idempotency pada submit

File: `lib/kasirHarian.js` → `submitDailyReport` (sebelum patch)

- ID laporan = `"dr" + Date.now()` → setiap kirim ulang = ID baru.
- Tx tunai = `t_${reportId}_cash` → ikut jadi ID baru.
- Tidak ada `submissionId` / unique key outlet+date di lapisan persistensi selain pengecekan array di memori (mudah dilangkahi jika state sudah “kehilangan” laporan).

### C. Success UI sebelum simpan awan + tidak critical-save

File: `app/(app)/dashboard/NF3App.jsx` → `KasirHarianScreen.submit`

- Toast sukses dipanggil langsung setelah `mutate` lokal.
- Submit laporan **tidak** memanggil `scheduleImmediateSave({ critical: true })` (berbeda dengan edit transaksi biasa).
- Save mengandalkan debounce ~1s → jendela race dengan realtime pull.

### D. Autosave draft

Form omset **tidak** menulis draft ke `dailyReports` / dompet. `draftDirtyRef` hanya mencegah form di-reset. Aturan bisnis A (autosave ≠ keuangan) sudah terpenuhi; bug terjadi di **submit eksplisit + sync**.

### E. Settle

`settleDailyReport` sudah relatif aman (cek `admin_verified`, `reportHasSettleTxs`, ID deterministik `t_${reportId}_settle_*`). Risiko dobel lebih besar di **submit tunai laci** daripada settle channel.

---

## 2. File & fungsi penyebab

| Lapisan | File | Fungsi / area |
|--------|------|----------------|
| Sync/merge | `lib/appState.js` | `mergeAppStateFromCloudPull` |
| Domain submit | `lib/kasirHarian.js` | `submitDailyReport` |
| UI submit | `NF3App.jsx` | `KasirHarianScreen` → `submit`, `finishSubmitSuccess` |
| Persist | `NF3App.jsx` | debounce `flushSave` / tidak critical-save setelah laporan |

---

## 3. Klasifikasi

**Kombinasi frontend + backend-sync (app_state)** — bukan timezone filter murni, bukan DB constraint SQL terpisah (data ada di JSONB `app_state.data`).

---

## 4. Perbaikan kode yang diterapkan (tanpa deploy / tanpa ubah data prod)

1. Preserve laporan lokal yang punya tx / slot baru saat cloud pull.
2. `submissionId` / idempotency + ID laporan deterministik.
3. `applyDailyReportMutation` atomik (report + tx, no double push).
4. `reconcileOrphanLaporanCashTxs` untuk dedupe cash outlet+tanggal.
5. Critical save setelah submit/settle/verify; busyRef settle; banner tampilkan report id; retry pakai key sama.
6. Logging terstruktur `[daily_report]`.

---

## 5. SQL audit read-only

Jalankan di Supabase SQL Editor:

`supabase/audit-kisamen-aug2026.sql`

Script Node opsional (perlu `.env.local` + service role):

```bash
node scripts/diagSyncReports.mjs
# atau filter manual di hasil query SQL di atas
```

**Jangan** jalankan script `fix*.mjs` atau UPDATE sebelum meninjau hasil audit.

---

## 6. Rekomendasi koreksi data (belum dijalankan)

Setelah query audit, isi tabel berikut dari hasil nyata:

| Item | Cara tentukan | Tindakan yang disarankan |
|------|----------------|--------------------------|
| Laporan KSM 1 Agu | Query #1 | Jika ada 1 submitted/settled → itu yang valid. Jika kosong tapi ada tx omset → **pulihkan laporan** dari tx (jangan hapus tx dulu). |
| Laporan KSM 2 Agu | Query #1 | Sama. |
| Tx omset dobel | Query #3–4 | Pertahankan `t_<reportId_valid>_cash`. Tx lain → **reversal** (`type: out` / transfer balik) atau tombstone `deletedTransactionIds` — **jangan DELETE mentah** kecuali prosedur resmi. |
| Tx settle dobel | Query #5 | Pertahankan ID kanonik `t_<reportId>_settle_*`. Duplikat legacy → reversal. |
| Ghost settle | Query #6 | Samakan status laporan ke `settled` **hanya jika** settle tx lengkap & disepakati admin. |
| Timezone | Query #8 | `report.date` dari form adalah sumber kebenaran; `submittedAt` UTC boleh beda hari — jangan “geser” date laporan hanya karena UTC. |

### Urutan koreksi yang aman

1. Export hasil audit (screenshot/CSV).
2. Tentukan `report_id` valid per tanggal.
3. Buat **reversal transaction** untuk nominal dobel (audit trail), atau tambahkan id ke `deletedTransactionIds` lewat script recovery yang sudah ada pola-nya (`scripts/fixKbuLaciDupes.mjs`) — **adaptasi untuk KSM**, review dulu, dry-run.
4. Jika laporan hilang: sisipkan kembali objek laporan ke `dailyReports` dengan total/channels sesuai tx valid.
5. Verifikasi saldo `w_laci_ksm` (Query #7) vs kas fisik.
6. Baru deploy patch kode agar kejadian tidak berulang.

---

## 7. Yang sengaja tidak dilakukan

- Tidak mengubah data produksi.
- Tidak deployment.
- Tidak menghapus transaksi.
- Tidak merombak skema besar / memecah app_state ke tabel relasional (di luar scope perbaikan aman).
