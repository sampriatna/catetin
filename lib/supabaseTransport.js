// Keep browser HTTP traffic on the app origin. The server rewrite forwards it
// to the configured Supabase project with the caller's original credentials.
//
// app_state used to contain every transaction in one JSONB document. For the
// main F&B business that grew past 6 MB, so every tiny save rewrote 10k+ txs.
// The transport keeps the app API backward-compatible while persisting txs in
// app_transactions and sending only changed tx rows + changed top-level state.

const txSnapshots = new Map();
const coreSnapshots = new Map();
const TX_CACHE_DB = "nf3-fast-cache-v1";
const TX_CACHE_STORE = "txSnapshots";

function filterValue(searchParams, key) {
  const raw = searchParams.get(key);
  if (!raw) return null;
  return raw.startsWith("eq.") ? raw.slice(3) : raw;
}

function requestHeaders(input, init) {
  const headers = new Headers();
  if (typeof Request !== "undefined" && input instanceof Request) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  headers.delete("content-length");
  return headers;
}

async function requestBodyText(input, init) {
  if (typeof init?.body === "string") return init.body;
  if (init?.body != null) return String(init.body);
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.clone().text();
  }
  return "";
}

function makeSnapshot(transactions = [], updatedAt = null, txVersion = null) {
  const byId = new Map();
  const signatures = new Map();
  for (const tx of transactions || []) {
    if (!tx?.id) continue;
    byId.set(String(tx.id), tx);
    signatures.set(String(tx.id), JSON.stringify(tx));
  }
  return { byId, signatures, updatedAt, txVersion };
}

function snapshotTransactions(snapshot) {
  return snapshot ? [...snapshot.byId.values()] : [];
}

function makeCoreSnapshot(data = {}, updatedAt = null) {
  const signatures = new Map();
  for (const [key, value] of Object.entries(data || {})) {
    if (key === "transactions") continue;
    signatures.set(key, JSON.stringify(value));
  }
  return { signatures, updatedAt };
}

function corePatchAgainst(snapshot, coreData) {
  if (!snapshot) {
    return { patch: coreData, removeKeys: [] };
  }
  const patch = {};
  const nextKeys = new Set(Object.keys(coreData || {}));
  for (const [key, value] of Object.entries(coreData || {})) {
    if (snapshot.signatures.get(key) !== JSON.stringify(value)) patch[key] = value;
  }
  const removeKeys = [];
  for (const key of snapshot.signatures.keys()) {
    if (!nextKeys.has(key)) removeKeys.push(key);
  }
  return { patch, removeKeys };
}

function openTxCacheDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(TX_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TX_CACHE_STORE)) {
          db.createObjectStore(TX_CACHE_STORE, { keyPath: "businessId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readPersistentTxSnapshot(businessId, txVersion) {
  if (!businessId || !txVersion) return null;
  const db = await openTxCacheDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(TX_CACHE_STORE, "readonly");
      const req = tx.objectStore(TX_CACHE_STORE).get(businessId);
      req.onsuccess = () => {
        const row = req.result;
        resolve(row?.txVersion === txVersion && Array.isArray(row?.transactions)
          ? row.transactions
          : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writePersistentTxSnapshot(businessId, txVersion, transactions) {
  if (!businessId || !txVersion || !Array.isArray(transactions)) return;
  openTxCacheDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(TX_CACHE_STORE, "readwrite");
      tx.objectStore(TX_CACHE_STORE).put({
        businessId,
        txVersion,
        transactions,
        savedAt: Date.now(),
      });
    } catch {
      // Cache is best effort only.
    }
  }).catch(() => {});
}

function syntheticJsonResponse(body, sourceResponse = null) {
  const headers = new Headers(sourceResponse?.headers || undefined);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(JSON.stringify(body), {
    status: sourceResponse?.status || 200,
    statusText: sourceResponse?.statusText || "OK",
    headers,
  });
}

export function createSupabaseFetch(projectUrl, {
  getOrigin = () => typeof window === "undefined" ? null : window.location.origin,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const project = new URL(projectUrl);

  async function rpc(origin, name, headers, body) {
    const rpcHeaders = new Headers(headers);
    rpcHeaders.set("content-type", "application/json");
    rpcHeaders.set("accept", "application/json");
    rpcHeaders.delete("content-length");
    return fetchImpl(`${origin}/api/supabase/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: rpcHeaders,
      body: JSON.stringify(body),
    });
  }

  async function fetchSplitTransactions(origin, headers, businessId) {
    const response = await rpc(origin, "get_app_transactions", headers, {
      p_business_id: businessId,
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`[app_transactions] load ${response.status}: ${message}`);
    }
    const json = await response.json();
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.get_app_transactions)) return json.get_app_transactions;
    return [];
  }

  async function hydrateAppStateResponse(response, origin, headers, url) {
    if (!response.ok || !url.searchParams.get("select")?.includes("data")) return response;

    const businessId = filterValue(url.searchParams, "business_id");
    if (!businessId) return response;

    let json;
    try {
      json = await response.clone().json();
    } catch {
      return response;
    }

    const row = Array.isArray(json) ? json[0] : json;
    if (!row?.data || typeof row.data !== "object") return response;

    const txVersion = row.data._txVersion ?? null;
    coreSnapshots.set(businessId, makeCoreSnapshot(row.data, row.updated_at || null));

    const existingTransactions = row.data.transactions;
    if (Array.isArray(existingTransactions)) {
      const snapshot = makeSnapshot(existingTransactions, row.updated_at || null, txVersion);
      txSnapshots.set(businessId, snapshot);
      writePersistentTxSnapshot(businessId, txVersion, existingTransactions);
      return response;
    }

    let snapshot = txSnapshots.get(businessId);
    const cacheMatches = snapshot && (
      (txVersion != null && snapshot.txVersion === txVersion) ||
      (txVersion == null && snapshot.updatedAt === (row.updated_at || null))
    );

    if (!cacheMatches) {
      let transactions = await readPersistentTxSnapshot(businessId, txVersion);
      if (!transactions) {
        transactions = await fetchSplitTransactions(origin, headers, businessId);
        writePersistentTxSnapshot(businessId, txVersion, transactions);
      }
      snapshot = makeSnapshot(transactions, row.updated_at || null, txVersion);
      txSnapshots.set(businessId, snapshot);
    } else {
      snapshot.updatedAt = row.updated_at || snapshot.updatedAt;
    }

    row.data.transactions = snapshotTransactions(snapshot);
    return syntheticJsonResponse(json, response);
  }

  async function fastAppStatePatch(input, init, origin, url) {
    const headers = requestHeaders(input, init);
    const businessId = filterValue(url.searchParams, "business_id");
    const expectedUpdatedAt = filterValue(url.searchParams, "updated_at");
    if (!businessId || !expectedUpdatedAt) return null;

    let payload;
    try {
      payload = JSON.parse(await requestBodyText(input, init));
    } catch {
      return null;
    }

    const transactions = payload?.data?.transactions;
    if (!Array.isArray(transactions)) return null;

    let snapshot = txSnapshots.get(businessId);
    if (!snapshot) {
      let baseline = await readPersistentTxSnapshot(
        businessId,
        payload.data?._txVersion ?? null
      );
      if (!baseline) baseline = await fetchSplitTransactions(origin, headers, businessId);
      snapshot = makeSnapshot(
        baseline,
        expectedUpdatedAt,
        payload.data?._txVersion ?? null
      );
      txSnapshots.set(businessId, snapshot);
    }

    const nextSignatures = new Map();
    const upserts = [];
    const nextById = new Map();
    for (const tx of transactions) {
      if (!tx?.id) continue;
      const id = String(tx.id);
      const signature = JSON.stringify(tx);
      nextSignatures.set(id, signature);
      nextById.set(id, tx);
      if (snapshot.signatures.get(id) !== signature) upserts.push(tx);
    }

    const tombstones = Array.isArray(payload.data?.deletedTransactionIds)
      ? payload.data.deletedTransactionIds.map(String)
      : [];
    const deleteIds = tombstones.filter(
      (id) => snapshot.byId.has(id) && !nextById.has(id)
    );

    const coreData = { ...payload.data };
    delete coreData.transactions;

    const txChanged = upserts.length > 0 || deleteIds.length > 0;
    if (txChanged) {
      coreData._txVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } else if (!coreData._txVersion) {
      coreData._txVersion = snapshot.txVersion || "split-v1";
    }

    const coreSnapshot = coreSnapshots.get(businessId);
    const { patch, removeKeys } = corePatchAgainst(coreSnapshot, coreData);

    const rpcResponse = await rpc(origin, "save_app_state_v3", headers, {
      p_business_id: businessId,
      p_expected_updated_at: expectedUpdatedAt,
      p_patch: patch,
      p_remove_keys: removeKeys,
      p_tx_upserts: upserts,
      p_tx_delete_ids: deleteIds,
    });

    if (!rpcResponse.ok) return rpcResponse;

    let result = await rpcResponse.clone().json().catch(() => null);
    if (Array.isArray(result)) result = result[0] ?? null;
    if (result && typeof result === "object") {
      result = result.save_app_state_v3 ?? result.updated_at ?? null;
    }

    // null = CAS conflict. Mimic PostgREST UPDATE ... RETURNING with zero rows so
    // appState.js performs its existing retry/merge path.
    if (!result) return syntheticJsonResponse([], rpcResponse);

    const nextSnapshot = {
      byId: nextById,
      signatures: nextSignatures,
      updatedAt: result,
      txVersion: coreData._txVersion,
    };
    txSnapshots.set(businessId, nextSnapshot);
    coreSnapshots.set(businessId, makeCoreSnapshot(coreData, result));
    if (txChanged) {
      writePersistentTxSnapshot(
        businessId,
        coreData._txVersion,
        snapshotTransactions(nextSnapshot)
      );
    }

    return syntheticJsonResponse([{ updated_at: result }], rpcResponse);
  }

  return async (input, init) => {
    const origin = getOrigin();
    const isRequest = typeof Request !== "undefined" && input instanceof Request;
    const url = new URL(isRequest ? input.url : String(input), project);
    if (!origin || url.origin !== project.origin ||
        !/^\/(auth|rest|storage)\/v1\//.test(url.pathname)) {
      return fetchImpl(input, init);
    }

    const method = String(init?.method || (isRequest ? input.method : "GET")).toUpperCase();
    const headers = requestHeaders(input, init);

    if (url.pathname === "/rest/v1/app_state" && method === "PATCH") {
      const fastResponse = await fastAppStatePatch(input, init, origin, url);
      if (fastResponse) return fastResponse;
    }

    const target = `${origin}/api/supabase${url.pathname}${url.search}`;
    const response = await fetchImpl(isRequest ? new Request(target, input) : target, init);

    if (url.pathname === "/rest/v1/app_state" && method === "GET") {
      return hydrateAppStateResponse(response, origin, headers, url);
    }

    return response;
  };
}
