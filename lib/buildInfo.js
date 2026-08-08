// lib/buildInfo.js — versi build/deploy untuk dicek di HP staf (Pengaturan)

/** Short SHA dari Vercel / env build. */
export function getAppBuildSha() {
  const raw =
    process.env.NEXT_PUBLIC_APP_BUILD_SHA
    || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || "";
  const sha = String(raw).trim();
  if (!sha) return "dev";
  return sha.slice(0, 7);
}

/** Label singkat untuk UI. Contoh: `012804b · 2026-08-08` */
export function getAppBuildLabel() {
  const sha = getAppBuildSha();
  const deployed =
    process.env.NEXT_PUBLIC_APP_BUILD_TIME
    || process.env.VERCEL_DEPLOYMENT_ID
    || "";
  const day = (() => {
    try {
      return new Date().toISOString().slice(0, 10);
    } catch {
      return "";
    }
  })();
  if (deployed && String(deployed).length <= 12) return `${sha} · ${deployed}`;
  return day ? `${sha} · ${day}` : sha;
}

/** Versi service worker — naikkan setiap patch kritis agar cache lama dibuang. */
export const APP_SW_VERSION = "nf3-sw-20260808-samtaro-sync3";
