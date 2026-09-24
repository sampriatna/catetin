// lib/supabaseSession.js — helper query Supabase (TANPA setSession/getSession yang sering hang)

import { readStoredSession } from "./authBootstrap.js";

/** Cek token ada di localStorage. Klien Supabase (persistSession) sudah pakai JWT otomatis. */
export async function ensureSupabaseSession() {
  if (typeof window === "undefined") return false;
  return !!readStoredSession()?.access_token;
}

export function resetSupabaseSessionCache() {
  /* noop — tidak ada cache setSession */
}

export function withTimeout(promise, ms = 12000, label = "Permintaan") {
  const p = Promise.resolve(promise);
  let timer;
  return Promise.race([
    p,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout (${ms / 1000}s)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
