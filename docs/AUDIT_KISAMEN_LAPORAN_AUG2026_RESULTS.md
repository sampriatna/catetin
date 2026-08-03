# Hasil Audit Database — Kisamen 1–2 Agustus 2026

**Status:** Query **BELUM dapat dijalankan** terhadap production.  
**Business ID target:** `e23ed572-234c-4995-acad-fa6bff7c58d2` (Nusa Food)  
**Sumber SQL:** `supabase/audit-kisamen-aug2026.sql`  
**Tanggal percobaan agent:** 2026-08-03  
**Mode:** read-only saja — tidak ada UPDATE / DELETE / INSERT / UPSERT / RPC mutasi.

---

## Mengapa hasil baris belum ada

Agent cloud ini **tidak punya kredensial yang cukup** untuk membaca `app_state` production.

| Percobaan | Hasil |
|-----------|--------|
| File `.env.local` di workspace | **Tidak ada** (hanya `.env.example`) |
| `SUPABASE_SERVICE_ROLE_KEY` di environment agent | **Tidak ada** |
| Cursor environment secrets / build snapshot | Environment `null` — tidak ada secret DB |
| GitHub Actions secrets | Tidak bisa dibaca (HTTP 403) |
| URL production terkonfirmasi | `https://odugkllatrpxjerrjjxo.supabase.co` (dari bundle `catatin.nusafishing.com`) |
| Key publishable/anon di client | `sb_publishable_…` — tersedia di JS publik |
| `GET /rest/v1/app_state?business_id=eq.e23ed572-…` dengan key publishable | HTTP **200**, body `[]`, `content-range: */0` |

**Penjelasan teknis:** RLS pada `app_state` hanya mengizinkan `SELECT` jika `is_business_member(business_id)` (lihat `supabase/schema.sql`). Key publishable tanpa sesi user anggota bisnis melihat **0 baris**, bukan error. Jadi hasil kosong **bukan** bukti bahwa laporan Kisamen tidak ada.

Script audit di repo (`scripts/diagSyncReports.mjs`, dll.) membutuhkan:

```bash
NEXT_PUBLIC_SUPABASE_URL=…
SUPABASE_SERVICE_ROLE_KEY=…   # atau login sebagai anggota bisnis di SQL Editor
```

Tanpa itu, **mengarang isi Query 0–8 melanggar aturan audit**. Di bawah ini: template hasil + query siap tempel di Supabase SQL Editor.

---

## Cara menjalankan (manual, production)

1. Buka **Supabase Dashboard** project yang URL-nya `odugkllatrpxjerrjjxo.supabase.co`.
2. Pastikan project ini berisi bisnis `e23ed572-234c-4995-acad-fa6bff7c58d2`.
3. Buka **SQL Editor** (role cukup untuk bypass RLS, atau pakai service role / owner session).
4. Jalankan **satu query per eksekusi** (Query 0 → Query 8) dari bagian berikut.
5. Salin hasil (CSV / tabel) ke bagian “Hasil aktual” di bawah setiap query pada file ini, lalu commit/PR ulang — atau kirim ke agent untuk diisi.

**Jangan** jalankan script `fix*.mjs` atau perintah mutasi apa pun untuk langkah ini.

---

## Query 0 — Snapshot app_state

### SQL

```sql
SELECT
  business_id,
  updated_at AT TIME ZONE 'Asia/Jakarta' AS updated_wib,
  jsonb_array_length(COALESCE(data->'dailyReports', '[]'::jsonb)) AS total_laporan,
  jsonb_array_length(COALESCE(data->'transactions', '[]'::jsonb)) AS total_transaksi
FROM app_state
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2';
```

### Hasil aktual

* updated_at: **BELUM DIJALANKAN**
* jumlah laporan: **BELUM DIJALANKAN**
* jumlah transaksi: **BELUM DIJALANKAN**

---

## Query 1 — Laporan Kisamen 1–2 Agustus 2026

### SQL

