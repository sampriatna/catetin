#!/usr/bin/env node
/**
 * Audit read-only duplikat laporan omset / transaksi generated.
 * Khusus highlight SMT (Samtaro), KSM, KBU.
 *
 *   npm run audit:duplicates
 * Tidak ada UPDATE / DELETE / INSERT.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { auditDailyReportDuplicates, previewDuplicateCleanup } from "../lib/dailyReportAudit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";

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
  console.error("\n❌ Butuh .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)\n");
  process.exit(2);
}

const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data, error } = await sb.from("app_state").select("data, updated_at").eq("business_id", BIZ).maybeSingle();
if (error) throw error;
if (!data) {
  console.error("app_state tidak ditemukan");
  process.exit(1);
}

const doc = data.data || {};
const scan = auditDailyReportDuplicates(doc, { businessId: BIZ });

console.log("\n=== Audit duplikat laporan/omset (read-only) ===");
console.log("updated_at:", data.updated_at);
console.log("scannedSlots:", scan.scannedSlots);
console.log("duplicateSlots:", scan.duplicateSlots);

console.log("\n--- Focus SMT / KSM / KBU ---");
if (!scan.focus.length) {
  console.log("✓ tidak ada issue di outlet fokus");
} else {
  for (const row of scan.focus) {
    console.log(`\n${row.outlet} ${row.reportDate}`);
    console.log("  reportIds:", row.reportIds.join(", ") || "(none)");
    console.log("  submissionIds:", row.submissionIds.join(", "));
    console.log("  generatedCashTxIds:", row.generatedCashTxIds.join(", "));
    console.log("  nominal:", row.generatedCashAmounts.join(", "));
    console.log("  reason:", row.reason || "(ok)");
    if (row.duplicate) {
      const preview = previewDuplicateCleanup(doc, row);
      console.log("  preview keepReport:", preview.keepReportId);
      console.log("  preview keepCash:", preview.keepCashTxId);
      console.log("  preview wouldDeleteReports:", preview.wouldDeleteReportIds.join(", ") || "-");
      console.log("  preview wouldDeleteTxs:", preview.wouldDeleteTxIds.join(", ") || "-");
    }
  }
}

console.log("\n--- Semua issue ---");
for (const row of scan.issues) {
  if (["SMT", "KSM", "KBU"].includes(row.outlet)) continue;
  console.log(`${row.outlet} ${row.reportDate}: ${row.reason}`);
}
if (!scan.issues.length) console.log("✓ bersih");

console.log("\n(Tidak ada data yang diubah.)\n");
