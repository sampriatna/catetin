// lib/appState.js
// Penyimpanan state aplikasi NF3 sebagai 1 dokumen JSONB per bisnis.
// Dipakai NF3App (hasil port catatin-nf.jsx) menggantikan window.storage lokal.

import { supabase } from "./supabaseClient.js";
import { withTimeout } from "./supabaseSession.js";
import { listCategories } from "./repo.js";
import { normalizeTransactions } from "./transactionNormalize.js";
import { mergeWalletsPreferLocal } from "./wallets.js";
import { mergeDailyReports, pickNewerDailyReport, localDailyReportsToPreserve, bindLocalReportsToCloudRecords } from "./dailyReportMerge.js";
import { applyRevisionNoticesFromMessages, mergeStaffMessages } from "./staffMessages.js";
import { mergeDeletedDailyReportMeta, filterDeletedDailyReports } from "./dailyReportDelete.js";
import { countAppStateRecords, isDestructiveSave } from "./appStateGuards.js";
import { hydrateNotificationPrefs } from "./notificationCatalog.js";
import { pruneStaleStaffMessages } from "./notificationCatalog.js";
import {
  reconcileSettledLaciTransactions,
  reconcileOrphanLaporanCashTxs,
  canonicalLaporanCashTxId,
  collapseDailyReportsBySlot,
  enforceSingleSmtGeneratedCash,
  reconcileSmtOmzetSyncState,
} from "./kasirHarian.js";
import { healPendingSectionStatuses } from "./pendingSectionHeal.js";
import { normalizeReportDate } from "./laporanKeuangan.js";
import { patchWalletCatalog, migrateReportChannelSettles } from "./wallets.js";
import { inferPurchasingRole, ensurePurchasingCategories, PURCHASING_FINAL_NAMES } from "./purchasingCategories.js";
import { isNfCatalogCategory } from "./nfCategoryCatalog.js";
import { CANONICAL_BUSINESS_ID } from "./canonicalBusiness.js";

export { mergeDailyReports, pickNewerDailyReport, localDailyReportsToPreserve, bindLocalReportsToCloudRecords } from "./dailyReportMerge.js";

export { PURCHASING_FINAL_NAMES, ensurePurchasingCategories, purgeRoguePurchasingCategories } from "./purchasingCategories.js";

function categoryMergeKey(c) {
  return `${c.type || "out"}:${(c.name || "").trim().toLowerCase()}:${c.role || ""}`;
}

function categoryNameKey(c) {
  return `${c.type || "out"}:${(c.name || "").trim().toLowerCase()}`;
}

/** Nama kategori dari migration / app_state lama — selalu buang. */
const LEGACY_PURCHASING_NAMES = new Set([
  "belanja pasar",
  "kemasan & alat",
  "listrik & air",
  "transport belanja",
  "perlengkapan dapur",
  "operasional",
]);

function categoryNameNorm(c) {
  return (c?.name || "").trim().toLowerCase();
}

function isLegacyCategoryName(c) {
  if (isNfCatalogCategory(c)) return false;
  return LEGACY_PURCHASING_NAMES.has(categoryNameNorm(c));
}

function isLegacyPurchasingCategory(c) {
  if (c?.role !== "purchasing") return false;
  return isLegacyCategoryName(c);
}

/** Kategori out umum (co*) yang bentrok dengan purchasing final. */
function isObsoleteGeneralOutCategory(c, allCats) {
  if (isNfCatalogCategory(c)) return false;
  if (c?.type !== "out" || c?.role === "purchasing" || c?.role === "kasir") return false;
  const name = categoryNameNorm(c);
  if (LEGACY_PURCHASING_NAMES.has(name)) return true;
  if (PURCHASING_FINAL_NAMES.has(name)) return true;
  const key = categoryNameKey(c);
  return (allCats || []).some(
    (p) => p?.role === "purchasing" && p.type === "out" && categoryNameKey(p) === key
  );
}

function categoryRichness(c) {
  let score = 0;
  if (c.role === "purchasing") score += 4;
  if (c.accounting_group) score += 2;
  if (c.description) score += 1;
  if (String(c.id || "").includes("-")) score += 1;
  return score;
}