```sql
SELECT
  r->>'id' AS report_id,
  r->>'outlet' AS outlet,
  r->>'date' AS report_date,
  r->>'status' AS status,
  (r->>'total')::bigint AS total,
  (r->>'setoranOwner')::bigint AS setoran_tunai,
  r->>'kasirName' AS kasir,
  r->>'kasirId' AS kasir_id,
  r->>'submittedAt' AS submitted_at,
  r->>'resubmittedAt' AS resubmitted_at,
  r->>'adminVerifiedAt' AS verified_at,
  r->>'settledAt' AS settled_at,
  r->>'settledBy' AS settled_by,
  r->>'submissionId' AS submission_id,
  r->>'idempotencyKey' AS idempotency_key,
  r->'channels' AS channels
FROM app_state,
  jsonb_array_elements(COALESCE(data->'dailyReports', '[]'::jsonb)) AS r
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND r->>'outlet' = 'KSM'
  AND r->>'date' IN ('2026-08-01', '2026-08-02')
ORDER BY r->>'date', r->>'submittedAt';
```

### Hasil aktual

| report_id | tanggal | status | total | setoran tunai | submittedAt | settledAt | submissionId | idempotencyKey |
|-----------|---------|--------|-------|---------------|-------------|-----------|--------------|----------------|
| **BELUM DIJALANKAN — tempel baris di sini** | | | | | | | | |

Jika 0 baris: catat “tidak ada laporan KSM 1–2 Agu di `dailyReports`”.

---

## Query 2 — Transaksi Laci Kisamen

### SQL

```sql
SELECT
  t->>'id' AS tx_id,
  t->>'date' AS tx_date,
  t->>'type' AS tipe,
  (t->>'amount')::bigint AS nominal,
  COALESCE(t->>'walletId', t->>'wallet_id') AS wallet_id,
  t->>'fromWalletId' AS from_wallet,
  t->>'toWalletId' AS to_wallet,
  t->>'source' AS source,
  t->>'desc' AS deskripsi,
  t->>'dailyReportId' AS report_id,
  t->>'idempotencyKey' AS idempotency_key,
  t->>'createdAt' AS created_at,
  t->'meta'->>'createdById' AS created_by,
  t->'meta'->>'createdByName' AS created_by_name
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND (
    COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
    OR t->>'fromWalletId' = 'w_laci_ksm'
    OR t->>'toWalletId' = 'w_laci_ksm'
    OR t->>'desc' ILIKE '%KSM%'
    OR t->>'dailyReportId' IN (
      SELECT r->>'id'
      FROM app_state a2,
        jsonb_array_elements(COALESCE(a2.data->'dailyReports', '[]'::jsonb)) AS r
      WHERE a2.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
        AND r->>'outlet' = 'KSM'
        AND r->>'date' IN ('2026-08-01', '2026-08-02')
    )
  )
  AND (
    t->>'date' IN ('2026-08-01', '2026-08-02', '2026-08-03')
    OR t->>'desc' ILIKE '%2026-08-01%'
    OR t->>'desc' ILIKE '%2026-08-02%'
  )
ORDER BY t->>'date', t->>'source', (t->>'amount')::bigint, t->>'id';
```

### Hasil aktual

| tx_id | tanggal | nominal | type | source | description | dailyReportId | wallet | createdAt |
|-------|---------|---------|------|--------|-------------|---------------|--------|-----------|
| **BELUM DIJALANKAN — tempel baris di sini** | | | | | | | | |

---

## Query 3 — Transaksi omset tunai

### SQL

```sql
SELECT
  t->>'date' AS tx_date,
  (t->>'amount')::bigint AS nominal,
  t->>'id' AS tx_id,
  t->>'dailyReportId' AS report_id,
  t->>'source' AS source,
  t->>'desc' AS deskripsi
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND t->>'source' ILIKE '%Laporan harian%'
  AND t->>'type' = 'in'
  AND (
    t->>'desc' ILIKE '%Omset tunai KSM%'
    OR COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
  )
  AND t->>'date' IN ('2026-08-01', '2026-08-02')
ORDER BY t->>'date', (t->>'amount')::bigint, t->>'id';
```

