#!/usr/bin/env node
/**
 * Audit read-only duplikat Laporan Omset Samtaro (SMT).
 * Tidak ada UPDATE / DELETE / INSERT.
 *
 *   node scripts/auditSamtaroDuplicates.mjs
 *   node scripts/auditSamtaroDuplicates.mjs --date=2026-08-08
 *   npm run audit:samtaro-dup
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { auditDailyReportDuplicates, auditDailyReportSlot, previewDuplicateCleanup } from "../lib/dailyReportAudit.js";
import { CANONICAL_BUSINESS_ID } from "../lib/canonicalBusiness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIZ = process.env.NF3_BUSINESS_ID || CANONICAL_BUSINESS_ID;
const dateArg = (process.argv.find((a) => a.startsWith("--date=")) || "").split("=")[1] || null;

function loadEnvLocal() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return false;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
  return true;
}

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\n❌ Butuh .env.local dengan NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY\n");
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
  console.error("Gagal load app_state:", error.message);
  process.exit(1);
}
if (!data?.data) {
  console.error("app_state kosong untuk", BIZ);
  process.exit(1);
}

const state = { ...data.data, businessId: BIZ };
const full = auditDailyReportDuplicates(state, { businessId: BIZ, focusOutlets: ["SMT"] });
const smtIssues = (full.issues || []).filter((r) => r.outlet === "SMT");
const focused = dateArg
  ? [auditDailyReportSlot(state, { businessId: BIZ, outlet: "SMT", date: dateArg })]
  : smtIssues.filter((r) => r.duplicate);

const report = {
  generatedAt: new Date().toISOString(),
  businessId: BIZ,
  cloudUpdatedAt: data.updated_at,
  focusDate: dateArg,
  note: "READ-ONLY audit — tidak menghapus data. Review primaryRecord sebelum cleanup manual.",
  summary: {
    scannedSlots: full.scannedSlots,
    smtIssueSlots: smtIssues.length,
    smtDuplicateSlots: smtIssues.filter((r) => r.duplicate).length,
  },
  duplicates: focused.map((slot) => ({
    ...slot,
    cleanupPreview: previewDuplicateCleanup(state, slot),
  })),
};

const outDir = join(ROOT, "docs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "AUDIT_SAMTARO_DUPLICATES_RUNTIME.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
console.log(`\n📄 Written ${outPath}`);
console.log("Rekomendasi: pakai cleanupPreview.keepReportId sebagai record utama; jangan hapus otomatis.");
