// app/api/shared-bank/route.js
// Write-through / baca saldo rekening Sam (FNB) dari staf NF yang bukan anggota FNB.
// Auth: anggota bisnis aktif (NF) + role owner|admin|purchasing.
// Tulis: service role ke app_state sumber (FNB) — FNB wallets/tx lain tidak diubah selain append tx.

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { CANONICAL_BUSINESS_ID } from "../../../lib/canonicalBusiness.js";
import {
  canWriteSharedBank,
  resolveSharedLinkFromWalletId,
  buildSourceTransaction,
  appendTransactionToDoc,
  sharedBankFloorError,
} from "../../../lib/sharedBankWrite.js";
import {
  computeWalletBalanceFromDoc,
  mirrorBalancesForLinks,
  walletTransactionsFromDoc,
  filterSharedTransactionsForView,
  mapTransactionsToSharedWallet,
  sharedWalletId,
} from "../../../lib/sharedWalletMirror.js";
import { sanitizeSharedLinks } from "../../../lib/sharedWalletPolicy.js";

function sbUser(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

async function authMember(req, businessId) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { error: Response.json({ error: "Sesi login tidak ditemukan." }, { status: 401 }) };

  const userClient = sbUser(token);
  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) {
    return { error: Response.json({ error: "Sesi tidak valid. Login ulang." }, { status: 401 }) };
  }

  const admin = getSupabaseAdmin();
  const { data: member, error: memErr } = await admin
    .from("business_members")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!member) {
    return { error: Response.json({ error: "Anda bukan anggota bisnis ini." }, { status: 403 }) };
  }
  if (!canWriteSharedBank(member.role)) {
    return { error: Response.json({ error: "Role Anda tidak boleh memakai rekening bersama." }, { status: 403 }) };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", authData.user.id)
    .maybeSingle();

  return {
    admin,
    user: {
      id: authData.user.id,
      name: profile?.name || authData.user.email || "Staf",
      role: member.role,
    },
  };
}

async function loadSharedLinkContext(auth, businessId) {
  const { data: row, error } = await auth.admin
    .from("app_state")
    .select("data")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;

  const links = sanitizeSharedLinks(row?.data?.walletSetup?.sharedLinks).filter((l) => l.enabled);
  const sourceIds = [...new Set(links.map((l) => l.sourceBusinessId).filter(Boolean))];
  const docs = {};
  await Promise.all(
    sourceIds.map(async (id) => {
      const { data } = await auth.admin.from("app_state").select("data").eq("business_id", id).maybeSingle();
      docs[id] = data?.data || null;
    })
  );
  return { links, docs };
}

function linksVisibleForTransactions(links, role) {
  if (role !== "purchasing") return links;
  return links;
}

function buildTransactionsByWallet({ links, docs, businessId, user, sharedWalletIdFilter, limit }) {
  const out = {};
  const targetLinks = sharedWalletIdFilter
    ? links.filter((l) => sharedWalletId(l) === sharedWalletIdFilter)
    : linksVisibleForTransactions(links, user.role);

  for (const link of targetLinks) {
    const virtualId = sharedWalletId(link);
    const doc = docs[link.sourceBusinessId];
    const raw = walletTransactionsFromDoc(doc, link.sourceWalletId, { limit: 0 });
    const filtered = filterSharedTransactionsForView(raw, {
      businessId,
      userId: user.id,
      role: user.role,
    });
    filtered.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || "")));
    out[virtualId] = mapTransactionsToSharedWallet(filtered.slice(0, limit), virtualId);
  }
  return out;
}

/** GET ?businessId=&action=balances|transactions — saldo / riwayat mirror rekening shared. */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) return Response.json({ error: "businessId wajib." }, { status: 400 });

    const auth = await authMember(req, businessId);
    if (auth.error) return auth.error;

    const action = searchParams.get("action") || "balances";
    const { links, docs } = await loadSharedLinkContext(auth, businessId);

    if (action === "transactions") {
      const sharedWalletIdFilter = searchParams.get("sharedWalletId") || null;
      const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);
      const transactionsByWallet = buildTransactionsByWallet({
        links,
        docs,
        businessId,
        user: auth.user,
        sharedWalletIdFilter,
        limit,
      });
      if (sharedWalletIdFilter) {
        return Response.json({ transactions: transactionsByWallet[sharedWalletIdFilter] || [] });
      }
      return Response.json({ transactionsByWallet });
    }

    if (auth.user.role === "purchasing") {
      // Purchasing: bank Sam — angka saldo disembunyikan di UI/API (balance=null).
      // Validasi kecukupan saldo dilakukan di POST (sumber FNB), bukan di klien.
      // Uang NF / PayLater (ops_share) boleh lihat saldo.
      const full = mirrorBalancesForLinks(links, docs);
      const out = {};
      for (const link of links) {
        const id = `shared_${link.id}`;
        if (link.linkKind === "ops_share") {
          out[id] = full[id] || {
            linkId: link.id,
            balance: 0,
            sourceWalletName: link.sourceWalletName || "",
            sourceBusinessName: link.sourceBusinessName || "",
            missing: true,
          };
        } else {
          out[id] = {
            linkId: link.id,
            balance: null,
            sourceWalletName: link.sourceWalletName || "",
            sourceBusinessName: link.sourceBusinessName || "",
            missing: false,
            hidden: true,
          };
        }
      }
      return Response.json({ balances: out });
    }

    return Response.json({ balances: mirrorBalancesForLinks(links, docs) });
  } catch (e) {
    console.error("[api/shared-bank GET]", e);
    return Response.json({ error: e.message || "Gagal memuat saldo rekening bersama." }, { status: 500 });
  }
}

