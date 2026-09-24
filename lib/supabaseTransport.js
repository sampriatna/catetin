// Keep browser HTTP traffic on the app origin. The server rewrite forwards it
// to the configured Supabase project with the caller's original credentials.
//
// app_state used to contain every transaction in one JSONB document. For the
// main F&B business that grew past 6 MB, so every tiny save rewrote 10k+ txs.
// The transport keeps the app API backward-compatible while persisting txs in
// app_transactions and sending only changed tx rows on save.

const txSnapshots = new Map();

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
      const error = new Error(`[app_transactions] load ${response.status}: ${message}`);
      error.status = response.status;
      throw error;
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
    const existingTransactions = row.data.transactions;
    // A client still running the pre-split bundle writes the full array back into
    // app_state. That array only holds what that stale client knew about, and it
    // keeps the old _txVersion. The DB trigger mirrors it into app_transactions,
    // so app_transactions stays the superset: always reload from there.
    const legacyEmbedded = Array.isArray(existingTransactions);

    let snapshot = txSnapshots.get(businessId);
    const cacheMatches = !legacyEmbedded && snapshot && (
      (txVersion != null && snapshot.txVersion === txVersion) ||
      (txVersion == null && snapshot.updatedAt === (row.updated_at || null))
    );

    if (!cacheMatches) {
      let transactions;
      try {
        transactions = await fetchSplitTransactions(origin, headers, businessId);
      } catch (error) {
        // Split tables not deployed yet: the embedded array is the only copy.
        if (legacyEmbedded && error?.status === 404) {
          txSnapshots.set(
            businessId,
            makeSnapshot(existingTransactions, row.updated_at || null, txVersion)
          );
          return response;
        }
        throw error;
      }
      snapshot = makeSnapshot(transactions, row.updated_at || null, txVersion);
      snapshot.legacyEmbedded = legacyEmbedded;
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
      const baseline = await fetchSplitTransactions(origin, headers, businessId);
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
    // After a legacy full-array write the old _txVersion no longer describes
    // app_transactions; bump it so other devices drop their cached snapshot.
    if (txChanged || snapshot.legacyEmbedded) {
      coreData._txVersion = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    } else if (!coreData._txVersion) {
      coreData._txVersion = snapshot.txVersion || "split-v1";
    }

    const rpcResponse = await rpc(origin, "save_app_state_v2", headers, {
      p_business_id: businessId,
      p_expected_updated_at: expectedUpdatedAt,
      p_data: coreData,
      p_tx_upserts: upserts,
      p_tx_delete_ids: deleteIds,
    });

    // RPC not deployed on this project yet: fall back to the plain PATCH.
    if (rpcResponse.status === 404) return null;
    if (!rpcResponse.ok) return rpcResponse;

    let result = await rpcResponse.clone().json().catch(() => null);
    if (Array.isArray(result)) result = result[0] ?? null;
    if (result && typeof result === "object") {
      result = result.save_app_state_v2 ?? result.updated_at ?? null;
    }

    // null = CAS conflict. Mimic PostgREST UPDATE ... RETURNING with zero rows so
    // appState.js performs its existing retry/merge path.
    if (!result) return syntheticJsonResponse([], rpcResponse);

    txSnapshots.set(businessId, {
      byId: nextById,
      signatures: nextSignatures,
      updatedAt: result,
      txVersion: coreData._txVersion,
    });

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