/** Satu kategori per nama+type — yang lebih lengkap (purchasing/DB) menang. */
export function dedupeCategories(cats = []) {
  const byName = new Map();
  for (const c of cats || []) {
    if (!c?.name || isLegacyCategoryName(c)) continue;
    const key = categoryNameKey(c);
    const prev = byName.get(key);
    if (!prev || categoryRichness(c) > categoryRichness(prev)) byName.set(key, c);
  }
  return [...byName.values()].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
}

/** Bersihkan duplikat & kategori lama sebelum dipakai UI / disimpan. */
export function cleanCategoryList(cats = []) {
  const list = cats || [];
  const filtered = list.filter(
    (c) => !isLegacyCategoryName(c) && !isObsoleteGeneralOutCategory(c, list)
  );
  return dedupeCategories(filtered);
}

/** Gabung kategori app_state dengan baris tabel categories (DB menang jika nama/type/role sama). */
export function mergeCategoriesFromDb(local = [], fromDb = []) {
  const out = new Map();
  const dbKeys = new Set((fromDb || []).map(categoryMergeKey));

  for (const c of local || []) {
    if (isLegacyPurchasingCategory(c)) continue;
    if (fromDb?.length && dbKeys.has(categoryMergeKey(c))) continue;
    out.set(c.id, c);
  }
  for (const c of fromDb || []) {
    const row = inferPurchasingRole(c);
    const key = categoryMergeKey(row);
    for (const [id, prev] of out) {
      if (categoryMergeKey(prev) === key) out.delete(id);
    }
    out.set(row.id, row);
  }
  return cleanCategoryList(dedupeCategories([...out.values()]));
}

/** Gabung array by id — union keduanya; jika bentrok, remote (awan) menang. */
function mergeById(remoteArr = [], localArr = [], idKey = "id") {
  const map = new Map();
  (localArr || []).forEach((item) => {
    if (item?.[idKey] != null) map.set(item[idKey], item);
  });
  (remoteArr || []).forEach((item) => {
    if (item?.[idKey] == null) return;
    const prev = map.get(item[idKey]);
    map.set(item[idKey], prev ? { ...prev, ...item } : item);
  });
  return [...map.values()];
}

function mergeDeletedTransactionIds(remote = [], local = []) {
  return [...new Set([...(remote || []), ...(local || [])])].slice(-1000);
}

/** Tx tunai/settle laporan settled tidak boleh masuk tombstone — cegah laci minus setelah sync HP lama. */
function filterProtectedLaporanTxDeletes(deletedIds, reports, transactions) {
  const settledIds = new Set((reports || []).filter((r) => r.status === "settled").map((r) => r.id));
  const protectedIds = new Set();
  for (const r of reports || []) {
    if (r.status === "settled") {
      const canon = canonicalLaporanCashTxId(r);
      if (canon) protectedIds.add(canon);
      protectedIds.add(`t_${r.id}_cash`);
      protectedIds.add(`t_${r.id}_settle_trf_cash`);
    }
  }
  for (const t of transactions || []) {
    if (t?.type !== "in" || !/laporan harian/i.test(t.source || "")) continue;
    if (t.dailyReportId && settledIds.has(t.dailyReportId)) protectedIds.add(t.id);
    if (t.sourceReportId && settledIds.has(t.sourceReportId)) protectedIds.add(t.id);
  }
  return (deletedIds || []).filter((id) => !protectedIds.has(id));
}

