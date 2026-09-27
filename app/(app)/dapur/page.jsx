"use client";
// app/(app)/dapur/page.jsx — modul Dapur (SO shift, waste, produksi). Tetap dalam BusinessProvider.

import dynamic from "next/dynamic";
import { useApp } from "../../../components/layout/BusinessProvider";
import { isFnBBusiness } from "../../../lib/businessFeatures";

const DapurApp = dynamic(() => import("../../../components/dapur/DapurApp"), { ssr: false });

export default function DapurPage() {
  const { bizId, authUser, business, loading, signOut } = useApp();

  if (loading || !bizId || !authUser) {
    return <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>Memuat…</div>;
  }
  if (!isFnBBusiness(business)) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#6B7280" }}>
        Modul Dapur hanya untuk bisnis F&amp;B. <a href="/dashboard" style={{ color: "#185FA5", fontWeight: 700 }}>Kembali</a>
      </div>
    );
  }
  return <DapurApp bizId={bizId} user={authUser} signOut={signOut} />;
}
