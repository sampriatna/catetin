// app/api/cicilan/route.js
// Rencana cicilan PayLater. Satu akun PayLater dipakai FNB & Fishing → rencana dan transaksinya
// selalu ditulis ke dokumen pemilik dompet PayLater (FNB). Auth: owner/admin bisnis pemanggil.
// Tulis: service role, baca-ubah-tulis dengan CAS updated_at (tidak menimpa simpanan HP lain).

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { appendTransactionToDoc } from "../../../lib/sharedBankWrite.js";
import {
  createPlan,
  applyPayment,
  cancelPlan,
  buildPurchaseTx,
  buildUpfrontInterestTx,
} from "../../../lib/cicilan.js";
import {
  canManageCicilan,
  resolvePaylaterSource,
  buildCicilanView,
  paymentWalletsFor,
} from "../../../lib/cicilanSource.js";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function authMember(req, businessId) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new HttpError(401, "Sesi login tidak ditemukan.");

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) throw new HttpError(401, "Sesi tidak valid. Login ulang.");

  const admin = getSupabaseAdmin();
  const { data: member, error: memErr } = await admin
    .from("business_members")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!member) throw new HttpError(403, "Anda bukan anggota bisnis ini.");
  if (!canManageCicilan(member.role)) throw new HttpError(403, "Hanya owner/admin yang bisa mengelola cicilan.");

  const { data: profile } = await admin.from("profiles").select("name").eq("id", authData.user.id).maybeSingle();
  return {
    admin,
    user: { id: authData.user.id, name: profile?.name || authData.user.email || "Staf", role: member.role },
  };
}

async function loadDoc(admin, businessId) {
  const { data, error } = await admin
    .from("app_state")
    .select("data, updated_at")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw error;
  return data ? { doc: data.data || {}, updatedAt: data.updated_at } : null;
}

async function resolveContext(admin, businessId) {
  const local = await loadDoc(admin, businessId);
  if (!local) throw new HttpError(404, "Data bisnis belum ada.");
  const source = resolvePaylaterSource(local.doc, businessId);
  if (!source) throw new HttpError(400, "Dompet PayLater belum ada / belum terhubung di bisnis ini.");
  return source;
}

/** Baca dokumen sumber segar → fn(doc) → tulis jika updated_at belum berubah; ulangi bila konflik. */
async function mutateSourceDoc(admin, sourceBusinessId, fn) {
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await loadDoc(admin, sourceBusinessId);
    if (!row) throw new HttpError(404, "Dokumen bisnis sumber PayLater tidak ditemukan.");
    const { doc: nextDoc, result } = fn(row.doc);
    const { data: rows, error } = await admin
      .from("app_state")
      .update({ data: nextDoc, updated_at: new Date().toISOString() })
      .eq("business_id", sourceBusinessId)
      .eq("updated_at", row.updatedAt)
      .select("updated_at");
    if (error) throw error;
    if (Array.isArray(rows) && rows.length === 1) return { doc: nextDoc, result };
    lastErr = new Error("Data sedang diubah perangkat lain. Coba lagi.");
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
  }
  throw lastErr;
}

function withTxs(doc, txs) {
  let next = doc;
  for (const tx of txs.filter(Boolean)) next = appendTransactionToDoc(next, tx).doc;
  return next;
}

function upsertPlan(doc, plan) {
  const plans = Array.isArray(doc.cicilanPlans) ? doc.cicilanPlans.filter((p) => p.id !== plan.id) : [];
  return { ...doc, cicilanPlans: [...plans, plan] };
}

function findPlan(doc, planId) {
  const plan = (doc.cicilanPlans || []).find((p) => p.id === planId);
  if (!plan) throw new HttpError(404, "Rencana cicilan tidak ditemukan.");
  return plan;
}

/** Error validasi dari lib/cicilan.js (input pengguna) → 400. */
function validated(fn) {
  try {
    return fn();
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, e.message);
  }
}

function errorResponse(e, ctx) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(`[api/cicilan ${ctx}]`, e);
  return Response.json({ error: e.message || "Gagal memproses cicilan." }, { status: 500 });
}

