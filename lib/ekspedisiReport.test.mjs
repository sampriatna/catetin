import test from "node:test";
import assert from "node:assert/strict";
import {
  ekspedisiDaySummary,
  formatEkspedisiWa,
  fmtEkspedisiRp,
  fmtEkspedisiDate,
} from "./ekspedisiReport.js";
import {
  FISHING_EKSPEDISI_WALLET_ID,
  ensureNfFishingWallets,
  needsNfFishingWalletEnsure,
  isEkspedisiWallet,
  NF_FISHING_WALLETS,
} from "./walletPresets.js";

test("fmtEkspedisi matches contoh laporan", () => {
  assert.equal(fmtEkspedisiRp(128300), "128.300");
  assert.equal(fmtEkspedisiRp(0), "-");
  assert.equal(fmtEkspedisiDate("2026-08-07"), "07.08.2026");
});

test("ensureNfFishingWallets injects Dompet Ekspedisi", () => {
  const before = NF_FISHING_WALLETS.filter((w) => w.id !== FISHING_EKSPEDISI_WALLET_ID).map((w) => ({ ...w }));
  assert.equal(needsNfFishingWalletEnsure(before), true);
  const next = ensureNfFishingWallets(before);
  assert.ok(next.some((w) => w.id === FISHING_EKSPEDISI_WALLET_ID));
  assert.equal(needsNfFishingWalletEnsure(next), false);
  assert.equal(ensureNfFishingWallets(next).length, next.length);
});

test("isEkspedisiWallet by id and name", () => {
  assert.equal(isEkspedisiWallet({ id: FISHING_EKSPEDISI_WALLET_ID, name: "X" }), true);
  assert.equal(isEkspedisiWallet({ id: "w_custom", name: "Dompet Ekspedisi JNE" }), true);
  assert.equal(isEkspedisiWallet({ id: "w_fish_marketplace", name: "Marketplace" }), false);
});

test("ekspedisiDaySummary matches contoh JNE 07.08.2026", () => {
  const wallets = [
    { id: FISHING_EKSPEDISI_WALLET_ID, name: "Dompet Ekspedisi", type: "kas_fisik", opening: 128300, active: true },
  ];
  const transactions = [
    {
      id: "t1",
      type: "in",
      amount: 90000,
      date: "2026-08-07",
      walletId: FISHING_EKSPEDISI_WALLET_ID,
      categoryId: "nf_in_ekspedisi_cash",
      desc: "COD",
    },
    {
      id: "t2",
      type: "out",
      amount: 20000,
      date: "2026-08-07",
      walletId: FISHING_EKSPEDISI_WALLET_ID,
      categoryId: "nf_out_pengiriman",
      desc: "Paking Kayu JNE",
    },
  ];

  const s = ekspedisiDaySummary({ wallets, transactions, date: "2026-08-07" });
  assert.equal(s.modal, 128300);
  assert.equal(s.cashIn, 90000);
  assert.equal(s.transferIn, 0);
  assert.equal(s.expenseOut, 20000);
  assert.equal(s.total, 198300);
  assert.deepEqual(s.expenseNotes, ["Paking Kayu JNE"]);

  const wa = formatEkspedisiWa({ date: "2026-08-07", summary: s, courierLabel: "JNE" });
  assert.match(wa, /JNE \*07\.08\.2026\*/);
  assert.match(wa, /_Modal : \*128\.300\*_/);
  assert.match(wa, /Pemasukan Cash : 90\.000/);
  assert.match(wa, /Transfer : -/);
  assert.match(wa, /Pengeluaran : 20\.000 \( Paking Kayu JNE \)/);
  assert.match(wa, /Total: \*198\.300\*/);
});

test("transfer income counted separately from cash", () => {
  const wallets = [
    { id: FISHING_EKSPEDISI_WALLET_ID, name: "Dompet Ekspedisi", opening: 0, active: true },
  ];
  const transactions = [
    {
      id: "c",
      type: "in",
      amount: 50000,
      date: "2026-08-08",
      walletId: FISHING_EKSPEDISI_WALLET_ID,
      categoryId: "nf_in_ekspedisi_cash",
    },
    {
      id: "tr",
      type: "in",
      amount: 25000,
      date: "2026-08-08",
      walletId: FISHING_EKSPEDISI_WALLET_ID,
      categoryId: "nf_in_ekspedisi_trf",
    },
  ];
  const s = ekspedisiDaySummary({ wallets, transactions, date: "2026-08-08" });
  assert.equal(s.cashIn, 50000);
  assert.equal(s.transferIn, 25000);
  assert.equal(s.total, 75000);
});