### Hasil aktual

* 2026-08-01 — jumlah tx omset tunai: **BELUM DIJALANKAN**
* 2026-08-02 — jumlah tx omset tunai: **BELUM DIJALANKAN**
* Detail baris: **BELUM DIJALANKAN**

---

## Query 4 — Kandidat duplikat

### SQL

```sql
SELECT
  t->>'date' AS tx_date,
  t->>'type' AS tipe,
  t->>'source' AS source,
  (t->>'amount')::bigint AS nominal,
  COUNT(*) AS jumlah_baris,
  array_agg(t->>'id' ORDER BY t->>'id') AS tx_ids,
  array_agg(DISTINCT t->>'dailyReportId') AS report_ids
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND (
    COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
    OR t->>'fromWalletId' = 'w_laci_ksm'
    OR t->>'desc' ILIKE '%KSM%'
  )
  AND t->>'date' IN ('2026-08-01', '2026-08-02', '2026-08-03')
GROUP BY 1, 2, 3, 4
HAVING COUNT(*) > 1
ORDER BY 1, 4;
```

Lalu untuk setiap kelompok, ambil detail penuh (jangan putuskan “dobel” hanya dari tanggal+nominal):

```sql
-- Ganti :tx_ids dari array_agg Query 4
SELECT
  t->>'id' AS tx_id,
  t->>'date' AS tx_date,
  t->>'type' AS tipe,
  (t->>'amount')::bigint AS nominal,
  t->>'source' AS source,
  t->>'desc' AS deskripsi,
  t->>'dailyReportId' AS report_id,
  COALESCE(t->>'walletId', t->>'wallet_id') AS wallet_id,
  t->>'fromWalletId' AS from_wallet,
  t->>'toWalletId' AS to_wallet,
  t->>'createdAt' AS created_at,
  t->>'idempotencyKey' AS idempotency_key,
  t->'meta'->>'createdById' AS created_by,
  t->'meta'->>'createdByName' AS created_by_name
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND t->>'id' = ANY(ARRAY['TX_ID_1','TX_ID_2']::text[]);
```

### Hasil aktual

**BELUM DIJALANKAN.**

Untuk setiap kandidat (setelah dijalankan), isi:

* jumlah transaksi:
* seluruh tx_id:
* nominal / tanggal / source / report_id:
* perbandingan deskripsi, createdAt, created_by, arah (in/out/transfer):
* putusan: **duplikat sejati** / **sah berbeda** / **tidak jelas — perlu review manusia**

---

## Query 5 — Transaksi settlement

### SQL

```sql
SELECT
  t->>'id' AS tx_id,
  t->>'date' AS settle_tx_date,
  t->>'dailyReportId' AS report_id,
  t->>'type' AS tipe,
  (t->>'amount')::bigint AS nominal,
  COALESCE(t->>'walletId', t->>'wallet_id') AS wallet_id,
  t->>'fromWalletId' AS from_wallet,
  t->>'toWalletId' AS to_wallet,
  t->>'desc' AS deskripsi,
  t->>'idempotencyKey' AS idempotency_key
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND t->>'source' ILIKE '%Settle Admin%'
  AND (
    t->>'dailyReportId' IN (
      SELECT r->>'id'
      FROM app_state a2,
        jsonb_array_elements(COALESCE(a2.data->'dailyReports', '[]'::jsonb)) AS r
      WHERE a2.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
        AND r->>'outlet' = 'KSM'
        AND r->>'date' IN ('2026-08-01', '2026-08-02')
    )
    OR t->>'desc' ILIKE '%KSM%2026-08-0%'
  )
ORDER BY t->>'dailyReportId', t->>'id';
```

### Hasil aktual

* Settlement untuk laporan 2026-08-01: **BELUM DIJALANKAN**
* Settlement untuk laporan 2026-08-02: **BELUM DIJALANKAN**

---

## Query 6 — Ghost / orphan transaction

### SQL

