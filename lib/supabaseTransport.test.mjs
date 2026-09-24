import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseFetch } from "./supabaseTransport.js";

const project = "https://project.supabase.co";
const app = "https://catatin.example.com";
function harness(origin = app) {
  const calls = [];
  const response = new Response('{"ok":true}');
  const transport = createSupabaseFetch(project, {
    getOrigin: () => origin,
    fetchImpl: async (...args) => { calls.push(args); return response; },
  });
  return { transport, calls, response };
}

test("password login keeps body, headers and abort signal on same origin", async () => {
  const h = harness();
  const init = { method: "POST", headers: { apikey: "public-key" },
    body: JSON.stringify({ email: "test@example.com", password: "test-only" }),
    signal: new AbortController().signal };
  const result = await h.transport(`${project}/auth/v1/token?grant_type=password`, init);
  assert.equal(h.calls[0][0], `${app}/api/supabase/auth/v1/token?grant_type=password`);
  assert.equal(h.calls[0][1], init);
  assert.equal(result, h.response);
});

test("refresh tokens, memberships and storage use the same proxy", async () => {
  const h = harness();
  for (const path of ["/auth/v1/token?grant_type=refresh_token", "/rest/v1/business_members?select=role", "/storage/v1/object/receipts/a.jpg"]) {
    await h.transport(`${project}${path}`);
    assert.equal(h.calls.at(-1)[0], `${app}/api/supabase${path}`);
  }
});

test("server calls and unrelated origins remain unchanged", async () => {
  const server = harness(null);
  await server.transport(`${project}/auth/v1/user`);
  assert.equal(server.calls[0][0], `${project}/auth/v1/user`);
  const browser = harness();
  await browser.transport("https://other.example/auth/v1/user");
  assert.equal(browser.calls[0][0], "https://other.example/auth/v1/user");
});

test("Request inputs retain method and body", async () => {
  const h = harness();
  await h.transport(new Request(`${project}/rest/v1/rpc/claim_pending_invites`, {
    method: "POST", headers: { authorization: "Bearer test-token" }, body: "{}",
  }));
  const request = h.calls[0][0];
  assert.equal(request.url, `${app}/api/supabase/rest/v1/rpc/claim_pending_invites`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), "Bearer test-token");
  assert.equal(await request.text(), "{}");
});

test("failures are not retried or converted into success", async () => {
  let calls = 0;
  const transport = createSupabaseFetch(project, { getOrigin: () => app,
    fetchImpl: async () => { calls++; throw new TypeError("Load failed"); } });
  await assert.rejects(transport(`${project}/auth/v1/token`), /Load failed/);
  assert.equal(calls, 1);
});

test("rewrites target only the configured project and supported services", async () => {
  const old = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = project;
    const { default: config } = await import("../next.config.js");
    const rules = await config.rewrites();
    assert.equal(rules.length, 3);
    for (const service of ["auth", "rest", "storage"]) {
      assert.deepEqual(rules.find(r => r.source.includes(`/${service}/`)), {
        source: `/api/supabase/${service}/v1/:path*`,
        destination: `${project}/${service}/v1/:path*`,
      });
    }
  } finally {
    if (old === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = old;
  }
});

// ── app_state split (app_transactions) ────────────────────────────────────
function splitHarness({ appStateRows, splitTxs, rpcStatus = {} }) {
  const calls = [];
  const state = { splitTxs: [...splitTxs] };
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push({ path: url.pathname, method: init.method || "GET", body: init.body });
    const name = url.pathname.split("/rpc/")[1];
    if (name && rpcStatus[name]) return new Response("{}", { status: rpcStatus[name] });
    if (name === "get_app_transactions") return Response.json(state.splitTxs);
    if (name === "save_app_state_v2") return Response.json("2026-09-24T10:00:01+00:00");
    if (url.pathname.endsWith("/app_state")) {
      if ((init.method || "GET") === "GET") return Response.json(appStateRows());
      return Response.json([{ updated_at: "2026-09-24T10:00:02+00:00" }]);
    }
    throw new Error(`unexpected ${url.pathname}`);
  };
  const transport = createSupabaseFetch(project, { getOrigin: () => app, fetchImpl });
  const get = async (biz) => (await transport(
    `${project}/rest/v1/app_state?select=data%2Cupdated_at&business_id=eq.${biz}`
  )).json();
  const patch = (biz, expected, data) => transport(
    `${project}/rest/v1/app_state?business_id=eq.${biz}&updated_at=eq.${expected}&select=updated_at`,
    { method: "PATCH", headers: { authorization: "Bearer t" }, body: JSON.stringify({ data }) }
  );
  return { transport, calls, state, get, patch };
}

