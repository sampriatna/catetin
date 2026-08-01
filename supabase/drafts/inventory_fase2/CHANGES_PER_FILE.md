# Perubahan putaran 3 (setelah PR #3 merged)

Branch/PR **baru** — bukan update PR #3.

| File | Perubahan utama |
|---|---|
| `00_README_REVIEW.md` | Catatan PR #3 sudah merge; larangan eksekusi; arsitektur RPC-only |
| `01_…assignments.sql` | CHECK role↔location (dapur/bar/kasir/ops wajib lokasi; forecasting null) |
| `02_…master.sql` | CHECK settings; `stock_unit_id` canonical + sync; opening sessions; FK RESTRICT; lot validator reusable |
| `03_…ledger.sql` | Tabel `stock_movement_compensations`; tidak update posted; `from<>to`; kompensasi selalu via row baru |
| `04_…waste.sql` | Opname snapshot/recount; `physical_qty>=0`; transfer receipts `qty>0` + unique line; variance resolutions table |
| `05_…links.sql` | Freeze penuh approved/locked/received; from_po wajib PR sama; `received` flag |
| `06_…rpcs.sql` | Hapus write policy purchasing links; state/settings write hanya lewat RPC |
| `07_domain_rpcs.sql` | `_require_assignment` ketat; create/review link; receive gates; cost_pending terpisah; stale opname; opening session+go-live; resolve variance; draft RPCs |
| `08_…invite.sql` | Email invite wajib cocok dengan profile login |
| `99_ROLLBACK_ALL.sql` | Preflight: **setiap** tabel baru bila ada row → stop sebelum DROP |
| `SECURITY_TEST_PLAN.md` | + kasus A–N putaran 3 |

## Belum ada

- Migration timestamp di `supabase/migrations/`
- Approval / eksekusi SQL
- Opening go-live produksi