```sql
WITH reports AS (
  SELECT r
  FROM app_state,
    jsonb_array_elements(COALESCE(data->'dailyReports', '[]'::jsonb)) AS r
  WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
    AND r->>'outlet' = 'KSM'
    AND r->>'date' IN ('2026-08-01', '2026-08-02')
),
txs AS (
  SELECT t
  FROM app_state,
    jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
  WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
    AND t->>'date' IN ('2026-08-01', '2026-08-02', '2026-08-03')
    AND (
      t->>'source' ILIKE '%Laporan harian%'
      OR t->>'source' ILIKE '%Settle Admin%'
    )
    AND (
      t->>'desc' ILIKE '%KSM%'
      OR COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
      OR t->>'fromWalletId' = 'w_laci_ksm'
    )
)
SELECT
  t->>'id' AS tx_id,
  t->>'dailyReportId' AS report_id,
  t->>'source' AS source,
  (t->>'amount')::bigint AS nominal,
  t->>'date' AS tx_date,
  (
    SELECT r->>'status' FROM reports WHERE r->>'id' = t->>'dailyReportId' LIMIT 1
  ) AS report_status,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM reports WHERE r->>'id' = t->>'dailyReportId')
      THEN 'ORPHAN_TX_NO_REPORT'
    WHEN (
      SELECT r->>'status' FROM reports WHERE r->>'id' = t->>'dailyReportId' LIMIT 1
    ) IS DISTINCT FROM 'settled'
      AND t->>'source' ILIKE '%Settle Admin%'
      THEN 'SETTLE_TX_BUT_REPORT_NOT_SETTLED'
    ELSE 'OK'
  END AS temuan
FROM txs
ORDER BY temuan DESC, tx_date, tx_id;
```

### Hasil aktual

* ORPHAN_TX_NO_REPORT: **BELUM DIJALANKAN**
* SETTLE_TX_BUT_REPORT_NOT_SETTLED: **BELUM DIJALANKAN**
* OK: **BELUM DIJALANKAN**

---

## Query 7 — Saldo Laci Kisamen

### SQL

```sql
WITH w AS (
  SELECT (elem->>'opening')::bigint AS opening
  FROM app_state,
    jsonb_array_elements(COALESCE(data->'wallets', '[]'::jsonb)) AS elem
  WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
    AND elem->>'id' = 'w_laci_ksm'
  LIMIT 1
),
mutasi AS (
  SELECT
    COALESCE(SUM(
      CASE
        WHEN t->>'type' = 'in' AND COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
          THEN (t->>'amount')::bigint
        WHEN t->>'type' = 'out' AND COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
          THEN -(t->>'amount')::bigint
        WHEN t->>'type' = 'transfer' AND t->>'toWalletId' = 'w_laci_ksm'
          THEN (t->>'amount')::bigint
        WHEN t->>'type' = 'transfer' AND t->>'fromWalletId' = 'w_laci_ksm'
          THEN -(t->>'amount')::bigint
        ELSE 0
      END
    ), 0) AS delta
  FROM app_state,
    jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
  WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
)
SELECT
  (SELECT opening FROM w) AS opening,
  (SELECT delta FROM mutasi) AS mutasi_netto,
  (SELECT opening FROM w) + (SELECT delta FROM mutasi) AS saldo_hitung;
```

### Hasil aktual

* opening balance: **BELUM DIJALANKAN**
* mutasi netto: **BELUM DIJALANKAN**
* saldo hasil hitung: **BELUM DIJALANKAN**

---

## Query 8 — Timezone

### SQL

