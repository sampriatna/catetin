"use client";

import { Suspense } from "react";
import { useApp } from "../../../components/layout/BusinessProvider";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

const NF3App = dynamic(() => import("./NF3App"), { ssr: false });

function DashboardInner() {
  const ctx = useApp();
  const params = useSearchParams();
  const webMode = params.get("view") === "web";

  if (ctx.loading || !ctx.bizId || !ctx.authUser) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", color: "#6B7280", fontSize: 14, padding: 20, textAlign: "center" }}>
        <div>
          <div>Memuat dashboard…</div>
          {ctx.error && (
            <div style={{ color: "#B91C1C", fontSize: 13, marginTop: 10, maxWidth: 320 }}>
              {ctx.error}
            </div>
          )}
          {!ctx.session && !ctx.loading && (
            <a href="/login" style={{ display: "inline-block", marginTop: 12, color: "#6366F1", fontWeight: 700 }}>Ke login</a>
          )}
        </div>
      </div>
    );
  }

  // Akun dapur tidak memakai modul keuangan — langsung ke modul Dapur.
  if (ctx.authUser.role === "dapur") {
    if (typeof window !== "undefined") window.location.replace("/dapur");
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", color: "#6B7280" }}>
        Membuka Dapur…
      </div>
    );
  }

  return (
    <NF3App
      bizId={ctx.bizId}
      authUser={ctx.authUser}
      members={ctx.members}
      businesses={ctx.businesses}
      signOut={ctx.signOut}
      switchBusiness={ctx.switchBusiness}
      business={ctx.business}
      session={ctx.session}
      webMode={webMode}
    />
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0F0F8", color: "#6B7280" }}>
        Memuat…
      </div>
    }>
      <DashboardInner />
    </Suspense>
  );
}
