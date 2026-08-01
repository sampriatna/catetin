# Perubahan putaran 3 → putaran 4 (blocker review)

Branch/PR yang sama (#4) — revisi blocker; **bukan** migration timestamp; **tidak** dieksekusi.

| File | Perubahan utama |
|---|---|
| `00_README_REVIEW.md` | Gate cutover invite `01`/`08`; larangan ganti RPC legacy / ubah app lama |
| `INVITE_CUTOVER.md` | **Baru** — rencana cutover kompatibel `accept_invite` / `claim_pending_invites` |
| `01_…assignments.sql` | Header GATE: jangan apply sebelum app v2 + smoke legacy lulus |
| `02_…master.sql` | (tidak diubah di putaran 4) |
| `03_…ledger.sql` | (tidak diubah di putaran 4) |
| `04_…waste.sql` | Hapus `received_later` dari CHECK variance resolutions |
| `05_…links.sql` | (tidak diubah di putaran 4) |
| `06_…rpcs.sql` | (tidak diubah di putaran 4) |
| `07_domain_rpcs.sql` | Stale opname: UPDATE `recount_required` lalu **return** (tanpa RAISE); hapus path `received_later` di `resolve_transfer_variance` |
| `08_…invite.sql` | Header GATE; tetap **additive** v2 saja — tidak replace RPC legacy |
| `99_ROLLBACK_ALL.sql` | (tidak diubah di putaran 4) |
| `SECURITY_TEST_PLAN.md` | Stale opname return; variance tanpa received_later; gate invite |
| `SCHEMA_SUMMARY.md` | Transfer receive vs variance diperjelas |

## Belum ada / tidak dilakukan di revisi ini

- Migration timestamp di `supabase/migrations/`
- Eksekusi SQL / seed / deploy
- Perubahan file aplikasi lama, `app_state`, wallets, transactions, RPC login lama, policy legacy
- Replace / drop `accept_invite` / `claim_pending_invites`
