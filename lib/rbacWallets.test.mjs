// node --test lib/rbacWallets.test.mjs — dompet yang tampil untuk akun purchasing (Nusa Food)
import test from "node:test";
import assert from "node:assert/strict";
import { visibleWallets } from "./rbac.js";

const DODI = "u-dodi";
const MAHMUD = "u-mahmud";
const ABDUL = "u-abdul";

const wallets = [
  { id: "w_kas_besar", name: "Kas Besar", type: "kas_fisik" },
  { id: "w_laci_kbu", name: "Laci KBU", type: "kas_fisik", outlet: "KBU" },
  { id: "w_kas_kecil", name: "Kas Kecil Dodi", type: "kas_fisik", purchasingUse: true, allowedUserIds: [DODI] },
  { id: "w_kas_kecil_mahmud", name: "Kas Kecil Mahmud", type: "kas_fisik", purchasingUse: true, allowedUserIds: [MAHMUD] },
  { id: "w_shopee_paylater", name: "Shopee PayLater", type: "paylater", purchasingUse: true },
  { id: "w_bca", name: "BCA", type: "rekening", purchasingUse: true },
  { id: "w_owner", name: "Bank BJB", type: "rekening" },
  { id: "w_gojek", name: "Saldo Gojek", type: "ewallet", purchasingUse: true },
];

const ids = (user) => visibleWallets(wallets, user).map((w) => w.id).sort();

test("purchasing dengan dompet sendiri: lihat kas kecilnya + dompet belanja bersama, bukan kas kecil orang lain", () => {
  assert.deepEqual(ids({ id: DODI, role: "purchasing", outlet: null }), ["w_bca", "w_gojek", "w_kas_kecil", "w_shopee_paylater"]);
  assert.deepEqual(ids({ id: MAHMUD, role: "purchasing", outlet: null }), ["w_bca", "w_gojek", "w_kas_kecil_mahmud", "w_shopee_paylater"]);
});

test("purchasing dengan assignment tidak melihat Kas Besar, laci, atau rekening owner", () => {
  const v = ids({ id: MAHMUD, role: "purchasing", outlet: null });
  for (const x of ["w_kas_besar", "w_laci_kbu", "w_owner"]) assert.ok(!v.includes(x), x);
});

test("purchasing tanpa assignment tidak melihat kas kecil yang dikunci ke orang lain", () => {
  assert.deepEqual(ids({ id: ABDUL, role: "purchasing", outlet: null }), ["w_bca", "w_gojek", "w_shopee_paylater"]);
});

test("owner tetap melihat semua dompet", () => {
  assert.equal(ids({ id: "owner", role: "owner" }).length, wallets.length);
});
