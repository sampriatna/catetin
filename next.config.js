/** @type {import('next').NextConfig} */
const commitSha =
  process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  || process.env.NEXT_PUBLIC_APP_BUILD_SHA
  || "dev";

const nextConfig = {
  transpilePackages: ["lucide-react"],
  compress: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
  env: {
    // Tampil di Pengaturan agar staf bisa cek HP sudah pakai patch terbaru
    NEXT_PUBLIC_APP_BUILD_SHA: String(commitSha).slice(0, 12),
    NEXT_PUBLIC_APP_BUILD_TIME: new Date().toISOString().slice(0, 10),
  },
  // Jangan redirect / → /dashboard di server: hash token reset email (#access_token) hilang.
  // app/page.jsx menangani redirect client-side.
};

module.exports = nextConfig;