function mergeTransactions(remoteArr = [], localArr = [], deletedIds = []) {
  const tomb = new Set(deletedIds || []);
  const map = new Map();
  (localArr || []).forEach((item) => {
    if (item?.id != null && !tomb.has(item.id)) map.set(item.id, item);
  });
  (remoteArr || []).forEach((item) => {
    if (item?.id == null || tomb.has(item.id)) return;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      return;
    }
    // Gabung field — jangan timpa nilai lokal yang lebih lengkap dengan stub kosong dari cloud stale
    const merged = { ...prev, ...item };
    if (!merged.module && prev.module) merged.module = prev.module;
    if (!merged.outlet && prev.outlet) merged.outlet = prev.outlet;
    if (!merged.meta && prev.meta) merged.meta = prev.meta;
    if (merged.meta && prev.meta) {
      const prevItems = prev.meta.items || [];
      const nextItems = merged.meta.items || [];
      if (prevItems.length && !nextItems.length) {
        merged.meta = { ...merged.meta, items: prevItems, itemsTotal: prev.meta.itemsTotal ?? prev.amount };
      }
    }
    if (!(merged.amount > 0) && prev.amount > 0) merged.amount = prev.amount;
    map.set(item.id, merged);
  });
  return [...map.values()];
}

function stripCloudMeta(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const { _cloudUpdatedAt: _t, _cloudLoaded: _l, currentUser: _cu, users: _u, ...rest } = doc;
  return rest;
}

export { countAppStateRecords, isDestructiveSave } from "./appStateGuards.js";

function txRichness(t) {
  let score = Number(t?.amount) || 0;
  if (t?.fromWalletId || t?.from_wallet_id) score += 1_000_000_000;
  if (t?.toWalletId || t?.to_wallet_id) score += 1_000_000_000;
  if (t?.module) score += 500_000_000;
  if (t?.meta?.items?.length) score += 100_000_000;
  if (t?.desc) score += 1_000_000;
  return score;
}

/** Satu id = satu transaksi — pilih entri paling lengkap (cegah saldo salah saat id bentrok). */
export function dedupeTransactionsById(transactions = []) {
  const byId = new Map();
  for (const raw of transactions || []) {
    const t = normalizeTransactions([raw])[0];
    if (!t?.id) continue;
    const prev = byId.get(t.id);
    if (!prev || txRichness(t) >= txRichness(prev)) byId.set(t.id, t);
  }
  return [...byId.values()];
}

function finalizeMergedDoc(merged) {
  if (!merged || typeof merged !== "object") return merged;
  let doc = { ...merged };
  // 1 laporan per outlet|tanggal — proteksi setara UNIQUE di JSONB
  collapseDailyReportsBySlot(doc);
  const laciFix = reconcileSettledLaciTransactions(doc);
  if (laciFix.changed) {
    doc = {
      ...doc,
      transactions: laciFix.transactions,
      deletedTransactionIds: laciFix.deletedTransactionIds,
    };
  }
  const orphanFix = reconcileOrphanLaporanCashTxs(doc);
  if (orphanFix.changed) {
    doc = {
      ...doc,
      transactions: orphanFix.transactions,
      deletedTransactionIds: orphanFix.deletedTransactionIds,
    };
  }
  // SMT: hard-collapse generated cash per tanggal (legacy + kanonik → 1)
  const smtDates = new Set(
    (doc.dailyReports || [])
      .filter((r) => r?.outlet === "SMT")
      .map((r) => normalizeReportDate(r.date) || r.date)
      .filter(Boolean)
  );
  for (const t of doc.transactions || []) {
    if (t?.type === "in" && /laporan harian/i.test(t.source || "") && /Omset tunai SMT/i.test(t.desc || "")) {
      const d = normalizeReportDate(t.date) || t.date;
      if (d) smtDates.add(d);
    }
  }
  for (const d of smtDates) {
    enforceSingleSmtGeneratedCash(doc, d);
  }
  // Sync path: stamp serverRecordId/syncStatus, jangan pernah menambah laporan baru
  reconcileSmtOmzetSyncState(doc, { businessId: doc.businessId || CANONICAL_BUSINESS_ID });
  // Checklist SDM/Omzet/Sosmed: jika data pusat sudah ada, jangan biarkan commitStatus=failed menahan UI
  healPendingSectionStatuses(doc);
  const reports = doc.dailyReports || [];
  const txs = normalizeTransactions(dedupeTransactionsById(doc.transactions));
  const wallets = patchWalletCatalog(doc.wallets || []);
  const reportChannels = migrateReportChannelSettles(doc.reportChannels);
  return {
    ...doc,
    wallets,
    reportChannels,
    transactions: txs,
    deletedTransactionIds: filterProtectedLaporanTxDeletes(
      doc.deletedTransactionIds || [],
      reports,
      txs
    ),
    staffMessages: pruneStaleStaffMessages(doc.staffMessages, reports),
  };
}

