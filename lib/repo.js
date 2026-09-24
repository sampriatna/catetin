// lib/repo.js
// Semua operasi database NF3 di satu tempat.
// Dipakai oleh BusinessProvider (actions) dan halaman onboarding/login.
// Setiap fungsi melempar error agar bisa ditangkap UI.

import { supabase } from "./supabaseClient.js";
import { todayLocal } from "./laporanKeuangan.js";
import { readStoredSession } from "./authBootstrap.js";
import { withTimeout } from "./supabaseSession.js";
import {
  getPresetWalletsForType,
  createWalletSetupSeed,
  FISHING_SLUG,
  NF_FISHING_WALLETS,
  createFishingWalletSetup,
} from "./walletPresets.js";
import { assertBusinessTypeAllowed } from "./onboardingPolicy.js";
import {
  pickDefaultBusinessId as pickCanonicalDefault,
  filterBusinessesForUi,
  findCanonicalInList,
  isCanonicalBusiness,
  CANONICAL_BUSINESS_ID,
} from "./canonicalBusiness.js";

export {
  pickCanonicalDefault as pickDefaultBusinessId,
  filterBusinessesForUi,
  findCanonicalInList,
  isCanonicalBusiness,
  CANONICAL_BUSINESS_ID,
};

function throwIf(error, ctx) {
  if (error) {
    const e = new Error(`[${ctx}] ${error.message || error}`);
    e.cause = error;
    throw e;
  }
}

function authFetchHeaders() {
  const token = readStoredSession()?.access_token;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ── AUTH / PROFILE ───────────────────────────────────────────────────────────

export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  throwIf(error, "getProfile");
  return data;
}

export async function updateProfile(patch) {
  const user = await getUser();
  if (!user) throw new Error("Belum login");
  const { data, error } = await supabase
    .from("profiles")
    .update({ name: patch.name, avatar_url: patch.avatar_url })
    .eq("id", user.id)
    .select()
    .single();
  throwIf(error, "updateProfile");
  return data;
}

// ── BUSINESS ─────────────────────────────────────────────────────────────────

// Daftar bisnis yang diikuti user (lewat keanggotaan)
export async function listMyBusinesses() {
  const { data, error } = await supabase
    .from("business_members")
    .select("role, outlet, active, business:businesses(id, slug, name, type)")
    .eq("active", true)
    .order("joined_at");
  throwIf(error, "listMyBusinesses");
  return (data || [])
    .filter((m) => m.business)
    .map((m) => ({ ...m.business, role: m.role, outlet: m.outlet }));
}

