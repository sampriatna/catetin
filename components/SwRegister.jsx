"use client";
// components/SwRegister.jsx
// Daftar service worker di level app (semua halaman, termasuk /login).
//
// Kenapa perlu: registerServiceWorker() sebelumnya hanya dipanggil di dalam
// dashboard (app/(app)/dashboard/NF3App.jsx) — di balik login. Akibatnya HP
// yang masih memakai bundle lama & terjebak di layar login ("Load failed")
// TIDAK PERNAH menerima service worker pembersih cache, jadi tak bisa memuat
// bundle terbaru untuk bisa login. Mendaftarkannya di root layout memutus
// jebakan ayam-telur itu: perangkat di halaman login pun ikut membuang cache
// lama dan mengambil bundle terbaru.

import { useEffect } from "react";
import { registerServiceWorker } from "./PwaInstallBanner";

export default function SwRegister() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
