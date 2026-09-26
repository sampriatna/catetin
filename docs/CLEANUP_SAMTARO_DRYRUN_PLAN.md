# Rencana cleanup Samtaro — DRY-RUN saja

**Status:** belum dieksekusi. Butuh persetujuan manual setelah audit read-only.

## Prinsip

1. Backup `app_state` dulu.
2. Satu record kanonis per `SMT + tanggal operasional + omzet`.
3. Tombstone identitas loser (report id + cash tx id) — jangan DELETE SQL mentah.
4. Jangan menjumlahkan nominal / saldo laci.
5. Setelah cleanup: audit ulang harus 0 duplikat slot.
6. Kasir hanya sync; jangan isi ulang.

## Perintah

```bash
# 1) Audit read-only (wajib dulu)
npm run audit:samtaro-dup

# 2) Dry-run rencana cleanup (TIDAK menulis)
npm run cleanup:samtaro-dup:dry-run

# Opsional filter tanggal:
node scripts/cleanupSamtaroDuplicatesDryRun.mjs --date=YYYY-MM-DD
```

`--execute` pada skrip dry-run **sengaja ditolak** sampai ada skrip execute terpisah + approval tertulis.

## Output yang diharapkan

- `docs/AUDIT_SAMTARO_DUPLICATES_RUNTIME.json` (disamarkan)
- `docs/CLEANUP_SAMTARO_DRYRUN_RUNTIME.json` (rencana tombstone)

## Kapan boleh execute

Hanya setelah:

1. Audit ditinjau manusia;
2. Record kanonis disetujui per tanggal;
3. Dampak Laci Samtaro (termasuk klaim Rp355.000) dipahami;
4. Backup tersimpan.
