// lib/pushConfig.js — kunci publik Web Push (VAPID). Kunci publik memang boleh terlihat di aplikasi;
// pasangannya (VAPID_PRIVATE_KEY) hanya ada di pengaturan server Vercel.
export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BFscjmjLjSkoW8xTumJppM8VlbKAiIkJ8FLgxXOGF7_oXaPakK295MRuOEF1Cr04ePKOIUZb7Tlc1OpTCObLpYk";
