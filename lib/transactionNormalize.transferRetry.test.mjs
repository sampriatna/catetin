// node lib/transactionNormalize.transferRetry.test.mjs
import assert from "node:assert/strict";
import {
  normalizeTransactions,
  dedupeTransferRetries,
} from "./transactionNormalize.js";

const base = {
  type: "transfer",
  amount: 500_000,
  fromWalletId: "w_bca",
  toWalletId: "w_kas_kecil",
  date: "2026-08-20",
  desc: "Dana purchasing",
  source: "Manual",
  meta: { createdById: "admin-1" },
};

{
  const rows = normalizeTransactions([
    { ...base, id: "t1755684000000aaa", meta: { createdById: "admin-1", transferRef: "trf_a" } },
    { ...base, id: "t1755684005000bbb", meta: { createdById: "admin-1", transferRef: "trf_b" } },
  ]);
  assert.equal(rows.length, 1, "retry dengan random transferRef berbeda harus tetap satu transaksi");
  assert.equal(rows[0].id, "t1755684000000aaa", "transaksi original/lebih awal dipertahankan");
}

{
  const rows = normalizeTransactions([
    { ...base, id: "t1755684000000aaa" },
    { ...base, id: "t1755684070000bbb" },
  ]);
  assert.equal(rows.length, 2, "transfer identik setelah lewat 60 detik tetap dianggap aksi terpisah");
}

{
  const rows = normalizeTransactions([
    { ...base, id: "t1755684000000aaa", meta: { createdById: "admin-1" } },
    { ...base, id: "t1755684005000bbb", meta: { createdById: "admin-2" } },
  ]);
  assert.equal(rows.length, 2, "transfer dari user berbeda tidak boleh digabung");
}

{
  const rows = normalizeTransactions([
    { ...base, id: "t1755684000000aaa", meta: { createdById: "admin-1", transferActionId: "act-123" } },
    { ...base, id: "t1755684999999bbb", amount: 999_999, meta: { createdById: "admin-1", transferActionId: "act-123" } },
  ]);
  assert.equal(rows.length, 1, "transferActionId yang sama harus exactly-once walau retry terlambat");
  assert.equal(rows[0].amount, 500_000, "payload original dipertahankan untuk action id yang sama");
}

{
  const rows = normalizeTransactions([
    { id: "a", type: "in", amount: 1_000, walletId: "w1" },
    { id: "b", type: "in", amount: 1_000, walletId: "w1" },
  ]);
  assert.equal(rows.length, 2, "transaksi non-transfer tidak ikut semantic dedupe");
}

{
  const rows = normalizeTransactions([
    { ...base, id: "t1755684000000aaa", meta: {} },
    { ...base, id: "t1755684005000bbb", meta: {} },
  ]);
  assert.equal(rows.length, 2, "transfer legacy tanpa identitas pembuat tidak ditebak sebagai duplicate");
}

{
  const rows = dedupeTransferRetries([
    { ...base, id: "t1755684000000aaa" },
    { ...base, id: "t1755684001000bbb" },
  ], { windowMs: 0 });
  assert.equal(rows.length, 2, "heuristic dedupe dapat dimatikan dengan window 0");
}

console.log("7 transfer idempotency tests passed");
