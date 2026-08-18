# User Stories P0 — Aplikasi POS (Iterasi Pertama)

> 22 user story prioritas **P0** dalam format singkat (Given/When/Then, bukan Gherkin penuh).
> Mapping ke modul & fitur di `features.md` (kolom `Ref`).
> Role: **Admin** = owner/pemilik toko, **Manager** = operasional, **Kasir** = petugas layanan.

---

## A. Auth & RBAC (M1)

### US-01 — Login Kasir
**Sebagai** kasir, **saya bisa** login dengan email dan password **supaya** saya bisa membuka layar kasir dan melayani transaksi.
- **Given** saya punya akun kasir yang aktif
- **When** saya memasukkan email dan password yang benar
- **Then** saya masuk ke aplikasi dan hanya melihat menu yang diizinkan untuk role kasir

*Ref: AUTH-01, AUTH-03, AUTH-04*

### US-02 — Admin Membuat Akun Kasir
**Sebagai** admin, **saya bisa** membuat akun pengguna baru dengan role tertentu **supaya** tiap orang hanya punya akses sesuai tugasnya.
- **Given** saya login sebagai admin
- **When** saya membuat pengguna dengan nama, email, password awal, dan role "kasir"
- **Then** pengguna tersebut bisa login dan aksesnya dibatasi sesuai matriks role

*Ref: AUTH-06*

---

## B. Master Produk (M2)

### US-03 — Tambah Produk Baru
**Sebagai** admin, **saya bisa** menambah produk baru dengan harga dan stok awal **supaya** produk tersebut langsung bisa dijual di kasir.
- **Given** saya membuka halaman Produk
- **When** saya mengisi nama, kategori, satuan, harga beli, harga jual, dan stok awal lalu menyimpan
- **Then** produk muncul di daftar dan bisa dicari/dipindai di layar kasir

*Ref: PROD-01, PROD-02, PROD-06*

### US-04 — Ubah Harga Jual
**Sebagai** manager, **saya bisa** mengubah harga jual produk **supaya** harga baru berlaku untuk transaksi berikutnya.
- **Given** produk "Kopi Susu" aktif dengan harga Rp 15.000
- **When** saya mengubah harga jual menjadi Rp 17.000 dan menyimpan
- **Then** transaksi baru memakai harga Rp 17.000, sedangkan transaksi lama tidak berubah

*Ref: PROD-01*

### US-05 — Scan Barcode
**Sebagai** kasir, **saya bisa** memindai barcode produk **supaya** produk langsung masuk keranjang tanpa mengetik.
- **Given** produk punya barcode/SKU yang terdaftar
- **When** saya scan barcode atau mengetik kodenya di layar kasir
- **Then** produk langsung ditambahkan ke keranjang dengan qty 1

*Ref: PROD-04, PROD-05, POS-01*

### US-06 — Nonaktifkan Produk
**Sebagai** admin, **saya bisa** menonaktifkan produk yang tidak dijual lagi **supaya** produk tidak muncul di kasir tetapi tetap ada di riwayat transaksi.
- **Given** produk "Teh Botol 350ml" pernah terjual
- **When** saya menonaktifkan produk tersebut
- **Then** produk tidak muncul di pencarian kasir tetapi tetap tampil di riwayat & laporan lama

*Ref: PROD-08*

---

## C. Kasir / Transaksi POS (M3)

### US-07 — Susun Keranjang
**Sebagai** kasir, **saya bisa** menambah/mengurangi jumlah item di keranjang **supaya** pesanan pelanggan sesuai permintaan.
- **Given** keranjang berisi "Nasi Goreng" qty 1
- **When** saya menambah qty menjadi 2 lalu menghapus item lain
- **Then** subtotal terhitung ulang real-time sesuai isi keranjang

*Ref: POS-01, POS-02*

### US-08 — Checkout Berhasil
**Sebagai** kasir, **saya bisa** menyelesaikan checkout **supaya** transaksi tercatat, stok terpotong, dan struk tampil.
- **Given** keranjang berisi minimal 1 item dan metode bayar sudah dipilih
- **When** saya menekan "Bayar" dan konfirmasi
- **Then** sistem menyimpan transaksi (atomik), mengurangi stok tiap item, dan menampilkan struk

*Ref: POS-03, POS-04, POS-05, POS-07*

### US-09 — Stok Tidak Cukup
**Sebagai** kasir, **saya bisa** melihat peringatan saat qty melebihi stok **supaya** saya tidak menjual barang yang stoknya tidak ada.
- **Given** stok "Air Mineral" = 2
- **When** saya mencoba mengisi qty 3
- **Then** qty ditolak/dibatasi menjadi 2 dengan pesan "Stok tidak mencukupi (sisa 2)"