/**
 * Poll / refresh awan — transaksi & laporan omset mengikuti awan,
 * tetapi laporan lokal yang belum tersimpan (punya tx lokal / slot baru) tetap dipertahankan
 * agar tidak terjadi: dompet dobel tanpa laporan terlihat.
 */
export function mergeAppStateFromCloudPull(remote, local) {
  if (!remote || typeof remote !== "object") return finalizeMergedDoc(local);
  if (!local || typeof local !== "object") return finalizeMergedDoc(remote);

  const deleteMeta = mergeDeletedDailyReportMeta(remote, local);
  const filterReports = (arr) => filterDeletedDailyReports(arr, deleteMeta);
  const deletedTransactionIds = filterProtectedLaporanTxDeletes(
    mergeDeletedTransactionIds(remote.deletedTransactionIds, local.deletedTransactionIds || []),
    filterReports(mergeDailyReports(remote.dailyReports || [], localDailyReportsToPreserve(remote, local), { filterDeletedDailyReports: filterReports })),
    [
      ...(remote.transactions || []),
      ...(local.transactions || []),
    ].filter((t) => t?.id && !new Set(mergeDeletedTransactionIds(remote.deletedTransactionIds, local.deletedTransactionIds || [])).has(t.id))
  );
  const tomb = new Set(deletedTransactionIds);
  const cloudTxs = (remote.transactions || []).filter((t) => t?.id && !tomb.has(t.id));

  const preservedLocalReports = localDailyReportsToPreserve(remote, local);
  const mergedReportList = filterReports(
    mergeDailyReports(remote.dailyReports || [], preservedLocalReports, {
      filterDeletedDailyReports: filterReports,
    })
  );
  // Ikat pending lokal ke record pusat (id/slot/idempotencyKey) — sync ≠ create
  const boundReports = bindLocalReportsToCloudRecords(mergedReportList, remote.dailyReports || []);

  const mergedStaffRaw = mergeStaffMessages(remote.staffMessages, local.staffMessages);
  const cloudReports = applyRevisionNoticesFromMessages(boundReports, mergedStaffRaw);
  const mergedStaff = pruneStaleStaffMessages(mergedStaffRaw, cloudReports);

  const base = mergeAppStateData(remote, local);
  const localTxs = (local.transactions || []).filter((t) => t?.id && !tomb.has(t.id));

  return finalizeMergedDoc({
    ...base,
    // Awan menang jika id bentrok; transaksi baru di HP ini (belum di awan) tetap dipertahankan.
    transactions: mergeTransactions(localTxs, cloudTxs, deletedTransactionIds),
    deletedTransactionIds,
    deletedDailyReportIds: deleteMeta.deletedDailyReportIds,
    deletedDailyReportSlots: deleteMeta.deletedDailyReportSlots,
    dailyReports: filterReports(cloudReports),
    staffMessages: mergedStaff,
  });
}

