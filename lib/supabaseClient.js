// lib/supabaseClient.js
// Klien Supabase untuk dipakai di browser (client components).
// Memakai publishable/anon key — aman di browser, dilindungi RLS.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "[NF3] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY belum diisi di .env.local"
  );
}

// Placeholder aman untuk SSG/prerender saat env belum tersedia (mis. Vercel Preview
// tanpa env Preview). createClient("") melempar "supabaseUrl is required" dan
// menghentikan next build. Placeholder tidak dipakai untuk auth nyata — panggilan
// API tetap gagal sampai env diisi.
const BUILD_PLACEHOLDER_URL = "https://placeholder.supabase.co";
const BUILD_PLACEHOLDER_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24ifQ.placeholder";

// Lock no-op: hindari deadlock navigator.locks yang bikin getSession()
// & query menggantung selamanya di sebagian browser/dev (HMR multi-mount).
const noopLock = async (_name, _acquireTimeout, fn) => fn();

export const supabase = createClient(url || BUILD_PLACEHOLDER_URL, anonKey || BUILD_PLACEHOLDER_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // login pakai password, bukan redirect/magic-link
    lock: noopLock,
  },
});