*Ref: PROD-07, POS-01*

### US-10 — Cetak Struk
**Sebagai** kasir, **saya bisa** mencetak atau mengunduh struk setelah checkout **supaya** pelanggan mendapat bukti pembayaran.
- **Given** transaksi baru saja selesai
- **When** saya menekan "Cetak Struk" atau "Unduh PDF"
- **Then** struk menampilkan nama toko, nomor transaksi, rincian item, subtotal, diskon, pajak, total, bayar, kembalian, dan poin

*Ref: POS-05*

### US-11 — Lihat Riwayat Transaksi
**Sebagai** kasir, **saya bisa** mencari transaksi berdasarkan nomor **supaya** saya bisa menjawab pertanyaan pelanggan tentang pembelian sebelumnya.
- **Given** ada transaksi hari ini
- **When** saya membuka halaman Riwayat dan mencari nomor transaksi
- **Then** detail transaksi (item, pembayaran, struk) tampil

*Ref: POS-06*

---

## D. Pembayaran (M4)

### US-12 — Bayar Tunai dengan Kembalian
**Sebagai** kasir, **saya bisa** menerima uang tunai dan sistem menghitung kembalian **supaya** transaksi cepat dan tidak salah hitung.
- **Given** total belanja Rp 45.500
- **When** saya memilih "Tunai" dan memasukkan nominal Rp 50.000
- **Then** sistem menampilkan kembalian Rp 4.500 sebelum transaksi disimpan

*Ref: PAY-02*

### US-13 — Bayar QRIS
**Sebagai** kasir, **saya bisa** mencatat pembayaran QRIS sebagai lunas **supaya** pembayaran non-tunai tercatat di laporan.
- **Given** pelanggan memilih bayar QRIS
- **When** saya memilih "QRIS" di checkout
- **Then** kode QR toko tampil dan setelah saya tandai "Sudah Dibayar", transaksi tersimpan dengan metode QRIS

*Ref: PAY-03*

### US-14 — Bayar Transfer
**Sebagai** kasir, **saya bisa** mencatat pembayaran transfer dengan nomor referensi **supaya** pembayaran bisa direkonsiliasi nanti.
- **Given** pelanggan transfer ke rekening toko
- **When** saya memilih "Transfer" dan mengisi nomor referensi (opsional) lalu menandai lunas
- **Then** transaksi tersimpan dengan metode transfer dan referensi tercatat

*Ref: PAY-04, PAY-05*

---

## E. Pelanggan & Member (M5)

### US-15 — Tambah Pelanggan Saat Checkout
**Sebagai** kasir, **saya bisa** membuat pelanggan baru langsung dari layar kasir **supaya** pelanggan bisa mendapat poin tanpa mengganggu alur jualan.
- **Given** pelanggan belum terdaftar
- **When** saya mengisi nama (dan no HP) saat checkout lalu menyimpan
- **Then** pelanggan tersimpan dan transaksi ini tercatat atas nama pelanggan tersebut

*Ref: CUST-01, CUST-02*

### US-16 — Poin Otomatis
**Sebagai** kasir, **saya bisa** memastikan pelanggan mendapat poin dari belanjanya **supaya** program member berjalan tanpa hitung manual.
- **Given** pelanggan terdaftar dan rate poin 1 poin per Rp 1.000
- **When** transaksi lunas sebesar Rp 50.000 atas nama pelanggan tersebut
- **Then** saldo poin pelanggan bertambah 50 poin

*Ref: CUST-04*

### US-17 — Redeem Poin
**Sebagai** kasir, **saya bisa** memakai poin pelanggan sebagai potongan harga **supaya** pelanggan merasakan manfaat member.
- **Given** pelanggan punya 100 poin dengan nilai Rp 10 per poin
- **When** saya memilih "Pakai Poin" saat checkout
- **Then** total transaksi berkurang Rp 1.000 dan saldo poin pelanggan terpotong 100

*Ref: CUST-05*

---

## F. Diskon & Pajak (M6)

### US-18 — Diskon Manual
**Sebagai** kasir, **saya bisa** memberi diskon persen atau nominal per item maupun per transaksi **supaya** harga bisa disesuaikan dengan kesepakatan.
- **Given** keranjang berisi item dengan subtotal Rp 100.000
- **When** saya menambahkan diskon transaksi 10%
- **Then** subtotal, pajak, dan total terhitung ulang dengan diskon Rp 10.000

*Ref: DISC-01, DISC-02, DISC-03*

