// lib/purchasingScan.js
// Hasil AI "scan nota / screenshot WA" → baris item form purchasing.
// AI membaca HARGA TOTAL per baris; form menyimpan qty × harga satuan,
// jadi harga satuan dihitung ulang tanpa mengubah total baris.

// Angka dari AI biasanya number; jika string, format Rupiah ("50.000") → buang pemisah ribuan.
function toInt(v) {
  const n = typeof v === "number"
    ? Math.round(v)
    : Number(String(v ?? "").split(",")[0].replace(/\D/g, "")) || 0;
  return n > 0 ? n : 0;
}

export function scanResultToItems(result) {
  const items = [];
  for (const raw of result?.items || []) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const subtotal = toInt(raw.subtotal ?? raw.total ?? raw.amount);
    const qty = Number(raw.qty) > 0 ? Number(raw.qty) : 1;
    const unit = String(raw.unit || "").trim() || "pcs";
    if (!subtotal) {
      items.push({ name, qty: String(qty), unit, unitPrice: "" });
    } else if (Number.isInteger(qty) && subtotal % qty === 0) {
      items.push({ name, qty: String(qty), unit, unitPrice: String(subtotal / qty) });
    } else {
      // Harga satuan tidak bulat (mis. 3 pcs = 10.000) — simpan sebagai 1 paket agar total baris tetap persis.
      items.push({ name: `${name} (${qty} ${unit})`, qty: "1", unit: "paket", unitPrice: String(subtotal) });
    }
  }
  const itemsTotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const writtenTotal = toInt(result?.writtenTotal);
  return {
    items,
    itemsTotal,
    writtenTotal,
    totalMismatch: writtenTotal > 0 && itemsTotal > 0 && writtenTotal !== itemsTotal,
    missingPrice: items.filter((i) => !i.unitPrice).length,
  };
}

export function scanResultDate(result) {
  const d = String(result?.date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}
