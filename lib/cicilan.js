// lib/cicilan.js — rencana cicilan PayLater (jadwal, pembayaran, ringkasan).
// Semua fungsi murni. Rencana disimpan di app_state bisnis pemilik dompet PayLater
// (Nusa Food) di key `cicilanPlans`; Fishing membaca/menulis lewat /api/cicilan.
//
// Pencatatan:
//  - Belanja: pengeluaran sebesar pokok dari dompet PayLater (hutang bertambah).
//  - bungaMode "per_bayar" (default): tiap bayar = transfer porsi pokok rekening → PayLater
//    + pengeluaran porsi bunga dari rekening. Hutang PayLater = sisa pokok.
//  - bungaMode "di_awal": total bunga dicatat sekali sebagai pengeluaran PayLater saat rencana
//    dibuat (hutang = total yang harus dibayar); tiap bayar = transfer penuh rekening → PayLater.
//  - Bayar lebih dari jadwal (denda/biaya telat) → selisihnya pengeluaran dari rekening.

export const CICILAN_STATUS = { BERJALAN: "berjalan", LUNAS: "lunas", BATAL: "batal" };
export const BUNGA_MODES = ["per_bayar", "di_awal"];

const toInt = (v) => Math.round(Number(v) || 0);

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM" + n bulan → "YYYY-MM". */
export function addMonths(ym, n) {
  const [y, m] = String(ym).split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

/** Tanggal jatuh tempo di bulan "YYYY-MM"; hari dipotong ke akhir bulan (mis. 31 → 30/28). */
export function dueDateFor(ym, dueDay) {
  const [y, m] = String(ym).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Math.max(toInt(dueDay) || 1, 1), last);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Bandingkan opsi tenor dari layar PayLater.
 * Bunga flat/bulan = (total − pokok) / pokok / tenor.
 */
export function analyzeTenorOptions(pokok, options = []) {
  const p = toInt(pokok);
  const rows = (options || [])
    .map((o) => {
      const tenor = toInt(o?.tenor);
      const perBulan = toInt(o?.perBulan);
      if (!(tenor > 0) || !(perBulan > 0)) return null;
      const total = perBulan * tenor;
      // Selisih ≤ tenor rupiah = pembulatan, bukan bunga (mis. 3 × 4.247.027 vs 12.741.080).
      const rawBunga = total - p;
      const bunga = rawBunga > tenor ? rawBunga : 0;
      return {
        tenor,
        perBulan,
        total,
        bunga,
        bungaPct: p > 0 ? bunga / p : 0,
        flatPerBulanPct: p > 0 ? bunga / p / tenor : 0,
        tanpaBunga: bunga === 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.tenor - b.tenor);
  const tanpaBunga = rows.filter((r) => r.tanpaBunga);
  const rekomendasi = tanpaBunga.length ? tanpaBunga[tanpaBunga.length - 1].tenor : (rows[0]?.tenor ?? null);
  return { pokok: p, rows, rekomendasi };
}

/**
 * Jadwal cicilan. Porsi bunga dibagi rata (sisa ke cicilan terakhir), porsi pokok = sisanya,
 * sehingga Σ pokok = pokok persis dan bunga tidak pernah negatif.
 */
export function buildJadwal({ pokok, tenor, perBulan, startMonth, dueDay }) {
  const p = toInt(pokok);
  const n = toInt(tenor);
  const per = toInt(perBulan);
  if (!(p > 0)) throw new Error("Pokok harus lebih dari 0.");
  if (!(n > 0) || n > 60) throw new Error("Tenor harus 1–60 bulan.");
  if (!(per > 0)) throw new Error("Nominal per bulan harus lebih dari 0.");
  if (!/^\d{4}-\d{2}$/.test(String(startMonth || ""))) throw new Error("Bulan cicilan pertama tidak valid.");

  const amounts = Array.from({ length: n }, () => per);
  const total0 = per * n;
  if (total0 < p) {
    // Toleransi pembulatan: kurang ≤ tenor rupiah → tambahkan ke cicilan terakhir.
    if (p - total0 > n) throw new Error("Total cicilan lebih kecil dari pokok. Cek nominal per bulan.");
    amounts[n - 1] += p - total0;
  }
  const total = amounts.reduce((a, b) => a + b, 0);
  const totalBunga = total - p;
  const bungaBase = Math.floor(totalBunga / n);
  return amounts.map((amount, i) => {
    const bunga = i === n - 1 ? totalBunga - bungaBase * (n - 1) : bungaBase;
    const ym = addMonths(startMonth, i);
    return {
      ke: i + 1,
      due: dueDateFor(ym, dueDay),
      amount,
      pokok: amount - bunga,
      bunga,
      paid: false,
      paidAt: null,
      paidAmount: 0,
      paidFromWalletId: null,
      txIds: [],
    };
  });
}

/** Buat rencana cicilan baru (tervalidasi). */
export function createPlan(input, { id, now = new Date().toISOString(), user = null, fromBusinessId = null } = {}) {
  const bungaMode = BUNGA_MODES.includes(input?.bungaMode) ? input.bungaMode : "per_bayar";
  const label = String(input?.label || "").trim().slice(0, 120);
  if (!label) throw new Error("Nama barang/keterangan wajib diisi.");
  if (!input?.walletId) throw new Error("Dompet PayLater tidak ditemukan.");
  const dueDay = toInt(input?.dueDay);
  if (!(dueDay >= 1 && dueDay <= 31)) throw new Error("Tanggal jatuh tempo harus 1–31.");
  const jadwal = buildJadwal({
    pokok: input.pokok,
    tenor: input.tenor,
    perBulan: input.perBulan,
    startMonth: input.startMonth,
    dueDay,
  });
  const pokok = toInt(input.pokok);
  const totalBayar = jadwal.reduce((a, r) => a + r.amount, 0);
  const totalBunga = totalBayar - pokok;
  return {
    id: id || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label,
    walletId: input.walletId,
    purchaseTxId: input.purchaseTxId || null,
    purchaseDate: input.purchaseDate || now.slice(0, 10),
    pokok,
    tenor: jadwal.length,
    perBulan: toInt(input.perBulan),
    totalBayar,
    totalBunga,
    flatPerBulanPct: pokok > 0 ? totalBunga / pokok / jadwal.length : 0,
    bungaMode,
    bungaCategoryId: input.bungaCategoryId || null,
    dueDay,
    startMonth: input.startMonth,
    jadwal,
    status: CICILAN_STATUS.BERJALAN,
    note: String(input?.note || "").slice(0, 300),
    fromBusinessId: fromBusinessId || null,
    createdAt: now,
    updatedAt: now,
    createdById: user?.id || null,
    createdByName: user?.name || null,
  };
}

/** Id transaksi deterministik → idempoten saat retry. */
export function cicilanTxId(planId, suffix) {
  return `tcl_${planId}_${suffix}`;
}

function txMeta(plan, extra, user) {
  return {
    cicilanPlanId: plan.id,
    fromBusinessId: plan.fromBusinessId || null,
    createdById: user?.id || null,
    createdByName: user?.name || null,
    createdByRole: user?.role || null,
    ...extra,
  };
}

/** Transaksi belanja (pengeluaran dari PayLater) bila belum dicatat sebelumnya. */
export function buildPurchaseTx(plan, { categoryId = null, user = null } = {}) {
  return {
    id: cicilanTxId(plan.id, "beli"),
    type: "out",
    amount: plan.pokok,
    walletId: plan.walletId,
    categoryId,
    desc: `${plan.label} (cicilan ${plan.tenor} bln)`,
    date: plan.purchaseDate,
    source: "Cicilan PayLater",
    meta: txMeta(plan, { cicilanRole: "beli" }, user),
  };
}

/** Mode di_awal: seluruh bunga dicatat sekali sebagai pengeluaran PayLater. */
export function buildUpfrontInterestTx(plan, { user = null } = {}) {
  if (plan.bungaMode !== "di_awal" || !(plan.totalBunga > 0)) return null;
  return {
    id: cicilanTxId(plan.id, "bunga"),
    type: "out",
    amount: plan.totalBunga,
    walletId: plan.walletId,
    categoryId: plan.bungaCategoryId || null,
    desc: `Bunga cicilan ${plan.label} (${plan.tenor} bln)`,
    date: plan.purchaseDate,
    source: "Cicilan PayLater",
    meta: txMeta(plan, { cicilanRole: "bunga_awal" }, user),
  };
}

/**
 * Bayar cicilan ke-`ke`. Kembalikan transaksi baru + rencana yang diperbarui.
 * Wajib berurutan (cicilan sebelumnya harus lunas) dan tidak boleh kurang dari jadwal.
 */
export function applyPayment(plan, { ke, fromWalletId, amount, date, user = null, now = new Date().toISOString() }) {
  if (!plan || plan.status !== CICILAN_STATUS.BERJALAN) throw new Error("Cicilan ini tidak sedang berjalan.");
  if (!fromWalletId) throw new Error("Pilih rekening untuk membayar.");
  if (fromWalletId === plan.walletId) throw new Error("Rekening pembayar tidak boleh dompet PayLater itu sendiri.");
  const row = (plan.jadwal || []).find((r) => r.ke === toInt(ke));
  if (!row) throw new Error("Cicilan tidak ditemukan.");
  if (row.paid) throw new Error(`Cicilan ke-${row.ke} sudah dibayar.`);
  const pending = plan.jadwal.find((r) => !r.paid);
  if (pending && pending.ke !== row.ke) throw new Error(`Bayar cicilan ke-${pending.ke} dulu.`);
  const paidAmount = amount == null || amount === "" ? row.amount : toInt(amount);
  if (paidAmount < row.amount) throw new Error("Nominal bayar kurang dari tagihan. Pembayaran sebagian belum didukung.");
  const extra = paidAmount - row.amount;
  const payDate = date || now.slice(0, 10);
  const tag = `${plan.label} ${row.ke}/${plan.tenor}`;

  const txs = [];
  const transferAmount = plan.bungaMode === "di_awal" ? row.amount : row.pokok;
  const expenseAmount = (plan.bungaMode === "di_awal" ? 0 : row.bunga) + extra;
  if (transferAmount > 0) {
    txs.push({
      id: cicilanTxId(plan.id, `k${row.ke}_pokok`),
      type: "transfer",
      amount: transferAmount,
      fromWalletId,
      toWalletId: plan.walletId,
      desc: `Bayar cicilan PayLater ${tag}`,
      date: payDate,
      source: "Cicilan PayLater",
      meta: txMeta(plan, { cicilanRole: "bayar_pokok", cicilanKe: row.ke, transferRef: cicilanTxId(plan.id, `k${row.ke}`) }, user),
    });
  }
  if (expenseAmount > 0) {
    const parts = [];
    if (plan.bungaMode !== "di_awal" && row.bunga > 0) parts.push("bunga");
    if (extra > 0) parts.push("denda/biaya");
    txs.push({
      id: cicilanTxId(plan.id, `k${row.ke}_bunga`),
      type: "out",
      amount: expenseAmount,
      walletId: fromWalletId,
      categoryId: plan.bungaCategoryId || null,
      desc: `${parts.join(" + ")} cicilan PayLater ${tag}`.replace(/^./, (c) => c.toUpperCase()),
      date: payDate,
      source: "Cicilan PayLater",
      meta: txMeta(plan, { cicilanRole: "bayar_bunga", cicilanKe: row.ke }, user),
    });
  }

  const jadwal = plan.jadwal.map((r) =>
    r.ke === row.ke
      ? { ...r, paid: true, paidAt: payDate, paidAmount, paidFromWalletId: fromWalletId, txIds: txs.map((t) => t.id) }
      : r
  );
  const allPaid = jadwal.every((r) => r.paid);
  return {
    txs,
    plan: { ...plan, jadwal, status: allPaid ? CICILAN_STATUS.LUNAS : plan.status, updatedAt: now },
  };
}

/** Batalkan rencana (mis. pesanan dibatalkan/refund). Transaksi yang sudah ada tidak dihapus. */
export function cancelPlan(plan, { now = new Date().toISOString(), reason = "" } = {}) {
  if (!plan) throw new Error("Cicilan tidak ditemukan.");
  if (plan.status === CICILAN_STATUS.LUNAS) throw new Error("Cicilan sudah lunas.");
  return { ...plan, status: CICILAN_STATUS.BATAL, cancelReason: String(reason || "").slice(0, 200), updatedAt: now };
}

/** Ringkasan untuk kartu: progres, sisa, jatuh tempo berikutnya. */
export function planSummary(plan, today = new Date().toISOString().slice(0, 10)) {
  const jadwal = plan?.jadwal || [];
  const paid = jadwal.filter((r) => r.paid);
  const unpaid = jadwal.filter((r) => !r.paid);
  const next = plan?.status === CICILAN_STATUS.BERJALAN ? unpaid[0] || null : null;
  const daysToDue = next ? daysBetween(today, next.due) : null;
  return {
    paidCount: paid.length,
    tenor: jadwal.length,
    sisaBayar: unpaid.reduce((a, r) => a + r.amount, 0),
    sisaPokok: unpaid.reduce((a, r) => a + r.pokok, 0),
    sudahBayar: paid.reduce((a, r) => a + (r.paidAmount || r.amount), 0),
    next,
    daysToDue,
    overdue: daysToDue != null && daysToDue < 0,
    dueSoon: daysToDue != null && daysToDue >= 0 && daysToDue <= 3,
  };
}

/** Total semua cicilan berjalan (untuk kartu beranda). */
export function cicilanOverview(plans = [], today) {
  const active = (plans || []).filter((p) => p?.status === CICILAN_STATUS.BERJALAN);
  const items = active
    .map((p) => ({ plan: p, sum: planSummary(p, today) }))
    .sort((a, b) => String(a.sum.next?.due || "9999").localeCompare(String(b.sum.next?.due || "9999")));
  return {
    activeCount: active.length,
    sisaBayar: items.reduce((a, x) => a + x.sum.sisaBayar, 0),
    tagihanBerikut: items[0]?.sum.next ? { plan: items[0].plan, row: items[0].sum.next, daysToDue: items[0].sum.daysToDue } : null,
    overdueCount: items.filter((x) => x.sum.overdue).length,
    items,
  };
}

/** Merge antar HP/server: per id, versi `updatedAt` terbaru menang. */
export function mergeCicilanPlans(remote = [], local = []) {
  const map = new Map();
  for (const p of [...(remote || []), ...(local || [])]) {
    if (!p?.id) continue;
    const prev = map.get(p.id);
    if (!prev || String(p.updatedAt || "") > String(prev.updatedAt || "")) map.set(p.id, p);
  }
  return [...map.values()];
}

/** Normalisasi hasil baca screenshot (AI) → { pokok, options[] }. */
export function normalizeScreenshotParse(raw) {
  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map((o) => ({ tenor: toInt(o?.tenor), perBulan: toInt(o?.perBulan ?? o?.per_bulan) }))
    .filter((o) => o.tenor > 0 && o.perBulan > 0);
  const seen = new Set();
  const unique = options.filter((o) => (seen.has(o.tenor) ? false : seen.add(o.tenor)));
  return {
    pokok: toInt(raw?.pokok ?? raw?.harga),
    label: String(raw?.label || raw?.produk || "").trim().slice(0, 120),
    options: unique.sort((a, b) => a.tenor - b.tenor),
  };
}
