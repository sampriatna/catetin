# Perubahan putaran 3 → putaran 4 (blocker review)

Branch/PR yang sama (#4) — revisi blocker; **bukan** migration timestamp; **tidak** dieksekusi.

| File | Perubahan utama |
|---|---|
| `00_README_REVIEW.md` | Gate cutover: SQL `01→02→08` dulu, baru app v2; STOP jika smoke legacy gagal |
| `INVITE_CUTOVER.md` | Urutan cutover diperbaiki + rollback/stop condition (bukan app-before-SQL) |
| `01_…assignments.sql` | Header GATE: apply `01→02→08`; smoke legacy; jangan app v2 dulu |
| `02_…master.sql` | (tidak diubah di putaran 4) |
| `03_…ledger.sql` | (tidak diubah di putaran 4) |
| `04_…waste.sql` | Hapus `received_later` dari CHECK variance resolutions |
| `05_…links.sql` | (tidak diubah di putaran 4) |
| `06_…rpcs.sql` | (tidak diubah di putaran 4) |
| `07_domain_rpcs.sql` | Stale opname: UPDATE `recount_required` lalu **return** (tanpa RAISE); hapus path `received_later` di `resolve_transfer_variance` |
| `08_…invite.sql` | Header GATE: bergantung `01`+`02`; additive v2; smoke legacy sebelum app |
| `99_ROLLBACK_ALL.sql` | (tidak diubah di putaran 4) |
| `SECURITY_TEST_PLAN.md` | Stale opname return; variance tanpa received_later; gate invite |
| `SCHEMA_SUMMARY.md` | Transfer receive vs variance diperjelas |

## Belum ada / tidak dilakukan di revisi ini

- Migration timestamp di `supabase/migrations/`
- Eksekusi SQL / seed / deploy
- Perubahan file aplikasi lama, `app_state`, wallets, transactions, RPC login lama, policy legacy
- Replace / drop `accept_invite` / `claim_pending_invites`
