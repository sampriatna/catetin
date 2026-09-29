# Modul Dapur — SO shift, waste, produksi

Halaman: `/dapur` (tombol di checklist kasir & purchasing, dan Pengaturan → Dapur & Stok). Hanya untuk bisnis F&B.

## Fitur

| Tab | Siapa | Isi |
|---|---|---|
| Hari Ini | semua (halaman pertama) | Daftar kerja hari ini untuk lokasinya: SO akhir shift (✓ + jam), terima kiriman gudang, permintaan, waste, produksi, bahan menipis. Gudang: permintaan outlet menunggu. Owner/admin: status SO semua lokasi + nilai stok. |
| SO Shift | semua | Hitung stok fisik memakai **daftar SO outlet** (nama, grup, dan satuan persis seperti laporan WA staf: "Beras … karung", "Pakcoy … Kg", "Gyoza … porsi"), otomatis dikonversi ke satuan master. Tombol **Tempel dari WA** mengisi form dari pesan SO biasa; bagian *WASTE* langsung dibawa ke form Waste, bagian *Menipis/Limit* jadi catatan. Bisa lampirkan foto. Isian tersimpan otomatis di HP sampai dikirim. |
| Waste | semua (purchasing area mis. Jagasatru: pilih lokasi) | Pilih bahan + jumlah + alasan (basi, jatuh, salah masak, sisa, rusak, lainnya) + foto bukti. Nilai rupiah otomatis. |
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

## Audit stok harian (Tahap A)

Sumber kebenaran = SO fisik. Penjualan belum dipakai (mode pemantauan harian).

- **Barang Masuk** (tab baru): pembelian / retur / koreksi / lainnya, satuan bebas, nilai dari modal. Kasir & dapur hanya untuk outletnya.
- **Waste**: staf memilih nama yang biasa dipakai dan mengisi satuan apa pun (porsi, gram, ml, pcs, kg, L); Rp dihitung otomatis dari modal. Penyebab: basi, rusak, tumpah, salah produksi/gosong, kualitas, sisa, retur, staff meal, complimentary, trial/R&D, lainnya.
- SO dan waste menyimpan **area** (dapur / bar) → status SO per area: Gudang, KBU Kitchen, KBU Bar, Kisamen Kitchen, Kisamen Bar, Samtaro.
- `inv_stock_movements` (SQL) mengumpulkan SO, waste, barang masuk, produksi, kiriman keluar/diterima dalam satuan master. `auditMovements` (JS) menghitung per pasangan SO: **stok seharusnya = SO lalu + masuk − keluar**, **selisih = SO − seharusnya** (SO tidak diubah), lalu mencari:
  - naik tanpa barang masuk (keyakinan sedang),
  - SO sama persis 3× tanpa pergerakan (rendah),
  - berkurang jauh di atas pola biasanya tanpa waste → *menunggu data penjualan* (rendah),
  - angka selalu bulat/estimasi (info),
  - waste ≥ Rp50.000 per barang dalam 7 hari (tinggi).
- Prioritas dari nilai Rp: Info < Rp25rb ≤ Pantau < Rp100rb ≤ Peringatan < Rp500rb ≤ Kritis; berulang ≥3× naik satu tingkat.
- Owner/admin: kartu **Insight stok** di Hari Ini dan tab **Audit** (filter lokasi & prioritas, rincian buku pergerakan per barang).

## Penjualan & resep menu (Tahap B)

