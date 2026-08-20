// lib/transactionNormalize.js — normalisasi field transaksi (camelCase + snake_case)

export const TRANSFER_RETRY_DEDUPE_WINDOW_MS = 60_000;

export function resolveWalletId(t) {
  if (!t) return null;
  return t.walletId || t.wallet_id || null;
}

export function resolveTransferIds(t) {
  return {
    from: t.fromWalletId || t.from_wallet_id || null,
    to: t.toWalletId || t.to_wallet_id || null,
  };
}

export function normalizeTransaction(t) {
  if (!t || typeof t !== "object") return t;
  const { from, to } = resolveTransferIds(t);
  return {
    ...t,
    walletId: resolveWalletId(t),
    categoryId: t.categoryId || t.category_id,
    fromWalletId: from,
    toWalletId: to,
  };
}

function normKey(v) {
  return String(v ?? "").trim().toLowerCase();
}

function transferActorKey(t) {
  return normKey(
    t?.meta?.createdById
    || t?.createdBy
    || t?.created_by
    || t?.meta?.createdByEmail
    || t?.createdByEmail
    || ""
  );
}

function transferActionKey(t) {
  const actionId = normKey(
    t?.meta?.transferActionId
    || t?.transferActionId
    || t?.meta?.idempotencyKey
    || t?.idempotencyKey
    || ""
  );
  if (!actionId) return null;
  const actor = transferActorKey(t);
  return `${actor || "anon"}|${actionId}`;
}

function transferEventTimeMs(t) {
  const explicit = t?.createdAt || t?.created_at || t?.occurredAt || t?.occurred_at || t?.timestamp || null;
  if (explicit) {
    const ms = new Date(explicit).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  const match = /^t(\d{13})/.exec(String(t?.id || ""));
  return match ? Number(match[1]) : NaN;
}

function transferRetryFingerprint(t) {
  if (t?.type !== "transfer") return null;
  const actor = transferActorKey(t);
  const { from, to } = resolveTransferIds(t);
  const amount = Math.round(Number(t?.amount) || 0);
  if (!actor || !from || !to || !(amount > 0)) return null;
  const date = normKey(t?.date || t?.occurred_at || t?.occurredAt || "");
  const desc = normKey(t?.desc || t?.description || "");
  const source = normKey(t?.source || "");
  return [actor, normKey(from), normKey(to), amount, date, desc, source].join("|");
}

/**
 * Dedupe retry transfer dengan dua lapis proteksi:
 * 1) transferActionId/idempotencyKey yang sama => selalu satu transaksi.
 * 2) fallback untuk client lama: actor + asal + tujuan + nominal + tanggal + desc/source sama,
 *    dan timestamp id hanya terpaut <= 60 detik => dianggap retry dari aksi yang sama.
 *
 * Sengaja tidak mendedupe transfer legacy tanpa identitas pembuat atau timestamp yang jelas,
 * agar dua transfer sungguhan tidak terhapus karena tebakan.
 */
export function dedupeTransferRetries(transactions, { windowMs = TRANSFER_RETRY_DEDUPE_WINDOW_MS } = {}) {
  const out = [];
  const byAction = new Map();
  const byFingerprint = new Map();

  for (const tx of transactions || []) {
    if (!tx || tx.type !== "transfer") {
      out.push(tx);
      continue;
    }

    const actionKey = transferActionKey(tx);
    if (actionKey) {
      if (byAction.has(actionKey)) continue;
      byAction.set(actionKey, out.length);
    }

    const fingerprint = transferRetryFingerprint(tx);
    const eventMs = transferEventTimeMs(tx);
    if (fingerprint && Number.isFinite(eventMs)) {
      const prev = byFingerprint.get(fingerprint);
      if (prev && Math.abs(eventMs - prev.eventMs) <= Math.max(0, Number(windowMs) || 0)) {
        // Simpan transaksi yang lebih awal sebagai sumber kebenaran/original action.
        if (eventMs < prev.eventMs) {
          out[prev.index] = tx;
          byFingerprint.set(fingerprint, { index: prev.index, eventMs });
          if (actionKey) byAction.set(actionKey, prev.index);
        }
        continue;
      }
      byFingerprint.set(fingerprint, { index: out.length, eventMs });
    }

    out.push(tx);
  }

  return out;
}

export function normalizeTransactions(transactions) {
  return dedupeTransferRetries((transactions || []).map(normalizeTransaction));
}
