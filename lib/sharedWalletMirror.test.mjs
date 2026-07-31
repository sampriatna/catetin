import test from "node:test";
import assert from "node:assert/strict";
import {
  computeWalletBalanceFromDoc,
  walletTransactionsFromDoc,
  mirrorBalancesForLinks,
  sourceBusinessIdsForLinks,
  applyMirrorBalances,
  sharedWalletId,
} from "./sharedWalletMirror.js";
import { buildFishingSharedLinks } from "./walletPresets.js";
import { CANONICAL_BUSINESS_ID } from "./canonicalBusiness.js";

const fnbDoc = {
  wallets: [
    { id: "w_bca", name: "BCA", type: "rekening", opening: 1000000 },
    { id: "w_bri", name: "BRI", type: "rekening", opening: 0 },
    { id: "w_kas_besar", name: "NF Cash (Kas Besar)", type: "kas_fisik", opening: 500000 },
    { id: "w_laci_kbu", name: "Laci KBU", opening: 250000 },
  ],
  transactions: [
    { id: "t1", type: "in", amount: 500000, walletId: "w_bca", date: "2026-07-01" },
    { id: "t2", type: "out", amount: 200000, wallet_id: "w_bca", date: "2026-07-02" },
    { id: "t3", type: "transfer", amount: 300000, fromWalletId: "w_bca", toWalletId: "w_bri", date: "2026-07-03" },
    { id: "t4", type: "in", amount: 999, walletId: "w_bca", date: "2026-07-04" },
  ],
  deletedTransactionIds: ["t4"],
};

test("computeWalletBalanceFromDoc: opening + in - out - transfer out, hormati tombstone", () => {
  // 1.000.000 + 500.000 - 200.000 - 300.000 (transfer keluar) ; t4 dihapus
  assert.equal(computeWalletBalanceFromDoc(fnbDoc, "w_bca"), 1000000);
});

test("computeWalletBalanceFromDoc: transfer masuk menambah saldo tujuan", () => {
  assert.equal(computeWalletBalanceFromDoc(fnbDoc, "w_bri"), 300000);
});

test("computeWalletBalanceFromDoc: dompet tak dikenal = 0", () => {
  assert.equal(computeWalletBalanceFromDoc(fnbDoc, "w_ghost"), 0);
});

test("walletTransactionsFromDoc: terbaru dulu & buang tombstone", () => {
  const rows = walletTransactionsFromDoc(fnbDoc, "w_bca");
  assert.deepEqual(rows.map((t) => t.id), ["t3", "t2", "t1"]);
});

test("mirror rekening Sam @ FNB terhitung dari doc FNB", () => {
  const links = buildFishingSharedLinks({ enabled: true });
  const map = mirrorBalancesForLinks(links, { [CANONICAL_BUSINESS_ID]: fnbDoc });
  const bca = map[sharedWalletId(links.find((l) => l.sourceWalletId === "w_bca"))];
  assert.equal(bca.balance, 1000000);
  assert.equal(bca.missing, false);
  const bni = map[sharedWalletId(links.find((l) => l.sourceWalletId === "w_bni"))];
  assert.equal(bni.balance, 0);
  assert.equal(bni.missing, true); // FNB doc contoh tak punya w_bni
});

test("buildFishingSharedLinks: Uang NF + PayLater + 4 bank (bukan Kas Besar)", () => {
  const links = buildFishingSharedLinks({ enabled: true });
  assert.equal(links.length, 6);
  assert.ok(links.some((l) => l.linkKind === "ops_share" && l.sourceWalletId === "w1782220389555"));
  assert.ok(links.some((l) => l.linkKind === "ops_share" && l.sourceWalletId === "w_shopee_paylater"));
  assert.ok(!links.some((l) => l.sourceWalletId === "w_kas_besar"));
});

test("sourceBusinessIdsForLinks unik & hanya yang aktif", () => {
  const links = buildFishingSharedLinks({ enabled: true });
  assert.deepEqual(sourceBusinessIdsForLinks(links), [CANONICAL_BUSINESS_ID]);
  assert.deepEqual(sourceBusinessIdsForLinks(buildFishingSharedLinks({ enabled: false })), []);
});

test("applyMirrorBalances menempel opening ke dompet shared saja", () => {
  const links = buildFishingSharedLinks({ enabled: true });
  const map = mirrorBalancesForLinks(links, { [CANONICAL_BUSINESS_ID]: fnbDoc });
  const wallets = [
    { id: "w_fish_marketplace", type: "ewallet", opening: 0 },
    { id: sharedWalletId(links[0]), type: "shared", opening: 0 },
  ];
  const applied = applyMirrorBalances(wallets, map);
  assert.equal(applied[0].opening, 0); // dompet biasa tak berubah
  assert.equal(applied[1].opening, map[sharedWalletId(links[0])].balance);
});

test("applyMirrorBalances: balance null (purchasing hidden) tidak menimpa opening jadi 0/null", () => {
  const wallets = [
    { id: "shared_sh_nf_bca", type: "shared", opening: 12514864 },
  ];
  const applied = applyMirrorBalances(wallets, {
    shared_sh_nf_bca: {
      linkId: "sh_nf_bca",
      balance: null,
      hidden: true,
      missing: false,
    },
  });
  assert.equal(applied[0].opening, 12514864);
  assert.equal(applied[0].mirror.hidden, true);
});
