// lib/tiktokGoSettlement.js — pencatatan penjualan tertahan & settlement TikTok Go

import { resolveTransferIds, resolveWalletId } from "./transactionNormalize.js";

export const TIKTOK_GO_WALLET_ID = "w_tiktok_go";
export const TIKTOK_GO_DESTINATION_WALLET_ID = "w_mandiri";
export const TIKTOK_GO_CHANNEL_ID = "tiktok_go";
export const TIKTOK_GO_SALE_CATEGORY_ID = "ci_tiktok_go";
export const TIKTOK_GO_FEE_CATEGORY_ID = "co_tiktok_go";
export const TIKTOK_GO_DEFAULT_SETTLEMENT_DAYS = 7;

export const DEFAULT_TIKTOK_GO_WALLET = {
  id: TIKTOK_GO_WALLET_ID,
  name: "TikTok Go",
  type: "digital",
  outlet: null,
  color: "#111827",
  opening: 0,
  floor: 0,
  active: true,
  sort: 53,
};

export const DEFAULT_TIKTOK_GO_CHANNEL = {
  id: TIKTOK_GO_CHANNEL_ID,
  label: "TikTok Go",
  icon: "🎵",
  role: "channel",
  settleWallet: TIKTOK_GO_WALLET_ID,
  group: "Online",
  order: 13,
  active: true,
  categoryHint: "tiktok go",
  deferredSettlement: true,
  recognitionDate: "transaction",
  estimatedSettlementDays: TIKTOK_GO_DEFAULT_SETTLEMENT_DAYS,
  defaultDestinationWalletId: TIKTOK_GO_DESTINATION_WALLET_ID,
};

// Dipertahankan untuk kompatibilitas data lama. UI settlement baru cukup input total potongan.
export const TIKTOK_GO_FEE_TYPES = [
  { id: "service", label: "Layanan / platform" },
  { id: "affiliate", label: "Komisi creator / affiliate" },
  { id: "refund", label: "Refund" },
  { id: "promo", label: "Subsidi / promo merchant" },
  { id: "other", label: "Potongan lainnya" },
];