export async function createBusiness(slug, name, type) {
  assertBusinessTypeAllowed(type || "umkm");
  const call = supabase.rpc("create_business", {
    p_slug: slug,
    p_name: name,
    p_type: type,
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout — koneksi lambat. Coba lagi.")), 15000)
  );

  const { data, error } = await Promise.race([call, timeout]);
  throwIf(error, "createBusiness");

  // Seed app_state — dompet sesuai tipe bisnis (bukan katalog F&B penuh otomatis)
  try {
    const { saveAppState } = await import("./appState");
    const bizType = type || "umkm";
    // NF Nusa Fishing punya preset dompet sendiri + rekening Sam ter-mirror dari FNB.
    const isFishing = slug === FISHING_SLUG;
    await saveAppState(data.id, {
      profile: { name, businessType: bizType },
      wallets: isFishing ? NF_FISHING_WALLETS.map((w) => ({ ...w })) : getPresetWalletsForType(bizType),
      walletSetup: isFishing ? createFishingWalletSetup() : createWalletSetupSeed(bizType),
    });
  } catch (e) {
    console.warn("[createBusiness] seed app_state:", e);
  }

  if (typeof window !== "undefined") {
    localStorage.setItem("nf3:lastBiz", data.id);
  }

  return data;
}

export async function acceptInvite(token) {
  const { data, error } = await supabase.rpc("accept_invite", {
    p_token: token,
  });
  throwIf(error, "acceptInvite");
  return data;
}

/** Klaim undangan pending by email profil login (tanpa link ?invite=). */
export async function claimPendingInvites() {
  const controller = new AbortController();
  try {
    return await withTimeout(claimPendingInvitesRequest(controller.signal), 10000, "Periksa undangan");
  } finally {
    controller.abort();
  }
}

async function claimPendingInvitesRequest(signal) {
  const headers = authFetchHeaders();
  if (headers) {
    try {
      const res = await fetch("/api/invite/claim", { method: "POST", headers, signal });
      const json = await res.json().catch(() => ({}));
      // An empty array is a successful claim check, not a reason to call RPC again.
      if (res.ok && Array.isArray(json.members)) return json.members;
    } catch {
      /* lanjut RPC fallback */
    }
  }

  if (signal.aborted) throw new Error("Periksa undangan timeout. Coba lagi.");
  const { data, error } = await supabase.rpc("claim_pending_invites").abortSignal(signal);
  if (error) {
    if (/does not exist|could not find/i.test(error.message || "")) return [];
    throwIf(error, "claimPendingInvites");
  }
  return data || [];
}

/** Undangan aktif untuk email user login (belum diterima). */
export async function fetchMyPendingInvites() {
  const headers = authFetchHeaders();
  if (!headers) return { count: 0, invites: [] };
  try {
    const res = await fetch("/api/invite/pending", { method: "GET", headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { count: 0, invites: [] };
    return { count: json.count || 0, invites: json.invites || [] };
  } catch {
    return { count: 0, invites: [] };
  }
}

/** Daftar anggota bisnis + profil (2 query — join profiles via FK tidak tersedia di PostgREST). */
export async function listBusinessMembers(bizId) {
  if (!bizId) return [];
  const { data: rows, error } = await supabase
    .from("business_members")
    .select("id, role, outlet, active, joined_at, user_id")
    .eq("business_id", bizId)
    .order("joined_at");
  throwIf(error, "listBusinessMembers");
  if (!rows?.length) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, name, email")
    .in("id", userIds);
  throwIf(pErr, "listBusinessMembers/profiles");
  const byId = new Map((profiles || []).map((p) => [p.id, p]));

  return rows.map((r) => ({
    ...r,
    profiles: byId.get(r.user_id) || { id: r.user_id, name: "—", email: null },
  }));
}

/** Undangan staf yang belum diterima. */
export async function listPendingInvites(bizId) {
  if (!bizId) return [];
  const { data, error } = await supabase
    .from("invites")
    .select("id, email, role, outlet, created_at, expires_at, accepted")
    .eq("business_id", bizId)
    .eq("accepted", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  throwIf(error, "listPendingInvites");
  return data || [];
}

// ── STATE LENGKAP SATU BISNIS ────────────────────────────────────────────────
// Mengembalikan objek `s` yang dikonsumsi NF3App & halaman lain.

export async function loadBusinessState(bizId) {
  const user = await getUser();
  if (!user) throw new Error("Belum login");

  const [
    { data: business, error: e1 },
    { data: membership, error: e2 },
    { data: wallets, error: e3 },
    { data: categories, error: e4 },
    { data: transactions, error: e5 },
    { data: members, error: e6 },
    { data: drafts, error: e7 },
    { data: profile, error: e8 },
  ] = await Promise.all([
    supabase.from("businesses").select("id, slug, name, type").eq("id", bizId).single(),
    supabase
      .from("business_members")
      .select("role, outlet")
      .eq("business_id", bizId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("wallets").select("*").eq("business_id", bizId).order("sort"),
    supabase.from("categories").select(CATEGORY_SELECT).eq("business_id", bizId).order("sort"),
    supabase
      .from("transactions")
      .select("*")
      .eq("business_id", bizId)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    listBusinessMembers(bizId),
    supabase
      .from("transaction_drafts")
      .select("*")
      .eq("business_id", bizId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, name, email, avatar_url").eq("id", user.id).maybeSingle(),
  ]);

  throwIf(e1, "loadBusinessState/business");
  throwIf(e3, "loadBusinessState/wallets");
  throwIf(e4, "loadBusinessState/categories");
  throwIf(e5, "loadBusinessState/transactions");
  throwIf(e6, "loadBusinessState/members");
  throwIf(e7, "loadBusinessState/drafts");

  const txs = transactions || [];
  const wls = (wallets || []).map((w) => ({
    ...w,
    // saldo berjalan = opening + (in - out) untuk dompet itu
    balance:
      Number(w.opening_balance || 0) +
      txs
        .filter((t) => t.wallet_id === w.id)
        .reduce((acc, t) => acc + (t.type === "in" ? Number(t.amount) : -Number(t.amount)), 0),
  }));

  return {
    currentUser: {
      id: user.id,
      email: user.email,
      name: profile?.name || user.email,
      avatar_url: profile?.avatar_url || null,
      role: membership?.role || "kasir",
      outlet: membership?.outlet || null,
    },
    business,
    wallets: wls,
    categories: (categories || []).map(mapCategoryFromDb),
    transactions: txs,
    members: members || [],
    drafts: drafts || [],
  };
}

// ── TRANSACTIONS ─────────────────────────────────────────────────────────────

export async function addTransaction(bizId, t) {
  const user = await getUser();

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      business_id: bizId,
      wallet_id: t.wallet_id || t.walletId || null,
      category_id: t.category_id || t.categoryId || null,
      type: t.type,
      amount: Math.round(Number(t.amount)),
      description: t.description || t.desc || null,
      occurred_at: t.occurred_at || t.date || todayLocal(),
      outlet: t.outlet || null,
      source: t.source || "manual",
      created_by: user?.id || null,
      module: t.module || null,
      supplier: t.supplier || null,
      receipt_url: t.receipt_url || t.receiptUrl || null,
      meta: t.meta || null,
    })
    .select()
    .single();

  throwIf(error, "addTransaction");
  return data;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  throwIf(error, "deleteTransaction");
  return true;
}

// ── WALLETS ──────────────────────────────────────────────────────────────────

export async function upsertWallet(bizId, w) {
  const row = {
    business_id: bizId,
    name: w.name,
    type: w.type || "cash",
    icon: w.icon || null,
    color: w.color || null,
    opening_balance: Math.round(Number(w.opening_balance ?? w.openingBalance ?? 0)),
    sort: w.sort ?? 0,
  };
  let q;
  if (w.id) {
    q = supabase.from("wallets").update(row).eq("id", w.id).select().single();
  } else {
    q = supabase.from("wallets").insert(row).select().single();
  }
  const { data, error } = await q;
  throwIf(error, "upsertWallet");
  return data;
}

export async function toggleWallet(id, active) {
  const { data, error } = await supabase
    .from("wallets")
    .update({ active })
    .eq("id", id)
    .select()
    .single();
  throwIf(error, "toggleWallet");
  return data;
}

export async function deleteWallet(id) {
  const { error } = await supabase.from("wallets").delete().eq("id", id);
  throwIf(error, "deleteWallet");
  return true;
}

// ── CATEGORIES ───────────────────────────────────────────────────────────────

export const CATEGORY_SELECT =
  "id, business_id, name, type, icon, color, active, sort, role, accounting_group, description, created_at";

/** Normalisasi baris categories (Supabase) ke bentuk app. */
export function mapCategoryFromDb(row) {
  if (!row) return row;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
    active: row.active !== false,
    sort: row.sort ?? 0,
    role: row.role ?? null,
    accounting_group: row.accounting_group ?? null,
    accountingGroup: row.accounting_group ?? null,
    description: row.description ?? null,
  };
}

export async function listCategories(bizId) {
  const { data, error } = await supabase
    .from("categories")
    .select(CATEGORY_SELECT)
    .eq("business_id", bizId)
    .order("sort");
  throwIf(error, "listCategories");
  return (data || []).map(mapCategoryFromDb);
}

export async function addCategory(bizId, c) {
  const { data, error } = await supabase
    .from("categories")
    .insert({
      business_id: bizId,
      name: c.name,
      type: c.type,
      icon: c.icon || null,
      color: c.color || null,
      sort: c.sort ?? 0,
      role: c.role ?? null,
      accounting_group: c.accounting_group ?? c.accountingGroup ?? null,
      description: c.description ?? null,
    })
    .select(CATEGORY_SELECT)
    .single();
  throwIf(error, "addCategory");
  return mapCategoryFromDb(data);
}

export async function toggleCategory(id, active) {
  const { data, error } = await supabase
    .from("categories")
    .update({ active })
    .eq("id", id)
    .select(CATEGORY_SELECT)
    .single();
  throwIf(error, "toggleCategory");
  return mapCategoryFromDb(data);
}

export async function deleteCategory(id) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  throwIf(error, "deleteCategory");
  return true;
}

// ── DRAFTS (hasil AI voice / scan nota) ──────────────────────────────────────

export async function addDraft(bizId, d) {
  const user = await getUser();
  const { data, error } = await supabase
    .from("transaction_drafts")
    .insert({
      business_id: bizId,
      type: d.type || null,
      category: d.category || null,
      amount: d.amount != null ? Math.round(Number(d.amount)) : null,
      description: d.description || d.desc || null,
      occurred_at: d.occurred_at || d.date || null,
      source: d.source || "voice",
      raw: d.raw || d,
      created_by: user?.id || null,
    })
    .select()
    .single();
  throwIf(error, "addDraft");
  return data;
}

// Terima draft → buat transaksi nyata, tandai draft accepted.
export async function acceptDraft(bizId, draft) {
  // cari kategori yang cocok dengan nama di draft
  let categoryId = draft.category_id || null;
  if (!categoryId && draft.category) {
    const { data: cat } = await supabase
      .from("categories")
      .select("id")
      .eq("business_id", bizId)
      .eq("type", draft.type)
      .ilike("name", draft.category)
      .maybeSingle();
    categoryId = cat?.id || null;
  }

  const tx = await addTransaction(bizId, {
    wallet_id: draft.wallet_id || null,
    category_id: categoryId,
    type: draft.type,
    amount: draft.amount,
    description: draft.description,
    occurred_at: draft.occurred_at,
    source: draft.source || "voice",
  });

  const { error } = await supabase
    .from("transaction_drafts")
    .update({ status: "accepted" })
    .eq("id", draft.id);
  throwIf(error, "acceptDraft");
  return tx;
}

export async function dismissDraft(id) {
  const { error } = await supabase
    .from("transaction_drafts")
    .update({ status: "dismissed" })
    .eq("id", id);
  throwIf(error, "dismissDraft");
  return true;
}

// ── STAF / INVITE ────────────────────────────────────────────────────────────

async function authFetch(path, { method = "GET", body } = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess?.session?.access_token;
  if (!accessToken) throw new Error("Sesi login habis. Silakan login ulang.");
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request gagal (${res.status})`);
  return json;
}

/** Saldo rekening Sam mirror (via API — staf NF tanpa membership FNB tetap bisa baca). */
export async function fetchSharedBankBalances(bizId) {
  if (!bizId) return { balances: {} };
  return authFetch(`/api/shared-bank?businessId=${encodeURIComponent(bizId)}`);
}

/** Riwayat transaksi dompet shared (disimpan di FNB, dibaca via API). */
export async function fetchSharedBankTransactions(bizId, { sharedWalletId, limit = 100 } = {}) {
  if (!bizId) return { transactionsByWallet: {}, transactions: [] };
  const params = new URLSearchParams({
    businessId: bizId,
    action: "transactions",
    limit: String(limit),
  });
  if (sharedWalletId) params.set("sharedWalletId", sharedWalletId);
  const json = await authFetch(`/api/shared-bank?${params.toString()}`);
  return json;
}

/** Catat transaksi ke rekening bersama → ditulis ke bisnis sumber (FNB). */
export async function postSharedBankTx(payload) {
  return authFetch("/api/shared-bank", { method: "POST", body: payload });
}

export async function inviteStaff(bizId, { email, role, outlet, businessName }) {
  if (!bizId) throw new Error("Bisnis belum dipilih. Buka dashboard dulu.");

  const json = await authFetch("/api/invite", {
    method: "POST",
    body: {
      businessId: bizId,
      email: email || null,
      role: role || "kasir",
      outlet: outlet || null,
      businessName,
    },
  });

  return { ...json.invite, inviteUrl: json.inviteUrl };
}

// ── WEB PAIRING (HP → PC) ─────────────────────────────────────────────────────

export async function createPairCode(bizId, userId) {
  const res = await fetch("/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, businessId: bizId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Gagal membuat kode pairing");
  return json; // { code, sessionId }
}

export async function pollPairApproved(code) {
  const res = await fetch("/api/pair", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const json = await res.json();
  return json.approved === true;
}
