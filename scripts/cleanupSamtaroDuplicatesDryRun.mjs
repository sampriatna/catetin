#!/usr/bin/env node
/**
 * CLEANUP DRY-RUN — Samtaro omzet duplicates.
 *
 * DEFAULT: hanya mencetak rencana. TIDAK menulis ke Supabase / app_state.
 * Eksekusi nyata DIBLOKIR sampai flag eksplisit + env APPROVE_SAMTARO_CLEANUP=YES
 * (tetap tidak diaktifkan di PR ini — butuh persetujuan manual hasil audit).
 *
 *   npm run cleanup:samtaro-dup:dry-run
 *   node scripts/cleanupSamtaroDuplicatesDryRun.mjs --date=2026-08-08
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { auditDailyReportDuplicates, auditDailyReportSlot, previewDuplicateCleanup } from "../lib/dailyReportAudit.js";
import { CANONICAL_BUSINESS_ID } from "../lib/canonicalBusiness.js";
import { walletBalance, LACI_BY_OUTLET } from "../lib/kasirHarian.js";
import { pickNewerDailyReport } from "../lib/dailyReportMerge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIZ = process.env.NF3_BUSINESS_ID || CANONICAL_BUSINESS_ID;
const dateArg = (process.argv.find((a) => a.startsWith("--date=")) || "").split("=")[1] || null;
const wantExecute = process.argv.includes("--execute");

function loadEnvLocal() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return false;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE|SECRET|PRIVATE_KEY/i.test(key)) {
      console.error(`❌ Tolak ${key}`);
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

loadEnvLocal();

if (wantExecute) {
  console.error("❌ --execute DITOLAK di skrip ini.");
  console.error("   Cleanup nyata belum diizinkan. Selesaikan audit + approval manual dulu.");
  console.error("   Skrip ini hanya dry-run / rencana.");
  process.exit(3);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\n❌ Dry-run butuh SUPABASE_URL (atau NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY (server-side).\n");
  process.exit(2);
}

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await sb
  .from("app_state")
  .select("data, updated_at")
  .eq("business_id", BIZ)
  .maybeSingle();

if (error) {
  console.error("Gagal SELECT:", error.message);
  process.exit(1);
}
if (!data?.data) {
  console.error("app_state kosong");
  process.exit(1);
}

const state = { ...data.data, businessId: BIZ };
const full = auditDailyReportDuplicates(state, { businessId: BIZ, focusOutlets: ["SMT"] });
const slots = dateArg
  ? [auditDailyReportSlot(state, { businessId: BIZ, outlet: "SMT", date: dateArg })]
  : (full.issues || []).filter((r) => r.outlet === "SMT" && r.duplicate);

const laciBal = walletBalance(LACI_BY_OUTLET.SMT, state.wallets || [], state.transactions || []);

const plan = {
  mode: "DRY_RUN_ONLY",
  executeBlocked: true,
  generatedAt: new Date().toISOString(),
  cloudUpdatedAt: data.updated_at,
  laciSamtaroBalanceBefore: laciBal,
  steps: [
    "1. Backup baris app_state (export JSON) sebelum perubahan apa pun.",
    "2. Untuk tiap slot: keep recommendedKeepReportId + recommendedKeepCashTxId.",
    "3. Tombstone report id loser ke deletedDailyReportIds (bukan DELETE SQL mentah).",
    "4. Tombstone cash id loser ke deletedTransactionIds; pastikan survivor = t_cash_SMT_<DATE>.",
    "5. Jangan menjumlahkan nominal; survivor mempertahankan nominal kanonis.",
    "6. Save merge sekali (finalizeMergedDoc) lalu verifikasi audit ulang = 0 duplikat.",
    "7. Kasir hanya sync — jangan isi ulang.",
  ],
  slots: slots.map((slot) => {
    const preview = previewDuplicateCleanup(state, slot);
    const reports = (state.dailyReports || []).filter(
      (r) => r.outlet === "SMT" && (r.date === slot.reportDate || String(r.date).startsWith(slot.reportDate))
    );
    let canonical = null;
    for (const r of reports) canonical = canonical ? pickNewerDailyReport(canonical, r) : r;
    return {
      operationalDate: slot.reportDate,
      reportType: "omzet",
      identityCount: slot.reportCount,
      cashCount: slot.generatedCashCount,
      canonicalRecordId: shortId(canonical?.id || preview.keepReportId),
      keepReportId: shortId(preview.keepReportId),
      keepCashTxId: shortId(preview.keepCashTxId),
      tombstoneReportIds: (preview.wouldDeleteReportIds || []).map(shortId),
      tombstoneCashTxIds: (preview.wouldDeleteTxIds || []).map(shortId),
      nominalKeep: canonical?.total ?? null,
      warning: "DRY-RUN — tidak diterapkan",
    };
  }),
  approvalRequired: true,
  nextCommandAfterApproval: "Belum tersedia — buat skrip execute terpisah setelah approval tertulis hasil audit.",
};

const outDir = join(ROOT, "docs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "CLEANUP_SAMTARO_DRYRUN_RUNTIME.json");
writeFileSync(outPath, JSON.stringify(plan, null, 2));

console.log(JSON.stringify(plan, null, 2));
console.log(`\n📄 Dry-run plan: ${outPath}`);
console.log("Tidak ada perubahan ke app_state. Menunggu persetujuan manual hasil audit.");