/** Gabung dokumen app_state — hindari transaksi/dompet hilang saat owner & purchasing simpan bersamaan. */
export function mergeAppStateData(remote, local) {
  if (!remote || typeof remote !== "object") return finalizeMergedDoc(local);
  if (!local || typeof local !== "object") return finalizeMergedDoc(remote);

  const hidden = new Set([
    ...(remote.hiddenInsights || []),
    ...(local.hiddenInsights || []),
  ]);

  const deletedTransactionIds = mergeDeletedTransactionIds(
    remote.deletedTransactionIds,
    local.deletedTransactionIds
  );

  const deleteMeta = mergeDeletedDailyReportMeta(remote, local);
  const filterReports = (arr) => filterDeletedDailyReports(arr, deleteMeta);

  const mergedStaffRaw = mergeStaffMessages(remote.staffMessages, local.staffMessages);
  const mergedReports = applyRevisionNoticesFromMessages(
    mergeDailyReports(remote.dailyReports, local.dailyReports, {
      filterDeletedDailyReports: filterReports,
    }),
    mergedStaffRaw
  );
  const filteredReports = filterReports(mergedReports);
  const mergedStaff = pruneStaleStaffMessages(mergedStaffRaw, filteredReports);

  return finalizeMergedDoc({
    ...remote,
    ...local,
    wallets: mergeWalletsPreferLocal(remote.wallets, local.wallets),
    categories: cleanCategoryList(mergeById(remote.categories, local.categories)),
    transactions: mergeTransactions(remote.transactions, local.transactions, deletedTransactionIds),
    deletedTransactionIds,
    deletedDailyReportIds: deleteMeta.deletedDailyReportIds,
    deletedDailyReportSlots: deleteMeta.deletedDailyReportSlots,
    dailyReports: filteredReports,
    sdmReports: mergeById(remote.sdmReports, local.sdmReports),
    voidLogs: mergeById(remote.voidLogs, local.voidLogs),
    staffMessages: mergedStaff,
    sosmedReports: mergeById(remote.sosmedReports, local.sosmedReports),
    rawInbox: mergeById(remote.rawInbox, local.rawInbox),
    profile: { ...(remote.profile || {}), ...(local.profile || {}) },
    automation: { ...(remote.automation || {}), ...(local.automation || {}) },
    notificationPrefs: hydrateNotificationPrefs({ ...(remote.notificationPrefs || {}), ...(local.notificationPrefs || {}) }),
    outletConfig: { ...(remote.outletConfig || {}), ...(local.outletConfig || {}) },
    sosmedConfig: { ...(remote.sosmedConfig || {}), ...(local.sosmedConfig || {}) },
    reportChannels: { ...(remote.reportChannels || {}), ...(local.reportChannels || {}) },
    reportUi: { ...(remote.reportUi || {}), ...(local.reportUi || {}) },
    hiddenInsights: [...hidden],
    pairCode: local.pairCode || remote.pairCode,
  });
}

async function loadAppStateDoc(bizId) {
  let lastErr = null;
  const attempts = [
    { ms: 10000, label: "Muat app_state" },
    { ms: 18000, label: "Muat app_state (retry)" },
  ];
  for (const step of attempts) {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from("app_state")
          .select("data, updated_at")
          .eq("business_id", bizId)
          .maybeSingle(),
        step.ms,
        step.label
      );
      if (error) throw new Error(`[loadAppState] ${error.message}`);
      if (!data?.data) return null;
      return { ...data.data, _cloudUpdatedAt: data.updated_at };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("[loadAppState] Gagal memuat app_state");
}

/**
 * Ambil versi dokumen saja untuk health-check sinkronisasi.
 * Dipakai fallback polling agar HP tidak perlu mengunduh seluruh JSONB
 * app_state ketika tidak ada perubahan di awan.
 */
export async function loadAppStateUpdatedAt(bizId) {
  if (!bizId) return null;
  const { data, error } = await withTimeout(
    supabase
      .from("app_state")
      .select("updated_at")
      .eq("business_id", bizId)
      .maybeSingle(),
    6000,
    "Cek versi app_state"
  );
  if (error) throw new Error(`[loadAppStateUpdatedAt] ${error.message}`);
  return data?.updated_at || null;
}

// Ambil dokumen state + kategori dari tabel categories (accounting_group, description, role, …).
export async function loadAppState(bizId) {
  const [doc, dbCats] = await Promise.all([
    loadAppStateDoc(bizId),
    withTimeout(listCategories(bizId), 8000, "Muat kategori").catch((e) => {
      console.warn("[loadAppState] categories:", e);
      return [];
    }),
  ]);
  if (!doc && !dbCats.length) return null;

  const merged = doc || {};
  if (dbCats.length) {
    merged.categories = mergeCategoriesFromDb(merged.categories || [], dbCats);
  }
  if (merged.categories?.length) {
    const isFnb =
      bizId === CANONICAL_BUSINESS_ID
      || merged.profile?.businessType === "fnb"
      || merged.walletSetup?.businessType === "fnb";
    if (isFnb) {
      merged.categories = ensurePurchasingCategories(merged.categories, cleanCategoryList);
    }
  }
  return merged;
}

