import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

// Execute the real repository functions with controlled network responses.
const repo = readFileSync(new URL("./repo.js", import.meta.url), "utf8");
const claimCode = repo.slice(repo.indexOf("export async function claimPendingInvites()"),
  repo.indexOf("/** Undangan aktif" )).replace("export async", "async");
const timeoutCode = readFileSync(new URL("./supabaseSession.js", import.meta.url), "utf8")
  .split("export function withTimeout")[1];

function harness({ fetch, rpcResult = { data: [], error: null }, token = true, timeout = 10000 }) {
  let rpcCalls = 0;
  let signal;
  const context = vm.createContext({
    AbortController, fetch, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, timeout)), clearTimeout,
    authFetchHeaders: () => token ? { Authorization: "Bearer test" } : null,
    throwIf: (error, label) => { if (error) throw new Error(`[${label}] ${error.message}`); },
    supabase: { rpc: () => {
      rpcCalls++;
      return { abortSignal: (s) => { signal = s; return Promise.resolve(rpcResult); } };
    } },
  });
  vm.runInContext(`function withTimeout${timeoutCode}\n${claimCode}`, context);
  return { claim: () => context.claimPendingInvites(), calls: () => rpcCalls, signal: () => signal };
}

test("successful empty API result does not trigger failing RPC", async () => {
  const h = harness({ fetch: async () => ({ ok: true, json: async () => ({ members: [] }) }),
    rpcResult: { error: { message: "TypeError: Failed to fetch" } } });
  assert.equal((await h.claim()).length, 0);
  assert.equal(h.calls(), 0);
});

test("successful claim returns memberships without duplicate RPC", async () => {
  const members = [{ business_id: "business-1" }];
  const h = harness({ fetch: async () => ({ ok: true, json: async () => ({ members }) }) });
  assert.deepEqual(await h.claim(), members);
  assert.equal(h.calls(), 0);
});

test("API network failure retains RPC compatibility fallback", async () => {
  const members = [{ business_id: "business-2" }];
  const h = harness({ fetch: async () => { throw new TypeError("Failed to fetch"); },
    rpcResult: { data: members } });
  assert.deepEqual(await h.claim(), members);
  assert.equal(h.calls(), 1);
});

test("failed claim remains an error rather than false no-invitation success", async () => {
  const h = harness({ fetch: async () => ({ ok: false, json: async () => ({}) }),
    rpcResult: { error: { message: "TypeError: Failed to fetch" } } });
  await assert.rejects(h.claim(), /Failed to fetch/);
});

test("hung request times out and aborts network activity", async () => {
  let signal;
  const h = harness({ timeout: 20, fetch: (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(h.claim(), /timeout/);
  assert.equal(signal.aborted, true);
  assert.equal(h.calls(), 0);
});

test("missing legacy RPC is compatible with installations without invitations", async () => {
  const h = harness({ token: false, rpcResult: { error: { message: "could not find function" } } });
  assert.equal((await h.claim()).length, 0);
});
