import test from "node:test";
import assert from "node:assert/strict";
import { settleDailyReport } from "./kasirHarian.js";
import {
  TIKTOK_GO_FEE_CATEGORY_ID,
  TIKTOK_GO_SALE_CATEGORY_ID,
  TIKTOK_GO_WALLET_ID,
  addDaysISO,
  applyTikTokGoSettlementMutation,
  buildTikTokGoSettlementMutation,
  computeTikTokGoSummary,
  isTikTokGoFee,
  isTikTokGoSale,
  isTikTokGoSettlement,
} from "./tiktokGoSettlement.js";

const owner = { id: "u1", name: "Sam", role: "owner" };

function baseWallets() {
  return [
    { id: TIKTOK_GO_WALLET_ID, name: "TikTok Go", type: "digital", opening: 0, active: true },
    { id: "w_mandiri", name: "Mandiri", type: "rekening", opening: 0, active: true },
  ];
}

function pendingSale(amount = 1_000_000) {
  return {
    id: "t_dr_1_settle_tiktok_go",
    type: "in",
    amount,
    categoryId: TIKTOK_GO_SALE_CATEGORY_ID,
    walletId: TIKTOK_GO_WALLET_ID,
    desc: "Penjualan TikTok Go KBU · 2026-09-01",
    date: "2026-09-01",
    source: "Penjualan TikTok Go",
    transactionKind: "tiktok_go_sale",
    meta: {
      tiktokGoKind: "sale",
      settlementStatus: "pending",
      transactionDate: "2026-09-01",
      estimatedSettlementDate: "2026-09-08",
      actualSettlementDate: null,
      destinationWalletId: "w_mandiri",
      destinationLabel: "Rudi Mandiri",
      grossAmount: amount,
      feeTotal: 0,
      netSettlementAmount: amount,
      outlet: "KBU",
    },
  };
}

test("estimasi settlement TikTok Go adalah tujuh hari setelah transaksi", () => {
  assert.equal(addDaysISO("2026-09-01", 7), "2026-09-08");
});

test("settle laporan harian mengakui penjualan pada tanggal transaksi ke Dompet TikTok Go", () => {
  const report = {
    id: "dr_1",
    date: "2026-09-01",
    outlet: "KBU",
    status: "admin_verified",
    total: 1_000_000,
    channels: { tiktok_go: 1_000_000 },
    channelDefs: [{
      id: "tiktok_go",
      label: "TikTok Go",
      role: "channel",
      settleWallet: TIKTOK_GO_WALLET_ID,
      categoryHint: "tiktok go",
      deferredSettlement: true,
      estimatedSettlementDays: 7,
      defaultDestinationWalletId: "w_mandiri",
    }],
  };
  const state = {
    dailyReports: [report],
    transactions: [],
    wallets: baseWallets(),
    categories: [
      { id: TIKTOK_GO_SALE_CATEGORY_ID, name: "Penjualan TikTok Go", type: "in", active: true },
    ],
  };

  const result = settleDailyReport(state, report.id, owner);
  assert.equal(result.txs.length, 1);
  const sale = result.txs[0];
  assert.equal(isTikTokGoSale(sale), true);
  assert.equal(sale.date, "2026-09-01");
  assert.equal(sale.walletId, TIKTOK_GO_WALLET_ID);
  assert.equal(sale.amount, 1_000_000);
  assert.equal(sale.meta.estimatedSettlementDate, "2026-09-08");
  assert.equal(sale.meta.settlementStatus, "pending");
  assert.ok(!result.txs.some((row) => row.walletId === "w_mandiri"));
});

test("admin mencocokkan bruto, potongan, net TikTok, dan aktual bank sebelum settlement", () => {
  const sale = pendingSale();
  const mutation = buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "Payout TikTok 8 Sep / Mutasi Mandiri",
    totalDeduction: 120_000,
    reportedNetAmount: 880_000,
    actualBankAmount: 880_000,
    user: owner,
    today: "2026-09-08",
  });

  const feeRows = mutation.transactions.filter(isTikTokGoFee);
  const transfer = mutation.transactions.find(isTikTokGoSettlement);
  assert.equal(feeRows.length, 1);
  assert.equal(feeRows[0].amount, 120_000);
  assert.equal(feeRows[0].type, "out");
  assert.equal(feeRows[0].categoryId, TIKTOK_GO_FEE_CATEGORY_ID);
  assert.equal(transfer.type, "transfer");
  assert.equal(transfer.amount, 880_000);
  assert.equal(transfer.fromWalletId, TIKTOK_GO_WALLET_ID);
  assert.equal(transfer.toWalletId, "w_mandiri");
  assert.equal(transfer.date, "2026-09-08");
  assert.equal(transfer.meta.reconciliationStatus, "matched");
  assert.equal(mutation.transactions.filter((row) => row.type === "in").length, 0);

  const doc = { transactions: [sale], wallets: baseWallets(), deletedTransactionIds: [] };
  applyTikTokGoSettlementMutation(doc, mutation);
  const summary = computeTikTokGoSummary({ transactions: doc.transactions, wallets: doc.wallets });
  assert.equal(summary.totalSales, 1_000_000);
  assert.equal(summary.totalFees, 120_000);
  assert.equal(summary.totalSettled, 880_000);
  assert.equal(summary.pendingSettlement, 0);
  assert.equal(summary.heldBalance, 0);
  assert.equal(summary.rows[0].actualBankAmount, 880_000);
  assert.equal(summary.rows[0].actualSettlementDate, "2026-09-08");
  assert.equal(summary.rows[0].destinationLabel, "Rudi Mandiri");
});

