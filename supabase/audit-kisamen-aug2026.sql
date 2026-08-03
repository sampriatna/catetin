-- =============================================================================
-- AUDIT READ-ONLY — Laporan & Dompet Kisamen (KSM) tanggal 1–2 Agustus 2026
-- =============================================================================
-- JANGAN jalankan UPDATE / DELETE / INSERT dari file ini.
-- Bisnis utama Nusa Food:
--   e23ed572-234c-4995-acad-fa6bff7c58d2
-- Outlet Kisamen = kode 'KSM', laci = w_laci_ksm
--
-- Catatan arsitektur: laporan omset & transaksi dompet disimpan di
-- app_state.data (JSONB), bukan tabel terpisah. Idempotency_key ada di field
-- JSON laporan (submissionId / idempotencyKey) setelah patch kode ini.
-- =============================================================================

-- 0) Snapshot ringkas app_state
SELECT
  business_id,
  updated_at AT TIME ZONE 'Asia/Jakarta' AS updated_wib,
  jsonb_array_length(COALESCE(data->'dailyReports', '[]'::jsonb)) AS total_laporan,
  jsonb_array_length(COALESCE(data->'transactions', '[]'::jsonb)) AS total_transaksi
FROM app_state
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2';

-- 1) Semua laporan Kisamen tanggal 1 & 2 Agustus 2026
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

-- 2) Transaksi yang menyentuh Laci Kisamen pada / terkait tanggal tersebut
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

-- 3) Khusus omset tunai "Laporan harian" KSM 1–2 Agu (cari duplikat)
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

-- 4) Agregasi duplikat: nominal + tanggal + jenis yang muncul > 1×
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

-- 5) Tx settle terkait laporan KSM 1–2 Agu
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

-- 6) Ghost: ada tx laporan/settle tapi laporan tidak ada / status bukan settled
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

-- 7) Saldo Laci Kisamen (opening + mutasi) — hitung kasar di SQL
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

-- 8) Cek perbedaan tanggal UTC vs WIB pada submittedAt (laporan KSM Aug)
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
