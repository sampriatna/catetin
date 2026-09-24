"use client";
// app/(auth)/login/page.jsx
// Satu halaman untuk: Masuk, Daftar, dan Terima Undangan (?invite=token).

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { acceptInvite } from "../../../lib/repo";
import { resetPasswordRedirectUrl, redirectRecoveryTokensIfPresent } from "../../../lib/resetPasswordPage.jsx";
import { withTimeout } from "../../../lib/supabaseSession";
import { readStoredSession } from "../../../lib/authBootstrap";
import { useApp } from "../../../components/layout/BusinessProvider";
import { canSignUpWithoutInvite } from "../../../lib/onboardingPolicy.js";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");
  const { session } = useApp();

  const [mode, setMode] = useState(inviteToken ? "signup" : params.get("forgot") === "1" ? "forgot" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const allowSignup = canSignUpWithoutInvite(Boolean(inviteToken));

  const resetRedirectTo = () => resetPasswordRedirectUrl();

  useEffect(() => {
    redirectRecoveryTokensIfPresent();
  }, []);

  // Sudah login — jangan tampilkan form lagi (mis. tombol Back browser dari dashboard)
  useEffect(() => {
    if (inviteToken) return;
    const stored = readStoredSession();
    if (stored?.user || session?.user) {
      setRedirecting(true);
      router.replace("/dashboard");
    }
  }, [session, inviteToken, router]);

  const handleAcceptInvite = useCallback(async () => {
    if (!inviteToken) return;
    try {
      const member = await acceptInvite(inviteToken);
      router.replace(`/dashboard?biz=${member.business_id}`);
    } catch (e) {
      const raw = e.message || String(e);
      if (/accept_invite|function.*does not exist/i.test(raw)) {
        setErr("Fungsi accept_invite belum ada di Supabase. Jalankan supabase/schema.sql.");
      } else if (/tidak valid|kadaluarsa/i.test(raw)) {
        setErr("Link undangan tidak valid atau sudah kadaluarsa. Minta owner buat link baru.");
      } else {
        setErr(raw.replace(/^\[acceptInvite\]\s*/, "") || "Gagal menerima undangan");
      }
    }
  }, [inviteToken, router]);

  useEffect(() => {
    if (!inviteToken) return;
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) await handleAcceptInvite();
    });
  }, [inviteToken, handleAcceptInvite]);

  async function afterAuth() {
    if (inviteToken) {
      await handleAcceptInvite();
      return;
    }
    // BusinessProvider already checks memberships and only claims pending invites
    // when the user genuinely has no active business. Avoid doing that work twice
    // on every normal login.
    window.location.replace("/dashboard");
  }

  async function submit(e) {
    e.preventDefault();
    setErr(""); setMsg(""); setLoading(true);
    try {
      if (mode === "forgot") {
        const em = email.trim();
        if (!em) throw new Error("Isi email dulu.");
        const { error } = await supabase.auth.resetPasswordForEmail(em, {
          redirectTo: resetRedirectTo(),
        });
        if (error) throw error;
        setMsg(`Link reset password dikirim ke ${em}. Cek inbox & folder spam, lalu klik link di email (arah ke ${resetRedirectTo()}).`);
        return;
      }
      if (mode === "signup") {
        if (!allowSignup) {
          throw new Error("Daftar hanya via link undangan owner NF3.");
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        });
        if (error) throw error;
        const { data: sess } = await supabase.auth.getSession();
        if (sess.session) {
          await afterAuth();
        } else {
          setMsg("Akun dibuat. Cek email untuk konfirmasi, lalu buka link undangan lagi untuk masuk.");
          setMode("signin");
        }
      } else {
        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({ email: email.trim(), password }),
          15000,
          "Login"
        );
        if (error) throw error;
        if (!data?.session) throw new Error("Login gagal — sesi tidak dibuat. Coba refresh halaman.");
        await afterAuth();
      }
    } catch (e2) {
      setErr(translateError(e2.message));
    } finally {
      setLoading(false);
    }
  }

  if (redirecting) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", color: "#6B7280", fontSize: 14 }}>
        Memuat dashboard…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: "#4F46E5" }}>NF3</div>
          <div style={{ fontSize: 14, color: "#6B7280", marginTop: 4 }}>Buku kas digital NF</div>
        </div>

        {inviteToken && (
          <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 12,
            padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#4338CA" }}>
            Kamu diundang bergabung. {mode === "signup" ? "Daftar" : "Masuk"} untuk menerima undangan.
          </div>
        )}

        <form onSubmit={submit} style={{ background: "#fff", borderRadius: 20, padding: 28, border: "1px solid #E8E8F0" }}>
          {mode !== "forgot" && (
            <div style={{ display: "flex", gap: 6, background: "#F3F4F6", padding: 4, borderRadius: 12, marginBottom: 22 }}>
              {[["signin", "Masuk"], ...(allowSignup ? [["signup", "Daftar"]] : [])].map(([m, label]) => (
                <button key={m} type="button" onClick={() => { setMode(m); setErr(""); setMsg(""); }}
                  style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", cursor: "pointer",
                    fontWeight: 700, fontSize: 13,
                    background: mode === m ? "#fff" : "transparent",
                    color: mode === m ? "#4F46E5" : "#9CA3AF",
                    boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {!allowSignup && mode !== "forgot" && (
            <div style={{
              padding: "10px 12px", borderRadius: 10, background: "#EEF2FF", border: "1px solid #C7D2FE",
              color: "#4338CA", fontSize: 12, lineHeight: 1.45, marginBottom: 16,
            }}>
              Daftar akun baru hanya lewat <strong>link undangan</strong> dari owner NF3. Staf outlet: minta link, lalu buka di browser.
            </div>
          )}

          {mode === "forgot" && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 800, fontSize: 17, color: "#1A1A2E" }}>Lupa password</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginTop: 6, lineHeight: 1.45 }}>
                Masukkan email akun NF3. Kami kirim link untuk buat password baru.
              </div>
            </div>
          )}

          {mode === "signup" && (
            <Field label="Nama">
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Nama kamu" style={inp} autoFocus />
            </Field>
          )}

          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="sampriatna@gmail.com" style={inp} required
              autoFocus={mode === "signin" || mode === "forgot"} />
          </Field>

          {mode !== "forgot" && (
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" style={inp} required minLength={6} />
            </Field>
          )}

          {mode === "signin" && (
            <div style={{ textAlign: "right", marginTop: -8, marginBottom: 14 }}>
              <button type="button" onClick={() => { setMode("forgot"); setErr(""); setMsg(""); setPassword(""); }}
                style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600,
                  color: "#6366F1", cursor: "pointer" }}>
                Lupa password?
              </button>
            </div>
          )}

          {err && <Banner color="#B91C1C" bg="#FEE2E2">{err}</Banner>}
          {msg && <Banner color="#15803D" bg="#DCFCE7">{msg}</Banner>}

          <button type="submit" disabled={loading}
            style={{ width: "100%", padding: 14, borderRadius: 12, border: "none", marginTop: 4,
              background: "#6366F1", color: "#fff", fontWeight: 700, fontSize: 15,
              cursor: "pointer", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Memproses…" : mode === "signup" ? "Daftar →" : mode === "forgot" ? "Kirim link reset →" : "Masuk →"}
          </button>

          {mode === "forgot" && (
            <button type="button" onClick={() => { setMode("signin"); setErr(""); setMsg(""); }}
              style={{ width: "100%", padding: 12, marginTop: 10, borderRadius: 12, border: "1px solid #E8E8F0",
                background: "#fff", color: "#6B7280", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
              ← Kembali ke masuk
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", color: "#6B7280" }}>
        Memuat…
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}

function translateError(m = "") {
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(m)) return "Koneksi ke layanan login terputus. Coba masuk lagi. Jika tetap gagal, coba ganti Wi-Fi ke data seluler.";
  if (/timeout/i.test(m)) return "Login terlalu lama. Refresh halaman (Ctrl+Shift+R), lalu coba lagi.";
  if (/invalid login credentials/i.test(m)) return "Email atau password salah. Coba lagi atau pakai Lupa password.";
  if (/already registered/i.test(m)) return "Email sudah terdaftar. Silakan masuk atau reset password.";
  if (/password should be at least/i.test(m)) return "Password minimal 6 karakter.";
  if (/rate limit|too many/i.test(m)) return "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.";
  if (/user not found/i.test(m)) return "Email belum terdaftar. Daftar dulu atau cek penulisan email.";
  return m;
}

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
      color: "#9CA3AF", marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

const Banner = ({ color, bg, children }) => (
  <div style={{ padding: "10px 14px", borderRadius: 10, background: bg, color, fontSize: 13, marginBottom: 14 }}>
    {children}
  </div>
);

const inp = {
  width: "100%", padding: "12px 14px", borderRadius: 12,
  border: "1px solid #E8E8F0", background: "#F9F9FC",
  fontSize: 14, color: "#1A1A2E", outline: "none", boxSizing: "border-box",
};
