"use client";
// Status stok hari ini untuk checklist beranda (kasir, purchasing). Dimuat ulang saat tab kembali aktif.

import { useCallback, useEffect, useState } from "react";
import { summarizeDapurToday, todayJakarta } from "../../lib/inventoryLogic";
import { loadDapurToday } from "../../lib/inventoryRepo";

export default function useDapurToday({ bizId, lokasi, userId, enabled = true }) {
  const [status, setStatus] = useState(null);
  const refresh = useCallback(async () => {
    if (!enabled || !bizId) return;
    const today = todayJakarta();
    try {
      const data = await loadDapurToday(bizId, { lokasi, today });
      setStatus(summarizeDapurToday({ ...data, lokasi, userId, today }));
    } catch {
      setStatus(null); // tabel belum ada / offline — checklist tetap tampil tanpa status
    }
  }, [bizId, lokasi, userId, enabled]);

  useEffect(() => {
    refresh();
    if (typeof window === "undefined") return undefined;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  return status;
}
