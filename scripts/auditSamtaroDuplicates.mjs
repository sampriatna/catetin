#!/usr/bin/env node
/**
 * Audit READ-ONLY duplikat Laporan Omset Samtaro (SMT).
 * Hanya SELECT app_state — tidak ada UPDATE / DELETE / INSERT / merge.
 *
 * Env (server-side / CI):
 *   SUPABASE_URL atau NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← JANGAN NEXT_PUBLIC_*; jangan log
 *
 *   npm run audit:samtaro-dup
 *   node scripts/auditSamtaroDuplicates.mjs --date=2026-08-08
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { auditDailyReportDuplicates, auditDailyReportSlot, previewDuplicateCleanup } from "../lib/dailyReportAudit.js";
import { CANONICAL_BUSINESS_ID } from "../lib/canonicalBusiness.js";
import { walletBalance, LACI_BY_OUTLET } from "../lib/kasirHarian.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIZ = process.env.NF3_BUSINESS_ID || CANONICAL_BUSINESS_ID;
const dateArg = (process.argv.find((a) => a.startsWith("--date=")) || "").split("=")[1] || null;
const LACI_TARGET = 355000;

function loadEnvLocal() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return false;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    // Tolak service-role yang salah ditempatkan di NEXT_PUBLIC_*
    if (key.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE|SECRET|PRIVATE_KEY/i.test(key)) {
      console.error(`❌ Tolak ${key}: service-role/secret tidak boleh NEXT_PUBLIC_*`);
      process.exit(2);
    }
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
  return true;
}

function shortId(id) {
  const s = String(id || "");
  if (s.length <= 14) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function redactKey(key) {
  const s = String(key || "");
  if (!s) return null;
  if (s.length <= 18) return s.replace(/[0-9a-f]{8,}/gi, "***");
  const parts = s.split("|");
  return parts.map((p, i) => (i === 0 && p.length > 12 ? `${p.slice(0, 8)}…` : p)).join("|");
}

function publicSlotView(slot, state) {
  const preview = previewDuplicateCleanup(state, slot);
  const records = (slot.records || []).map((r) => ({
    reportType: "omzet",
    operationalDate: r.reportDate,
    outlet: r.outlet,
    nominal: r.nominal,
    identityCountHint: slot.reportCount,
    recordId: shortId(r.id),
    serverRecordId: shortId(r.serverRecordId || r.id),
    idempotencyKey: redactKey(r.idempotencyKey || r.submissionId),
    syncStatus: r.syncStatus || r.commitStatus || null,
    status: r.status,
    sourceGuess: r.sourceGuess,
    isPrimaryCandidate: !!r.isPrimaryCandidate,
  }));
  return {
    operationalDate: slot.reportDate,
    reportType: "omzet",
    outlet: "SMT",
    identityCount: slot.reportCount,
    generatedCashCount: slot.generatedCashCount,
    nominals: records.map((r) => r.nominal),
    records,
    canonicalRecordId: shortId(slot.primaryRecordId || slot.canonicalReportId),
    recommendedKeepReportId: shortId(preview.keepReportId),
    recommendedKeepCashTxId: shortId(preview.keepCashTxId),
    wouldTombstoneReportIds: (preview.wouldDeleteReportIds || []).map(shortId),
    wouldTombstoneCashTxIds: (preview.wouldDeleteTxIds || []).map(shortId),
    reasons: slot.reasons || [],
    note: "READ-ONLY — tidak ada perubahan data",
  };
}

loadEnvLocal();

if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY terdeteksi — hapus. Service-role hanya server-side.");
  process.exit(2);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\n❌ Audit butuh server env:");
  console.error("   SUPABASE_URL (atau NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY");
  console.error("   Service-role JANGAN di-prefix NEXT_PUBLIC_.\n");
  process.exit(2);
}

// Client hanya untuk SELECT; tidak ada .update/.delete/.insert di skrip ini.
const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await sb
  .from("app_state")
  .select("data, updated_at")
  .eq("business_id", BIZ)
  .maybeSingle();

if (error) {
  console.error("Gagal SELECT app_state:", error.message);
  process.exit(1);
}
if (!data?.data) {
  console.error("app_state kosong untuk business (id disamarkan)");
  process.exit(1);
}

const state = { ...data.data, businessId: BIZ };
const laciId = LACI_BY_OUTLET.SMT;
const laciBal = walletBalance(laciId, state.wallets || [], state.transactions || []);
const laciOpening = (state.wallets || []).find((w) => w.id === laciId)?.opening ?? null;
const smtCashTxs = (state.transactions || []).filter(
  (t) => t?.type === "in" && /laporan harian/i.test(t.source || "") && /Omset tunai SMT/i.test(t.desc || "")
);

const full = auditDailyReportDuplicates(state, { businessId: BIZ, focusOutlets: ["SMT"] });
const smtIssues = (full.issues || []).filter((r) => r.outlet === "SMT");
const focused = dateArg
  ? [auditDailyReportSlot(state, { businessId: BIZ, outlet: "SMT", date: dateArg })]
  : smtIssues.filter((r) => r.duplicate);

const publicReport = {
  mode: "READ_ONLY",
  generatedAt: new Date().toISOString(),
  cloudUpdatedAt: data.updated_at,
  focusDate: dateArg,
  summary: {
    scannedSlots: full.scannedSlots,
    smtIssueSlots: smtIssues.length,
    smtDuplicateSlots: smtIssues.filter((r) => r.duplicate).length,
  },
  laciSamtaro: {
    walletId: laciId,
    opening: laciOpening,
    balance: laciBal,
    targetMentionedRp355000: LACI_TARGET,
    balanceEquals355000: Math.round(Number(laciBal) || 0) === LACI_TARGET,
    generatedCashTxCount: smtCashTxs.length,
    likelyImpactedByDuplicateCash:
      smtCashTxs.length > smtIssues.filter((r) => r.duplicate).length
      || (smtIssues.some((r) => r.generatedCashCount > 1)),
  },
  duplicates: focused.map((slot) => publicSlotView(slot, state)),
  allSmtIssues: smtIssues.map((slot) => publicSlotView(slot, state)),
};

const outDir = join(ROOT, "docs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "AUDIT_SAMTARO_DUPLICATES_RUNTIME.json");
writeFileSync(outPath, JSON.stringify(publicReport, null, 2));

console.log(JSON.stringify(publicReport, null, 2));
console.log(`\n📄 Written ${outPath}`);
console.log("READ-ONLY selesai. Tidak ada UPDATE/DELETE. Cleanup hanya via dry-run terpisah setelah approval.");
