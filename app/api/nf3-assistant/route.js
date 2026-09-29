// app/api/nf3-assistant/route.js — NF3 Assistant chat + prompt caching

import Anthropic from "@anthropic-ai/sdk";
import { bearerToken, sbAdmin, sbUser } from "../../../lib/purchasingAliasesAuth.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

function lookbackDaysForRole(assistantRole) {
  if (assistantRole === "owner" || assistantRole === "keuangan") return 365;
  return 90;
}

async function requireAssistantMember(req, businessId) {
  const token = bearerToken(req);
  if (!token) {
    return { error: Response.json({ error: "Sesi login tidak ditemukan." }, { status: 401 }) };
  }
  if (!businessId) {
    return { error: Response.json({ error: "businessId wajib." }, { status: 400 }) };
  }

  const userClient = sbUser(token);
  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) {
    return { error: Response.json({ error: "Sesi tidak valid." }, { status: 401 }) };
  }

  const admin = sbAdmin();
  const { data: member, error: memErr } = await admin
    .from("business_members")
    .select("role, outlet")
    .eq("business_id", businessId)
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!member?.role) {
    return { error: Response.json({ error: "Bukan anggota bisnis ini." }, { status: 403 }) };
  }

  return { user: authData.user, member, admin };
}

function mapAssistantRole(role) {
  if (role === "admin") return "keuangan";
  return role;
}

function assistantOutlet(member) {
  if (member.role === "kasir" && member.outlet) return member.outlet;
  return "semua";
}

async function fetchTransactions(admin, businessId, assistantRole, outlet) {
  const lookback = lookbackDaysForRole(assistantRole);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookback);
  const since = cutoff.toISOString().slice(0, 10);

  // Transaksi disimpan per baris di app_transactions (bukan lagi di app_state.data.transactions).
  // Ambil hanya kolom yang dipakai, per 1000 baris.
  const PAGE = 1000;
  let txs = [];
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await admin
      .from("app_transactions")
      .select("date:data->>date, type:data->>type, amount:data->amount, outlet:data->>outlet, supplier:data->>supplier, desc:data->>desc, module:data->>module")
      .eq("business_id", businessId)
      .gte("data->>date", since)
      .order("tx_id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("NF3 Assistant app_transactions error:", error.message);
      return { txs: [], dataLoadError: true };
    }
    txs = txs.concat((data || []).map((t) => ({ ...t, amount: Number(t.amount) || 0 })));
    if (!data || data.length < PAGE) break;
  }

  if (assistantRole === "kasir" && outlet && outlet !== "semua") {
    txs = txs.filter((t) => (t.outlet || "").toUpperCase() === outlet.toUpperCase());
  } else if (assistantRole === "purchasing") {
    txs = txs.filter((t) => t.module === "purchasing");
  }

  txs = txs.filter((t) => t.date && new Date(t.date) >= cutoff);
  txs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { txs, dataLoadError: false, lookback };
}

