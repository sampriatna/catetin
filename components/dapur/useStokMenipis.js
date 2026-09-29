"use client";
// Bahan habis / di bawah stok minimum (SO terakhir) di semua lokasi — untuk checklist purchasing & gudang.

import { useCallback, useEffect, useState } from "react";
import { stokMenipis } from "../../lib/inventoryLogic";
import { loadItems, loadStockSnapshot } from "../../lib/inventoryRepo";

export default function useStokMenipis({ bizId, lokasi = null, enabled = true }) {
  const [list, setList] = useState(null);
  const refresh = useCallback(async () => {
    if (!enabled || !bizId) return;
    try {
      const [items, snapshot] = await Promise.all([loadItems(bizId), loadStockSnapshot(bizId)]);
      setList(stokMenipis(snapshot, items, lokasi ? [lokasi] : null));
    } catch {
      setList(null); // offline / tabel belum ada — checklist tetap tampil
    }
  }, [bizId, lokasi, enabled]);

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

  return list;
}
