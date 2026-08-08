"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { Home, BarChart3, Sparkles, User, Mic, Bell, Inbox, Cloud, Eye, EyeOff, Plus, Wallet, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Pencil, Trash2, ShoppingCart, Users, Zap, Store, PiggyBank, MoreHorizontal, Check, X, ArrowLeft, ScanLine, Keyboard, Fingerprint, Star, ShieldCheck, Monitor, RefreshCw, Sun, Moon, Smartphone, Copy, AlertTriangle, ClipboardList, ClipboardPaste, TrendingUp, TrendingDown, Loader2, Banknote, Filter, Ban, Share2, LogOut, Tags, MessageCircle, ArrowLeftRight, Upload, Search } from "lucide-react";
import KategoriPurchasing from "../../../components/KategoriPurchasing";
import LaporanPurchasing from "../../../components/LaporanPurchasing";
import AsistenPurchasing from "../../../components/AsistenPurchasing";
import NfBelanjaSearch from "../../../components/NfBelanjaSearch";
import PurchasingAliasesReview from "../../../components/PurchasingAliasesReview";
import { loadAppState, saveAppState, mergeAppStateData, mergeAppStateFromCloudPull, mergeCategoriesFromDb, cleanCategoryList, ensurePurchasingCategories, dedupeTransactionsById, aiParse, fetchBusinessAnalysis } from "../../../lib/appState";
import { checkPurchasingFloor } from "../../../lib/purchasingExpense";
import { normalizeTransaction, normalizeTransactions, resolveWalletId, resolveTransferIds } from "../../../lib/transactionNormalize";
import CategoryQuickManage from "../../../components/CategoryQuickManage.jsx";
import { buildNewCategory, applyRemoveCategory, canEditCategory } from "../../../lib/categoryManage.js";
import { canDo, visibleWallets, visibleCategories, visibleTransactions, ROLE_LABEL, PURCHASING_WALLET_IDS, showPurchasingAsistenTab, showPurchasingAsistenBeranda, canUsePurchasingAsisten, canManageTransactions, isKasKecilWallet } from "../../../lib/rbac";
import { resolveBusinessDisplayName, CANONICAL_BUSINESS_ID } from "../../../lib/canonicalBusiness";
import {
  businessFeatures,
  visibleWalletsForBusiness,
  visibleTransactionsForBusiness,
  visibleCategoriesForBusiness,
  visibleNfIncomeCategories,
  filterTransactionsForNfFinance,
  scopedNfFinanceTransactions,
  resolveCategoriesForBusiness,
  isOverlayAllowedForBusiness,
  isNfFishingBusiness,
  nfBusinessContext,
  isNfFinanceScope,
  fnbFeatureLabel,
  findCanonicalInList,
  CANONICAL_DISPLAY_NAME,
  businessTypeLabel,
  isFnBOnlyWallet,
  isNfPurchasingOpsWallet,
} from "../../../lib/businessFeatures";
import { remapNfTransactions, needsNfChannelUpgrade, ensureNfFishingCategories, hasLegacyNfMpIncomeCategories } from "../../../lib/nfCategoryCatalog";
import {
  hydrateMpStores, mpStoresForCategory, buildMpIncomeMeta, groupNfIncomeCategories,
  createMpStoreId, nextStoreCode, NF_MP_PLATFORMS,
} from "../../../lib/nfSalesChannels";
import { computeNfChannelBreakdown } from "../../../lib/nfChannelReport";
import { migrateLegacyMpIncomeTransactions } from "../../../lib/nfLegacyMpMigration";
import NfChannelBreakdownCard from "../../../components/NfChannelBreakdownCard";
import { resolveAuthMembership } from "../../../lib/membershipResolve";
import { walletOptionLabel, walletBalanceDisplay, walletsForSaldoTotal, shouldHideWalletBalance, purchasingBalancePresentation, isKasKecilWalletDisplay, isLaciOutletWallet, laciBalancePresentation } from "../../../lib/walletDisplay";
import { getAccountUi, navConfig } from "../../../lib/accountUi";
import {
  getPeriodBounds, shiftAnchor, filterTransactions, buildCashflowChart,
  sumInOut, formatPeriodLabel, localISO, todayLocal,
} from "../../../lib/laporanKeuangan";
import { computeNfProfit } from "../../../lib/nfProfitReport";
import { submitDailyReport, resubmitDailyReport, settleDailyReport, verifyDailyReportAdmin, requestDailyReportRevision, deleteDailyReport, collectAllDailyReportTxIds, pendingReports, reportsAwaitingVerify, reportsReadyToSettle, reportsAwaitingRevision, reportsForDate, findPendingRevisionReport, reportAwaitingKasirRevision, reportCashAmount, reportSettleUrgency, reportSettleDeadlineLabel, reconcileDailyReports, allDailyReportsForAdmin, applyDailyReportMutation, makeDailyReportSubmissionId, makeSmtOmzetIdempotencyKey, logDailyReportStage, LACI_BY_OUTLET, LACI_FLOOR, countSmtSubmissionArtifacts, hasOrphanLaporanCashSlot, findCommittedDailyReport, recoverDailyReportFromOrphanCash, isUncertainDeliveryError, userFacingDailyReportError } from "../../../lib/kasirHarian";
import { submitVoidLog, pendingVoidLogs, reviewVoidLog, visibleVoidLogs, VOID_TYPES } from "../../../lib/voidLog";
import {
  submitSdmReport, buildSdmSnapshot, getOutletConfig, todaySdmReport,
  OUTLET_LABEL, SDM_HINT, parseHeadcountInput, OUTLETS,
  calcDailyOmsetTarget, formatTargetFormula,
  defaultOutletConfig, hydrateOutletConfig, factoryOutletConfig, DEFAULT_OMSET_PER_PERSON, DEFAULT_DAILY_WAGE,
} from "../../../lib/sdmHarian";
import {
  getReportChannels, getAllReportChannels, getReportUi, groupChannels, cashChannel,
  SETTLE_WALLET_OPTIONS, hydrateReportChannels, hydrateReportUi,
  factoryChannelsForOutlet, factoryUiForOutlet, createChannelId, appendCustomReportChannel,
} from "../../../lib/reportChannels";
import {
  createStaffMessage, createRevisionRequestMessage, visibleStaffMessages, unreadStaffCount,
  markStaffMessageRead, markRevisionMessagesRead, resolveRevisionMessages, fulfillSubmittedReportMessages, cancelRevisionMessagesForReport, isRevisionRequestMessage,
  applyRevisionNoticesFromMessages, formatMessageTime, revisionMessageReportDate, revisionNoteForReport,
  prependStaffMessage, createPurchasingFundMessage, createDailyReportSubmittedMessage,
  createRevisionSubmittedAckMessage,
  createVoidPendingMessage, createDailyReportVerifiedMessage,
  createDailyReportSettledMessage, createDailyReportDeletedMessage,
} from "../../../lib/staffMessages";
import {
  NOTIFICATION_CATALOG, hydrateNotificationPrefs, getStaffMessageAction,
  getMessageKind, isActionableStaffMessage, isStaffMessageStale, notificationKindLabel,
} from "../../../lib/notificationCatalog";
import { mergeDailyRemindersIntoDoc } from "../../../lib/notificationReminders";
import {
  submitSosmedReport, todaySosmedReport, canInputSosmed, resolveSosmedOutlet,
  isSosmedEnabled, hydrateSosmedConfig, sosmedDisplayName, parseLines, linesToText,
  DM_PLATFORMS, SOCIAL_PLATFORMS, STAR_KEYS, SOSMED_OUTLETS, defaultSosmedConfig, emptyReport,
} from "../../../lib/sosmedReport";
import { buildBusinessAnalysis } from "../../../lib/businessAnalysis";
import {
  openWhatsAppShare, formatSosmedWa, formatSosmedFormWa, formatSdmWa,
  formatOmsetWa, formatKeuanganWa, formatVoidWa,
} from "../../../lib/shareWa";
import { pairPageUrl } from "../../../lib/appUrl.js";
import { exportKeuanganCsv, exportKeuanganPdf } from "../../../lib/laporanKeuanganExport.js";
import { compressWalletLogo, walletHasLogo } from "../../../lib/walletLogo.js";
import { patchWalletCatalog, sortWallets, migrateReportChannelSettles, foodWalletDisplayName } from "../../../lib/wallets.js";
import {
  NF_FNB_WALLETS,
  getWalletCatalogForBusiness,
  resolveWalletMergeMode,
  createWalletSetupSeed,
  createSharedWalletLink,
  rebuildWalletsWithShared,
} from "../../../lib/walletPresets.js";
import {
  filterShareableRemoteWallets,
  isCrossBusinessShareableWallet,
  SHARED_WALLET_POLICY_HINT,
} from "../../../lib/sharedWalletPolicy.js";
import {
  sharedWalletId,
  isSharedWallet,
  mirrorBalancesForLinks,
  sourceBusinessIdsForLinks,
  applyMirrorBalances,
  mergeWithLocalTransactions,
  filterSharedTransactionsForView,
  mapTransactionsToSharedWallet,
  walletTransactionsFromDoc,
} from "../../../lib/sharedWalletMirror.js";
import { canWriteSharedBank } from "../../../lib/sharedBankWrite.js";
import { fetchSharedBankBalances, fetchSharedBankTransactions, postSharedBankTx } from "../../../lib/repo";
import PwaInstallBanner, { registerServiceWorker, forceReloadLatestApp } from "../../../components/PwaInstallBanner";
import { getAppBuildLabel, getAppBuildSha, APP_SW_VERSION } from "../../../lib/buildInfo";
import { isSectionSynced, healPendingSectionStatuses } from "../../../lib/pendingSectionHeal";
import TransactionEditSheet from "../../../components/TransactionEditSheet";
import { getTransactionEditPolicy, validateTransactionUpdate, applyTransactionDelete } from "../../../lib/transactionEdit";
import { recordDailyReportDelete } from "../../../lib/dailyReportDelete";
import { isPurchasingTx } from "../../../lib/purchasingExpense";
import { purchasingTxTitle, purchasingTxSubtitle } from "../../../lib/purchasingItems";
import { showActionToast } from "../../../lib/actionToast";
import { subscribeAppStateChanges } from "../../../lib/appStateRealtime.js";
import { applyBalanceAdjustment, computeBalanceAdjustment, recentBalanceAdjustments, countBalanceAdjustments } from "../../../lib/adjustSaldo";
import { playRevisionAlertSound, playNotificationPing, unlockNotificationAudio } from "../../../lib/notificationSound";
import ActionToast from "../../../components/ActionToast";

const CashflowChart = dynamic(() => import("../../../components/CashflowChart"), {
  ssr: false,
  loading: () => <div style={{ height: 180, display: "grid", placeItems: "center", color: "var(--ink3)", fontSize: 13 }}>Memuat grafik…</div>,
});
const PurchasingForm = dynamic(() => import("../../../components/PurchasingForm"), { ssr: false });
const NF3Assistant = dynamic(() => import("../../../components/NF3Assistant"), { ssr: false });

/** Cadangan poll — utama pakai Supabase Realtime (langsung saat ada simpan di HP lain). */
const CLOUD_POLL_FALLBACK_MS = 2 * 60 * 1000;
const REALTIME_PULL_DEBOUNCE_MS = 350;
const SAVE_DEBOUNCE_MS = 1000;
const CRITICAL_SAVE_WINDOW_MS = 3500;

function extractSavePayload(doc) {
  const {
    currentUser, users, _systemThemeTick, _cloudUpdatedAt, _cloudLoaded,
    _nfTxRemapped, _nfMpMigrationStats, _nfCategoriesUpgraded,
    ...data
  } = doc || {};
  return data;
}

function isUserTypingInForm() {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/* ============================================================
   NF3 — self-hosted, tampilan mengikuti asli (violet theme)
   ============================================================ */

const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#F0F0F8;--surface:#FFFFFF;--surface2:#F0F0F8;--line:#E8E8F0;
  --brand:#6366F1;--brand-dark:#4F46E5;--brand-soft:#EEF2FF;--brand-text:#4338CA;
  --ink:#1A1A2E;--ink2:#6B7280;--ink3:#9CA3AF;
  --in:#22C55E;--in-soft:#DCFCE7;--in-text:#15803D;
  --out:#EF4444;--out-soft:#FEE2E2;--out-text:#B91C1C;
  --amber:#F59E0B;--amber-soft:#FEF3C7;
}
[data-theme=dark]{
  --bg:#0F0F1A;--surface:#1A1A2E;--surface2:#252540;--line:#2D2D50;
  --brand:#818CF8;--brand-dark:#6366F1;--brand-soft:#1E1B4B;--brand-text:#A5B4FC;
  --ink:#F1F5F9;--ink2:#94A3B8;--ink3:#64748B;
  --in:#4ADE80;--in-soft:#14532D;--in-text:#86EFAC;
  --out:#F87171;--out-soft:#7F1D1D;--out-text:#FCA5A5;
  --amber:#FCD34D;--amber-soft:#78350F;
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);}
.scroll-hide::-webkit-scrollbar{display:none}
.scroll-hide{-ms-overflow-style:none;scrollbar-width:none}
.animate-spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.money{font-variant-numeric:tabular-nums;letter-spacing:-0.02em;}
@keyframes pulse-ring{0%{transform:scale(1);opacity:.6}70%{transform:scale(2.2);opacity:0}100%{opacity:0}}
.pulse-ring{animation:pulse-ring 1.4s cubic-bezier(.4,0,.6,1) infinite}
.nf3-shell{min-height:100dvh;background:var(--bg);display:flex;justify-content:center}
.nf3-shell-inner{position:relative;width:100%;min-height:100dvh;background:var(--bg);overflow:hidden}
.nf3-scroll{height:100dvh;overflow-y:auto;padding-bottom:calc(108px + env(safe-area-inset-bottom,0px))}
.nf3-bottom-nav-wrap{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:center;z-index:10;pointer-events:none}
.nf3-bottom-nav{pointer-events:auto;width:100%;background:var(--surface);border-top:1px solid var(--line);padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
@keyframes task-pulse-border{0%,100%{box-shadow:0 2px 12px rgba(99,102,241,.12)}50%{box-shadow:0 2px 18px rgba(99,102,241,.28)}}
@keyframes task-urgent-pulse{0%,100%{box-shadow:0 2px 10px rgba(245,158,11,.18)}50%{box-shadow:0 4px 20px rgba(245,158,11,.38)}}
@keyframes task-check-pop{0%{transform:scale(.55);opacity:0}65%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
@keyframes task-progress{from{width:0}to{width:var(--prog,0%)}}
.task-row-pending{animation:task-pulse-border 2.2s ease-in-out infinite}
.task-row-urgent{animation:task-urgent-pulse 2s ease-in-out infinite}
.task-row-done{border-left:4px solid var(--in)!important;transition:border-color .25s,background .25s,opacity .25s}
.task-check-pop{animation:task-check-pop .4s cubic-bezier(.34,1.56,.64,1)}
.task-progress-fill{animation:task-progress .6s ease-out}
.task-row-inner{display:flex;align-items:center;gap:12px;width:100%}
@media(max-width:400px){.task-row-meta{align-items:flex-start!important}.task-row-action-col{margin-top:2px}}
.nf3-bottom-nav-inner{display:flex;align-items:center;height:70px;position:relative}
.nf3-pwa-banner{position:fixed;left:0;right:0;bottom:calc(70px + env(safe-area-inset-bottom,0px) + 8px);z-index:9;display:flex;justify-content:center;padding:0 12px;pointer-events:none}
.nf3-pwa-banner-inner{pointer-events:auto;width:100%;max-width:416px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:12px 14px;box-shadow:0 -4px 24px rgba(0,0,0,.12)}
.nf3-pwa-banner-text{margin:0 0 10px;font-size:13px;line-height:1.45;color:var(--ink);font-weight:600}
.nf3-pwa-banner-actions{display:flex;gap:8px;flex-wrap:wrap}
.nf3-pwa-btn{border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer}
.nf3-pwa-btn-primary{background:#185FA5;color:#fff}
.nf3-pwa-btn-ghost{background:var(--surface2);color:var(--ink2)}
`;

const fmtMoney = (n, cur = "IDR", sign = false) => {
  const syms = { IDR: "Rp", USD: "$", MYR: "RM" };
  const locales = { IDR: "id-ID", USD: "en-US", MYR: "ms-MY" };
  const num = Math.round(Number(n) || 0);
  const abs = Math.abs(num);
  const s = new Intl.NumberFormat(locales[cur] || "id-ID").format(abs);
  const sym = syms[cur] || "Rp";
  let prefix = "";
  if (sign === "+") prefix = "+";
  else if (sign === "−" || sign === "-") prefix = "−";
  else if (sign === true && num >= 0) prefix = "+";
  else if (num < 0) prefix = "−";
  if (cur === "IDR") return `${prefix}${sym}${s}`;
  return `${prefix}${sym} ${s}`;
};

const fmtTxAmount = (amount, type, cur = "IDR") => {
  if (type === "in") return fmtMoney(amount, cur, "+");
  if (type === "out") return fmtMoney(amount, cur, "−");
  return fmtMoney(amount, cur);
};

/** Label peringatan saldo vs floor dompet. */
const walletFloorHint = (bal, floor) => {
  if (!floor || floor <= 0) return null;
  const b = Math.round(bal);
  const f = Math.round(floor);
  if (b === f) return "Di batas minimum";
  if (b <= f * 1.2) return "Mendekati minimum";
  return null;
};
/** Tanggal bisnis hari ini — selalu Asia/Jakarta (bukan UTC / TZ perangkat asing). */
const today = () => todayLocal();
const dayLabel = (d) => new Date(d + "T12:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
const isoOffset = (n) => {
  const base = todayLocal();
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n);
  return localISO(dt);
};

/** Checklist hijau hanya jika sudah synced/committed di pusat (bukan sekadar mutate lokal). */
function isSectionCloudCommitted(row) {
  return isSectionSynced(row);
}

const UNSYNCED_HINT = "Belum tersinkron ke pusat — data tetap tersimpan di perangkat.";
const SYNCED_HINT = "Sudah tersimpan di pusat.";

/** Label waktu singkat untuk bar sync (WIB = jam lokal perangkat). */
const formatSyncClock = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const sameDay = localISO(d) === today();
    return d.toLocaleString("id-ID", sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
};

/** Pecah kode sync jadi hash singkat + meta jumlah transaksi. */
const parseSyncCode = (code) => {
  if (!code) return { hash: "—", txMeta: null };
  const m = String(code).match(/^(\d+)tx·(.+)$/);
  if (m) {
    return { hash: m[2], txMeta: `${Number(m[1]).toLocaleString("id-ID")} transaksi` };
  }
  return { hash: code, txMeta: null };
};

function SyncStatusStrip({ syncInfo, realtimeLive, cloudSyncState, syncHint }) {
  const { hash, txMeta } = parseSyncCode(syncInfo?.code);
  return (
    <div style={{ margin: "0 16px 12px" }}>
      {syncInfo?.code && (
        <div style={{
          padding: "10px 12px", borderRadius: 12, background: "var(--surface)",
          border: "1px solid var(--line)", fontSize: 12, lineHeight: 1.4,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              {realtimeLive && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 10, fontWeight: 800, color: "var(--in-text)",
                  padding: "2px 8px", borderRadius: 99, background: "var(--in-soft)",
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--in-text)" }} />
                  Live
                </span>
              )}
              <span style={{ fontWeight: 700, color: "var(--ink2)" }}>Kode</span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: "var(--ink)", letterSpacing: "0.04em" }} title="Harus sama di semua HP">
                {hash}
              </span>
              {txMeta && <span style={{ fontSize: 10, color: "var(--ink3)" }}>{txMeta}</span>}
            </div>
            <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--ink3)", flexShrink: 0 }}>
              <span>Awan {formatSyncClock(syncInfo.cloudAt)}</span>
              <span>HP {formatSyncClock(syncInfo.pulledAt)}</span>
            </div>
          </div>
        </div>
      )}
      {cloudSyncState === "syncing" && (
        <div style={{ marginTop: syncInfo?.code ? 8 : 0, padding: "8px 12px", borderRadius: 10, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={14} className="animate-spin" /> Menyinkronkan…
        </div>
      )}
      {cloudSyncState === "ok" && syncHint && (
        <div style={{ marginTop: syncInfo?.code ? 8 : 0, padding: "8px 12px", borderRadius: 10, background: "#ECFDF5", color: "var(--in-text)", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Check size={14} /> {syncHint}
        </div>
      )}
      {cloudSyncState === "err" && (
        <div style={{ marginTop: syncInfo?.code ? 8 : 0, padding: "8px 12px", borderRadius: 10, background: "#FEF2F2", color: "#B91C1C", fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <X size={14} /> Gagal sync — tap ☁️ lagi
        </div>
      )}
    </div>
  );
}

/** Kode singkat revisi data — bandingkan antar akun (owner vs purchasing). */
const syncRevisionCode = (doc) => {
  const txs = doc?.transactions?.length || 0;
  const cloudAt = doc?._cloudUpdatedAt || "";
  let h = txs * 997;
  for (let i = 0; i < cloudAt.length; i++) h = ((h << 5) - h + cloudAt.charCodeAt(i)) | 0;
  return `${txs}tx·${Math.abs(h).toString(36).slice(0, 4)}`;
};

const buildSyncMeta = (doc, prevDoc, pulledAt = new Date().toISOString()) => {
  const cloudAt = doc?._cloudUpdatedAt || null;
  const code = syncRevisionCode(doc);
  let hint = null;
  let saldoDelta = null;
  if (prevDoc) {
    const dTx = (doc?.transactions?.length || 0) - (prevDoc?.transactions?.length || 0);
    const cloudChanged = cloudAt && prevDoc?._cloudUpdatedAt && cloudAt !== prevDoc._cloudUpdatedAt;
    if (dTx > 0) hint = `+${dTx} transaksi dari awan`;
    else if (dTx < 0) hint = `${dTx} transaksi dari awan`;
    else if (cloudChanged) hint = "Data awan diperbarui";
    else hint = "Sudah versi terbaru";

    const watchWallets = ["w_kas_kecil", "w_laci_kbu", "w_laci_ksm", "w_laci_smt", "w_kas_besar"];
    for (const wid of watchWallets) {
      const before = walletBalance(wid, prevDoc.wallets, prevDoc.transactions);
      const after = walletBalance(wid, doc?.wallets, doc?.transactions);
      if (before !== after) {
        saldoDelta = { walletId: wid, before, after, delta: after - before };
        break;
      }
    }
  }
  return { cloudAt, pulledAt, code, hint, saldoDelta };
};

// ─── Storage ───────────────────────────────────────────────
// State disimpan sbg dokumen JSONB per bisnis di Supabase (lib/appState).

// helper saldo dompet
const walletBalance = (walletId, wallets, transactions) => {
  const w = wallets.find(x => x.id === walletId);
  if (!w) return 0;
  const txs = transactions.filter(t => {
    if (t.type === "transfer") {
      const { from, to } = resolveTransferIds(t);
      return from === walletId || to === walletId;
    }
    return resolveWalletId(t) === walletId;
  });
  return (w.opening || 0) + txs.reduce((a, t) => {
    if (t.type === "transfer") {
      const { to } = resolveTransferIds(t);
      return a + (to === walletId ? t.amount : -t.amount);
    }
    return a + (t.type === "in" ? t.amount : -t.amount);
  }, 0);
};

const defaultState = () => ({
  // user aktif (demo: owner)
  currentUser: { id: "u1", name: "Sam", role: "owner", outlet: null },
  // semua user yang bisa login
  users: [
    { id: "u1", name: "Sam", role: "owner", outlet: null },
    { id: "u2", name: "Admin NF3", role: "admin", outlet: null },
    { id: "u3", name: "Kasir KBU", role: "kasir", outlet: "KBU" },
    { id: "u4", name: "Kasir KSM", role: "kasir", outlet: "KSM" },
    { id: "u5", name: "Kasir SMT", role: "kasir", outlet: "SMT" },
    { id: "u6", name: "Purchasing", role: "purchasing", outlet: null },
  ],
  profile: { name: "Nf3", type: "Usaha", currency: "IDR", theme: "light", email: "sampriatna@gmail.com", pin: "aktif", biometric: true },
  automation: { autoImport: true, replyNotif: true, revisionAlertSound: true },
  notificationPrefs: hydrateNotificationPrefs(null),
  wallets: NF_FNB_WALLETS.map((w) => ({ ...w })),
  categories: [
    { id: "ci1", name: "Penjualan Makanan", type: "in", active: true, role: null },
    { id: "ci2", name: "Penjualan Minuman", type: "in", active: true, role: null },
    { id: "ci3", name: "Takeaway / Grab", type: "in", active: true, role: null },
    { id: "ci_tunai", name: "Penjualan Tunai", type: "in", active: true, role: "kasir" },
    { id: "ci_qris_bca", name: "Penjualan QRIS BCA", type: "in", active: true, role: null },
    { id: "ci_qris_bri", name: "Penjualan QRIS BRI", type: "in", active: true, role: null },
    { id: "ci_gojek", name: "Penjualan Gojek", type: "in", active: true, role: null },
    { id: "ci4", name: "Modal Masuk", type: "in", active: true, role: null },
    { id: "ci5", name: "Lain-lain", type: "in", active: true, role: null },
    { id: "cp1", name: "Bahan Baku", type: "out", active: true, role: "purchasing", icon: "shopping-bag", color: "#1D9E75", sort: 1, accounting_group: "hpp", description: "Ayam, beras, sayur, bumbu, susu, kopi, minyak. Bisa habis untuk membuat menu." },
    { id: "cp2", name: "Kemasan", type: "out", active: true, role: "purchasing", icon: "box", color: "#0F6E56", sort: 2, accounting_group: "hpp", description: "Cup, mangkuk, plastik, paper bag, sendok takeaway. Dipakai membungkus pesanan." },
    { id: "cp3", name: "Gas LPG", type: "out", active: true, role: "purchasing", icon: "flame", color: "#D85A30", sort: 3, accounting_group: "hpp", description: "Pembelian tabung gas LPG untuk memasak." },
    { id: "cp4", name: "Listrik, Air & Internet", type: "out", active: true, role: "purchasing", icon: "bolt", color: "#378ADD", sort: 4, accounting_group: "beban_operasional", description: "Tagihan listrik, air, WiFi, token listrik." },
    { id: "cp5", name: "Gaji & Upah", type: "out", active: true, role: "purchasing", icon: "users", color: "#085041", sort: 5, accounting_group: "beban_operasional", description: "Gaji staf, upah harian, tunjangan." },
    { id: "cp6", name: "Sewa Tempat", type: "out", active: true, role: "purchasing", icon: "building", color: "#5F5E5A", sort: 6, accounting_group: "beban_operasional", description: "Sewa ruko, kontrakan outlet, sewa tempat usaha." },
    { id: "cp7", name: "Kebutuhan Operasional", type: "out", active: true, role: "purchasing", icon: "settings", color: "#7F77DD", sort: 7, accounting_group: "beban_operasional", description: "Sabun, tisu, alat kebersihan, ATK, galon, kebutuhan outlet sehari-hari." },
    { id: "cp8", name: "Transport & Ongkos Belanja", type: "out", active: true, role: "purchasing", icon: "truck", color: "#BA7517", sort: 8, accounting_group: "beban_operasional", description: "Bensin, parkir, ongkir, ongkos mengambil barang." },
    { id: "cp9", name: "Peralatan & Perbaikan", type: "out", active: true, role: "purchasing", icon: "tools", color: "#993C1D", sort: 9, accounting_group: "beban_operasional", description: "Pisau, baskom, gelas, kabel, servis kompor, servis keran. Barang kecil dipakai berulang." },
    { id: "cp10", name: "Promosi", type: "out", active: true, role: "purchasing", icon: "speakerphone", color: "#D4537E", sort: 10, accounting_group: "beban_operasional", description: "Iklan, cetak banner, endorse, diskon promosi." },
    { id: "cp11", name: "Pembelian Aset", type: "out", active: true, role: "purchasing", icon: "device-laptop", color: "#534AB7", sort: 11, accounting_group: "aset", description: "Kulkas, freezer, AC, mesin kopi, laptop, tablet, meja besar. Barang mahal dan tahan lama." },
    { id: "cp12", name: "Keperluan Owner", type: "out", active: true, role: "purchasing", icon: "user", color: "#888780", sort: 12, accounting_group: "pribadi", description: "Pengambilan atau pembelian untuk kebutuhan pribadi owner. Bukan biaya usaha." },
    { id: "cp13", name: "Lain-lain", type: "out", active: true, role: "purchasing", icon: "dots", color: "#B4B2A9", sort: 13, accounting_group: "lain", description: "Wajib isi keterangan di kolom catatan." },
  ],
  transactions: [],
  dailyReports: [],
  sdmReports: [],
  voidLogs: [],
  outletConfig: defaultOutletConfig(),
  reportChannels: hydrateReportChannels(null),
  reportUi: hydrateReportUi(null),
  hiddenInsights: [],
  pairCode: "WARUNG-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
  rawInbox: [],
  staffMessages: [],
  sosmedReports: [],
  sosmedConfig: defaultSosmedConfig(),
});

// Validasi floor sebelum simpan transaksi keluar (PayLater/hutang boleh minus)
const isPaylaterWallet = (w) => w?.type === "paylater" || w?.liability === true;
const walletAllowNegative = (w) => isPaylaterWallet(w) || w?.allowNegative === true;

const formatWalletBal = (w, bal, cur, user) => walletBalanceDisplay(w, bal, cur, user, fmtMoney) ?? "—";

function patchPurchasingWallet(w) {
  if (!w) return w;
  const out = { ...w };
  if (out.id === "w_kas_kecil" && /kas\s*kecil\s*purchasing/i.test(out.name || "")) {
    out.name = "Kas Kecil Dodi";
  }
  const kasKecilName = /kas\s*kecil/i.test(w.name || "");

  if (PURCHASING_WALLET_IDS.has(w.id) || w.purchasingUse === true || kasKecilName) {
    out.purchasingUse = true;
  }
  if (w.type === "paylater" || w.liability === true || w.id === "w_shopee_paylater" || w.id === "w_fish_shopee_paylater") {
    out.type = out.type || "paylater";
    out.liability = true;
    out.allowNegative = true;
  }
  if (w.type === "rekening" && w.id !== "w_owner") {
    out.hide_balance = out.hide_balance ?? true;
  }
  return out;
}

const checkFloor = (walletId, amount, wallets, transactions, user) => {
  const w = wallets.find(x => x.id === walletId);
  if (!w || walletAllowNegative(w)) return null;
  // Shared bank: saldo di FNB; purchasing dapat mirror balance=null → jangan anggap 0 di klien.
  if (isSharedWallet(w)) return null;
  const bal = walletBalance(walletId, wallets, transactions);
  const hidden = shouldHideWalletBalance(w, user);
  if (!w.floor && bal - amount < 0) {
    return hidden
      ? `Saldo ${w.name} tidak cukup untuk transaksi ini.`
      : `Saldo tidak cukup. Saldo saat ini: ${new Intl.NumberFormat("id-ID").format(bal)}`;
  }
  if (!w.floor) return null;
  if (bal - amount < w.floor) {
    return hidden
      ? `Saldo ${w.name} tidak cukup untuk transaksi ini.`
      : `Saldo tidak cukup. Minimum saldo: ${new Intl.NumberFormat("id-ID").format(w.floor)} · Saldo saat ini: ${new Intl.NumberFormat("id-ID").format(bal)}`;
  }
  return null;
};

/** Gabung dompet default + patch flag purchasing (BCA/BRI/Mandiri/BNI dll). */
function mergeWallets(defaults, saved, { mode = "canonical" } = {}) {
  if (mode === "saved-only") {
    return sortWallets((saved || []).map((w) => patchPurchasingWallet({ ...w })));
  }
  const savedList = saved || [];
  const byId = new Map(savedList.map((w) => [w.id, w]));
  const merged = (defaults || []).map((def) => {
    const ex = byId.get(def.id);
    if (!ex) return patchPurchasingWallet({ ...def });
    return patchPurchasingWallet({
      ...def,
      ...ex,
      logoUrl: ex.logoUrl ?? def.logoUrl ?? null,
      sort: ex.sort ?? def.sort ?? null,
      purchasingUse: def.purchasingUse === true ? true : (ex.purchasingUse ?? def.purchasingUse ?? false),
      hide_balance: def.hide_balance === true ? true : (ex.hide_balance ?? def.hide_balance ?? false),
      liability: ex.liability ?? def.liability ?? false,
      allowNegative: ex.allowNegative ?? def.allowNegative ?? false,
      type: ex.type || def.type,
    });
  });
  const defaultIds = new Set((defaults || []).map((d) => d.id));
  savedList.filter((w) => !defaultIds.has(w.id)).forEach((w) => merged.push(patchPurchasingWallet(w)));
  if (mode === "canonical") return patchWalletCatalog(merged);
  return patchWalletCatalog(sortWallets(merged));
}

async function loadState(bizId, { businessType, business } = {}) {
  const saved = await loadAppState(bizId);
  if (saved && Object.keys(saved).length) {
    const { _cloudUpdatedAt, currentUser: _cu, users: _u, ...savedClean } = saved;
    const base = defaultState();
    const walletSetup = savedClean.walletSetup || saved.walletSetup || null;
    const resolvedType = walletSetup?.businessType || savedClean.profile?.businessType || saved.profile?.businessType || businessType;
    const isFnb = bizId === CANONICAL_BUSINESS_ID || resolvedType === "fnb";
    const mergeMode = resolveWalletMergeMode(bizId, savedClean);
    const catalog = getWalletCatalogForBusiness(bizId, resolvedType);
    const savedWalletList = (savedClean.wallets || saved.wallets || []).filter(
      (w) => isFnb || !isFnBOnlyWallet(w)
    );
    const mergedWallets = mergeWallets(
      mergeMode === "saved-only" ? [] : catalog,
      savedWalletList,
      { mode: mergeMode }
    );
    const wallets = rebuildWalletsWithShared(mergedWallets, walletSetup);
    const txs = dedupeTransactionsById(savedClean.transactions || saved.transactions || []);
    const savedProfile = savedClean.profile || saved.profile || {};
    const savedCats = savedClean.categories || saved.categories || [];
    const nfCtx = { wallets, categories: savedCats, walletSetup, profile: savedProfile };
    const bizCtx = business || { type: resolvedType, name: savedProfile?.name, slug: business?.slug };
    let isFishing = !isFnb && isNfFishingBusiness(bizCtx, nfCtx);
    let categories = isFnb
      ? ensurePurchasingCategories(
          cleanCategoryList(mergeCategoriesFromDb(base.categories, savedCats)),
          cleanCategoryList
        )
      : cleanCategoryList(
          resolveCategoriesForBusiness(savedCats, bizCtx, nfCtx) || []
        );
    if (!isFnb && isFishing && needsNfChannelUpgrade(categories)) {
      categories = cleanCategoryList(ensureNfFishingCategories(categories));
    }
    const categoriesUpgraded = isFishing && needsNfChannelUpgrade(savedCats) && !needsNfChannelUpgrade(categories);

    let nfTransactions = txs;
    let nfTxChanged = false;
    let mpMigStats = undefined;
    let loadedMpStores = null;
    if (isFishing) {
      const nfTx = remapNfTransactions(txs);
      nfTransactions = nfTx.transactions;
      nfTxChanged = nfTx.changed;
      loadedMpStores = hydrateMpStores(savedClean.mpStores || saved.mpStores);
      const mpMig = migrateLegacyMpIncomeTransactions(nfTransactions, { mpStores: loadedMpStores });
      if (mpMig.changed) {
        nfTransactions = mpMig.transactions;
        nfTxChanged = true;
        mpMigStats = mpMig.stats;
      }
    }
    return {
      ...base,
      ...savedClean,
      _cloudUpdatedAt,
      _cloudLoaded: true,
      walletSetup,
      wallets,
      categories,
      transactions: nfTransactions,
      _nfTxRemapped: nfTxChanged || undefined,
      _nfMpMigrationStats: mpMigStats,
      _nfCategoriesUpgraded: categoriesUpgraded || undefined,
      profile: { ...base.profile, ...(savedClean.profile || saved.profile) },
      automation: { ...base.automation, ...(savedClean.automation || saved.automation) },
      dailyReports: savedClean.dailyReports || saved.dailyReports || base.dailyReports,
      sdmReports: savedClean.sdmReports || saved.sdmReports || base.sdmReports,
      voidLogs: savedClean.voidLogs || saved.voidLogs || base.voidLogs,
      staffMessages: savedClean.staffMessages || saved.staffMessages || base.staffMessages,
      notificationPrefs: hydrateNotificationPrefs(savedClean.notificationPrefs || saved.notificationPrefs || base.notificationPrefs),
      sosmedReports: savedClean.sosmedReports || saved.sosmedReports || base.sosmedReports,
      sosmedConfig: hydrateSosmedConfig(savedClean.sosmedConfig || saved.sosmedConfig),
      outletConfig: hydrateOutletConfig({ ...base.outletConfig, ...(savedClean.outletConfig || saved.outletConfig || {}) }),
      reportChannels: migrateReportChannelSettles(hydrateReportChannels(savedClean.reportChannels || saved.reportChannels)),
      reportUi: hydrateReportUi(savedClean.reportUi || saved.reportUi),
      ...(isFishing ? { mpStores: loadedMpStores ?? hydrateMpStores(savedClean.mpStores || saved.mpStores) } : {}),
      hiddenInsights: Array.isArray(savedClean.hiddenInsights)
        ? savedClean.hiddenInsights
        : (Array.isArray(saved.hiddenInsights) ? saved.hiddenInsights : base.hiddenInsights),
      rawInbox: stripDemoInbox(savedClean.rawInbox ?? saved.rawInbox ?? base.rawInbox),
    };
  }
  return { ...defaultState(), _cloudLoaded: true };
}
async function saveState(bizId, s) {
  const { currentUser, users, _systemThemeTick, _cloudUpdatedAt, _cloudLoaded, ...data } = s || {};
  if (data.categories) data.categories = cleanCategoryList(data.categories);
  return saveAppState(bizId, data);
}

/** Identitas login — satu-satunya sumber permission (bukan state tersimpan). */
function sessionUser(authUser) {
  if (!authUser?.id) return { id: "", name: "", role: "kasir", outlet: null };
  const resolved = resolveAuthMembership({
    role: authUser.role,
    outlet: authUser.outlet,
    email: authUser.email,
  });
  return {
    id: authUser.id,
    name: authUser.name,
    email: authUser.email || null,
    role: resolved.role,
    outlet: resolved.outlet,
  };
}

function withReconciledReports(doc) {
  if (!doc) return doc;
  let dailyReports = reconcileDailyReports(doc.dailyReports || [], doc.transactions || []);
  dailyReports = applyRevisionNoticesFromMessages(dailyReports, doc.staffMessages);
  const prev = doc.dailyReports || [];
  const changed =
    dailyReports.length !== prev.length
    || dailyReports.some((r, i) => r.status !== prev[i]?.status || r.revisionNote !== prev[i]?.revisionNote);
  return changed ? { ...doc, dailyReports } : { ...doc, dailyReports };
}

function withSessionUser(s, authUser) {
  if (!s) return s;
  return { ...withReconciledReports(s), currentUser: sessionUser(authUser) };
}

// ─── Inbox: demo strip + paste parser ───────────────────────
const DEMO_INBOX_IDS = new Set(["n1", "n2", "n3", "n4"]);

function isDemoInboxItem(n) {
  if (!n) return false;
  if (DEMO_INBOX_IDS.has(n.id)) return true;
  const title = (n.title || "").toLowerCase();
  return n.src === "ShopeePay" && (
    title.includes("raih koin") || title.includes("bonus s.d") || title.includes("canva pro gratis")
  );
}

function stripDemoInbox(rawInbox) {
  return (rawInbox || []).filter(n => !isDemoInboxItem(n));
}

const NOTIF_SRC_RULES = [
  { re: /shopee\s*pay|shopeepay|seller center/i, src: "ShopeePay" },
  { re: /gojek|gopay|go\s*food/i, src: "GoPay" },
  { re: /grab/i, src: "GrabPay" },
  { re: /bca|klikbca|mybca/i, src: "BCA" },
  { re: /bri|brimo/i, src: "BRI" },
  { re: /mandiri|livin/i, src: "Mandiri" },
  { re: /bni/i, src: "BNI" },
  { re: /dana\b/i, src: "DANA" },
  { re: /ovo\b/i, src: "OVO" },
];

function detectNotifSrc(text) {
  for (const { re, src } of NOTIF_SRC_RULES) {
    if (re.test(text)) return src;
  }
  return "Notifikasi";
}

function parsePastedNotif(raw) {
  const text = (raw || "").trim();
  if (!text) return null;
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const src = detectNotifSrc(text);
  let title = lines[0] || text.slice(0, 100);
  let body = lines.length > 1 ? lines.slice(1).join(" · ") : text;
  if (lines.length > 1 && lines[0].length <= 24 && NOTIF_SRC_RULES.some(r => r.re.test(lines[0]))) {
    title = lines[1] || lines[0];
    body = lines.slice(2).join(" · ") || lines.slice(1).join(" · ");
  }
  return {
    id: "n" + Date.now() + Math.random().toString(36).slice(2, 5),
    src,
    title,
    body,
  };
}

function walletForNotifSrc(src, wallets) {
  const s = (src || "").toLowerCase();
  const map = [
    [/shopee/, "w_shopeepay"],
    [/gojek|gopay|go pay/, "w_gojek"],
    [/grab/, "w_nf"],
    [/bca/, "w_bca"],
    [/bri/, "w_bri"],
    [/mandiri/, "w_mandiri"],
    [/bni/, "w_bni"],
  ];
  for (const [re, id] of map) {
    if (re.test(s)) {
      const w = wallets.find(x => x.id === id && x.active !== false);
      if (w) return w;
    }
  }
  return wallets.find(w => w.active !== false) || wallets[0];
}

// ─── Classifier ────────────────────────────────────────────
const SPAM = ["raih koin","kumpulkan","bonus s.d","gratis","voucher","diskon","promo","flash sale","klaim","hadiah","s.d.","kupon","berhadiah"];
const REAL = ["saldo penjual diperbarui","pesanan","telah selesai","pembayaran berhasil","transfer berhasil","dana masuk","pencairan","withdraw","topup berhasil","settlement","diterima dari"];
function classifyNotif(n) {
  const t = (n.title + " " + n.body).toLowerCase();
  const amt = Math.max(0, ...[...t.matchAll(/rp\s*([0-9][0-9.,]*)/gi)].map(m => parseInt(m[1].replace(/[.,]/g, ""), 10)).filter(Boolean));
  let score = 0;
  SPAM.forEach(h => { if (t.includes(h)) score -= 2; });
  REAL.forEach(h => { if (t.includes(h)) score += 3; });
  if (/pesanan\s+[a-z0-9]{8,}/i.test(t)) score += 2;
  if (amt > 0 && amt < 5) score -= 3;
  return { amount: amt, score, verdict: score >= 3 ? "legit" : "promo" };
}

// ─── AI helpers ────────────────────────────────────────────
async function aiParseText(text, cats) {
  // Diproses di server route /api/parse — ANTHROPIC_API_KEY tetap di server.
  return aiParse({ mode: "text", text, categories: cats });
}
async function aiParseReceipt(b64, mime, cats) {
  return aiParse({ mode: "receipt", image: b64, media: mime, categories: cats });
}

// ─── Primitives ────────────────────────────────────────────
const Card = ({ children, style, className = "", onClick }) => (
  <div onClick={onClick} style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, ...style }} className={className}>{children}</div>
);
const Pill = ({ children, active, onClick, color, compact, fullWidth }) => (
  <button onClick={onClick} style={{ padding: compact ? "6px 10px" : "8px 14px", borderRadius: 999, fontSize: compact ? 12 : 13, fontWeight: 600, border: active ? "none" : "1px solid var(--line)", background: active ? (color || "var(--brand)") : "var(--surface)", color: active ? "#fff" : "var(--ink2)", display: "inline-flex", alignItems: "center", justifyContent: fullWidth ? "center" : "flex-start", gap: 6, whiteSpace: "nowrap", cursor: "pointer", width: fullWidth ? "100%" : undefined, flexShrink: 0, overflow: fullWidth ? "hidden" : undefined, textOverflow: fullWidth ? "ellipsis" : undefined, lineHeight: 1.25, WebkitTapHighlightColor: "transparent" }}>
    {color && !active && <span style={{ width: 7, height: 7, borderRadius: 99, background: color, display: "inline-block", flexShrink: 0 }} />}{children}
  </button>
);

function FilterChipRow({ label, children, style }) {
  return (
    <div style={{ padding: "6px 16px", ...style }}>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)", marginBottom: 6, letterSpacing: "0.04em" }}>
          {label}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

const manualFieldInput = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 14,
  color: "var(--ink)",
  outline: "none",
  minWidth: 0,
};

function CatChip({ children, active, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "1 1 calc(50% - 4px)",
        maxWidth: "calc(50% - 4px)",
        minWidth: 0,
        padding: "10px 8px",
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.35,
        whiteSpace: "normal",
        wordBreak: "break-word",
        textAlign: "center",
        border: active ? "none" : "1px solid var(--line)",
        background: active ? color : "var(--surface)",
        color: active ? "#fff" : "var(--ink2)",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}
const Tog = ({ on, onToggle }) => (
  <button onClick={onToggle} style={{ width: 48, height: 28, borderRadius: 999, background: on ? "var(--brand)" : "var(--line)", padding: 3, display: "flex", alignItems: "center", justifyContent: on ? "flex-end" : "flex-start", border: "none", cursor: "pointer", transition: "background .2s", flexShrink: 0 }}>
    <span style={{ width: 22, height: 22, borderRadius: 999, background: "#fff", display: "block" }} />
  </button>
);
const Lbl = ({ children }) => <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand)", marginBottom: 10 }}>{children}</div>;

function Sheet({ title, onClose, children }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 1000, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", background: "var(--surface)", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 99, background: "var(--surface2)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "var(--ink)" }}><ArrowLeft size={18} /></button>
        <span style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>{title}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }} className="scroll-hide">{children}</div>
    </div>
  );
}

function ShareWaBtn({ text, phone, label = "Bagikan ke WhatsApp", compact, style: extraStyle }) {
  if (!text) return null;
  return (
    <button type="button" onClick={() => openWhatsAppShare(text, phone)}
      style={{
        width: compact ? "auto" : "100%",
        marginTop: compact ? 0 : 10,
        padding: compact ? "8px 12px" : "13px 14px",
        borderRadius: compact ? 10 : 14,
        border: "none",
        background: "#25D366",
        color: "#fff",
        fontWeight: 700,
        fontSize: compact ? 12 : 14,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        ...extraStyle,
      }}>
      <Share2 size={compact ? 14 : 18} />
      {label}
    </button>
  );
}

const catIconMap = { "Bahan Baku": ShoppingCart, "Gaji & Upah": Users, "Operasional": Zap, "Penjualan": Store, "Modal Masuk": PiggyBank, "Listrik & Internet": Zap };
const getCatIcon = (cat) => catIconMap[cat?.name] || MoreHorizontal;

/** Klasifikasi visual transaksi omset: tunai, QRIS, digital, geser laci. */
function resolveTxVisual(tx, cat, wallets) {
  const desc = (tx.desc || "").toLowerCase();
  const catName = (cat?.name || "").toLowerCase();
  const ch = (tx.reportChannelId || "").toLowerCase();
  const blob = `${desc} ${catName} ${ch}`;

  if (tx.type === "transfer") {
    const from = (wallets || []).find(w => w.id === tx.fromWalletId);
    const to = (wallets || []).find(w => w.id === tx.toWalletId);
    const fromLaci = /laci/i.test(from?.name || "") || /^w_laci_/.test(tx.fromWalletId || "");
    const toKasBesar = /kas besar/i.test(to?.name || "") || tx.toWalletId === "w_kas_besar";
    if (fromLaci && toKasBesar || /setoran tunai|geser laci|→ kas besar/i.test(desc)) {
      return { kind: "laci", bg: "#EDE9FE", color: "#6D28D9", badge: "Laci" };
    }
    return { kind: "transfer", bg: "var(--brand-soft)", color: "var(--brand)", badge: "Trf" };
  }

  if (tx.type === "in") {
    if (/omset tunai|penjualan tunai/.test(blob) || (/\btunai\b/.test(blob) && !/qris|gojek|online|shopee|grab|edc|debit/.test(blob))) {
      return { kind: "cash", bg: "#DCFCE7", color: "#15803D", badge: "Tunai" };
    }
    if (/qris|edc|debit/.test(blob)) {
      if (/bri|debit bri|edc bri/.test(blob)) return { kind: "qris", bg: "#FEE2E2", color: "#DC2626", badge: "BRI" };
      if (/bca|edc bca|mandiri/.test(blob)) return { kind: "qris", bg: "#DBEAFE", color: "#1D4ED8", badge: "BCA" };
      return { kind: "qris", bg: "#EEF2FF", color: "#4338CA", badge: "QRIS" };
    }
    if (/shopee|shopefood/.test(blob)) return { kind: "digital", bg: "#FFEDD5", color: "#EA580C", badge: "Shopee" };
    if (/gojek|gofood|ojek/.test(blob)) return { kind: "digital", bg: "#DCFCE7", color: "#00AA13", badge: "Gojek" };
    if (/grab/.test(blob)) return { kind: "digital", bg: "#D1FAE5", color: "#00B14F", badge: "Grab" };
    if (/online/.test(blob)) return { kind: "digital", bg: "#E0F2FE", color: "#0284C7", badge: "Online" };
  }

  const isIn = tx.type === "in";
  return { kind: "default", bg: isIn ? "var(--in-soft)" : "var(--out-soft)", color: isIn ? "var(--in-text)" : "var(--out-text)", cat };
}

function TxRowIcon({ visual, size = 40 }) {
  const { kind, bg, color, badge, cat } = visual;
  const shell = {
    width: size, height: size, borderRadius: 12, background: bg, flexShrink: 0,
    display: "grid", placeItems: "center", border: `1.5px solid ${color}28`,
  };

  if (kind === "qris") {
    return (
      <div style={shell} title={`QRIS ${badge}`}>
        <div style={{ textAlign: "center", lineHeight: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 900, color, letterSpacing: "-0.04em" }}>QR</div>
          <div style={{ fontSize: 7, fontWeight: 800, color, opacity: 0.9, marginTop: 1 }}>{badge === "QRIS" ? "IS" : badge}</div>
        </div>
      </div>
    );
  }
  if (kind === "digital") {
    return (
      <div style={shell} title={badge}>
        <div style={{ fontSize: badge.length > 5 ? 9 : 10, fontWeight: 900, color, letterSpacing: "-0.03em", textAlign: "center", padding: "0 2px" }}>
          {badge}
        </div>
      </div>
    );
  }
  if (kind === "cash") {
    return (
      <div style={shell} title="Omset tunai">
        <Banknote size={19} color={color} strokeWidth={2.2} />
      </div>
    );
  }
  if (kind === "laci") {
    return (
      <div style={shell} title="Geser laci → Kas Besar">
        <ArrowLeftRight size={19} color={color} strokeWidth={2.2} />
      </div>
    );
  }

  const Ic = kind === "transfer" ? RefreshCw : getCatIcon(cat);
  return (
    <div style={{ ...shell, border: "none", color }}>
      <Ic size={16} />
    </div>
  );
}

function WalletIcon({ wallet, size = 40 }) {
  const r = Math.round(size * 0.3);
  if (walletHasLogo(wallet)) {
    return (
      <div style={{
        width: size, height: size, borderRadius: r, overflow: "hidden", flexShrink: 0,
        background: (wallet.color || "#6366F1") + "18",
        border: `1.5px solid ${(wallet.color || "#6366F1")}33`,
        boxShadow: "0 1px 4px rgba(0,0,0,.06)",
      }}>
        <img src={wallet.logoUrl} alt="" loading="lazy" decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flexShrink: 0,
      background: (wallet?.color || "#6366F1") + "22",
      display: "grid", placeItems: "center", color: wallet?.color || "#6366F1",
    }}>
      <Wallet size={Math.round(size * 0.45)} />
    </div>
  );
}

function DailyTaskRow({ step, title, subtitle, done, blocked, urgent, count, optional, onClick, actionLabel: actionLabelProp = null }) {
  const rowClass = [
    "task-row-inner",
    done ? "task-row-done" : urgent ? "task-row-urgent" : !blocked && !optional ? "task-row-pending" : "",
  ].filter(Boolean).join(" ");
  const badgeLabel = done ? "Selesai" : blocked ? "Tunggu" : urgent ? (count ? `${count} perlu` : "Perlu aksi") : optional ? "Opsional" : "Belum";
  const badgeBg = done ? "var(--in-soft)" : blocked ? "var(--surface2)" : urgent ? "#FEE2E2" : optional ? "var(--surface2)" : "#FEF3C7";
  const badgeColor = done ? "var(--in-text)" : blocked ? "var(--ink3)" : urgent ? "var(--out-text)" : optional ? "var(--ink3)" : "#B45309";
  const actionLabel = actionLabelProp || (done ? "Lihat" : urgent ? "Proses" : optional ? "Buka" : "Isi");

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={blocked}
      style={{
        width: "100%",
        padding: "14px 14px 14px 12px",
        borderRadius: 16,
        border: done ? "1px solid var(--line)" : urgent ? "2px solid #F59E0B" : optional ? "1px dashed var(--line)" : "2px solid var(--brand)",
        background: done ? "var(--surface)" : urgent ? "var(--amber-soft)" : optional ? "var(--surface2)" : "var(--brand-soft)",
        cursor: blocked ? "not-allowed" : "pointer",
        textAlign: "left",
        opacity: blocked ? 0.55 : done ? 0.92 : 1,
        boxShadow: done || optional ? "none" : urgent ? undefined : "0 2px 12px rgba(99,102,241,.12)",
        transition: "transform .15s ease, opacity .25s ease",
      }}
      className={done ? "task-row-done" : urgent ? "task-row-urgent" : !blocked && !optional ? "task-row-pending" : undefined}
      onMouseDown={e => { if (!blocked) e.currentTarget.style.transform = "scale(0.985)"; }}
      onMouseUp={e => { e.currentTarget.style.transform = ""; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
    >
      <div className={rowClass}>
        <div
          className={done ? "task-check-pop" : undefined}
          style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: done ? "var(--in-soft)" : urgent ? "#F59E0B" : optional ? "var(--line)" : "var(--brand)",
            color: done ? "var(--in-text)" : optional ? "var(--ink3)" : "#fff",
            display: "grid", placeItems: "center", fontWeight: 800, fontSize: done ? 18 : 15,
          }}
        >
          {done ? <Check size={20} strokeWidth={3} /> : optional ? "★" : step}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "var(--ink)", lineHeight: 1.3, flex: 1, minWidth: 0 }}>{title}</div>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.02em",
              padding: "3px 8px", borderRadius: 99, background: badgeBg, color: badgeColor,
              whiteSpace: "nowrap", flexShrink: 0, marginTop: 1,
            }}>
              {badgeLabel}
            </span>
          </div>
          <div style={{ fontSize: 12, color: done ? "var(--ink3)" : "var(--ink2)", marginTop: 4, lineHeight: 1.45 }}>{subtitle}</div>
        </div>
        {!blocked && (
          <span style={{ fontSize: 12, fontWeight: 700, color: done ? "var(--ink3)" : urgent ? "#B45309" : "var(--brand)", display: "flex", alignItems: "center", gap: 2, flexShrink: 0, alignSelf: "center" }}>
            {actionLabel} <ChevronRight size={14} />
          </span>
        )}
      </div>
    </button>
  );
}

function RoleDailyChecklist({ tasks, accentGradient, headerLabel = "Checklist Harian", headerHint }) {
  const activeTasks = tasks.filter(t => !t.optional);
  const doneCount = activeTasks.filter(t => t.done).length;
  const total = activeTasks.length;
  const allDone = total > 0 && doneCount === total;
  const urgentCount = activeTasks.filter(t => !t.done && t.urgent).length;
  const pendingCount = total - doneCount;

  const statusLine = allDone
    ? "Semua tugas selesai ✓"
    : urgentCount > 0
      ? `${urgentCount} perlu ditindaklanjuti`
      : `${pendingCount} tugas belum selesai`;

  return (
    <div style={{ padding: "0 16px", marginBottom: 16 }}>
      <div style={{
        borderRadius: 20, padding: "16px 16px 14px", marginBottom: 12,
        background: accentGradient || "linear-gradient(135deg,#6366F1,#4F46E5)",
        color: "#fff",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.85 }}>{headerLabel}</div>
            <div style={{ fontWeight: 800, fontSize: 17, marginTop: 4, lineHeight: 1.3 }}>{statusLine}</div>
            {headerHint && <div style={{ fontSize: 11, opacity: 0.78, marginTop: 5, lineHeight: 1.4 }}>{headerHint}</div>}
          </div>
          {total > 0 && (
            <div style={{
              minWidth: 44, height: 44, borderRadius: 14, flexShrink: 0,
              background: allDone ? "rgba(74,222,128,.35)" : "rgba(255,255,255,.18)",
              display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15,
              transition: "background .3s",
            }}>
              {doneCount}/{total}
            </div>
          )}
        </div>
        {total > 0 && (
          <div style={{ marginTop: 12, height: 5, borderRadius: 99, background: "rgba(255,255,255,.25)", overflow: "hidden" }}>
            <div
              className="task-progress-fill"
              style={{
                width: `${(doneCount / total) * 100}%`, height: "100%",
                background: allDone ? "#4ADE80" : "#fff", borderRadius: 99,
                transition: "width .45s ease, background .3s",
                ["--prog"]: `${(doneCount / total) * 100}%`,
              }}
            />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tasks.map((t, i) => {
          const step = t.optional ? "★" : tasks.slice(0, i).filter(x => !x.optional).length + 1;
          return <DailyTaskRow key={t.id} step={step} {...t} />;
        })}
      </div>
    </div>
  );
}

// ─── Konteks bisnis (F&B vs e-commerce) ───────────────────
function BusinessContextBanner({ business, businesses, switchBusiness, features, user }) {
  const canonical = findCanonicalInList(businesses || []);
  const multi = (businesses?.length || 0) > 1;
  // Hanya owner (yang juga anggota F&B) yang boleh pindah ke Nusa Food dari Fishing.
  // Staf NF (admin/purchasing) tidak saling terhubung ke FNB.
  const canSwitchToFnb = user?.role === "owner" && canonical && switchBusiness;

  if (features.isFnB) {
    if (!multi) return null;
    return (
      <div style={{ margin: "0 16px 12px", padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 11, color: "var(--ink2)", lineHeight: 1.4, textAlign: "center" }}>
        Punya bisnis lain? Ganti lewat tab <b style={{ color: "var(--brand)" }}>Atur</b>
      </div>
    );
  }

  return (
    <div style={{ margin: "0 16px 14px", padding: "12px 14px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: "#1D4ED8" }}>
        {resolveBusinessDisplayName(business)} · {features.label}
      </div>
      <div style={{ fontSize: 12, color: "#1E3A8A", marginTop: 6, lineHeight: 1.5 }}>
        {canSwitchToFnb
          ? (
            <>
              Anda sedang di bisnis <b>e-commerce/UMKM</b> — dompet kas & operasional terpisah dari resto.
              Hanya <b>rekening bank</b> yang boleh dihubungkan antar bisnis; NF Cash & laci outlet hanya di {CANONICAL_DISPLAY_NAME}.
            </>
          )
          : (
            <>
              Akun staf <b>NF Nusa Fishing</b> — dompet & transaksi hanya untuk bisnis ini, terpisah dari resto {CANONICAL_DISPLAY_NAME}.
            </>
          )}
      </div>
      {canSwitchToFnb && (
        <button
          type="button"
          onClick={() => switchBusiness(canonical.id)}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "none",
            background: "#2563EB",
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Buka {CANONICAL_DISPLAY_NAME} (F&B)
        </button>
      )}
    </div>
  );
}

function FnbGateSheet({ target, onClose, onSwitch, canonicalName, canSwitch }) {
  return (
    <Sheet title="Fitur khusus Nusa Food" onClose={onClose}>
      <div style={{ padding: "8px 4px 24px", fontSize: 14, lineHeight: 1.55, color: "var(--ink2)" }}>
        <p style={{ margin: "0 0 12px" }}>
          <b>{fnbFeatureLabel(target)}</b> hanya untuk resto F&B (KBU, KSM, SMT) — bukan untuk bisnis e-commerce/UMKM yang sedang aktif.
        </p>
        {canSwitch ? (
          <>
            <p style={{ margin: "0 0 16px" }}>
              Pindah ke <b>{canonicalName || CANONICAL_DISPLAY_NAME}</b> untuk settle omset, purchasing resto, atau tugas outlet.
            </p>
            <button
              type="button"
              onClick={onSwitch}
              style={{
                width: "100%",
                padding: "13px 14px",
                borderRadius: 12,
                border: "none",
                background: "var(--brand)",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Pindah ke {canonicalName || CANONICAL_DISPLAY_NAME}
            </button>
          </>
        ) : (
          <p style={{ margin: "0 0 8px" }}>
            Akun ini hanya untuk bisnis yang sedang aktif — tidak terhubung ke Nusa Food (F&B).
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ─── Beranda ───────────────────────────────────────────────
function Beranda({ s, setTab, setOverlay, onOpenLaporan, hide, setHide, onCloudSync, onRecoverPending, cloudSyncState, syncInfo, realtimeLive, bizId, session, businessDisplayName, onCatat, business, businesses, switchBusiness, features, onOpenWalletHistory, sharedMirror, sharedTxByWallet }) {
  const cur = s.profile.currency;
  const prefix = today().slice(0, 7);
  const user = s.currentUser || { role: "kasir" };
  const myWallets = useMemo(() => visibleWalletsForBusiness(s.wallets, user, business), [s.wallets, user, business]);
  const purchasingArea = user.role === "purchasing" && user.outlet && !["KBU", "KSM", "SMT"].includes(user.outlet)
    ? String(user.outlet)
    : "";
  const assignedWallets = useMemo(
    () => (myWallets || []).filter((w) => Array.isArray(w?.allowedUserIds) && !!user?.id && w.allowedUserIds.includes(user.id)),
    [myWallets, user?.id]
  );
  const hasExplicitWalletAssignment = assignedWallets.length > 0;
  const areaWallet = useMemo(() => {
    if (hasExplicitWalletAssignment) {
      return assignedWallets.find((w) => w && w.type !== "rekening") || assignedWallets[0] || null;
    }
    if (!purchasingArea) return null;
    const area = purchasingArea.toLowerCase();
    return myWallets.find((w) => {
      if (!w || w.type === "rekening") return false;
      const idText = String(w.id || "").toLowerCase().replace(/^w_/, "").replace(/_/g, " ");
      const nameText = String(w.name || "").toLowerCase();
      return nameText.includes(area) || idText.includes(area);
    }) || null;
  }, [hasExplicitWalletAssignment, assignedWallets, purchasingArea, myWallets]);
  const isNfPurchasing = user.role === "purchasing" && !features?.purchasingModule;
  const primaryPurchasingWallet = useMemo(() => {
    if (user.role !== "purchasing") return null;
    if (areaWallet) return areaWallet;
    const opsShared = (myWallets || []).find(
      (w) => isSharedWallet(w) && w.sharedLink?.linkKind === "ops_share" && /uang\s*nf/i.test(w.name || "")
    );
    if (opsShared) return opsShared;
    const anySharedOps = (myWallets || []).find((w) => isSharedWallet(w) && w.sharedLink?.linkKind === "ops_share");
    if (anySharedOps) return anySharedOps;
    return myWallets.find((w) => w.purchasingUse || isNfPurchasingOpsWallet(w)) || myWallets[0] || null;
  }, [user.role, areaWallet, myWallets]);
  const orderedWallets = useMemo(() => {
    if (!(user.role === "purchasing" && areaWallet?.id)) return myWallets;
    const first = myWallets.find((w) => w.id === areaWallet.id);
    const rest = myWallets.filter((w) => w.id !== areaWallet.id);
    return first ? [first, ...rest] : myWallets;
  }, [user.role, areaWallet?.id, myWallets]);
  const localOrderedWallets = useMemo(() => {
    if (!isNfPurchasing) return orderedWallets;
    return orderedWallets.filter((w) => !isSharedWallet(w));
  }, [isNfPurchasing, orderedWallets]);
  const scopedTx = useMemo(() => {
    const local = visibleTransactionsForBusiness(s.transactions, s.wallets, user, business);
    const merged = mergeWithLocalTransactions(local, sharedTxByWallet);
    if (features.nfChannelFinance) {
      return scopedNfFinanceTransactions(local, sharedTxByWallet, s.categories, {
        businessId: bizId,
        role: user.role,
        userId: user.id,
      });
    }
    return merged;
  }, [s.transactions, s.wallets, s.categories, user, business, sharedTxByWallet, features.nfChannelFinance, bizId]);
  const summaryTx = useMemo(() => {
    if (user.role !== "purchasing") return scopedTx;
    const focusWalletId = areaWallet?.id || primaryPurchasingWallet?.id || null;
    if (focusWalletId) {
      const wid = focusWalletId;
      return (scopedTx || []).filter((t) => {
        if (t.type === "transfer") {
          const { from, to } = resolveTransferIds(t);
          return from === wid || to === wid;
        }
        return resolveWalletId(t) === wid;
      });
    }
    const sharedIds = new Set(
      (myWallets || [])
        .filter((w) => isSharedWallet(w) && w.sharedLink?.linkKind === "ops_share")
        .map((w) => w.id)
    );
    if (sharedIds.size) {
      return (scopedTx || []).filter((t) => sharedIds.has(resolveWalletId(t)));
    }
    return scopedTx;
  }, [scopedTx, user.role, areaWallet?.id, primaryPurchasingWallet?.id, myWallets]);
  const monthIn = useMemo(
    () => summaryTx.filter(t => t.type === "in" && t.date.startsWith(prefix)).reduce((a, b) => a + b.amount, 0),
    [summaryTx, prefix]
  );
  const monthOut = useMemo(
    () => summaryTx.filter(t => t.type === "out" && t.date.startsWith(prefix)).reduce((a, b) => a + b.amount, 0),
    [summaryTx, prefix]
  );
  const showNfOmzet = features.nfChannelFinance && canDo(user.role, "lihatLaporanPenuh");
  const nfMonthChannels = useMemo(() => {
    if (!showNfOmzet) return null;
    return computeNfChannelBreakdown(scopedTx, s.categories, { start: `${prefix}-01`, end: today() });
  }, [showNfOmzet, scopedTx, s.categories, prefix]);
  const nfMonthOut = useMemo(
    () => (scopedTx || []).filter((t) => t.type === "out" && t.date.startsWith(prefix)).reduce((a, b) => a + b.amount, 0),
    [scopedTx, prefix]
  );
  const nfMonthOutCount = useMemo(
    () => (scopedTx || []).filter((t) => t.type === "out" && t.date.startsWith(prefix)).length,
    [scopedTx, prefix]
  );
  const totalSaldo = useMemo(() => {
    if (user.role !== "purchasing") {
      return walletsForSaldoTotal(myWallets, user).reduce(
        (a, w) => a + walletBalance(w.id, s.wallets, s.transactions),
        0
      );
    }
    // Purchasing: hanya dompet belanja yang saldonya boleh dilihat (bukan rekening Sam).
    const visibleBal = walletsForSaldoTotal(myWallets, user);
    if (!visibleBal.length) return 0;
    const primary =
      (primaryPurchasingWallet && visibleBal.some((w) => w.id === primaryPurchasingWallet.id) ? primaryPurchasingWallet : null) ||
      visibleBal.find((w) => w.purchasingUse || isNfPurchasingOpsWallet(w)) ||
      visibleBal[0];
    return primary ? walletBalance(primary.id, s.wallets, s.transactions) : 0;
  }, [user.role, myWallets, s.wallets, s.transactions, primaryPurchasingWallet]);
  const inboxCount = canDo(user.role, "inputIncome") ? (s.rawInbox || []).length : 0;
  const notifCount = unreadStaffCount(s.staffMessages, user, s.dailyReports);
  const scopeLabel = user.role === "kasir"
    ? `Laci ${user.outlet}`
    : user.role === "purchasing"
      ? (primaryPurchasingWallet?.name || areaWallet?.name || (purchasingArea ? `Lokasi ${purchasingArea}` : "Dompet belanja"))
      : "Seluruh dompet";
  const waitingSettle = features.settleLaci && canDo(user.role, "settleLaci") ? pendingReports(s.dailyReports, s.transactions) : [];
  const awaitingVerify = features.settleLaci && canDo(user.role, "settleLaci") ? reportsAwaitingVerify(s.dailyReports, s.transactions) : [];
  const readyToSettle = features.settleLaci && canDo(user.role, "settleLaci") ? reportsReadyToSettle(s.dailyReports, s.transactions) : [];
  const overdueSettle = waitingSettle.filter(r => reportSettleUrgency(r) === "overdue").length;
  const todayOmsetByOutlet = new Map(reportsForDate(s.dailyReports, today()).map(r => [r.outlet, r]));
  const missingOmsetToday = features.settleLaci && canDo(user.role, "settleLaci")
    ? OUTLETS.filter(o => !todayOmsetByOutlet.has(o))
    : [];
  const todayReport = user.role === "kasir"
    ? (s.dailyReports || []).find(r => r.outlet === user.outlet && r.date === today() && r.status !== "settled")
    : null;
  const orphanOmsetToday = user.role === "kasir" && !todayReport
    ? hasOrphanLaporanCashSlot(s, user.outlet, today())
    : false;
  const pendingRevisionReport = user.role === "kasir"
    ? findPendingRevisionReport(s.dailyReports, user.outlet, s.staffMessages)
    : null;
  const needsRevision = pendingRevisionReport || (todayReport?.status === "revision_requested" ? todayReport : null);
  const todaySdm = user.role === "kasir" ? todaySdmReport(s.sdmReports, user.outlet, today()) : null;
  const showSosmed = features.sosmedReports && canInputSosmed(user, s.sosmedConfig);
  const sosmedOutlet = user.role === "kasir" ? user.outlet : (SOSMED_OUTLETS.find(o => isSosmedEnabled(s.sosmedConfig, o)) || "KBU");
  const todaySosmed = showSosmed && sosmedOutlet && isSosmedEnabled(s.sosmedConfig, sosmedOutlet)
    ? todaySosmedReport(s.sosmedReports, sosmedOutlet, today()) : null;
  const ui = getAccountUi(user, business);
  const dailyTarget = todaySdm?.targetOmset || 0;
  const pendingVoids = canDo(user.role, "reviewVoidLog") ? pendingVoidLogs(s.voidLogs).length : 0;
  const todayOutTx = scopedTx.filter(t => t.type === "out" && t.date === today());
  const todayOutTotal = todayOutTx.reduce((a, t) => a + t.amount, 0);
  const adminSosmedEnabled = showSosmed && user.role !== "kasir" && sosmedOutlet && isSosmedEnabled(s.sosmedConfig, sosmedOutlet);
  const purchasingSaldo = user.role === "purchasing" ? purchasingBalancePresentation(totalSaldo, fmtMoney, cur) : null;

  return (
    <div style={{ padding: isNfPurchasing ? "0 0 120px" : "0 0 90px" }}>
      {/* header */}
      <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", lineHeight: 1.15 }}>{businessDisplayName || s.profile.name}</div>
            <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 99, background: ui.badgeBg, color: ui.badgeColor }}>
              {ui.roleLabel}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4 }}>{dayLabel(today())}</div>
          {ui.homeTitle && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)", marginTop: 2 }}>{ui.homeTitle}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <IconBtn
            variant={cloudSyncState === "syncing" ? "syncing" : cloudSyncState === "ok" ? "ok" : cloudSyncState === "err" ? "err" : undefined}
            disabled={cloudSyncState === "syncing"}
            title={
              cloudSyncState === "syncing" ? "Menyinkronkan…"
                : cloudSyncState === "ok" ? "Sync berhasil"
                  : cloudSyncState === "err" ? "Sync gagal — tap lagi"
                    : "Muat ulang dari awan"
            }
            onClick={onCloudSync}
          >
            {cloudSyncState === "syncing" ? <Loader2 size={20} className="animate-spin" />
              : cloudSyncState === "ok" ? <Check size={20} />
                : cloudSyncState === "err" ? <X size={20} />
                  : <Cloud size={20} />}
          </IconBtn>
          {canDo(user.role, "inputIncome") && (
            <IconBtn title="Inbox draf bank/e-wallet" onClick={() => setOverlay("inbox")} badge={inboxCount}><Inbox size={20} /></IconBtn>
          )}
          <IconBtn title="Pengumuman staf" onClick={() => setOverlay("notif")} badge={notifCount}><Bell size={20} /></IconBtn>
        </div>
      </div>

      <SyncStatusStrip syncInfo={syncInfo} realtimeLive={realtimeLive} cloudSyncState={cloudSyncState} syncHint={syncInfo?.hint} />

      {!isNfPurchasing && (
        <BusinessContextBanner
          business={business}
          businesses={businesses}
          switchBusiness={switchBusiness}
          features={features}
          user={user}
        />
      )}

      {/* saldo card */}
      <div style={{ margin: isNfPurchasing ? "0 16px 16px" : "0 16px 20px" }}>
        <div style={{ background: ui.saldoGradient, borderRadius: 24, padding: "24px 24px 20px", position: "relative", overflow: "hidden", color: "#fff" }}>
          <div style={{ position: "absolute", width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,.08)", top: -60, right: -40 }} />
          <div style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,.05)", bottom: -30, right: 60 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", opacity: .8 }}>TOTAL SALDO</span>
            <button onClick={() => setHide(v => !v)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.85)", cursor: "pointer" }}>{hide ? <EyeOff size={20} /> : <Eye size={20} />}</button>
          </div>
          <div className="money" style={{ fontSize: isNfPurchasing ? 34 : 38, fontWeight: 800, marginTop: 8, position: "relative", lineHeight: 1.1 }}>
            {hide ? "••••••••" : purchasingSaldo ? purchasingSaldo.primary : fmtMoney(totalSaldo, cur)}
          </div>
          {purchasingSaldo?.secondary && !hide && (
            <div style={{ fontSize: 12, opacity: .92, marginTop: 8, lineHeight: 1.45, position: "relative", maxWidth: 320 }}>
              {purchasingSaldo.secondary}
            </div>
          )}
          <div style={{ fontSize: 13, opacity: .7, marginTop: purchasingSaldo?.secondary ? 8 : 4, position: "relative" }}>
            {isNfPurchasing ? `${scopeLabel} · saldo dompet` : `${scopeLabel} · ${new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`}
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,.2)", margin: "16px 0", position: "relative" }} />
          {isNfPurchasing ? (
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <div style={{ fontSize: 12, opacity: .85 }}>Pengeluaran {new Date().toLocaleDateString("id-ID", { month: "long" })}</div>
                <div style={{ fontSize: 11, opacity: .75, whiteSpace: "nowrap" }}>{nfMonthOutCount} transaksi</div>
              </div>
              <div className="money" style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: "#FCA5A5", letterSpacing: "-0.02em" }}>
                {hide ? "••••" : fmtMoney(nfMonthOut, cur, "−")}
              </div>
              <div style={{ fontSize: 11, opacity: .7, marginTop: 8 }}>Ketuk dompet di bawah untuk lihat riwayat</div>
            </div>
          ) : (
          <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
            <div><div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: .8 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: "#4ADE80", display: "inline-block" }} />Pemasukan</div><div className="money" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{hide ? "••••" : fmtMoney(monthIn, cur, "+")}</div></div>
            <div style={{ textAlign: "right" }}><div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: .8, justifyContent: "flex-end" }}>Pengeluaran<span style={{ width: 8, height: 8, borderRadius: 99, background: "#F87171", display: "inline-block" }} /></div><div className="money" style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "#FCA5A5" }}>{hide ? "••••" : fmtMoney(monthOut, cur, "−")}</div></div>
          </div>
          )}
        </div>
      </div>

      {showNfOmzet && nfMonthChannels && (
        <NfChannelBreakdownCard
          breakdown={nfMonthChannels}
          mpStores={s.mpStores}
          cur={cur}
          fmtMoney={fmtMoney}
          variant="compact"
          onDetailClick={() => setTab("laporan")}
        />
      )}

      {/* dompet */}
      {(() => {
        const walletScrollStyle = {
          padding: "0 20px",
          display: "flex",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 8,
          marginBottom: 24,
          alignItems: "stretch",
        };
        const walletCardBase = {
          width: 160,
          minWidth: 160,
          minHeight: 132,
          padding: 16,
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        };

        if (isNfPurchasing) {
          const links = Array.isArray(s.walletSetup?.sharedLinks)
            ? s.walletSetup.sharedLinks.filter((l) => l.enabled)
            : [];
          const opsLinks = links.filter((l) => l.linkKind === "ops_share");
          const bankLinks = links.filter((l) => l.linkKind !== "ops_share");
          const hasWallets = opsLinks.length > 0 || localOrderedWallets.length > 0;

          const renderNfSharedCard = (link) => {
            const m = sharedMirror?.[sharedWalletId(link)];
            const label = link.label || link.sourceWalletName || "Dompet";
            const isPaylater = link.sourceWalletType === "paylater";
            const virtualId = sharedWalletId(link);
            const accent = link.color || (isPaylater ? "#B45309" : "#DC2626");
            return (
              <Card
                key={link.id}
                onClick={() => onOpenWalletHistory?.(virtualId)}
                style={{ ...walletCardBase, cursor: "pointer" }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />
                <div style={{ height: 40, display: "flex", alignItems: "center", fontSize: 28, lineHeight: 1, marginBottom: 8 }}>
                  {isPaylater ? "💳" : "👛"}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink2)", lineHeight: 1.35, minHeight: 34 }}>
                  {label}
                </div>
                <div style={{ marginTop: "auto", paddingTop: 8 }}>
                  <div className="money" style={{ fontSize: 16, fontWeight: 700, color: isPaylater && m?.balance < 0 ? "#B45309" : "var(--ink)" }}>
                    {hide ? "•••" : m ? (m.missing ? "—" : fmtMoney(m.balance, cur)) : "…"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 600, marginTop: 4 }}>
                    {isPaylater ? "Hutang · ketuk riwayat" : "Ketuk untuk riwayat"}
                  </div>
                </div>
              </Card>
            );
          };

          return (
            <>
              <div style={{ padding: "0 20px", marginBottom: 12 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>{ui.walletSectionTitle}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 500, marginTop: 4 }}>Ketuk dompet untuk lihat riwayat belanja</div>
              </div>
              {!hasWallets ? (
                <Card style={{ margin: "0 20px 24px", padding: 16, background: "var(--surface2)", border: "1px dashed var(--line)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Belum ada dompet belanja</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 6, lineHeight: 1.45 }}>
                    Minta admin aktifkan Uang NF / PayLater atau dompet operasional.
                  </div>
                </Card>
              ) : (
                <div style={walletScrollStyle} className="scroll-hide">
                  {opsLinks.map(renderNfSharedCard)}
                  {localOrderedWallets.map((w) => {
                    const bal = walletBalance(w.id, s.wallets, s.transactions);
                    const paylaterDebt = isPaylaterWallet(w) && bal < 0;
                    return (
                      <Card
                        key={w.id}
                        onClick={() => onOpenWalletHistory?.(w.id)}
                        style={{ ...walletCardBase, cursor: "pointer", border: paylaterDebt ? "1px solid #FDE68A" : undefined }}
                      >
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: w.color }} />
                        <div style={{ height: 40, display: "flex", alignItems: "center", marginBottom: 8 }}>
                          <WalletIcon wallet={w} size={36} />
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink2)", lineHeight: 1.35, minHeight: 34 }}>
                          {foodWalletDisplayName(w)}
                        </div>
                        <div style={{ marginTop: "auto", paddingTop: 8 }}>
                          <div className="money" style={{ fontSize: 16, fontWeight: 700, color: paylaterDebt ? "#B45309" : "var(--ink)" }}>
                            {hide ? "•••" : formatWalletBal(w, bal, cur, user)}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 600, marginTop: 4 }}>Ketuk untuk riwayat</div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
              {bankLinks.length > 0 && (
                <>
                  <div style={{ padding: "0 20px", marginBottom: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>Rekening terhubung</div>
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>Catat keluar · saldo disembunyikan</div>
                  </div>
                  <div style={{ ...walletScrollStyle, marginBottom: 24 }} className="scroll-hide">
                    {bankLinks.map((link) => {
                      const virtualId = sharedWalletId(link);
                      return (
                        <Card
                          key={link.id}
                          onClick={() => onOpenWalletHistory?.(virtualId)}
                          style={{ ...walletCardBase, cursor: "pointer", opacity: 0.95 }}
                        >
                          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#6B7280" }} />
                          <div style={{ height: 40, display: "flex", alignItems: "center", fontSize: 26, marginBottom: 8 }}>🔗</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink2)", lineHeight: 1.35, minHeight: 34 }}>
                            {link.label || link.sourceWalletName}
                          </div>
                          <div style={{ marginTop: "auto", paddingTop: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink3)" }}>Hanya catat keluar</div>
                            <div style={{ fontSize: 10, color: "var(--ink3)", marginTop: 4 }}>Ketuk untuk riwayat</div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          );
        }

        return (
          <>
      <div style={{ padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>{ui.walletSectionTitle}</span>
        </div>
        {canDo(user.role, "kelolaDompet") && (
          <button onClick={() => setOverlay("wallets")} style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", background: "none", border: "none", cursor: "pointer" }}>Kelola dompet</button>
        )}
      </div>
      <div style={{ padding: "0 20px", display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, marginBottom: 24, alignItems: "stretch" }} className="scroll-hide">
        {localOrderedWallets.length === 0 && user.role === "purchasing" && (
          <Card style={{ minWidth: 260, padding: 16, background: "var(--surface2)", border: "1px dashed var(--line)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Belum ada dompet belanja</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 6, lineHeight: 1.45 }}>
              Minta Owner/Admin aktifkan Dana Darurat / Uang Makan / Parkir untuk purchasing (centang Pakai belanja).
            </div>
          </Card>
        )}
        {localOrderedWallets.map(w => {
          const bal = walletBalance(w.id, s.wallets, s.transactions);
          const laciWarn = isLaciOutletWallet(w) && bal < (w.floor ?? LACI_FLOOR);
          const floorHint = !isPaylaterWallet(w) && !laciWarn ? walletFloorHint(bal, w.floor) : null;
          const nearFloor = !!floorHint;
          const paylaterDebt = isPaylaterWallet(w) && bal < 0;
          const balHidden = shouldHideWalletBalance(w, user);
          const laciPres = laciWarn ? laciBalancePresentation(bal, fmtMoney, cur, w.floor) : null;
          return (
            <Card
              key={w.id}
              onClick={() => onOpenWalletHistory?.(w.id)}
              style={{
                minWidth: 152,
                minHeight: 120,
                padding: 16,
                position: "relative",
                overflow: "hidden",
                flexShrink: 0,
                border: paylaterDebt ? "1px solid #FDE68A" : undefined,
                display: "flex",
                flexDirection: "column",
                cursor: "pointer",
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: w.color }} />
              <div style={{ marginBottom: 12 }}><WalletIcon wallet={w} size={40} /></div>
              <div style={{ fontSize: 12, color: "var(--ink2)", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {foodWalletDisplayName(w)}
                {isPaylaterWallet(w) && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 99, background: "#FEF3C7", color: "#B45309", fontWeight: 800 }}>Hutang</span>}
                {balHidden && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 99, background: "var(--surface2)", color: "var(--ink3)", fontWeight: 700 }}>Rekening</span>}
                {w.outlet && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 99, background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 700 }}>{w.outlet}</span>}
              </div>
              {balHidden ? (
                <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 6, fontWeight: 600 }}>Saldo disembunyikan</div>
              ) : user.role === "purchasing" && isKasKecilWalletDisplay(w) ? (
                <>
                  <div className="money" style={{ fontSize: 17, fontWeight: 700, color: bal < 0 ? "var(--ink2)" : nearFloor ? "var(--out-text)" : "var(--ink)", marginTop: 2 }}>
                    {hide ? "•••" : formatWalletBal(w, bal, cur, user)}
                  </div>
                  {bal < 0 && !hide && (
                    <div style={{ fontSize: 10, color: "var(--ink3)", marginTop: 4, lineHeight: 1.35 }}>Minta top-up admin</div>
                  )}
                </>
              ) : laciWarn ? (
                <>
                  <div className="money" style={{ fontSize: 17, fontWeight: 700, color: "var(--out-text)", marginTop: 2 }}>
                    {hide ? "•••" : laciPres.primary}
                  </div>
                  {!hide && (
                    <>
                      <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 3, lineHeight: 1.35 }}>{laciPres.secondary}</div>
                      <div className="money" style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>{fmtMoney(bal, cur)}</div>
                    </>
                  )}
                </>
              ) : (
                <div className="money" style={{ fontSize: 17, fontWeight: 700, color: paylaterDebt ? "#B45309" : nearFloor ? "var(--out-text)" : bal < 0 ? "var(--out-text)" : "var(--ink)", marginTop: 2 }}>{hide ? "•••" : formatWalletBal(w, bal, cur, user)}</div>
              )}
              {paylaterDebt && <div style={{ fontSize: 10, color: "#B45309", fontWeight: 700, marginTop: 3 }}>⚠ Wajib dibayar</div>}
              {floorHint && <div style={{ fontSize: 10, color: "var(--out-text)", fontWeight: 700, marginTop: 3 }}>⚠ {floorHint}</div>}
            </Card>
          );
        })}
      </div>
          </>
        );
      })()}

      {/* Dompet bersama FNB (Uang NF, PayLater) + rekening Sam — saldo dari FNB. */}
      {(() => {
        if (isNfPurchasing) return null;
        if (features?.isFnB || !canWriteSharedBank(user?.role)) return null;
        const links = Array.isArray(s.walletSetup?.sharedLinks)
          ? s.walletSetup.sharedLinks.filter((l) => l.enabled)
          : [];
        if (!links.length) return null;
        const isPurchasing = user?.role === "purchasing";
        const opsLinks = links.filter((l) => l.linkKind === "ops_share");
        const bankLinks = links.filter((l) => l.linkKind !== "ops_share");

        const renderSharedCard = (link, { showBalance, accent, canOpenHistory }) => {
          const m = sharedMirror?.[sharedWalletId(link)];
          const label = link.label || link.sourceWalletName || "Dompet";
          const isPaylater = link.sourceWalletType === "paylater";
          const virtualId = sharedWalletId(link);
          return (
            <Card
              key={link.id}
              onClick={canOpenHistory ? () => onOpenWalletHistory?.(virtualId) : undefined}
              style={{ minWidth: 152, minHeight: 120, padding: 16, position: "relative", overflow: "hidden", flexShrink: 0, display: "flex", flexDirection: "column", opacity: 0.96, cursor: canOpenHistory ? "pointer" : "default" }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent || (isPaylater ? "#B45309" : "#DC2626") }} />
              <div style={{ marginBottom: 10, fontSize: 26 }}>{isPaylater ? "💳" : link.linkKind === "ops_share" ? "👛" : "🔗"}</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                {label}
                {isPaylater && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 99, background: "#FEF3C7", color: "#B45309", fontWeight: 800 }}>Hutang</span>}
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 99, background: "var(--surface2)", color: "var(--ink3)", fontWeight: 700 }}>Bersama</span>
              </div>
              {showBalance ? (
                <>
                  <div className="money" style={{ fontSize: 17, fontWeight: 700, color: isPaylater && m?.balance < 0 ? "#B45309" : "var(--ink)", marginTop: 2 }}>
                    {hide ? "•••" : m ? (m.missing ? "—" : m.hidden ? "•••" : fmtMoney(m.balance, cur)) : "…"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 700, marginTop: 3 }}>
                    {m?.missing ? "Saldo tak terbaca" : "Satu saldo · FNB & NF"}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink3)", marginTop: 6 }}>Saldo disembunyikan</div>
                  <div style={{ fontSize: 10, color: "var(--ink3)", fontWeight: 700, marginTop: 3 }}>Hanya catat pengeluaran</div>
                </>
              )}
            </Card>
          );
        };

        return (
          <>
            {opsLinks.length > 0 && (
              <>
                <div style={{ padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>Dompet bersama</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)" }}>Uang NF & PayLater · FNB</span>
                </div>
                <div style={{ padding: "0 20px", display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, marginBottom: 24, alignItems: "stretch" }} className="scroll-hide">
                  {opsLinks.map((link) => renderSharedCard(link, { showBalance: true, accent: link.color, canOpenHistory: true }))}
                </div>
              </>
            )}
            {bankLinks.length > 0 && (
              <>
                <div style={{ padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>Rekening Sam terhubung</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink3)" }}>
                    {isPurchasing ? "Catat keluar · tanpa lihat saldo" : "Saldo FNB · masuk & keluar"}
                  </span>
                </div>
                <div style={{ padding: "0 20px", display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, marginBottom: 24, alignItems: "stretch" }} className="scroll-hide">
                  {bankLinks.map((link) =>
                    renderSharedCard(link, { showBalance: !isPurchasing, accent: "#6B7280", canOpenHistory: true })
                  )}
                </div>
              </>
            )}
          </>
        );
      })()}

      {/* Checklist harian — semua role */}
      {(() => {
        const role = user.role;

        if (role === "kasir" && features.kasirDaily && canDo(role, "inputLaporanHarian")) {
          const kasirSosmed = showSosmed && isSosmedEnabled(s.sosmedConfig, user.outlet);
          const sdmPending = todaySdm && !isSectionCloudCommitted(todaySdm);
          const omsetPending = (todayReport && !isSectionCloudCommitted(todayReport)) || orphanOmsetToday;
          const sosmedPending = todaySosmed && !isSectionCloudCommitted(todaySosmed);
          const recoverOrOpen = (focus, openFn) => {
            if (typeof onRecoverPending === "function" && (focus === "omset" ? omsetPending : focus === "sdm" ? sdmPending : sosmedPending)) {
              onRecoverPending({ focus });
              return;
            }
            openFn();
          };
          const tasks = [
            {
              id: "sdm",
              title: "SDM Pagi",
              subtitle: todaySdm?.commitStatus === "committing"
                ? "Sedang mengirim ke pusat…"
                : sdmPending
                  ? UNSYNCED_HINT
                : todaySdm
                  ? `${todaySdm.headcount} orang masuk · target ${fmtMoney(todaySdm.targetOmset, cur)} · ${SYNCED_HINT}`
                  : `Berapa orang masuk kerja? ${SDM_HINT[user.outlet] || "Isi angka saja"}`,
              done: isSectionCloudCommitted(todaySdm),
              urgent: sdmPending,
              actionLabel: sdmPending ? "Sinkronkan sekarang" : null,
              onClick: () => recoverOrOpen("sdm", () => setOverlay("sdmHarian")),
            },
            {
              id: "omset",
              title: "Laporan Omset",
              subtitle: needsRevision
                ? `Revisi wajib (${shortDate(needsRevision.date)}) — ${needsRevision.revisionNote || "perbaiki sesuai catatan admin"}`
                : todayReport?.commitStatus === "committing"
                  ? "Sedang mengirim ke pusat…"
                  : omsetPending
                    ? (orphanOmsetToday
                      ? `${UNSYNCED_HINT} Omset di laci terdeteksi — jangan isi ulang.`
                      : UNSYNCED_HINT)
                : todayReport
                  ? todayReport.status === "admin_verified"
                    ? `Total ${fmtMoney(todayReport.total, cur)} · menunggu settle owner/admin · ${SYNCED_HINT}`
                    : todayReport.status === "submitted"
                      ? `Total ${fmtMoney(todayReport.total, cur)} · menunggu verifikasi admin pagi · ${SYNCED_HINT}`
                      : `Total ${fmtMoney(todayReport.total, cur)} · ${SYNCED_HINT}`
                  : todaySdm
                    ? `Target ${fmtMoney(dailyTarget, cur)} · isi per channel pembayaran`
                    : "Tap untuk isi · backfill tanggal lalu boleh",
              done: isSectionCloudCommitted(todayReport) && !needsRevision,
              urgent: !!needsRevision || omsetPending,
              blocked: false,
              actionLabel: needsRevision ? "Proses" : omsetPending ? "Sinkronkan sekarang" : null,
              onClick: () => {
                if (needsRevision) {
                  if (onOpenLaporan) onOpenLaporan(needsRevision.date || null);
                  else setOverlay("laporanHarian");
                  return;
                }
                recoverOrOpen("omset", () => (onOpenLaporan ? onOpenLaporan(null) : setOverlay("laporanHarian")));
              },
            },
          ];
          if (kasirSosmed) {
            tasks.push({
              id: "sosmed",
              title: "Report Sosmed",
              subtitle: todaySosmed?.commitStatus === "committing"
                ? "Sedang mengirim ke pusat…"
                : sosmedPending
                  ? UNSYNCED_HINT
                : todaySosmed
                  ? `${sosmedDisplayName(user.outlet)} · ${SYNCED_HINT}`
                  : `${sosmedDisplayName(user.outlet)} · DM, komentar, review, komplain`,
              done: isSectionCloudCommitted(todaySosmed),
              urgent: sosmedPending,
              actionLabel: sosmedPending ? "Sinkronkan sekarang" : null,
              onClick: () => recoverOrOpen("sosmed", () => setOverlay("sosmedHarian")),
            });
          }
          return (
            <RoleDailyChecklist
              tasks={tasks}
              accentGradient={ui.saldoGradient}
              headerHint="Wajib setiap hari sebelum tutup shift"
            />
          );
        }

        if (role === "purchasing" && features.purchasingModule) {
          const kasKecilBal = walletBalance("w_kas_kecil", s.wallets, s.transactions);
          const tasks = [
            {
              id: "belanja",
              title: "Catat Belanja Hari Ini",
              subtitle: todayOutTx.length
                ? `${todayOutTx.length} transaksi · total ${fmtMoney(todayOutTotal, cur)}`
                : kasKecilBal < 0
                  ? "Dana Kas Kecil habis — minta admin transfer"
                  : "Belum ada belanja tercatat — tap untuk catat pengeluaran",
              done: todayOutTx.length > 0,
              onClick: () => onCatat?.(),
            },
            {
              id: "asisten",
              title: "Asisten Purchasing",
              subtitle: "Tanya AI soal kendala belanja & stok dari data transaksi",
              done: false,
              optional: true,
              onClick: () => setTab("asisten"),
            },
          ];
          return (
            <RoleDailyChecklist
              tasks={tasks}
              accentGradient={ui.saldoGradient}
              headerHint="Catat setiap belanja ke dompet yang dipakai"
            />
          );
        }

        if (role === "purchasing" && !features.purchasingModule) {
          const primaryWallet = primaryPurchasingWallet || myWallets.find((w) => w.purchasingUse) || myWallets[0];
          const saldoHint = primaryWallet
            ? walletBalance(primaryWallet.id, s.wallets, s.transactions)
            : 0;
          const tasks = [
            {
              id: "belanja",
              title: "Catat Belanja Hari Ini",
              subtitle: todayOutTx.length
                ? `${todayOutTx.length} transaksi · total ${fmtMoney(todayOutTotal, cur)}`
                : saldoHint <= 0
                  ? "Saldo dompet habis — minta admin keuangan transfer"
                  : "Belum ada belanja tercatat — tap untuk catat pengeluaran",
              done: todayOutTx.length > 0,
              onClick: () => onCatat?.(),
            },
            {
              id: "cari",
              title: "Cari Riwayat Belanja",
              subtitle: "Beli dimana? Ketik nama barang / toko / kategori",
              done: false,
              optional: true,
              onClick: () => setOverlay("nfBelanjaSearch"),
            },
          ];
          return (
            <RoleDailyChecklist
              tasks={tasks}
              accentGradient={ui.saldoGradient}
              headerHint={`Dompet: ${primaryWallet?.name || "hubungi admin"}`}
            />
          );
        }

        if ((role === "admin" || role === "owner") && features.settleLaci) {
          const tasks = [
            {
              id: "verify",
              title: "Verifikasi Laporan Kasir",
              subtitle: awaitingVerify.length
                ? `${awaitingVerify.length} laporan · cek fisik laci & nota pagi`
                : missingOmsetToday.length
                  ? `${missingOmsetToday.map(o => OUTLET_LABEL[o] || o).join(", ")} belum kirim omset hari ini`
                  : "Semua laporan sudah diverifikasi",
              done: awaitingVerify.length === 0 && missingOmsetToday.length === 0,
              urgent: awaitingVerify.length > 0 || missingOmsetToday.length > 0,
              count: awaitingVerify.length || missingOmsetToday.length || undefined,
              onClick: () => setOverlay("settleLaporan"),
            },
            {
              id: "settle",
              title: "Settle Laporan Omset",
              subtitle: readyToSettle.length
                ? `${readyToSettle.length} siap settle · batas ${reportSettleDeadlineLabel(readyToSettle[0]?.date) || "esok 17:00"}`
                : missingOmsetToday.length
                  ? `Tunggu omset ${missingOmsetToday.map(o => OUTLET_LABEL[o] || o).join(", ")}`
                  : waitingSettle.length === 0
                    ? "Semua laporan omset sudah disettle"
                    : "Verifikasi dulu sebelum settle",
              done: waitingSettle.length === 0 && missingOmsetToday.length === 0,
              urgent: readyToSettle.length > 0 || overdueSettle > 0,
              count: readyToSettle.length || undefined,
              onClick: () => setOverlay("settleLaporan"),
            },
          ];
          if (role === "admin") {
            tasks.push({
              id: "void",
              title: "Review Void Kasir",
              subtitle: pendingVoids
                ? `${pendingVoids} void menunggu review sebelum settle omset`
                : "Tidak ada void pending dari kasir outlet",
              done: pendingVoids === 0,
              urgent: pendingVoids > 0,
              count: pendingVoids || undefined,
              onClick: () => setOverlay("voidReview"),
            });
          }
          if (canDo(role, "inputIncome")) {
            tasks.push({
              id: "inbox",
              title: "Inbox Bank / E-wallet",
              subtitle: inboxCount
                ? `${inboxCount} draf notifikasi belum diproses jadi transaksi`
                : "Inbox kosong — semua draf sudah diproses",
              done: inboxCount === 0,
              urgent: inboxCount > 0,
              count: inboxCount || undefined,
              onClick: () => setOverlay("inbox"),
            });
          }
          if (adminSosmedEnabled) {
            tasks.push({
              id: "sosmed",
              title: "Report Sosmed",
              subtitle: todaySosmed
                ? `${sosmedDisplayName(sosmedOutlet)} · sudah dilaporkan hari ini`
                : `${sosmedDisplayName(sosmedOutlet)} · DM, komentar, Google review, komplain`,
              done: !!todaySosmed,
              onClick: () => setOverlay("sosmedHarian"),
            });
          }
          if (showPurchasingAsistenBeranda(role) && features.purchasingModule) {
            tasks.push({
              id: "asisten",
              title: "Tanya Purchasing",
              subtitle: "AI bantu jawab kendala belanja dari data transaksi",
              done: false,
              optional: true,
              onClick: () => setOverlay("asisten"),
            });
          }
          return (
            <RoleDailyChecklist
              tasks={tasks}
              accentGradient={ui.saldoGradient}
              headerLabel={role === "owner" ? "Prioritas Owner" : "Prioritas Admin Keuangan"}
              headerHint="Verifikasi pagi · settle s/d esok 17:00"
            />
          );
        }

        if ((role === "admin" || role === "owner") && !features.settleLaci) {
          const tasks = [
            {
              id: "catat",
              title: "Catat Transaksi",
              subtitle: todayOutTx.length
                ? `${todayOutTx.length} pengeluaran hari ini · ${fmtMoney(todayOutTotal, cur)}`
                : "Pemasukan/pengeluaran bisnis ini — terpisah dari resto F&B",
              done: todayOutTx.length > 0,
              onClick: () => onCatat?.(),
            },
          ];
          if (canDo(role, "inputIncome")) {
            tasks.push({
              id: "inbox",
              title: "Inbox Bank / E-wallet",
              subtitle: inboxCount
                ? `${inboxCount} draf notifikasi belum diproses`
                : "Inbox kosong",
              done: inboxCount === 0,
              urgent: inboxCount > 0,
              count: inboxCount || undefined,
              onClick: () => setOverlay("inbox"),
            });
          }
          return (
            <RoleDailyChecklist
              tasks={tasks}
              accentGradient={ui.saldoGradient}
              headerLabel={features.label}
              headerHint="Dompet & transaksi hanya untuk bisnis aktif — bukan KBU/KSM/SMT"
            />
          );
        }

        return null;
      })()}

      {/* transaksi terbaru */}
      <div style={{ padding: "20px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)", flexShrink: 0 }}>Transaksi Terbaru</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {isNfPurchasing && (
            <button type="button" onClick={() => setOverlay("nfBelanjaSearch")} style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)", background: "var(--surface2)", border: "1px solid var(--line)", borderRadius: 99, cursor: "pointer", padding: "6px 12px", display: "flex", alignItems: "center", gap: 5 }}>
              <Search size={14} /> Cari
            </button>
          )}
          <button type="button" onClick={() => setTab("laporan")} style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>Lihat Semua</button>
        </div>
      </div>
      {(() => {
        const recent = [...scopedTx].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 10);
        if (recent.length === 0) return (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "var(--surface2)", display: "grid", placeItems: "center", margin: "0 auto 16px", color: "var(--ink3)" }}><ClipboardList size={30} /></div>
            <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 16 }}>Belum ada transaksi</div>
            <div style={{ color: "var(--ink3)", fontSize: 13, marginTop: 4 }}>Mulai catat transaksi pertama Anda</div>
          </div>
        );
        return (
          <Card style={{ margin: "12px 16px 0", overflow: "hidden" }}>
            {recent.map((t, i) => {
              const isTrf = t.type === "transfer";
              const cat = s.categories.find(c => c.id === t.categoryId);
              const w = s.wallets.find(x => x.id === (isTrf ? t.fromWalletId : t.walletId));
              const visual = resolveTxVisual(t, cat, s.wallets);
              const col = isTrf ? "var(--brand)" : t.type === "in" ? "var(--in-text)" : "var(--out-text)";
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <TxRowIcon visual={visual} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {isTrf ? `${s.wallets.find(x => x.id === t.fromWalletId)?.name} → ${s.wallets.find(x => x.id === t.toWalletId)?.name}` : (isPurchasingTx(t) ? purchasingTxTitle(t) : (t.desc || cat?.name))}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{isTrf ? "Geser laci" : cat?.name} · {foodWalletDisplayName(w)} · {shortDate(t.date)}</div>
                  </div>
                  <div className="money" style={{ fontSize: 14, fontWeight: 700, color: col, flexShrink: 0 }}>
                    {hide ? "•••" : (isTrf ? "⇄ " : "") + (isTrf ? fmtMoney(t.amount, cur) : fmtTxAmount(t.amount, t.type, cur))}
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })()}
    </div>
  );
}

function IconBtn({ children, onClick, badge, title, variant, disabled }) {
  const tone = variant === "syncing"
    ? { bg: "var(--brand-soft)", border: "var(--brand)", color: "var(--brand)" }
    : variant === "ok"
      ? { bg: "#ECFDF5", border: "#A7F3D0", color: "var(--in-text)" }
      : variant === "err"
        ? { bg: "#FEF2F2", border: "#FECACA", color: "#B91C1C" }
        : null;
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 38, height: 38, borderRadius: 99,
        background: tone?.bg || "none",
        border: tone ? `1.5px solid ${tone.border}` : "none",
        cursor: disabled ? "wait" : "pointer",
        display: "grid", placeItems: "center",
        color: tone?.color || "var(--ink2)",
        position: "relative",
        transform: variant === "syncing" ? "scale(0.94)" : "scale(1)",
        transition: "transform .12s ease, background .2s ease, border-color .2s ease",
        opacity: disabled ? 0.85 : 1,
      }}
    >
      {children}
      {badge > 0 && <span style={{ position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 99, background: "var(--out)", color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center", padding: "0 3px" }}>{badge}</span>}
    </button>
  );
}

// ─── Laporan ───────────────────────────────────────────────
function Laporan({ s, mutate, onOpenPair, onOpenPurchasingReport, business, features, webMode, sharedTxByWallet, bizId }) {
  const cur = s.profile.currency;
  const user = s.currentUser || { role: "kasir" };
  const role = user.role || "kasir";
  const canManageTx = canManageTransactions(user.role);
  const [editTx, setEditTx] = useState(null);
  const canExport = canDo(user.role, "hubungkanWeb");
  const [exporting, setExporting] = useState(null);
  const myWallets = visibleWalletsForBusiness(s.wallets, user, business);
  const scopedBase = useMemo(() => {
    const local = visibleTransactionsForBusiness(s.transactions, s.wallets, user, business);
    if (features.nfChannelFinance) {
      return scopedNfFinanceTransactions(local, sharedTxByWallet, s.categories, {
        businessId: bizId,
        role: user.role,
        userId: user.id,
      });
    }
    return mergeWithLocalTransactions(local, sharedTxByWallet);
  }, [s.transactions, s.wallets, s.categories, user, business, sharedTxByWallet, features.nfChannelFinance, bizId]);
  const [range, setRange] = useState("Harian");
  const [anchorDate, setAnchorDate] = useState(today());
  const [customStart, setCustomStart] = useState(isoOffset(-6));
  const [customEnd, setCustomEnd] = useState(today());
  const [walletId, setWalletId] = useState("all");
  const [catIn, setCatIn] = useState("all");
  const [catOut, setCatOut] = useState("all");
  const [isPressingPurchasing, setIsPressingPurchasing] = useState(false);

  const bounds = useMemo(
    () => getPeriodBounds(range, anchorDate, { customStart, customEnd }),
    [range, anchorDate, customStart, customEnd]
  );

  const tx = useMemo(
    () => filterTransactions(scopedBase, {
      start: bounds.start,
      end: bounds.end,
      walletId,
      catIn,
      catOut,
    }),
    [scopedBase, bounds, walletId, catIn, catOut]
  );

  const { inSum, outSum, net, count } = useMemo(() => sumInOut(tx), [tx]);

  const showNfLabaRugi = features.nfChannelFinance && canDo(user.role, "lihatLaporanPenuh");
  const nfProfit = useMemo(() => {
    if (!showNfLabaRugi) return null;
    return computeNfProfit(scopedBase, s.categories, { start: bounds.start, end: bounds.end });
  }, [showNfLabaRugi, scopedBase, s.categories, bounds.start, bounds.end]);

  const nfChannels = useMemo(() => {
    if (!showNfLabaRugi) return null;
    return computeNfChannelBreakdown(scopedBase, s.categories, { start: bounds.start, end: bounds.end });
  }, [showNfLabaRugi, scopedBase, s.categories, bounds.start, bounds.end]);

  const chart = useMemo(
    () => buildCashflowChart(tx, bounds.start, bounds.end, shortDate),
    [tx, bounds.start, bounds.end]
  );

  const periodLabel = useMemo(() => formatPeriodLabel(range, bounds), [range, bounds]);

  const canShift = range !== "Custom";

  const goPrev = () => {
    if (!canShift) return;
    setAnchorDate(shiftAnchor(range, anchorDate, -1));
  };
  const goNext = () => {
    if (!canShift) return;
    const next = shiftAnchor(range, anchorDate, 1);
    if (next <= today()) setAnchorDate(next);
  };
  const canGoNext = bounds.end < today();

  const inCats = visibleCategoriesForBusiness(s.categories, user, "in", business);
  const outCats = visibleCategoriesForBusiness(s.categories, user, "out", business);

  const txDetail = useMemo(
    () => filterTransactions(scopedBase, {
      start: bounds.start,
      end: bounds.end,
      walletId,
      catIn,
      catOut,
      includeTransfer: canManageTx,
    }),
    [scopedBase, bounds, walletId, catIn, catOut, canManageTx]
  );

  const txSorted = useMemo(
    () => [...txDetail].sort((a, b) => b.date.localeCompare(a.date) || (b.id > a.id ? 1 : -1)),
    [txDetail]
  );

  const scopeLabel = user.role === "kasir"
    ? (OUTLET_LABEL[user.outlet] || user.outlet)
    : walletId !== "all"
      ? (myWallets.find(w => w.id === walletId)?.name || "Dompet")
      : "Semua dompet";
  const ui = getAccountUi(user, business);

  const waKeuangan = useMemo(() => formatKeuanganWa({
    periodLabel,
    inSum,
    outSum,
    net,
    count,
    scopeLabel,
  }), [periodLabel, inSum, outSum, net, count, scopeLabel]);

  const businessLabel = resolveBusinessDisplayName(business) || s.profile?.name || "NF3";

  const handleExport = async (type) => {
    if (!txSorted.length) {
      showActionToast("Tidak ada transaksi pada periode ini.", "error");
      return;
    }
    setExporting(type);
    try {
      if (type === "csv") {
        exportKeuanganCsv(txSorted, s.categories, s.wallets, bounds, periodLabel, businessLabel);
      } else {
        await exportKeuanganPdf(txSorted, s.categories, s.wallets, bounds, periodLabel, businessLabel);
      }
      showActionToast(type === "csv" ? "File Excel (CSV) diunduh." : "File PDF diunduh.", "success");
    } catch (e) {
      showActionToast(e.message || "Gagal export", "error");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div style={{ padding: "0 0 90px" }}>
      <div style={{ padding: "16px 20px 12px" }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>{ui.laporanTitle}</span>
      </div>

      {(role === "purchasing" || canDo(role, "kelolaKategoriSemua")) && features?.purchasingModule && (
        <div style={{ margin: "0 16px 12px" }}>
          <Card
            onClick={onOpenPurchasingReport}
            onMouseDown={() => setIsPressingPurchasing(true)}
            onMouseUp={() => setIsPressingPurchasing(false)}
            onMouseLeave={() => setIsPressingPurchasing(false)}
            onTouchStart={() => setIsPressingPurchasing(true)}
            onTouchEnd={() => setIsPressingPurchasing(false)}
            onTouchCancel={() => setIsPressingPurchasing(false)}
            style={{
              padding: "13px 14px",
              background: "#FEF3C7",
              border: "1px solid #F59E0B",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              transform: isPressingPurchasing ? "scale(0.985)" : "scale(1)",
              boxShadow: isPressingPurchasing ? "0 1px 1px rgba(146,64,14,.12)" : "0 3px 10px rgba(146,64,14,.08)",
              transition: "transform .12s ease, box-shadow .16s ease",
            }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "#FFFBEB", border: "1px solid #F59E0B", flexShrink: 0 }}>
              <BarChart3 size={16} color="#92400E" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#92400E" }}>Laporan Purchasing</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>Pengeluaran belanja per outlet & periode</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginTop: 5 }}>Tap untuk buka laporan</div>
            </div>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 99,
                display: "grid",
                placeItems: "center",
                border: "1px solid #F59E0B",
                background: "#FFFBEB",
                flexShrink: 0,
              }}
            >
              <ChevronRight size={16} color="#92400E" />
            </div>
          </Card>
        </div>
      )}

      {canExport && (
        <div style={{ margin: "0 16px 16px" }}>
          {webMode ? (
            <Card style={{ padding: "14px 16px", background: "#F0FDF4", border: "1px solid #86EFAC" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#15803D", marginBottom: 10 }}>Export laporan keuangan</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" disabled={!!exporting} onClick={() => handleExport("pdf")}
                  style={{ flex: 1, minWidth: 140, padding: "12px 16px", borderRadius: 12, border: "none", background: "#16A34A", color: "#fff", fontWeight: 700, fontSize: 14, cursor: exporting ? "wait" : "pointer", opacity: exporting && exporting !== "pdf" ? 0.6 : 1 }}>
                  {exporting === "pdf" ? "Membuat PDF…" : "Unduh PDF"}
                </button>
                <button type="button" disabled={!!exporting} onClick={() => handleExport("csv")}
                  style={{ flex: 1, minWidth: 140, padding: "12px 16px", borderRadius: 12, border: "1px solid #86EFAC", background: "#fff", color: "#15803D", fontWeight: 700, fontSize: 14, cursor: exporting ? "wait" : "pointer", opacity: exporting && exporting !== "csv" ? 0.6 : 1 }}>
                  {exporting === "csv" ? "Mengekspor…" : "Unduh Excel (CSV)"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#4B5563", marginTop: 8, lineHeight: 1.4 }}>
                {txSorted.length} transaksi pada periode ini · filter dompet/kategori ikut diterapkan.
              </div>
            </Card>
          ) : (
          <Card
            onClick={onOpenPair}
            style={{
              padding: "13px 14px",
              background: "#F0FDF4",
              border: "1px solid #86EFAC",
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "#ECFDF5", border: "1px solid #86EFAC", flexShrink: 0 }}>
              <Monitor size={16} color="#15803D" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#15803D" }}>Export PDF & Excel</div>
              <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>Unduh langsung di bawah, atau hubungkan PC</div>
            </div>
            <ChevronRight size={16} color="#15803D" />
          </Card>
          )}
          {!webMode && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" disabled={!!exporting} onClick={() => handleExport("pdf")}
                style={{ flex: 1, padding: "11px 12px", borderRadius: 12, border: "none", background: "#16A34A", color: "#fff", fontWeight: 700, fontSize: 13, cursor: exporting ? "wait" : "pointer" }}>
                {exporting === "pdf" ? "PDF…" : "PDF"}
              </button>
              <button type="button" disabled={!!exporting} onClick={() => handleExport("csv")}
                style={{ flex: 1, padding: "11px 12px", borderRadius: 12, border: "1px solid #86EFAC", background: "#fff", color: "#15803D", fontWeight: 700, fontSize: 13, cursor: exporting ? "wait" : "pointer" }}>
                {exporting === "csv" ? "CSV…" : "Excel"}
              </button>
              <button type="button" onClick={onOpenPair}
                style={{ padding: "11px 14px", borderRadius: 12, border: "1px solid #86EFAC", background: "#ECFDF5", color: "#15803D", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                PC
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ margin: "0 16px 12px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 2, background: "var(--surface2)", borderRadius: 12, padding: 4 }}>
        {["Harian", "Mingguan", "Bulanan", "Custom"].map(r => (
          <button key={r} onClick={() => {
            setRange(r);
            if (r === "Custom") {
              setCustomEnd(today());
              setCustomStart(isoOffset(-6));
            } else {
              setAnchorDate(today());
            }
          }} style={{ padding: "9px 0", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: range === r ? "var(--brand)" : "transparent", color: range === r ? "#fff" : "var(--ink2)" }}>{r}</button>
        ))}
      </div>

      {range === "Custom" ? (
        <div style={{ padding: "8px 16px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Fld label="Dari tanggal">
            <input type="date" value={customStart} max={customEnd || today()} onChange={e => setCustomStart(e.target.value)}
              style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14 }} />
          </Fld>
          <Fld label="Sampai tanggal">
            <input type="date" value={customEnd} min={customStart} max={today()} onChange={e => setCustomEnd(e.target.value)}
              style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14 }} />
          </Fld>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 16px 12px" }}>
          <button onClick={goPrev} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "grid", placeItems: "center" }}>
            <ChevronLeft size={22} color="var(--brand)" />
          </button>
          <div style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", lineHeight: 1.35 }}>{periodLabel}</div>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>{count} transaksi tercatat</div>
          </div>
          <button onClick={goNext} disabled={!canGoNext} style={{ background: "none", border: "none", cursor: canGoNext ? "pointer" : "default", padding: 4, display: "grid", placeItems: "center", opacity: canGoNext ? 1 : .35 }}>
            <ChevronRight size={22} color="var(--brand)" />
          </button>
        </div>
      )}

      {range === "Custom" && (
        <div style={{ padding: "0 16px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{periodLabel}</div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>{count} transaksi tercatat</div>
        </div>
      )}

      <FilterChipRow label="Dompet">
        <Pill active={walletId === "all"} onClick={() => setWalletId("all")}>Semua dompet</Pill>
        {myWallets.map(w => <Pill key={w.id} active={walletId === w.id} onClick={() => setWalletId(w.id)} color={w.color}>{w.name}</Pill>)}
      </FilterChipRow>
      <FilterChipRow label="Masuk">
        <Pill active={catIn === "all"} onClick={() => setCatIn("all")}>Semua</Pill>
        {inCats.map(c => <Pill key={c.id} active={catIn === c.id} onClick={() => setCatIn(c.id)}>{c.name}</Pill>)}
      </FilterChipRow>
      <FilterChipRow label="Keluar" style={{ paddingBottom: 12 }}>
        <Pill active={catOut === "all"} onClick={() => setCatOut("all")}>Semua</Pill>
        {outCats.map(c => <Pill key={c.id} active={catOut === c.id} onClick={() => setCatOut(c.id)}>{c.name}</Pill>)}
      </FilterChipRow>

      <div style={{ padding: "0 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)", marginBottom: 8 }}>Tren Alur Kas (Pemasukan vs Pengeluaran)</div>
        <Card style={{ padding: "12px 8px 4px" }}>
          <CashflowChart chart={chart} cur={cur} fmtMoney={fmtMoney} dayLabel={dayLabel} />
        </Card>
      </div>

      {showNfLabaRugi && nfProfit && (
        <div style={{ margin: "0 16px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)", marginBottom: 8 }}>Laba Rugi NF</div>
          <Card style={{ overflow: "hidden" }}>
            {[
              { label: "Omzet bersih", value: nfProfit.omzetBersih, tone: "ink" },
              { label: "Modal produk (HPP)", value: -nfProfit.hpp, tone: "out" },
              { label: "Laba kotor", value: nfProfit.labaKotor, tone: "ink", bold: true },
              ...(nfProfit.biayaMarketplace > 0 ? [{ label: "Biaya marketplace", value: -nfProfit.biayaMarketplace, tone: "out" }] : []),
              { label: "Biaya operasional", value: -nfProfit.biayaOperasional, tone: "out" },
            ].map((row) => (
              <div key={row.label} style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--ink2)", fontWeight: row.bold ? 700 : 500 }}>{row.label}</span>
                <span className="money" style={{ fontSize: row.bold ? 15 : 14, fontWeight: row.bold ? 800 : 600, color: row.tone === "out" ? "var(--out-text)" : "var(--ink)" }}>
                  {row.value < 0 ? "−" : ""}{fmtMoney(Math.abs(row.value), cur)}
                </span>
              </div>
            ))}
            <div style={{ padding: "12px 16px", background: "var(--surface2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800, color: "var(--ink)" }}>Laba bersih NF</span>
              <span className="money" style={{ fontSize: 20, fontWeight: 800, color: nfProfit.labaBersih >= 0 ? "var(--in-text)" : "var(--out-text)" }}>
                {nfProfit.labaBersih >= 0 ? "▲ " : "▼ "}{fmtMoney(Math.abs(nfProfit.labaBersih), cur)}
              </span>
            </div>
            {(nfProfit.prive > 0 || nfProfit.transfer > 0 || nfProfit.capex > 0 || nfProfit.capital > 0) && (
              <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--line)", background: "#FFFBEB" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 6 }}>Tidak mengurangi laba NF</div>
                {nfProfit.capital > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#78350F", marginBottom: 4 }}>
                    <span>Modal / pinjaman masuk</span>
                    <span className="money">{fmtMoney(nfProfit.capital, cur)}</span>
                  </div>
                )}
                {nfProfit.prive > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#78350F", marginBottom: 4 }}>
                    <span>Prive / transfer owner</span>
                    <span className="money">{fmtMoney(nfProfit.prive, cur)}</span>
                  </div>
                )}
                {nfProfit.transfer > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#78350F", marginBottom: 4 }}>
                    <span>Transfer internal</span>
                    <span className="money">{fmtMoney(nfProfit.transfer, cur)}</span>
                  </div>
                )}
                {nfProfit.capex > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#78350F" }}>
                    <span>Pembelian alat</span>
                    <span className="money">{fmtMoney(nfProfit.capex, cur)}</span>
                  </div>
                )}
              </div>
            )}
            {nfProfit.warnings?.length > 0 && (
              <div style={{ padding: "10px 16px", borderTop: "1px solid #FDE68A", background: "#FFFBEB" }}>
                {nfProfit.warnings.map((w) => (
                  <div key={w} style={{ fontSize: 11, color: "#92400E", lineHeight: 1.45, display: "flex", gap: 6, marginBottom: 4 }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 6, lineHeight: 1.45 }}>
            Omzet bersih = penjualan − diskon/retur/refund. Prive owner hanya memengaruhi arus kas, bukan laba.
          </div>
        </div>
      )}

      {showNfLabaRugi && nfChannels && (
        <NfChannelBreakdownCard
          breakdown={nfChannels}
          mpStores={s.mpStores}
          cur={cur}
          fmtMoney={fmtMoney}
          variant="full"
        />
      )}

      <div style={{ margin: "12px 16px 0" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink2)", marginBottom: 8 }}>
          {showNfLabaRugi ? "Arus Kas" : "Ringkasan"}
        </div>
        <Card style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ padding: "14px 16px", borderRight: "1px solid var(--line)" }}>
              <div style={{ fontSize: 12, color: "var(--ink2)", display: "flex", alignItems: "center", gap: 4 }}><TrendingUp size={13} color="var(--in)" /> Pemasukan</div>
              <div className="money" style={{ fontSize: 20, fontWeight: 800, color: "var(--in-text)", marginTop: 4 }}>{fmtMoney(inSum, cur)}</div>
            </div>
            <div style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--ink2)", display: "flex", alignItems: "center", gap: 4 }}><TrendingDown size={13} color="var(--out)" /> Pengeluaran</div>
              <div className="money" style={{ fontSize: 20, fontWeight: 800, color: "var(--out-text)", marginTop: 4 }}>{fmtMoney(outSum, cur)}</div>
            </div>
          </div>
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--surface2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, color: "var(--ink)" }}>{showNfLabaRugi ? "Arus kas bersih" : "Laba Bersih"}</span>
            <span className="money" style={{ fontSize: 20, fontWeight: 800, color: net >= 0 ? "var(--in-text)" : "var(--out-text)" }}>
              {net >= 0 ? "▲ " : "▼ "}{fmtMoney(Math.abs(net), cur)}
            </span>
          </div>
        </Card>
        <ShareWaBtn text={waKeuangan} />
        <div style={{ fontSize: 11, color: "var(--ink3)", textAlign: "center", marginTop: 8, lineHeight: 1.4 }}>
          Kirim ringkasan ke grup WA — tidak perlu ketik ulang.
        </div>
      </div>

      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginBottom: 10 }}>
          Rincian transaksi ({txSorted.length})
          {canManageTx && (
            <span style={{ fontWeight: 500, color: "var(--ink3)", fontSize: 11, marginLeft: 6 }}>· tap untuk edit/hapus</span>
          )}
        </div>
        {txSorted.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--ink3)", fontSize: 13, padding: "24px 0" }}>
            Belum ada transaksi pada periode ini.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {txSorted.slice(0, 50).map(t => {
              const cat = s.categories.find(c => c.id === t.categoryId);
              const w = s.wallets.find(x => x.id === t.walletId);
              const isTrf = t.type === "transfer";
              const isIn = t.type === "in";
              const visual = resolveTxVisual(t, cat, s.wallets);
              const policy = canManageTx ? getTransactionEditPolicy(t) : null;
              const { from, to } = isTrf ? resolveTransferIds(t) : {};
              const fromW = isTrf ? s.wallets.find(x => x.id === from) : null;
              const toW = isTrf ? s.wallets.find(x => x.id === to) : null;
              return (
                <Card key={t.id} onClick={canManageTx && policy?.canEdit ? () => setEditTx(t) : undefined}
                  style={{ padding: "12px 14px", cursor: canManageTx && policy?.canEdit ? "pointer" : "default", opacity: policy && !policy.canEdit ? 0.72 : 1 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <TxRowIcon visual={visual} size={36} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>
                          {isPurchasingTx(t) ? purchasingTxTitle(t) : (t.desc || cat?.name || (isTrf ? "Transfer" : "Transaksi"))}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3 }}>
                          {isTrf
                            ? `${fromW?.name || "—"} → ${toW?.name || "—"}`
                            : isPurchasingTx(t)
                              ? `${purchasingTxSubtitle(t, cat, w)}`
                              : `${cat?.name || "—"} · ${foodWalletDisplayName(w)}`}
                          {" · "}{shortDate(t.date)}
                          {t.source && (
                            <span style={t.source === "Sesuaikan Saldo" ? { color: "var(--out-text)", fontWeight: 700 } : undefined}>
                              {" · "}{t.source === "Sesuaikan Saldo" ? "Penyesuaian manual (recovery)" : t.source}
                            </span>
                          )}
                        </div>
                        {canManageTx && policy && !policy.canEdit && (
                          <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 4 }}>Terkunci — {policy.reason}</div>
                        )}
                      </div>
                      <div className="money" style={{ fontWeight: 800, fontSize: 14, color: isTrf ? "var(--brand)" : isIn ? "var(--in-text)" : "var(--out-text)", flexShrink: 0 }}>
                        {isTrf ? "⇄ " : ""}{fmtMoney(t.amount, cur)}
                      </div>
                    </div>
                    {canManageTx && policy?.canEdit && <ChevronRight size={16} color="var(--ink3)" style={{ flexShrink: 0, marginTop: 4 }} />}
                  </div>
                </Card>
              );
            })}
            {txSorted.length > 50 && (
              <div style={{ fontSize: 12, color: "var(--ink3)", textAlign: "center", padding: 8 }}>
                +{txSorted.length - 50} transaksi lainnya — export via PC untuk lihat semua
              </div>
            )}
          </div>
        )}
      </div>

      {editTx && (
        <TransactionEditSheet
          tx={editTx}
          s={s}
          onClose={() => setEditTx(null)}
          onSave={(id, patch) => {
            const existing = (s.transactions || []).find((t) => t.id === id);
            if (!existing) {
              showActionToast("Transaksi tidak ditemukan.", "error");
              return false;
            }
            const errMsg = validateTransactionUpdate(existing, patch, { wallets: s.wallets, transactions: s.transactions });
            if (errMsg) {
              showActionToast(errMsg, "error");
              return false;
            }
            mutate((st) => {
              const i = st.transactions.findIndex((t) => t.id === id);
              if (i >= 0) st.transactions[i] = normalizeTransaction({ ...st.transactions[i], ...patch });
            });
            scheduleImmediateSave({ critical: true });
            showActionToast("Perubahan transaksi disimpan.", "success");
            setEditTx(null);
            return true;
          }}
          onDelete={(id) => {
            const existing = (s.transactions || []).find((t) => t.id === id);
            if (!existing || !getTransactionEditPolicy(existing).canDelete) {
              showActionToast("Transaksi ini tidak bisa dihapus.", "error");
              return false;
            }
            mutate((st) => {
              applyTransactionDelete(st, id);
            });
            scheduleImmediateSave({ critical: true });
            showActionToast("Transaksi dihapus · saldo dompet sudah disesuaikan.", "success");
            setEditTx(null);
            return true;
          }}
        />
      )}
    </div>
  );
}

// ─── Analisis ──────────────────────────────────────────────
const INSIGHT_COLORS = {
  danger: { bg: "#FEF9C3", border: "#FDE047", ic: "#CA8A04" },
  warn: { bg: "#FFF7ED", border: "#FED7AA", ic: "#D97706" },
  ok: { bg: "#F0FDF4", border: "#BBF7D0", ic: "#16A34A" },
  info: { bg: "#EFF6FF", border: "#BFDBFE", ic: "#2563EB" },
};

function InsightCard({ it, onHide }) {
  const colors = INSIGHT_COLORS[it.tone] || INSIGHT_COLORS.warn;
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ width: 38, height: 38, borderRadius: 99, background: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <AlertTriangle size={18} color={colors.ic} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: colors.ic }}>{it.title}</div>
        <div style={{ fontSize: 14, color: "var(--ink)", marginTop: 4, lineHeight: 1.5 }}>{it.body}</div>
      </div>
      {onHide && (
        <button type="button" onClick={() => onHide(it.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink3)" }}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function Analisis({ s, hideInsight }) {
  const cur = s.profile.currency;
  const user = s.currentUser || { role: "kasir" };
  const [days, setDays] = useState(7);
  const [aiState, setAiState] = useState("idle");
  const [aiAdvice, setAiAdvice] = useState(null);
  const [aiErr, setAiErr] = useState("");

  const biz = useMemo(() => buildBusinessAnalysis(s, { days }), [s, days]);

  const financeInsights = useMemo(() => {
    const tx = visibleTransactions(s.transactions, s.wallets, user).filter(t => t.type !== "transfer");
    const list = [];
    const last3 = [today(), isoOffset(-1), isoOffset(-2)];
    if (canDo(user.role, "inputIncome") && tx.filter(t => t.type === "in" && last3.includes(t.date)).length === 0)
      list.push({ id: "no_inc", category: "keuangan", tone: "warn", title: "Perhatian", body: "📋 Belum ada pencatatan pemasukan 3 hari ini. Jangan sampai ada transaksi yang terlewat ya!" });
    const wNow = tx.filter(t => t.type === "out" && t.date >= isoOffset(-6)).reduce((a, b) => a + b.amount, 0);
    const wPrev = tx.filter(t => t.type === "out" && t.date >= isoOffset(-13) && t.date < isoOffset(-6)).reduce((a, b) => a + b.amount, 0);
    if (wPrev > 0 && wNow > wPrev * 1.25)
      list.push({ id: "spike", category: "keuangan", tone: "warn", title: "Pengeluaran naik", body: `🔺 Pengeluaran minggu ini naik ${Math.round((wNow / wPrev - 1) * 100)}% dibanding minggu lalu.` });
    const m = today().slice(0, 7);
    const mIn = tx.filter(t => t.type === "in" && t.date.startsWith(m)).reduce((a, b) => a + b.amount, 0);
    const mOut = tx.filter(t => t.type === "out" && t.date.startsWith(m)).reduce((a, b) => a + b.amount, 0);
    if (canDo(user.role, "inputIncome") && mIn > 0 && mOut > mIn)
      list.push({ id: "neg", category: "keuangan", tone: "danger", title: "Arus kas negatif", body: `⚠️ Pengeluaran bulan ini melebihi pemasukan ${fmtMoney(mOut - mIn, cur)}.` });
    return list.filter(x => !(s.hiddenInsights || []).includes(x.id));
  }, [s, user, cur]);

  const handlePeriodeChange = (d) => {
    setDays(d);
    setAiState("idle");
    setAiAdvice(null);
    setAiErr("");
  };

  const handleAnalisis = useCallback(async () => {
    setAiState("loading");
    setAiErr("");
    try {
      const tx = visibleTransactions(s.transactions, s.wallets, user).filter(t => t.type !== "transfer");
      const result = await fetchBusinessAnalysis({
        analysis: biz,
        financeInsights,
        role: user.role,
        transactions: tx,
      });
      setAiAdvice(result);
      setAiState("done");
    } catch (e) {
      setAiErr(e.message || "Gagal memuat saran AI");
      setAiState("error");
    }
  }, [biz, financeInsights, user.role, s.transactions, s.wallets, user]);

  const allInsights = useMemo(() => {
    const merged = [
      ...financeInsights,
      ...biz.insights.filter(x => !(s.hiddenInsights || []).includes(x.id)),
    ];
    if (merged.length === 0) {
      merged.push({ id: "ok", category: "keuangan", tone: "ok", title: "Semua aman", body: "✅ Data operasional terpantau baik. Pertahankan disiplin input harian." });
    }
    return merged;
  }, [financeInsights, biz.insights, s.hiddenInsights]);

  const fmtRp = (n) => fmtMoney(n, cur);
  const priColor = { tinggi: "#DC2626", sedang: "#D97706", rendah: "#2563EB" };
  const healthColor = aiAdvice?.healthLabel === "Sehat" ? "#16A34A" : aiAdvice?.healthLabel === "Waspada" ? "#D97706" : "#DC2626";

  return (
    <div style={{ padding: "0 0 90px" }}>
      <div style={{ padding: "16px 20px 4px" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>Analisis Usaha</div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 2 }}>
          AI keputusan · komplain · omset vs SDM · {biz.period.from} s/d {biz.period.to}
        </div>
      </div>

      <div style={{ padding: "8px 16px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[7, 14, 30, 90, 365].map(d => (
          <button key={d} type="button" onClick={() => handlePeriodeChange(d)}
            style={{ padding: "8px 14px", borderRadius: 99, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12,
              background: days === d ? "#6366F1" : "var(--surface)", color: days === d ? "#fff" : "var(--ink2)",
              boxShadow: days === d ? "0 2px 8px rgba(99,102,241,.35)" : "none" }}>
            {d === 365 ? "1 tahun" : `${d} hari`}
          </button>
        ))}
      </div>

      {/* Rekomendasi AI — manual trigger, tidak auto-generate */}
      <div style={{ padding: "0 16px 12px" }}>
        <Card style={{ padding: 0, overflow: "hidden", border: "1px solid #C7D2FE" }}>
          <div style={{ background: "linear-gradient(135deg,#5B5BD6,#7C7CF8)", padding: "16px 18px", color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Sparkles size={22} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Rekomendasi Keputusan</div>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                  {aiState === "loading"
                    ? "Memuat…"
                    : aiState === "idle"
                      ? `Tap untuk analisis ${days} hari terakhir`
                      : aiAdvice?.source === "ai"
                        ? "Claude AI · bantu prioritaskan langkah"
                        : aiAdvice
                          ? "Cadangan otomatis (AI offline / tanpa key)"
                          : aiState === "error"
                            ? "Gagal memuat analisis"
                            : ""}
                </div>
              </div>
              {aiState === "done" && aiAdvice?.healthScore != null && (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{aiAdvice.healthScore}/10</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: healthColor, background: "#fff", padding: "2px 8px", borderRadius: 99, marginTop: 2 }}>
                    {aiAdvice.healthLabel}
                  </div>
                </div>
              )}
              {aiState === "idle" && (
                <button type="button" onClick={handleAnalisis}
                  style={{ padding: "8px 14px", borderRadius: 99, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, background: "#fff", color: "#5B5BD6", flexShrink: 0 }}>
                  Analisis →
                </button>
              )}
              {aiState === "done" && (
                <button type="button" onClick={handleAnalisis} title="Refresh analisis"
                  style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 15, flexShrink: 0 }}>
                  ↺
                </button>
              )}
            </div>
          </div>
          <div style={{ padding: "16px 18px" }}>
            {aiState === "loading" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink3)", fontSize: 14 }}>
                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Claude menganalisis data…
              </div>
            )}
            {aiState === "error" && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "#B91C1C", fontSize: 13, marginBottom: 10 }}>{aiErr || "Gagal menghubungi AI"}</div>
                <button type="button" onClick={handleAnalisis}
                  style={{ padding: "8px 14px", borderRadius: 99, border: "1px solid var(--line)", cursor: "pointer", fontWeight: 700, fontSize: 12, background: "var(--surface)", color: "var(--ink2)" }}>
                  Coba lagi
                </button>
              </div>
            )}
            {aiState === "idle" && (
              <div style={{ fontSize: 13, color: "var(--ink3)", lineHeight: 1.5 }}>
                Tekan <strong style={{ color: "var(--ink2)" }}>Analisis →</strong> untuk minta Claude mengevaluasi data {days} hari terakhir. Perbandingan omset memakai hari yang sama minggu lalu (Sabtu vs Sabtu, dll).
              </div>
            )}
            {aiState === "done" && aiAdvice && (
              <>
                <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.55, marginBottom: 14 }}>{aiAdvice.executiveSummary}</div>
                {(aiAdvice.decisions || []).length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink2)", marginBottom: 8, letterSpacing: "0.04em" }}>KEPUTUSAN PRIORITAS</div>
                    {(aiAdvice.decisions || []).map((d, i) => (
                      <div key={i} style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, color: "#fff", background: priColor[d.priority] || "#6B7280" }}>
                            {(d.priority || "sedang").toUpperCase()}
                          </span>
                          {d.outlet && <span style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 700 }}>{OUTLET_LABEL[d.outlet] || d.outlet}</span>}
                        </div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>{d.title}</div>
                        <div style={{ fontSize: 13, color: "var(--brand)", marginTop: 4, fontWeight: 600 }}>→ {d.action}</div>
                        {d.reason && d.reason !== d.action && (
                          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4, lineHeight: 1.4 }}>{d.reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {aiAdvice.risks?.length > 0 && (
                  <div style={{ fontSize: 13, marginBottom: 10 }}>
                    <span style={{ fontWeight: 800, color: "#DC2626" }}>Risiko: </span>
                    <span style={{ color: "var(--ink2)" }}>{aiAdvice.risks.join(" · ")}</span>
                  </div>
                )}
                {aiAdvice.opportunities?.length > 0 && (
                  <div style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 800, color: "#16A34A" }}>Peluang: </span>
                    <span style={{ color: "var(--ink2)" }}>{aiAdvice.opportunities.join(" · ")}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {/* KPI ringkas */}
      <div style={{ padding: "0 16px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          ["Omset vs target", biz.kpis.globalAchievement != null ? `${biz.kpis.globalAchievement}%` : "—", biz.kpis.pairedDays ? `${biz.kpis.underTargetDays}/${biz.kpis.pairedDays} hari under` : "Belum ada pasangan omset+SDM"],
          ["Komplain", String(biz.kpis.totalComplaints), biz.kpis.wellDoneDays ? `${biz.kpis.wellDoneDays} hari Well-done ✅` : "dari laporan sosmed"],
          ["Pertanyaan", String(biz.kpis.totalQuestions), "topik sering ditanya pelanggan"],
          ["Omset total", biz.kpis.totalOmset ? fmtRp(biz.kpis.totalOmset) : "—", `${days} hari · semua outlet`],
        ].map(([label, val, sub]) => (
          <Card key={label} style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--ink3)", fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", marginTop: 4 }}>{val}</div>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2, lineHeight: 1.35 }}>{sub}</div>
          </Card>
        ))}
      </div>

      {/* Per outlet */}
      <div style={{ padding: "4px 16px 8px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginBottom: 8 }}>Per outlet</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {OUTLETS.map(o => {
            const st = biz.outletStats[o];
            if (!st || st.dataDays === 0) return (
              <Card key={o} style={{ padding: "14px 16px", opacity: .75 }}>
                <div style={{ fontWeight: 800, color: "var(--ink)" }}>{st?.label || o}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>Belum ada input omset/SDM/sosmed {days} hari terakhir.</div>
              </Card>
            );
            return (
              <Card key={o} style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>{st.label}</div>
                  {st.avgAchievement != null && (
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 99,
                      background: st.avgAchievement >= 95 ? "#DCFCE7" : st.avgAchievement >= 85 ? "#FEF3C7" : "#FEE2E2",
                      color: st.avgAchievement >= 95 ? "#15803D" : st.avgAchievement >= 85 ? "#D97706" : "#DC2626" }}>
                      {st.avgAchievement}% target
                    </span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, fontSize: 12 }}>
                  <div><span style={{ color: "var(--ink3)" }}>Omset rata-rata</span><div style={{ fontWeight: 700, color: "var(--ink)" }}>{st.avgOmset ? fmtRp(st.avgOmset) : "—"}</div></div>
                  <div><span style={{ color: "var(--ink3)" }}>Rasio SDM</span><div style={{ fontWeight: 700, color: st.sdmWarningDays ? "#DC2626" : "var(--ink)" }}>{st.avgSdmRatio != null ? `${st.avgSdmRatio.toFixed(1).replace(".", ",")}%` : "—"}</div></div>
                  <div><span style={{ color: "var(--ink3)" }}>Komplain</span><div style={{ fontWeight: 700, color: st.complaintCount ? "#DC2626" : "var(--ink)" }}>{st.complaintCount}</div></div>
                  <div><span style={{ color: "var(--ink3)" }}>Pertanyaan</span><div style={{ fontWeight: 700, color: "var(--ink)" }}>{st.questionCount}</div></div>
                </div>
                {st.reviewAvg != null && (
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 8 }}>Google review rata-rata {st.reviewAvg.toFixed(1)}★ · {st.reviewBad} buruk / {st.reviewGood} bagus</div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Suara pelanggan */}
      {(biz.customerVoice.topComplaints.length > 0 || biz.customerVoice.topQuestions.length > 0) && (
        <div style={{ padding: "12px 16px 8px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginBottom: 8 }}>Suara pelanggan</div>
          {biz.customerVoice.topComplaints.length > 0 && (
            <Card style={{ padding: "14px 16px", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#DC2626", marginBottom: 8 }}>Komplain sering</div>
              {biz.customerVoice.topComplaints.map((c, i) => (
                <div key={i} style={{ fontSize: 13, color: "var(--ink)", padding: "6px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  {c.text} <span style={{ color: "var(--ink3)", fontSize: 11 }}>({c.count}×)</span>
                </div>
              ))}
            </Card>
          )}
          {biz.customerVoice.topQuestions.length > 0 && (
            <Card style={{ padding: "14px 16px" }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#2563EB", marginBottom: 8 }}>Pertanyaan sering</div>
              {biz.customerVoice.topQuestions.map((q, i) => (
                <div key={i} style={{ fontSize: 13, color: "var(--ink)", padding: "6px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  {q.text} <span style={{ color: "var(--ink3)", fontSize: 11 }}>({q.count}×)</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* Insight */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 10 }}>{allInsights.length} insight</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {allInsights.map(it => (
            <InsightCard key={it.id} it={it} onHide={hideInsight} />
          ))}
        </div>
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink3)", marginTop: 32 }}>
          NF3 · Claude AI + cadangan otomatis · omset, SDM, sosmed & keuangan
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

// ─── Catat Transaksi ───────────────────────────────────────
const MAX_SCAN_NOTA = 10;
const scanNotaStorageKey = (bizId, userId) => `nf3_scan_nota_${bizId || "local"}_${userId || "anon"}_${today()}`;

function getScanNotaUsed(bizId, userId) {
  if (typeof window === "undefined") return 0;
  return Math.min(MAX_SCAN_NOTA, parseInt(localStorage.getItem(scanNotaStorageKey(bizId, userId)) || "0", 10) || 0);
}

function bumpScanNotaUsed(bizId, userId) {
  const next = Math.min(MAX_SCAN_NOTA, getScanNotaUsed(bizId, userId) + 1);
  localStorage.setItem(scanNotaStorageKey(bizId, userId), String(next));
  return next;
}

function CatatTransaksi({ s, bizId, mutate, onSave, onNotify, onClose, business, features }) {
  const role = s.currentUser?.role || "kasir";
  const isKasir = role === "kasir";
  const expenseOnly = isKasir || role === "purchasing";
  const [mode, setMode] = useState(isKasir ? "manual" : "voice");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const userId = s.currentUser?.id || "";
  const [scanUsed, setScanUsed] = useState(() => getScanNotaUsed(bizId, userId));
  const scanFull = scanUsed >= MAX_SCAN_NOTA;
  const scanLabel = `Scan Nota (${scanUsed}/${MAX_SCAN_NOTA})`;

  const runText = async (text) => {
    setErr(""); setBusy(true);
    try {
      const r = await aiParseText(text, s.categories);
      const txType = expenseOnly ? "out" : r.type;
      const cats = visibleCategoriesForBusiness(s.categories, s.currentUser, txType, business);
      const cat = cats.find(c => c.name.toLowerCase() === (r.category || "").toLowerCase()) || cats[0];
      const myW = visibleWalletsForBusiness(s.wallets, s.currentUser, business);
      setDraft({ type: txType, categoryId: cat?.id, amount: r.amount, desc: r.desc, walletId: myW[0]?.id, date: today(), source: text });
    } catch { setErr("Gagal memahami. Coba lagi."); }
    setBusy(false);
  };
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr("Browser ini belum support voice. Ketik manual."); return; }
    const rec = new SR(); recRef.current = rec; rec.lang = "id-ID"; rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onerror = () => { setListening(false); setErr("Suara tidak terdengar. Coba ketik."); };
    rec.onend = () => setListening(false);
    rec.onresult = (e) => { setListening(false); runText(e.results[0][0].transcript); };
    rec.start();
  };
  const onPhoto = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (scanFull) {
      setErr(`Batas scan nota hari ini (${MAX_SCAN_NOTA}x) sudah habis. Gunakan manual${role !== "purchasing" ? " atau bicara" : ""}.`);
      e.target.value = "";
      return;
    }
    setBusy(true); setErr("");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
      const r = await aiParseReceipt(b64, f.type, s.categories);
      const txType = expenseOnly ? "out" : (r.type || "out");
      const cats = visibleCategoriesForBusiness(s.categories, s.currentUser, txType, business);
      const cat = cats.find(c => c.name.toLowerCase() === (r.category || "").toLowerCase()) || cats[0];
      const myW = visibleWalletsForBusiness(s.wallets, s.currentUser, business);
      setScanUsed(bumpScanNotaUsed(bizId, userId));
      setDraft({ type: txType, categoryId: cat?.id, amount: r.amount, desc: r.desc, walletId: myW[0]?.id, date: r.date || today(), source: "Scan nota" });
    } catch { setErr("Nota tidak terbaca. Coba foto ulang."); }
    setBusy(false);
    e.target.value = "";
  };

  if (draft) return (
    <Sheet title="Tinjau & Simpan" onClose={() => { if (!busy) setDraft(null); }}>
      <div style={{ padding: "20px 16px" }}>
        <Card style={{ padding: 20, textAlign: "center" }}>
          {draft.type === "transfer" ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "var(--brand)", textTransform: "uppercase" }}>Transfer</div>
              <div className="money" style={{ fontSize: 36, fontWeight: 800, color: "var(--brand)", margin: "8px 0" }}>{fmtMoney(draft.amount, s.profile.currency)}</div>
              <div style={{ fontSize: 14, color: "var(--ink2)" }}>
                {s.wallets.find(w => w.id === draft.fromWalletId)?.name}
                {" → "}
                {s.wallets.find(w => w.id === draft.toWalletId)?.name}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: draft.type === "in" ? "var(--in-text)" : "var(--out-text)", textTransform: "uppercase" }}>{draft.type === "in" ? "Pemasukan" : "Pengeluaran"}</div>
              <div className="money" style={{ fontSize: 36, fontWeight: 800, color: draft.type === "in" ? "var(--in-text)" : "var(--out-text)", margin: "8px 0" }}>{fmtMoney(draft.amount, s.profile.currency)}</div>
              <div style={{ fontWeight: 600, color: "var(--ink)" }}>{draft.desc}</div>
              <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4 }}>
                {s.categories.find(c => c.id === draft.categoryId)?.name} · {s.wallets.find(w => w.id === draft.walletId)?.name}
                {draft.meta?.storeName && ` · ${draft.meta.storeName}`}
              </div>
            </>
          )}
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
          <button type="button" disabled={busy} onClick={() => setDraft(null)} style={{ padding: 14, borderRadius: 14, border: "1px solid var(--line)", background: "var(--surface)", fontWeight: 600, color: "var(--ink)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.65 : 1 }}>← Edit lagi</button>
          <button type="button" disabled={busy} onClick={async () => {
            if (busy) return;
            setBusy(true);
            setErr("");
            try {
              const ok = await onSave(draft);
              if (ok) onClose();
              else setErr(isKasir ? "Hanya pengeluaran laci. Omset lewat Laporan Omset." : "Transaksi tidak diizinkan untuk role Anda.");
            } finally {
              setBusy(false);
            }
          }} style={{ padding: 14, borderRadius: 14, border: "none", background: "var(--brand)", fontWeight: 700, color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy ? 0.75 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {busy ? <><Loader2 size={18} className="animate-spin" />Menyimpan…</> : <><Check size={18} />Simpan</>}
          </button>
        </div>
        {err && <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>{err}</div>}
      </div>
    </Sheet>
  );

  return (
    <Sheet title="Catat Transaksi" onClose={onClose}>
      <div style={{ padding: "20px 16px 120px" }}>
        {role === "purchasing" && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: "#FEF3C7", fontSize: 12, color: "#92400E", lineHeight: 1.45 }}>
            Belanja real — saldo dompet berkurang. Gunakan <b>suara</b> atau isi manual. Scan AI nota tidak tersedia untuk purchasing.
          </div>
        )}
        {isKasir && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: "var(--brand-soft)", fontSize: 12, color: "var(--brand-text)", lineHeight: 1.45 }}>
            Isi pengeluaran laci di bawah. <b>Omset harian</b> lewat kartu <b>Laporan Omset</b> di Beranda — bukan di sini.
          </div>
        )}
        {mode === "voice" && (
          <Card style={{ padding: 20, background: "var(--surface2)", border: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: "var(--brand-soft)", display: "grid", placeItems: "center", color: "var(--brand)" }}><Sparkles size={20} /></div>
              <span style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>Coba ucapkan…</span>
            </div>
            {[["Kulakan bahan setengah juta", ShoppingCart], ["Token listrik 50 ribu", Zap], ["Beli kemasan 200 ribu", ShoppingCart], ...(expenseOnly ? [] : [["Jual nasi bungkus 15 ribu", Store]])].map(([ex, Ic], i, arr) => (
              <button key={i} onClick={() => runText(ex)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 0", background: "none", border: "none", borderBottom: i < arr.length - 1 ? `1px solid var(--line)` : "none", cursor: "pointer", textAlign: "left" }}>
                <div style={{ width: 36, height: 36, borderRadius: 99, background: "var(--surface)", display: "grid", placeItems: "center", color: "var(--ink2)" }}><Ic size={16} /></div>
                <span style={{ color: "var(--ink)", fontWeight: 500 }}>"{ex}"</span>
              </button>
            ))}
            <div style={{ fontSize: 13, color: "var(--brand)", fontWeight: 600, marginTop: 14 }}>Tips: Sebutkan barang + nominal uangnya.</div>
          </Card>
        )}
        {mode === "manual" && <ManualForm s={s} mutate={mutate} onNotify={onNotify} onReady={setDraft} business={business} features={features} />}
        {mode === "scan" && role !== "purchasing" && !isKasir && (
          <Card style={{ padding: 40, textAlign: "center", background: "var(--surface2)", border: "none" }}>
            <ScanLine size={44} color="var(--brand)" style={{ margin: "0 auto 12px" }} />
            <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 16, marginBottom: 6 }}>Foto / pilih nota</div>
            <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 20 }}>
              {scanFull
                ? `Kuota scan hari ini habis (${MAX_SCAN_NOTA}/${MAX_SCAN_NOTA}). Reset besok.`
                : "Claude akan baca total, merchant, dan tanggal."}
            </div>
            <label style={{ display: "inline-block", padding: "11px 24px", borderRadius: 99, background: scanFull ? "var(--line)" : "var(--brand)", color: scanFull ? "var(--ink3)" : "#fff", fontWeight: 700, cursor: scanFull ? "not-allowed" : "pointer", fontSize: 14, opacity: scanFull ? 0.7 : 1 }}>
              Pilih gambar<input type="file" accept="image/*" capture="environment" disabled={scanFull} style={{ display: "none" }} onChange={onPhoto} />
            </label>
          </Card>
        )}
        {mode === "voice" && (
          <div style={{ marginTop: 16 }}>
            <input placeholder="…atau ketik di sini lalu Enter"
              onKeyDown={e => { if (e.key === "Enter" && e.target.value.trim()) runText(e.target.value.trim()); }}
              style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
          </div>
        )}
        {busy && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--brand)", marginTop: 20, fontWeight: 600 }}><Loader2 size={18} className="animate-spin" />Membaca…</div>}
        {err && <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13, fontWeight: 500 }}>{err}</div>}
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink3)", marginTop: 20 }}>Powered by NF3</div>
      </div>

      {!isKasir && (
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "var(--surface)", borderTop: "1px solid var(--line)",
        padding: "12px 24px 24px",
        display: "grid",
        gridTemplateColumns: role === "purchasing" ? "1fr auto" : "1fr auto 1fr",
        alignItems: "flex-end",
      }}>
        <div style={{ justifySelf: "start" }}>
          <ModeBtn active={mode === "manual"} onClick={() => { setMode("manual"); setErr(""); }} Icon={Keyboard} label="Manual" />
        </div>
        {role !== "purchasing" && (
          <div style={{ justifySelf: "center" }}>
            <button onClick={() => { setMode("voice"); startVoice(); }} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", marginBottom: -6 }}>
              {listening && <span className="pulse-ring" style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--brand)", width: 60, height: 60, top: -6 }} />}
              <span style={{ width: 60, height: 60, borderRadius: 99, background: "linear-gradient(135deg,var(--brand),var(--brand-dark))", display: "grid", placeItems: "center", color: "#fff", position: "relative", boxShadow: "0 4px 16px rgba(99,102,241,.4)" }}><Mic size={26} /></span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)" }}>Bicara</span>
            </button>
          </div>
        )}
        {role === "purchasing" ? (
          <div style={{ justifySelf: "end" }}>
            <button
              type="button"
              onClick={() => { setMode("voice"); startVoice(); }}
              style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", marginBottom: -6 }}
            >
              {listening && <span className="pulse-ring" style={{ position: "absolute", inset: 0, borderRadius: 99, background: "var(--brand)", width: 60, height: 60, top: -6 }} />}
              <span style={{ width: 60, height: 60, borderRadius: 99, background: "linear-gradient(135deg,var(--brand),var(--brand-dark))", display: "grid", placeItems: "center", color: "#fff", position: "relative", boxShadow: "0 4px 16px rgba(99,102,241,.4)" }}><Mic size={26} /></span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand)" }}>Bicara</span>
            </button>
          </div>
        ) : (
        <div style={{ justifySelf: "end" }}>
          <ModeBtn
            active={mode === "scan"}
            disabled={scanFull}
            onClick={() => {
              if (scanFull) { setErr(`Batas scan nota hari ini (${MAX_SCAN_NOTA}x) sudah habis.`); return; }
              setMode("scan"); setErr("");
            }}
            Icon={ScanLine}
            label={scanLabel}
          />
        </div>
        )}
      </div>
      )}
    </Sheet>
  );
}

const ModeBtn = ({ active, onClick, Icon, label, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }}>
    <span style={{ width: 46, height: 46, borderRadius: 99, background: active ? "var(--brand-soft)" : "var(--surface2)", display: "grid", placeItems: "center", color: active ? "var(--brand)" : "var(--ink3)" }}><Icon size={20} /></span>
    <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? "var(--brand)" : "var(--ink3)", textAlign: "center", maxWidth: 88, lineHeight: 1.2 }}>{label}</span>
  </button>
);

function ManualForm({ s, mutate, onNotify, onReady, business, features }) {
  const role = s.currentUser?.role || "kasir";
  const myWallets = visibleWalletsForBusiness(s.wallets, s.currentUser, business);
  const nfChannelFinance = useMemo(() => {
    if (features?.nfChannelFinance === true) return true;
    return isNfFishingBusiness(business, {
      wallets: s.wallets,
      categories: s.categories,
      walletSetup: s.walletSetup,
      profile: s.profile,
    });
  }, [features?.nfChannelFinance, business, s.wallets, s.categories, s.walletSetup, s.profile]);

  const allowedTypes = [];
  if (canDo(role, "inputIncome")) allowedTypes.push(["in", "Pemasukan"]);
  if (canDo(role, "inputExpense")) allowedTypes.push(["out", "Pengeluaran"]);
  if (canDo(role, "transfer")) allowedTypes.push(["transfer", "Transfer"]);
  if (allowedTypes.length === 0) allowedTypes.push(["out", "Pengeluaran"]);

  const [type, setType] = useState(allowedTypes[0][0]);
  const [amt, setAmt] = useState("");
  const [catId, setCatId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [walletId, setWalletId] = useState(myWallets[0]?.id || "");
  const [toWalletId, setToWalletId] = useState(myWallets[1]?.id || "");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState(today());
  const [floorErr, setFloorErr] = useState("");

  const walletIds = myWallets.map((w) => w.id).join("|");
  const transferTargetWallets = myWallets.filter((w) => w.id !== walletId);
  const transferTargetIds = transferTargetWallets.map((w) => w.id).join("|");

  useEffect(() => {
    setWalletId((prev) => (myWallets.some((w) => w.id === prev) ? prev : myWallets[0]?.id || ""));
  }, [walletIds]);

  useEffect(() => {
    if (type !== "transfer") return;
    setToWalletId((prev) => {
      if (transferTargetWallets.some((w) => w.id === prev)) return prev;
      const preferred = walletId === "w_kas_besar" ? transferTargetWallets.find(isKasKecilWallet) : null;
      return (preferred || transferTargetWallets[0])?.id || "";
    });
  }, [type, walletId, transferTargetIds]);

  const cats = useMemo(() => {
    const txType = type === "transfer" ? "out" : type;
    const ctx = nfBusinessContext(s);
    if (txType === "in") {
      return visibleNfIncomeCategories(s.categories, s.currentUser, business, {
        nfChannelFinance,
        features,
        ...ctx,
      });
    }
    return visibleCategoriesForBusiness(s.categories, s.currentUser, txType, business);
  }, [s, business, features, type, nfChannelFinance]);
  const catIds = cats.map((c) => c.id).join("|");
  useEffect(() => {
    setCatId((prev) => (cats.some((c) => c.id === prev) ? prev : cats[0]?.id || ""));
  }, [type, catIds]);

  const selectedCat = cats.find((c) => c.id === catId);
  const incomeGroups = useMemo(() => {
    if (type !== "in" || !nfChannelFinance) return null;
    return groupNfIncomeCategories(cats);
  }, [type, nfChannelFinance, cats]);
  const storeOptions = useMemo(
    () => (nfChannelFinance && selectedCat ? mpStoresForCategory(catId, s.mpStores) : []),
    [nfChannelFinance, catId, selectedCat, s.mpStores]
  );
  const storeRequired = storeOptions.length > 0;

  useEffect(() => {
    if (type !== "in" || !selectedCat?.defaultWalletId) return;
    if (myWallets.some((w) => w.id === selectedCat.defaultWalletId)) {
      setWalletId(selectedCat.defaultWalletId);
    }
    setStoreId("");
  }, [catId, type, selectedCat?.defaultWalletId, walletIds]);

  const typeColors = { in: "var(--in)", out: "var(--out)", transfer: "var(--brand)" };
  const pillColor = typeColors[type];

  const checkAndReady = () => {
    if (type === "transfer") {
      const err = checkFloor(walletId, +amt, s.wallets, s.transactions, s.currentUser);
      if (err) { setFloorErr(err); return; }
      onReady({ type: "transfer", amount: +amt, fromWalletId: walletId, toWalletId, desc, date, source: "Manual" });
    } else {
      if (type === "out") {
        const err = checkFloor(walletId, +amt, s.wallets, s.transactions, s.currentUser);
        if (err) { setFloorErr(err); return; }
      }
      const incomeMeta = type === "in" && nfChannelFinance ? buildMpIncomeMeta(selectedCat, storeId, s.mpStores) : null;
      onReady({
        type,
        amount: +amt,
        categoryId: catId,
        walletId,
        desc,
        date,
        source: "Manual",
        ...(incomeMeta && Object.keys(incomeMeta).length ? { meta: incomeMeta } : {}),
      });
    }
    setFloorErr("");
  };

  const ready = amt && (type === "transfer"
    ? (walletId && toWalletId && walletId !== toWalletId)
    : (catId && (!storeRequired || storeId)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${allowedTypes.length},1fr)`, gap: 2, background: "var(--surface2)", borderRadius: 12, padding: 4 }}>
        {allowedTypes.map(([v, l]) => (
          <button key={v} type="button" onClick={() => { setType(v); setFloorErr(""); }} style={{ padding: 11, borderRadius: 9, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", background: type === v ? typeColors[v] : "transparent", color: type === v ? "#fff" : "var(--ink2)" }}>{l}</button>
        ))}
      </div>

      <Fld label="Nominal">
        <div style={{ display: "flex", alignItems: "center", border: `1px solid ${floorErr ? "var(--out)" : "var(--line)"}`, borderRadius: 12, background: "var(--surface)" }}>
          <span style={{ padding: "0 12px", color: "var(--ink3)", fontWeight: 700 }}>Rp</span>
          <input inputMode="numeric" value={amt ? new Intl.NumberFormat("id-ID").format(amt) : ""} onChange={e => { setAmt(e.target.value.replace(/\D/g, "")); setFloorErr(""); }} placeholder="0"
            style={{ flex: 1, minWidth: 0, padding: "13px 12px 13px 4px", background: "none", border: "none", fontSize: 18, fontWeight: 700, color: "var(--ink)", outline: "none" }} />
        </div>
        {floorErr && (
          <div style={{ marginTop: 6, padding: "8px 12px", borderRadius: 8, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 12, fontWeight: 600 }}>
            ⚠ {floorErr}
          </div>
        )}
      </Fld>

      {/* transfer: pilih from & to */}
      {type === "transfer" ? (
        <>
          <Fld label="Dari dompet">
            <select value={walletId} onChange={e => { setWalletId(e.target.value); setFloorErr(""); }}
              style={manualFieldInput}>
              {myWallets.map(w => {
                const bal = walletBalance(w.id, s.wallets, s.transactions);
                return <option key={w.id} value={w.id}>{walletOptionLabel(w, bal, s.profile.currency, s.currentUser, fmtMoney)}</option>;
              })}
            </select>
          </Fld>
          <Fld label="Ke dompet">
            <select value={toWalletId} onChange={e => setToWalletId(e.target.value)}
              style={manualFieldInput}>
              {transferTargetWallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Fld>
          {walletId && amt && (() => {
            const w = s.wallets.find(x => x.id === walletId);
            const bal = walletBalance(walletId, s.wallets, s.transactions);
            const after = bal - +amt;
            if (w?.floor && after < w.floor) return null; // sudah tampil di floorErr
            return (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--surface2)", fontSize: 12, color: "var(--ink2)" }}>
                Saldo setelah transfer: <b>Rp {new Intl.NumberFormat("id-ID").format(bal - +amt)}</b>
              </div>
            );
          })()}
        </>
      ) : (
        <>
          <Fld label="Kategori">
            <div
              className="scroll-hide"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxHeight: 280,
                overflowY: "auto",
                padding: 10,
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--surface2)",
              }}
            >
              {incomeGroups ? incomeGroups.map((grp) => (
                <div key={grp.id}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 6 }}>{grp.label}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {grp.categories.map((c) => (
                      <CatChip key={c.id} active={catId === c.id} color={pillColor} onClick={() => setCatId(c.id)}>
                        {c.name}
                      </CatChip>
                    ))}
                  </div>
                </div>
              )) : cats.map((c) => (
                <CatChip key={c.id} active={catId === c.id} color={pillColor} onClick={() => setCatId(c.id)}>
                  {c.name}
                </CatChip>
              ))}
            </div>
            {selectedCat?.hint && (
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink3)", lineHeight: 1.4 }}>{selectedCat.hint}</div>
            )}
            {mutate && (
              <CategoryQuickManage
                compact
                categories={s.categories}
                transactions={s.transactions}
                user={s.currentUser}
                txType={type}
                catId={catId}
                onSelectCat={setCatId}
                mutate={mutate}
                onNotify={onNotify}
              />
            )}
          </Fld>
          {storeOptions.length > 0 && (
            <Fld label={storeRequired ? "Toko MP" : "Toko MP (opsional)"}>
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                style={manualFieldInput}
              >
                <option value="">{storeRequired ? "— Pilih toko —" : "— Tanpa toko —"}</option>
                {storeOptions.map((st) => (
                  <option key={st.id} value={st.id}>{st.name} · {st.code}</option>
                ))}
              </select>
            </Fld>
          )}
          <Fld label="Dompet">
            <select value={walletId} onChange={e => { setWalletId(e.target.value); setFloorErr(""); }}
              style={manualFieldInput}>
              {myWallets.map(w => {
                const bal = walletBalance(w.id, s.wallets, s.transactions);
                return <option key={w.id} value={w.id}>{walletOptionLabel(w, bal, s.profile.currency, s.currentUser, fmtMoney)}</option>;
              })}
            </select>
            {(() => {
              const w = s.wallets.find(x => x.id === walletId);
              if (!isPaylaterWallet(w)) return null;
              const bal = walletBalance(walletId, s.wallets, s.transactions);
              const after = amt ? bal - +amt : bal;
              return (
                <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "#FEF3C7", fontSize: 12, color: "#92400E", lineHeight: 1.45 }}>
                  PayLater = hutang wajib bayar. {amt ? `Setelah belanja: ${after < 0 ? `hutang ${fmtMoney(Math.abs(after), s.profile.currency)}` : fmtMoney(after, s.profile.currency)}` : "Belanja akan menambah hutang jika saldo habis."}
                </div>
              );
            })()}
          </Fld>
        </>
      )}

      <Fld label="Tanggal">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={manualFieldInput} />
      </Fld>
      <Fld label="Catatan">
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Opsional — keterangan singkat" style={manualFieldInput} />
      </Fld>

      <button type="button" disabled={!ready} onClick={checkAndReady}
        style={{ padding: 15, borderRadius: 14, border: "none", background: ready ? typeColors[type] : "var(--ink3)", opacity: ready ? 1 : 0.45, color: "#fff", fontWeight: 700, fontSize: 15, cursor: ready ? "pointer" : "not-allowed", marginTop: 4 }}>
        Lanjut tinjau →
      </button>
    </div>
  );
}
const Fld = ({ label, children }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

// ─── Daily Report Sosmed ───────────────────────────────────
function SosNumRow({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontSize: 14, color: "var(--ink)" }}>{label}</span>
      <input inputMode="numeric" value={value === 0 ? "" : String(value)} placeholder="0"
        onChange={e => onChange(parseInt(e.target.value.replace(/\D/g, "") || "0", 10) || 0)}
        style={{ width: 72, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 16, fontWeight: 700, textAlign: "center", color: "var(--ink)", outline: "none" }} />
    </div>
  );
}

function SosCheckRow({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--line)", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
      <span style={{ fontSize: 18 }}>{checked ? "✅" : "⬜"}</span>
    </button>
  );
}

function SosmedHarianScreen({ s, mutate, onClose, user, onCriticalSave = null }) {
  const role = user?.role || "kasir";
  const enabled = hydrateSosmedConfig(s.sosmedConfig).enabledOutlets;
  const [pickOutlet, setPickOutlet] = useState(resolveSosmedOutlet(user, enabled[0]));
  const outlet = resolveSosmedOutlet(user, pickOutlet);
  const display = sosmedDisplayName(outlet);

  const [date, setDate] = useState(today());
  const existing = useMemo(() => todaySosmedReport(s.sosmedReports, outlet, date), [s.sosmedReports, outlet, date]);

  const [dm, setDm] = useState(() => ({ ...existing?.dm }));
  const [comments, setComments] = useState(() => ({ ...existing?.comments }));
  const [googleReviews, setGoogleReviews] = useState(() => ({ ...existing?.googleReviews }));
  const [replied, setReplied] = useState(() => ({ ...existing?.replied }));
  const [wellDone, setWellDone] = useState(existing?.wellDone || false);
  const [complaintsText, setComplaintsText] = useState(linesToText(existing?.complaints));
  const [questionsText, setQuestionsText] = useState(linesToText(existing?.topQuestions));
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const draftDirtyRef = useRef(false);
  const syncKeyRef = useRef(`${outlet}:${date}`);

  useEffect(() => {
    draftDirtyRef.current =
      wellDone
      || !!complaintsText.trim()
      || !!questionsText.trim()
      || Object.values(dm).some(v => String(v || "").trim() !== "")
      || Object.values(comments).some(v => String(v || "").trim() !== "")
      || Object.values(googleReviews).some(v => String(v || "").trim() !== "")
      || Object.values(replied).some(v => String(v || "").trim() !== "");
  }, [dm, comments, googleReviews, replied, wellDone, complaintsText, questionsText]);

  useEffect(() => {
    const key = `${outlet}:${date}`;
    const keyChanged = syncKeyRef.current !== key;
    if (keyChanged) {
      syncKeyRef.current = key;
      draftDirtyRef.current = false;
    }
    if (!keyChanged && draftDirtyRef.current) return;

    const ex = todaySosmedReport(s.sosmedReports, outlet, date);
    const blank = emptyReport(outlet, date);
    setDm({ ...blank.dm, ...ex?.dm });
    setComments({ ...blank.comments, ...ex?.comments });
    setGoogleReviews({ ...blank.googleReviews, ...ex?.googleReviews });
    setReplied({ ...blank.replied, ...ex?.replied });
    setWellDone(!!ex?.wellDone);
    setComplaintsText(linesToText(ex?.complaints));
    setQuestionsText(linesToText(ex?.topQuestions));
    setOk("");
  }, [outlet, date, s.sosmedReports]);

  const setDmKey = (k, v) => setDm(prev => ({ ...prev, [k]: v }));
  const setCommentKey = (k, v) => setComments(prev => ({ ...prev, [k]: v }));
  const setStarKey = (k, v) => setGoogleReviews(prev => ({ ...prev, [k]: v }));
  const setRepliedKey = (k, v) => setReplied(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setErr(""); setOk("");
    try {
      const { reports } = submitSosmedReport(s, {
        id: existing?.id,
        outlet, date, dm, comments, googleReviews, replied, wellDone,
        complaintsText, topQuestionsText: questionsText,
      }, user);
      const stamped = (reports || []).map((r) => (
        r?.outlet === outlet && r?.date === date
          ? { ...r, commitStatus: "committing" }
          : r
      ));
      mutate(d => { d.sosmedReports = stamped; });
      if (typeof onCriticalSave === "function") {
        setOk("Sedang mengirim ke awan…");
        await onCriticalSave();
      }
      mutate(d => {
        d.sosmedReports = (d.sosmedReports || []).map((r) => (
          r?.outlet === outlet && r?.date === date
            ? { ...r, commitStatus: "committed", committedAt: new Date().toISOString() }
            : r
        ));
      });
      setOk("Laporan sosmed tersimpan di awan.");
    } catch (e) {
      mutate(d => {
        d.sosmedReports = (d.sosmedReports || []).map((r) => (
          r?.outlet === outlet && r?.date === date
            ? { ...r, commitStatus: "failed" }
            : r
        ));
      });
      setErr(e.message || "Gagal menyimpan ke awan — jangan anggap selesai.");
      setOk("");
    }
  };

  const waText = useMemo(() => formatSosmedFormWa({
    outlet, date, dm, comments, googleReviews, replied, wellDone,
    complaintsText, topQuestionsText: questionsText,
    submittedByName: user?.name || existing?.submittedByName,
  }), [outlet, date, dm, comments, googleReviews, replied, wellDone, complaintsText, questionsText, user?.name, existing?.submittedByName]);

  if (!outlet || !isSosmedEnabled(s.sosmedConfig, outlet)) {
    return (
      <Sheet title="Daily Report Sosmed" onClose={onClose}>
        <div style={{ padding: 24, textAlign: "center", color: "var(--ink3)", fontSize: 14 }}>
          Belum ada outlet aktif untuk Daily Report Sosmed. Admin bisa aktifkan di Pengaturan → Operasional.
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Daily Report Sosmed · ${display}`} onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 14, padding: "12px 14px", background: "var(--brand-soft)", borderRadius: 12, lineHeight: 1.5 }}>
          Isi angka kosong = 0. Komplain & pertanyaan: <b>satu baris = satu poin</b> (contoh: <i>sayur asem 6x</i>).
        </div>

        {role !== "kasir" && enabled.length > 1 && (
          <Fld label="Outlet">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {enabled.map(o => (
                <button key={o} type="button" onClick={() => setPickOutlet(o)} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, border: `1px solid ${pickOutlet === o ? "var(--brand)" : "var(--line)"}`, background: pickOutlet === o ? "var(--brand-soft)" : "var(--surface)", color: pickOutlet === o ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>
                  {sosmedDisplayName(o)}
                </button>
              ))}
            </div>
          </Fld>
        )}

        <Fld label="Tanggal">
          <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)" }} />
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 6 }}>{dayLabel(date)}</div>
        </Fld>

        <div style={{ marginTop: 16 }}><Lbl>DM masuk</Lbl></div>
        <Card style={{ padding: "4px 14px", marginBottom: 16 }}>
          {DM_PLATFORMS.map(p => (
            <SosNumRow key={p.key} label={p.label} value={dm[p.key] || 0} onChange={v => setDmKey(p.key, v)} />
          ))}
        </Card>

        <Lbl>Komentar postingan</Lbl>
        <Card style={{ padding: "4px 14px", marginBottom: 16 }}>
          {SOCIAL_PLATFORMS.map(p => (
            <SosNumRow key={p.key} label={p.label} value={comments[p.key] || 0} onChange={v => setCommentKey(p.key, v)} />
          ))}
        </Card>

        <Lbl>Google review masuk</Lbl>
        <Card style={{ padding: "4px 14px", marginBottom: 16 }}>
          {STAR_KEYS.map(s => (
            <SosNumRow key={s.key} label={s.label} value={googleReviews[s.key] || 0} onChange={v => setStarKey(s.key, v)} />
          ))}
        </Card>

        <Lbl>Sudah dibalas</Lbl>
        <Card style={{ padding: "4px 14px", marginBottom: 16 }}>
          {SOCIAL_PLATFORMS.map(p => (
            <SosCheckRow key={p.key} label={p.label} checked={!!replied[p.key]} onChange={v => setRepliedKey(p.key, v)} />
          ))}
        </Card>

        <Card style={{ padding: "14px 16px", marginBottom: 16 }}>
          <SosCheckRow label="Well-done ✅" checked={wellDone} onChange={setWellDone} />
        </Card>

        <Fld label="Komplain yang perlu di-follow up (satu per baris)">
          <textarea value={complaintsText} onChange={e => setComplaintsText(e.target.value)} rows={4} placeholder={"Contoh:\nAC dingin kurang\nMeja kotor area depan"}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none", resize: "vertical", lineHeight: 1.45 }} />
        </Fld>

        <div style={{ height: 12 }} />
        <Fld label="Pertanyaan customer terbanyak (satu per baris)">
          <textarea value={questionsText} onChange={e => setQuestionsText(e.target.value)} rows={8} placeholder={"Contoh:\nsayur asem 6x\npisang coklat 3x\nJUS 18x"}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none", resize: "vertical", lineHeight: 1.45 }} />
        </Fld>

        {err && <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>{err}</div>}
        {ok && <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--in-soft)", color: "var(--in-text)", fontSize: 13 }}>{ok}</div>}

        <button type="button" onClick={save} style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: 14, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
          Simpan laporan sosmed
        </button>
        <ShareWaBtn text={waText} />
        {ok && (
          <button type="button" onClick={onClose} style={{ width: "100%", marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink2)", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
            Tutup
          </button>
        )}
      </div>
    </Sheet>
  );
}

function SosmedConfigScreen({ s, mutate, onClose }) {
  const enabled = new Set(hydrateSosmedConfig(s.sosmedConfig).enabledOutlets);
  const toggle = (o) => {
    mutate(d => {
      const cfg = hydrateSosmedConfig(d.sosmedConfig);
      const set = new Set(cfg.enabledOutlets);
      if (set.has(o)) set.delete(o); else set.add(o);
      d.sosmedConfig = { enabledOutlets: SOSMED_OUTLETS.filter(x => set.has(x)) };
    });
  };
  return (
    <Sheet title="Sosmed — Aktifkan Outlet" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 14, lineHeight: 1.5 }}>
          Pilih outlet yang wajib isi <b>Daily Report Sosmed</b> setiap hari. Saat ini BURI UMAH (KBU) aktif.
        </div>
        {SOSMED_OUTLETS.map(o => (
          <Card key={o} style={{ padding: "14px 16px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--ink)" }}>{sosmedDisplayName(o)}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)" }}>Kode: {o}</div>
            </div>
            <Tog on={enabled.has(o)} onToggle={() => toggle(o)} />
          </Card>
        ))}
      </div>
    </Sheet>
  );
}

// ─── Input SDM Pagi (kasir) ────────────────────────────────
function SdmHarianScreen({ s, mutate, onClose, onCriticalSave = null }) {
  const user = s.currentUser;
  const cur = s.profile.currency;
  const cfg = getOutletConfig(s.outletConfig, user.outlet);
  const outletLabel = OUTLET_LABEL[user.outlet] || user.outlet;
  const sdmHint = SDM_HINT[user.outlet] || "";
  const existing = todaySdmReport(s.sdmReports, user.outlet, today());

  const [headcount, setHeadcount] = useState(existing?.headcount?.toString() || "");
  const [opsNote, setOpsNote] = useState(existing?.opsNote || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!existing);
  const [savedReport, setSavedReport] = useState(existing || null);

  const headcountN = parseHeadcountInput(headcount);
  const previewTarget = calcDailyOmsetTarget(headcountN, s.outletConfig, user.outlet);
  const canSave = headcountN > 0 && !saved;

  const submit = async () => {
    setErr("");
    setSaving(true);
    try {
      const { report } = submitSdmReport({ ...s, currentUser: user }, {
        headcount: headcountN, date: today(), user, opsTags: [], opsNote,
      });
      const pending = { ...report, commitStatus: "committing" };
      mutate(d => {
        if (!d.sdmReports) d.sdmReports = [];
        d.sdmReports.push(pending);
      });
      if (typeof onCriticalSave === "function") {
        await onCriticalSave();
      }
      const committed = { ...pending, commitStatus: "committed", committedAt: new Date().toISOString() };
      mutate(d => {
        d.sdmReports = (d.sdmReports || []).map((r) => (r.id === pending.id ? committed : r));
      });
      setSaved(true);
      setSavedReport(committed);
    } catch (e) {
      mutate(d => {
        d.sdmReports = (d.sdmReports || []).map((r) => (
          r?.date === today() && r?.outlet === user.outlet && r?.commitStatus === "committing"
            ? { ...r, commitStatus: "failed" }
            : r
        ));
      });
      setErr(e.message || "Gagal menyimpan SDM ke awan — checklist belum selesai.");
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (existing) setSavedReport(existing);
  }, [existing]);

  const sdmShare = savedReport || todaySdmReport(s.sdmReports, user.outlet, today());

  const numInput = (val, set, placeholder) => (
    <input inputMode="numeric" value={val} onChange={e => set(e.target.value.replace(/[^\d-]/g, ""))} placeholder={placeholder} disabled={saved}
      style={{ width: "100%", padding: "16px 14px", borderRadius: 12, border: "1px solid var(--line)", background: saved ? "var(--surface2)" : "var(--surface)", fontSize: 28, fontWeight: 800, color: "var(--ink)", outline: "none", textAlign: "center" }} />
  );

  return (
    <Sheet title={`SDM Pagi · ${outletLabel}`} onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16, padding: "12px 14px", background: "var(--brand-soft)", borderRadius: 12, lineHeight: 1.5 }}>
          Berapa orang yang masuk kerja hari ini di <b>{outletLabel}</b>?
          Cukup isi angka — target omset dihitung otomatis.
          {sdmHint && <div style={{ marginTop: 6, fontSize: 12, opacity: .85 }}>Patokan: {sdmHint}</div>}
        </div>

        <Fld label="Jumlah SDM hari ini">{numInput(headcount, setHeadcount, user.outlet === "KBU" ? "10" : user.outlet === "KSM" ? "6" : "1")}</Fld>

        {headcountN > 0 && (
          <Card style={{ marginTop: 18, padding: "14px 16px", background: "var(--surface2)" }}>
            <div style={{ fontSize: 12, color: "var(--ink3)" }}>
              {formatTargetFormula(headcountN, cfg.omsetPerPerson, cur)}
            </div>
            <div className="money" style={{ fontWeight: 800, color: "var(--brand)", fontSize: 20, marginTop: 6 }}>
              Target omset hari ini: {fmtMoney(previewTarget, cur)}
            </div>
          </Card>
        )}

        {!saved && (
          <Card style={{ marginTop: 14, padding: "14px 16px" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--ink)" }}>Catatan (opsional)</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 10 }}>Untuk admin — mis. ada yang sakit, bahan habis, dll.</div>
            <textarea value={opsNote} onChange={e => setOpsNote(e.target.value)} placeholder="Mis. 1 orang sakit, telur habis…" rows={2} disabled={saved}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, resize: "vertical", background: "var(--surface)" }} />
          </Card>
        )}

        {err && <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>{err}</div>}
        {!saved ? (
          <button disabled={!canSave || saving} onClick={submit} style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: 14, border: "none", background: canSave ? "var(--brand)" : "var(--ink3)", opacity: canSave ? 1 : .5, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            {saving ? "Menyimpan…" : "Simpan SDM →"}
          </button>
        ) : (
          <>
            <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "var(--in-soft)", color: "var(--in-text)", fontSize: 13, textAlign: "center", fontWeight: 600 }}>
              ✓ SDM hari ini sudah tercatat
            </div>
            <ShareWaBtn text={formatSdmWa(sdmShare)} />
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Laporan Omset Harian (kasir) ──────────────────────────
function KasirHarianScreen({ s, mutate, onClose, initialDate = null, onCriticalSave = null, onVerifyCommitted = null, businessId = null, getLatestState = null }) {
  const user = s.currentUser;
  const cur = s.profile.currency;
  const cfg = getOutletConfig(s.outletConfig, user.outlet);
  const channels = getReportChannels(s, user.outlet);
  const ui = getReportUi(s, user.outlet);
  const cashCh = cashChannel(channels);
  const grouped = groupChannels(channels);
  const todaySdm = todaySdmReport(s.sdmReports, user.outlet, today());
  const floor = LACI_FLOOR;
  const pendingRevision = findPendingRevisionReport(s.dailyReports, user.outlet, s.staffMessages);
  const userPickedDateRef = useRef(false);

  const [date, setDate] = useState(() => {
    if (initialDate) return initialDate;
    return pendingRevision?.date || today();
  });
  const dateSdm = todaySdmReport(s.sdmReports, user.outlet, date);
  const existingReport = (s.dailyReports || []).find(
    r => r.outlet === user.outlet && r.date === date && r.status !== "settled"
  );
  const settledReport = (s.dailyReports || []).find(
    r => r.outlet === user.outlet && r.date === date && r.status === "settled"
  );
  const isRevision = reportAwaitingKasirRevision(existingReport, s.staffMessages, user.outlet);
  const revisionNote = revisionNoteForReport(existingReport, s.staffMessages, user.outlet);
  const isLocked = existingReport && !isRevision;

  const initAmounts = (report) => {
    const o = {};
    channels.forEach(c => {
      o[c.id] = report?.channels?.[c.id] ? String(report.channels[c.id]) : "";
    });
    return o;
  };
  const [amounts, setAmounts] = useState(() => initAmounts(existingReport));
  const [physicalCashEnd, setPhysicalCashEnd] = useState(
    existingReport?.physicalCashEnd ? String(existingReport.physicalCashEnd) : ""
  );
  const [opsNote, setOpsNote] = useState(existingReport?.opsNote || "");
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitted, setSubmitted] = useState(!!existingReport && !isRevision);
  const [lastReport, setLastReport] = useState(isLocked ? existingReport : null);
  const draftDirtyRef = useRef(false);
  const syncDateRef = useRef(date);
  const submittingRef = useRef(false);
  const submitSuccessRef = useRef(false);
  const allowRetryRef = useRef(false);
  const successBannerRef = useRef(null);
  const submissionIdRef = useRef(null);
  const lastReportRef = useRef(lastReport);
  lastReportRef.current = lastReport;

  useEffect(() => {
    if (initialDate) return;
    const rev = findPendingRevisionReport(s.dailyReports, user.outlet, s.staffMessages);
    if (!rev?.date || userPickedDateRef.current) return;
    if (rev.date !== date) setDate(rev.date);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.dailyReports, s.staffMessages, user.outlet, initialDate]);

  useEffect(() => {
    draftDirtyRef.current =
      !!opsNote.trim()
      || !!physicalCashEnd
      || channels.some(c => String(amounts[c.id] || "").trim() !== "");
  }, [amounts, opsNote, physicalCashEnd, channels]);

  useEffect(() => {
    const rep = (s.dailyReports || []).find(
      r => r.outlet === user.outlet && r.date === date && r.status !== "settled"
    );
    const dateChanged = syncDateRef.current !== date;
    if (dateChanged) {
      syncDateRef.current = date;
      draftDirtyRef.current = false;
      submitSuccessRef.current = false;
      allowRetryRef.current = false;
      submissionIdRef.current = null;
      setSubmitSuccess(false);
    }

    // Laporan dihapus owner / sudah settle — lepas lock lokal agar form tidak stuck
    // Jangan hapus banner sukses jika kita baru saja submit (laporan bisa sebentar hilang di sync)
    if (!rep) {
      if (submitSuccessRef.current && lastReportRef.current?.date === date) {
        return;
      }
      submitSuccessRef.current = false;
      submittingRef.current = false;
      allowRetryRef.current = false;
      setSubmitSuccess(false);
      setSubmitted(false);
      setLastReport(null);
      setErr("");
      if (dateChanged || !draftDirtyRef.current) {
        setAmounts(initAmounts(null));
        setPhysicalCashEnd("");
        setOpsNote("");
      }
      return;
    }

    if (submitSuccessRef.current) return;
    // Setelah gagal simpan awan: jangan kunci form lagi dari sync state
    if (allowRetryRef.current) return;
    const forceSync = reportAwaitingKasirRevision(rep, s.staffMessages, user.outlet);
    if (!dateChanged && draftDirtyRef.current && !submitted && !forceSync) return;

    setAmounts(initAmounts(rep));
    setPhysicalCashEnd(rep?.physicalCashEnd ? String(rep.physicalCashEnd) : "");
    setOpsNote(rep?.opsNote || "");
    setSubmitted(!!rep && !reportAwaitingKasirRevision(rep, s.staffMessages, user.outlet));
    setLastReport(rep && !reportAwaitingKasirRevision(rep, s.staffMessages, user.outlet) ? rep : null);
    setErr("");
    if (forceSync) draftDirtyRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, s.dailyReports, s.staffMessages, user.outlet]);

  const dailyTarget = dateSdm?.targetOmset || calcDailyOmsetTarget(dateSdm?.headcount || 0, s.outletConfig, user.outlet);
  const perPerson = dateSdm?.omsetPerPerson || cfg.omsetPerPerson;

  const setAmt = (id, val) => setAmounts(a => ({ ...a, [id]: val.replace(/\D/g, "") }));

  const derivedCash = physicalCashEnd ? Math.max(0, (+physicalCashEnd || 0) - floor) : 0;
  const cashAmt = physicalCashEnd && cashCh
    ? derivedCash
    : Math.max(0, +(amounts[cashCh?.id] || 0));
  const nonCashTotal = channels
    .filter(c => c.role !== "cash")
    .reduce((sum, c) => sum + Math.max(0, +(amounts[c.id] || 0)), 0);
  const total = cashAmt + nonCashTotal;
  const ready = total > 0 || (+physicalCashEnd || 0) > 0;
  const showSubmittedLock = (submitted || submitSuccess) && lastReport;
  const canDeleteOwn =
    canDo(user.role, "hapusLaporanOmsetSendiri")
    && existingReport
    && !["settled", "admin_verified"].includes(existingReport.status);

  const unlockSubmitForRetry = (message) => {
    allowRetryRef.current = true;
    submitSuccessRef.current = false;
    submittingRef.current = false;
    setSubmitSuccess(false);
    setSubmitted(false);
    setErr(message || "Gagal menyimpan laporan. Silakan kirim ulang.");
  };

  const finishSubmitSuccess = (saved, { resubmit = false } = {}) => {
    allowRetryRef.current = false;
    submitSuccessRef.current = true;
    setSubmitSuccess(true);
    setSubmitted(true);
    setLastReport(saved);
    setErr("");
    draftDirtyRef.current = false;
    try { navigator.vibrate?.(120); } catch { /* ignore */ }
    showActionToast(
      resubmit ? "✓ Revisi terkirim — tunggu verifikasi admin" : "✓ Laporan omset tersimpan",
      "success"
    );
    setTimeout(() => successBannerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 80);
  };

  const doDeleteOwn = async () => {
    if (!existingReport || submitting || submittingRef.current) return;
    const label = shortDate(existingReport.date);
    if (!confirm(`Hapus laporan omset ${label}?\n\nSaldo laci disesuaikan. Anda bisa isi laporan baru dari awal.`)) return;
    setErr("");
    setSubmitting(true);
    submittingRef.current = true;
    try {
      const { report: deleted, removeIds } = deleteDailyReport(s, existingReport.id, user);
      mutate(d => {
        d.dailyReports = (d.dailyReports || []).filter(r => r.id !== deleted.id);
        // Bersihkan seluruh duplikat slot outlet+tanggal (bukan hanya id yang dihapus)
        d.dailyReports = (d.dailyReports || []).filter(r =>
          !(r.outlet === deleted.outlet && r.date === deleted.date)
        );
        removeIds.forEach(id => applyTransactionDelete(d, id));
        recordDailyReportDelete(d, deleted);
        d.staffMessages = cancelRevisionMessagesForReport(
          d.staffMessages, deleted.id, deleted.date, deleted.outlet
        );
      });
      submitSuccessRef.current = false;
      allowRetryRef.current = false;
      submissionIdRef.current = null;
      clearStoredSubmissionId();
      setSubmitSuccess(false);
      setSubmitted(false);
      setLastReport(null);
      setAmounts(initAmounts(null));
      setPhysicalCashEnd("");
      setOpsNote("");
      draftDirtyRef.current = false;
      if (typeof onCriticalSave === "function") {
        await onCriticalSave();
      }
      logDailyReportStage("ui_delete_own_persisted", {
        action: "delete",
        result: "ok",
        reportId: deleted.id,
        outletCode: deleted.outlet,
        reportDate: deleted.date,
      });
      showActionToast(`Laporan ${label} dihapus — silakan isi ulang.`, "success");
    } catch (e) {
      setErr(e.message || "Gagal hapus laporan");
      showActionToast(e.message || "Gagal hapus laporan", "error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const resolvedBizId = businessId || s?.businessId || s?.profile?.businessId || null;
  const isSmtOutlet = user?.outlet === "SMT";
  const submissionStorageKey = user?.outlet && date
    ? `nf3_dr_sub|${resolvedBizId || "biz"}|${user.outlet}|${date}${isSmtOutlet ? "|omzet" : ""}`
    : null;

  const readSubmissionStorage = (store) => {
    if (!submissionStorageKey || typeof store === "undefined" || !store) return null;
    try { return store.getItem(submissionStorageKey); } catch { return null; }
  };
  const writeSubmissionStorage = (store, id) => {
    if (!submissionStorageKey || !id || typeof store === "undefined" || !store) return;
    try { store.setItem(submissionStorageKey, id); } catch { /* ignore */ }
  };
  const clearSubmissionStorage = (store) => {
    if (!submissionStorageKey || typeof store === "undefined" || !store) return;
    try { store.removeItem(submissionStorageKey); } catch { /* ignore */ }
  };

  const readStoredSubmissionId = () => {
    // SMT: localStorage dulu agar refresh/draft reload tetap key yang sama
    if (isSmtOutlet) {
      return readSubmissionStorage(typeof localStorage !== "undefined" ? localStorage : null)
        || readSubmissionStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null);
    }
    return readSubmissionStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null);
  };
  const writeStoredSubmissionId = (id) => {
    if (isSmtOutlet) {
      writeSubmissionStorage(typeof localStorage !== "undefined" ? localStorage : null, id);
      writeSubmissionStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null, id);
      return;
    }
    writeSubmissionStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null, id);
  };
  const clearStoredSubmissionId = () => {
    if (isSmtOutlet) {
      clearSubmissionStorage(typeof localStorage !== "undefined" ? localStorage : null);
      clearSubmissionStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null);
      return;
    }
    clearSubmissionStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null);
  };

  const resolveSubmissionId = () => {
    if (submissionIdRef.current) return submissionIdRef.current;
    const stored = readStoredSubmissionId();
    if (stored) {
      submissionIdRef.current = stored;
      return stored;
    }
    // SMT omzet: key stabil (outlet+tanggal+jenis) — refresh/retry = key sama
    const next = isSmtOutlet
      ? makeSmtOmzetIdempotencyKey({ businessId: resolvedBizId, date })
      : makeDailyReportSubmissionId({
        businessId: resolvedBizId,
        outlet: user?.outlet,
        date,
        userId: user?.id,
      });
    submissionIdRef.current = next;
    writeStoredSubmissionId(next);
    return next;
  };

  const submit = async () => {
    if (submittingRef.current || submitting || submitSuccess) return;
    submittingRef.current = true;
    setErr("");
    setSubmitting(true);

    const isSmt = isSmtOutlet;
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const clientActionId = isSmt ? `smt_${requestId}` : null;
    let smtSubmitCalls = 0;
    let smtApplyCalls = 0;

    const submissionId = resolveSubmissionId();
    // Pastikan key tersimpan sebelum request (retry/refresh memakai key yang sama)
    writeStoredSubmissionId(submissionId);

    if (isSmt) {
      logDailyReportStage("CLIENT_SUBMIT_CLICK", {
        requestId,
        clientActionId,
        submissionId,
        idempotencyKey: submissionId,
        outletCode: "SMT",
        reportDate: date,
        reportType: "omzet",
      });
      logDailyReportStage("CLIENT_SUBMIT_HANDLER_STARTED", {
        requestId,
        clientActionId,
        submissionId,
        idempotencyKey: submissionId,
        outletCode: "SMT",
        reportDate: date,
        reportType: "omzet",
      });
    }

    let saved = null;
    let resubmit = false;
    try {
      logDailyReportStage("STARTED", {
        requestId,
        submissionId,
        idempotencyKey: submissionId,
        businessId: resolvedBizId,
        outletCode: user?.outlet,
        reportDate: date,
        reportType: "omzet",
        clientTimestamp: new Date().toISOString(),
      });

      // Orphan cash tanpa laporan: pulihkan stub dulu agar submit jadi upsert, bukan cash kedua
      let stateForSubmit = { ...s, currentUser: user };
      if (!existingReport && !isRevision && hasOrphanLaporanCashSlot(s, user?.outlet, date)) {
        const { report: recovered } = recoverDailyReportFromOrphanCash(s, {
          outlet: user?.outlet,
          date,
          user,
          businessId: resolvedBizId,
        });
        stateForSubmit = {
          ...stateForSubmit,
          dailyReports: [...(s.dailyReports || []).filter((r) => !(r.outlet === recovered.outlet && r.date === recovered.date)), recovered],
        };
        mutate((d) => {
          applyDailyReportMutation(d, { report: { ...recovered, commitStatus: "recovered" }, txs: [] });
        });
        showActionToast("Ditemukan omset di laci tanpa laporan — memulihkan lalu mengirim ulang (aman).", "info", 4500);
      }

      const payload = {
        channels: Object.fromEntries(
          channels.map(c => {
            if (c.role === "cash" && physicalCashEnd && cashCh) return [c.id, String(derivedCash)];
            return [c.id, amounts[c.id] || ""];
          })
        ),
        physicalCashEnd: physicalCashEnd || null,
        date,
        user,
        businessId: resolvedBizId,
        submissionId,
        idempotencyKey: submissionId,
      };
      logDailyReportStage("ui_submit_click", {
        requestId,
        submissionId,
        idempotencyKey: submissionId,
        outletId: user?.outlet,
        reportDate: date,
        reportType: "omzet",
        isRevision: !!(isRevision && existingReport),
        ...(clientActionId ? { clientActionId } : {}),
      });
      if (isSmt) {
        logDailyReportStage("CLIENT_API_REQUEST_SENT", {
          requestId,
          clientActionId,
          submissionId,
          idempotencyKey: submissionId,
          outletCode: "SMT",
          reportDate: date,
          reportType: "omzet",
          note: "no dedicated HTTP report API — domain mutate + saveAppState",
        });
      }
      if (isRevision && existingReport) {
        smtSubmitCalls += 1;
        const { report, txs, removeIds } = resubmitDailyReport(stateForSubmit, existingReport.id, payload);
        const fulfilledAt = report.resubmittedAt || new Date().toISOString();
        saved = { ...report, opsNote: opsNote.trim(), dailyTargetAtSubmit: dailyTarget || null, commitStatus: "committing" };
        resubmit = true;
        const reAddIds = new Set((txs || []).map((t) => t.id));
        mutate(d => {
          smtApplyCalls += 1;
          applyDailyReportMutation(d, { report: saved, txs, removeIds });
          (removeIds || []).forEach((id) => {
            if (!reAddIds.has(id)) applyTransactionDelete(d, id);
          });
          if (user?.id) {
            d.staffMessages = resolveRevisionMessages(d.staffMessages, existingReport.id, user.id, existingReport.date, fulfilledAt);
          }
          try {
            const nmsg = createDailyReportSubmittedMessage({ report: saved, author: user, resubmit: true });
            d.staffMessages = prependStaffMessage(d.staffMessages, nmsg, d.notificationPrefs);
            const ack = createRevisionSubmittedAckMessage({ report: saved, author: user });
            d.staffMessages = prependStaffMessage(d.staffMessages, ack, d.notificationPrefs);
          } catch { /* ignore */ }
        });
      } else {
        smtSubmitCalls += 1;
        const { report, txs, idempotent, removeIds = [] } = submitDailyReport(stateForSubmit, payload);
        saved = { ...report, opsNote: opsNote.trim(), dailyTargetAtSubmit: dailyTarget || null, commitStatus: "committing" };
        const applyTxs = idempotent ? [] : txs;
        const reAddIds = new Set((applyTxs || []).map((t) => t.id));
        mutate(d => {
          smtApplyCalls += 1;
          applyDailyReportMutation(d, { report: saved, txs: applyTxs, removeIds });
          (removeIds || []).forEach((id) => {
            if (!reAddIds.has(id)) applyTransactionDelete(d, id);
          });
          if (!idempotent) {
            try {
              const nmsg = createDailyReportSubmittedMessage({ report: saved, author: user, resubmit: false });
              d.staffMessages = prependStaffMessage(d.staffMessages, nmsg, d.notificationPrefs);
            } catch { /* ignore */ }
          }
        });
      }

      // CRITICAL SAVE DULU — diagnostik SMT tidak boleh menghalangi persist ke pusat.
      // (Bug historis: ReferenceError sRef setelah mutate → save tidak jalan → sync race.)
      if (typeof onCriticalSave === "function") {
        showActionToast("Sedang mengirim…", "info", 2500);
        logDailyReportStage("REPORT_SAVING", {
          requestId,
          submissionId,
          idempotencyKey: submissionId,
          reportId: saved?.id,
          outletCode: user?.outlet,
          reportDate: date,
          reportType: "omzet",
        });
        await onCriticalSave();
      }
      logDailyReportStage("REPORT_SAVED", {
        requestId,
        submissionId,
        idempotencyKey: submissionId,
        reportId: saved?.id,
        outletCode: user?.outlet,
        reportDate: date,
        reportType: "omzet",
        result: "saved",
        source: "submit",
        ...(clientActionId ? { clientActionId } : {}),
      });

      // Diagnostik SMT setelah save — gagal log tidak boleh mengubah status kirim
      if (isSmt) {
        try {
          const latest = (typeof getLatestState === "function" ? getLatestState() : null) || s;
          const arts = countSmtSubmissionArtifacts(latest, date);
          const classification =
            arts.reportCount >= 2 && arts.cashCount >= 2 ? "A"
              : arts.reportCount === 1 && arts.cashCount >= 2 ? "B"
                : arts.reportCount === 1 && arts.cashCount === 1 ? "ok"
                  : "D";
          logDailyReportStage("SMT_AFTER_SAVE", {
            requestId,
            clientActionId,
            submissionId,
            idempotencyKey: submissionId,
            outletCode: "SMT",
            reportDate: date,
            reportType: "omzet",
            result: classification === "ok" ? "create_or_upsert" : "anomaly",
            reportId: saved?.id || null,
            submitDailyReportCalls: smtSubmitCalls,
            applyMutationCalls: smtApplyCalls,
            reportCount: arts.reportCount,
            cashCount: arts.cashCount,
            cashIds: arts.cashIds,
            classification,
          });
        } catch (diagErr) {
          logDailyReportStage("SMT_DIAG_FAILED", {
            requestId,
            submissionId,
            idempotencyKey: submissionId,
            outletCode: "SMT",
            reportDate: date,
            result: "failed",
            error: diagErr?.message || String(diagErr),
          });
        }
      }

      // Read-back verification: laporan harus terbaca dari source of truth
      if (typeof onVerifyCommitted === "function") {
        showActionToast("Memverifikasi laporan di awan…", "info", 2500);
        const verified = await onVerifyCommitted({
          reportId: saved?.id,
          reportKey: saved?.reportKey,
          submissionId,
          idempotencyKey: submissionId,
          outlet: user?.outlet,
          date,
        });
        if (!verified) {
          throw new Error(
            "Laporan belum terbaca di awan setelah simpan. Jangan isi ulang — tap ☁️ lalu kirim ulang (aman)."
          );
        }
        saved = {
          ...saved,
          ...verified,
          serverRecordId: verified.id || saved.id,
          syncStatus: "synced",
          commitStatus: "committed",
          committedAt: new Date().toISOString(),
        };
      } else {
        saved = {
          ...saved,
          serverRecordId: saved.id,
          syncStatus: "synced",
          commitStatus: "committed",
          committedAt: new Date().toISOString(),
        };
      }

      mutate((d) => {
        applyDailyReportMutation(d, {
          report: {
            ...saved,
            serverRecordId: saved.serverRecordId || saved.id,
            syncStatus: "synced",
            commitStatus: "committed",
            committedAt: saved.committedAt,
          },
          txs: [],
        });
      });

      logDailyReportStage("COMMITTED", {
        requestId,
        submissionId,
        idempotencyKey: submissionId,
        reportId: saved?.id,
        serverRecordId: saved?.serverRecordId || saved?.id,
        outletCode: user?.outlet,
        reportDate: date,
        reportType: "omzet",
        serverTimestamp: saved?.committedAt,
        result: "committed",
        status: "committed",
        syncStatus: "synced",
        source: "submit",
      });
      // SMT: pertahankan key stabil di storage agar refresh/sync tidak membuat key baru
      if (!isSmt) clearStoredSubmissionId();
      finishSubmitSuccess(saved, { resubmit });
    } catch (e) {
      const errText = e?.message || String(e);
      const uncertain = isUncertainDeliveryError(e);
      logDailyReportStage("FAILED", {
        requestId,
        submissionId,
        idempotencyKey: submissionId,
        outletCode: user?.outlet,
        reportDate: date,
        reportType: "omzet",
        reportId: saved?.id || null,
        result: "failed",
        error: errText,
        // Error UI ≠ reset identitas — key tetap untuk sync/retry
        syncStatus: "pending",
        ...(clientActionId ? { clientActionId } : {}),
      });

      // Jangan hapus laporan lokal / identitas — hanya tandai pending sync
      if (saved?.id) {
        mutate((d) => {
          applyDailyReportMutation(d, {
            report: {
              ...saved,
              commitStatus: "failed",
              syncStatus: "pending",
              idempotencyKey: saved.idempotencyKey || submissionId,
              submissionId: saved.submissionId || submissionId,
            },
            txs: [],
          });
        });
      }

      // Status tidak pasti / setelah mutate lokal: cek dulu by outlet+tanggal+idempotencyKey
      const shouldVerify = (uncertain || !!saved?.id) && typeof onVerifyCommitted === "function";
      if (shouldVerify) {
        const checkMsg = userFacingDailyReportError(e, { uncertain: true });
        setErr(checkMsg);
        showActionToast(checkMsg, "info", 4000);
        try {
          const verified = await onVerifyCommitted({
            reportId: saved?.id,
            reportKey: saved?.reportKey,
            submissionId,
            idempotencyKey: submissionId,
            outlet: user?.outlet,
            date,
          });
          if (verified) {
            logDailyReportStage("VERIFY_EXISTING_AFTER_UNCERTAIN", {
              requestId,
              submissionId,
              idempotencyKey: submissionId,
              outletCode: user?.outlet,
              reportDate: date,
              reportType: "omzet",
              reportId: verified.id,
              result: "existing",
            });
            if (!isSmt) clearStoredSubmissionId();
            finishSubmitSuccess({
              ...saved,
              ...verified,
              serverRecordId: verified.id,
              syncStatus: "synced",
              commitStatus: "committed",
            }, { resubmit });
            return;
          }
          logDailyReportStage("VERIFY_NOT_FOUND_AFTER_UNCERTAIN", {
            requestId,
            submissionId,
            idempotencyKey: submissionId,
            outletCode: user?.outlet,
            reportDate: date,
            reportType: "omzet",
            result: "not_found",
          });
        } catch (verifyErr) {
          logDailyReportStage("VERIFY_FAILED", {
            requestId,
            submissionId,
            idempotencyKey: submissionId,
            outletCode: user?.outlet,
            reportDate: date,
            error: verifyErr?.message || String(verifyErr),
            result: "failed",
          });
        }
      }

      // Key yang sama untuk retry — jangan regenerate
      writeStoredSubmissionId(submissionId);
      const msg = uncertain
        ? "Status pengiriman belum dapat dipastikan. Laporan belum ditemukan — ketuk kirim ulang (aman) dengan key yang sama."
        : userFacingDailyReportError(e);
      unlockSubmitForRetry(msg);
      showActionToast(msg, "error");
    } finally {
      setSubmitting(false);
      if (!submitSuccessRef.current) submittingRef.current = false;
    }
  };

  const numInput = (val, set, placeholder = "0") => (
    <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
      <span style={{ padding: "0 12px", color: "var(--ink3)", fontWeight: 700 }}>Rp</span>
      <input inputMode="numeric" value={val ? new Intl.NumberFormat("id-ID").format(val) : ""} onChange={e => set(e.target.value.replace(/\D/g, ""))} placeholder={placeholder}
        style={{ flex: 1, padding: "13px 0", background: "none", border: "none", fontSize: 16, fontWeight: 700, color: "var(--ink)", outline: "none" }} />
    </div>
  );

  return (
    <Sheet title={`Laporan Omset · ${OUTLET_LABEL[user.outlet] || user.outlet}`} onClose={onClose}>
      <div style={{ padding: "16px 16px max(48px, env(safe-area-inset-bottom))" }}>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16, padding: "12px 14px", background: "var(--brand-soft)", borderRadius: 12 }}>
          Isi sesuai kebiasaan laporan manual outlet Anda. <b>Tunai/setoran</b> masuk laci {user.outlet}.
          Channel lain dicatat untuk Admin NF3 settle ke rekening/dompet digital.
          <div style={{ marginTop: 6, fontSize: 12, opacity: .9 }}>Setelah kirim → admin verifikasi fisik pagi → owner/admin settle siang s/d esok 17:00.</div>
          {dailyTarget > 0 ? (
            <div style={{ marginTop: 6 }}>Target: <b>{fmtMoney(dailyTarget, cur)}</b> ({formatTargetFormula(dateSdm?.headcount, perPerson, cur)})</div>
          ) : (
            <div style={{ marginTop: 6 }}>Target: <b>{fmtMoney(cfg.omsetPerPerson, cur)}/org × SDM</b> — SDM pagi opsional untuk backfill tanggal lalu</div>
          )}
        </div>
        {settledReport ? (
          <>
            <div style={{ marginBottom: 16, padding: "16px 18px", borderRadius: 14, background: "var(--in-soft)", border: "2px solid var(--in-text)", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>✓</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--in-text)" }}>Laporan {shortDate(date)} sudah disettle</div>
              <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8, lineHeight: 1.45 }}>
                Total {fmtMoney(settledReport.total, cur)} · tunai sudah masuk Kas Besar.<br />
                <b>Tidak perlu kirim ulang</b> untuk tanggal ini.
              </div>
            </div>
            <ShareWaBtn text={formatOmsetWa(settledReport, channels)} />
            <button onClick={onClose} style={{ width: "100%", marginTop: 10, padding: 14, borderRadius: 14, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Tutup
            </button>
          </>
        ) : (
        <>
        {submitSuccess && lastReport && (
          <div ref={successBannerRef} style={{ marginBottom: 16, padding: "16px 18px", borderRadius: 14, background: "var(--in-soft)", border: "2px solid var(--in-text)", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--in-text)" }}>
              {lastReport.resubmittedAt ? "Revisi berhasil terkirim!" : "Laporan berhasil tersimpan!"}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8, lineHeight: 1.45 }}>
              Total {fmtMoney(lastReport.total, cur)} · menunggu verifikasi admin.<br />
              No. laporan: <b style={{ fontFamily: "ui-monospace, monospace" }}>{lastReport.id}</b>
              {lastReport.status ? <> · status <b>{lastReport.status}</b></> : null}<br />
              <b>Jangan kirim ulang</b> — cek Pengumuman untuk konfirmasi.
            </div>
          </div>
        )}
        {isRevision && revisionNote && !submitSuccess && (
          <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: "var(--out-soft)", border: "1px solid #FECACA" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--out-text)", marginBottom: 4 }}>Revisi wajib dari {existingReport?.revisionRequestedByRole === "owner" ? "Owner" : "Admin Keuangan"}</div>
            <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.45 }}>{revisionNote}</div>
          </div>
        )}
        {pendingRevision && pendingRevision.date !== date && (
          <button type="button" onClick={() => { userPickedDateRef.current = false; setDate(pendingRevision.date); }}
            style={{ width: "100%", marginBottom: 14, padding: "12px 14px", borderRadius: 12, border: "2px solid var(--out-text)", background: "var(--out-soft)", color: "var(--out-text)", fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
            ⚠ Revisi wajib untuk {shortDate(pendingRevision.date)} — tap untuk buka form revisi
          </button>
        )}
        {!dateSdm && date === today() && (
          <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10 }}>
            Belum input SDM pagi hari ini — target omset estimasi. Isi SDM di Beranda jika perlu.
          </div>
        )}
        {dateSdm && (
          <Card style={{ marginBottom: 14, padding: "12px 14px", background: "var(--surface2)" }}>
            <div style={{ fontSize: 13, color: "var(--ink2)" }}>
              SDM {dateSdm.headcount} org · target {fmtMoney(dailyTarget, cur)}
            </div>
          </Card>
        )}
        <Fld label="Tanggal">
          <input type="date" value={date} onChange={e => { userPickedDateRef.current = true; setDate(e.target.value); }} max={today()}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 6 }}>
            {isRevision
              ? "Ubah tanggal untuk laporan lain — selama belum settle, revisi bisa dikirim ulang."
              : "Backfill tanggal lalu boleh · laporan sudah kirim terkunci kecuali admin minta revisi."}
          </div>
        </Fld>

        {ui.physicalCashControl && (
          <Card style={{ marginTop: 14, padding: "14px 16px", background: "var(--surface2)" }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)", marginBottom: 10 }}>💰 Kontrol Cash Fisik</div>
            {ui.showKasAwal && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
                <span>Kas Awal (modal statis)</span>
                <span className="money" style={{ fontWeight: 700 }}>{fmtMoney(floor, cur)}</span>
              </div>
            )}
            <Fld label="Kas Fisik Akhir (hitung uang di laci)">
              {numInput(physicalCashEnd, setPhysicalCashEnd)}
            </Fld>
            {physicalCashEnd && (
              <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "var(--in-soft)", fontSize: 13 }}>
                <div style={{ color: "var(--ink3)" }}>Setoran Owner (tunai → laci)</div>
                <div className="money" style={{ fontWeight: 800, color: "var(--in-text)", fontSize: 18, marginTop: 4 }}>
                  {fmtMoney(derivedCash, cur)}
                </div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>
                  {fmtMoney(+physicalCashEnd, cur)} − {fmtMoney(floor, cur)} modal
                </div>
              </div>
            )}
          </Card>
        )}

        {grouped.map(({ group, items }) => {
          const visible = items.filter(c => !(c.role === "cash" && physicalCashEnd));
          if (!visible.length) return null;
          return (
            <div key={group || "_"} style={{ marginTop: 18 }}>
              {group && <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 10 }}>{group}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {visible.map(ch => (
                  <Fld key={ch.id} label={`${ch.icon || ""} ${ch.label}`.trim()}>
                    {numInput(amounts[ch.id], v => setAmt(ch.id, v))}
                  </Fld>
                ))}
              </div>
            </div>
          );
        })}

        <Card style={{ marginTop: 18, padding: "14px 16px", background: "var(--surface2)" }}>
          <div style={{ fontSize: 12, color: "var(--ink3)" }}>Total omset hari ini</div>
          <div className="money" style={{ fontSize: 28, fontWeight: 800, color: "var(--brand)", marginTop: 4 }}>{fmtMoney(total, cur)}</div>
          {cashAmt > 0 && (
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 6 }}>Setoran tunai: {fmtMoney(cashAmt, cur)}</div>
          )}
          {dailyTarget > 0 && total > 0 && (
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 6 }}>
              Target {fmtMoney(dailyTarget, cur)} · tercatat {fmtMoney(total, cur)}
            </div>
          )}
        </Card>

        {!showSubmittedLock && (
          <Card style={{ marginTop: 14, padding: "14px 16px" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--ink)" }}>Catatan (opsional)</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 10 }}>Untuk admin — mis. antrian panjang, mesin error, dll.</div>
            <textarea value={opsNote} onChange={e => setOpsNote(e.target.value)} placeholder="Mis. antrian 1 jam karena 1 orang sakit…" rows={2}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, resize: "vertical", background: "var(--surface)" }} />
          </Card>
        )}

        {err && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>
            <div>{err}</div>
            {!showSubmittedLock && (
              <button
                type="button"
                disabled={!ready || submitting}
                onClick={submit}
                style={{
                  marginTop: 10,
                  width: "100%",
                  padding: 11,
                  borderRadius: 10,
                  border: "1px solid var(--out-text)",
                  background: "var(--surface)",
                  color: "var(--out-text)",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: ready && !submitting ? "pointer" : "default",
                  opacity: ready && !submitting ? 1 : 0.65,
                }}
              >
                {submitting ? "⏳ Menyimpan ulang…" : "Coba kirim ulang (aman)"}
              </button>
            )}
          </div>
        )}
        {canDeleteOwn && !submitting && (
          <button type="button" onClick={doDeleteOwn}
            style={{ width: "100%", marginTop: 12, marginBottom: 4, padding: 12, borderRadius: 12, border: "1px solid var(--out-soft)", background: "var(--surface)", color: "var(--out-text)", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Trash2 size={15} />
            {showSubmittedLock || isRevision ? "Hapus laporan & isi ulang dari awal" : "Hapus draf laporan hari ini"}
          </button>
        )}
        {!showSubmittedLock ? (
          <button type="button" disabled={!ready || submitting || submitSuccess} onClick={submit} style={{ width: "100%", marginTop: 16, marginBottom: 8, padding: 14, borderRadius: 14, border: "none", background: ready && !submitting ? (isRevision ? "var(--out-text)" : "var(--brand)") : "var(--ink3)", opacity: ready && !submitting ? 1 : .65, color: "#fff", fontWeight: 700, fontSize: 15, cursor: ready && !submitting && !submitSuccess ? "pointer" : "default", position: "relative", zIndex: 2 }}>
            {submitting ? "⏳ Menyimpan… jangan tap lagi" : isRevision ? "Kirim revisi →" : "Kirim laporan →"}
          </button>
        ) : lastReport ? (
          <>
            <div ref={successBannerRef} style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "var(--in-soft)", color: "var(--in-text)", fontSize: 13, textAlign: "center", fontWeight: 600 }}>
              {lastReport.resubmittedAt
                ? "✓ Revisi tersimpan · menunggu verifikasi Admin Keuangan"
                : lastReport.status === "admin_verified"
                  ? "✓ Diverifikasi admin · menunggu settle owner/admin"
                  : lastReport.status === "submitted"
                    ? "✓ Laporan tersimpan · menunggu verifikasi Admin Keuangan (fisik & nota)"
                    : "✓ Laporan omset tersimpan"}
            </div>
            <ShareWaBtn text={formatOmsetWa(lastReport, channels)} />
            <button onClick={onClose} style={{ width: "100%", marginTop: 10, padding: 14, borderRadius: 14, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Tutup
            </button>
          </>
        ) : null}
        </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Settle Laporan (Admin NF3) ────────────────────────────
function HistoryReportRow({ r, cur, onDelete, busy }) {
  const statusLabel = {
    submitted: "Menunggu verifikasi",
    admin_verified: "Siap settle",
    revision_requested: "Menunggu revisi",
    settled: "Settled",
  }[r.status] || r.status;
  const settled = r.status === "settled";
  return (
    <Card style={{ padding: "12px 14px", opacity: settled ? 0.92 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>
            {OUTLET_LABEL[r.outlet] || r.outlet} · {shortDate(r.date)}
          </div>
          <div style={{ fontSize: 12, color: settled ? "var(--in-text)" : "var(--ink3)", marginTop: 2, fontWeight: settled ? 600 : 400 }}>
            {statusLabel} · {r.kasirName || "Kasir"}
          </div>
        </div>
        <div className="money" style={{ fontWeight: 800, color: "var(--brand)", fontSize: 14 }}>{fmtMoney(r.total, cur)}</div>
      </div>
      {onDelete && (
        <button type="button" disabled={busy === r.id} onClick={() => onDelete(r)}
          style={{ width: "100%", marginTop: 10, padding: 9, borderRadius: 10, border: "1px solid var(--out-soft)", background: "var(--surface)", color: "var(--out-text)", fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: busy === r.id ? .6 : 1 }}>
          <Trash2 size={14} />
          Hapus laporan
        </button>
      )}
    </Card>
  );
}

function DeleteReportButton({ report, busy, onDelete, urgent = false, label = null }) {
  if (!onDelete) return null;
  const defaultLabel = urgent ? "Hapus laporan & bersihkan duplikat omset" : "Hapus laporan omset (belum settle)";
  return (
    <button type="button" disabled={busy === report.id} onClick={() => onDelete(report)}
      style={{
        width: "100%",
        padding: urgent ? 13 : 10,
        borderRadius: 12,
        border: urgent ? "2px solid var(--out-text)" : "1px solid var(--out-soft)",
        background: urgent ? "var(--out-text)" : "var(--out-soft)",
        color: urgent ? "#fff" : "var(--out-text)",
        fontWeight: 800,
        fontSize: urgent ? 14 : 13,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        opacity: busy === report.id ? .6 : 1,
      }}>
      <Trash2 size={urgent ? 17 : 15} />
      {label || defaultLabel}
    </button>
  );
}

function SettleReportCard({ r, s, cur, user, onVerify, onRevision, onSettle, onDelete, busy, revisingId, setRevisingId, revisionNote, setRevisionNote }) {
  const chs = getReportChannels(s, r.outlet);
  const lines = r.channels
    ? chs.map(c => ({ label: c.label, amt: Math.max(0, +(r.channels[c.id] || 0)) })).filter(x => x.amt > 0)
    : [
      { label: "Tunai", amt: r.cash || 0 },
      { label: "QRIS BCA", amt: r.qrisBca || 0 },
      { label: "QRIS BRI", amt: r.qrisBri || 0 },
      { label: "Gojek", amt: r.gojek || 0 },
    ].filter(x => x.amt > 0);
  const cash = reportCashAmount(r, chs);
  const dayVoids = (s.voidLogs || []).filter(v => v.outlet === r.outlet && v.date === r.date);
  const pendingVoids = dayVoids.filter(v => v.status === "submitted");
  const walletId = LACI_BY_OUTLET[r.outlet];
  const laciBal = walletId ? walletBalance(walletId, s.wallets, s.transactions) : 0;
  const floor = r.laciFloor || LACI_FLOOR;
  const expectedLaci = floor + cash;
  const laciDiff = laciBal - expectedLaci;
  const laciOk = Math.abs(laciDiff) <= 1000;
  const laciOver = laciDiff > 1000;
  const laciUnder = laciDiff < -1000;
  const urgency = reportSettleUrgency(r);
  const statusLabel = {
    submitted: "Menunggu verifikasi",
    admin_verified: "Siap settle",
    revision_requested: "Menunggu revisi kasir",
  }[r.status] || r.status;

  return (
    <Card key={r.id} style={{ padding: "14px 16px", border: urgency === "overdue" ? "2px solid var(--out-text)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 800, color: "var(--ink)" }}>{OUTLET_LABEL[r.outlet] || r.outlet} · {shortDate(r.date)}</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{r.kasirName || "Kasir"} · {statusLabel}</div>
          {r.physicalCashEnd > 0 && (
            <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>Kas fisik dilaporkan: {fmtMoney(r.physicalCashEnd, cur)}</div>
          )}
          <div style={{ fontSize: 11, color: urgency === "overdue" ? "var(--out-text)" : "var(--ink3)", marginTop: 4, fontWeight: urgency ? 700 : 400 }}>
            Batas settle: {reportSettleDeadlineLabel(r.date)}{urgency === "overdue" ? " · TERLAMBAT" : urgency === "urgent" ? " · segera" : ""}
          </div>
        </div>
        <div className="money" style={{ fontWeight: 800, color: "var(--brand)" }}>{fmtMoney(r.total, cur)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12, color: "var(--ink2)", marginBottom: 12 }}>
        {lines.map(l => (
          <span key={l.label}>{l.label}: {fmtMoney(l.amt, cur)}</span>
        ))}
      </div>
      {(r.status === "submitted" || r.status === "admin_verified") && walletId && (
        <div style={{ fontSize: 12, marginBottom: 10, padding: "10px 12px", borderRadius: 10, background: laciOk ? "var(--in-soft)" : "var(--amber-soft)", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>Periksa dompet laci {r.outlet}</div>
          <div>Saldo sistem: <b>{fmtMoney(laciBal, cur)}</b></div>
          <div>Harusnya (floor + tunai): <b>{fmtMoney(expectedLaci, cur)}</b></div>
          {!laciOk && (
            <div style={{ color: "#92400E", fontWeight: 700, marginTop: 4, lineHeight: 1.45 }}>
              ⚠ Selisih besar
              {laciOver
                ? " — kemungkinan duplikat omset tunai dari revisi."
                : laciUnder
                  ? " — transaksi tunai belum masuk laci (atau sudah terhapus)."
                  : "."}
              {onDelete
                ? " Gunakan tombol merah Hapus laporan di bawah (bukan hapus transaksi satu-satu di Laporan)."
                : " Minta kasir revisi atau hubungi admin."}
            </div>
          )}
        </div>
      )}
      {!laciOk && onDelete && r.status !== "settled" && (
        <div style={{ marginBottom: 10 }}>
          <DeleteReportButton report={r} busy={busy} onDelete={onDelete} urgent />
        </div>
      )}
      {cash > 0 && (
        <div style={{ fontSize: 12, color: "var(--in-text)", marginBottom: 10 }}>
          → Setoran tunai ke Kas Besar: {fmtMoney(cash, cur)}
        </div>
      )}
      {dayVoids.length > 0 && (
        <div style={{ fontSize: 12, color: pendingVoids.length ? "#92400E" : "var(--ink3)", marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: pendingVoids.length ? "var(--amber-soft)" : "var(--surface2)" }}>
          🚫 {dayVoids.length} void di tanggal ini{pendingVoids.length ? ` (${pendingVoids.length} belum reviewed)` : ""}
        </div>
      )}
      {r.adminVerifyNote && (
        <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface2)" }}>
          Catatan verifikasi: {r.adminVerifyNote}
        </div>
      )}
      {r.revisionNote && r.status === "revision_requested" && (
        <div style={{ fontSize: 12, color: "var(--out-text)", marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "var(--out-soft)" }}>
          Menunggu kasir: {r.revisionNote}
        </div>
      )}
      {r.status === "revision_requested" && onDelete && (
        <div style={{ marginBottom: 10 }}>
          <DeleteReportButton
            report={r}
            busy={busy}
            onDelete={onDelete}
            urgent
            label="Hapus laporan omset — kasir isi ulang dari awal"
          />
        </div>
      )}
      <ShareWaBtn text={formatOmsetWa(r, chs)} compact style={{ width: "100%", marginBottom: 10 }} />
      {revisingId === r.id ? (
        <div style={{ marginBottom: 10 }}>
          <textarea
            value={revisionNote}
            onChange={e => setRevisionNote(e.target.value)}
            placeholder="Wajib: jelaskan selisih fisik/nota yang salah…"
            rows={3}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, resize: "vertical", background: "var(--surface)" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => onRevision(r.id)} disabled={busy === r.id || !revisionNote.trim()}
              style={{ flex: 1, padding: 10, borderRadius: 10, border: "none", background: "var(--out-text)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: revisionNote.trim() ? 1 : .5 }}>
              Kirim permintaan revisi
            </button>
            <button type="button" onClick={() => { setRevisingId(null); setRevisionNote(""); }}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
              Batal
            </button>
          </div>
          <DeleteReportButton report={r} busy={busy} onDelete={onDelete} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {r.status === "submitted" && (
            <button disabled={busy === r.id} onClick={() => onVerify(r.id)}
              style={{ width: "100%", padding: 11, borderRadius: 12, border: "none", background: "var(--in-text)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: busy === r.id ? .6 : 1 }}>
              {busy === r.id ? "Memproses…" : "✓ Verifikasi fisik & nota"}
            </button>
          )}
          {r.status === "admin_verified" && (
            <button disabled={busy === r.id || pendingVoids.length > 0 || !laciOk} onClick={() => onSettle(r.id)}
              style={{ width: "100%", padding: 11, borderRadius: 12, border: "none", background: (pendingVoids.length || !laciOk) ? "var(--ink3)" : "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: (pendingVoids.length || !laciOk) ? "default" : "pointer", opacity: busy === r.id ? .6 : 1 }}>
              {busy === r.id ? "Memproses…" : pendingVoids.length ? "Review void dulu" : !laciOk ? "Perbaiki selisih laci dulu" : "Settle → Kas Besar & Rekening"}
            </button>
          )}
          {(r.status === "submitted" || r.status === "admin_verified") && (
            <button type="button" disabled={busy === r.id} onClick={() => { setRevisingId(r.id); setRevisionNote(""); }}
              style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--out-text)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Minta revisi kasir
            </button>
          )}
          {r.status !== "revision_requested" && (
            <DeleteReportButton report={r} busy={busy} onDelete={onDelete} />
          )}
        </div>
      )}
    </Card>
  );
}

const REPORT_STATUS_SHORT = {
  submitted: "Menunggu verifikasi",
  admin_verified: "Siap settle",
  revision_requested: "Menunggu revisi kasir",
  settled: "Settled ✓",
};

function TodayOmsetPanel({ reports, dateStr, cur }) {
  const todayList = reportsForDate(reports, dateStr);
  const byOutlet = new Map(todayList.map(r => [r.outlet, r]));
  const missing = OUTLETS.filter(o => !byOutlet.has(o));
  const pending = todayList.filter(r => r.status !== "settled");
  return (
    <div style={{ marginBottom: 20, padding: "12px 14px", borderRadius: 12, background: missing.length ? "var(--amber-soft)" : "var(--surface2)", border: `1px solid ${missing.length ? "var(--amber)" : "var(--line)"}` }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)", marginBottom: 8 }}>
        Omset hari ini · {shortDate(dateStr)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        {OUTLETS.map(outlet => {
          const r = byOutlet.get(outlet);
          if (!r) {
            return (
              <div key={outlet} style={{ display: "flex", justifyContent: "space-between", color: "var(--out-text)", fontWeight: 700 }}>
                <span>{OUTLET_LABEL[outlet] || outlet}</span>
                <span>Belum terkirim</span>
              </div>
            );
          }
          const urgent = r.status === "submitted" || r.status === "admin_verified";
          return (
            <div key={outlet} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: urgent ? 700 : 500, color: urgent ? "var(--ink)" : "var(--ink2)" }}>
              <span>{OUTLET_LABEL[outlet] || outlet}</span>
              <span style={{ textAlign: "right" }}>
                {REPORT_STATUS_SHORT[r.status] || r.status} · {fmtMoney(r.total, cur)}
              </span>
            </div>
          );
        })}
      </div>
      {missing.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--out-text)", marginTop: 10, lineHeight: 1.45, fontWeight: 600 }}>
          ⚠ {missing.map(o => OUTLET_LABEL[o] || o).join(", ")} belum masuk awan — minta kasir tap ☁️ sync.
        </div>
      )}
      {pending.length === 0 && !missing.length && todayList.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--in-text)", marginTop: 8, fontWeight: 600 }}>✓ Semua outlet sudah settled untuk tanggal ini.</div>
      )}
    </div>
  );
}

function SettleLaporanScreen({ s, mutate, onClose, onCriticalSave = null, onReloadFromCloud = null }) {
  const user = s.currentUser;
  const cur = s.profile.currency;
  const todayStr = today();
  const awaitingVerify = reportsAwaitingVerify(s.dailyReports, s.transactions);
  const readyToSettle = reportsReadyToSettle(s.dailyReports, s.transactions);
  const awaitingRevision = reportsAwaitingRevision(s.dailyReports, s.transactions);
  const allReports = allDailyReportsForAdmin(s.dailyReports, s.transactions, { days: 14 });
  const activeIds = new Set([...awaitingVerify, ...readyToSettle, ...awaitingRevision].map(r => r.id));
  const historyOnly = allReports.filter(r => !activeIds.has(r.id));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(null);
  const [revisingId, setRevisingId] = useState(null);
  const [revisionNote, setRevisionNote] = useState("");

  const doVerify = async (reportId) => {
    if (busyRef.current) return;
    setErr(""); setBusy(reportId); busyRef.current = reportId;
    try {
      const updated = verifyDailyReportAdmin(s, reportId, user);
      mutate(d => {
        const i = (d.dailyReports || []).findIndex(r => r.id === reportId);
        if (i >= 0) d.dailyReports[i] = updated;
        d.staffMessages = fulfillSubmittedReportMessages(
          d.staffMessages, updated.id, updated.date, updated.outlet, updated.adminVerifiedAt
        );
        try {
          const nmsg = createDailyReportVerifiedMessage({ report: updated, author: user });
          d.staffMessages = prependStaffMessage(d.staffMessages, nmsg, d.notificationPrefs);
        } catch { /* ignore */ }
      });
      setRevisingId(null);
      setRevisionNote("");
      if (typeof onCriticalSave === "function") await onCriticalSave();
      showActionToast(`Laporan ${OUTLET_LABEL[updated.outlet] || updated.outlet} · ${shortDate(updated.date)} diverifikasi.`, "success");
    } catch (e) {
      setErr(e.message || "Gagal verifikasi");
      showActionToast(e.message || "Gagal verifikasi ke awan", "error");
    }
    setBusy(null); busyRef.current = null;
  };

  const doRevision = async (reportId) => {
    if (busyRef.current) return;
    setErr(""); setBusy(reportId); busyRef.current = reportId;
    try {
      const updated = requestDailyReportRevision(s, reportId, user, revisionNote);
      const msg = createRevisionRequestMessage({ report: updated, note: revisionNote, author: user });
      mutate(d => {
        const i = (d.dailyReports || []).findIndex(r => r.id === reportId);
        if (i >= 0) d.dailyReports[i] = updated;
        d.staffMessages = prependStaffMessage(d.staffMessages, msg, d.notificationPrefs);
      });
      setRevisingId(null);
      setRevisionNote("");
      if (typeof onCriticalSave === "function") await onCriticalSave();
      showActionToast(`Permintaan revisi dikirim ke kasir ${updated.outlet}.`, "success");
    } catch (e) {
      setErr(e.message || "Gagal minta revisi");
      showActionToast(e.message || "Gagal minta revisi ke awan", "error");
    }
    setBusy(null); busyRef.current = null;
  };

  const doSettle = async (reportId) => {
    if (busyRef.current) return;
    setErr(""); setBusy(reportId); busyRef.current = reportId;
    try {
      const { report, txs, idempotent } = settleDailyReport(s, reportId, user);
      mutate(d => {
        applyDailyReportMutation(d, { report, txs: idempotent ? [] : txs });
        d.staffMessages = resolveRevisionMessages(
          d.staffMessages, report.id, report.kasirId, report.date, report.settledAt
        );
        d.staffMessages = fulfillSubmittedReportMessages(
          d.staffMessages, report.id, report.date, report.outlet, report.settledAt
        );
        if (!idempotent) {
          try {
            const nmsg = createDailyReportSettledMessage({ report, author: user });
            d.staffMessages = prependStaffMessage(d.staffMessages, nmsg, d.notificationPrefs);
          } catch { /* ignore */ }
        }
      });
      if (typeof onCriticalSave === "function") await onCriticalSave();
      showActionToast(
        `Laporan ${OUTLET_LABEL[report.outlet] || report.outlet} · ${shortDate(report.date)} disettle · ${report.id}`,
        "success"
      );
    } catch (e) {
      setErr(e.message || "Gagal settle");
      showActionToast(e.message || "Gagal settle", "error");
    }
    setBusy(null); busyRef.current = null;
  };

  const doDelete = async (report) => {
    if (busyRef.current) return;
    const label = `${OUTLET_LABEL[report.outlet] || report.outlet} · ${shortDate(report.date)}`;
    const txCount = collectAllDailyReportTxIds(s.transactions, report).length;
    const settledHint = report.status === "settled" || txCount > 1
      ? `\n\nAkan hapus laporan + ${txCount || 0} transaksi terkait (termasuk settle jika ada). Saldo dompet disesuaikan.`
      : "\n\nSaldo laci disesuaikan.";
    if (!confirm(`Hapus laporan ${label}?${settledHint}\n\nKasir bisa kirim laporan baru.`)) return;
    setErr(""); setBusy(report.id); busyRef.current = report.id;
    try {
      const { report: deleted, removeIds } = deleteDailyReport(s, report.id, user);
      mutate(d => {
        // Hapus dari sumber data (bukan hanya status UI)
        d.dailyReports = (d.dailyReports || []).filter(r => r.id !== deleted.id);
        // Buang semua laporan di slot yang sama (submitted/revisi/duplikat)
        d.dailyReports = (d.dailyReports || []).filter(r =>
          !(r.outlet === deleted.outlet && r.date === deleted.date)
        );
        removeIds.forEach(id => applyTransactionDelete(d, id));
        recordDailyReportDelete(d, deleted);
        d.staffMessages = cancelRevisionMessagesForReport(
          d.staffMessages, deleted.id, deleted.date, deleted.outlet
        );
        try {
          const nmsg = createDailyReportDeletedMessage({ report: deleted, author: user });
          d.staffMessages = prependStaffMessage(d.staffMessages, nmsg, d.notificationPrefs);
        } catch { /* ignore */ }
      });
      setRevisingId(null);
      setRevisionNote("");
      if (typeof onCriticalSave === "function") {
        await onCriticalSave();
      }
      logDailyReportStage("ui_delete_persisted", {
        action: "delete",
        result: "ok",
        reportId: deleted.id,
        outletCode: deleted.outlet,
        reportDate: deleted.date,
        reportKey: deleted.reportKey || null,
      });
      // Fetch ulang tanpa mengandalkan cache lokal saja
      if (typeof onReloadFromCloud === "function") {
        try { await onReloadFromCloud({ manual: true }); } catch { /* ignore */ }
      }
      showActionToast(`Laporan ${label} dihapus — kasir bisa kirim ulang.`, "success");
    } catch (e) {
      setErr(e.message || "Gagal hapus laporan");
      showActionToast(e.message || "Gagal hapus laporan", "error");
      logDailyReportStage("ui_delete_error", {
        action: "delete",
        result: "error",
        reportId: report.id,
        error: e.message || String(e),
      });
    }
    setBusy(null); busyRef.current = null;
  };

  const canDeleteReport = canDo(user.role, "hapusLaporanOmset");
  const cardProps = {
    s, cur, user, onVerify: doVerify, onRevision: doRevision, onSettle: doSettle,
    onDelete: canDeleteReport ? doDelete : null,
    busy, revisingId, setRevisingId, revisionNote, setRevisionNote,
  };

  return (
    <Sheet title="Settle Laporan Kasir" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16, padding: "12px 14px", background: "var(--amber-soft)", borderRadius: 12, lineHeight: 1.5 }}>
          Semua laporan kasir tampil di bawah — <b>tidak disembunyikan</b>. Salah? <b>Hapus</b> lalu kasir kirim ulang. Settled juga bisa dihapus owner jika perlu koreksi.
        </div>
        {err && <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>{err}</div>}

        <TodayOmsetPanel reports={s.dailyReports} dateStr={todayStr} cur={cur} />

        {awaitingVerify.length > 0 && (
          <>
            <Lbl>Verifikasi pagi ({awaitingVerify.length})</Lbl>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {awaitingVerify.map(r => <SettleReportCard key={r.id} r={r} {...cardProps} />)}
            </div>
          </>
        )}

        {readyToSettle.length > 0 && (
          <>
            <Lbl>Siap settle ({readyToSettle.length})</Lbl>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {readyToSettle.map(r => <SettleReportCard key={r.id} r={r} {...cardProps} />)}
            </div>
          </>
        )}

        {awaitingRevision.length > 0 && (
          <>
            <Lbl>Menunggu revisi kasir ({awaitingRevision.length})</Lbl>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 10, lineHeight: 1.45 }}>
              Laporan ngawur atau duplikat? Owner/admin bisa <b>Hapus laporan omset</b> di kartu di bawah.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {awaitingRevision.map(r => <SettleReportCard key={r.id} r={r} {...cardProps} />)}
            </div>
          </>
        )}

        {awaitingVerify.length === 0 && readyToSettle.length === 0 && awaitingRevision.length === 0 && allReports.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink3)", padding: "24px 0" }}>Belum ada laporan omset.</div>
        )}

        {allReports.length > 0 && (
          <>
            <Lbl>Riwayat &amp; settled ({allReports.filter(r => !activeIds.has(r.id)).length || allReports.length})</Lbl>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 10, lineHeight: 1.45 }}>
              Semua laporan tampil di sini. Owner bisa <b>hapus kapan saja</b> — kasir kirim ulang setelah hapus.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
              {(historyOnly.length ? historyOnly : allReports).map(r => (
                <HistoryReportRow key={r.id} r={r} cur={cur} onDelete={canDeleteReport ? doDelete : null} busy={busy} />
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Setting target omset & gaji per outlet (owner/admin) ───
function OutletTargetSettingsScreen({ s, mutate, onClose }) {
  const cur = s.profile.currency;
  const [outlet, setOutlet] = useState(OUTLETS[0]);
  const [confirmReset, setConfirmReset] = useState(false);
  const cfg = getOutletConfig(s.outletConfig, outlet);
  const hintN = outlet === "KBU" ? 10 : outlet === "KSM" ? 6 : 1;
  const previewTarget = calcDailyOmsetTarget(hintN, s.outletConfig, outlet);

  const patch = (patchObj) => {
    mutate(d => {
      if (!d.outletConfig) d.outletConfig = defaultOutletConfig();
      d.outletConfig[outlet] = { ...getOutletConfig(d.outletConfig, outlet), ...patchObj };
    });
  };

  const setMoneyField = (key, raw) => {
    const n = Math.max(0, parseInt(String(raw).replace(/\D/g, ""), 10) || 0);
    patch({ [key]: n });
  };

  const resetOutlet = () => {
    mutate(d => {
      if (!d.outletConfig) d.outletConfig = {};
      d.outletConfig[outlet] = factoryOutletConfig(outlet);
    });
    setConfirmReset(false);
  };

  const moneyInput = (val, onChange) => (
    <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
      <span style={{ padding: "0 12px", color: "var(--ink3)", fontWeight: 700 }}>Rp</span>
      <input inputMode="numeric" value={val ? new Intl.NumberFormat("id-ID").format(val) : ""}
        onChange={e => onChange(e.target.value.replace(/\D/g, ""))} placeholder="0"
        style={{ flex: 1, padding: "13px 0", background: "none", border: "none", fontSize: 16, fontWeight: 700, color: "var(--ink)", outline: "none" }} />
    </div>
  );

  return (
    <Sheet title="Target Omset & Gaji per Outlet" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 14, padding: "12px 14px", background: "var(--in-soft)", borderRadius: 12, border: "1px solid #BBF7D0" }}>
          Target harian kasir = <b>omset per orang × SDM pagi</b>. Perubahan tersimpan otomatis — berlaku untuk laporan SDM & omset berikutnya.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {OUTLETS.map(o => (
            <button key={o} onClick={() => { setOutlet(o); setConfirmReset(false); }}
              style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${outlet === o ? "var(--brand)" : "var(--line)"}`, background: outlet === o ? "var(--brand-soft)" : "var(--surface)", fontWeight: 700, fontSize: 12, color: outlet === o ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>
              {OUTLET_LABEL[o]}
            </button>
          ))}
        </div>

        <Fld label="Omset per orang / hari">
          {moneyInput(cfg.omsetPerPerson, v => setMoneyField("omsetPerPerson", v))}
        </Fld>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 6, marginBottom: 16 }}>
          Patokan SDM {OUTLET_LABEL[outlet]}: {SDM_HINT[outlet]}
        </div>

        <Fld label="Gaji harian per orang (internal — rasio SDM)">
          {moneyInput(cfg.dailyWage, v => setMoneyField("dailyWage", v))}
        </Fld>
        <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 6, marginBottom: 16 }}>
          Hanya dipakai hitung rasio gaji/omset. Kasir tidak melihat angka ini.
        </div>

        <Card style={{ padding: "14px 16px", background: "var(--surface2)" }}>
          <div style={{ fontSize: 12, color: "var(--ink3)" }}>Simulasi target hari ini</div>
          <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6 }}>
            {hintN} SDM × {fmtMoney(cfg.omsetPerPerson, cur)} = <b className="money">{fmtMoney(previewTarget, cur)}</b>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 8 }}>
            Rasio jika {hintN} org @ {fmtMoney(cfg.dailyWage, cur)}/org:{" "}
            <b>{buildSdmSnapshot({ headcount: hintN, dailyWage: cfg.dailyWage, targetOmset: previewTarget, omsetPerPerson: cfg.omsetPerPerson, outlet }).ratioLabel}</b>
            {" · "}
            {buildSdmSnapshot({ headcount: hintN, dailyWage: cfg.dailyWage, targetOmset: previewTarget, omsetPerPerson: cfg.omsetPerPerson, outlet }).status.label}
          </div>
        </Card>

        {confirmReset ? (
          <Card style={{ marginTop: 14, padding: "14px 16px", background: "var(--amber-soft)", border: "1px solid #FDE68A" }}>
            <div style={{ fontSize: 13, color: "#92400E", marginBottom: 10 }}>
              Reset {OUTLET_LABEL[outlet]} ke default ({fmtMoney(DEFAULT_OMSET_PER_PERSON, cur)}/org · gaji {fmtMoney(DEFAULT_DAILY_WAGE, cur)})?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={resetOutlet} style={{ flex: 1, padding: 10, borderRadius: 10, border: "none", background: "#D97706", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Ya, reset</button>
              <button onClick={() => setConfirmReset(false)} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer" }}>Batal</button>
            </div>
          </Card>
        ) : (
          <button onClick={() => setConfirmReset(true)} style={{ width: "100%", marginTop: 14, padding: 11, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink3)", fontSize: 13, cursor: "pointer" }}>
            Reset outlet ini ke default pabrik
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ─── Setting channel laporan (owner/admin) ─────────────────
function MpStoreSettingsScreen({ s, mutate, onClose }) {
  const stores = s.mpStores || hydrateMpStores(null);
  const [platformId, setPlatformId] = useState(NF_MP_PLATFORMS[0]?.id || "tiktok");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [adding, setAdding] = useState(false);

  const saveStores = (next) => {
    mutate((d) => { d.mpStores = next; });
  };

  const patchStore = (id, patch) => {
    saveStores(stores.map((st) => (st.id === id ? { ...st, ...patch } : st)));
  };

  const removeStore = (id) => {
    saveStores(stores.filter((st) => st.id !== id));
  };

  const addStore = () => {
    const label = name.trim();
    if (!label) return;
    const id = createMpStoreId(platformId, stores);
    const storeCode = code.trim() || nextStoreCode(platformId, stores);
    saveStores([
      ...stores,
      { id, platformId, code: storeCode, name: label, active: true, sort: (stores.length + 1) * 10 },
    ]);
    setName("");
    setCode("");
    setAdding(false);
  };

  const grouped = NF_MP_PLATFORMS.map((p) => ({
    ...p,
    stores: stores.filter((st) => st.platformId === p.id),
  }));

  return (
    <Sheet title="Toko Marketplace" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 14, padding: "12px 14px", background: "var(--in-soft)", borderRadius: 12, border: "1px solid #BBF7D0", lineHeight: 1.45 }}>
          Daftar toko dipakai saat Admin catat <b>settlement MP</b>. Kode toko tersimpan otomatis di transaksi — tidak perlu ketik di catatan.
        </div>
        {grouped.map((plat) => (
          <div key={plat.id} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{plat.label}</div>
            <Card style={{ overflow: "hidden" }}>
              {plat.stores.length === 0 ? (
                <div style={{ padding: "14px 16px", fontSize: 13, color: "var(--ink3)" }}>Belum ada toko — tambah di bawah.</div>
              ) : plat.stores.map((st) => (
                <div key={st.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{st.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink3)" }}>{st.code}</div>
                  </div>
                  <button type="button" onClick={() => patchStore(st.id, { active: st.active === false })} style={{ fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: st.active === false ? "var(--surface2)" : "var(--in-soft)", color: st.active === false ? "var(--ink3)" : "var(--in-text)", cursor: "pointer" }}>
                    {st.active === false ? "Nonaktif" : "Aktif"}
                  </button>
                  <button type="button" onClick={() => removeStore(st.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--out-text)", padding: 4 }} title="Hapus"><Trash2 size={16} /></button>
                </div>
              ))}
            </Card>
          </div>
        ))}
        {adding ? (
          <Card style={{ padding: 16, marginTop: 8 }}>
            <Fld label="Platform">
              <select value={platformId} onChange={(e) => { setPlatformId(e.target.value); setCode(""); }} style={manualFieldInput}>
                {NF_MP_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Fld>
            <Fld label="Nama toko">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nusa Fishing Official" style={manualFieldInput} />
            </Fld>
            <Fld label="Kode toko">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={nextStoreCode(platformId, stores)} style={manualFieldInput} />
            </Fld>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => setAdding(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontWeight: 600, cursor: "pointer" }}>Batal</button>
              <button type="button" onClick={addStore} disabled={!name.trim()} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: name.trim() ? "var(--brand)" : "var(--ink3)", color: "#fff", fontWeight: 700, cursor: name.trim() ? "pointer" : "not-allowed" }}>Simpan</button>
            </div>
          </Card>
        ) : (
          <button type="button" onClick={() => setAdding(true)} style={{ width: "100%", marginTop: 8, padding: 14, borderRadius: 12, border: "1px dashed var(--line)", background: "var(--surface)", fontWeight: 700, color: "var(--brand)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Plus size={18} /> Tambah toko
          </button>
        )}
      </div>
    </Sheet>
  );
}

function ReportChannelSettingsScreen({ s, mutate, onClose }) {
  const [outlet, setOutlet] = useState(OUTLETS[0]);
  const channels = getAllReportChannels(s, outlet);
  const ui = getReportUi(s, outlet);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const saveChannels = (next) => {
    mutate(d => {
      if (!d.reportChannels) d.reportChannels = hydrateReportChannels(null);
      d.reportChannels[outlet] = next;
    });
  };

  const saveUi = (patch) => {
    mutate(d => {
      if (!d.reportUi) d.reportUi = hydrateReportUi(null);
      d.reportUi[outlet] = { ...getReportUi(d, outlet), ...patch };
    });
  };

  const patchChannel = (id, patch) => {
    saveChannels(channels.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const toggle = (id) => {
    const ch = channels.find(c => c.id === id);
    if (!ch || ch.role === "cash") return;
    patchChannel(id, { active: ch.active === false });
  };

  const removeChannel = (id) => {
    const ch = channels.find(c => c.id === id);
    if (!ch || ch.role === "cash") return;
    saveChannels(channels.filter(c => c.id !== id));
  };

  const addChannel = () => {
    const label = newLabel.trim();
    if (!label) return;
    const ids = channels.map(c => c.id);
    const maxOrder = channels.reduce((m, c) => Math.max(m, c.order || 0), 0);
    const channel = {
      id: createChannelId(label, ids),
      label,
      icon: "📌",
      role: "channel",
      settleWallet: "w_bca",
      group: newGroup.trim() || "Lainnya",
      order: maxOrder + 1,
      active: true,
      categoryHint: "penjualan",
    };
    mutate(d => {
      if (!d.reportChannels) d.reportChannels = hydrateReportChannels(null);
      d.reportChannels = appendCustomReportChannel(d.reportChannels, channel);
    });
    setNewLabel("");
    setNewGroup("");
    setAdding(false);
  };

  const resetOutlet = () => {
    mutate(d => {
      if (!d.reportChannels) d.reportChannels = {};
      if (!d.reportUi) d.reportUi = {};
      d.reportChannels[outlet] = factoryChannelsForOutlet(outlet);
      d.reportUi[outlet] = factoryUiForOutlet(outlet);
    });
    setConfirmReset(false);
  };

  return (
    <Sheet title="Form Laporan Kasir per Outlet" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 14, padding: "12px 14px", background: "var(--in-soft)", borderRadius: 12, border: "1px solid #BBF7D0" }}>
          Semua perubahan <b>tersimpan otomatis</b> di cloud — tidak perlu update aplikasi kalau mau ubah label, tambah/hapus channel, atau tampilan form kasir.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {OUTLETS.map(o => (
            <button key={o} onClick={() => { setOutlet(o); setConfirmReset(false); setAdding(false); }} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: `1px solid ${outlet === o ? "var(--brand)" : "var(--line)"}`, background: outlet === o ? "var(--brand-soft)" : "var(--surface)", fontWeight: 700, fontSize: 12, color: outlet === o ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>
              {OUTLET_LABEL[o]}
            </button>
          ))}
        </div>

        <Card style={{ padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--ink)" }}>Tampilan form kasir</div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
            <input type="checkbox" checked={ui.physicalCashControl !== false} onChange={e => saveUi({ physicalCashControl: e.target.checked })} />
            Tampilkan <b>Kontrol Cash Fisik</b> (kas akhir − modal)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink2)" }}>
            <input type="checkbox" checked={ui.showKasAwal !== false} onChange={e => saveUi({ showKasAwal: e.target.checked })} />
            Tampilkan baris <b>Kas Awal Rp 250.000</b>
          </label>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {channels.map(ch => (
            <Card key={ch.id} style={{ padding: "12px 14px", opacity: ch.active === false ? .55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: ch.role === "cash" ? 0 : 8 }}>
                <button onClick={() => toggle(ch.id)} disabled={ch.role === "cash"}
                  style={{ width: 44, height: 26, borderRadius: 99, border: "none", cursor: ch.role === "cash" ? "default" : "pointer", background: ch.active !== false ? "var(--brand)" : "var(--line)", position: "relative", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 3, left: ch.active !== false ? 22 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: ".15s" }} />
                </button>
                <input value={ch.label} onChange={e => patchChannel(ch.id, { label: e.target.value })}
                  style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 14, fontWeight: 600, background: "var(--surface)" }} />
                {ch.role === "cash" ? (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--in-text)", background: "var(--in-soft)", padding: "2px 8px", borderRadius: 99 }}>LACI</span>
                ) : (
                  <button onClick={() => removeChannel(ch.id)} title="Hapus channel" style={{ padding: 8, border: "none", background: "var(--out-soft)", borderRadius: 8, cursor: "pointer", color: "var(--out-text)" }}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              {ch.role === "channel" && (
                <>
                  <input value={ch.group || ""} onChange={e => patchChannel(ch.id, { group: e.target.value })} placeholder="Grup (mis. Online, Transfer Bank)"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 12, marginBottom: 8, background: "var(--surface)", color: "var(--ink2)" }} />
                  <select value={ch.settleWallet || "w_nf"} onChange={e => patchChannel(ch.id, { settleWallet: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 13 }}>
                    {SETTLE_WALLET_OPTIONS.map(w => (
                      <option key={w.id} value={w.id}>{w.label}</option>
                    ))}
                  </select>
                </>
              )}
            </Card>
          ))}
        </div>

        {adding ? (
          <Card style={{ marginTop: 14, padding: "14px 16px" }}>
            <Fld label="Nama field (label kasir)">
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="mis. QRIS Mandiri"
                style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 14 }} />
            </Fld>
            <Fld label="Grup (opsional)">
              <input value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="mis. Transfer Bank"
                style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 14 }} />
            </Fld>
            <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4, lineHeight: 1.45 }}>
              Channel baru langsung muncul di form kasir <b>KBU, KSM, dan SMT</b>.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={addChannel} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Simpan channel</button>
              <button onClick={() => setAdding(false)} style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer" }}>Batal</button>
            </div>
          </Card>
        ) : (
          <button onClick={() => setAdding(true)} style={{ width: "100%", marginTop: 14, padding: 12, borderRadius: 12, border: "1px dashed var(--brand)", background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Plus size={18} /> Tambah channel baru
          </button>
        )}

        {confirmReset ? (
          <Card style={{ marginTop: 14, padding: "14px 16px", background: "var(--amber-soft)", border: "1px solid #FDE68A" }}>
            <div style={{ fontSize: 13, color: "#92400E", marginBottom: 10 }}>Reset {OUTLET_LABEL[outlet]} ke template awal? Setting custom outlet ini akan diganti.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={resetOutlet} style={{ flex: 1, padding: 10, borderRadius: 10, border: "none", background: "#D97706", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Ya, reset</button>
              <button onClick={() => setConfirmReset(false)} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer" }}>Batal</button>
            </div>
          </Card>
        ) : (
          <button onClick={() => setConfirmReset(true)} style={{ width: "100%", marginTop: 12, padding: 11, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink3)", fontSize: 13, cursor: "pointer" }}>
            Reset outlet ini ke template awal
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ─── Inbox ─────────────────────────────────────────────────
function InboxScreen({ s, onClose, onAccept, onDismiss, onAddDraft }) {
  const [pasteText, setPasteText] = useState("");
  const items = (s.rawInbox || []).map(n => ({ ...n, ...classifyNotif(n) }));

  const submitPaste = () => {
    const draft = parsePastedNotif(pasteText);
    if (!draft) return;
    onAddDraft(draft);
    setPasteText("");
  };

  return (
    <Sheet title="Inbox" onClose={onClose}>
      <div style={{ padding: 16 }}>
        <Card style={{ padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <ClipboardPaste size={16} color="var(--brand)" />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Tempel notifikasi</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 10, lineHeight: 1.45 }}>
            Long-press notif ShopeePay / bank di HP → salin teks → tempel di sini. NF3 buat draf otomatis.
          </div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={"Contoh:\nShopeePay\nSaldo Penjual diperbarui\nPesanan 260610NVKPB36W telah selesai\nRp 41.562"}
            rows={4}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface2)", fontSize: 13, color: "var(--ink)", outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.45 }}
          />
          <button
            type="button"
            disabled={!pasteText.trim()}
            onClick={submitPaste}
            style={{ width: "100%", marginTop: 10, padding: "11px 0", borderRadius: 10, border: "none", background: pasteText.trim() ? "var(--brand)" : "var(--ink3)", opacity: pasteText.trim() ? 1 : 0.5, color: "#fff", fontWeight: 700, fontSize: 13, cursor: pasteText.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Plus size={15} /> Tambah draf
          </button>
        </Card>
        <div style={{ background: "var(--amber-soft)", border: "1px solid #FDE68A", borderRadius: 12, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 16 }}>
          <ShieldCheck size={18} color="var(--amber)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, color: "var(--ink)" }}><b>Penyaring iklan aktif.</b> Notif promo ditandai <b>spam</b> — hanya transaksi nyata yang bisa dibukukan.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map(n => {
            const legit = n.verdict === "legit";
            return (
              <Card key={n.id} style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: legit ? "var(--in-soft)" : "var(--surface2)", color: legit ? "var(--in-text)" : "var(--ink3)" }}>{legit ? "Transaksi nyata" : "Spam / promo"}</span>
                  <span className="money" style={{ fontSize: 17, fontWeight: 800, color: legit ? "var(--ink)" : "var(--ink3)", textDecoration: legit ? "none" : "line-through" }}>{fmtMoney(n.amount, s.profile.currency)}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: legit ? 600 : 400, color: legit ? "var(--ink)" : "var(--ink3)" }}>{n.title}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 3 }}>{n.body} · Notifikasi {n.src}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  {legit ? (
                    <>
                      <button onClick={() => onAccept(n)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Check size={15} />Bukukan</button>
                      <button onClick={() => onDismiss(n.id)} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontWeight: 600, fontSize: 13, color: "var(--ink2)", cursor: "pointer" }}>Abaikan</button>
                    </>
                  ) : (
                    <button onClick={() => onDismiss(n.id)} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontWeight: 600, fontSize: 13, color: "var(--ink2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Trash2 size={14} />Buang spam</button>
                  )}
                </div>
              </Card>
            );
          })}
          {items.length === 0 && <div style={{ textAlign: "center", padding: "40px 0", color: "var(--ink3)" }}>Inbox bersih. Tidak ada draf menunggu.</div>}
        </div>
      </div>
    </Sheet>
  );
}

// ─── Sesuaikan Saldo (Admin / Owner) ───────────────────────
function AdjustSaldoScreen({ s, mutate, onClose, user, business }) {
  const cur = s.profile.currency;
  const wallets = visibleWalletsForBusiness(s.wallets, user, business);
  const [walletId, setWalletId] = useState(wallets[0]?.id || "");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");
  const [doneBal, setDoneBal] = useState(null);

  const bal = walletId ? walletBalance(walletId, s.wallets, s.transactions) : 0;
  const targetNum = +String(target).replace(/\D/g, "") || 0;
  const preview = computeBalanceAdjustment(bal, targetNum);
  const walletName = wallets.find((w) => w.id === walletId)?.name || "Dompet";
  const wallet = wallets.find((w) => w.id === walletId);
  const recentAdj = walletId ? recentBalanceAdjustments(s.transactions, walletId, 5) : [];
  const adjToday = walletId ? countBalanceAdjustments(s.transactions, walletId, today()) : 0;
  const isLaci = !!(wallet?.outlet || /laci/i.test(wallet?.name || ""));

  const apply = () => {
    setErr("");
    const lines = [
      "Sesuaikan saldo",
      "",
      `Dompet: ${walletName}`,
      `Saldo sistem: ${fmtMoney(bal, cur)}`,
      preview.ok ? `Target: ${fmtMoney(preview.target, cur)}` : "",
      "",
      "Tidak untuk:",
      "• Selisih laci → Settle Laporan Kasir",
      "• Purchasing minus → minta admin transfer",
      "",
      "Hanya jika uang fisik/rekening sudah dihitung dan beda dengan Laporan.",
    ].filter(Boolean);
    if (adjToday >= 1) {
      lines.push("", `⚠ Dompet ini sudah ${adjToday}x disesuaikan hari ini — yakin perlu lagi?`);
    }
    lines.push("", "Lanjutkan penyesuaian?");
    if (!confirm(lines.join("\n"))) return;

    try {
      let result = null;
      mutate((d) => {
        const currentBal = walletBalance(walletId, d.wallets, d.transactions);
        result = applyBalanceAdjustment(d, {
          walletId,
          targetNum,
          categories: d.categories,
          date: today(),
          currentBal,
          userRole: user?.role,
        });
      });
      if (!result) return;
      setDoneBal(result.target);
      setTarget("");
      showActionToast(
        `${walletName} disesuaikan → ${fmtMoney(result.target, cur)}`,
        "success"
      );
    } catch (e) {
      const msg = e.message || "Gagal menyesuaikan saldo";
      setErr(msg);
      showActionToast(msg, "error");
    }
  };

  const displayBal = doneBal != null ? doneBal : bal;

  return (
    <Sheet title="Sesuaikan Saldo (recovery)" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 13, color: "var(--out-text)", lineHeight: 1.55, padding: "12px 14px", background: "var(--out-soft)", borderRadius: 12, border: "2px solid var(--out-text)" }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Petunjuk</div>
          <div style={{ color: "var(--ink2)", fontSize: 12, lineHeight: 1.5 }}>
            Fitur ini hanya untuk selisih uang fisik/rekening vs saldo sistem.
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              <li>Selisih laci → <b>Settle Laporan Kasir</b></li>
              <li>Kas Kecil habis → admin <b>transfer dana</b></li>
              <li>Bukan untuk laporan kasir atau purchasing minus</li>
            </ul>
          </div>
        </div>
        {isLaci && (
          <div style={{ fontSize: 12, color: "#92400E", fontWeight: 700, padding: "10px 12px", background: "var(--amber-soft)", borderRadius: 10, lineHeight: 1.45 }}>
            ⚠ Dompet laci — biasanya masalah laporan omset. Cek Settle Laporan dulu.
          </div>
        )}
        {adjToday > 0 && (
          <div style={{ fontSize: 12, color: "var(--out-text)", fontWeight: 700, padding: "10px 12px", background: "var(--amber-soft)", borderRadius: 10 }}>
            Dompet ini sudah {adjToday}× disesuaikan hari ini. Tap berulang biasanya bikin data makin kacau.
          </div>
        )}
        {recentAdj.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--ink2)", padding: "10px 12px", background: "var(--surface2)", borderRadius: 10, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Penyesuaian manual terakhir</div>
            {recentAdj.map((t) => (
              <div key={t.id}>{shortDate(t.date)} · {t.type === "in" ? "+" : "−"}{fmtMoney(t.amount, cur)} · {t.desc}</div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.5, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10 }}>
          Masukkan <b>uang fisik / saldo rekening sekarang</b> — sistem akan diset ke angka itu (bukan tambah/kurang manual berkali-kali).
        </div>
        <Fld label="Dompet">
          <select value={walletId} onChange={e => { setWalletId(e.target.value); setTarget(""); setDoneBal(null); setErr(""); }}
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)" }}>
            {wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Fld>
        {walletId && (
          <>
            <Card style={{ padding: "14px 16px", border: doneBal != null ? "2px solid var(--in-text)" : undefined }}>
              <div style={{ fontSize: 12, color: "var(--ink3)" }}>
                {doneBal != null ? "Saldo setelah penyesuaian" : "Saldo sistem saat ini"}
              </div>
              <div className="money" style={{ fontSize: 22, fontWeight: 800, color: doneBal != null ? "var(--in-text)" : "var(--ink)", marginTop: 4 }}>
                {fmtMoney(displayBal, cur)}
              </div>
              {doneBal != null && (
                <div style={{ fontSize: 12, color: "var(--in-text)", marginTop: 6, fontWeight: 600 }}>
                  ✓ Tersimpan — cek kartu dompet di Beranda
                </div>
              )}
            </Card>
            <Fld label="Uang fisik / saldo rekening sekarang (Rp)">
              <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
                <span style={{ padding: "0 12px", color: "var(--ink3)", fontWeight: 700 }}>Rp</span>
                <input
                  inputMode="numeric"
                  value={target ? new Intl.NumberFormat("id-ID").format(target) : ""}
                  onChange={e => { setTarget(e.target.value.replace(/\D/g, "")); setDoneBal(null); setErr(""); }}
                  placeholder="Hitung uang di laci / cek rekening"
                  style={{ flex: 1, padding: "13px 0", background: "none", border: "none", fontSize: 16, fontWeight: 700, color: "var(--ink)", outline: "none" }}
                />
              </div>
            </Fld>
            {preview.ok && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--brand-soft)", lineHeight: 1.45 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                  Saldo akan menjadi: {fmtMoney(preview.target, cur)}
                </div>
                <div style={{ fontSize: 12, color: preview.delta > 0 ? "var(--in-text)" : "var(--out-text)", fontWeight: 600, marginTop: 6 }}>
                  {preview.delta > 0 ? "Tambah" : "Kurangi"} {fmtMoney(preview.amount, cur)} (koreksi otomatis)
                </div>
              </div>
            )}
            {err && (
              <div style={{ padding: 10, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>
                {err}
              </div>
            )}
            <button disabled={!preview.ok} onClick={apply}
              style={{ width: "100%", padding: 14, borderRadius: 14, border: "none", background: preview.ok ? "var(--out-text)" : "var(--ink3)", opacity: preview.ok ? 1 : .5, color: "#fff", fontWeight: 700, cursor: preview.ok ? "pointer" : "default" }}>
              Terapkan penyesuaian (recovery)
            </button>
            {doneBal != null && (
              <button type="button" onClick={onClose}
                style={{ width: "100%", padding: 12, borderRadius: 12, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                Selesai — kembali ke Beranda
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Settings & Profil ─────────────────────────────────────
function PengaturanScreen({ s, mutate, onClose, setOverlay, setTab, bizId, authUser, signOut, businesses, switchBusiness, businessDisplayName, features, business, onCloudSync = null }) {
  const role = s.currentUser?.role || "kasir";
  const isKasir = role === "kasir";
  const isPurchasing = role === "purchasing";
  const isStaff = isKasir || isPurchasing;
  const purchasingArea = isPurchasing && s.currentUser?.outlet && !["KBU", "KSM", "SMT"].includes(s.currentUser.outlet)
    ? s.currentUser.outlet
    : null;
  const accessibleWallets = isPurchasing
    ? visibleWalletsForBusiness(s.wallets || [], s.currentUser || {}, business)
    : [];
  const walletAccessLabel = isPurchasing
    ? accessibleWallets.map((w) => w.name).join(", ") || "—"
    : "";
  const loginEmail = authUser?.email || s.profile.email || "—";
  const setP = (k, v) => mutate(d => { d.profile[k] = v; });
  const setA = (k, v) => mutate(d => { d.automation[k] = v; });
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(s.profile.name);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [syncState, setSyncState] = useState("idle");

  const manualSync = async () => {
    if (!bizId) return;
    setSyncState("syncing");
    try {
      const { currentUser, users, ...data } = s;
      await saveAppState(bizId, data);
      setSyncState("ok");
      setTimeout(() => setSyncState("idle"), 2500);
    } catch {
      setSyncState("err");
      setTimeout(() => setSyncState("idle"), 3000);
    }
  };

  const syncSub = syncState === "syncing" ? "Menyimpan ke awan…"
    : syncState === "ok" ? "✓ Data tersimpan"
    : syncState === "err" ? "Gagal simpan — coba lagi"
    : "Paksa simpan data ke awan sekarang";

  return (
    <Sheet title="Pengaturan" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <Lbl>Profil</Lbl>
        <Card style={{ overflow: "hidden", marginBottom: 20 }}>
          {isStaff ? (
            <>
              <SRow icon={User} label="Nama staf" val={s.currentUser?.name || "—"} />
              {isKasir ? (
                <SRow icon={Store} label="Outlet / Peran" val={`${s.currentUser?.outlet || "—"} · Kasir`} />
              ) : (
                <>
                  <SRow icon={Store} label="Role" val={ROLE_LABEL[role]} />
                  <SRow icon={Store} label="Lokasi pembelian" val={purchasingArea || "Umum"} />
                  <SRow icon={Wallet} label="Dompet yang dapat diakses" sub={walletAccessLabel} />
                </>
              )}
            </>
          ) : (
            <>
              <SRow icon={User} label="Nama bisnis" val={s.profile.name} onClick={() => setEditName(v => !v)} />
              <SRow icon={Store} label="Tipe Akun" val={s.profile.type} onClick={() => setP("type", s.profile.type === "Usaha" ? "Pribadi" : "Usaha")} />
            </>
          )}
          {canDo(role, "kelolaDompet") && <SRow icon={Wallet} label="Kelola Dompet" sub="Atur dompet dan pembagian uang Anda" onClick={() => setOverlay("wallets")} chev />}
          {canDo(role, "kelolaKategoriSendiri") && <SRow icon={Filter} label="Kelola Kategori" sub={canDo(role, "kelolaKategoriSemua") ? "Semua kategori transaksi" : "Kategori untuk role Anda"} onClick={() => setOverlay("categories")} chev />}
          {features?.purchasingModule && canDo(role, "kelolaKategoriSemua") && (
            <SRow icon={Filter} label="Kategori Purchasing" sub="Icon, warna & sembunyikan 13 kelompok belanja" onClick={() => setOverlay("kategoriPurchasing")} chev />
          )}
          {features?.purchasingModule && canDo(role, "kelolaKategoriSemua") && (
            <SRow icon={Tags} label="Alias Barang Purchasing" sub="Review & approve pengelompokan nama barang" onClick={() => setOverlay("purchasingAliases")} chev />
          )}
          {features?.sosmedReports && canInputSosmed(s.currentUser || {}, s.sosmedConfig) && (role !== "kasir" || isSosmedEnabled(s.sosmedConfig, s.currentUser?.outlet)) && (
            <SRow icon={Smartphone} label="Daily Report Sosmed" sub={`${sosmedDisplayName(s.currentUser?.outlet || "KBU")} · isi laporan hari ini`} onClick={() => setOverlay("sosmedHarian")} chev />
          )}
        </Card>

        {editName && !isStaff && (
          <div style={{ display: "flex", gap: 8, marginTop: -10, marginBottom: 20 }}>
            <input value={name} onChange={e => setName(e.target.value)} style={{ flex: 1, padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
            <button onClick={() => { setP("name", name); setEditName(false); }} style={{ padding: "0 16px", borderRadius: 12, background: "var(--brand)", color: "#fff", fontWeight: 700, border: "none", cursor: "pointer" }}>Simpan</button>
          </div>
        )}

        <Lbl>Tampilan & Format</Lbl>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          {[["sistem", "Sistem", Smartphone], ["terang", "Terang", Sun], ["gelap", "Gelap", Moon]].map(([v, l, Ic]) => (
            <button key={v} onClick={() => setP("theme", v)} style={{ padding: "12px 0", borderRadius: 12, border: `1px solid ${s.profile.theme === v ? "var(--brand)" : "var(--line)"}`, background: s.profile.theme === v ? "var(--brand-soft)" : "var(--surface)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", color: s.profile.theme === v ? "var(--brand)" : "var(--ink2)" }}>
              <Ic size={18} /><span style={{ fontSize: 12, fontWeight: 600 }}>{l}</span>
            </button>
          ))}
        </div>
        <div style={{ marginBottom: 24 }}>
          <div style={{ padding: "13px 16px", borderRadius: 12, border: "1px solid var(--brand)", background: "var(--brand-soft)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 800, fontSize: 18, color: "var(--brand)" }}>Rp</span>
            <span style={{ fontWeight: 700, color: "var(--brand)" }}>Rupiah</span>
            <Check size={16} color="var(--brand)" style={{ marginLeft: "auto" }} />
          </div>
        </div>

        {isKasir && features?.kasirDaily && (
          <>
            <Lbl>Notifikasi Kasir</Lbl>
            <Card style={{ overflow: "hidden", marginBottom: 24 }}>
              <STog icon={Bell} label="Bunyi revisi laporan omset" sub="Chime + getar HP saat admin minta perbaikan laporan harian" on={s.automation?.revisionAlertSound !== false} onToggle={() => setA("revisionAlertSound", s.automation?.revisionAlertSound === false)} />
            </Card>
          </>
        )}

        {canDo(role, "kirimPengumuman") && (
          <>
            <Lbl>Notifikasi Otomatis</Lbl>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: -6, marginBottom: 10, lineHeight: 1.45 }}>
              Pilih jenis notifikasi yang NF3 kirim ke staf. Semua notifikasi aktif bisa di-tap untuk buka form terkait.
            </div>
            <Card style={{ overflow: "hidden", marginBottom: 16 }}>
              {NOTIFICATION_CATALOG.map((c) => (
                <STog
                  key={c.id}
                  icon={Bell}
                  label={c.label}
                  sub={`${c.description} · untuk ${c.recipients}`}
                  on={s.notificationPrefs?.[c.id] !== false}
                  onToggle={() => mutate(d => {
                    if (!d.notificationPrefs) d.notificationPrefs = hydrateNotificationPrefs(null);
                    d.notificationPrefs[c.id] = d.notificationPrefs[c.id] === false;
                  })}
                />
              ))}
            </Card>
            <Card style={{ padding: "14px 16px", marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", marginBottom: 10 }}>Jam pengingat harian</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Fld label="SDM pagi (mulai jam)">
                  <input type="number" min={6} max={14} value={s.notificationPrefs?.sdmReminderHour ?? 10}
                    onChange={e => mutate(d => {
                      if (!d.notificationPrefs) d.notificationPrefs = hydrateNotificationPrefs(null);
                      d.notificationPrefs.sdmReminderHour = Math.min(14, Math.max(6, +e.target.value || 10));
                    })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 14 }} />
                </Fld>
                <Fld label="Report Sosmed (mulai jam)">
                  <input type="number" min={12} max={23} value={s.notificationPrefs?.sosmedReminderHour ?? 20}
                    onChange={e => mutate(d => {
                      if (!d.notificationPrefs) d.notificationPrefs = hydrateNotificationPrefs(null);
                      d.notificationPrefs.sosmedReminderHour = Math.min(23, Math.max(12, +e.target.value || 20));
                    })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 14 }} />
                </Fld>
              </div>
            </Card>
          </>
        )}

        {!isStaff && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Lbl>Otomatisasi</Lbl>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "var(--out-soft)", color: "var(--out-text)", marginBottom: 10 }}>BETA</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: -6, marginBottom: 10 }}>Salin teks notifikasi bank/e-wallet lalu tempel di Inbox. Auto-baca notif HP butuh app Android native (belum tersedia).</div>
            <Card style={{ overflow: "hidden", marginBottom: 24 }}>
              <STog icon={Bell} label="Ingatkan tempel notifikasi" sub="Preferensi: prioritaskan Inbox saat ada draf dari salinan notifikasi" on={s.automation.autoImport} onToggle={() => setA("autoImport", !s.automation.autoImport)} />
              <STog icon={Zap} label="Notifikasi browser saat draf ditambah" sub="Munculkan notifikasi singkat di perangkat (jika diizinkan)" on={s.automation.replyNotif} onToggle={() => setA("replyNotif", !s.automation.replyNotif)} />
            </Card>
          </>
        )}

        {features?.settleLaci && canDo(role, "settleLaci") && (
          <>
            <Lbl>Operasional Outlet</Lbl>
            <Card style={{ marginBottom: 24 }}>
              <SRow icon={TrendingUp} label="Target Omset per Outlet" sub="Omset/org × SDM · gaji harian rasio" onClick={() => setOverlay("outletTargets")} chev />
              <SRow icon={ClipboardList} label="Form Laporan Kasir" sub="Atur field kasir per outlet — tersimpan otomatis" onClick={() => setOverlay("reportChannels")} chev />
              <SRow icon={Banknote} label="Settle Laporan Kasir" sub="Channel non-tunai ke rekening · tunai laci ke Kas Besar" onClick={() => setOverlay("settleLaporan")} chev />
              <SRow icon={Smartphone} label="Daily Report Sosmed" sub="DM, komentar, Google review, komplain · isi harian" onClick={() => setOverlay("sosmedHarian")} chev />
              <SRow icon={Smartphone} label="Aktifkan Sosmed per Outlet" sub="KBU BURI UMAH, Kisamen, Samtaro" onClick={() => setOverlay("sosmedConfig")} chev />
            </Card>
          </>
        )}

        {features?.nfChannelFinance && canDo(role, "kelolaKategoriSemua") && (
          <>
            <Lbl>Channel NF</Lbl>
            <Card style={{ marginBottom: 24 }}>
              <SRow icon={Store} label="Toko Marketplace" sub="Daftar toko & kode per platform — untuk catat settlement MP" onClick={() => setOverlay("mpStores")} chev />
            </Card>
          </>
        )}

        {canDo(role, "kelolaStaf") && (
          <>
            <Lbl>Tim & Staf</Lbl>
            <Card style={{ marginBottom: 24 }}>
              <SRow icon={Users} label="Kelola Staf" sub={canDo(role, "undangStaf") ? "Lihat anggota & undang staf baru" : "Lihat anggota tim"} onClick={() => { window.location.href = "/settings/staf"; }} chev />
            </Card>
          </>
        )}

        {canDo(role, "hubungkanWeb") && (
          <>
            <Lbl>Web Dashboard</Lbl>
            <Card style={{ marginBottom: 24 }}><SRow icon={Monitor} label="Hubungkan ke Web" sub="Buka dashboard & laporan di PC" onClick={() => setOverlay("pair")} chev /></Card>
          </>
        )}

        {canDo(role, "editSaldoDompet") && (
          <>
            <Lbl>Sesuaikan saldo</Lbl>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: -6, marginBottom: 10, lineHeight: 1.45 }}>
              Hanya jika uang fisik/rekening ≠ saldo sistem. Selisih laci → Settle Laporan Kasir.
            </div>
            <Card style={{ overflow: "hidden", marginBottom: 24, border: "1px solid var(--out-soft)" }}>
              <SRow icon={Wallet} label="Sesuaikan Saldo" sub="Uang fisik ≠ saldo sistem" onClick={() => setOverlay("adjustSaldo")} chev />
            </Card>
          </>
        )}

        {!isStaff && (
          <>
            <Lbl>Lainnya</Lbl>
            <Card style={{ marginBottom: 24 }}>
              <SRow icon={ShieldCheck} label="Kebijakan Privasi" sub="Data bisnis tersimpan aman di Supabase milik Anda" onClick={() => setShowPrivacy(true)} chev />
            </Card>
          </>
        )}

        {!isStaff && (
          <>
            <Lbl>Akun & Sync</Lbl>
            <Card style={{ overflow: "hidden", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderBottom: "1px solid var(--line)" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: "var(--brand-soft)", display: "grid", placeItems: "center", color: "var(--brand)", flexShrink: 0 }}><Cloud size={17} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14 }}>Sinkronisasi Awan</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{s.profile.email || "—"} · otomatis saat ada perubahan</div>
                </div>
              </div>
              <SRow icon={RefreshCw} label="Sinkronisasi Manual" sub={syncSub} onClick={syncState === "syncing" ? undefined : manualSync} chev={syncState !== "syncing"} val={syncState === "syncing" ? "…" : undefined} />
            </Card>
          </>
        )}

        {showPrivacy && (
          <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", padding: 20 }} onClick={() => setShowPrivacy(false)}>
            <div style={{ background: "var(--surface)", borderRadius: 16, padding: 20, maxWidth: 360, width: "100%", border: "1px solid var(--line)" }} onClick={e => e.stopPropagation()}>
              <div style={{ fontWeight: 800, fontSize: 17, color: "var(--ink)", marginBottom: 10 }}>Kebijakan Privasi</div>
              <div style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.55 }}>
                Data keuangan bisnis Anda disimpan di database Supabase yang Anda kelola. NF3 tidak menjual atau membagikan data transaksi ke pihak ketiga. Akses staf dibatasi per role (kasir hanya dompet outlet-nya).
              </div>
              <button onClick={() => setShowPrivacy(false)} style={{ width: "100%", marginTop: 16, padding: 12, borderRadius: 12, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Mengerti</button>
            </div>
          </div>
        )}

        <Lbl>Versi aplikasi</Lbl>
        <Card style={{ overflow: "hidden", marginBottom: 16, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5 }}>
            Build: <b style={{ color: "var(--ink)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{getAppBuildLabel()}</b>
            <span style={{ color: "var(--ink3)" }}> · SHA {getAppBuildSha()}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>
            SW {APP_SW_VERSION}. Bandingkan dengan versi server setelah update.
          </div>
          <button
            type="button"
            onClick={() => forceReloadLatestApp()}
            style={{
              marginTop: 10, width: "100%", padding: "11px 12px", borderRadius: 12,
              border: "1px solid var(--brand)", background: "var(--brand-soft)", color: "var(--brand-text)",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >
            Muat ulang aplikasi (pakai versi terbaru)
          </button>
          {typeof onCloudSync === "function" && (
            <button
              type="button"
              onClick={() => onCloudSync()}
              style={{
                marginTop: 8, width: "100%", padding: "11px 12px", borderRadius: 12,
                border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)",
                fontWeight: 700, fontSize: 13, cursor: "pointer",
              }}
            >
              Sinkronkan sekarang
            </button>
          )}
        </Card>

        <Lbl>Akun</Lbl>
        <Card style={{ overflow: "hidden", marginBottom: 16 }}>
          <SRow
            icon={User}
            label={loginEmail}
            sub={`${ROLE_LABEL[role] || role}${s.currentUser?.outlet ? ` · ${s.currentUser.outlet}` : ""} · ${businessDisplayName || s.profile.name || "NF3"}`}
          />
        </Card>

        {(businesses?.length || 0) > 1 && (
          <>
            <Lbl>Ganti Bisnis</Lbl>
            <Card style={{ overflow: "hidden", marginBottom: 16 }}>
              {businesses.map(b => (
                <SRow
                  key={b.id}
                  icon={Store}
                  label={resolveBusinessDisplayName(b)}
                  sub={b.id === bizId
                    ? `${businessTypeLabel(b.type)} · bisnis aktif`
                    : `${businessTypeLabel(b.type)} · ${ROLE_LABEL[b.role] || b.role}${b.outlet ? ` · ${b.outlet}` : ""}`}
                  val={b.id === bizId ? "✓" : undefined}
                  valColor="var(--in-text)"
                  onClick={b.id !== bizId && switchBusiness ? () => switchBusiness(b.id) : undefined}
                  chev={b.id !== bizId && !!switchBusiness}
                />
              ))}
            </Card>
          </>
        )}

        {signOut && (
          <button
            type="button"
            onClick={() => signOut()}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: 14,
              border: "1px solid #FECACA",
              background: "var(--out-soft)",
              color: "var(--out-text)",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}>
            <LogOut size={18} />
            Keluar / Ganti Akun
          </button>
        )}
        <div style={{ fontSize: 11, color: "var(--ink3)", textAlign: "center", marginTop: 10, lineHeight: 1.45 }}>
          Logout lalu login dengan akun kasir atau admin lain.
        </div>
      </div>
    </Sheet>
  );
}
function SRow({ icon: Ic, label, sub, val, valColor, onClick, chev }) {
  return (
    <button onClick={onClick} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderBottom: "1px solid var(--line)", background: "none", border: "none", borderBottom: "1px solid var(--line)", cursor: onClick ? "pointer" : "default", textAlign: "left" }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: "var(--brand-soft)", display: "grid", placeItems: "center", color: "var(--brand)", flexShrink: 0 }}><Ic size={17} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{sub}</div>}
      </div>
      {val && <span style={{ fontSize: 13, fontWeight: 700, color: valColor || "var(--ink2)", marginRight: 4 }}>{val}</span>}
      {chev && <ChevronRight size={16} color="var(--ink3)" />}
    </button>
  );
}
function STog({ icon: Ic, label, sub, on, onToggle }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: "var(--brand-soft)", display: "grid", placeItems: "center", color: "var(--brand)", flexShrink: 0 }}><Ic size={17} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{sub}</div>}
      </div>
      <Tog on={on} onToggle={onToggle} />
    </div>
  );
}

// ─── Kelola Dompet (Admin NF3 / owner only) ────────────────
function WalletScreen({ s, mutate, onClose, user, bizId, businesses = [], features }) {
  const [edit, setEdit] = useState(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErr, setLogoErr] = useState("");
  const [linkPicker, setLinkPicker] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState("");
  const role = user?.role || "kasir";
  const isOwner = role === "owner";
  const walletSetup = s.walletSetup || createWalletSetupSeed();
  const sharedLinks = walletSetup.sharedLinks || [];
  const otherBusinesses = (businesses || []).filter((b) => b.id !== bizId && b.role === "owner");

  if (!canDo(role, "kelolaDompet")) {
    return (
      <Sheet title="Dompet" onClose={onClose}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--ink3)", fontSize: 14 }}>
          Hanya Admin NF3 dan Owner yang bisa mengubah dompet dan saldo.
        </div>
      </Sheet>
    );
  }

  const save = (w) => {
    const { accessMode: _accessMode, ...walletInput } = w || {};
    const isPaylater = w.type === "paylater" || w.liability === true;
    const normalized = {
      ...walletInput,
      purchasingUse: w.purchasingUse === true || /kas\s*kecil/i.test(w.name || ""),
      sort: w.sort ?? (Math.max(0, ...s.wallets.map(x => x.sort || 0)) + 10),
      updatedAt: new Date().toISOString(),
      ...(isPaylater ? { type: "paylater", liability: true, allowNegative: true } : {}),
      ...(!features?.isFnB ? { outlet: null, allowedOutlets: [] } : {}),
    };
    mutate(d => {
      const i = d.wallets.findIndex(x => x.id === normalized.id);
      if (i >= 0) d.wallets[i] = normalized;
      else d.wallets.push({ ...normalized, id: normalized.id || ("w" + Date.now()) });
      d.wallets = sortWallets(d.wallets);
    });
    setEdit(null);
  };

  const moveWallet = (id, dir) => {
    mutate(d => {
      const ws = sortWallets([...d.wallets]);
      const i = ws.findIndex(w => w.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ws.length) return;
      [ws[i], ws[j]] = [ws[j], ws[i]];
      ws.forEach((w, idx) => { w.sort = (idx + 1) * 10; });
      d.wallets = ws;
    });
  };

  const sortedWallets = sortWallets(
    s.wallets.filter((w) => w.type !== "shared" && (features?.isFnB || !isFnBOnlyWallet(w)))
  );
  const assignableMembers = (s.members || []).filter((m) => m.active !== false && (m.role === "kasir" || m.role === "purchasing"));
  const hasAssignableMembers = assignableMembers.length > 0;

  const ensureWalletSetup = (d) => {
    if (!d.walletSetup?.initialized) {
      d.walletSetup = { ...createWalletSetupSeed(), ...(d.walletSetup || {}), initialized: true };
    }
    return d.walletSetup;
  };

  const refreshSharedWallets = (d) => {
    d.wallets = rebuildWalletsWithShared(d.wallets, d.walletSetup);
  };

  const toggleSharedLink = (linkId) => {
    mutate((d) => {
      const setup = ensureWalletSetup(d);
      const link = (setup.sharedLinks || []).find((l) => l.id === linkId);
      if (link) link.enabled = !link.enabled;
      refreshSharedWallets(d);
    });
  };

  const removeSharedLink = (linkId) => {
    mutate((d) => {
      const setup = ensureWalletSetup(d);
      setup.sharedLinks = (setup.sharedLinks || []).filter((l) => l.id !== linkId);
      refreshSharedWallets(d);
    });
  };

  const openLinkPicker = async (biz) => {
    setLinkErr("");
    setLinkBusy(true);
    try {
      const doc = await loadAppState(biz.id);
      const wallets = filterShareableRemoteWallets(
        sortWallets((doc?.wallets || []).filter((w) => w.type !== "shared" && w.active !== false))
      );
      if (!wallets.length) {
        setLinkErr(`Tidak ada rekening bank aktif di ${biz.name || "bisnis tersebut"}. Hanya rekening yang boleh dihubungkan.`);
        return;
      }
      setLinkPicker({ biz, wallets });
    } catch (e) {
      setLinkErr(e.message || "Gagal memuat dompet bisnis lain");
    } finally {
      setLinkBusy(false);
    }
  };

  const addSharedLink = (biz, wallet) => {
    if (!isCrossBusinessShareableWallet(wallet)) {
      setLinkErr("Hanya rekening bank yang boleh dihubungkan — NF Cash, laci, dan kas tidak.");
      setLinkPicker(null);
      return;
    }
    mutate((d) => {
      const setup = ensureWalletSetup(d);
      const exists = (setup.sharedLinks || []).some(
        (l) => l.sourceBusinessId === biz.id && l.sourceWalletId === wallet.id
      );
      if (exists) return;
      setup.sharedLinks = [
        ...(setup.sharedLinks || []),
        createSharedWalletLink({
          sourceBusinessId: biz.id,
          sourceBusinessName: biz.name,
          sourceWalletId: wallet.id,
          sourceWalletName: wallet.name,
          sourceWalletType: wallet.type,
        }),
      ];
      refreshSharedWallets(d);
    });
    setLinkPicker(null);
  };

  const toggleActive = (id) => mutate(d => {
    const w = d.wallets.find(x => x.id === id);
    if (w) w.active = !w.active;
  });

  const tryDelete = (w) => {
    const bal = walletBalance(w.id, s.wallets, s.transactions);
    if (bal !== (w.floor || 0)) {
      alert(`Tidak bisa dihapus. Saldo harus sama dengan floor (Rp ${new Intl.NumberFormat("id-ID").format(w.floor || 0)}) sebelum dihapus.`);
      return;
    }
    mutate(d => { d.wallets = d.wallets.filter(x => x.id !== w.id); });
  };

  const typeLabels = { kas_fisik: "Kas Fisik", rekening: "Rekening", digital: "Digital", ewallet: "E-Wallet", paylater: "PayLater" };
  const typeColors = { kas_fisik: "#D97706", rekening: "#1D4ED8", digital: "#7C3AED", ewallet: "#EE4D2D", paylater: "#B45309" };

  const onLogoPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f || !edit) return;
    setLogoErr("");
    setLogoBusy(true);
    try {
      const logoUrl = await compressWalletLogo(f);
      setEdit(prev => ({ ...prev, logoUrl }));
    } catch (err) {
      setLogoErr(err.message || "Gagal memproses gambar");
    } finally {
      setLogoBusy(false);
      e.target.value = "";
    }
  };

  return (
    <Sheet title="Kelola Dompet" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 4, lineHeight: 1.45 }}>
          Urutan tampil di Beranda — pakai <b>↑ ↓</b> untuk mengatur posisi.
          Tombol <b>✕ / ✓</b> = tampil atau sembunyikan di Beranda (dompet tetap ada, hanya tidak muncul).
        </div>
        {sortedWallets.map((w, idx) => {
          const bal = walletBalance(w.id, s.wallets, s.transactions);
          const floorHint = walletFloorHint(bal, w.floor);
          const nearFloor = !!floorHint;
          return (
            <Card key={w.id} style={{ padding: "14px 16px", position: "relative", overflow: "hidden", opacity: w.active === false ? .5 : 1 }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: w.color }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <WalletIcon wallet={w} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "var(--ink)" }}>{w.name}</span>
                    {w.outlet && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "var(--brand-soft)", color: "var(--brand)" }}>{w.outlet}</span>}
                    {w.ownerOnly && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "var(--amber-soft)", color: "var(--amber)" }}>Owner</span>}
                    {w.purchasingUse && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "#FEF3C7", color: "#92400E" }}>Purchasing</span>}
                    {w.type && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: typeColors[w.type] + "22", color: typeColors[w.type] }}>{typeLabels[w.type]}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>
                    Saldo: <b style={{ color: nearFloor ? "var(--out-text)" : "var(--ink)" }}>{fmtMoney(bal, "IDR")}</b>
                    {w.floor > 0 && <span style={{ color: "var(--ink3)" }}> · Floor: {fmtMoney(w.floor, "IDR")}</span>}
                    {floorHint && <span style={{ color: "var(--out-text)", fontWeight: 600 }}> ⚠ {floorHint}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexDirection: "column" }}>
                  <button type="button" disabled={idx === 0} onClick={() => moveWallet(w.id, -1)}
                    style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface2)", border: "none", cursor: idx === 0 ? "default" : "pointer", display: "grid", placeItems: "center", color: "var(--ink2)", opacity: idx === 0 ? 0.35 : 1 }}>
                    <ChevronUp size={14} />
                  </button>
                  <button type="button" disabled={idx === sortedWallets.length - 1} onClick={() => moveWallet(w.id, 1)}
                    style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface2)", border: "none", cursor: idx === sortedWallets.length - 1 ? "default" : "pointer", display: "grid", placeItems: "center", color: "var(--ink2)", opacity: idx === sortedWallets.length - 1 ? 0.35 : 1 }}>
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => toggleActive(w.id)} style={{ width: 32, height: 32, borderRadius: 99, background: w.active === false ? "var(--in-soft)" : "var(--surface2)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: w.active === false ? "var(--in)" : "var(--ink3)" }}>
                    {w.active === false ? <Check size={14} /> : <X size={14} />}
                  </button>
                  <button onClick={() => setEdit({ ...w })} style={{ width: 32, height: 32, borderRadius: 99, background: "var(--surface2)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "var(--ink2)" }}><Pencil size={14} /></button>
                  <button onClick={() => tryDelete(w)} style={{ width: 32, height: 32, borderRadius: 99, background: "var(--out-soft)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "var(--out)" }}><Trash2 size={14} /></button>
                </div>
              </div>
            </Card>
          );
        })}

        <button onClick={() => setEdit({ id: "w" + Date.now(), name: "", type: "kas_fisik", outlet: null, color: "#6366F1", opening: 0, floor: 0, active: true, ownerOnly: false, purchasingUse: false, sort: (Math.max(0, ...s.wallets.map(x => x.sort || 0)) + 10) })}
          style={{ padding: 14, borderRadius: 16, border: "2px dashed var(--line)", background: "none", color: "var(--brand)", fontWeight: 600, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Plus size={18} />Tambah dompet baru
        </button>

        {isOwner && otherBusinesses.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}>Rekening bank bersama (opsional)</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.45, marginBottom: 12 }}>
              {SHARED_WALLET_POLICY_HINT}
            </div>
            {linkErr && <div style={{ fontSize: 12, color: "var(--out-text)", marginBottom: 8 }}>{linkErr}</div>}
            {sharedLinks.map((link) => (
              <Card key={link.id} style={{ padding: "12px 14px", marginBottom: 8, opacity: link.enabled ? 1 : 0.65 }}>
                <div style={{ display: "flex", alignItems: "center",gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>{link.sourceWalletName || link.label}</div>
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                      Dari: {link.sourceBusinessName || "Bisnis lain"} · {link.enabled ? "Aktif di Beranda" : "Nonaktif — belum tampil"}
                    </div>
                  </div>
                  <button type="button" onClick={() => toggleSharedLink(link.id)}
                    style={{ padding: "6px 12px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: link.enabled ? "var(--surface2)" : "var(--brand-soft)", color: link.enabled ? "var(--ink2)" : "var(--brand)" }}>
                    {link.enabled ? "Matikan" : "Aktifkan"}
                  </button>
                  <button type="button" onClick={() => removeSharedLink(link.id)}
                    style={{ width: 32, height: 32, borderRadius: 99, background: "var(--out-soft)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "var(--out)" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </Card>
            ))}
            <div style={{ display: "flex", flexWrap: "wrap",gap: 8, marginTop: 8 }}>
              {otherBusinesses.map((biz) => (
                <button key={biz.id} type="button" disabled={linkBusy} onClick={() => openLinkPicker(biz)}
                  style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 13, fontWeight: 600, color: "var(--brand)", cursor: linkBusy ? "wait" : "pointer" }}>
                  {linkBusy ? "Memuat…" : `+ Dari ${biz.name}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {linkPicker && (
        <div style={{ position: "absolute", inset: 0, zIndex: 35, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "flex-end" }} onClick={() => setLinkPicker(null)}>
          <div style={{ width: "100%", background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: 20, maxHeight: "70vh", overflowY: "auto" }} className="scroll-hide" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 17, color: "var(--ink)", marginBottom: 4 }}>Pilih rekening dari {linkPicker.biz.name}</div>
            <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 14 }}>Hanya rekening bank — kas NF, laci, dan e-wallet tidak bisa dihubungkan.</div>
            {linkPicker.wallets.map((w) => (
              <button key={w.id} type="button" onClick={() => addSharedLink(linkPicker.biz, w)}
                style={{ width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 8, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", cursor: "pointer" }}>
                <div style={{ fontWeight: 700, color: "var(--ink)" }}>{w.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>{w.type || "dompet"}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {edit && (
        <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "flex-end" }} onClick={() => setEdit(null)}>
          <div style={{ width: "100%", background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: 20, maxHeight: "80vh", overflowY: "auto" }} className="scroll-hide" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 18, color: "var(--ink)", marginBottom: 16 }}>{edit.name ? `Edit: ${edit.name}` : "Dompet baru"}</div>
            {!features?.isFnB && (
              <div style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.45, padding: "10px 12px", borderRadius: 12, background: "var(--surface2)", marginBottom: 12 }}>
                <b>NF Nusa Fishing</b> — tidak pakai outlet resto. <b>Kas Fisik</b> = uang tunai, <b>E-Wallet</b> = ShopeePay/dll, <b>PayLater</b> = hutang, <b>Digital</b> = channel online (jarang dipakai di NF).
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Fld label="Nama">
                <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder={features?.isFnB ? "cth: Laci KBU" : "cth: Dompet Uang Makan"} style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
              </Fld>
              <Fld label="Tipe">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  {Object.entries(typeLabels).map(([v, l]) => (
                    <button key={v} onClick={() => {
                      const next = { ...edit, type: v };
                      if (v === "paylater") {
                        next.liability = true;
                        next.allowNegative = true;
                      }
                      setEdit(next);
                    }} style={{ padding: "9px 0", borderRadius: 10, fontSize: 12, fontWeight: 600, border: `1px solid ${edit.type === v ? typeColors[v] : "var(--line)"}`, background: edit.type === v ? typeColors[v] + "22" : "var(--surface)", color: edit.type === v ? typeColors[v] : "var(--ink2)", cursor: "pointer" }}>{l}</button>
                  ))}
                </div>
                {edit.type === "paylater" && (
                  <div style={{ fontSize: 11, color: "#B45309", marginTop: 8, lineHeight: 1.4 }}>
                    PayLater = hutang wajib bayar. Saldo boleh minus saat belanja.
                  </div>
                )}
              </Fld>
              {features?.isFnB && (
              <Fld label="Outlet (opsional)">
                <div style={{ display: "flex", gap: 6 }}>
                  {[null, "KBU", "KSM", "SMT"].map(o => (
                    <button key={o ?? "semua"} onClick={() => setEdit({ ...edit, outlet: o })} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, border: `1px solid ${edit.outlet === o ? "var(--brand)" : "var(--line)"}`, background: edit.outlet === o ? "var(--brand-soft)" : "var(--surface)", color: edit.outlet === o ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>{o ?? "Semua"}</button>
                  ))}
                </div>
              </Fld>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Fld label="Saldo awal (Rp)">
                  <input inputMode="numeric" value={edit.opening ? new Intl.NumberFormat("id-ID").format(edit.opening) : ""} onChange={e => setEdit({ ...edit, opening: +e.target.value.replace(/\D/g, "") })} placeholder="0" style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 6, lineHeight: 1.4 }}>
                    {features?.isFnB
                      ? "Saldo = saldo awal + transaksi. Selisih laci → Settle Laporan Kasir."
                      : "Saldo = saldo awal + transaksi masuk/keluar."}
                  </div>
                </Fld>
                <Fld label="Floor minimum (Rp)">
                  <input inputMode="numeric" value={edit.floor ? new Intl.NumberFormat("id-ID").format(edit.floor) : ""} onChange={e => setEdit({ ...edit, floor: +e.target.value.replace(/\D/g, "") })} placeholder="0" style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
                </Fld>
              </div>
              <Fld label="Owner only (rekening bank)">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Tog on={!!edit.ownerOnly} onToggle={() => setEdit({ ...edit, ownerOnly: !edit.ownerOnly })} />
                  <span style={{ fontSize: 13, color: "var(--ink2)" }}>Hanya Owner yang bisa lihat</span>
                </div>
              </Fld>
              <Fld label="Penggunaan dompet">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Tog on={!!edit.purchasingUse} onToggle={() => setEdit({ ...edit, purchasingUse: !edit.purchasingUse })} />
                  <span style={{ fontSize: 13, color: "var(--ink2)" }}>Tampilkan dompet ini sebagai pilihan pada Form Belanja Purchasing</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 6, lineHeight: 1.4 }}>
                  Jika aktif, dompet bisa dipilih saat input belanja. Ini tidak otomatis membuka akses ke semua user.
                </div>
              </Fld>
              <Fld label="Akses pengguna">
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)" }}>
                  {(() => {
                    const accessMode = edit.accessMode || ((Array.isArray(edit.allowedUserIds) && edit.allowedUserIds.length > 0) ? "restricted" : "default");
                    return (
                      <>
                  <div style={{ fontSize: 11, color: "var(--ink3)", lineHeight: 1.4, marginBottom: 4 }}>
                    Tentukan siapa yang boleh melihat dan memakai dompet ini.
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink2)" }}>
                    <input
                      type="radio"
                      name={`wallet-access-${edit.id}`}
                      checked={accessMode === "default"}
                      onChange={(e) => {
                        if (e.target.checked) setEdit({ ...edit, accessMode: "default", allowedUserIds: [] });
                      }}
                    />
                    Ikuti akses bawaan sistem (role + outlet)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink2)" }}>
                    <input
                      type="radio"
                      name={`wallet-access-${edit.id}`}
                      checked={accessMode === "restricted"}
                      disabled={!hasAssignableMembers}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const firstUid = assignableMembers[0]?.user_id;
                          setEdit({ ...edit, accessMode: "restricted", allowedUserIds: firstUid ? [firstUid] : [] });
                        }
                      }}
                    />
                    Batasi ke pengguna tertentu
                  </label>
                  {!hasAssignableMembers && (
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                      Belum ada akun kasir/purchasing aktif untuk dipilih.
                    </div>
                  )}
                  {assignableMembers.map((m) => {
                    const uid = m.user_id;
                    const checked = Array.isArray(edit.allowedUserIds) && edit.allowedUserIds.includes(uid);
                    const canToggle = accessMode === "restricted";
                    return (
                      <label key={uid} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: canToggle ? "var(--ink)" : "var(--ink3)" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canToggle}
                          onChange={(e) => {
                            const prev = Array.isArray(edit.allowedUserIds) ? edit.allowedUserIds : [];
                            const next = e.target.checked ? [...new Set([...prev, uid])] : prev.filter((x) => x !== uid);
                            setEdit({ ...edit, accessMode: "restricted", allowedUserIds: next });
                          }}
                        />
                        {m.profiles?.name || m.profiles?.email || uid} · {ROLE_LABEL[m.role] || m.role}{m.outlet ? ` · ${m.outlet}` : ""}
                      </label>
                    );
                  })}
                  {(accessMode === "default" || !Array.isArray(edit.allowedUserIds) || edit.allowedUserIds.length === 0) && (
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                      Saat mode bawaan aktif, akses user mengikuti role + outlet dari sistem.
                    </div>
                  )}
                      </>
                    );
                  })()}
                </div>
              </Fld>
              <Fld label="Role yang boleh akses (opsional)">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)" }}>
                  {(["owner", "admin", "purchasing", ...(features?.isFnB ? ["kasir"] : [])]).map((r) => {
                    const checked = Array.isArray(edit.allowedRoles) && edit.allowedRoles.includes(r);
                    return (
                      <label key={r} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const prev = Array.isArray(edit.allowedRoles) ? edit.allowedRoles : [];
                            const next = e.target.checked ? [...new Set([...prev, r])] : prev.filter((x) => x !== r);
                            setEdit({ ...edit, allowedRoles: next });
                          }}
                        />
                        {ROLE_LABEL[r] || r}
                      </label>
                    );
                  })}
                  {(!Array.isArray(edit.allowedRoles) || edit.allowedRoles.length === 0) && (
                    <div style={{ width: "100%", fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                      Kosong = tidak dibatasi role (akses ditentukan oleh aturan user/outlet yang berlaku).
                    </div>
                  )}
                </div>
              </Fld>
              {features?.isFnB && Array.isArray(edit.allowedRoles) && edit.allowedRoles.includes("kasir") && (
                <Fld label="Outlet kasir yang boleh akses">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)" }}>
                    {["KBU", "KSM", "SMT"].map((o) => {
                      const checked = Array.isArray(edit.allowedOutlets) && edit.allowedOutlets.includes(o);
                      return (
                        <label key={o} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)", padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const prev = Array.isArray(edit.allowedOutlets) ? edit.allowedOutlets : [];
                              const next = e.target.checked ? [...new Set([...prev, o])] : prev.filter((x) => x !== o);
                              setEdit({ ...edit, allowedOutlets: next });
                            }}
                          />
                          {o}
                        </label>
                      );
                    })}
                    {(!Array.isArray(edit.allowedOutlets) || edit.allowedOutlets.length === 0) && (
                      <div style={{ width: "100%", fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                        Kosong = semua outlet kasir.
                      </div>
                    )}
                  </div>
                </Fld>
              )}
              <Fld label="Logo dompet (opsional)">
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)" }}>
                  <WalletIcon wallet={edit} size={52} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <label style={{
                        display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10,
                        background: logoBusy ? "var(--line)" : "var(--brand)", color: logoBusy ? "var(--ink3)" : "#fff",
                        fontSize: 12, fontWeight: 700, cursor: logoBusy ? "wait" : "pointer",
                      }}>
                        {logoBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        {logoBusy ? "Mengompres…" : "Upload logo"}
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={logoBusy}
                          style={{ display: "none" }} onChange={onLogoPick} />
                      </label>
                      {walletHasLogo(edit) && (
                        <button type="button" onClick={() => setEdit({ ...edit, logoUrl: null })}
                          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12, fontWeight: 600, color: "var(--out-text)", cursor: "pointer" }}>
                          Hapus logo
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 8, lineHeight: 1.45 }}>
                      PNG/JPG · otomatis dikompres 128px agar loading cepat
                    </div>
                    {logoErr && <div style={{ fontSize: 11, color: "var(--out-text)", marginTop: 6 }}>{logoErr}</div>}
                  </div>
                </div>
              </Fld>
              <Fld label="Warna">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["#6366F1","#16A34A","#D97706","#0EA5E9","#8B5CF6","#EC4899","#14B8A6","#F97316","#1D4ED8","#DC2626","#CA8A04","#7C3AED"].map(c => (
                    <button key={c} onClick={() => setEdit({ ...edit, color: c })} style={{ width: 30, height: 30, borderRadius: 99, background: c, border: edit.color === c ? "3px solid var(--ink)" : "3px solid transparent", cursor: "pointer" }} />
                  ))}
                </div>
              </Fld>
            </div>
            <button disabled={!edit.name} onClick={() => save(edit)}
              style={{ width: "100%", marginTop: 16, padding: 14, borderRadius: 14, border: "none", background: edit.name ? "var(--brand)" : "var(--ink3)", opacity: edit.name ? 1 : .5, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              Simpan dompet
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ─── Kelola Kategori ───────────────────────────────────────
function CatScreen({ s, mutate, onClose }) {
  const user = s.currentUser || { role: "kasir" };
  const role = user.role;
  const canManageAll = canDo(role, "kelolaKategoriSemua");
  const showInTab = canManageAll || canDo(role, "inputIncome");
  const [tab, setTab] = useState("out");
  const [name, setName] = useState("");
  const [catErr, setCatErr] = useState("");

  const cats = s.categories.filter(c => {
    if (c.type !== tab) return false;
    if (canManageAll) return true;
    if (c.role !== role) return false;
    if (role === "kasir" && c.outlet && c.outlet !== user.outlet) return false;
    return true;
  });

  const addCat = () => {
    const built = buildNewCategory({ name, type: tab, user, categories: s.categories });
    if (!built.ok) {
      setCatErr(built.error || "Gagal menambah kategori.");
      return;
    }
    setCatErr("");
    mutate((d) => { d.categories.push(built.category); });
    setName("");
  };
  const canEdit = (c) => canEditCategory(c, user);
  const toggleCat = (id) => mutate(d => { const c = d.categories.find(x => x.id === id); if (c && canEdit(c)) c.active = !c.active; });
  const deleteCat = (id) => {
    mutate((d) => applyRemoveCategory(d, id));
  };

  return (
    <Sheet title="Kelola Kategori" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        {!canManageAll && (
          <div style={{ fontSize: 12, color: "var(--ink3)", marginBottom: 12, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10 }}>
            Kategori yang Anda buat hanya untuk role <b>{ROLE_LABEL[role]}</b>{user.outlet ? ` · ${user.outlet}` : ""}.
          </div>
        )}
        {showInTab ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, background: "var(--surface2)", borderRadius: 12, padding: 4, marginBottom: 16 }}>
            {[["out", "Pengeluaran"], ["in", "Pemasukan"]].map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)} style={{ padding: 10, borderRadius: 9, border: "none", cursor: "pointer", background: tab === v ? "var(--brand)" : "transparent", color: tab === v ? "#fff" : "var(--ink2)", fontWeight: 700, fontSize: 13 }}>{l}</button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginBottom: 16 }}>Kategori Pengeluaran Belanja</div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: catErr ? 8 : 16 }}>
          <input value={name} onChange={e => { setName(e.target.value); setCatErr(""); }} onKeyDown={e => e.key === "Enter" && addCat()} placeholder="Nama kategori baru" style={{ flex: 1, padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
          <button onClick={addCat} style={{ width: 44, height: 44, borderRadius: 12, background: "var(--brand)", border: "none", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><Plus size={20} /></button>
        </div>
        {catErr && <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 12 }}>{catErr}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {cats.map(c => {
            const Ic = getCatIcon(c);
            return (
              <Card key={c.id} style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, opacity: c.active === false ? .5 : 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: tab === "in" ? "var(--in-soft)" : "var(--out-soft)", display: "grid", placeItems: "center", color: tab === "in" ? "var(--in)" : "var(--out)" }}><Ic size={16} /></div>
                <span style={{ flex: 1, fontWeight: 600, color: "var(--ink)" }}>{c.name}</span>
                {c.role && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "var(--brand-soft)", color: "var(--brand)" }}>{ROLE_LABEL[c.role] || c.role}{c.outlet ? ` · ${c.outlet}` : ""}</span>}
                {c.active === false && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "var(--surface2)", color: "var(--ink3)" }}>nonaktif</span>}
                {canEdit(c) && (
                  <>
                    <button onClick={() => toggleCat(c.id)} title={c.active === false ? "Aktifkan" : "Nonaktifkan"} style={{ width: 30, height: 30, borderRadius: 99, background: c.active === false ? "var(--in-soft)" : "var(--surface2)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: c.active === false ? "var(--in)" : "var(--ink3)" }}>
                      {c.active === false ? <Check size={13} /> : <X size={13} />}
                    </button>
                    <button onClick={() => deleteCat(c.id)} style={{ width: 30, height: 30, borderRadius: 99, background: "var(--out-soft)", border: "none", cursor: "pointer", display: "grid", placeItems: "center", color: "var(--out)" }}><Trash2 size={13} /></button>
                  </>
                )}
              </Card>
            );
          })}
          {cats.length === 0 && <div style={{ textAlign: "center", color: "var(--ink3)", padding: "20px 0", fontSize: 13 }}>Belum ada kategori {tab === "in" ? "pemasukan" : "pengeluaran"}.</div>}
        </div>
      </div>
    </Sheet>
  );
}

// ─── Web Pairing ───────────────────────────────────────────
function PairScreen({ bizId, authUser, onClose }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("loading"); // loading | waiting | connected | error
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!bizId || !authUser?.id) {
      setStatus("error");
      setErr("Data bisnis tidak lengkap");
      return;
    }
    let alive = true;

    (async () => {
      try {
        const res = await fetch("/api/pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: authUser.id, businessId: bizId }),
        });
        const json = await res.json();
        if (!res.ok) {
          const msg = typeof json.error === "string" ? json.error : (json.error?.message || json.message || "Gagal buat kode");
          throw new Error(msg);
        }
        if (!alive) return;
        setCode(json.code);
        setStatus("waiting");

        pollRef.current = setInterval(async () => {
          try {
            const pr = await fetch("/api/pair", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code: json.code }),
            });
            const pj = await pr.json();
            if (pj.approved) {
              clearInterval(pollRef.current);
              setStatus("connected");
            }
          } catch { /* ignore poll errors */ }
        }, 2000);
      } catch (e) {
        if (alive) { setErr(e.message); setStatus("error"); }
      }
    })();

    return () => { alive = false; clearInterval(pollRef.current); };
  }, [bizId, authUser?.id]);

  const pairUrl = pairPageUrl();

  return (
    <Sheet title="Hubungkan ke Web" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <Card style={{ padding: 24, textAlign: "center", marginBottom: 16, background: "var(--brand-soft)" }}>
          <Monitor size={48} color="var(--brand)" style={{ margin: "0 auto 12px" }} />
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--brand-text)" }}>Pantau Laporan di PC</div>
          <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 6, lineHeight: 1.5 }}>
            Buka di browser PC:{" "}
            <a href={pairUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)", fontWeight: 700, wordBreak: "break-all" }}>
              {pairUrl}
            </a>
            {" "}lalu masukkan kode di bawah.
          </div>
        </Card>

        {status === "loading" && (
          <div style={{ textAlign: "center", padding: 24, color: "var(--brand)", fontWeight: 600 }}>
            <Loader2 size={24} style={{ animation: "spin 1s linear infinite", margin: "0 auto 8px" }} />
            Membuat kode…
          </div>
        )}

        {status === "error" && (
          <div style={{ padding: 14, borderRadius: 12, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>
            {err || "Gagal membuat kode"}
          </div>
        )}

        {(status === "waiting" || status === "connected") && code && (
          <Card style={{ padding: 20, background: status === "connected" ? "#F0FDF4" : "#F0FDF4", border: `1px solid ${status === "connected" ? "#86EFAC" : "#BBF7D0"}`, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 6 }}>
              {status === "connected" ? "✓ PC terhubung!" : "Kode untuk PC (aktif 10 menit)"}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.1em", color: "#16A34A" }}>{code}</span>
              <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                style={{ width: 36, height: 36, borderRadius: 99, background: "none", border: "none", cursor: "pointer", color: "#16A34A" }}>
                {copied ? <Check size={20} /> : <Copy size={20} />}
              </button>
            </div>
            {status === "waiting" && (
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 10 }}>
                Menunggu PC memasukkan kode…
              </div>
            )}
          </Card>
        )}
      </div>
    </Sheet>
  );
}

// ─── Pengumuman Staf ───────────────────────────────────────
function BroadcastScreen({ s, mutate, onClose, user }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState("all");
  const [targetValue, setTargetValue] = useState("KBU");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const send = () => {
    setErr(""); setOk("");
    try {
      const msg = createStaffMessage({
        title, body,
        targetType,
        targetValue: targetType === "all" ? null : targetValue,
        author: user,
      });
      mutate(d => {
        if (!d.staffMessages) d.staffMessages = [];
        d.staffMessages.unshift(msg);
      });
      setOk("Pengumuman terkirim — muncul di lonceng staf setelah sync.");
      setTitle(""); setBody("");
    } catch (e) {
      setErr(e.message || "Gagal kirim");
    }
  };

  const recent = (s.staffMessages || []).slice(0, 5);

  return (
    <Sheet title="Kirim Pengumuman" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px" }}>
        <div style={{ fontSize: 13, color: "var(--ink3)", lineHeight: 1.5, marginBottom: 14, padding: "10px 12px", background: "var(--surface2)", borderRadius: 10 }}>
          Staf melihat pengumuman di ikon <b>lonceng</b> setelah sync (otomatis atau tap ☁️).
        </div>
        <Fld label="Judul">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="cth: Settle omset hari ini"
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none" }} />
        </Fld>
        <div style={{ height: 10 }} />
        <Fld label="Isi pesan">
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="Instruksi untuk kasir…"
            style={{ width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, color: "var(--ink)", outline: "none", resize: "vertical" }} />
        </Fld>
        <div style={{ height: 10 }} />
        <Fld label="Tujuan">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {[["all", "Semua staf"], ["outlet", "Per outlet"], ["role", "Per role"]].map(([v, l]) => (
              <button key={v} onClick={() => setTargetType(v)} style={{ padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, border: `1px solid ${targetType === v ? "var(--brand)" : "var(--line)"}`, background: targetType === v ? "var(--brand-soft)" : "var(--surface)", color: targetType === v ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          {targetType === "outlet" && (
            <div style={{ display: "flex", gap: 6 }}>
              {["KBU", "KSM", "SMT"].map(o => (
                <button key={o} onClick={() => setTargetValue(o)} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, border: `1px solid ${targetValue === o ? "var(--brand)" : "var(--line)"}`, background: targetValue === o ? "var(--brand-soft)" : "var(--surface)", color: targetValue === o ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>{o}</button>
              ))}
            </div>
          )}
          {targetType === "role" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["kasir", "purchasing"].map(r => (
                <button key={r} onClick={() => setTargetValue(r)} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, border: `1px solid ${targetValue === r ? "var(--brand)" : "var(--line)"}`, background: targetValue === r ? "var(--brand-soft)" : "var(--surface)", color: targetValue === r ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
          )}
        </Fld>
        {err && <div style={{ color: "var(--out-text)", fontSize: 13, marginTop: 10 }}>{err}</div>}
        {ok && <div style={{ color: "var(--in-text)", fontSize: 13, marginTop: 10 }}>{ok}</div>}
        <button disabled={!title.trim() || !body.trim()} onClick={send}
          style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: title.trim() && body.trim() ? "var(--brand)" : "var(--ink3)", opacity: title.trim() && body.trim() ? 1 : .5, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
          Kirim pengumuman
        </button>

        {recent.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginTop: 24, marginBottom: 10 }}>Terakhir dikirim</div>
            {recent.map(m => (
              <Card key={m.id} style={{ padding: 12, marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>
                  {formatMessageTime(m.createdAt)} · {m.target?.type === "all" ? "Semua" : m.target?.type === "outlet" ? m.target.value : ROLE_LABEL[m.target?.value] || m.target?.value}
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </Sheet>
  );
}

// ─── Notif ─────────────────────────────────────────────────
function NotifScreen({ s, user, mutate, onClose, onCompose, onAction }) {
  const items = visibleStaffMessages(s.staffMessages, user)
    .filter((m) => getMessageKind(m) === "broadcast" || !isStaffMessageStale(m, s.dailyReports));
  const canSend = canDo(user.role, "kirimPengumuman");

  const openMsg = (msg) => {
    if (user?.id) {
      mutate(d => { d.staffMessages = markStaffMessageRead(d.staffMessages, msg.id, user.id); });
    }
  };

  const runAction = (msg) => {
    openMsg(msg);
    const action = getStaffMessageAction(msg, user);
    if (action && onAction) {
      onAction(action);
      return;
    }
    if (getMessageKind(msg) !== "broadcast") {
      showActionToast("Buka menu terkait dari Beranda jika tombol tidak tersedia.", "info");
    }
  };

  return (
    <Sheet title="Pengumuman" onClose={onClose}>
      <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
        {canSend && (
          <button onClick={onCompose} style={{ padding: 14, borderRadius: 14, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Bell size={16} /> Kirim pengumuman ke staf
          </button>
        )}
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "var(--ink3)", fontSize: 13 }}>
            Belum ada pengumuman.{canSend ? " Gunakan tombol di atas untuk kirim instruksi ke kasir." : " Notifikasi operasional (revisi, dana masuk, pengingat sosmed, dll.) akan muncul di sini."}
          </div>
        ) : items.map(n => {
          const unread = user?.id && !(n.readBy || []).includes(user.id);
          const kind = getMessageKind(n);
          const action = getStaffMessageAction(n, user);
          const canTap = !!action && !!onAction && !isStaffMessageStale(n, s.dailyReports);
          const urgent = action?.urgent;
          const kindLabel = kind !== "broadcast" ? notificationKindLabel(kind) : null;
          return (
            <Card key={n.id} role={canTap ? "button" : undefined} tabIndex={canTap ? 0 : undefined}
              style={{ padding: 16, border: urgent ? "2px solid var(--out-text)" : unread ? "1px solid var(--brand)" : undefined, background: urgent ? "var(--out-soft)" : undefined, cursor: canTap ? "pointer" : undefined }}
              onClick={() => (canTap ? runAction(n) : openMsg(n))}
              onKeyDown={(e) => { if (canTap && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); runAction(n); } }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700, color: urgent ? "var(--out-text)" : "var(--brand)", fontSize: 14 }}>{n.title}</div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {kindLabel && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "var(--surface2)", color: "var(--ink3)" }}>{kindLabel}</span>}
                  {(unread || urgent) && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: urgent ? "#FEE2E2" : "var(--brand-soft)", color: urgent ? "var(--out-text)" : "var(--brand)" }}>{canTap ? "Tap aksi" : unread ? "Baru" : ""}</span>}
                </div>
              </div>
              <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{n.body}</div>
              {canTap && action?.label && (
                <button type="button" onClick={(e) => { e.stopPropagation(); runAction(n); }}
                  style={{ width: "100%", marginTop: 12, padding: 12, borderRadius: 12, border: "none", background: urgent ? "var(--out-text)" : "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                  {action.label}
                </button>
              )}
              <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 8 }}>
                {formatMessageTime(n.createdAt)} · {n.createdBy}
                {n.target?.type === "outlet" && ` · ${n.target.value}`}
                {n.target?.type === "role" && ` · ${ROLE_LABEL[n.target.value] || n.target.value}`}
              </div>
            </Card>
          );
        })}
      </div>
    </Sheet>
  );
}

// ─── Void / Cancel / Koreksi Transaksi ─────────────────────
function VoidScreen({ s, mutate, user, reviewOnly = false }) {
  const cur = s.profile.currency;
  const isKasir = canDo(user.role, "inputVoid");
  const canReview = canDo(user.role, "reviewVoidLog");
  const logs = visibleVoidLogs(s.voidLogs, user);
  const waiting = pendingVoidLogs(s.voidLogs);
  const outletLabel = OUTLET_LABEL[user.outlet] || user.outlet;

  const [mode, setMode] = useState("cancel");
  const [date, setDate] = useState(today());
  const [txnNo, setTxnNo] = useState("");
  const [txnNoNew, setTxnNoNew] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [voidedBy, setVoidedBy] = useState(user.name || "");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [filter, setFilter] = useState("pending");

  const resetForm = () => {
    setTxnNo(""); setTxnNoNew(""); setCustomerName(""); setReason(""); setAmount("");
    setVoidedBy(user.name || ""); setDate(today()); setErr(""); setOk("");
  };

  const submit = () => {
    setErr(""); setOk("");
    try {
      const { entry } = submitVoidLog(s, {
        type: mode,
        date,
        txnNo,
        txnNoNew: mode === "replacement" ? txnNoNew : undefined,
        customerName,
        reason,
        amount,
        voidedBy,
      }, user);
      mutate(d => {
        if (!d.voidLogs) d.voidLogs = [];
        d.voidLogs.push(entry);
        try {
          const nmsg = createVoidPendingMessage({ entry, author: user });
          d.staffMessages = prependStaffMessage(d.staffMessages, nmsg, d.notificationPrefs);
        } catch { /* ignore */ }
      });
      setOk(mode === "cancel" ? "Void cancel tercatat — Admin keuangan akan review." : "Transaksi baru tercatat — Admin keuangan akan review.");
      resetForm();
    } catch (e) {
      setErr(e.message || "Gagal menyimpan");
    }
  };

  const markReviewed = (id) => {
    try {
      const { entry, index } = reviewVoidLog(s, id, user);
      mutate(d => { d.voidLogs[index] = entry; });
    } catch (e) {
      setErr(e.message);
    }
  };

  const numInput = (val, set) => (
    <div style={{ display: "flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface)" }}>
      <span style={{ padding: "0 12px", color: "var(--ink3)", fontWeight: 700 }}>Rp</span>
      <input inputMode="numeric" value={val ? new Intl.NumberFormat("id-ID").format(val) : ""} onChange={e => set(e.target.value.replace(/\D/g, ""))} placeholder="0"
        style={{ flex: 1, padding: "12px 0", background: "none", border: "none", fontSize: 16, fontWeight: 700, color: "var(--ink)", outline: "none" }} />
    </div>
  );

  const filtered = logs.filter(v => {
    if (filter === "pending") return v.status === "submitted";
    if (filter === "reviewed") return v.status === "reviewed";
    return true;
  }).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return (
    <div style={{ padding: reviewOnly ? "0 0 24px" : "16px 16px 90px" }}>
      {!reviewOnly && (
        <>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", marginBottom: 4 }}>Form Void</div>
      <div style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 16 }}>
        {isKasir
          ? `Catat cancel atau koreksi transaksi ${outletLabel} — Admin Keuangan review sebelum settle omset.`
          : "Review void dari kasir outlet — pastikan arah koreksi jelas sebelum settle omset."}
      </div>
        </>
      )}

      {canReview && waiting.length > 0 && (
        <Card style={{ marginBottom: 16, padding: "12px 14px", background: "var(--amber-soft)", border: "1px solid #FDE68A" }}>
          <div style={{ fontWeight: 800, color: "#92400E", fontSize: 14 }}>⏳ {waiting.length} void menunggu review</div>
        </Card>
      )}

      {isKasir && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["cancel", "Void Cancel"], ["replacement", "Transaksi Baru"]].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setErr(""); setOk(""); }}
                style={{ flex: 1, padding: "11px 0", borderRadius: 12, border: `1px solid ${mode === m ? "var(--brand)" : "var(--line)"}`, background: mode === m ? "var(--brand-soft)" : "var(--surface)", fontWeight: 700, fontSize: 13, color: mode === m ? "var(--brand)" : "var(--ink2)", cursor: "pointer" }}>
                {l}
              </button>
            ))}
          </div>

          <Card style={{ padding: "16px 16px", marginBottom: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "var(--ink)", marginBottom: 14 }}>
              {mode === "cancel" ? "Form Void Cancel" : "Form Transaksi Baru"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Fld label="Tanggal">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} max={today()}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, outline: "none" }} />
              </Fld>
              <Fld label={mode === "replacement" ? "Nomor Transaksi Lama" : "Nomor Transaksi"}>
                <input value={txnNo} onChange={e => setTxnNo(e.target.value)} placeholder="SKBU028169326110"
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, outline: "none" }} />
              </Fld>
              {mode === "replacement" && (
                <Fld label="Nomor Transaksi Baru">
                  <input value={txnNoNew} onChange={e => setTxnNoNew(e.target.value)} placeholder="SKBU02202606160015"
                    style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, outline: "none" }} />
                </Fld>
              )}
              <Fld label="Nama Kasir">
                <input value={user.name || ""} readOnly style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface2)", fontSize: 14, color: "var(--ink2)" }} />
              </Fld>
              {mode === "cancel" && (
                <Fld label="Nama Customer">
                  <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nama pelanggan"
                    style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, outline: "none" }} />
                </Fld>
              )}
              <Fld label={mode === "cancel" ? "Alasan Cancel" : "Perubahan Yang Dilakukan"}>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="mis. ganti cash ke qris"
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, outline: "none" }} />
              </Fld>
              <Fld label={mode === "replacement" ? "Nominal Transaksi Baru" : "Nominal Transaksi"}>
                {numInput(amount, setAmount)}
              </Fld>
              <Fld label="Orang Yang Ngevoid">
                <input value={voidedBy} onChange={e => setVoidedBy(e.target.value)}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 14, outline: "none" }} />
              </Fld>
            </div>
            {err && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "var(--out-soft)", color: "var(--out-text)", fontSize: 13 }}>{err}</div>}
            {ok && <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "var(--in-soft)", color: "var(--in-text)", fontSize: 13 }}>{ok}</div>}
            <button onClick={submit} style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Simpan catatan void →
            </button>
          </Card>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)" }}>Riwayat void</div>
        {canReview && (
          <div style={{ display: "flex", gap: 6 }}>
            {[["pending", "Menunggu"], ["all", "Semua"], ["reviewed", "Reviewed"]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ padding: "4px 10px", borderRadius: 99, border: `1px solid ${filter === k ? "var(--brand)" : "var(--line)"}`, background: filter === k ? "var(--brand-soft)" : "var(--surface)", fontSize: 11, fontWeight: 700, color: filter === k ? "var(--brand)" : "var(--ink3)", cursor: "pointer" }}>{l}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map(v => (
          <Card key={v.id} style={{ padding: "14px 16px", borderLeft: `4px solid ${v.status === "submitted" ? "#D97706" : "var(--in-text)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: v.type === "cancel" ? "var(--out-soft)" : "var(--brand-soft)", color: v.type === "cancel" ? "var(--out-text)" : "var(--brand)" }}>
                  {VOID_TYPES[v.type]?.label || v.type}
                </span>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--ink)", marginTop: 6 }}>{OUTLET_LABEL[v.outlet] || v.outlet} · {shortDate(v.date)}</div>
              </div>
              <div className="money" style={{ fontWeight: 800, color: "var(--brand)", fontSize: 15 }}>{fmtMoney(v.amount, cur)}</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8, lineHeight: 1.5 }}>
              <div><b>No:</b> {v.txnNo}{v.txnNoNew ? ` → ${v.txnNoNew}` : ""}</div>
              {v.customerName && <div><b>Customer:</b> {v.customerName}</div>}
              <div><b>{v.type === "cancel" ? "Alasan" : "Perubahan"}:</b> {v.reason}</div>
              <div><b>Kasir:</b> {v.kasirName} · <b>Ngevoid:</b> {v.voidedBy}</div>
              <div style={{ color: "var(--ink3)", marginTop: 4 }}>{new Date(v.submittedAt).toLocaleString("id-ID")}</div>
            </div>
            {canReview && v.status === "submitted" && (
              <button onClick={() => markReviewed(v.id)} style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 10, border: "none", background: "var(--brand)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                ✓ Tandai reviewed
              </button>
            )}
            <ShareWaBtn text={formatVoidWa(v)} compact style={{ width: "100%", marginTop: 10 }} />
            {v.status === "reviewed" && (
              <div style={{ fontSize: 11, color: "var(--in-text)", marginTop: 8, fontWeight: 700 }}>✓ Reviewed{v.reviewedByName ? ` · ${v.reviewedByName}` : ""}</div>
            )}
          </Card>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink3)", padding: "32px 0", fontSize: 13 }}>Belum ada catatan void.</div>
        )}
      </div>
    </div>
  );
}

function WalletHistoryScreen({ s, business, walletId, onClose, sharedTxByWallet, bizId, features }) {
  const user = s.currentUser || { role: "kasir" };
  const isShared = isSharedWallet({ id: walletId });
  const [loadingShared, setLoadingShared] = useState(false);
  const [sharedTxLocal, setSharedTxLocal] = useState(null);

  useEffect(() => {
    if (!isShared || !bizId) return;
    const cached = sharedTxByWallet?.[walletId];
    if (cached?.length) {
      setSharedTxLocal(cached);
      return;
    }
    let cancelled = false;
    setLoadingShared(true);
    (async () => {
      try {
        const r = await fetchSharedBankTransactions(bizId, { sharedWalletId: walletId, limit: 100 });
        if (!cancelled) setSharedTxLocal(r.transactions || []);
      } catch {
        if (!cancelled) setSharedTxLocal([]);
      } finally {
        if (!cancelled) setLoadingShared(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isShared, bizId, walletId, sharedTxByWallet]);

  const allVisibleTx = useMemo(
    () => visibleTransactionsForBusiness(s.transactions, s.wallets, user, business),
    [s.transactions, s.wallets, user, business]
  );
  const myWallets = useMemo(
    () => visibleWalletsForBusiness(s.wallets, user, business),
    [s.wallets, user, business]
  );
  const wallet = myWallets.find((w) => w.id === walletId) || s.wallets.find((w) => w.id === walletId);
  const tx = useMemo(() => {
    if (!walletId) return [];
    if (isShared) {
      let rows = sharedTxLocal || sharedTxByWallet?.[walletId] || [];
      if (features?.nfChannelFinance) {
        rows = filterTransactionsForNfFinance(rows, s.categories, {
          businessId: bizId,
          role: user.role,
          userId: user.id,
        });
      }
      return [...rows].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id || "").localeCompare(a.id || ""));
    }
    let local = allVisibleTx.filter((t) => {
      if (t.type === "transfer") {
        const { from, to } = resolveTransferIds(t);
        return from === walletId || to === walletId;
      }
      return resolveWalletId(t) === walletId;
    });
    if (features?.nfChannelFinance) {
      local = filterTransactionsForNfFinance(local, s.categories, {
        businessId: bizId,
        role: user.role,
        userId: user.id,
      });
    }
    return local.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id || "").localeCompare(a.id || ""));
  }, [allVisibleTx, walletId, isShared, sharedTxLocal, sharedTxByWallet, features?.nfChannelFinance, s.categories, bizId, user.role, user.id]);

  return (
    <Sheet title={`Riwayat ${wallet?.name || "Dompet"}`} onClose={onClose}>
      <div style={{ padding: "12px 16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {isShared && (
          <div style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600, padding: "0 2px 4px" }}>
            {features?.nfChannelFinance
              ? "Rekening bersama · hanya catatan yang ditulis dari NF"
              : "Dompet bersama · data dari FNB"}
          </div>
        )}
        {loadingShared && tx.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink3)", padding: "20px 0", fontSize: 13 }}>Memuat riwayat…</div>
        )}
        {tx.map((t) => {
          const isTransfer = t.type === "transfer";
          const cat = s.categories.find((c) => c.id === t.categoryId);
          const { from, to } = isTransfer ? resolveTransferIds(t) : { from: null, to: null };
          const fromW = isTransfer ? s.wallets.find((w) => w.id === from) : null;
          const toW = isTransfer ? s.wallets.find((w) => w.id === to) : null;
          const signedPrefix = isTransfer
            ? (to === walletId ? "+" : "−")
            : (t.type === "in" ? "+" : "−");
          const amountColor = signedPrefix === "+" ? "var(--in-text)" : "var(--out-text)";
          const title = isTransfer
            ? `${fromW?.name || "Dompet"} → ${toW?.name || "Dompet"}`
            : (t.desc || cat?.name || "Transaksi");
          return (
            <Card key={t.id} style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>{title}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink3)" }}>
                    {isTransfer ? "Transfer" : (t.type === "in" ? "Pemasukan" : "Pengeluaran")} · {shortDate(t.date)}
                  </div>
                </div>
                <div className="money" style={{ fontWeight: 800, fontSize: 14, color: amountColor, whiteSpace: "nowrap" }}>
                  {signedPrefix}{fmtMoney(t.amount, s.profile.currency)}
                </div>
              </div>
            </Card>
          );
        })}
        {tx.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink3)", padding: "28px 0", fontSize: 13 }}>
            Belum ada transaksi pada dompet ini.
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ─── NavBar ────────────────────────────────────────────────
function NavBar({ tab, setTab, onMic, user, business, micTitle, shellMaxWidth = 440 }) {
  const cfg = navConfig(user, business);
  const feat = businessFeatures(business);
  const isNfPurchasingNav = user?.role === "purchasing" && !feat.purchasingModule;
  const tabIcons = { beranda: Home, laporan: BarChart3, analisis: Sparkles, asisten: MessageCircle, void: Ban, profil: User };
  const CenterIcon = isNfPurchasingNav ? Plus : Mic;

  const renderTab = (id, label, badge = 0) => {
    const Ic = tabIcons[id] || Home;
    return (
      <button key={id} onClick={() => setTab(id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "8px 0", position: "relative", minWidth: 0 }}>
        <Ic size={22} color={tab === id ? "var(--brand)" : "var(--ink3)"} />
        {badge > 0 && <span style={{ position: "absolute", top: 2, right: "calc(50% - 18px)", minWidth: 14, height: 14, borderRadius: 99, background: "var(--out)", color: "#fff", fontSize: 9, fontWeight: 700, display: "grid", placeItems: "center", padding: "0 2px" }}>{badge}</span>}
        <span style={{ fontSize: 11, fontWeight: tab === id ? 700 : 400, color: tab === id ? "var(--brand)" : "var(--ink3)" }}>{label}</span>
      </button>
    );
  };

  const left = cfg.left.map(([id, label]) => [id, label, 0]);
  const right = cfg.right.map((row) => [row[0], row[1], row[2] || 0]);

  const ui = getAccountUi(user, business);
  const micGrad = ui.saldoGradient || "linear-gradient(135deg,#6366F1,#4F46E5)";
  const centerTitle = isNfPurchasingNav ? "Catat belanja" : (micTitle || ui.micTitle);

  return (
    <div className="nf3-bottom-nav-wrap">
      <div className="nf3-bottom-nav" style={{ maxWidth: shellMaxWidth }}>
        <div className="nf3-bottom-nav-inner">
          <div style={{ flex: 1, display: "flex", minWidth: 0 }}>{left.map(([id, label, badge]) => renderTab(id, label, badge))}</div>
          <div style={{ width: 68, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", minWidth: 0, justifyContent: right.length === 1 ? "center" : "stretch" }}>{right.map(([id, label, badge]) => renderTab(id, label, badge))}</div>
          <button onClick={onMic} title={centerTitle} aria-label={centerTitle} style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: -16, width: 56, height: 56, borderRadius: 99, background: micGrad, border: "4px solid var(--surface)", display: "grid", placeItems: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(5,150,105,.35)", zIndex: 2 }}>
            <CenterIcon size={isNfPurchasingNav ? 26 : 24} color="#fff" strokeWidth={isNfPurchasingNav ? 2.5 : 2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────
export default function NF3App(props) {
  const { bizId, authUser, members, businesses, business, signOut, switchBusiness, webMode, session } = props;
  const businessDisplayName = resolveBusinessDisplayName(business);
  const [s, setS] = useState(null);
  const [tab, setTab] = useState(webMode ? "laporan" : "beranda");
  const [overlay, setOverlay] = useState(null);
  const [catat, setCatat] = useState(false);
  const [hide, setHide] = useState(false);
  const [cloudSyncState, setCloudSyncState] = useState("idle");
  const [syncInfo, setSyncInfo] = useState(null);
  const [realtimeLive, setRealtimeLive] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [walletHistoryId, setWalletHistoryId] = useState(null);
  const [fnbGate, setFnbGate] = useState(null);
  const [sharedMirror, setSharedMirror] = useState(null);
  const [sharedTxByWallet, setSharedTxByWallet] = useState(null);
  const [laporanInitialDate, setLaporanInitialDate] = useState(null);
  const [laporanOpenSeq, setLaporanOpenSeq] = useState(0);
  const [isWideScreen, setIsWideScreen] = useState(false);
  const skipSaveRef = useRef(false);
  const allowSaveRef = useRef(false);
  const saveQueueRef = useRef(Promise.resolve());
  const cloudSyncBusyRef = useRef(false);
  const lastOwnSaveAtRef = useRef(null);
  const lastSavePayloadRef = useRef(null);
  const realtimePullTimerRef = useRef(null);
  const saveDebounceRef = useRef(null);
  const pendingSavePayloadRef = useRef(null);
  const criticalSaveUntilRef = useRef(0);
  const sRef = useRef(null);
  const overlayRef = useRef(null);
  const catatRef = useRef(false);
  const addTxBusyRef = useRef(false);
  const revisionNotifiedRef = useRef(new Set());
  const openLaporanRef = useRef(null);
  const notifActionRef = useRef(null);

  const getActiveAccountLabel = useCallback(() => {
    const u = sRef.current?.currentUser || authUser || {};
    const roleText = u?.role ? (ROLE_LABEL[u.role] || u.role) : "Akun";
    const unit = u?.role === "kasir" ? u?.outlet : (u?.outlet || null);
    return unit ? `${u?.name || "Staf"} · ${roleText} · ${unit}` : `${u?.name || "Staf"} · ${roleText}`;
  }, [authUser]);

  useEffect(() => { sRef.current = s; }, [s]);
  useEffect(() => { overlayRef.current = overlay; }, [overlay]);
  useEffect(() => { catatRef.current = catat; }, [catat]);

  useEffect(() => { registerServiceWorker(); }, []);

  useEffect(() => {
    const check = () => setIsWideScreen(typeof window !== "undefined" && window.innerWidth >= 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const effectiveWebMode = webMode || isWideScreen;

  useEffect(() => {
    const unlock = () => unlockNotificationAudio();
    document.addEventListener("pointerdown", unlock, { once: true, passive: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  const applyMemberUsers = useCallback((doc, memberRows) => {
    if (!doc || typeof doc !== "object") return doc;
    const out = { ...doc };
    if (Array.isArray(memberRows) && memberRows.length) {
      out.users = memberRows
        .filter(m => m.profiles)
        .map(m => ({ id: m.profiles.id, name: m.profiles.name, role: m.role, outlet: m.outlet }));
    }
    delete out.currentUser;
    return out;
  }, []);

  const mergeLoadedDoc = useCallback(
    (doc) => applyMemberUsers(withReconciledReports(doc), members),
    [applyMemberUsers, members]
  );

  const flushSave = useCallback((opts = {}) => {
    const force = opts.force === true;
    if (!bizId || (!force && skipSaveRef.current) || !allowSaveRef.current) return Promise.resolve(null);
    const payload = pendingSavePayloadRef.current;
    if (!payload) return saveQueueRef.current.catch(() => null);
    const payloadKey = JSON.stringify(payload);
    if (lastSavePayloadRef.current === payloadKey) {
      pendingSavePayloadRef.current = null;
      return saveQueueRef.current.catch(() => null);
    }
    lastSavePayloadRef.current = payloadKey;
    pendingSavePayloadRef.current = null;

    const savePromise = saveQueueRef.current
      .catch(() => {}) // lanjut antrean meski save sebelumnya gagal
      .then(async () => {
        // force=true dipakai sync: flush pending sebelum pull, meski skipSave sudah di-arm
        if (!force && skipSaveRef.current) {
          throw new Error("Simpan ditunda (sedang sync dari awan). Coba lagi sebentar.");
        }
        const updatedAt = await saveState(bizId, payload);
        if (updatedAt) {
          lastOwnSaveAtRef.current = updatedAt;
          setS((prev) => (prev && !skipSaveRef.current ? { ...prev, _cloudUpdatedAt: updatedAt } : prev));
        }
        return updatedAt;
      });

    // Side-effect toast pada gagal, lalu re-reject agar await scheduleImmediateSave gagal
    // (mencegah false success / checklist hijau padahal awan belum commit).
    saveQueueRef.current = savePromise.catch((e) => {
      console.error(e);
      lastSavePayloadRef.current = null;
      setCloudSyncState("err");
      setTimeout(() => setCloudSyncState("idle"), 4500);
      playNotificationPing();
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate([80, 60, 120]); } catch { /* ignore */ }
      }
      const errText = String(e?.message || "");
      const networkHint = /timeout|network|failed to fetch|offline/i.test(errText)
        ? "Indikasi jaringan lambat/putus."
        : "";
      showActionToast(
        `Gagal simpan ke awan (${getActiveAccountLabel()}) — data masih di HP (jangan input ulang). ${networkHint} Tap ☁️ untuk retry.`,
        "error",
        7000
      );
      return Promise.reject(e);
    });

    return savePromise;
  }, [bizId, getActiveAccountLabel]);

  const reloadFromCloud = useCallback(async (opts = {}) => {
    const manual = opts.manual === true;
    const quiet = opts.source === "realtime";
    if (!bizId) {
      if (manual) showActionToast("Belum ada bisnis aktif.", "error");
      return;
    }
    if (cloudSyncBusyRef.current) {
      if (manual) showActionToast("Masih menyinkronkan… tunggu sebentar.", "info", 2200);
      return;
    }
    if (catatRef.current || isUserTypingInForm()) {
      if (manual) showActionToast("Selesaikan input dulu — sync ditunda agar data tidak hilang.", "info", 4000);
      return;
    }
    if (overlayRef.current === "laporanHarian") {
      if (manual) showActionToast("Tutup form laporan harian dulu, lalu tap awan lagi.", "info", 4000);
      return;
    }

    cloudSyncBusyRef.current = true;
    if (!quiet) setCloudSyncState("syncing");
    setLoadErr(null);
    if (manual) {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(15); } catch { /* ignore */ }
      }
      showActionToast("Menyinkronkan dari awan…", "info", 8000);
    }
    try {
      clearTimeout(saveDebounceRef.current);
      // PENTING: flush pending DULU (force), baru arm skipSave.
      // Bug historis: skipSave=true sebelum flush → pending lokal tidak pernah terdorong,
      // lalu pull/merge bisa membuat status “belum terkirim” meski pusat sudah punya record.
      if (sRef.current) {
        pendingSavePayloadRef.current = extractSavePayload(sRef.current);
      }
      try {
        await flushSave({ force: true });
      } catch (flushErr) {
        logDailyReportStage("SYNC_FLUSH_PENDING_FAILED", {
          outletCode: sRef.current?.currentUser?.outlet || null,
          result: "failed",
          error: flushErr?.message || String(flushErr),
          source: "sync",
        });
      }
      await saveQueueRef.current.catch(() => {});
      skipSaveRef.current = true;

      const cloudDoc = await loadState(bizId, { businessType: business?.type, business });
      const prev = sRef.current;
      if (quiet && cloudDoc?._cloudUpdatedAt && prev?._cloudUpdatedAt === cloudDoc._cloudUpdatedAt) {
        return;
      }
      let nextDoc = cloudDoc;
      if (prev) {
        const strip = (doc) => {
          const { currentUser: _cu, users: _u, _systemThemeTick: _t, _cloudUpdatedAt: _c, ...rest } = doc || {};
          return rest;
        };
        const merged = mergeAppStateFromCloudPull(strip(cloudDoc), strip(prev));
        nextDoc = {
          ...cloudDoc,
          ...merged,
          transactions: normalizeTransactions(merged.transactions),
          wallets: merged.wallets ?? cloudDoc.wallets,
          _cloudUpdatedAt: cloudDoc._cloudUpdatedAt,
        };
        logDailyReportStage("SYNC_PULL_MERGED", {
          outletCode: prev?.currentUser?.outlet || null,
          result: "existing_or_upsert",
          localReportCount: (prev.dailyReports || []).length,
          cloudReportCount: (cloudDoc.dailyReports || []).length,
          mergedReportCount: (nextDoc.dailyReports || []).length,
          source: "sync",
        });
      }
      // Heal checklist: data pusat sudah ada → synced (jangan biarkan failed menahan UI)
      healPendingSectionStatuses(nextDoc);
      const loaded = mergeLoadedDoc(nextDoc);
      setS(loaded);
      sRef.current = loaded;
      allowSaveRef.current = true;
      const meta = buildSyncMeta(nextDoc, prev);
      setSyncInfo(meta);
      if (!quiet) setCloudSyncState("ok");
      if (manual) {
        if (meta.saldoDelta && Math.abs(meta.saldoDelta.delta) >= 1000) {
          const wName = (nextDoc?.wallets || []).find(w => w.id === meta.saldoDelta.walletId)?.name || "Dompet";
          showActionToast(
            `Sync OK · ${wName} ${meta.saldoDelta.delta > 0 ? "+" : ""}${fmtMoney(meta.saldoDelta.delta, nextDoc?.profile?.currency || "IDR")} · Kode ${meta.code}`,
            "success",
            4500
          );
        } else {
          showActionToast(`Sync OK · ${meta.hint || "Data diperbarui"} · Kode ${meta.code}`, "success", 4000);
        }
      } else if (quiet && meta.hint && meta.hint !== "Sudah versi terbaru") {
        showActionToast(`Data baru dari HP lain · ${meta.hint}`, "info", 3500);
      } else if (meta.saldoDelta && Math.abs(meta.saldoDelta.delta) >= 1000) {
        const wName = (nextDoc?.wallets || []).find(w => w.id === meta.saldoDelta.walletId)?.name || "Dompet";
        showActionToast(
          `${wName} diperbarui (${meta.saldoDelta.delta > 0 ? "+" : ""}${fmtMoney(meta.saldoDelta.delta, nextDoc?.profile?.currency || "IDR")}) dari HP lain`,
          "info",
          3500
        );
      }
      if (!quiet) setTimeout(() => setCloudSyncState("idle"), manual ? 4000 : 2000);
    } catch (e) {
      const msg = e.message || "Gagal memuat";
      setLoadErr(msg);
      if (!quiet) {
        setCloudSyncState("err");
        setTimeout(() => setCloudSyncState("idle"), manual ? 4500 : 2500);
      }
      if (manual) {
        const networkHint = /timeout|network|failed to fetch|offline/i.test(String(msg))
          ? "Kemungkinan jaringan lambat/putus."
          : null;
        showActionToast(
          `Gagal sync awan: ${msg}.${networkHint ? ` ${networkHint}` : ""} Tap ☁️ lagi.`,
          "error",
          5600
        );
      }
    } finally {
      skipSaveRef.current = false;
      cloudSyncBusyRef.current = false;
    }
  }, [bizId, business?.type, mergeLoadedDoc, flushSave]);

  /**
   * Pemulihan aman dari checklist "Sinkronkan sekarang":
   * flush pending → pull pusat → bind by slot/idempotency — tanpa create identitas baru.
   */
  const recoverPendingKasirSections = useCallback(async ({ focus = "omset" } = {}) => {
    if (!bizId) {
      showActionToast("Belum ada bisnis aktif.", "error");
      return;
    }
    if (cloudSyncBusyRef.current) {
      showActionToast("Masih menyinkronkan… tunggu sebentar.", "info", 2200);
      return;
    }
    showActionToast("Menyinkronkan data pending ke pusat… jangan isi ulang.", "info", 5000);
    logDailyReportStage("RECOVER_PENDING_START", {
      outletCode: sRef.current?.currentUser?.outlet || null,
      focus,
      source: "checklist_sync",
      reportType: focus === "omset" ? "omzet" : focus,
    });
    try {
      await reloadFromCloud({ manual: true });
      const after = sRef.current;
      healPendingSectionStatuses(after || {});
      if (after) {
        setS((prev) => (prev ? { ...prev, ...after, dailyReports: after.dailyReports, sdmReports: after.sdmReports, sosmedReports: after.sosmedReports } : prev));
      }
      const outlet = after?.currentUser?.outlet || sRef.current?.currentUser?.outlet;
      const d = todayLocal();
      const omzet = (after?.dailyReports || []).find((r) => r.outlet === outlet && (r.date === d || r.date?.startsWith?.(d)));
      const sdm = (after?.sdmReports || []).find((r) => r.outlet === outlet && r.date === d);
      const sosmed = (after?.sosmedReports || []).find((r) => r.outlet === outlet && r.date === d);
      const focusRow = focus === "sdm" ? sdm : focus === "sosmed" ? sosmed : omzet;
      logDailyReportStage("RECOVER_PENDING_DONE", {
        outletCode: outlet,
        focus,
        result: focusRow && isSectionSynced(focusRow) ? "synced" : "still_pending",
        serverRecordId: focusRow?.serverRecordId || focusRow?.id || null,
        syncStatus: focusRow?.syncStatus || null,
        source: "checklist_sync",
      });
      if (focusRow && isSectionSynced(focusRow)) {
        showActionToast(SYNCED_HINT, "success", 4000);
      } else if (focus === "omset" && !omzet) {
        showActionToast("Belum ada laporan omzet di pusat untuk hari ini. Buka form hanya jika benar-benar belum pernah mengisi.", "info", 5500);
      } else {
        showActionToast("Sinkron selesai. Jika masih belum hijau, tap ☁️ sekali lagi — jangan isi ulang.", "info", 5000);
      }
    } catch (e) {
      logDailyReportStage("RECOVER_PENDING_FAILED", {
        focus,
        result: "failed",
        error: e?.message || String(e),
        source: "checklist_sync",
      });
      showActionToast(e?.message || "Gagal sinkron. Coba lagi — jangan isi ulang laporan.", "error");
    }
  }, [bizId, reloadFromCloud]);

  // Muat dokumen state bisnis aktif dari Supabase + suntik identitas login nyata.
  useEffect(() => {
    if (!bizId) return;
    let alive = true;
    allowSaveRef.current = false;
    setLoadErr(null);
    setS(null);
    lastSavePayloadRef.current = null;
    lastOwnSaveAtRef.current = null;
    loadState(bizId, { businessType: business?.type, business })
      .then(doc => {
        if (!alive) return;
        allowSaveRef.current = true;
        setS(applyMemberUsers(withReconciledReports(doc), members));
        setSyncInfo(buildSyncMeta(doc, null));
      })
      .catch(e => {
        if (!alive) return;
        allowSaveRef.current = false;
        console.error(e);
        setLoadErr(e.message || "Gagal memuat data — data tidak disimpan agar tidak tertimpa.");
      });
    const watchdog = setTimeout(() => {
      if (!alive || allowSaveRef.current) return;
      setLoadErr("Memuat terlalu lama — cek koneksi lalu muat ulang. Data awan tidak ditimpa.");
    }, 45000);
    return () => { alive = false; clearTimeout(watchdog); };
  }, [bizId, business?.type, business?.slug, applyMemberUsers]);

  // Patch daftar staf tanpa muat ulang seluruh app_state (~3MB / ribuan transaksi).
  useEffect(() => {
    if (!members?.length) return;
    setS(prev => {
      if (!prev) return prev;
      return applyMemberUsers(prev, members);
    });
  }, [members, applyMemberUsers]);

  // Realtime: HP lain simpan → langsung tarik dari awan (bukan nunggu poll)
  useEffect(() => {
    if (!bizId) return;
    const schedulePull = (updatedAt) => {
      if (!updatedAt) return;
      if (lastOwnSaveAtRef.current && updatedAt === lastOwnSaveAtRef.current) return;
      if (sRef.current?._cloudUpdatedAt && updatedAt === sRef.current._cloudUpdatedAt) return;
      clearTimeout(realtimePullTimerRef.current);
      realtimePullTimerRef.current = setTimeout(() => {
        const pending = pendingSavePayloadRef.current;
        const savedKey = lastSavePayloadRef.current;
        if (pending && savedKey !== JSON.stringify(pending)) {
          clearTimeout(saveDebounceRef.current);
          flushSave();
          return;
        }
        reloadFromCloud({ source: "realtime" });
      }, REALTIME_PULL_DEBOUNCE_MS);
    };
    const unsub = subscribeAppStateChanges(
      bizId,
      schedulePull,
      (status) => setRealtimeLive(status === "SUBSCRIBED")
    );
    return () => {
      clearTimeout(realtimePullTimerRef.current);
      setRealtimeLive(false);
      unsub();
    };
  }, [bizId, reloadFromCloud, flushSave]);

  // Cadangan poll (jika realtime putus) + saat tab aktif kembali
  useEffect(() => {
    if (!bizId) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (catatRef.current || isUserTypingInForm()) return;
      if (overlayRef.current === "laporanHarian") return;
      reloadFromCloud();
    };
    const id = setInterval(tick, CLOUD_POLL_FALLBACK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [bizId, reloadFromCloud]);

  const user = useMemo(() => sessionUser(authUser), [authUser]);
  const view = useMemo(() => {
    const base = withSessionUser(s, authUser);
    if (!base?.wallets || !sharedMirror) return base;
    return { ...base, wallets: applyMirrorBalances(base.wallets, sharedMirror) };
  }, [s, authUser, sharedMirror]);
  const features = useMemo(() => {
    const ctx = nfBusinessContext(s);
    const base = businessFeatures(business, ctx);
    const nfActive = isNfFinanceScope(business, ctx);
    return { ...base, isNfFishing: nfActive, nfChannelFinance: nfActive };
  }, [business, s?.wallets, s?.categories, s?.walletSetup, s?.profile?.name, s?.profile?.businessType]);

  useEffect(() => {
    if (!s || !bizId || features.isFnB) return;
    const ctx = nfBusinessContext(s);
    if (!isNfFinanceScope(business, ctx)) return;
    if (!needsNfChannelUpgrade(s.categories)) return;
    setS((prev) => {
      if (!prev || !needsNfChannelUpgrade(prev.categories)) return prev;
      const nextCats = cleanCategoryList(ensureNfFishingCategories(prev.categories));
      const patch = { ...prev, categories: nextCats, _nfCategoriesUpgraded: true };
      if (!prev.mpStores) patch.mpStores = hydrateMpStores(null);
      return patch;
    });
  }, [bizId, business, features.isFnB, s?.categories, s?.wallets, s?.walletSetup, s?.profile?.name]);

  const canonicalBusiness = useMemo(() => findCanonicalInList(businesses), [businesses]);

  const enabledSharedLinks = useMemo(
    () => (Array.isArray(s?.walletSetup?.sharedLinks) ? s.walletSetup.sharedLinks.filter((l) => l.enabled) : []),
    [s?.walletSetup?.sharedLinks]
  );
  const sharedLinksKey = useMemo(
    () => enabledSharedLinks.map((l) => `${l.id}:${l.sourceBusinessId}:${l.sourceWalletId}`).join("|"),
    [enabledSharedLinks]
  );

  const refreshSharedBankData = useCallback(async () => {
    if (!bizId || features.isFnB || !canWriteSharedBank(user?.role) || !enabledSharedLinks.length) {
      setSharedMirror(null);
      setSharedTxByWallet(null);
      return;
    }
    try {
      const [balanceRes, txRes] = await Promise.all([
        fetchSharedBankBalances(bizId),
        fetchSharedBankTransactions(bizId, { limit: 100 }),
      ]);
      setSharedMirror(balanceRes.balances || {});
      setSharedTxByWallet(txRes.transactionsByWallet || {});
    } catch {
      try {
        const docs = {};
        await Promise.all(
          sourceBusinessIdsForLinks(enabledSharedLinks).map(async (id) => {
            try {
              docs[id] = await loadAppState(id);
            } catch {
              docs[id] = null;
            }
          })
        );
        setSharedMirror(mirrorBalancesForLinks(enabledSharedLinks, docs));
        const txMap = {};
        for (const link of enabledSharedLinks) {
          const doc = docs[link.sourceBusinessId];
          const virtualId = sharedWalletId(link);
          const raw = walletTransactionsFromDoc(doc, link.sourceWalletId, { limit: 0 });
          const filtered = filterSharedTransactionsForView(raw, {
            businessId: bizId,
            userId: user?.id,
            role: user?.role,
          });
          filtered.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
          txMap[virtualId] = mapTransactionsToSharedWallet(filtered.slice(0, 100), virtualId);
        }
        setSharedTxByWallet(txMap);
      } catch {
        setSharedMirror(null);
        setSharedTxByWallet(null);
      }
    }
  }, [bizId, features.isFnB, user?.role, user?.id, enabledSharedLinks]);

  // Mirror saldo + riwayat rekening Sam @ FNB — owner/admin/purchasing NF (API service read).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshSharedBankData();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSharedBankData, s?._cloudUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOverlay(null);
    setCatat(false);
    setFnbGate(null);
  }, [bizId]);

  // Staf NF (admin/purchasing) tetap di Fishing — JANGAN auto-pindah ke FNB.
  // Purchasing F&B punya purchasingModule=true di Nusa Food; di Fishing mereka catat belanja lewat CatatTransaksi biasa.

  useEffect(() => {
    if (!user?.role) return;
    if (tab === "analisis" && (!canDo(user.role, "lihatAnalisis") || !features.fnbAnalisis)) setTab("beranda");
    if (tab === "asisten" && (!showPurchasingAsistenTab(user.role) || !features.purchasingModule)) setTab("beranda");
    if (tab === "void" && (!canDo(user.role, "inputVoid") || !features.voidOutlet)) setTab("beranda");
  }, [tab, user?.role, features.fnbAnalisis, features.purchasingModule, features.voidOutlet]);

  useEffect(() => {
    if (!s || !features.isFnB || !bizId) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      setS(prev => {
        if (!prev) return prev;
        const next = mergeDailyRemindersIntoDoc(prev, today(), new Date());
        return next === prev ? prev : next;
      });
    };
    tick();
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [s?.notificationPrefs, s?.sosmedConfig, features.isFnB, bizId]);

  const openOverlay = useCallback((name) => {
    if (name === "wallets" && !canDo(user.role, "kelolaDompet")) return;
    if (name === "adjustSaldo" && !canDo(user.role, "editSaldoDompet")) return;
    if (name === "broadcast" && !canDo(user.role, "kirimPengumuman")) return;
    if (name === "voidReview" && !canDo(user.role, "reviewVoidLog")) return;
    if (!isOverlayAllowedForBusiness(name, business, { wallets: s?.wallets })) {
      // Jangan blok staf dengan gate "Pindah ke Nusa Food" — kasih tahu saja fitur tidak tersedia di NF.
      if (user?.role !== "owner") {
        showActionToast(fnbFeatureLabel(name) + " hanya di Nusa Food (F&B).", "error");
        return;
      }
      setFnbGate(name);
      return;
    }
    setOverlay(name);
  }, [user.role, business]);

  /** Mic / catat belanja — selalu CatatTransaksi di NF; PurchasingForm hanya F&B. */
  const openCatat = useCallback(() => {
    setFnbGate(null);
    setOverlay(null);
    setTab("beranda");
    setCatat(true);
  }, []);

  const openLaporanHarian = useCallback((date = null) => {
    setLaporanInitialDate(date);
    setLaporanOpenSeq(seq => seq + 1);
    openOverlay("laporanHarian");
  }, [openOverlay]);

  const openWalletHistory = useCallback((walletId) => {
    if (!walletId) return;
    setWalletHistoryId(walletId);
    setOverlay("walletHistory");
  }, []);

  const handleNotifAction = useCallback((action) => {
    if (!action?.type) return;
    switch (action.type) {
      case "laporanHarian":
        openLaporanHarian(action.date || null);
        break;
      case "sosmedHarian":
        openOverlay("sosmedHarian");
        break;
      case "sdmHarian":
        openOverlay("sdmHarian");
        break;
      case "settleLaporan":
        openOverlay("settleLaporan");
        break;
      case "voidReview":
        openOverlay("voidReview");
        break;
      case "catatBelanja":
        openCatat();
        break;
      default:
        break;
    }
  }, [openLaporanHarian, openOverlay, openCatat]);

  useEffect(() => {
    openLaporanRef.current = openLaporanHarian;
  }, [openLaporanHarian]);

  useEffect(() => {
    notifActionRef.current = handleNotifAction;
  }, [handleNotifAction]);

  useEffect(() => {
    if (!s || !user?.id) return;
    const soundOn = s.automation?.revisionAlertSound !== false;
    visibleStaffMessages(s.staffMessages, user)
      .filter(m => !(m.readBy || []).includes(user.id) && isActionableStaffMessage(m, user, s?.dailyReports))
      .forEach(m => {
        if (revisionNotifiedRef.current.has(m.id)) return;
        revisionNotifiedRef.current.add(m.id);
        const kind = getMessageKind(m);
        if (kind === "revision_request" && soundOn) playRevisionAlertSound();
        else if (kind === "purchasing_fund" || kind === "sosmed_reminder" || kind === "sdm_reminder") playNotificationPing();
        else if (soundOn) playNotificationPing();
        if (typeof Notification === "undefined") return;
        try {
          if (Notification.permission === "default") Notification.requestPermission();
          else if (Notification.permission === "granted") {
            const n = new Notification(m.title || "NF3", {
              body: String(m.body || "").replace(/\n+/g, " ").slice(0, 140),
              tag: "nf3-msg-" + m.id,
              silent: true,
            });
            n.onclick = () => {
              window.focus?.();
              const action = getStaffMessageAction(m, user);
              if (action) notifActionRef.current?.(action);
              n.close();
            };
          }
        } catch { /* ignore */ }
      });
  }, [s?.staffMessages, s?.automation?.revisionAlertSound, user?.id, user?.role]);

  useEffect(() => {
    if (!s || !bizId || skipSaveRef.current || !allowSaveRef.current) return;
    const payload = extractSavePayload(s);
    const payloadKey = JSON.stringify(payload);
    if (lastSavePayloadRef.current === payloadKey) return;
    pendingSavePayloadRef.current = payload;
    clearTimeout(saveDebounceRef.current);
    const now = Date.now();
    const delay = now < criticalSaveUntilRef.current ? 0 : SAVE_DEBOUNCE_MS;
    saveDebounceRef.current = setTimeout(flushSave, delay);
    return () => clearTimeout(saveDebounceRef.current);
  }, [s, bizId, flushSave]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushSave);
    return () => {
      window.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushSave);
    };
  }, [flushSave]);

  const mutate = useCallback((fn) => setS(prev => {
    if (!prev) return prev;
    const copy = JSON.parse(JSON.stringify(prev));
    const walletsBefore = JSON.stringify(prev.wallets);
    fn(copy);
    const role = authUser?.role || "kasir";
    if (!canDo(role, "kelolaDompet") && JSON.stringify(copy.wallets) !== walletsBefore) {
      copy.wallets = prev.wallets;
    }
    delete copy.currentUser;
    delete copy.users;
    sRef.current = copy;
    return copy;
  }), [authUser?.role]);

  const scheduleImmediateSave = useCallback((opts = {}) => {
    if (opts.critical === true) {
      criticalSaveUntilRef.current = Date.now() + CRITICAL_SAVE_WINDOW_MS;
    }
    return new Promise((resolve, reject) => {
      queueMicrotask(() => {
        if (!bizId) {
          if (opts.critical) reject(new Error("Belum ada bisnis aktif — tidak bisa simpan ke awan."));
          else resolve(null);
          return;
        }
        if (!sRef.current) {
          if (opts.critical) reject(new Error("State lokal kosong — muat ulang lalu coba lagi."));
          else resolve(null);
          return;
        }
        if (skipSaveRef.current || !allowSaveRef.current) {
          if (opts.critical) {
            reject(new Error("Simpan kritis ditunda (sync sedang berjalan atau sesi belum siap). Tap ☁️ lalu coba lagi."));
          } else {
            resolve(null);
          }
          return;
        }
        pendingSavePayloadRef.current = extractSavePayload(sRef.current);
        clearTimeout(saveDebounceRef.current);
        const p = flushSave();
        Promise.resolve(p).then(resolve).catch(reject);
      });
    });
  }, [bizId, flushSave]);

  // Subscribe ke system dark mode jika tema = sistem
  useEffect(() => {
    if (!s || (s.profile.theme !== "sistem" && s.profile.theme !== "system")) return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => setS(prev => prev ? { ...prev, _systemThemeTick: Date.now() } : prev);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [s?.profile?.theme]);

  useEffect(() => {
    if (!bizId || !s?._nfCategoriesUpgraded || !allowSaveRef.current) return;
    setS((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete next._nfCategoriesUpgraded;
      return next;
    });
    scheduleImmediateSave({ critical: true });
    showActionToast("Kategori pemasukan NF diperbarui ke channel per platform.", "info", 4500);
  }, [bizId, s?._nfCategoriesUpgraded, scheduleImmediateSave]);

  useEffect(() => {
    if (!bizId || !s?._nfTxRemapped || !allowSaveRef.current) return;
    const stats = s._nfMpMigrationStats;
    setS((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete next._nfTxRemapped;
      delete next._nfMpMigrationStats;
      return next;
    });
    scheduleImmediateSave({ critical: true });
    if (stats?.migrated > 0) {
      showActionToast(
        `${stats.migrated} transaksi MP lama dipindah ke channel per platform${stats.storeTagged ? ` (${stats.storeTagged} dengan kode toko)` : ""}.`,
        "info",
        5000
      );
    }
  }, [bizId, s?._nfTxRemapped, scheduleImmediateSave]);

  const addTx = async (d) => {
    if (addTxBusyRef.current) {
      showActionToast("Masih menyimpan… jangan tap lagi.", "info", 2200);
      return false;
    }
    const role = user.role || "kasir";
    const amount = Math.round(Number(d?.amount) || 0);
    if (!(amount > 0)) {
      showActionToast("Nominal transfer/transaksi harus lebih dari 0.", "error");
      return false;
    }
    if (d.type === "transfer" && !canDo(role, "transfer")) {
      showActionToast("Transfer tidak diizinkan untuk role Anda.", "error");
      return false;
    }
    if (d.type === "in" && !canDo(role, "inputIncome")) {
      showActionToast("Pemasukan tidak diizinkan untuk role Anda.", "error");
      return false;
    }
    if (d.type === "out" && !canDo(role, "inputExpense")) {
      showActionToast("Pengeluaran tidak diizinkan untuk role Anda.", "error");
      return false;
    }

    const sharedTarget =
      d.type === "transfer"
        ? (isSharedWallet({ id: d.fromWalletId }) || isSharedWallet({ id: d.toWalletId }))
        : isSharedWallet({ id: d.walletId });
    if (d.type === "transfer" && sharedTarget) {
      showActionToast("Rekening Sam bersama: catat pemasukan/pengeluaran langsung, bukan transfer lokal.", "error");
      return false;
    }

    const allowedWallets = new Set(visibleWalletsForBusiness(view?.wallets || [], user, business).map(w => w.id));
    if (d.type === "transfer") {
      if (!allowedWallets.has(d.fromWalletId) || !allowedWallets.has(d.toWalletId)) {
        showActionToast("Dompet transfer tidak tersedia untuk akun Anda.", "error");
        return false;
      }
    } else if (!d.walletId || !allowedWallets.has(d.walletId)) {
      showActionToast("Pilih dompet belanja yang tersedia (hubungi admin jika kosong).", "error");
      return false;
    }

    addTxBusyRef.current = true;
    try {
      // Rekening Sam terhubung → tulis ke FNB (sumber kebenaran), bukan app_state Fishing lokal.
      if (d.type !== "transfer" && isSharedWallet({ id: d.walletId })) {
        if (!canWriteSharedBank(role)) {
          showActionToast("Anda tidak boleh mencatat di rekening bersama.", "error");
          return false;
        }
        try {
          const txId = "tsh_" + Date.now() + Math.random().toString(36).slice(2, 6);
          const res = await postSharedBankTx({
            businessId: bizId,
            businessName: businessDisplayName || business?.name,
            sharedWalletId: d.walletId,
            type: d.type,
            amount,
            categoryId: d.categoryId,
            desc: d.desc,
            date: d.date,
            source: d.source || "NF shared bank",
            txId,
          });
          setSharedMirror((prev) => ({
            ...(prev || {}),
            [d.walletId]: {
              ...(prev?.[d.walletId] || {}),
              linkId: String(d.walletId).replace(/^shared_/, ""),
              balance: res.balance,
              sourceWalletName: res.sourceWalletName || "",
              sourceBusinessName: "Nusa Food",
              missing: false,
            },
          }));
          setSharedTxByWallet((prev) => {
            const next = { ...(prev || {}) };
            const rows = [...(next[d.walletId] || [])];
            rows.unshift({
              id: txId,
              type: d.type,
              amount,
              walletId: d.walletId,
              categoryId: d.categoryId,
              desc: d.desc,
              date: d.date || today(),
              source: d.source || "NF shared bank",
              meta: {
                sharedWriteThrough: true,
                fromBusinessId: bizId,
                createdById: user?.id || null,
                createdByName: user?.name || null,
                createdByRole: role,
              },
            });
            next[d.walletId] = rows.slice(0, 100);
            return next;
          });
          mutate((st) => {
            const w = (st.wallets || []).find((x) => x.id === d.walletId);
            if (w) w.opening = res.balance;
          });
          if (role === "purchasing") {
            showActionToast(`Belanja tersimpan di ${res.sourceWalletName || "dompet bersama"} · ketuk dompet untuk lihat riwayat`, "success");
          } else {
            showActionToast(
              `Tersimpan di ${res.sourceWalletName || "rekening Sam"} (FNB) · saldo ${fmtMoney(res.balance, view?.profile?.currency || "IDR")}`,
              "success"
            );
          }
          refreshSharedBankData();
          return true;
        } catch (e) {
          showActionToast(e.message || "Gagal catat ke rekening bersama.", "error");
          return false;
        }
      }

      if (d.type === "out") {
        const floorErr = role === "purchasing"
          ? checkPurchasingFloor(d.walletId, d.amount, view?.wallets || [], view?.transactions || [], user)
          : checkFloor(d.walletId, d.amount, view?.wallets || [], view?.transactions || [], user);
        if (floorErr) {
          showActionToast(floorErr, "error");
          return false;
        }
      }
      const txId = "t" + Date.now() + Math.random().toString(36).slice(2, 5);
      const transferRef = d.type === "transfer" ? (d.transferRef || ("trf_" + Date.now() + Math.random().toString(36).slice(2, 6))) : null;
      mutate((st) => {
        const baseMeta = d.meta && typeof d.meta === "object" ? d.meta : {};
        const txMeta = {
          ...baseMeta,
          createdById: user?.id || baseMeta.createdById || null,
          createdByName: user?.name || baseMeta.createdByName || null,
          ...(d.type === "transfer" ? { transferRef } : {}),
        };
        if (d.module === "purchasing" || String(d.source || "").startsWith("purchasing")) {
          txMeta.verified = txMeta.verified === true;
        }
        const tx = { ...d, amount, id: txId, meta: txMeta };
        st.transactions.push(tx);
        if (d.type === "transfer") {
          const toW = (st.wallets || []).find((w) => w.id === d.toWalletId);
          const fromW = (st.wallets || []).find((w) => w.id === d.fromWalletId);
          if (isKasKecilWallet(toW)) {
            try {
              st.staffMessages = prependStaffMessage(
                st.staffMessages,
                createPurchasingFundMessage({
                  amount,
                  fromWalletName: fromW?.name || "Kas Besar",
                  author: user,
                  transactionId: txId,
                }),
                st.notificationPrefs
              );
            } catch (e) {
              console.error("[addTx] purchasing fund message error:", e);
            }
          }
        }
      });
      // Tunggu sync awan agar toast sukses tidak mendorong input ulang saat jaringan putus.
      try {
        showActionToast("Menyimpan ke awan…", "info", 2500);
        await scheduleImmediateSave({ critical: true });
        showActionToast("Transaksi tersimpan", "success");
      } catch (e) {
        const errText = String(e?.message || e || "");
        const networkHint = /timeout|network|failed to fetch|offline/i.test(errText)
          ? " Jaringan lambat/putus."
          : "";
        showActionToast(
          `Sudah tercatat di HP — gagal ke awan.${networkHint} Jangan input ulang. Tap ☁️ untuk retry.`,
          "error",
          7000
        );
      }
      // Tetap true: data lokal sudah aman; form ditutup supaya tidak tap Simpan lagi.
      return true;
    } finally {
      addTxBusyRef.current = false;
    }
  };
  const acceptDraft = (n) => {
    if (!canDo(user.role, "inputIncome")) return;
    const c = classifyNotif(n);
    const inCats = visibleCategories(s.categories, user, "in");
    const cat = inCats.find(x => x.name.toLowerCase().includes("penjual")) || inCats[0];
    const myW = visibleWallets(s.wallets, user);
    const wallet = walletForNotifSrc(n.src, myW) || myW[0];
    if (!wallet || !cat) return;
    addTx({ type: "in", amount: c.amount, categoryId: cat.id, walletId: wallet.id, desc: n.title, date: today(), source: "Inbox " + n.src });
    mutate(st => { st.rawInbox = (st.rawInbox || []).filter(x => x.id !== n.id); });
  };
  const dismiss = (id) => mutate(st => { st.rawInbox = (st.rawInbox || []).filter(x => x.id !== id); });
  const addInboxDraft = (draft) => {
    mutate(st => {
      if (!st.rawInbox) st.rawInbox = [];
      st.rawInbox.unshift(draft);
    });
    if (s.automation?.replyNotif && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const c = classifyNotif(draft);
        new Notification("Draf NF3 ditambahkan", {
          body: c.verdict === "legit" ? `${draft.title} · ${fmtMoney(c.amount, s.profile.currency)}` : `${draft.title} · ditandai spam/promo`,
          tag: "nf3-inbox-" + draft.id,
        });
      } catch { /* ignore */ }
    }
  };

  const theme = !s ? "light" : (() => {
    const t = s.profile.theme;
    if (t === "dark" || t === "gelap") return "dark";
    if (t === "light" || t === "terang") return "light";
    // sistem: ikuti preferensi HP
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  })();

  if (!s) return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#F0F0F8", padding: 20 }}>
      <div style={{ textAlign: "center" }}>
        <Loader2 size={28} color="#6366F1" style={{ animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
        <div style={{ color: "#6B7280", fontSize: 14 }}>Memuat data NF3…</div>
        <div style={{ color: "#9CA3AF", fontSize: 12, marginTop: 6, maxWidth: 280 }}>
          Mengambil data dari awan (bisa 5–15 detik jika transaksi banyak)
        </div>
        {loadErr && (
          <>
            <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 12, maxWidth: 320 }}>{loadErr}</div>
            <button type="button" onClick={() => { setLoadErr(null); window.location.reload(); }} style={{ marginTop: 12, padding: "10px 16px", borderRadius: 10, border: "none", background: "#6366F1", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              Muat ulang halaman
            </button>
          </>
        )}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div data-theme={theme} className="nf3-shell">
      <style>{CSS}</style>
      <div className="nf3-shell-inner" style={{ maxWidth: effectiveWebMode ? 1100 : 440 }}>
        {effectiveWebMode && (
          <div style={{ background: "linear-gradient(90deg,#4338CA,#6366F1)", color: "#fff", padding: "10px 20px", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>🖥 NF3 Web Dashboard — Laporan & Export</span>
            <a href="/pair" style={{ color: "rgba(255,255,255,.85)", fontSize: 12 }}>Pair ulang</a>
          </div>
        )}
        <div className="nf3-scroll scroll-hide">
          {tab === "beranda"  && <Beranda s={view} setTab={setTab} setOverlay={openOverlay} onOpenLaporan={openLaporanHarian} hide={hide} setHide={setHide} onCloudSync={() => reloadFromCloud({ manual: true })} onRecoverPending={recoverPendingKasirSections} cloudSyncState={cloudSyncState} syncInfo={syncInfo} realtimeLive={realtimeLive} bizId={bizId} session={session} businessDisplayName={businessDisplayName} onCatat={openCatat} business={business} businesses={businesses} switchBusiness={switchBusiness} features={features} onOpenWalletHistory={openWalletHistory} sharedMirror={sharedMirror} sharedTxByWallet={sharedTxByWallet} />}
          {tab === "laporan"  && <Laporan s={view} mutate={mutate} onOpenPair={() => openOverlay("pair")} onOpenPurchasingReport={() => openOverlay("laporanPurchasing")} business={business} features={features} webMode={effectiveWebMode} sharedTxByWallet={sharedTxByWallet} bizId={bizId} />}
          {tab === "void" && features.voidOutlet && canDo(user.role, "inputVoid") && <VoidScreen s={view} mutate={mutate} user={user} />}
          {tab === "analisis" && features.fnbAnalisis && canDo(user.role, "lihatAnalisis") && <Analisis s={view} hideInsight={(id) => mutate(d => { if (!d.hiddenInsights) d.hiddenInsights = []; d.hiddenInsights.push(id); })} />}
          {tab === "asisten" && features.purchasingModule && showPurchasingAsistenTab(user.role) && <AsistenPurchasing s={view} bizId={bizId} />}
          {tab === "profil"   && <PengaturanScreen s={view} mutate={mutate} onClose={() => setTab("beranda")} setOverlay={openOverlay} bizId={bizId} authUser={authUser} signOut={signOut} businesses={businesses} switchBusiness={switchBusiness} businessDisplayName={businessDisplayName} features={features} business={business} onCloudSync={() => reloadFromCloud({ manual: true })} />}
        </div>
        {!effectiveWebMode && <PwaInstallBanner />}
        <NavBar tab={tab} setTab={setTab} user={user} business={business}
          shellMaxWidth={effectiveWebMode ? 1100 : 440}
          onMic={openCatat} micTitle={getAccountUi(user, business).micTitle} />

        {catat && user.role === "purchasing" && features.purchasingModule
          ? <PurchasingForm s={{ ...view, business: { id: bizId } }} onSave={addTx} onClose={() => setCatat(false)} />
          : catat && <CatatTransaksi s={view} bizId={bizId} business={business} features={features} mutate={mutate} onNotify={showActionToast} onSave={addTx} onClose={() => setCatat(false)} />}
        {fnbGate && user?.role === "owner" && (
          <FnbGateSheet
            target={fnbGate}
            onClose={() => setFnbGate(null)}
            canonicalName={canonicalBusiness?.name || CANONICAL_DISPLAY_NAME}
            canSwitch={user?.role === "owner" && !!canonicalBusiness?.id}
            onSwitch={() => {
              // Hanya owner boleh pindah ke FNB dari gate ini — staf NF tidak saling terhubung.
              setFnbGate(null);
              if (user?.role === "owner" && canonicalBusiness?.id && switchBusiness) {
                switchBusiness(canonicalBusiness.id);
              }
            }}
          />
        )}
        {overlay === "voidReview" && features.voidOutlet && canDo(user.role, "reviewVoidLog") && (
          <Sheet title="Review Void Kasir" onClose={() => setOverlay(null)}>
            <VoidScreen s={view} mutate={mutate} user={user} reviewOnly />
          </Sheet>
        )}
        {overlay === "inbox"      && canDo(user.role, "inputIncome") && <InboxScreen s={view} onClose={() => setOverlay(null)} onAccept={acceptDraft} onDismiss={dismiss} onAddDraft={addInboxDraft} />}
        {overlay === "notif"      && <NotifScreen s={view} user={user} mutate={mutate} onClose={() => setOverlay(null)} onCompose={() => setOverlay("broadcast")} onAction={handleNotifAction} />}
        {overlay === "broadcast" && canDo(user.role, "kirimPengumuman") && <BroadcastScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} user={user} />}
        {overlay === "adjustSaldo" && canDo(user.role, "editSaldoDompet") && <AdjustSaldoScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} user={user} business={business} />}
        {overlay === "wallets" && canDo(user.role, "kelolaDompet") && <WalletScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} user={user} bizId={bizId} businesses={businesses} features={features} />}
        {overlay === "nfBelanjaSearch" && user.role === "purchasing" && !features.purchasingModule && (
          <Sheet title="Cari Riwayat Belanja" onClose={() => setOverlay(null)}>
            <NfBelanjaSearch
              transactions={features.nfChannelFinance
                ? scopedNfFinanceTransactions(view?.transactions || [], sharedTxByWallet, view?.categories || [], {
                  businessId: bizId,
                  role: user.role,
                  userId: user.id,
                })
                : mergeWithLocalTransactions(view?.transactions || [], sharedTxByWallet)}
              categories={view?.categories || []}
              wallets={view?.wallets || []}
              currency={view?.profile?.currency || "IDR"}
              fmtMoney={fmtMoney}
              shortDate={shortDate}
              walletLabel={(id) => foodWalletDisplayName(view?.wallets?.find((w) => w.id === id))}
              onClose={() => setOverlay(null)}
            />
          </Sheet>
        )}
        {overlay === "walletHistory" && walletHistoryId && (
          <WalletHistoryScreen
            s={view}
            business={business}
            walletId={walletHistoryId}
            sharedTxByWallet={sharedTxByWallet}
            bizId={bizId}
            features={features}
            onClose={() => {
              setWalletHistoryId(null);
              setOverlay(null);
            }}
          />
        )}
        {overlay === "categories" && <CatScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} />}
        {overlay === "kategoriPurchasing" && features.purchasingModule && canDo(user.role, "kelolaKategoriSemua") && (
          <Sheet title="Kategori Purchasing" onClose={() => setOverlay(null)}>
            <KategoriPurchasing s={view} mutate={mutate} />
          </Sheet>
        )}
        {overlay === "purchasingAliases" && features.purchasingModule && canDo(user.role, "kelolaKategoriSemua") && (
          <Sheet title="Alias Barang Purchasing" onClose={() => setOverlay(null)}>
            <PurchasingAliasesReview
              bizId={bizId}
              session={session}
              role={user.role}
              embedded
              onClose={() => setOverlay(null)}
            />
          </Sheet>
        )}
        {overlay === "laporanPurchasing" && features.purchasingModule && (
          <LaporanPurchasing
            s={view}
            mutate={mutate}
            canManageTx={canDo(user.role, "kelolaTransaksi")}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay === "asisten" && features.purchasingModule && canUsePurchasingAsisten(user.role) && (
          <AsistenPurchasing s={view} bizId={bizId} onClose={() => setOverlay(null)} />
        )}
        {overlay === "sosmedHarian" && features.sosmedReports && canInputSosmed(user, s?.sosmedConfig) && <SosmedHarianScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} user={user} onCriticalSave={() => scheduleImmediateSave({ critical: true })} />}
        {overlay === "sosmedConfig" && features.sosmedReports && canDo(user.role, "settleLaci") && <SosmedConfigScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} />}
        {overlay === "sdmHarian" && features.kasirDaily && canDo(user.role, "inputLaporanHarian") && <SdmHarianScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} onCriticalSave={() => scheduleImmediateSave({ critical: true })} />}
        {overlay === "laporanHarian" && features.kasirDaily && canDo(user.role, "inputLaporanHarian") && <KasirHarianScreen key={`${laporanOpenSeq}-${laporanInitialDate || "today"}`} s={view} mutate={mutate} initialDate={laporanInitialDate} businessId={bizId} getLatestState={() => sRef.current} onCriticalSave={() => scheduleImmediateSave({ critical: true })} onVerifyCommitted={async (q) => {
          const cloudDoc = await loadState(bizId, { businessType: business?.type, business });
          return findCommittedDailyReport(cloudDoc, q);
        }} onClose={() => { setLaporanInitialDate(null); setOverlay(null); }} />}
        {overlay === "settleLaporan" && features.settleLaci && canDo(user.role, "settleLaci") && <SettleLaporanScreen s={view} mutate={mutate} onCriticalSave={() => scheduleImmediateSave({ critical: true })} onReloadFromCloud={(opts) => reloadFromCloud(opts)} onClose={() => setOverlay(null)} />}
        {overlay === "outletTargets" && features.settleLaci && canDo(user.role, "settleLaci") && <OutletTargetSettingsScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} />}
        {overlay === "reportChannels" && features.settleLaci && canDo(user.role, "settleLaci") && <ReportChannelSettingsScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} />}
        {overlay === "mpStores" && features.nfChannelFinance && canDo(user.role, "kelolaKategoriSemua") && <MpStoreSettingsScreen s={view} mutate={mutate} onClose={() => setOverlay(null)} />}
        {overlay === "pair"       && <PairScreen bizId={bizId} authUser={authUser} onClose={() => setOverlay(null)} />}
        {bizId && user?.role && user.role !== "purchasing" && features.isFnB && !overlay && (
          <NF3Assistant
            role={user.role === "admin" ? "keuangan" : user.role}
            outlet={user.role === "kasir" && user.outlet ? user.outlet : "semua"}
            businessId={bizId}
            sessionToken={session?.access_token}
            bottomOffset={effectiveWebMode ? 24 : 88}
          />
        )}
        <ActionToast />
      </div>
    </div>
  );
}
