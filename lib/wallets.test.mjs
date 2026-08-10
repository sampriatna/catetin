import test from "node:test";
import assert from "node:assert/strict";
import { mergeWalletsPreferLocal, patchWalletCatalog, LACI_PLAFOND, isLockedLaciWallet } from "./wallets.js";

test("mergeWalletsPreferLocal keeps local wallet name and logo", () => {
  const remote = [{ id: "w_kbu", name: "Laci KBU", color: "#C47D0E", logoUrl: null }];
  const local = [{
    id: "w_kbu",
    name: "Laci Utama KBU",
    color: "#C47D0E",
    logoUrl: "data:image/webp;base64,abc123",
  }];
  const merged = mergeWalletsPreferLocal(remote, local);
  const w = merged.find((x) => x.id === "w_kbu");
  assert.equal(w.name, "Laci Utama KBU");
  assert.equal(w.logoUrl, "data:image/webp;base64,abc123");
});

test("patchWalletCatalog does not reset custom Shopee Food name", () => {
  const wallets = patchWalletCatalog([
    { id: "w_pm", name: "ShopeePay Merchant", color: "#111", type: "digital", sort: 50 },
  ]);
  const w = wallets.find((x) => x.id === "w_pm");
  assert.equal(w.name, "ShopeePay Merchant");
});

test("patchWalletCatalog still migrates legacy Payment Method name", () => {
  const wallets = patchWalletCatalog([
    { id: "w_pm", name: "Payment Method", color: "#111", sort: 50 },
  ]);
  const w = wallets.find((x) => x.id === "w_pm");
  assert.equal(w.name, "Shopee Food");
});

test("patchWalletCatalog migrates Dompet PM and Dompet NF", () => {
  const wallets = patchWalletCatalog([
    { id: "w_pm", name: "Dompet PM", color: "#14B8A6", sort: 50 },
    { id: "w_nf", name: "Dompet NF", color: "#F97316", sort: 51 },
  ]);
  assert.equal(wallets.find((x) => x.id === "w_pm").name, "Shopee Food");
  assert.equal(wallets.find((x) => x.id === "w_nf").name, "Grab Food");
});

test("patchWalletCatalog does not inject Go Food into NF Fishing wallets", () => {
  const wallets = patchWalletCatalog([
    { id: "w_fish_uang_nf", name: "Uang NF", type: "kas_fisik", sort: 4 },
    { id: "w_fish_marketplace", name: "Marketplace", type: "ewallet", sort: 10 },
  ]);
  assert.ok(!wallets.some((w) => w.id === "w_gofood"));
  assert.equal(wallets.length, 2);
});

test("patchWalletCatalog locks KBU/KSM/SMT plafond to 250000", () => {
  const wallets = patchWalletCatalog([
    { id: "w_laci_kbu", name: "Laci KBU", type: "kas_fisik", outlet: "KBU", floor: 100000, sort: 10 },
    { id: "w_laci_ksm", name: "Laci Kisamen", type: "kas_fisik", outlet: "KSM", floor: 300000, sort: 20 },
    { id: "w_laci_smt", name: "Laci Santoso", type: "kas_fisik", outlet: "SMT", floor: 290000, sort: 30 },
    { id: "w_kas_besar", name: "Kas Besar", type: "kas_fisik", floor: 0, sort: 40 },
  ]);
  assert.equal(wallets.find((w) => w.id === "w_laci_kbu").floor, LACI_PLAFOND);
  assert.equal(wallets.find((w) => w.id === "w_laci_ksm").floor, LACI_PLAFOND);
  assert.equal(wallets.find((w) => w.id === "w_laci_smt").floor, LACI_PLAFOND);
  assert.equal(wallets.find((w) => w.id === "w_kas_besar").floor, 0);
  assert.equal(isLockedLaciWallet({ id: "w_laci_smt", outlet: "SMT" }), true);
});
