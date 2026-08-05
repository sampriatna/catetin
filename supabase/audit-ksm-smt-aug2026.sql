-- =============================================================================
-- AUDIT READ-ONLY — Kisamen 1 Agu 2026 + Samtaro 3 Agu 2026
-- =============================================================================
-- JANGAN jalankan UPDATE / DELETE / INSERT dari file ini.
-- Bisnis: e23ed572-234c-4995-acad-fa6bff7c58d2
-- KSM = Kisamen (w_laci_ksm) · SMT = Samtaro (w_laci_smt)
-- =============================================================================

-- 0) Snapshot
SELECT
  business_id,
  updated_at AT TIME ZONE 'Asia/Jakarta' AS updated_wib,
  jsonb_array_length(COALESCE(data->'dailyReports', '[]'::jsonb)) AS total_laporan,
  jsonb_array_length(COALESCE(data->'transactions', '[]'::jsonb)) AS total_transaksi,
  jsonb_array_length(COALESCE(data->'deletedDailyReportIds', '[]'::jsonb)) AS deleted_report_ids,
  jsonb_array_length(COALESCE(data->'deletedDailyReportSlots', '[]'::jsonb)) AS deleted_slots
FROM app_state
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2';

-- 1) Laporan target: KSM 2026-08-01 + SMT 2026-08-03
--    (+ konteks outlet lain di tanggal sama untuk cek false-duplicate)
SELECT
  r->>'id' AS report_id,
  r->>'outlet' AS outlet,
  r->>'date' AS report_date,
  r->>'status' AS status,
  (r->>'total')::bigint AS nominal_omzet,
  (r->>'setoranOwner')::bigint AS setoran_tunai,
  r->>'kasirName' AS kasir,
  r->>'submittedAt' AS submitted_at,
  r->>'resubmittedAt' AS resubmitted_at,
  r->>'settledAt' AS settled_at,
  r->>'submissionId' AS submission_id,
  r->>'idempotencyKey' AS idempotency_key,
  r->>'businessId' AS business_id_field,
  CASE
    WHEN r->>'outlet' IS NULL OR r->>'date' IS NULL OR r->>'id' IS NULL THEN 'INCOMPLETE_IDENTITY'
    WHEN r->>'status' IS NULL OR r->>'status' = 'submitting' THEN 'INCOMPLETE_STATUS'
    WHEN r->>'submittedAt' IS NULL AND r->>'settledAt' IS NULL AND r->>'resubmittedAt' IS NULL THEN 'INCOMPLETE_TIMESTAMP'
    ELSE 'CHECK_TX'
  END AS completeness_hint
FROM app_state,
  jsonb_array_elements(COALESCE(data->'dailyReports', '[]'::jsonb)) AS r
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND (
    (r->>'outlet' = 'KSM' AND r->>'date' = '2026-08-01')
    OR (r->>'outlet' = 'SMT' AND r->>'date' = '2026-08-03')
    OR (r->>'date' IN ('2026-08-01', '2026-08-03'))
  )
ORDER BY r->>'date', r->>'outlet', r->>'submittedAt';

-- 2) Tx omset / settle terkait KSM 1 Agu & SMT 3 Agu
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
  t->>'createdAt' AS created_at
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND (
    (
      t->>'date' = '2026-08-01'
      AND (
        COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
        OR t->>'fromWalletId' = 'w_laci_ksm'
        OR t->>'toWalletId' = 'w_laci_ksm'
        OR t->>'desc' ILIKE '%KSM%'
      )
    )
    OR (
      t->>'date' IN ('2026-08-03', '2026-08-04')
      AND (
        COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_smt'
        OR t->>'fromWalletId' = 'w_laci_smt'
        OR t->>'toWalletId' = 'w_laci_smt'
        OR t->>'desc' ILIKE '%SMT%'
      )
    )
    OR t->>'dailyReportId' IN (
      SELECT r->>'id'
      FROM app_state a2,
        jsonb_array_elements(COALESCE(a2.data->'dailyReports', '[]'::jsonb)) AS r
      WHERE a2.business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
        AND (
          (r->>'outlet' = 'KSM' AND r->>'date' = '2026-08-01')
          OR (r->>'outlet' = 'SMT' AND r->>'date' = '2026-08-03')
        )
    )
  )
ORDER BY t->>'date', t->>'source', t->>'id';

-- 3) Duplikat omset tunai per outlet+tanggal
SELECT
  t->>'date' AS tx_date,
  CASE
    WHEN COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm' OR t->>'desc' ILIKE '%Omset tunai KSM%' THEN 'KSM'
    WHEN COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_smt' OR t->>'desc' ILIKE '%Omset tunai SMT%' THEN 'SMT'
    ELSE '?'
  END AS outlet_guess,
  (t->>'amount')::bigint AS nominal,
  COUNT(*) AS jumlah_baris,
  array_agg(t->>'id' ORDER BY t->>'id') AS tx_ids,
  array_agg(DISTINCT t->>'dailyReportId') AS report_ids
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND t->>'source' ILIKE '%Laporan harian%'
  AND t->>'type' = 'in'
  AND t->>'date' IN ('2026-08-01', '2026-08-03')
  AND (
    COALESCE(t->>'walletId', t->>'wallet_id') IN ('w_laci_ksm', 'w_laci_smt')
    OR t->>'desc' ILIKE '%Omset tunai KSM%'
    OR t->>'desc' ILIKE '%Omset tunai SMT%'
  )
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1
ORDER BY 1, 2;

-- 4) Tombstone slot yang mungkin mengunci
SELECT
  s->>'outlet' AS outlet,
  s->>'date' AS report_date,
  s->>'reportId' AS deleted_report_id,
  s->>'deletedAt' AS deleted_at
FROM app_state,
  jsonb_array_elements(COALESCE(data->'deletedDailyReportSlots', '[]'::jsonb)) AS s
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND (
    (s->>'outlet' = 'KSM' AND s->>'date' = '2026-08-01')
    OR (s->>'outlet' = 'SMT' AND s->>'date' = '2026-08-03')
  );