test("legacy embedded transactions never hide rows that only exist in app_transactions", async () => {
  // A stale pre-split client wrote back only the txs it knew about, keeping the old _txVersion.
  const h = splitHarness({
    appStateRows: () => [{ updated_at: "t2", data: { _txVersion: "v1", transactions: [{ id: "a" }] } }],
    splitTxs: [{ id: "a" }, { id: "b" }],
  });
  const [row] = await h.get("biz-legacy");
  assert.deepEqual(row.data.transactions.map((t) => t.id).sort(), ["a", "b"]);
});

test("save after a legacy write bumps _txVersion so other devices refetch", async () => {
  const h = splitHarness({
    appStateRows: () => [{ updated_at: "t2", data: { _txVersion: "v1", transactions: [{ id: "a" }] } }],
    splitTxs: [{ id: "a" }],
  });
  await h.get("biz-bump");
  await h.patch("biz-bump", "t2", { _txVersion: "v1", transactions: [{ id: "a" }] });
  const save = h.calls.find((c) => c.path.endsWith("/rpc/save_app_state_v2"));
  const body = JSON.parse(save.body);
  assert.notEqual(body.p_data._txVersion, "v1");
  assert.equal(body.p_data.transactions, undefined);
  assert.deepEqual(body.p_tx_upserts, []);
});

test("unchanged split snapshot is reused and only changed txs are sent", async () => {
  const h = splitHarness({
    appStateRows: () => [{ updated_at: "t1", data: { _txVersion: "v9" } }],
    splitTxs: [{ id: "a", amount: 1 }, { id: "b", amount: 2 }],
  });
  await h.get("biz-fast");
  await h.get("biz-fast");
  assert.equal(h.calls.filter((c) => c.path.endsWith("/rpc/get_app_transactions")).length, 1);
  await h.patch("biz-fast", "t1", {
    _txVersion: "v9",
    transactions: [{ id: "a", amount: 1 }, { id: "b", amount: 5 }],
  });
  const body = JSON.parse(h.calls.find((c) => c.path.endsWith("/rpc/save_app_state_v2")).body);
  assert.deepEqual(body.p_tx_upserts, [{ id: "b", amount: 5 }]);
  assert.notEqual(body.p_data._txVersion, "v9");
});

test("missing save RPC falls back to the plain app_state PATCH instead of failing the save", async () => {
  const h = splitHarness({
    appStateRows: () => [{ updated_at: "t1", data: { transactions: [{ id: "a" }] } }],
    splitTxs: [],
    rpcStatus: { get_app_transactions: 404, save_app_state_v2: 404 },
  });
  const [row] = await h.get("biz-old");
  assert.deepEqual(row.data.transactions, [{ id: "a" }]);
  const res = await h.patch("biz-old", "t1", { transactions: [{ id: "a" }, { id: "b" }] });
  assert.equal(res.ok, true);
  const plain = h.calls.find((c) => c.path.endsWith("/app_state") && c.method === "PATCH");
  assert.deepEqual(JSON.parse(plain.body).data.transactions.map((t) => t.id), ["a", "b"]);
});

test("split load failure is surfaced, never replaced with an empty transaction list", async () => {
  const h = splitHarness({
    appStateRows: () => [{ updated_at: "t1", data: { _txVersion: "v1" } }],
    splitTxs: [],
    rpcStatus: { get_app_transactions: 500 },
  });
  await assert.rejects(h.get("biz-down"), /app_transactions/);
});
