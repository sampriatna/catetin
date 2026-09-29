"use client";
// Belanja 7 hari terakhir yang belum masuk stok (untuk checklist purchasing). Dimuat ulang saat tab aktif lagi.

import { useCallback, useEffect, useState } from "react";
import { ringkasBelanja, todayJakarta } from "../../lib/inventoryLogic";
import { loadBelanjaUntukStok, loadItems, loadPurchaseMaps } from "../../lib/inventoryRepo";

export default function useBelanjaBelumStok({ bizId, enabled = true }) {
  const [status, setStatus] = useState(null);
  const refresh = useCallback(async () => {
    if (!enabled || !bizId) return;
    try {
      const [list, maps, items] = await Promise.all([
        loadBelanjaUntukStok(bizId, { today: todayJakarta() }), loadPurchaseMaps(bizId), loadItems(bizId),
      ]);
      const pending = list.map((t) => ringkasBelanja(t, maps, items)).filter((r) => r.pending);
      setStatus({ belanja: pending.length, belumDikenali: pending.reduce((s, r) => s + r.perlu, 0) });
    } catch {
      setStatus(null);
    }
  }, [bizId, enabled]);

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
