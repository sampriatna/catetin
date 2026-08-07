# Audit — Double input Samtaro (lanjutan sync gagal)

## Gejala

Kasir Samtaro melihat toast **Gagal simpan ke awan** lalu transaksi/omset terlihat **dobel** setelah input ulang atau tap berkali-kali.

## Akar masalah

1. **Omset laporan (sudah di PR #9)**  
   Cash tx id mengikuti `reportId` → hapus + kirim ulang / race merge membuat 2 omset tunai laci. Diperbaiki dengan id kanonik `t_cash_<OUTLET>_<DATE>`.

2. **Catat transaksi + sync gagal (celah sisa)**  
   - `addTx` menampilkan toast sukses **sebelum** `saveAppState` selesai.  
   - Tombol **Simpan** di tinjauan tidak punya guard busy → double-tap = 2 id berbeda (`t` + Date.now()).  
   - Saat jaringan putus, toast error “data masih di HP” tanpa “jangan input ulang” → kasir mengisi lagi → **dobel nyata**.

## Patch ini

| Area | Perubahan |
|------|-----------|
| `CatatTransaksi` | Guard busy + disabled saat Simpan |
| `addTx` | `addTxBusyRef`; `await scheduleImmediateSave`; sukses hanya setelah sync; gagal → pesan jangan input ulang (data lokal tetap, form tutup) |
| Toast sync error | Tambah teks **jangan input ulang** |

## Cara pakai di lapangan

1. Deploy patch ini + pastikan PR #9 sudah live.  
2. Jika laci SMT masih selisih karena data lama: Settle Laporan → **Hapus laporan & bersihkan duplikat omset** → tunggu toast sukses → kasir kirim **sekali**.  
3. Jika muncul gagal awan: **jangan isi ulang** — tap ☁️.
