// lib/authBootstrap.js
// Bootstrap sesi auth TANPA getSession() async (sering hang di browser dev/HMR).
// Baca token dari localStorage Supabase + dengarkan onAuthStateChange.

import { supabase } from "./supabaseClient.js";

function projectRef() {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname.split(".")[0];
  } catch {
    return "";
  }
}

function storageKey() {
  const ref = projectRef();
  return ref ? `sb-${ref}-auth-token` : "";
}

/** Baca sesi tersimpan secara sinkron dari localStorage. */
export function readStoredSession() {
  if (typeof window === "undefined") return null;
  const key = storageKey();
  if (!key) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data?.access_token) return null;
    // Supabase baru bisa simpan user terpisah (userStorage)
    if (!data.user) {
      const userRaw = localStorage.getItem(`${key}-user`);
      if (userRaw) {
        try {
          const parsed = JSON.parse(userRaw);
          if (parsed?.user) data.user = parsed.user;
        } catch { /* ignore */ }
      }
    }
    return data.user ? data : null;
  } catch {
    return null;
  }
}

/** Subscribe auth — callback dipanggil saat sesi awal + perubahan login/logout. */
export function subscribeAuth(onChange) {
  const stored = readStoredSession();
  // Selalu panggil sekali agar UI tidak stuck "Memuat…" menunggu INITIAL_SESSION
  onChange(stored?.user ? stored : null);

  const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
    if (event === "SIGNED_OUT") {
      onChange(null);
      return;
    }
    if (sess) {
      onChange(sess);
      return;
    }
    if (event === "INITIAL_SESSION") {
      onChange(stored ?? null);
    }
  });

  return () => sub.subscription.unsubscribe();
}