- **Resep Menu** (owner/admin/purchasing): bahan untuk **1 porsi** tiap menu per outlet (KBU, KSM, SMT), satuan bebas (gr, ml, pcs, porsi, atau satuan SO seperti btl) → disimpan dalam satuan master. Modal per porsi dan food cost % terhadap harga jual dihitung dari modal bahan saat ini. Tabel `inv_menus`, `inv_menu_lines`.
- **Penjualan** (owner/admin): upload export ESB *Sales Menu Recapitulation Report* (Branch All; outlet dibaca dari kategori "FOOD KISAMEN", "DRINK KOPI BURI UMAH", "SAM DIMSUM") atau CSV/Excel sederhana (kolom Menu + Qty, opsional Tanggal/Outlet/Net Sales). Kategori yang tidak dikenali bisa dipilih outletnya atau diabaikan. Baris refund (Sales Type ≠ Sales) dilewati. Upload ulang periode yang bertumpuk untuk outlet yang sama **mengganti** data lama. RPC `inv_sales_save`; data penjualan hanya bisa dibaca owner/admin.
- **Cocokkan menu POS ↔ resep**: setiap nama menu POS disimpan sekali per outlet (`inv_menu_aliases`); owner memilih resepnya, membuat resep baru, atau **Abaikan** (tidak memakai stok). Disarankan otomatis dari kemiripan nama; diurutkan dari omset terbesar.
- `inv_stock_movements` menambah tipe **jual** (rekap harian) dan **jual_periode** (rekap beberapa hari) = qty terjual × bahan per porsi, ditaruh pukul 12.00 WIB di tanggalnya.
- **Audit harian** memakai penjualan harian bila setiap hari di antara dua SO punya rekap harian untuk outlet itu: seharusnya = SO lalu + masuk − keluar − terjual. Berkurang lebih banyak dari itu → temuan **kurang** (keyakinan sedang, tinggi bila berulang ≥3×). Tanpa rekap harian, temuan "berkurang" tetap *menunggu data penjualan*.
- **Penjualan vs Pemakaian** (tab Audit, per periode upload atau tanggal bebas): per bahan per outlet, **aktual** = SO sebelum periode + masuk − keluar − SO akhir periode, **teori** = terjual × resep, selisih dalam satuan & Rp dengan prioritas. Selisih < 10% atau di bawah toleransi timbangan = Info. Bahan yang terpakai menurut SO tapi tidak ada di resep menu mana pun juga ditandai.
- `supabase/seed/inventory_menus_nusa_food.sql`: resep menu dari sheet HPP menu KBU, minuman KBU, dan HPP Kisamen + nama POS ESB (Sep 2026) yang sudah cocok. Bahan yang belum ada di master (nasi, lalapan, es batu, kemasan per pcs, sambal per porsi, kopi espresso, sirup yang ukuran botolnya belum diketahui) belum dimasukkan — lengkapi di tab Resep Menu.

## Audit mingguan & AI (Tahap C)

- **Laporan audit mingguan** (tab Audit, owner/admin): pilih minggu ini / minggu lalu / 2–3 minggu lalu (Senin–Minggu). Server (`/api/dapur/audit-mingguan`) menghitung ulang dari SO, waste, barang masuk, produksi, kiriman, dan penjualan dengan izin user (RLS), lalu Claude menulis ringkasan, poin yang perlu dicek, dan langkah minggu depan dalam bahasa netral. Tanpa `ANTHROPIC_API_KEY` atau bila AI gagal → ringkasan otomatis. Disimpan di `inv_audit_reports` (satu per periode; "Hitung ulang" menimpa). Bisa dikirim ke WA.
- **Audit mundur**: karena SO tidak pernah diubah dan semua pergerakan tersimpan, laporan minggu-minggu lalu bisa dibuat kapan saja; data penjualan yang di-upload belakangan ikut terpakai saat dihitung ulang.
- **Tindak lanjut temuan**: buka temuan di tab Audit → isi hasil pengecekan → *Sudah dicek — wajar* / *Perlu tindakan* / *Sudah ditindaklanjuti* (`inv_audit_notes`). Temuan wajar/selesai tidak dihitung lagi di kartu Insight, daftar Audit, maupun laporan mingguan; *Perlu tindakan* tetap tampil.

## Tampilan per peran

Satu sumber izin: `lib/dapurAccess.js` (`dapurAccess(user)` → `can(cap)`, `canTab(tab)`, lokasi & area). Komponen tidak mengecek nama role sendiri. URL langsung `?tab=…` yang tidak diizinkan diarahkan ke Hari Ini dengan pesan "Menu ini tidak tersedia untuk peran kamu." Role yang tidak dikenal tidak mendapat akses.

| Role di database | Profil | Menu |
|---|---|---|
| owner, admin | Owner | Semua: Hari Ini (ringkasan lintas lokasi), SO, Waste, Barang Masuk, Produksi, Kirim Stok, Stok & Riwayat, Audit, Penjualan, Resep Menu, Kelola; pilih lokasi & daftar bebas |
| purchasing (outlet kosong) | Purchasing & Gudang — pengaturan Nusa Food sekarang | Hari Ini (belanja, barang masuk, SO gudang, permintaan menunggu), SO Gudang, Waste Gudang, Barang Masuk (lokasi bebas), Produksi Gudang, Kirim Stok, Stok & Riwayat, Resep Menu, Kelola |
| purchasing + outlet `GDG`/`GUDANG` | Gudang | sama seperti di atas tanpa tugas belanja |
| purchasing + area lain (mis. area dompet) | Purchasing | Hari Ini (catat belanja, barang masuk, stok minimum), Barang Masuk (hanya pembelian/retur, lokasi bebas), Stok & Riwayat (lihat), Resep Menu, Kelola |
| dapur + KBU/KSM/SMT | Outlet Dapur | Hari Ini, SO Dapur, Waste Dapur, Produksi (resep yang hasilnya ada di daftar dapur), Minta & Terima, Stok & Riwayat outletnya |
| kasir + KBU/KSM/SMT | Outlet Bar | sama, dengan daftar bar (Samtaro: baris tanpa area = semua) |

