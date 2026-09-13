"use client";
// BusinessProvider — auth + bisnis aktif. Ringan: TIDAK pakai getSession() / loadBusinessState().
// NF3App mengelola state keuangan sendiri via app_state JSONB.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { subscribeAuth, readStoredSession } from "../../lib/authBootstrap";
import { withTimeout, resetSupabaseSessionCache } from "../../lib/supabaseSession";
import { resolveAuthMembership } from "../../lib/membershipResolve";
import * as repo from "../../lib/repo";

const Ctx = createContext(null);
export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp() harus dipakai di dalam <BusinessProvider>");
  return v;
};

const PUBLIC = ["/login", "/pair", "/reset-password"];
const isPublic = (p) => PUBLIC.some((x) => p?.startsWith(x));
const LAST_BIZ = "nf3:lastBiz";

export default function BusinessProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const bizParam = searchParams.get("biz");
  const inviteParam = searchParams.get("invite");

  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [businesses, setBusinesses] = useState([]);
  const [bizLoaded, setBizLoaded] = useState(false);
  const [bizId, setBizId] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ── 1. Auth: localStorage bootstrap + onAuthStateChange (NO getSession) ────
  useEffect(() => {
    const unsub = subscribeAuth((sess) => {
      if (!mounted.current) return;
      setSession(sess);
      setAuthReady(true);
    });
    // Fallback: jika onAuthStateChange tidak fire dalam 1.5s, anggap selesai
    const t = setTimeout(() => {
      if (mounted.current) setAuthReady(true);
    }, 1500);
    return () => { clearTimeout(t); unsub(); };
  }, []);

  // HP/PWA kadang telat memulihkan sesi saat app kembali aktif.
  // Jika token lokal masih ada, pulihkan sesi lokal agar tidak lempar ke login terlalu cepat.
  useEffect(() => {
    if (!authReady || session) return;
    const stored = readStoredSession();
    if (stored?.user) {
      setSession(stored);
      return;
    }
    const revive = () => {
      if (session) return;
      const latest = readStoredSession();
      if (latest?.user) setSession(latest);
    };
    window.addEventListener("focus", revive);
    document.addEventListener("visibilitychange", revive);
    return () => {
      window.removeEventListener("focus", revive);
      document.removeEventListener("visibilitychange", revive);
    };
  }, [authReady, session]);

  // ── 2. Muat bisnis + profil user saat login ───────────────────────────────
  useEffect(() => {
    if (!authReady) return;
    if (!session) {
      setError(null);
      setBusinesses([]);
      setBizId(null);
      setAuthUser(null);
      setMembers([]);
      setBizLoaded(true);
      return;
    }

    // Onboarding: cek cepat apakah sudah punya bisnis (tanpa fetch members)
    const onOnboarding = pathname === "/onboarding";

    let alive = true;
    setError(null);
    setBizLoaded(false);

    (async () => {
      const uid = session.user.id;
      const email = session.user.email;

      const fetchMemberships = async () => {
        const { data: bizRows, error: bizErr } = await withTimeout(
          supabase
            .from("business_members")
            .select("role, outlet, active, business:businesses(id, slug, name, type)")
            .eq("user_id", uid)
            .eq("active", true),
          10000,
          "Muat bisnis"
        );
        if (bizErr) throw bizErr;
        return (bizRows || [])
          .filter((m) => m.business)
          .map((m) => ({ ...m.business, role: m.role, outlet: m.outlet }));
      };

      try {
        let list = await fetchMemberships();

        if (list.length === 0) {
          try {
            const claimed = await repo.claimPendingInvites();
            if (claimed?.length) {
              localStorage.setItem(LAST_BIZ, claimed[0].business_id);
              list = await fetchMemberships();
            }
          } catch (claimError) {
            // A failed claim is not proof that this user has no business.
            throw claimError;
          }
        }

        if (!alive) return;

        if (onOnboarding && list.length > 0) {
          const id = repo.pickDefaultBusinessId(list) || list[0].id;
          localStorage.setItem(LAST_BIZ, id);
          window.location.replace(`/dashboard?biz=${id}`);
          return;
        }

        const stored = localStorage.getItem(LAST_BIZ);
        const pick = repo.pickDefaultBusinessId(list, { bizParam, storedId: stored });

        const canonical = repo.findCanonicalInList(list);
        if (canonical && pick === canonical.id) {
          localStorage.setItem(LAST_BIZ, canonical.id);
        }

        const visibleList = repo.filterBusinessesForUi(list);
        let membership = list.find((b) => b.id === pick) || list[0];

        if (pick) {
          const { data: memRow } = await withTimeout(
            supabase
              .from("business_members")
              .select("role, outlet")
              .eq("business_id", pick)
              .eq("user_id", uid)
              .maybeSingle(),
            8000,
            "Muat role"
          );
          if (memRow) {
            membership = { ...membership, role: memRow.role, outlet: memRow.outlet };
          }
        }

        const resolved = resolveAuthMembership({
          role: membership?.role,
          outlet: membership?.outlet,
          email,
        });

        if (!alive) return;

        setBusinesses(
          visibleList.map((b) =>
            b.id === pick ? { ...b, role: resolved.role, outlet: resolved.outlet } : b
          )
        );
        setBizId(pick);
        setAuthUser({
          id: uid,
          email,
          name: session.user.user_metadata?.name || email?.split("@")[0] || "User",
          role: resolved.role,
          outlet: resolved.outlet,
        });
        setBizLoaded(true);

        if (pick && !onOnboarding) {
          repo.listBusinessMembers(pick)
            .then((mems) => { if (alive) setMembers(mems || []); })
            .catch(() => { if (alive) setMembers([]); });
        } else {
          setMembers([]);
        }
      } catch (e) {
        if (alive) setError(e.message || String(e));
      } finally {
        if (alive) setBizLoaded(true);
      }
    })();

    return () => { alive = false; };
  }, [authReady, session?.user?.id, bizParam, pathname, retryCount]);

  // ── 3. Redirect ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authReady || !bizLoaded || error) return;
    if (session && pathname === "/login" && !inviteParam) {
      router.replace("/dashboard");
      return;
    }
    if (!session && !isPublic(pathname)) {
      const stored = readStoredSession();
      if (stored?.user) return;
      router.replace("/login");
      return;
    }
    if (session && businesses.length === 0 && pathname !== "/onboarding" && !isPublic(pathname)) {
      router.replace("/onboarding");
    }
  }, [authReady, bizLoaded, session, businesses.length, pathname, router, inviteParam, bizParam, error]);

  const signOut = useCallback(async () => {
    resetSupabaseSessionCache();
    await supabase.auth.signOut();
    localStorage.removeItem(LAST_BIZ);
    router.replace("/login");
  }, [router]);

  const switchBusiness = useCallback((id) => {
    setBizId(id);
    localStorage.setItem(LAST_BIZ, id);
    const mem = businesses.find((b) => b.id === id);
    if (mem && authUser) {
      const resolved = resolveAuthMembership({
        role: mem.role,
        outlet: mem.outlet,
        email: authUser.email,
      });
      setAuthUser((prev) =>
        prev ? { ...prev, role: resolved.role, outlet: resolved.outlet } : prev
      );
    }
    router.replace(`/dashboard?biz=${id}`);
  }, [router, businesses, authUser]);

  const business = businesses.find((b) => b.id === bizId) || null;

  // Alias `s` untuk halaman settings yang masih pakai pola lama
  const s = authUser ? {
    currentUser: authUser,
    business,
    members,
  } : null;

  const value = {
    session,
    bizId,
    businesses,
    business,
    authUser,
    members,
    s,
    loading: !authReady || (session && !bizLoaded),
    error,
    switchBusiness,
    signOut,
    inviteStaff: (payload) => repo.inviteStaff(bizId, { ...payload, businessName: business?.name }),
  };

  // ── Render gate ───────────────────────────────────────────────────────────
  if (isPublic(pathname)) return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  if (pathname === "/onboarding") return <Ctx.Provider value={value}>{children}</Ctx.Provider>;

  if (!authReady || (session && !bizLoaded)) {
    return <Gate msg="Memuat…" />;
  }

  if (error) {
    return (
      <Gate msg="">
        <div style={{ color: "#B91C1C", maxWidth: 360, textAlign: "center" }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Gagal memuat</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>{error}</div>
          <button onClick={() => { setError(null); setBizLoaded(false); setRetryCount((n) => n + 1); }} style={btn}>Coba lagi</button>
        </div>
      </Gate>
    );
  }

  if (!session) {
    return (
      <Gate msg="">
        <button onClick={() => { window.location.href = "/login"; }} style={btn}>Masuk</button>
      </Gate>
    );
  }

  if (businesses.length === 0 && pathname !== "/onboarding") {
    return (
      <Gate msg="">
        <div style={{ maxWidth: 340, textAlign: "center", fontSize: 13, color: "#6B7280", lineHeight: 1.5, marginBottom: 16 }}>
          Akun belum terhubung ke bisnis NF3. Staf outlet harus pakai link undangan dari owner.
        </div>
        <button onClick={() => { window.location.href = "/onboarding"; }} style={btn}>Terima undangan / bantuan</button>
      </Gate>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Gate({ msg, children }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", color: "#6B7280", fontSize: 14 }}>
      {children || msg}
    </div>
  );
}

const btn = {
  padding: "10px 18px", borderRadius: 10, border: "none",
  background: "#6366F1", color: "#fff", fontWeight: 700, cursor: "pointer",
};