function buildDataContext(txs, assistantRole, lookback = 90) {
  const strategic = assistantRole === "owner" || assistantRole === "keuangan";
  const monthLimit = strategic ? 12 : 2;
  const itemLimit = strategic ? 10 : 5;
  const supplierLimit = strategic ? 5 : 3;
  const recentLimit = strategic ? 10 : 5;

  if (!txs.length) {
    return `Data transaksi: belum ada data dalam ${lookback} hari terakhir.`;
  }

  const byOutlet = {};
  const byMonth = {};
  const bySupplier = {};
  const byItem = {};
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // WIB
  const thisMonth = today.slice(0, 7);
  const bulanIni = {};
  let transferCount = 0;

  for (const t of txs) {
    // Pindah dana antar-dompet bukan pemasukan/pengeluaran usaha.
    if (t.type === "transfer") { transferCount++; continue; }
    const o = t.outlet || "Pusat (tanpa outlet: rekening bank/kas besar)";
    if ((t.date || "").startsWith(thisMonth)) {
      if (!bulanIni[o]) bulanIni[o] = { in: 0, out: 0, count: 0 };
      if (t.type === "in") bulanIni[o].in += t.amount || 0;
      else bulanIni[o].out += t.amount || 0;
      bulanIni[o].count++;
    }
    if (!byOutlet[o]) byOutlet[o] = { in: 0, out: 0, count: 0 };
    if (t.type === "in") byOutlet[o].in += t.amount || 0;
    else byOutlet[o].out += t.amount || 0;
    byOutlet[o].count++;

    const month = (t.date || "").slice(0, 7);
    if (month) {
      byMonth[month] = (byMonth[month] ?? 0) + (t.type === "out" ? (t.amount || 0) : 0);
    }

    if (t.supplier) {
      bySupplier[t.supplier] = (bySupplier[t.supplier] ?? 0) + (t.amount || 0);
    }
    if (t.desc) {
      byItem[t.desc] = (byItem[t.desc] ?? 0) + (t.amount || 0);
    }
  }

  const fmt = (n) => `Rp${Number(n).toLocaleString("id-ID")}`;

  const bulanIniSummary = Object.entries(bulanIni)
    .sort((a, b) => b[1].out - a[1].out)
    .map(([o, v]) => `  ${o}: pengeluaran ${fmt(v.out)} | pemasukan ${fmt(v.in)} | ${v.count} transaksi`)
    .join("\n");

  const outletSummary = Object.entries(byOutlet)
    .map(([o, v]) => `  ${o}: pemasukan ${fmt(v.in)} | pengeluaran ${fmt(v.out)} | ${v.count} transaksi`)
    .join("\n");

  const monthSummary = Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, monthLimit)
    .map(([m, v]) => `  ${m}: ${fmt(v)}`)
    .join("\n");

  const topItems = Object.entries(byItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, itemLimit)
    .map(([item, v]) => `  ${item}: ${fmt(v)}`)
    .join("\n");

  const topSuppliers =
    assistantRole !== "kasir"
      ? Object.entries(bySupplier)
          .sort((a, b) => b[1] - a[1])
          .slice(0, supplierLimit)
          .map(([s, v]) => `  ${s}: ${fmt(v)}`)
          .join("\n")
      : "";

  const recent = txs
    .slice(0, recentLimit)
    .map(
      (t) =>
        `  [${t.date}] ${t.outlet} | ${t.type === "out" ? "keluar" : "masuk"} ${fmt(t.amount)} | ${t.desc || "-"}${t.supplier ? ` (${t.supplier})` : ""}`
    )
    .join("\n");

  return `
=== DATA TRANSAKSI NF (${lookback} hari terakhir, total ${txs.length} transaksi) ===
Hari ini: ${today} (WIB). Bulan ini = ${thisMonth}.${transferCount ? ` ${transferCount} transfer antar-dompet tidak dihitung sebagai pemasukan/pengeluaran.` : ""}

Bulan ini (${thisMonth}) per outlet, urut pengeluaran terbesar:
${bulanIniSummary || "  belum ada transaksi bulan ini"}

Per outlet (${lookback} hari):
${outletSummary}

Pengeluaran per bulan:
${monthSummary}

${itemLimit} item terbanyak dibeli:
${topItems}

${topSuppliers ? `Top supplier:\n${topSuppliers}\n` : ""}
${recentLimit} transaksi terbaru:
${recent}
=== END DATA ===
`.trim();
}

function buildStaticSystemPrompt(assistantRole, outlet) {
  return `NF3 Assistant — asisten internal Nusa Food (F&B multi-outlet, Cirebon).
Bahasa Indonesia, singkat, fakta dari data.

Outlet: KBU (penyetan), KSM (ramen), SMT (takeaway kopi/dimsum), Gudang Central.
Role: ${assistantRole} | Outlet sesi: ${outlet}

Akses: owner=semua (data 1 tahun); keuangan=transaksi/kas; kasir=hanya outlet sendiri (90 hari).
Jawab dari DATA di blok berikutnya. Jika tidak ada: "Data ini belum tersedia."
Tidak bahas gaji/SDM pribadi atau di luar bisnis NF.`;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { messages, businessId } = body;

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: "Messages tidak valid" }, { status: 400 });
    }
    if (!businessId) {
      return Response.json({ error: "businessId diperlukan" }, { status: 400 });
    }

    const access = await requireAssistantMember(req, businessId);
    if (access.error) return access.error;

    const assistantRole = mapAssistantRole(access.member.role);
    const outlet = assistantOutlet(access.member);
    const { txs, dataLoadError, lookback } = await fetchTransactions(
      access.admin,
      businessId,
      assistantRole,
      outlet
    );

    const dataContext = dataLoadError
      ? "Data tidak dapat dimuat saat ini."
      : buildDataContext(txs, assistantRole, lookback);

    const staticPrompt = buildStaticSystemPrompt(assistantRole, outlet);
    const maxTokens = assistantRole === "owner" || assistantRole === "keuangan" ? 512 : 384;

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: "ANTHROPIC_API_KEY belum dikonfigurasi." }, { status: 503 });
    }

    const chatMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => !(m.role === "assistant" && /NF3 Assistant siap bantu/i.test(m.content)))
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: staticPrompt, cache_control: { type: "ephemeral" } },
        { type: "text", text: dataContext, cache_control: { type: "ephemeral" } },
      ],
      messages: chatMessages.length ? chatMessages : [{ role: "user", content: "Halo" }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    return Response.json({
      message: text,
      model: response.model,
      txCount: txs.length,
    });
  } catch (error) {
    console.error("NF3 Assistant error:", error);
    return Response.json({ error: "Gagal menghubungi AI" }, { status: 500 });
  }
}
