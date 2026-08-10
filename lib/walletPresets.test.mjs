import test from "node:test";
import assert from "node:assert/strict";
import {
  getPresetWalletsForType,
  resolveWalletMergeMode,
  NF_FISHING_WALLETS,
  FISHING_EKSPEDISI_WALLET_ID,
  ensureNfFishingWallets,
} from "./walletPresets.js";
import { CANONICAL_BUSINESS_ID } from "./canonicalBusiness.js";

test("ecommerce preset has 3 wallets not full F&B", () => {
  const w = getPresetWalletsForType("ecommerce");
  assert.equal(w.length, 3);
  assert.ok(!w.some((x) => x.id === "w_laci_kbu"));
});

test("saved-only mode for initialized onboarding", () => {
  assert.equal(
    resolveWalletMergeMode("other-biz-id", { walletSetup: { initialized: true } }),
    "saved-only"
  );
});

test("canonical legacy uses full merge when not initialized", () => {
  assert.equal(resolveWalletMergeMode(CANONICAL_BUSINESS_ID, {}), "canonical");
});

test("NF Fishing preset includes Dompet Ekspedisi", () => {
  assert.ok(NF_FISHING_WALLETS.some((w) => w.id === FISHING_EKSPEDISI_WALLET_ID));
  assert.equal(
    ensureNfFishingWallets([{ id: "w_custom", name: "Custom" }]).some((w) => w.id === FISHING_EKSPEDISI_WALLET_ID),
    true
  );
});
