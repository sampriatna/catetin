import test from "node:test";
import assert from "node:assert/strict";
import { checkPurchasingFloor } from "./purchasingExpense.js";

test("checkPurchasingFloor: rekening shared tidak diblok di klien (meski opening 0)", () => {
  const wallets = [
    {
      id: "shared_sh_nf_bca",
      name: "BCA (Sam · NF)",
      type: "shared",
      opening: 0,
      floor: 0,
      hide_balance: true,
      sharedLink: { linkKind: "rekening" },
    },
  ];
  const user = { role: "purchasing", id: "u-dian" };
  assert.equal(
    checkPurchasingFloor("shared_sh_nf_bca", 4790000, wallets, [], user),
    null
  );
});

test("checkPurchasingFloor: kas kecil lokal tetap dicek", () => {
  const wallets = [{ id: "w_kas_kecil", name: "Kas Kecil", opening: 100000, floor: 0 }];
  const user = { role: "purchasing" };
  const err = checkPurchasingFloor("w_kas_kecil", 200000, wallets, [], user);
  assert.match(err, /Saldo tidak cukup/);
});
