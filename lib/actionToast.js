// lib/actionToast.js — notifikasi pop-up: hasil aksi (berhasil/gagal) & kabar baru (permintaan, kiriman, SO).

const listeners = new Set();

/**
 * @param {string} message
 * @param {'success'|'error'|'info'|'event'} tone  event = kabar baru (tampil di atas, bisa diketuk)
 * @param {number|object} [opts] durasi (ms) atau { durationMs, title, href, silent }
 *   Gagal (error) tetap tampil sampai ditutup kecuali durationMs diisi.
 */
export function showActionToast(message, tone = "success", opts) {
  const o = typeof opts === "number" ? { durationMs: opts } : (opts || {});
  const sticky = tone === "error" && !(Number(o.durationMs) > 0);
  const payload = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    message: String(message || "").trim(),
    title: o.title ? String(o.title) : "",
    href: o.href || "",
    silent: !!o.silent,
    tone,
    durationMs: sticky ? 0 : Number(o.durationMs) > 0 ? Number(o.durationMs) : tone === "event" ? 9000 : 3200,
  };
  if (!payload.message && !payload.title) return payload.id;
  listeners.forEach((fn) => {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  });
  return payload.id;
}

/** Pop-up gagal + kembalikan pesan untuk ditampilkan juga di form. */
export function toastGagal(e, prefix = "Gagal menyimpan") {
  const msg = e?.message || String(e);
  showActionToast(`${prefix}: ${msg}`, "error");
  return msg;
}

export function subscribeActionToast(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