function isoDate(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function moneyInt(value, label, { required = true } = {}) {
  const text = value === null || value === undefined ? "" : String(value).trim();
  if (!text) {
    if (required) throw new Error(`${label} wajib diisi.`);
    return null;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} tidak valid.`);
  return Math.round(parsed);
}

export function addDaysISO(value, days) {
  const date = isoDate(value);
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + Math.round(Number(days) || 0));
  return parsed.toISOString().slice(0, 10);
}

export function isTikTokGoChannel(channel) {
  return channel?.id === TIKTOK_GO_CHANNEL_ID || channel?.settleWallet === TIKTOK_GO_WALLET_ID;
}

export function isTikTokGoSale(transaction) {
  return transaction?.meta?.tiktokGoKind === "sale"
    || transaction?.transactionKind === "tiktok_go_sale";
}

export function isTikTokGoFee(transaction) {
  return transaction?.meta?.tiktokGoKind === "fee"
    || transaction?.transactionKind === "tiktok_go_fee";
}

export function isTikTokGoSettlement(transaction) {
  return transaction?.type === "transfer" && (
    transaction?.meta?.tiktokGoKind === "settlement"
    || transaction?.transactionKind === "tiktok_go_settlement"
  );
}

export function createTikTokGoSaleTransaction({ report, channel, amount, categoryId, settlementKey }) {
  const gross = Math.round(Math.max(0, Number(amount) || 0));
  if (!report?.id || !gross) throw new Error("Data penjualan TikTok Go tidak valid.");
  const transactionDate = isoDate(report.date);
  if (!transactionDate) throw new Error("Tanggal penjualan TikTok Go tidak valid.");
  const estimatedDays = Math.max(0, Number(channel?.estimatedSettlementDays) || TIKTOK_GO_DEFAULT_SETTLEMENT_DAYS);
  const id = `t_${report.id}_settle_${TIKTOK_GO_CHANNEL_ID}`;
  const key = settlementKey || report.submissionId || report.idempotencyKey || report.id;
  return {
    id,
    type: "in",
    amount: gross,
    categoryId: categoryId || TIKTOK_GO_SALE_CATEGORY_ID,
    walletId: TIKTOK_GO_WALLET_ID,
    desc: `Penjualan TikTok Go ${report.outlet || ""} · ${transactionDate}`.trim(),
    date: transactionDate,
    source: "Penjualan TikTok Go",
    dailyReportId: report.id,
    reportChannelId: channel?.id || TIKTOK_GO_CHANNEL_ID,
    transactionKind: "tiktok_go_sale",
    idempotencyKey: `${key}|settle|${TIKTOK_GO_CHANNEL_ID}`,
    meta: {
      tiktokGoKind: "sale",
      settlementStatus: "pending",
      transactionDate,
      estimatedSettlementDate: addDaysISO(transactionDate, estimatedDays),
      actualSettlementDate: null,
      destinationWalletId: channel?.defaultDestinationWalletId || TIKTOK_GO_DESTINATION_WALLET_ID,
      destinationLabel: "Rudi Mandiri",
      grossAmount: gross,
      feeTotal: 0,
      netSettlementAmount: gross,
      actualBankAmount: null,
      reconciliationStatus: "pending",
      outlet: report.outlet || null,
    },
  };
}

function feeSaleId(transaction) {
  return transaction?.meta?.tiktokGoSaleTransactionId || null;
}

export function getTikTokGoSaleRows(transactions = [], wallets = []) {
  const list = Array.isArray(transactions) ? transactions : [];
  const walletNames = new Map((wallets || []).map((wallet) => [wallet.id, wallet.name]));
  const feesBySale = new Map();
  const settlementsBySale = new Map();

  list.forEach((transaction) => {
    const saleId = feeSaleId(transaction);
    if (!saleId) return;
    if (isTikTokGoFee(transaction)) {
      const rows = feesBySale.get(saleId) || [];
      rows.push(transaction);
      feesBySale.set(saleId, rows);
    } else if (isTikTokGoSettlement(transaction)) {
      const previous = settlementsBySale.get(saleId);
      if (!previous || String(transaction.date || "") > String(previous.date || "")) {
        settlementsBySale.set(saleId, transaction);
      }
    }
  });

  return list
    .filter(isTikTokGoSale)
    .map((sale) => {
      const feeTransactions = feesBySale.get(sale.id) || [];
      const settlement = settlementsBySale.get(sale.id) || null;
      const grossAmount = Math.round(Math.max(0, Number(sale.amount) || 0));
      const feeTotal = feeTransactions.reduce((sum, row) => sum + Math.max(0, Number(row.amount) || 0), 0);
      const netSettlementAmount = Math.max(0, grossAmount - feeTotal);
      const settledByMeta = sale.meta?.settlementStatus === "settled";
      const status = settlement || settledByMeta ? "settled" : "pending";
      const actualBankAmount = settlement
        ? Math.max(0, Number(settlement.amount) || 0)
        : (settledByMeta ? Math.max(0, Number(sale.meta?.actualBankAmount) || 0) : null);
      const destinationWalletId = settlement
        ? resolveTransferIds(settlement).to
        : (sale.meta?.destinationWalletId || TIKTOK_GO_DESTINATION_WALLET_ID);
      return {
        id: sale.id,
        sale,
        feeTransactions,
        settlement,
        status,
        grossAmount,
        feeTotal,
        netSettlementAmount,
        actualBankAmount,
        reconciliationStatus: sale.meta?.reconciliationStatus || (status === "settled" ? "matched" : "pending"),
        transactionDate: sale.meta?.transactionDate || sale.date,
        estimatedSettlementDate: sale.meta?.estimatedSettlementDate
          || addDaysISO(sale.date, TIKTOK_GO_DEFAULT_SETTLEMENT_DAYS),
        actualSettlementDate: settlement?.date || sale.meta?.actualSettlementDate || null,
        destinationWalletId,
        destinationLabel: destinationWalletId === TIKTOK_GO_DESTINATION_WALLET_ID
          ? "Rudi Mandiri"
          : (walletNames.get(destinationWalletId) || sale.meta?.destinationLabel || "—"),
      };
    })
    .sort((a, b) => String(b.transactionDate || "").localeCompare(String(a.transactionDate || "")));
}

function tiktokWalletBalance(transactions = [], wallets = []) {
  const wallet = (wallets || []).find((row) => row.id === TIKTOK_GO_WALLET_ID);
  return (Number(wallet?.opening) || 0) + (transactions || []).reduce((sum, transaction) => {
    if (transaction?.type === "transfer") {
      const { from, to } = resolveTransferIds(transaction);
      if (from === TIKTOK_GO_WALLET_ID) return sum - (Number(transaction.amount) || 0);
      if (to === TIKTOK_GO_WALLET_ID) return sum + (Number(transaction.amount) || 0);
      return sum;
    }
    if (resolveWalletId(transaction) !== TIKTOK_GO_WALLET_ID) return sum;
    return sum + (transaction.type === "in" ? 1 : -1) * (Number(transaction.amount) || 0);
  }, 0);
}

export function computeTikTokGoSummary({ transactions = [], wallets = [] } = {}) {
  const rows = getTikTokGoSaleRows(transactions, wallets);
  return {
    rows,
    totalSales: rows.reduce((sum, row) => sum + row.grossAmount, 0),
    heldBalance: tiktokWalletBalance(transactions, wallets),
    totalSettled: rows.reduce((sum, row) => sum + (row.status === "settled" ? Number(row.actualBankAmount) || 0 : 0), 0),
    pendingSettlement: rows.reduce((sum, row) => sum + (row.status === "pending" ? row.netSettlementAmount : 0), 0),
    totalFees: rows.reduce((sum, row) => sum + row.feeTotal, 0),
    pendingCount: rows.filter((row) => row.status === "pending").length,
  };
}

function legacyFeeTotal(fees = {}) {
  return TIKTOK_GO_FEE_TYPES.reduce(
    (sum, { id }) => sum + Math.round(Math.max(0, Number(fees?.[id]) || 0)),
    0
  );
}

export function buildTikTokGoSettlementMutation({
  transactions = [],
  saleTransactionId,
  actualSettlementDate,
  destinationWalletId = TIKTOK_GO_DESTINATION_WALLET_ID,
  evidenceRef,
  totalDeduction,
  reportedNetAmount,
  actualBankAmount,
  fees,
  user,
  today,
} = {}) {
  if (!new Set(["owner", "admin"]).has(user?.role)) {
    throw new Error("Hanya owner atau admin yang dapat mengonfirmasi settlement TikTok Go.");
  }
  const sale = (transactions || []).find((row) => row.id === saleTransactionId && isTikTokGoSale(row));
  if (!sale) throw new Error("Penjualan TikTok Go tidak ditemukan.");

  const existing = (transactions || []).find(
    (row) => isTikTokGoSettlement(row) && feeSaleId(row) === sale.id
  );
  if (existing || sale.meta?.settlementStatus === "settled") {
    return { updatedSale: sale, transactions: [], idempotent: true };
  }

  const actualDate = isoDate(actualSettlementDate);
  if (!actualDate) throw new Error("Tanggal settlement aktual wajib diisi.");
  if (actualDate < isoDate(sale.date)) {
    throw new Error("Tanggal settlement aktual tidak boleh sebelum tanggal penjualan.");
  }
  const currentDate = isoDate(today) || new Date().toISOString().slice(0, 10);
  if (actualDate > currentDate) throw new Error("Tanggal settlement aktual tidak boleh di masa depan.");
  const proof = String(evidenceRef || "").trim();
  if (!proof) throw new Error("Bukti laporan payout / nomor mutasi wajib diisi.");

  const grossAmount = Math.round(Math.max(0, Number(sale.amount) || 0));
  const feeTotal = totalDeduction === undefined || totalDeduction === null
    ? legacyFeeTotal(fees)
    : moneyInt(totalDeduction, "Total potongan TikTok Go");
  if (feeTotal > grossAmount) {
    throw new Error("Total potongan tidak boleh lebih besar dari penjualan bruto.");
  }

  const expectedNetAmount = grossAmount - feeTotal;
  const reportedNet = reportedNetAmount === undefined || reportedNetAmount === null
    ? expectedNetAmount
    : moneyInt(reportedNetAmount, "Net menurut laporan TikTok");
  if (reportedNet !== expectedNetAmount) {
    throw new Error(`Net laporan TikTok tidak cocok. Bruto dikurangi potongan seharusnya Rp ${expectedNetAmount.toLocaleString("id-ID")}.`);
  }

  const bankAmount = actualBankAmount === undefined || actualBankAmount === null
    ? reportedNet
    : moneyInt(actualBankAmount, "Dana aktual masuk bank");
  if (bankAmount !== reportedNet) {
    const diff = Math.abs(bankAmount - reportedNet);
    throw new Error(`Dana masuk bank belum cocok dengan net TikTok. Selisih Rp ${diff.toLocaleString("id-ID")}.`);
  }

  const destination = String(destinationWalletId || "").trim();
  if (bankAmount > 0 && !destination) throw new Error("Rekening tujuan settlement wajib dipilih.");

  const actionId = `tiktok_go_settlement_${sale.id}`;
  const feeTransactions = feeTotal > 0 ? [{
    id: `t_${sale.id}_fee_total`,
    type: "out",
    amount: feeTotal,
    categoryId: TIKTOK_GO_FEE_CATEGORY_ID,
    walletId: TIKTOK_GO_WALLET_ID,
    desc: `Total potongan TikTok Go · ${sale.meta?.outlet || sale.date || ""}`.trim(),
    date: actualDate,
    source: "Potongan TikTok Go",
    transactionKind: "tiktok_go_fee",
    idempotencyKey: `${actionId}|fee|total`,
    meta: {
      tiktokGoKind: "fee",
      tiktokGoFeeType: "total",
      tiktokGoSaleTransactionId: sale.id,
      grossAmount,
      reportedNetAmount: reportedNet,
      createdById: user?.id || null,
      createdByName: user?.name || null,
    },
  }] : [];

  const settlement = bankAmount > 0 ? {
    id: `t_${sale.id}_settlement`,
    type: "transfer",
    amount: bankAmount,
    fromWalletId: TIKTOK_GO_WALLET_ID,
    toWalletId: destination,
    desc: `Settlement TikTok Go · penjualan ${sale.date}`,
    date: actualDate,
    source: "Settlement TikTok Go",
    transactionKind: "tiktok_go_settlement",
    idempotencyKey: `${actionId}|transfer`,
    meta: {
      tiktokGoKind: "settlement",
      tiktokGoSaleTransactionId: sale.id,
      transferActionId: actionId,
      actualSettlementDate: actualDate,
      evidenceRef: proof,
      destinationWalletId: destination,
      grossAmount,
      feeTotal,
      reportedNetAmount: reportedNet,
      actualBankAmount: bankAmount,
      reconciliationStatus: "matched",
      createdById: user?.id || null,
      createdByName: user?.name || null,
    },
  } : null;

  return {
    updatedSale: {
      ...sale,
      meta: {
        ...(sale.meta || {}),
        settlementStatus: "settled",
        actualSettlementDate: actualDate,
        destinationWalletId: destination || sale.meta?.destinationWalletId || TIKTOK_GO_DESTINATION_WALLET_ID,
        destinationLabel: (destination || sale.meta?.destinationWalletId) === TIKTOK_GO_DESTINATION_WALLET_ID ? "Rudi Mandiri" : null,
        evidenceRef: proof,
        feeBreakdown: { total: feeTotal },
        feeTotal,
        reportedNetAmount: reportedNet,
        netSettlementAmount: reportedNet,
        actualBankAmount: bankAmount,
        reconciliationStatus: "matched",
        settlementTransactionId: settlement?.id || null,
        fullRefund: reportedNet === 0,
      },
    },
    transactions: [...feeTransactions, ...(settlement ? [settlement] : [])],
    idempotent: false,
  };
}

export function applyTikTokGoSettlementMutation(doc, mutation) {
  if (!doc || !mutation?.updatedSale?.id) return doc;
  if (!Array.isArray(doc.transactions)) doc.transactions = [];
  if (!Array.isArray(doc.deletedTransactionIds)) doc.deletedTransactionIds = [];
  const rows = [mutation.updatedSale, ...(mutation.transactions || [])];
  rows.forEach((row) => {
    const index = doc.transactions.findIndex((existing) => existing?.id === row.id);
    if (index >= 0) doc.transactions[index] = { ...doc.transactions[index], ...row };
    else doc.transactions.push(row);
    doc.deletedTransactionIds = doc.deletedTransactionIds.filter((id) => id !== row.id);
  });
  return doc;
}
