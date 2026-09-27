# Modul Dapur — SO shift, waste, produksi

Halaman: `/dapur` (tombol di checklist kasir & purchasing, dan Pengaturan → Dapur & Stok). Hanya untuk bisnis F&B.

## Fitur

| Tab | Siapa | Isi |
|---|---|---|
| SO Shift | semua | Hitung stok fisik memakai **daftar SO outlet** (nama, grup, dan satuan persis seperti laporan WA staf: "Beras … karung", "Pakcoy … Kg", "Gyoza … porsi"), otomatis dikonversi ke satuan master. Tombol **Tempel dari WA** mengisi form dari pesan SO biasa; bagian *WASTE* langsung dibawa ke form Waste, bagian *Menipis/Limit* jadi catatan. Bisa lampirkan foto. Isian tersimpan otomatis di HP sampai dikirim. |
| Waste | semua | Pilih bahan + jumlah + alasan (basi, jatuh, salah masak, sisa, rusak, lainnya) + foto bukti. Nilai rupiah otomatis. |
| Produksi | semua (biasanya purchasing/gudang) | Pilih resep + jumlah batch → bahan terpakai terisi otomatis (bisa dikoreksi). Isi hasil aktual. Modal per satuan hasil = total nilai bahan ÷ hasil, dan otomatis jadi modal baru barang setengah jadi itu. |
| Kirim Stok | semua | Pengganti form kertas "Permintaan Stok". Outlet membuat **permintaan** (daftar & satuan sama dengan daftar SO outlet, bisa tempel dari WA) → gudang **proses kirim** dengan jumlah aktual (boleh tambah barang) → outlet **cek & terima**, selisih ditandai merah dan wajib diberi catatan. Gudang juga bisa **kirim langsung** tanpa permintaan. Setiap tahap punya laporan WA dan boleh lampir foto. |
| Stok & Riwayat | semua | Nilai stok per lokasi (SO terakhir × modal), bahan di bawah stok minimum, waste 7 hari, riwayat input. Owner/admin bisa hapus input yang salah. |
| Kelola | owner, admin, purchasing | Master bahan (kode, satuan hitung, modal, stok minimum, lokasi), resep produksi, dan **Daftar SO** per outlet (nama staf, satuan hitung, isi konversi). Filter "konversi belum diatur" untuk melengkapi. |

Setiap simpan menghasilkan teks laporan dan tombol **Kirim laporan ke WhatsApp**.

## Akun (Nusa Food)

| Akun | Role | Outlet | Isi daftar SO |
|---|---|---|---|
| Kasir KBU | kasir | KBU | Bar KBU (+ kasir/keuangan seperti biasa) |
| Dapur KBU | **dapur** | KBU | Dapur KBU |
| Kasir KSM | kasir | KSM | Minuman KSM |
| Dapur KSM | **dapur** | KSM | Bahan, bumbu, topping, ala carte KSM |
| Samtaro | kasir | SMT | Semua (satu akun) |
| Purchasing | purchasing | — | Gudang: SO gudang, produksi, kirim stok |
| Owner / Admin | owner / admin | — | Semua + kartu Nilai Stok di beranda |

- Role **dapur** hanya membuka modul Dapur (beranda langsung ke `/dapur`, tanpa akses uang). Buat lewat Pengaturan → Staf → Undang → peran **Dapur** + outlet.
- Area daftar SO (`inv_so_template.area`): `dapur`, `bar`, atau kosong (semua). Bisa diubah di Kelola → Daftar SO → "Dihitung oleh". Setiap akun tetap bisa pindah ke daftar lain lewat pilihan "Daftar".

## Nilai stok

Kartu **Nilai Stok** (beranda owner/admin & tab Stok & Riwayat): total dan per lokasi = SO terakhir tiap barang × modal saat ini, naik/turun vs kemarin & 7 hari lalu, grafik 14 hari, dan **Uang + Stok**. Barang dengan modal 0 atau konversi belum diisi dihitung Rp0 dan ditandai. Sumber: RPC `inv_stock_value_series`.

## Aturan

- Kasir dan dapur hanya bisa input untuk outletnya sendiri (dicek juga di database). Purchasing default Gudang (GDG).
- Simpan lewat RPC `inv_submit_event` — atomik dan tidak dobel walau tombol ditekan dua kali (`client_ref`).
- Konversi: `qty master = qty SO × isi`. kg↔gr dan L↔ml otomatis. Bila isi belum diatur, SO tetap tersimpan dalam satuan staf (mis. ml sirup) tetapi **nilainya Rp 0** dan tidak ikut alert, sampai isi diisi di Kelola → Daftar SO.
- Setiap baris SO menyimpan juga angka & satuan asli yang ditulis staf (`qty_input`, `satuan_input`, `label`).
- Foto disimpan di bucket privat `inv-foto/<business_id>/<tanggal>/…` (dikompres ±1280px), hanya anggota bisnis yang bisa melihat.
- Kirim stok: status `diminta → dikirim → diterima` (atau `batal` sebelum dikirim). Hanya owner/admin/purchasing yang mengirim; hanya outlet tujuan (atau manajer) yang menerima; kasir hanya bisa meminta untuk outletnya. Nilai = qty × isi konversi × modal saat dikirim.
- Kiriman belum mengubah angka SO. Stok tetap diambil dari SO terakhir; kiriman dipakai untuk mengecek selisih.
- Nilai stok hanya menghitung bahan yang pernah di-SO. Menghapus input produksi tidak mengembalikan modal lama barang hasil.

## Setup database (sekali)

1. Jalankan `supabase/migrations/20260927090000_inventory_dapur.sql` (tabel `inv_*`, RLS, RPC).
2. Jalankan `supabase/seed/inventory_items_nusa_food.sql` — 225 bahan aktif dari Master_Bahan sheet inventory v3 untuk bisnis Nusa Food. Bahan bertanda "Cek konversi/harga" perlu dibetulkan modalnya di tab Kelola.
3. Jalankan `supabase/migrations/20260927120000_inventory_so_template.sql` (daftar SO outlet, kolom satuan asli, foto + bucket storage).
4. Jalankan `supabase/seed/inventory_so_template_nusa_food.sql` — 152 baris daftar SO (KBU dapur+bar, KSM bahan/bumbu/topping/ala carte/minuman, SMT) dari laporan WA 26 Sep + jawaban owner soal konversi, dan 73 bahan/setengah jadi baru (modal 0, perlu diisi). Sisa konversi (ukuran botol sirup, Saori, sea salt) diisi purchasing di Kelola → Daftar SO lewat kolom "1 btl = … ml".
5. Jalankan `supabase/migrations/20260928090000_inventory_transfer.sql` (tabel `inv_transfers`, `inv_transfer_lines`, RPC `inv_transfer_save`).
6. Jalankan `supabase/migrations/20260928120000_inventory_dapur_roles.sql` (role `dapur`, area daftar SO, `inv_stock_value_series`) lalu `supabase/seed/inventory_so_area_nusa_food.sql`.
7. Buat resep produksi di tab Kelola → Resep.

Test logika: `npm run test:inventory`.
