#!/usr/bin/env node
/**
 * Audit read-only: Kisamen 1 Agu 2026 + Samtaro 3 Agu 2026
 * Tidak ada UPDATE / DELETE / INSERT.
 *
 *   node scripts/auditKsmSmtAug2026.mjs
 *   # atau: npm run audit:ksm-smt
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { isCompleteDailyReport, dailyReportSlotKey } from "../lib/kasirHarian.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
const TARGETS = [
  { outlet: "KSM", date: "2026-08-01", label: "Kisamen", laci: "w_laci_ksm" },
  { outlet: "SMT", date: "2026-08-03", label: "Samtaro", laci: "w_laci_smt" },
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

function walletId(t) {
  return t?.walletId || t?.wallet_id || null;
}

function relatedTxs(txs, target, reportIds) {
  return (txs || []).filter((t) => {
    if (reportIds.has(t?.dailyReportId)) return true;
    const w = walletId(t);
    const desc = t?.desc || "";
    if (t?.date !== target.date && !(target.outlet === "SMT" && t?.date === "2026-08-04")) {
      return false;
    }
    return (
      w === target.laci
      || t?.fromWalletId === target.laci
      || t?.toWalletId === target.laci
      || desc.includes(target.outlet)
      || /laporan harian|settle admin/i.test(t?.source || "")
    );
  });
}

function rowAudit(report, txs) {
  const linked = (txs || []).filter((t) => t?.dailyReportId === report?.id);
  const cash = linked.filter((t) => /laporan harian/i.test(t?.source || "") && t?.type === "in");
  const settle = linked.filter((t) => /settle admin/i.test(t?.source || ""));
  const complete = isCompleteDailyReport(report, txs);
  return {
    outlet: report?.outlet || null,
    report_date: report?.date || null,
    report_id: report?.id || null,
    submissionId: report?.submissionId || null,
    idempotencyKey: report?.idempotencyKey || null,
    created_at: report?.submittedAt || null,
    updated_at: report?.resubmittedAt || report?.settledAt || report?.adminVerifiedAt || report?.submittedAt || null,
    status: report?.status || null,
    nominal_omzet: report?.total ?? null,
    setoran_tunai: report?.setoranOwner ?? report?.cash ?? null,
    wallet_tx_ids: linked.map((t) => t.id),
    cash_tx_count: cash.length,
    settle_tx_count: settle.length,
    lengkap: complete,
    catatan: complete
      ? "lengkap"
      : !report
        ? "tidak ada laporan"
        : "tidak lengkap / setengah tersimpan",
  };
}

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\n❌ Butuh .env.local dengan NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  console.error("   SQL alternatif: supabase/audit-ksm-smt-aug2026.sql\n");
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
if (error) throw error;
if (!data) {
  console.error("app_state tidak ditemukan untuk business", BIZ);
  process.exit(1);
}

const doc = data.data || {};
const reports = doc.dailyReports || [];
const txs = doc.transactions || [];
const deletedSlots = doc.deletedDailyReportSlots || [];

console.log("\n=== Audit KSM 1 Agu + SMT 3 Agu (read-only) ===");
console.log("Cloud updated_at:", data.updated_at);
console.log("Total dailyReports:", reports.length);
console.log("Total transactions:", txs.length);

for (const target of TARGETS) {
  const slot = dailyReportSlotKey(target.outlet, target.date);
  const slotReports = reports.filter(
    (r) => r?.outlet === target.outlet && r?.date === target.date
  );
  const ids = new Set(slotReports.map((r) => r.id));
  const related = relatedTxs(txs, target, ids);
  const tomb = deletedSlots.filter(
    (s) => s?.outlet === target.outlet && s?.date === target.date
  );
  const sameDateOther = reports.filter(
    (r) => r?.date === target.date && r?.outlet !== target.outlet
  );

  console.log(`\n--- ${target.label} (${target.outlet}) ${target.date} slot=${slot} ---`);
  if (!slotReports.length) {
    console.log(JSON.stringify(rowAudit(null, related), null, 2));
    console.log("Tx terkait (tanpa report id):", related.length);
    for (const t of related.slice(0, 20)) {
      console.log(
        `  tx ${t.id} date=${t.date} amt=${t.amount} src=${t.source} desc=${t.desc} report=${t.dailyReportId || "-"}`
      );
    }
  } else {
    for (const r of slotReports) {
      console.log(JSON.stringify(rowAudit(r, txs), null, 2));
    }
  }
  if (tomb.length) {
    console.log("Tombstone slots:", JSON.stringify(tomb));
  }
  if (sameDateOther.length) {
    console.log(
      "Outlet lain di tanggal sama (bukan duplicate):",
      sameDateOther.map((r) => `${r.outlet}:${r.id}:${r.status}`).join(", ")
    );
  }
}

console.log("\n✓ Selesai — tidak ada mutasi data.\n");
