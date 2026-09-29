import test from "node:test";
import assert from "node:assert/strict";
import { notifTransfer, notifSo, tandaiAksiSendiri } from "./liveNotif.js";

const owner = { id: "o", role: "owner" };
const mahmud = { id: "m", role: "purchasing", outlet: null };
const abdul = { id: "a", role: "purchasing", outlet: "Jagasatru" };
const kasirKbu = { id: "k", role: "kasir", outlet: "KBU" };
const dapurKbu = { id: "d", role: "dapur", outlet: "KBU" };
const dapurKsm = { id: "s", role: "dapur", outlet: "KSM" };
const t = (x) => ({ id: "t1", dari: "GDG", ke: "KBU", area: "bar", diminta_by: "k", diminta_by_name: "Kasir KBU", ...x });

test("permintaan baru → gudang/purchasing/owner, bukan peminta & bukan outlet lain", () => {
  const r = t({ status: "diminta" });
  assert.match(notifTransfer(r, mahmud).title, /Permintaan baru dari KBU · Bar/);
  assert.ok(notifTransfer(r, owner));
  assert.equal(notifTransfer(r, kasirKbu), null);
  assert.equal(notifTransfer(r, dapurKsm), null);
  assert.equal(notifTransfer(r, abdul), null);
});

test("dikirim → hanya outlet & bagian tujuan", () => {
  const r = t({ status: "dikirim", dikirim_by: "m", dikirim_by_name: "Mahmud" });
  assert.match(notifTransfer(r, kasirKbu).title, /dikirim ke KBU/);
  assert.equal(notifTransfer(r, dapurKbu), null, "bar ≠ dapur");
  assert.equal(notifTransfer(r, mahmud), null);
  assert.ok(notifTransfer({ ...r, area: null }, dapurKbu), "tanpa bagian → semua bagian outlet");
});

test("diterima → gudang, bukan penerima", () => {
  const r = t({ status: "diterima", diterima_by: "k", diterima_by_name: "Kasir KBU" });
  assert.match(notifTransfer(r, mahmud).title, /KBU sudah terima/);
  assert.equal(notifTransfer(r, kasirKbu), null);
});

test("batal oleh HP sendiri tidak dinotifikasi balik", () => {
  const r = t({ id: "t9", status: "batal" });
  assert.ok(notifTransfer(r, kasirKbu));
  tandaiAksiSendiri("t9", "batal");
  assert.equal(notifTransfer(r, kasirKbu), null);
});

test("SO baru outlet → gudang, bukan pembuat & bukan SO gudang", () => {
  const ev = { id: "e1", jenis: "so", lokasi: "KSM", area: "dapur", created_by: "s", created_by_name: "sima" };
  assert.match(notifSo(ev, mahmud).title, /SO baru KSM · Dapur/);
  assert.equal(notifSo(ev, dapurKsm), null);
  assert.equal(notifSo({ ...ev, lokasi: "GDG" }, mahmud), null);
  assert.equal(notifSo({ ...ev, jenis: "waste" }, mahmud), null);
});