### US-19 — Pajak di Struk
**Sebagai** kasir, **saya bisa** menampilkan rincian pajak di struk **supaya** total yang dibayar bisa dijelaskan ke pelanggan.
- **Given** pajak PPN 11% aktif
- **When** transaksi selesai dengan subtotal Rp 100.000 dan tanpa diskon
- **Then** struk menampilkan DPP Rp 100.000, PPN Rp 11.000, dan total Rp 111.000

*Ref: DISC-03, DISC-04*

---

## G. Laporan (M7)

### US-20 — Laporan Penjualan Harian
**Sebagai** manager, **saya bisa** melihat laporan penjualan per hari dengan breakdown metode bayar **supaya** saya tahu performa toko dan arus kas.
- **Given** ada transaksi hari ini (tunai & QRIS)
- **When** saya membuka Laporan → Penjualan dengan rentang hari ini
- **Then** tampil total penjualan, jumlah transaksi, jumlah item, dan breakdown per metode bayar

*Ref: REP-01*

### US-21 — Laba Per Hari
**Sebagai** admin, **saya bisa** melihat laba (pendapatan − HPP) per hari **supaya** saya tahu untung bersih toko.
- **Given** transaksi hari ini mencatat harga jual dan harga beli tiap item
- **When** saya membuka Laporan → Laba
- **Then** tampil pendapatan, HPP, dan laba kotor untuk rentang yang dipilih

*Ref: REP-02*

### US-22 — Stok Menipis
**Sebagai** admin, **saya bisa** melihat daftar produk dengan stok di bawah ambang batas **supaya** saya bisa belanja ulang sebelum kehabisan.
- **Given** beberapa produk punya stok ≤ threshold
- **When** saya membuka Laporan → Stok Menipis
- **Then** produk tersusun dari stok paling menipis, lengkap dengan sisa stok dan harga beli

*Ref: REP-03*

### US-23 — Produk Terlaris
**Sebagai** manager, **saya bisa** melihat produk terlaris dalam rentang tanggal **supaya** saya tahu produk mana yang perlu stok lebih banyak.
- **Given** ada transaksi dalam 7 hari terakhir
- **When** saya membuka Laporan → Produk Terlaris
- **Then** tampil top 10 produk berdasarkan qty terjual dan revenue

*Ref: REP-04*

### US-24 — Export CSV
**Sebagai** admin, **saya bisa** mengekspor laporan ke CSV **supaya** saya bisa mengolah datanya di spreadsheet.
- **Given** saya sedang melihat sebuah laporan
- **When** saya menekan "Export CSV"
- **Then** file CSV (UTF-8) terunduh dengan kolom sesuai laporan yang sedang dibuka

*Ref: REP-05*

---

## H. Dashboard (M8)

### US-25 — Ringkasan Hari Ini
**Sebagai** admin, **saya bisa** melihat ringkasan penjualan hari ini di dashboard **supaya** saya memantau toko sekilas tanpa membuka laporan.
- **Given** ada transaksi dan produk stok menipis hari ini
- **When** saya membuka Dashboard
- **Then** tampil total penjualan, jumlah transaksi, produk terlaris hari ini, transaksi terbaru, dan badge jumlah produk stok menipis

*Ref: DASH-01, DASH-02, DASH-03*

---

## I. Konfigurasi Toko (M9)

### US-26 — Profil Toko di Struk
**Sebagai** admin, **saya bisa** mengisi nama, alamat, dan footer toko **supaya** struk yang dicetak terlihat profesional.
- **Given** saya membuka Pengaturan → Profil Toko
- **When** saya mengisi nama toko, alamat, dan footer lalu menyimpan
- **Then** struk baru menampilkan informasi tersebut di header dan footer

*Ref: SET-01*

---

## Lampiran — Ringkasan Coverage

| Modul | Jumlah Story | ID |
|---|---|---|
| M1 Auth & RBAC | 2 | US-01, US-02 |
| M2 Master Produk | 4 | US-03, US-04, US-05, US-06 |
| M3 Kasir / POS | 5 | US-07, US-08, US-09, US-10, US-11 |
| M4 Pembayaran | 3 | US-12, US-13, US-14 |
| M5 Pelanggan & Member | 3 | US-15, US-16, US-17 |
| M6 Diskon & Pajak | 2 | US-18, US-19 |
| M7 Laporan | 5 | US-20, US-21, US-22, US-23, US-24 |
| M8 Dashboard | 1 | US-25 |
| M9 Konfigurasi | 1 | US-26 |
| **Total** | **26** | |

> Catatan: 26 story (sedikit di atas rentang 15–25 karena M7 sengaja dibuat 5 story agar laporan — modul paling sering diremehkan — punya acceptance criteria yang jelas). Semua story P0 dapat diimplementasikan paralel: backend menyiapkan API per modul, frontend mengonsumsi secara bertahap.