/** POST — catat transaksi write-through ke rekening sumber. */
export async function POST(req) {
  try {
    const body = await req.json();
    const {
      businessId,
      businessName,
      sharedWalletId,
      type,
      amount,
      categoryId,
      desc,
      date,
      source,
      txId: clientTxId,
    } = body || {};

    if (!businessId || !sharedWalletId) {
      return Response.json({ error: "businessId dan sharedWalletId wajib." }, { status: 400 });
    }
    // Nusa Food F&B mencatat langsung ke app_state sendiri — bukan jalur write-through NF.
    if (businessId === CANONICAL_BUSINESS_ID) {
      return Response.json({ error: "Nusa Food memakai pencatatan dompet biasa, bukan rekening terhubung." }, { status: 400 });
    }

    const auth = await authMember(req, businessId);
    if (auth.error) return auth.error;
    if (type === "in" && auth.user.role === "purchasing") {
      return Response.json({ error: "Purchasing hanya boleh pengeluaran dari rekening bersama." }, { status: 403 });
    }

    const { data: localRow, error: localErr } = await auth.admin
      .from("app_state")
      .select("data")
      .eq("business_id", businessId)
      .maybeSingle();
    if (localErr) throw localErr;

    const links = localRow?.data?.walletSetup?.sharedLinks || [];
    const link = resolveSharedLinkFromWalletId(sharedWalletId, links);
    if (!link) {
      return Response.json({ error: "Rekening bersama tidak ditemukan / tidak aktif." }, { status: 400 });
    }
    if (link.sourceBusinessId === businessId) {
      return Response.json({ error: "Sumber rekening tidak valid." }, { status: 400 });
    }

    const txId = clientTxId || `tsh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sourceTx = buildSourceTransaction({
      draft: { type, amount, categoryId, desc, date, source },
      sourceWalletId: link.sourceWalletId,
      fromBusinessId: businessId,
      fromBusinessName: businessName || localRow?.data?.profile?.name || "NF",
      user: auth.user,
      txId,
    });

    // Load sumber segar → append → upsert (hindari overwrite total dengan merge sederhana).
    const { data: srcRow, error: srcErr } = await auth.admin
      .from("app_state")
      .select("data")
      .eq("business_id", link.sourceBusinessId)
      .maybeSingle();
    if (srcErr) throw srcErr;
    if (!srcRow?.data) {
      return Response.json({ error: "Dokumen bisnis sumber tidak ditemukan." }, { status: 404 });
    }

    const srcWallets = srcRow.data.wallets || [];
    const srcWallet = srcWallets.find((w) => w.id === link.sourceWalletId && w.active !== false);
    if (!srcWallet) {
      return Response.json({ error: "Rekening sumber tidak aktif di FNB." }, { status: 400 });
    }

    const currentBal = computeWalletBalanceFromDoc(srcRow.data, link.sourceWalletId);
    const allowNegative =
      srcWallet.type === "paylater" ||
      srcWallet.liability === true ||
      srcWallet.allowNegative === true ||
      (link.linkKind === "ops_share" && /paylater/i.test(`${link.label || ""} ${link.sourceWalletName || ""}`));
    const displayName = link.label || link.sourceWalletName || "dompet bersama";
    const floorErr = sharedBankFloorError({
      type,
      amount,
      balance: currentBal,
      walletName: displayName,
      hideAmount: auth.user.role === "purchasing" && link.linkKind !== "ops_share",
      allowNegative,
    });
    if (floorErr) {
      return Response.json(
        {
          error: floorErr,
          balance: auth.user.role === "purchasing" && link.linkKind !== "ops_share" ? null : currentBal,
        },
        { status: 400 }
      );
    }

    const { doc: nextDoc, appended } = appendTransactionToDoc(srcRow.data, sourceTx);
    if (appended) {
      const { error: saveErr } = await auth.admin.from("app_state").upsert(
        {
          business_id: link.sourceBusinessId,
          data: nextDoc,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id" }
      );
      if (saveErr) throw saveErr;
    }

    const balance = computeWalletBalanceFromDoc(nextDoc, link.sourceWalletId);
    return Response.json({
      ok: true,
      txId,
      appended,
      balance,
      sourceBusinessId: link.sourceBusinessId,
      sourceWalletId: link.sourceWalletId,
      sourceWalletName: link.sourceWalletName || link.label,
    });
  } catch (e) {
    console.error("[api/shared-bank POST]", e);
    return Response.json({ error: e.message || "Gagal mencatat ke rekening bersama." }, { status: 500 });
  }
}
