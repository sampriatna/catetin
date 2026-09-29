// node --test lib/membershipResolve.test.mjs — role efektif dari business_members
import test from "node:test";
import assert from "node:assert/strict";
import { resolveAuthMembership, roleDisplayLabel } from "./membershipResolve.js";

test("akun dapur outlet tetap dapur (bukan kasir)", () => {
  assert.deepEqual(resolveAuthMembership({ role: "dapur", outlet: "KSM", email: "sima@example.com" }), { role: "dapur", outlet: "KSM" });
  assert.equal(roleDisplayLabel({ role: "dapur", outlet: "KSM" }), "Dapur · KSM");
});

test("kasir outlet & pemetaan email lama tidak berubah", () => {
  assert.deepEqual(resolveAuthMembership({ role: "kasir", outlet: "KBU" }), { role: "kasir", outlet: "KBU" });
  assert.deepEqual(resolveAuthMembership({ role: "owner", outlet: "KSM" }), { role: "kasir", outlet: "KSM" });
  assert.deepEqual(resolveAuthMembership({ role: "purchasing", outlet: null, email: "abdulkhafid0910@gmail.com" }), { role: "purchasing", outlet: "Jagasatru" });
});