test("settlement ditolak jika net laporan TikTok tidak sama dengan bruto dikurangi potongan", () => {
  const sale = pendingSale();
  assert.throws(() => buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "Payout TikTok",
    totalDeduction: 120_000,
    reportedNetAmount: 879_000,
    actualBankAmount: 879_000,
    user: owner,
    today: "2026-09-08",
  }), /net laporan TikTok tidak cocok/i);
});

test("settlement ditolak jika dana aktual bank berbeda dengan net TikTok", () => {
  const sale = pendingSale();
  assert.throws(() => buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "Payout TikTok",
    totalDeduction: 120_000,
    reportedNetAmount: 880_000,
    actualBankAmount: 877_500,
    user: owner,
    today: "2026-09-08",
  }), /selisih Rp 2\.500/i);
});

test("full refund boleh selesai dengan net Rp0 tanpa transfer bank palsu", () => {
  const sale = pendingSale(100_000);
  const mutation = buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "Laporan TikTok full refund",
    totalDeduction: 100_000,
    reportedNetAmount: 0,
    actualBankAmount: 0,
    user: owner,
    today: "2026-09-08",
  });

  assert.equal(mutation.updatedSale.meta.fullRefund, true);
  assert.equal(mutation.updatedSale.meta.settlementStatus, "settled");
  assert.equal(mutation.transactions.filter(isTikTokGoFee).length, 1);
  assert.equal(mutation.transactions.filter(isTikTokGoSettlement).length, 0);

  const doc = { transactions: [sale], wallets: baseWallets(), deletedTransactionIds: [] };
  applyTikTokGoSettlementMutation(doc, mutation);
  const summary = computeTikTokGoSummary({ transactions: doc.transactions, wallets: doc.wallets });
  assert.equal(summary.totalSales, 100_000);
  assert.equal(summary.totalFees, 100_000);
  assert.equal(summary.totalSettled, 0);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.pendingSettlement, 0);
  assert.equal(summary.heldBalance, 0);
  assert.equal(summary.rows[0].status, "settled");
});

test("status tetap pending jika belum ada bukti laporan payout / mutasi", () => {
  const sale = pendingSale();
  assert.throws(() => buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "",
    totalDeduction: 120_000,
    reportedNetAmount: 880_000,
    actualBankAmount: 880_000,
    user: owner,
    today: "2026-09-08",
  }), /bukti laporan payout/i);

  const summary = computeTikTokGoSummary({ transactions: [sale], wallets: baseWallets() });
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.pendingSettlement, 1_000_000);
  assert.equal(summary.heldBalance, 1_000_000);
  assert.equal(summary.totalSettled, 0);
});

test("settlement ditolak untuk role non-admin dan tanggal sebelum penjualan", () => {
  const sale = pendingSale();
  assert.throws(() => buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "Payout",
    totalDeduction: 120_000,
    reportedNetAmount: 880_000,
    actualBankAmount: 880_000,
    user: { id: "kasir", role: "kasir" },
    today: "2026-09-08",
  }), /owner atau admin/i);
  assert.throws(() => buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-08-31",
    evidenceRef: "Payout",
    totalDeduction: 120_000,
    reportedNetAmount: 880_000,
    actualBankAmount: 880_000,
    user: owner,
    today: "2026-09-08",
  }), /sebelum tanggal penjualan/i);
});

test("retry settlement yang sudah tercatat bersifat idempoten", () => {
  const sale = pendingSale();
  const first = buildTikTokGoSettlementMutation({
    transactions: [sale],
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "Payout TikTok 8 Sep",
    totalDeduction: 120_000,
    reportedNetAmount: 880_000,
    actualBankAmount: 880_000,
    user: owner,
    today: "2026-09-08",
  });
  const doc = { transactions: [sale], deletedTransactionIds: [] };
  applyTikTokGoSettlementMutation(doc, first);
  const retry = buildTikTokGoSettlementMutation({
    transactions: doc.transactions,
    saleTransactionId: sale.id,
    actualSettlementDate: "2026-09-08",
    evidenceRef: "Payout TikTok 8 Sep",
    totalDeduction: 120_000,
    reportedNetAmount: 880_000,
    actualBankAmount: 880_000,
    user: owner,
    today: "2026-09-08",
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.transactions.length, 0);
});
