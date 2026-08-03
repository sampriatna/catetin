#!/usr/bin/env node
/**
 * Audit read-only Kisamen 1–2 Agustus 2026 — hanya bukti inti:
 *   A) laporan KSM tanggal itu ada / hilang?
 *   B) omset tunai laci dobel?
 *
 * Tidak ada UPDATE / DELETE / INSERT / UPSERT.
 *
 * Jalankan di laptop (butuh .env.local + service role):
 *   node scripts/auditKisamenAug2026.mjs
 *   # atau: npm run audit:kisamen
 *
 * Output: terminal + docs/AUDIT_KISAMEN_LAPORAN_AUG2026_RESULTS.md
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIZ = "e23ed572-234c-4995-acad-fa6bff7c58d2";
const OUTLET = "KSM";
const DATES = ["2026-08-01", "2026-08-02"];
const LACI = "w_laci_ksm";
const OUT_MD = join(ROOT, "docs/AUDIT_KISAMEN_LAPORAN_AUG2026_RESULTS.md");

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

function isCashOmsetKsm(t, date) {
  if (!t || t.type !== "in") return false;
  if (!/laporan harian/i.test(t.source || "")) return false;
  if (t.date !== date) return false;
  const desc = t.desc || "";
  const w = walletId(t);
  return w === LACI || /omset tunai\s+ksm/i.test(desc);
}

function fmtRp(n) {
  return new Intl.NumberFormat("id-ID").format(Number(n) || 0);
}

function line(s = "") {
  console.log(s);
}

loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  line("\n❌ Tidak bisa audit otomatis: .env.local belum lengkap.");
  line("   Wajib di laptop:");
  line("   NEXT_PUBLIC_SUPABASE_URL=https://….supabase.co");
  line("   SUPABASE_SERVICE_ROLE_KEY=…  (Settings → API → service_role)");
  line("\nLalu:");
  line("   node scripts/auditKisamenAug2026.mjs");
  line("\nDari HP: tidak perlu jalankan apa pun sekarang.");
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
  console.error("❌ Gagal baca app_state:", error.message);
  process.exit(1);
}
if (!data?.data) {
  console.error("❌ app_state kosong untuk business_id", BIZ);
  process.exit(1);
}

const doc = data.data;
const reports = doc.dailyReports || [];
const txs = doc.transactions || [];
const reportById = new Map(reports.filter((r) => r?.id).map((r) => [r.id, r]));

const md = [];
const push = (s = "") => {
  md.push(s);
  line(s.replace(/^\*\*/, "").replace(/\*\*$/g, ""));
};

push("# Hasil Audit Kisamen 1–2 Agustus 2026 (otomatis dari kode)");
push("");
push(`**Dihasilkan:** ${new Date().toISOString()}`);
push(`**Business:** \`${BIZ}\``);
push(`**Cloud updated_at:** ${data.updated_at}`);
push(`**Mode:** read-only (SELECT app_state saja)`);
push("");
push(`Snapshot: laporan=${reports.length}, transaksi=${txs.length}`);
push("");

const verdicts = [];