/** GET ?businessId= — rencana, saldo PayLater, rekening bayar, kategori, belanja PayLater belum ditautkan. */
export async function GET(req) {
  try {
    const businessId = new URL(req.url).searchParams.get("businessId");
    if (!businessId) return Response.json({ error: "businessId wajib." }, { status: 400 });
    const { admin } = await authMember(req, businessId);
    const source = await resolveContext(admin, businessId);
    const src = await loadDoc(admin, source.sourceBusinessId);
    if (!src) throw new HttpError(404, "Dokumen bisnis sumber PayLater tidak ditemukan.");
    return Response.json(buildCicilanView(source, src.doc));
  } catch (e) {
    return errorResponse(e, "GET");
  }
}

/** POST { businessId, action: create|pay|cancel, ... } */
export async function POST(req) {
  try {
    const body = (await req.json()) || {};
    const { businessId, action } = body;
    if (!businessId) return Response.json({ error: "businessId wajib." }, { status: 400 });
    const { admin, user } = await authMember(req, businessId);
    const source = await resolveContext(admin, businessId);
    const fromBusinessId = source.viaLink ? businessId : null;

    if (action === "create") {
      const planId = body.planId || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const { doc } = await mutateSourceDoc(admin, source.sourceBusinessId, (cur) => {
        if ((cur.cicilanPlans || []).some((p) => p.id === planId)) return { doc: cur }; // retry idempoten
        let purchase = null;
        if (body.purchaseTxId) {
          purchase = (cur.transactions || []).find((t) => t.id === body.purchaseTxId);
          if (!purchase || purchase.type !== "out" || (purchase.walletId || purchase.wallet_id) !== source.walletId) {
            throw new HttpError(400, "Transaksi belanja PayLater yang dipilih tidak ditemukan.");
          }
          if ((cur.cicilanPlans || []).some((p) => p.purchaseTxId === purchase.id && p.status !== "batal")) {
            throw new HttpError(400, "Belanja ini sudah punya rencana cicilan.");
          }
        }
        const plan = validated(() => createPlan(
          {
            ...body.plan,
            walletId: source.walletId,
            purchaseTxId: purchase?.id || null,
            purchaseDate: purchase?.date || body.plan?.purchaseDate,
            pokok: purchase ? purchase.amount : body.plan?.pokok,
          },
          { id: planId, user, fromBusinessId }
        ));
        const txs = [
          purchase ? null : buildPurchaseTx(plan, { categoryId: body.purchaseCategoryId || null, user }),
          buildUpfrontInterestTx(plan, { user }),
        ];
        const linkedPlan = purchase ? plan : { ...plan, purchaseTxId: txs[0].id };
        return { doc: upsertPlan(withTxs(cur, txs), linkedPlan) };
      });
      return Response.json({ ok: true, planId, ...buildCicilanView(source, doc) });
    }

    if (action === "pay") {
      const { doc, result } = await mutateSourceDoc(admin, source.sourceBusinessId, (cur) => {
        const allowed = new Set(paymentWalletsFor(source, cur).map((w) => w.id));
        if (!allowed.has(body.fromWalletId)) throw new HttpError(400, "Rekening pembayar tidak tersedia untuk bisnis ini.");
        const plan = findPlan(cur, body.planId);
        const { txs, plan: nextPlan } = validated(() => applyPayment(plan, {
          ke: body.ke,
          fromWalletId: body.fromWalletId,
          amount: body.amount,
          date: body.date,
          user,
        }));
        return { doc: upsertPlan(withTxs(cur, txs), nextPlan), result: { txIds: txs.map((t) => t.id), status: nextPlan.status } };
      });
      return Response.json({ ok: true, ...result, ...buildCicilanView(source, doc) });
    }

    if (action === "cancel") {
      const { doc } = await mutateSourceDoc(admin, source.sourceBusinessId, (cur) => {
        const plan = findPlan(cur, body.planId);
        return { doc: upsertPlan(cur, validated(() => cancelPlan(plan, { reason: body.reason }))) };
      });
      return Response.json({ ok: true, ...buildCicilanView(source, doc) });
    }

    return Response.json({ error: "action tidak dikenal." }, { status: 400 });
  } catch (e) {
    return errorResponse(e, "POST");
  }
}
