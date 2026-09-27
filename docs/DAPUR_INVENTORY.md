# Modul Dapur — SO shift, waste, produksi

Halaman: `/dapur` (tombol di checklist kasir & purchasing, dan Pengaturan → Dapur & Stok). Hanya untuk bisnis F&B.

## Fitur

| Tab | Siapa | Isi |
|---|---|---|
| SO Shift | semua | Hitung stok fisik per bahan (pilih dari daftar, tanpa ketik nama). Isian tersimpan otomatis di HP sampai dikirim. Tampil SO terakhir, selisih, dan status menipis/habis. |
| Waste | semua | Pilih bahan + jumlah + alasan (basi, jatuh, salah masak, sisa, rusak, lainnya). Nilai rupiah otomatis. |
| Produksi | semua (biasanya purchasing/gudang) | Pilih resep + jumlah batch → bahan terpakai terisi otomatis (bisa dikoreksi). Isi hasil aktual. Modal per satuan hasil = total nilai bahan ÷ hasil, dan otomatis jadi modal baru barang setengah jadi itu. |
| Stok & Riwayat | semua | Nilai stok per lokasi (SO terakhir × modal), bahan di bawah stok minimum, waste 7 hari, riwayat input. Owner/admin bisa hapus input yang salah. |
| Kelola | owner, admin, purchasing | Master bahan (kode, satuan hitung, modal, stok minimum, lokasi) dan resep produksi. |

Setiap simpan menghasilkan teks laporan dan tombol **Kirim laporan ke WhatsApp**.

## Aturan

- Kasir hanya bisa input untuk outletnya sendiri (dicek juga di database). Purchasing default Gudang (GDG).
- Simpan lewat RPC `inv_submit_event` — atomik dan tidak dobel walau tombol ditekan dua kali (`client_ref`).
- Nilai stok hanya menghitung bahan yang pernah di-SO. Menghapus input produksi tidak mengembalikan modal lama barang hasil.

## Setup database (sekali)

1. Jalankan `supabase/migrations/20260927090000_inventory_dapur.sql` (tabel `inv_*`, RLS, RPC).
2. Jalankan `supabase/seed/inventory_items_nusa_food.sql` — 225 bahan aktif dari Master_Bahan sheet inventory v3 untuk bisnis Nusa Food. Bahan bertanda "Cek konversi/harga" perlu dibetulkan modalnya di tab Kelola.
3. Buat resep produksi di tab Kelola → Resep.

Test logika: `npm run test:inventory`.