// Simpan/overwrite dokumen state. Upsert berdasarkan business_id.
// Merge dengan data terbaru di awan dulu — supaya transaksi purchasing tidak hilang saat owner simpan.
// Retry baca-merge-tulis agar simpan bersamaan antar HP tidak menimpa transaksi lawan.
// Lock per-business (setara LockService) mencegah race create duplikat laporan.
const appStateSaveLocks = new Map();

function withAppStateSaveLock(bizId, fn) {
  const key = String(bizId || "_");
  const prev = appStateSaveLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prev.catch(() => {}).then(() => gate);
  appStateSaveLocks.set(key, tail);
  return prev.catch(() => {}).then(fn).finally(() => {
    release();
    if (appStateSaveLocks.get(key) === tail) appStateSaveLocks.delete(key);
  });
}

export async function saveAppState(bizId, data) {
  return withAppStateSaveLock(bizId, () => saveAppStateUnlocked(bizId, data));
}

/**
 * Simpan app_state dengan merge + optimistic concurrency (CAS on updated_at).
 * Mencegah lost update: writer B yang masih memegang snapshot lama tidak menimpa
 * dailyReports/txs dari writer A yang sudah commit.
 */
async function saveAppStateUnlocked(bizId, data) {
  const localPayload = stripCloudMeta(data);
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    let remote = null;
    try {
      remote = await loadAppState(bizId);
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      continue;
    }

    const remoteData = stripCloudMeta(remote);
    const remoteUpdatedAt = remote?._cloudUpdatedAt || null;
    const destructive = isDestructiveSave(remoteData, localPayload);
    if (destructive.blocked) {
      throw new Error(
        `[saveAppState] Simpan dibatalkan (${destructive.reason}). Muat ulang halaman — jangan input dulu.`
      );
    }

    const merged = mergeAppStateData(remoteData, localPayload);
    const nextUpdatedAt = new Date().toISOString();

    try {
      if (!remote) {
        const { data: row, error } = await withTimeout(
          supabase
            .from("app_state")
            .upsert(
              { business_id: bizId, data: merged, updated_at: nextUpdatedAt },
              { onConflict: "business_id" }
            )
            .select("updated_at")
            .single(),
          12000,
          "Simpan app_state (insert)"
        );
        if (error) throw new Error(`[saveAppState] ${error.message}`);
        return row?.updated_at || nextUpdatedAt;
      }

      // CAS: hanya tulis jika updated_at masih sama dengan yang baru dibaca.
      const { data: rows, error } = await withTimeout(
        supabase
          .from("app_state")
          .update({ data: merged, updated_at: nextUpdatedAt })
          .eq("business_id", bizId)
          .eq("updated_at", remoteUpdatedAt)
          .select("updated_at"),
        12000,
        "Simpan app_state (CAS)"
      );
      if (error) throw new Error(`[saveAppState] ${error.message}`);
      if (Array.isArray(rows) && rows.length === 1) {
        return rows[0]?.updated_at || nextUpdatedAt;
      }
      // 0 rows → versi berubah (lost-update dicegah) — reload + merge ulang
      lastError = new Error(
        `[saveAppState] Konflik versi awan (attempt ${attempt + 1}) — menggabungkan ulang`
      );
      await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
      continue;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }

  throw lastError || new Error("[saveAppState] Gagal menyimpan setelah beberapa percobaan");
}

// Parsing AI lewat server route /api/parse (key Anthropic tetap di server).
export async function aiParse(payload) {
  const res = await fetch("/api/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `parse ${res.status}`);
  return json;
}

export async function fetchSdmAdvice(payload) {
  const res = await fetch("/api/sdm-advice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `sdm-advice ${res.status}`);
  return json;
}

export async function fetchBusinessAnalysis(payload) {
  const res = await fetch("/api/business-analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `business-analysis ${res.status}`);
  return json;
}

export async function fetchPurchasingAdvice(payload, accessToken) {
  const headers = { "content-type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch("/api/purchasing-advice", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `purchasing-advice ${res.status}`);
  return json;
}