Purchasing boleh input di semua lokasi (keputusan owner). Kelola & Resep Menu: owner, purchasing, gudang — tidak untuk outlet.

Staf outlet hanya melihat barang yang ada di daftar SO outletnya (SO, Waste). Barang yang tercatat di outlet tapi tidak ada di daftarnya bisa dirapikan di **Kelola → Cek Lokasi** (dikelompokkan: bahan produksi gudang, bahan lain, kemasan & kebersihan) dengan tombol *Lepas dari outlet*.

Permintaan & kiriman stok menyimpan bagian (`inv_transfers.area`): akun dapur selalu `dapur`, kasir `bar` (Samtaro tanpa bagian). Dapur tidak melihat/menerima kiriman bar dan sebaliknya; kiriman lama tanpa bagian terlihat keduanya.

**SO awal**: lokasi yang belum pernah di-SO menampilkan tugas "SO awal" di Hari Ini dan petunjuk di form SO — hitung semua barang (yang habis tekan *Habis*); angka ini jadi stok & nilai awal. Untuk gudang: purchasing/gudang buka Dapur & Stok → **SO Gudang**.

Lokasi outlet & gudang otomatis (pemilih lokasi hanya tampil bila ada lebih dari satu pilihan). Bagian dapur/bar diambil dari `inv_so_template.area`. Shift & tanggal otomatis, dibuka lewat "Ubah". Waste, produksi, dan permintaan stok ada di "Aksi lain", bukan tugas wajib; permintaan outlet dan kiriman hanya jadi tugas bila memang menunggu.

## Checklist beranda

- **Kasir** (bar KBU, minuman KSM, Samtaro): tugas wajib **SO Stok Akhir Shift** di checklist harian bersama omset/SDM/sosmed. Selesai (✓) setelah akun itu mengirim SO hari ini. **Terima Kiriman Gudang** jadi mendesak kalau ada kiriman yang belum dicek.
- **Purchasing (gudang)**: **SO Gudang** dan **Permintaan Outlet (n)**, mendesak kalau ada permintaan menunggu.
- **Akun dapur**: langsung ke `/dapur` → Hari Ini (tanpa saldo).

## Resep produksi

`supabase/seed/inventory_recipes_kisamen.sql` membuat 30 resep dari sheet HPP Kisamen (Bahan Olahan Produksi): dimsum, gyoza, udang keju, dimsum goreng, bumbu Paitan/Shoyu/Madara/Hashirama/Tantamen/Atomic/Miso/Spicy, chili oil, ajitama, karage, cornmilk, ubee, tare, minyak daun bawang, saus-saus, sea salt foam, caramel, topping beef. Bahan yang belum ada dibuat dari Master Bahan Gudang sheet yang sama. Qty resep dikonversi ke satuan master (kecap ABC 1 drigen = 6 L, garam 1 pcs = 250 gr, telur 1 pcs ≈ 60 gr, minyak wijen 1 btl = 620 ml, kulit dimsum 1 pack = 100 lembar, mirin 1 btl = 1 L).

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
7. Jalankan `supabase/migrations/20260929090000_inventory_audit_tahap_a.sql` (area, barang masuk, `inv_stock_movements`).
8. Jalankan `supabase/migrations/20260930090000_inventory_sales_bom.sql` (resep menu, penjualan, `inv_sales_save`, tipe `jual` di `inv_stock_movements`) lalu `supabase/seed/inventory_menus_nusa_food.sql`.
9. Jalankan `supabase/migrations/20261001090000_inventory_audit_mingguan.sql` (laporan audit & catatan tindak lanjut). Ringkasan AI memakai `ANTHROPIC_API_KEY` yang sama dengan fitur AI lain.
10. Jalankan `supabase/migrations/20261002090000_inventory_transfer_area.sql` (bagian dapur/bar pada permintaan & kiriman stok).
11. Buat resep produksi di tab Kelola → Resep.

Test logika: `npm run test:inventory`.
