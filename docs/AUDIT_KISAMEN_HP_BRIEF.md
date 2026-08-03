# Audit Kisamen 1–2 Agu — panduan singkat (HP → laptop)

## Dari HP sekarang

Tidak perlu jalankan SQL. Tidak perlu apa-apa di HP.

Yang sudah disiapkan di kode:

| File | Fungsi |
|------|--------|
| `scripts/auditKisamenAug2026.mjs` | Baca `app_state` sekali, cek hanya KSM 1–2 Agu: laporan ada/hilang + omset tunai dobel |
| `supabase/audit-kisamen-aug2026.sql` | Query 0–8 lengkap (cadangan SQL Editor) |
| `docs/AUDIT_KISAMEN_LAPORAN_AUG2026_RESULTS.md` | Tempat hasil (terisi otomatis oleh script) |

---

## Besok dari laptop — cukup 1 perintah (wajib)

Di folder repo, pastikan `.env.local` punya:

```env
NEXT_PUBLIC_SUPABASE_URL=https://odugkllatrpxjerrjjxo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…   # Supabase → Settings → API → service_role
```

Lalu:

```bash
npm run audit:kisamen
```

atau:

```bash
node scripts/auditKisamenAug2026.mjs
```

Script akan menulis verdict ke `docs/AUDIT_KISAMEN_LAPORAN_AUG2026_RESULTS.md`.

Itu sudah mencakup bukti yang Anda butuhkan:

1. Laporan KSM **1 Agu** ada atau hilang (+ status)
2. Laporan KSM **2 Agu** ada atau hilang (+ status)
3. Berapa tx omset tunai laci per tanggal
4. Apakah kandidat **dobel** (dan `tx_id` / `report_id`-nya)

**Tidak perlu** menjalankan Query 0–8 penuh kecuali script gagal.

---

## Hanya jika script gagal — 2 query SQL wajib

Buka Supabase → SQL Editor. Jalankan **hanya dua ini** (bukan seluruh file).

### Wajib A — Laporan ada/hilang?

```sql
SELECT
  r->>'id' AS report_id,
  r->>'date' AS report_date,
  r->>'status' AS status,
  (r->>'total')::bigint AS total,
  (r->>'setoranOwner')::bigint AS setoran_tunai,
  r->>'submittedAt' AS submitted_at,
  r->>'settledAt' AS settled_at
FROM app_state,
  jsonb_array_elements(COALESCE(data->'dailyReports', '[]'::jsonb)) AS r
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND r->>'outlet' = 'KSM'
  AND r->>'date' IN ('2026-08-01', '2026-08-02')
ORDER BY r->>'date';
```

### Wajib B — Omset tunai dobel?

```sql
SELECT
  t->>'date' AS tx_date,
  t->>'id' AS tx_id,
  (t->>'amount')::bigint AS nominal,
  t->>'dailyReportId' AS report_id,
  t->>'source' AS source,
  t->>'desc' AS deskripsi,
  t->>'createdAt' AS created_at
FROM app_state,
  jsonb_array_elements(COALESCE(data->'transactions', '[]'::jsonb)) AS t
WHERE business_id = 'e23ed572-234c-4995-acad-fa6bff7c58d2'
  AND t->>'type' = 'in'
  AND t->>'source' ILIKE '%Laporan harian%'
  AND t->>'date' IN ('2026-08-01', '2026-08-02')
  AND (
    COALESCE(t->>'walletId', t->>'wallet_id') = 'w_laci_ksm'
    OR t->>'desc' ILIKE '%Omset tunai KSM%'
  )
ORDER BY t->>'date', t->>'id';
```

Cara baca cepat:

- A kosong + B ada baris → **laporan hilang, dompet tercatat**
- A ada + B ≥2 baris tanggal sama → **kandidat dompet dobel**
- A ada + B =1 → kemungkinan normal untuk tanggal itu

Query lain (settle, timezone, saldo full) **opsional** — tidak wajib untuk bukti inti ini.
