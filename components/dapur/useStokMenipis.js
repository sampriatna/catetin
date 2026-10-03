"use client";
// Bahan habis / di bawah minimal stok LOKASI-nya (stok berjalan: SO terakhir + barang masuk − keluar) di semua lokasi — untuk checklist purchasing & gudang.

import { useCallback, useEffect, useState } from "react";
import { stokMenipis, stockRowsFor, buildMinStokMap } from "../../lib/inventoryLogic";
import { loadItems, loadStockSnapshot, loadStockRunning, loadMinStock } from "../../lib/inventoryRepo";

export default function useStokMenipis({ bizId, lokasi = null, enabled = true }) {
  const [list, setList] = useState(null);
  const refresh = useCallback(async () => {
    if (!enabled || !bizId) return;
    try {
      const [items, snapshot, running, minRows] = await Promise.all([
        loadItems(bizId), loadStockSnapshot(bizId), loadStockRunning(bizId).catch(() => null), loadMinStock(bizId),
      ]);
      // Minimal stok dibaca per lokasi (inv_min_stock), bukan angka global bahan.
      setList(stokMenipis(stockRowsFor(running, snapshot), items, lokasi ? [lokasi] : null, buildMinStokMap(minRows)));
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
