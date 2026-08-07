// lib/appStateGuards.js — guard simpan tanpa dependensi Supabase (bisa di-test node)

export function countAppStateRecords(doc) {
  if (!doc || typeof doc !== "object") {
    return { transactions: 0, dailyReports: 0, sdmReports: 0 };
  }
  return {
    transactions: doc.transactions?.length ?? 0,
    dailyReports: doc.dailyReports?.length ?? 0,
    sdmReports: doc.sdmReports?.length ?? 0,
  };
}

/** Tolak simpan jika payload lokal jauh lebih tipis dari awan — cegah overwrite data kosong/stale. */
export function isDestructiveSave(remoteData, localPayload) {
  const remote = countAppStateRecords(remoteData);
  const local = countAppStateRecords(localPayload);

  if (
    remote.transactions >= 5
    && local.transactions < remote.transactions - 3
    && local.transactions <= Math.max(1, Math.floor(remote.transactions * 0.6))
  ) {
    return {
      blocked: true,
      reason: `transaksi awan ${remote.transactions} vs lokal ${local.transactions}`,
    };
  }

  if (
    remote.dailyReports >= 3
    && local.dailyReports === 0
    && local.transactions <= Math.max(1, Math.floor(remote.transactions * 0.5))
  ) {
    return {
      blocked: true,
      reason: `laporan lokal kosong vs awan ${remote.dailyReports} — muat ulang dulu`,
    };
  }

  // Cegah overwrite tipis: lokal kehilangan banyak laporan sementara txs masih banyak
  if (
    remote.dailyReports >= 2
    && local.dailyReports < remote.dailyReports
    && (remote.dailyReports - local.dailyReports) >= 2
    && local.transactions >= Math.max(remote.transactions - 2, remote.transactions * 0.8)
  ) {
    return {
      blocked: true,
      reason: `laporan awan ${remote.dailyReports} vs lokal ${local.dailyReports} (curiga lost-update)`,
    };
  }

  return { blocked: false, reason: null };
}
