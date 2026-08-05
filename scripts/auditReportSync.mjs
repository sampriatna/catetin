#!/usr/bin/env node
/**
 * Audit read-only sinkronisasi laporan omzet:
 * - duplikat businessId+outlet+date
 * - submissionId dobel
 * - tanpa reportKey
 * - revision_requested yang punya pengganti
 * - Kisamen 2026-08-01, Samtaro 2026-08-03 & 2026-08-04
 *
 *   npm run audit:report-sync
 * Tidak ada UPDATE/DELETE/INSERT.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { makeDailyReportKey, isCompleteDailyReport } from "../lib/kasirHarian.js";
import { normalizeReportDate } from "../lib/laporanKeuangan.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
const FOCUS = [
  { outlet: "KSM", date: "2026-08-01", label: "Kisamen" },
  { outlet: "SMT", date: "2026-08-03", label: "Samtaro" },
  { outlet: "SMT", date: "2026-08-04", label: "Samtaro" },
];

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
  console.error("\n❌ Butuh .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  console.error("   SQL: supabase/audit-ksm-smt-aug2026.sql\n");
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
const reports = doc.dailyReports || [];
const txs = doc.transactions || [];

console.log("\n=== Audit sync laporan omzet (read-only) ===");
console.log("updated_at:", data.updated_at);
console.log("total reports:", reports.length);

const byKey = new Map();
const bySubmission = new Map();
const missingKey = [];
for (const r of reports) {
  const date = normalizeReportDate(r.date) || r.date;
  const key = r.reportKey || makeDailyReportKey({ businessId: r.businessId || BIZ, outlet: r.outlet, date });
  if (!r.reportKey) missingKey.push(r);
  if (key) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const sid = r.submissionId || r.idempotencyKey;
  if (sid) {
    if (!bySubmission.has(sid)) bySubmission.set(sid, []);
    bySubmission.get(sid).push(r);
  }
}

console.log("\n--- Duplikat reportKey / outlet+date ---");
let dupKeys = 0;
for (const [key, list] of byKey) {
  if (list.length <= 1) continue;
  dupKeys++;
  const canonical = list.slice().sort((a, b) =>
    (b.resubmittedAt || b.submittedAt || "").localeCompare(a.resubmittedAt || a.submittedAt || "")
  )[0];
  console.log(`⚠ ${key} ×${list.length} → canonical ${canonical.id} status=${canonical.status}`);
  for (const r of list) {
    console.log(`   - ${r.id} status=${r.status} total=${r.total} lengkap=${isCompleteDailyReport(r, txs)}`);
  }
}
if (!dupKeys) console.log("✓ tidak ada duplikat slot");

console.log("\n--- submissionId sama (multi report) ---");
let dupSid = 0;
for (const [sid, list] of bySubmission) {
  if (list.length <= 1) continue;
  dupSid++;
  console.log(`⚠ submissionId ${sid} → ${list.map((r) => r.id).join(", ")}`);
}
if (!dupSid) console.log("✓ tidak ada submissionId dobel");

console.log("\n--- Tanpa reportKey ---");
console.log(missingKey.length ? `⚠ ${missingKey.length} laporan tanpa reportKey (akan diisi saat submit berikutnya)` : "✓ semua punya atau bisa diturunkan");

console.log("\n--- Focus Kisamen/Samtaro ---");
for (const t of FOCUS) {
  const list = reports.filter(
    (r) => r.outlet === t.outlet && (normalizeReportDate(r.date) || r.date) === t.date
  );
  console.log(`\n${t.label} ${t.outlet} ${t.date}: ${list.length} record`);
  if (!list.length) {
    console.log("  (kosong di dailyReports)");
    continue;
  }
  for (const r of list) {
    const linked = txs.filter((x) => x.dailyReportId === r.id);
    const cash = linked.filter((x) => /laporan harian/i.test(x.source || ""));
    console.log(JSON.stringify({
      outlet: r.outlet,
      report_date: r.date,
      report_id: r.id,
      reportKey: r.reportKey || makeDailyReportKey({ businessId: r.businessId || BIZ, outlet: r.outlet, date: r.date }),
      submissionId: r.submissionId || r.idempotencyKey || null,
      status: r.status,
      nominal_omzet: r.total,
      lengkap: isCompleteDailyReport(r, txs),
      cash_tx: cash.length,
      submittedAt: r.submittedAt || null,
      revisionRequestedAt: r.revisionRequestedAt || null,
      rekomendasi: list.length > 1
        ? (isCompleteDailyReport(r, txs) && r.status !== "revision_requested" ? "kandidat canonical" : "kandidat non-canonical / stale")
        : (r.status === "revision_requested" ? "hapus atau minta kasir revisi — jangan biarkan stuck" : "OK"),
    }, null, 2));
  }
  const rev = list.filter((r) => r.status === "revision_requested");
  const newer = list.filter((r) => r.status === "submitted" || r.status === "admin_verified" || r.status === "settled");
  if (rev.length && newer.length) {
    console.log("  ⚠ Ada revision_requested + versi pengganti — pilih pengganti sebagai canonical, batalkan notif revisi.");
  }
}

console.log("\n✓ Selesai — tidak ada mutasi.\n");
