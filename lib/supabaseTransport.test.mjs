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