```sql
SELECT
  r->>'id' AS report_id,
  r->>'date' AS report_date,
  r->>'submittedAt' AS submitted_at_utc,
  (r->>'submittedAt')::timestamptz AT TIME ZONE 'Asia/Jakarta' AS submitted_at_wib,
  CASE
    WHEN r->>'submittedAt' IS NULL THEN NULL
    WHEN to_char((r->>'submittedAt')::timestamptz AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
         IS DISTINCT FROM r->>'date'
      THEN 'SUBMITTED_AT_BEDA_HARI_DARI_REPORT_DATE'
    ELSE 'OK'
  END AS catatan_timezone
FROM app_state,
  jsonb_array_elements(COALESCE(data->'dailyReports', '[]'::jsonb)) AS r
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND r->>'outlet' = 'KSM'
  AND r->>'date' IN ('2026-08-01', '2026-08-02')
ORDER BY r->>'date';
```

### Hasil aktual

* Ada perbedaan report_date vs submittedAt (WIB)? **BELUM DIJALANKAN**
* Detail baris: **BELUM DIJALANKAN**

---

## Kesimpulan berbasis bukti (saat ini)

Jawaban di bawah ini **hanya** dari yang bisa dibuktikan tanpa baris production. Poin yang membutuhkan Query 0–8 ditandai **TIDAK BISA DISIMPULKAN**.

| # | Pertanyaan | Jawaban berbasis bukti |
|---|------------|-------------------------|
| 1 | Laporan 1 Agu tersimpan? | **TIDAK BISA DISIMPULKAN** — butuh Query 1. (Query anon kosong = RLS, bukan bukti absen.) |
| 2 | Laporan 2 Agu tersimpan? | **TIDAK BISA DISIMPULKAN** — butuh Query 1. |
| 3 | Status masing-masing? | **TIDAK BISA DISIMPULKAN** — butuh Query 1. |
| 4 | Ada transaksi dompet benar-benar dobel? | **TIDAK BISA DISIMPULKAN** — butuh Query 3–4 + detail per `report_id`/deskripsi/`createdAt`. |
| 5 | Jika dobel: tx valid vs kandidat? | **TIDAK BISA DISIMPULKAN** — butuh Query 4 detail. |
| 6 | Laporan gagal tetapi tx dompet berhasil? | **TIDAK BISA DISIMPULKAN** — butuh Query 1 + 6 (pola orphan). Dari **kode**, skenario ini **mungkin** (merge cloud pull asimetris sebelum patch). |
| 7 | Hanya masalah tampilan/filter frontend? | **TIDAK BISA DISIMPULKAN** tanpa data. Dari **kode**, bug sync bisa menghapus laporan dari state lokal meski tx tetap — bisa tampak seperti “tidak tersimpan” meski pernah ada di HP. |
| 8 | Masalah timezone? | **TIDAK BISA DISIMPULKAN** — butuh Query 8. Dari **kode**, `report.date` dari form (bukan `toISOString().slice`), jadi UTC drift bukan akar utama yang paling mungkin. |
| 9 | Patch idempotency untuk data lama? | **Hanya data baru / submit baru.** Patch **tidak** memperbaiki atau menulis ulang baris production yang sudah ada. `submissionId` hanya terisi pada submit setelah deploy. Data lama tetap perlu audit + koreksi terpisah (reversal/tombstone), **belum dijalankan**. |
| 10 | Rekomendasi koreksi (jangan dijalankan) | Setelah Query 0–8 diisi: (a) tentukan `report_id` valid per tanggal; (b) jika ada orphan cash → pulihkan laporan **atau** reversal tx dobel dengan audit trail; (c) jangan `DELETE` mentah; (d) samakan status settled hanya jika settle tx lengkap dan disepakati admin. Detail kerangka: `docs/AUDIT_KISAMEN_LAPORAN_AUG2026.md`. |

---

## Agar agent bisa mengisi hasil otomatis lain kali

Sediakan salah satu (read-only cukup):

1. Isi `.env.local` di environment cloud agent:

```env
NEXT_PUBLIC_SUPABASE_URL=https://odugkllatrpxjerrjjxo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role dari Supabase → Settings → API>
```

2. Atau tempel hasil CSV/tabel Query 0–8 dari SQL Editor ke chat / ke file ini.

Setelah itu agent dapat mengisi bagian “Hasil aktual” dan menyusun kesimpulan 1–10 berbasis baris nyata — tetap tanpa mutasi data.