for (const date of DATES) {
  push(`## Tanggal ${date}`);
  push("");

  const dayReports = reports.filter((r) => r.outlet === OUTLET && r.date === date);
  const cashTxs = txs.filter((t) => isCashOmsetKsm(t, date));

  if (!dayReports.length) {
    push(`- Laporan KSM: **TIDAK ADA** di dailyReports`);
  } else {
    push(`- Laporan KSM: **${dayReports.length}** record`);
    for (const r of dayReports) {
      push(
        `  - \`${r.id}\` status=\`${r.status}\` total=${fmtRp(r.total)} tunai=${fmtRp(r.setoranOwner ?? r.cash)} submittedAt=${r.submittedAt || "—"} settledAt=${r.settledAt || "—"} submissionId=${r.submissionId || r.idempotencyKey || "—"}`
      );
    }
  }

  push(`- Omset tunai laci (source Laporan harian): **${cashTxs.length}** tx`);
  for (const t of cashTxs) {
    push(
      `  - \`${t.id}\` Rp ${fmtRp(t.amount)} report_id=${t.dailyReportId || "—"} desc="${t.desc || ""}" createdAt=${t.createdAt || "—"}`
    );
  }

  // Duplikat kandidat: >1 cash omset hari yang sama
  let dupNote = "tidak (≤1 tx omset tunai)";
  if (cashTxs.length > 1) {
    const byReport = new Map();
    for (const t of cashTxs) {
      const k = t.dailyReportId || "(tanpa report_id)";
      if (!byReport.has(k)) byReport.set(k, []);
      byReport.get(k).push(t.id);
    }
    const sameAmount = cashTxs.every((t) => t.amount === cashTxs[0].amount);
    const reportIds = [...new Set(cashTxs.map((t) => t.dailyReportId || null))];
    const orphan = cashTxs.filter((t) => t.dailyReportId && !reportById.has(t.dailyReportId));
    const linkedMissingReport = cashTxs.filter((t) => !dayReports.some((r) => r.id === t.dailyReportId) && t.dailyReportId);

    dupNote = "KANDIDAT DOBEL — perlu cek report_id/deskripsi";
    push(`- Kandidat duplikat: **YA** (${cashTxs.length} tx)`);
    push(`  - nominal sama semua? ${sameAmount ? "ya (" + fmtRp(cashTxs[0].amount) + ")" : "tidak"}`);
    push(`  - report_id unik: ${reportIds.map((x) => x || "null").join(", ")}`);
    push(`  - tx tanpa laporan surviving di tanggal ini: ${linkedMissingReport.length}`);
    push(`  - tx orphan (report_id tidak ada di dailyReports sama sekali): ${orphan.length}`);
    for (const [rid, ids] of byReport) {
      push(`  - report_id ${rid}: ${ids.join(", ")}`);
    }
  } else {
    push(`- Kandidat duplikat: **tidak**`);
  }

  // Orphan pattern: ada cash, tidak ada laporan
  if (!dayReports.length && cashTxs.length > 0) {
    push(`- Pola: **TX ADA, LAPORAN HILANG** (cocok keluhan sync)`);
    verdicts.push({
      date,
      laporan: "HILANG",
      cashCount: cashTxs.length,
      dup: cashTxs.length > 1,
      pattern: "tx_tanpa_laporan",
    });
  } else if (dayReports.length > 0 && cashTxs.length > 1) {
    push(`- Pola: **LAPORAN ADA + CASH DOBEL**`);
    verdicts.push({
      date,
      laporan: dayReports.map((r) => r.status).join("|"),
      cashCount: cashTxs.length,
      dup: true,
      pattern: "laporan_plus_cash_dobel",
    });
  } else if (dayReports.length > 0 && cashTxs.length === 1) {
    push(`- Pola: **NORMAL** (1 laporan, 1 cash)`);
    verdicts.push({
      date,
      laporan: dayReports.map((r) => r.status).join("|"),
      cashCount: 1,
      dup: false,
      pattern: "normal",
    });
  } else if (dayReports.length > 0 && cashTxs.length === 0) {
    push(`- Pola: **LAPORAN ADA, CASH BELUM/0** (omset tunai 0 atau tx hilang)`);
    verdicts.push({
      date,
      laporan: dayReports.map((r) => r.status).join("|"),
      cashCount: 0,
      dup: false,
      pattern: "laporan_tanpa_cash",
    });
  } else {
    push(`- Pola: **KOSONG** (tidak ada laporan & tidak ada cash)`);
    verdicts.push({
      date,
      laporan: "TIDAK_ADA",
      cashCount: 0,
      dup: false,
      pattern: "kosong",
    });
  }

  push(`- Ringkas duplikat: ${dupNote}`);
  push("");
}

push("## Verdict singkat");
push("");
for (const v of verdicts) {
  push(
    `- **${v.date}**: laporan=\`${v.laporan}\` cashTx=${v.cashCount} dobel=${v.dup ? "YA" : "tidak"} pola=\`${v.pattern}\``
  );
}
push("");
push("## Catatan");
push("");
push("- Script ini **tidak** mengubah data.");
push("- Patch idempotency di app hanya berlaku submit **baru** setelah deploy; tidak memperbaiki baris lama.");
push("- Jika ada pola `tx_tanpa_laporan` atau cash dobel: koreksi (reversal/tombstone) belakangan, jangan hapus mentah.");
push("");

writeFileSync(OUT_MD, md.join("\n") + "\n", "utf8");
line(`\n✓ Hasil ditulis ke docs/AUDIT_KISAMEN_LAPORAN_AUG2026_RESULTS.md`);
