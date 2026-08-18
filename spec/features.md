# Spesifikasi Fitur — Aplikasi POS (Point of Sales)

> Dokumen ini adalah sumber kebenaran (*source of truth*) fitur untuk iterasi pertama.
> Dibaca oleh developer backend (Bun + Elysia) dan frontend (Next.js + shadcn/ui) sebelum dan selama implementasi.
> Prosa dalam Bahasa Indonesia, istilah teknis dibiarkan dalam Bahasa Inggris.

## 1. Metadata Proyek

| Item | Nilai |
|---|---|
| Nama produk (working title) | **FakhriPOS** |
| Tipe | Aplikasi POS ala SaaS, pemakaian pribadi (single outlet) |
| Target pengguna | Fakhri (owner/admin), kasir, manager |
| Backend | Bun + Elysia |
| Frontend | Next.js + shadcn/ui |
| Database | PostgreSQL `db_pos` (via Dokploy di homelab) |
| Deployment | Dokploy (homelab Fakhri) |
| Bahasa UI | Bahasa Indonesia |
| Mata uang | IDR (Rp) |
| Zona waktu | WIB (UTC+7) |
| Struktur repo | Monorepo `/home/fakhrads/projects/pos-app/` (apps/, spec/, tests/) |

## 2. Ringkasan Eksekutif

Aplikasi POS untuk toko kecil/menengah yang dipakai Fakhri sendiri di homelab.
Fokus iterasi pertama (P0): **kasir bisa melayani transaksi dari buka toko sampai tutup toko** — master produk, checkout cepat dengan pembayaran tunai/QRIS/transfer, struk, poin member, diskon & pajak, plus laporan harian dan dashboard agar Fakhri bisa memantau penjualan.

Referensi fitur diambil dari POS SaaS populer (Square POS, Loyverse, Kasir Pintar, POS open source) sebagai **daftar fitur**, bukan tiruan UI. Keputusan utama (kenapa modul tertentu P0/P1/P2) ada di §9.

## 3. Definisi Prioritas

| Prioritas | Arti |
|---|---|
| **P0** | Wajib untuk rilis pertama (MVP). Tanpa ini kasir tidak bisa melayani transaksi sehari-hari. |
| **P1** | Penting, dikerjakan di iterasi berikutnya (1–2 minggu setelah rilis pertama). |
| **P2** | Nice-to-have. Dikerjakan kalau sempat / sesuai kebutuhan nyata. |

## 4. Asumsi & Keputusan Awal (BA)

1. **Single outlet** di fase 1. Struktur data menyiapkan `outlet_id` (default 1) agar multi-outlet bisa ditambahkan tanpa migrasi besar (P1).
2. **Online-only** di P0. Aplikasi berjalan di homelab dengan koneksi internet; offline mode = P2.
3. **Pembayaran non-tunai dicatat manual** (tandai lunas). Tidak ada integrasi payment gateway di P0; dynamic QRIS via gateway = P2.
4. **Uang disimpan sebagai integer rupiah** (bukan float, bukan sen) — IDR tidak punya pecahan sen. Semua perhitungan diskon/pajak dibulatkan ke rupiah terdekat (pembulatan ke bawah untuk poin).
5. **Stok tidak boleh negatif** di P0 (kasir dibatasi qty maksimal = stok tersisa). Toggle "izinkan jual minus stok" = P1.
6. **Pajak (PPN) diterapkan setelah diskon**: `Total = (Subtotal − Diskon) + PPN((Subtotal − Diskon) × rate)`.
7. **Poin member** = `floor(total_bayar_akhir / rate_poin)`; redeem poin = potongan nominal langsung (nilai per poin dikonfigurasi).
8. **HPP (harga pokok) laba** memakai harga beli terakhir per produk pada saat transaksi dicatat (sederhana, cukup untuk toko kecil). Actual/average costing = P2.
9. **Struk dicetak via browser** (`window.print()` dengan CSS lebar 58mm/80mm) + PDF. Dukungan ESC/POS langsung (printer thermal via Web Serial/WebUSB) = P1.
10. **Nomor transaksi**: format `TRX-YYYYMMDD-XXXX` (counter per hari, sequential per outlet).
11. **Waktu disimpan UTC** (`timestamptz`), ditampilkan dalam WIB.

## 5. Peran (Roles) & Matriks Izin

| Aksi | Admin | Manager | Kasir |
|---|---|---|---|
| Login / logout / ganti password | ✅ | ✅ | ✅ |
| Transaksi POS, pembayaran, struk | ✅ | ✅ | ✅ |
| Lihat riwayat transaksi | ✅ | ✅ | ✅ (hari itu saja) |
| Kelola produk, kategori, stok | ✅ | ✅ | ❌ |
| Kelola pelanggan & member | ✅ | ✅ | ✅ (tambah/pilih saat checkout) |
| Diskon manual & redeem poin | ✅ | ✅ | ✅ |
| Lihat laporan penjualan | ✅ | ✅ | ✅ (tanpa laba) |
| Lihat laporan laba (HPP) | ✅ | ✅ | ❌ |
| Dashboard | ✅ | ✅ | ❌ |
| Return / refund | ✅ | ✅ | ✅ (dengan alasan) |
| Kelola pengguna & role | ✅ | ❌ | ❌ |
| Konfigurasi toko, pajak, poin | ✅ | ❌ | ❌ |
| Lihat audit log | ✅ | ❌ | ❌ |

---

## 6. Daftar Modul

| # | Modul | Prioritas | Ringkasan |
|---|---|---|---|
| M1 | Auth & RBAC | **P0** | Login/logout, 3 role, proteksi API & halaman |
| M2 | Master Produk | **P0** | Produk, kategori, barcode, stok, harga, pencarian |
| M3 | Kasir / Transaksi POS | **P0** | Cart, checkout, struk, riwayat transaksi |
| M4 | Pembayaran | **P0** | Tunai, QRIS, transfer; kembalian otomatis |
| M5 | Pelanggan & Member | **P0** | CRUD pelanggan, poin, redeem poin |
| M6 | Diskon & Pajak | **P0** | Diskon manual per item/transaksi, PPN global |
| M7 | Laporan | **P0** | Penjualan/hari, laba, stok menipis, produk terlaris, export CSV |
| M8 | Dashboard | **P0** | Ringkasan statistik hari ini, alert stok |
| M9 | Konfigurasi Toko | **P0** | Profil toko (untuk struk), pengaturan pajak/poin/threshold |
| M10 | Return / Refund | **P1** | Return penuh/sebagian, restock, refund |
| M11 | Audit Log | **P1** | Log mutasi data penting, read-only |
| M12 | Shift & Kas | **P1** | Buka/tutup shift, hitung kas, laporan shift |
| M13 | Ekstra (P2) | **P2** | Multi-outlet, offline, gateway, varian, promo, dll. |

**P0 = 9 modul kecil** (M1–M9) — dalam batas kapasitas 1 iterasi dev oleh 2 developer paralel (backend + frontend).

---

## 7. Detail Fitur per Modul

### M1 — Auth & RBAC (P0)

**Tujuan:** hanya pengguna terdaftar yang bisa mengakses aplikasi; setiap role hanya melihat & melakukan aksi sesuai izinnya.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| AUTH-01 | Login email + password | P0 | JWT access token + refresh token; error message jelas untuk akun salah/nonaktif |
| AUTH-02 | Logout | P0 | Token di-revoke; kembali ke halaman login |
| AUTH-03 | Tiga role bawaan | P0 | `admin`, `manager`, `kasir` sesuai matriks §5 |
| AUTH-04 | Proteksi API & route | P0 | Middleware Elysia (backend) + Next.js middleware (frontend); route yang tidak diizinkan → 403 / redirect |
| AUTH-05 | Ganti password sendiri | P0 | Wajib tahu password lama |
| AUTH-06 | Kelola pengguna | P0 | Admin: buat pengguna (nama, email, password awal, role), aktif/nonaktifkan, reset password |
| AUTH-07 | Sesi berakhir (idle timeout) | P1 | Logout otomatis setelah 30 menit tidak aktif (configurable) |
| AUTH-08 | Rate-limit login | P1 | Maks 5 percobaan gagal → blokir 5 menit |
| AUTH-09 | 2FA (TOTP) | P2 | Opsional untuk akun admin |

**User stories:**
- Sebagai kasir, saya bisa login dengan email dan password supaya saya bisa mulai melayani transaksi.
- Sebagai admin, saya bisa membuat akun untuk kasir dengan role tertentu supaya akses setiap pengguna sesuai tugasnya.
- Sebagai kasir, saya tidak bisa membuka halaman laporan laba supaya informasi keuntungan tidak bocor ke semua orang.

---

### M2 — Master Produk (P0)

**Tujuan:** admin/manager bisa mengelola katalog produk (harga, stok, barcode) dan kasir bisa menemukan produk secepat mungkin saat transaksi.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| PROD-01 | CRUD produk | P0 | Field: nama, SKU (opsional), barcode (opsional), kategori, satuan, harga beli, harga jual, stok awal, status aktif, gambar (P1) |
| PROD-02 | Kategori | P0 | CRUD kategori sederhana (1 level); produk wajib punya kategori |
| PROD-03 | Satuan (unit) | P0 | Pilihan bawaan: pcs, pack, box, kg, gram, liter, meter; CRUD satuan kustom = P1 |
| PROD-04 | Barcode & SKU unik | P0 | Unik per produk; pencarian via scan barcode atau ketik SKU/barcode |
| PROD-05 | Pencarian produk | P0 | Search by nama/SKU/barcode (debounce), dipakai di halaman produk & layar kasir |
| PROD-06 | Stok & mutasi otomatis | P0 | Stok berkurang saat transaksi, bertambah saat return; riwayat mutasi stok = P1 |
| PROD-07 | Stok tidak negatif | P0 | Checkout menolak qty melebihi stok (pesan jelas) |
| PROD-08 | Aktif/nonaktif | P0 | Produk nonaktif tidak muncul di pencarian kasir, tetap tampil di riwayat transaksi & laporan |
| PROD-09 | Threshold stok menipis | P1 | `low_stock_threshold` per produk (default dari pengaturan global) untuk laporan & alert |
| PROD-10 | Foto produk | P1 | Upload gambar (1 per produk), tampil di grid kasir & halaman produk |
| PROD-11 | Import/export CSV | P1 | Bulk tambah/update produk (template disediakan) |
| PROD-12 | Varian produk | P1 | Varian sederhana (ukuran/warna) sebagai produk turunan dengan stok & harga sendiri |
| PROD-13 | Stok adjustment manual | P1 | Ubah stok dengan alasan wajib + otorisasi admin/manager |
| PROD-14 | Cetak label barcode | P2 | Print label 58×40mm untuk produk |

**User stories:**
- Sebagai admin, saya bisa menambah produk dengan harga jual dan stok awal supaya produk langsung bisa dijual di kasir.
- Sebagai kasir, saya bisa mencari produk dengan scan barcode supaya proses checkout cepat.
- Sebagai admin, saya bisa menonaktifkan produk yang tidak dijual lagi supaya tidak muncul di kasir tetapi tetap ada di riwayat transaksi lama.

---

### M3 — Kasir / Transaksi POS (P0)

**Tujuan:** inti aplikasi — kasir bisa menyusun pesanan dan menyelesaikan checkout dalam hitungan detik.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| POS-01 | Keranjang (cart) | P0 | Tambah produk (grid/list, scan barcode, ketik SKU), ubah qty, hapus item; subtotal real-time |
| POS-02 | Info produk di cart | P0 | Nama, harga satuan, qty, subtotal item, stok tersisa saat qty dipilih |
| POS-03 | Checkout | P0 | Konfirmasi ringkasan (item, subtotal, diskon, pajak, total) → pilih metode bayar → simpan transaksi secara **atomik** (1 transaksi DB) |
| POS-04 | Nomor transaksi | P0 | Auto: `TRX-YYYYMMDD-XXXX` (counter harian per outlet) |
| POS-05 | Struk | P0 | Preview + cetak (58mm/80mm via browser print) + PDF; isi: nama toko, alamat, no transaksi, tanggal, item (nama, qty, harga), subtotal, diskon, pajak, total, bayar, kembalian, poin didapat, footer toko |
| POS-06 | Riwayat transaksi | P0 | List transaksi (filter: hari ini/semua, by nomor), detail per transaksi, lihat struk ulang |
| POS-07 | Stok terpotong otomatis | P0 | Saat transaksi sukses, stok tiap item berkurang sesuai qty |
| POS-08 | Hold / unhold cart | P1 | Simpan keranjang sementara (maks 5 cart tersimpan), lanjutkan lagi nanti |
| POS-09 | Re-print struk | P1 | Cetak ulang struk dari riwayat |
| POS-10 | Void transaksi | P1 | Batalkan transaksi yang salah (dengan alasan, otorisasi sesuai role, stok dikembalikan) |
| POS-11 | Shortcut keyboard | P2 | Navigasi kasir via keyboard (F1–F4, Enter, Esc) |
| POS-12 | Cart customer display | P2 | Tampilan harga di layar kedua menghadap pelanggan |

**User stories:**
- Sebagai kasir, saya bisa menambahkan produk ke keranjang dan mengubah jumlahnya supaya saya bisa menyiapkan pesanan pelanggan.
- Sebagai kasir, saya bisa menyelesaikan checkout sehingga transaksi tercatat, stok terpotong, dan struk langsung tampil.

---

### M4 — Pembayaran (P0)

**Tujuan:** kasir bisa menerima pembayaran tunai dan non-tunai dengan catatan yang akurat untuk rekonsiliasi.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| PAY-01 | Metode bayar bawaan | P0 | `Tunai`, `QRIS`, `Transfer` — pilihan saat checkout, tersimpan per transaksi |
| PAY-02 | Tunai + kembalian | P0 | Input nominal bayar; sistem hitung & tampilkan kembalian otomatis; tombol cepat "Uang Pas" |
| PAY-03 | QRIS | P0 | Tampilkan kode QR statis (milik toko) di layar + opsi tandai "sudah dibayar"; catat metode & nominal |
| PAY-04 | Transfer | P0 | Input nomor referensi transfer (opsional) + tandai lunas; bank/nama rekening tidak perlu diverifikasi |
| PAY-05 | Rincian pembayaran tersimpan | P0 | Metode + nominal + referensi per transaksi; dipakai laporan per metode bayar & rekonsiliasi |
| PAY-06 | Kelola metode bayar | P1 | Admin bisa tambah/nonaktifkan metode (mis. "Cashless EDC", "GoPay") |
| PAY-07 | Pembayaran campuran | P1 | Satu transaksi bisa dibayar sebagian tunai + sebagian QRIS/transfer |
| PAY-08 | Tombol nominal cepat | P1 | Quick amount: Uang Pas, 20rb, 50rb, 100rb, 200rb |
| PAY-09 | Utang pelanggan (bayar nanti) | P2 | Transaksi "hutang" tercatat, pelunasan terpisah |
| PAY-10 | Dynamic QRIS via gateway | P2 | Integrasi Midtrans/Xendit untuk QRIS dinamis + notifikasi pembayaran otomatis |

**User stories:**
- Sebagai kasir, saya bisa menerima uang tunai dan sistem menghitung kembalian supaya transaksi cepat dan tidak salah hitung.
- Sebagai kasir, saya bisa mencatat pembayaran QRIS/transfer sebagai lunas supaya pembayaran non-tunai tercatat di laporan.

---

### M5 — Pelanggan & Member (P0)

**Tujuan:** toko bisa mengenali pelanggan, memberikan poin, dan menarik pelanggan kembali.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| CUST-01 | CRUD pelanggan | P0 | Field: nama, no HP (unik, opsional), alamat (opsional); status member aktif/nonaktif |
| CUST-02 | Pilih pelanggan saat checkout | P0 | Pencarian cepat by nama/no HP; bisa buat pelanggan baru langsung dari layar kasir |
| CUST-03 | Histori per pelanggan | P0 | Daftar transaksi & total belanja per pelanggan |
| CUST-04 | Poin otomatis | P0 | `floor(total_bayar / rate_poin)` poin; rate default 1 poin per Rp 1.000 (configurable di M9) |
| CUST-05 | Redeem poin | P0 | Potongan nominal saat checkout: `poin × nilai_poin` (default Rp 10/poin, configurable); poin terpotong saat transaksi sukses |
| CUST-06 | Saldo poin tampil | P0 | Terlihat di detail pelanggan & saat checkout |
| CUST-07 | Tier member | P1 | Tier (Regular/Silver/Gold) otomatis dari total belanja; benefit (diskon khusus) di P1 |
| CUST-08 | QR member | P2 | QR pelanggan untuk scan cepat di kasir |
| CUST-09 | Riwayat redeem poin | P1 | Log poin masuk/keluar per pelanggan |

**User stories:**
- Sebagai kasir, saya bisa memilih pelanggan saat checkout supaya pelanggan otomatis mendapat poin belanja.
- Sebagai kasir, saya bisa memakai poin pelanggan sebagai potongan harga supaya pelanggan merasa dihargai.

---

### M6 — Diskon & Pajak (P0)

**Tujuan:** kasir bisa memberi potongan harga sesuai kesepakatan; perhitungan pajak otomatis dan transparan di struk.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| DISC-01 | Diskon per item | P0 | Persen (%) atau nominal (Rp) per item di keranjang; dihitung ulang real-time |
| DISC-02 | Diskon per transaksi | P0 | Persen/nominal pada subtotal; satu diskon transaksi per checkout |
| DISC-03 | Pajak global (PPN) | P0 | Rate configurable (default 11%, bisa 0%); diterapkan **setelah** diskon (lihat §4.6) |
| DISC-04 | Rincian di struk | P0 | Struk menampilkan: Subtotal, Diskon, DPP, PPN, Total, Bayar, Kembalian |
| DISC-05 | Catatan diskon | P1 | Alasan diskon opsional, tercatat di audit log (siapa, kapan, berapa) |
| DISC-06 | Pajak per produk | P1 | Flag "kena pajak" per produk (mis. sembako bebas PPN) |
| DISC-07 | Promo otomatis | P2 | Aturan promo (min. belanja, buy 1 get 1, diskon kategori) |
| DISC-08 | Voucher | P2 | Kode voucher sekali pakai |

**User stories:**
- Sebagai kasir, saya bisa memberi diskon per item atau per transaksi supaya saya bisa menyesuaikan harga sesuai kesepakatan dengan pelanggan.
- Sebagai admin, saya bisa mengatur persentase pajak supaya total transaksi otomatis sudah termasuk PPN.

---

### M7 — Laporan (P0)

**Tujuan:** Fakhri (admin/manager) bisa memantau performa toko: berapa penjualan, untung/rugi, dan kondisi stok.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| REP-01 | Penjualan per hari | P0 | Filter rentang tanggal (default hari ini): total penjualan, jumlah transaksi, jumlah item terjual, breakdown per metode bayar |
| REP-02 | Laba | P0 | Pendapatan − HPP (harga beli saat transaksi); tampil per hari & per rentang |
| REP-03 | Stok menipis | P0 | Produk dengan stok ≤ threshold, urut dari yang paling menipis; termasuk produk stok 0 |
| REP-04 | Produk terlaris | P0 | Top 10 produk by qty terjual & by revenue, per rentang |
| REP-05 | Export CSV | P0 | Semua laporan bisa diexport CSV (UTF-8, kompatibel Excel/Google Sheets) |
| REP-06 | Laporan per kasir | P1 | Jumlah transaksi & nominal per kasir |
| REP-07 | Laporan return | P1 | Nominal & jumlah return per rentang |
| REP-08 | Laporan member/poin | P1 | Poin diberikan vs diredeem |
| REP-09 | Grafik tren | P2 | Line/bar chart penjualan 7/30 hari |
| REP-10 | Laporan per kategori | P2 | Penjualan dikelompokkan per kategori |

**User stories:**
- Sebagai manager, saya bisa melihat laporan penjualan dan laba per hari supaya saya tahu performa toko.
- Sebagai admin, saya bisa mengekspor laporan ke CSV supaya saya bisa mengolahnya di spreadsheet.

---

### M8 — Dashboard (P0)

**Tujuan:** sekilas kondisi toko hari ini tanpa membuka laporan.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| DASH-01 | Kartu statistik hari ini | P0 | Total penjualan, jumlah transaksi, rata-rata per transaksi, produk terlaris hari ini |
| DASH-02 | Transaksi terbaru | P0 | List 10 transaksi terakhir (live setelah checkout) |
| DASH-03 | Alert stok menipis | P0 | Badge jumlah produk stok menipis → klik ke laporan stok |
| DASH-04 | Grafik 7/30 hari | P1 | Line/bar chart penjualan |
| DASH-05 | Widget return | P1 | Ringkasan return hari ini |

**User stories:**
- Sebagai admin, saya bisa melihat ringkasan penjualan hari ini di satu layar supaya saya bisa memantau toko sekilas.

---

### M9 — Konfigurasi Toko (P0)

**Tujuan:** pengaturan yang memengaruhi tampilan struk dan aturan bisnis (pajak, poin, stok).

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| SET-01 | Profil toko | P0 | Nama toko, alamat, no HP, footer struk (ucapan terima kasih) — **dipakai di struk** |
| SET-02 | Pengaturan pajak | P0 | Rate PPN (%) + toggle aktif |
| SET-03 | Pengaturan poin | P0 | Rate poin (Rp per 1 poin) + nilai poin saat redeem (Rp per poin) |
| SET-04 | Threshold stok global | P0 | Default `low_stock_threshold` untuk semua produk |
| SET-05 | Format struk | P1 | Pilih lebar 58mm/80mm, header/footer kustom |
| SET-06 | Backup database | P1 | Nota: backup otomatis ditangani Dokploy/PostgreSQL (checklist opsional) |

**User stories:**
- Sebagai admin, saya bisa mengisi nama dan alamat toko supaya struk yang dicetak terlihat profesional.

---

### M10 — Return / Refund (P1)

**Tujuan:** menangani pengembalian barang dengan benar: stok kembali, uang dikembalikan, laporan akurat.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| RET-01 | Return penuh/sebagian | P1 | Pilih transaksi → pilih item & qty yang dikembalikan |
| RET-02 | Restock otomatis | P1 | Stok item bertambah sesuai qty return |
| RET-03 | Metode refund | P1 | Tunai kembali / potong ke poin / transfer (catat referensi) |
| RET-04 | Alasan wajib | P1 | Wajib pilih alasan (rusak, salah item, tidak sesuai, lainnya + catatan) |
| RET-05 | Nomor return | P1 | `RET-YYYYMMDD-XXXX`, tercatat sebagai entri terpisah di riwayat |
| RET-06 | Batas waktu | P1 | Return hanya untuk transaksi ≤ 7 hari (configurable) |
| RET-07 | Laporan return | P1 | Bagian dari REP-07 |

**User stories:**
- Sebagai kasir, saya bisa mengembalikan produk yang dibeli pelanggan (dengan alasan) supaya pelanggan puas dan stok kembali tercatat.

---

### M11 — Audit Log (P1)

**Tujuan:** jejak mutasi data penting untuk kepercayaan dan penyelidikan selisih.

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| AUDIT-01 | Catat mutasi penting | P1 | Login/logout, CRUD produk & perubahan harga, diskon besar, void, return, CRUD pengguna, perubahan pengaturan |
| AUDIT-02 | View read-only | P1 | Filter by pengguna/aksi/tanggal; hanya admin |
| AUDIT-03 | Tidak bisa dihapus | P1 | Log tidak bisa diedit/dihapus lewat aplikasi |

**User stories:**
- Sebagai admin, saya bisa melihat riwayat perubahan harga produk supaya saya tahu siapa mengubah apa dan kapan.

---

### M12 — Shift & Kas (P1)

**Tujuan:** mencocokkan uang di laci kas dengan catatan sistem per shift (pola standar POS).

| ID | Fitur | Prio | Deskripsi |
|---|---|---|---|
| SHIFT-01 | Buka shift | P1 | Kasir + saldo awal laci kas |
| SHIFT-02 | Tutup shift | P1 | Ringkasan: total penjualan per metode, total tunai diharapkan, selisih vs hitung fisik |
| SHIFT-03 | Laporan shift | P1 | Riwayat shift + selisih |

**User stories:**
- Sebagai kasir, saya bisa menutup shift dan melihat selisih kas supaya laci kas selalu cocok dengan catatan.

---

### M13 — Ekstra / P2 (Nice-to-have)

| ID | Fitur | Deskripsi |
|---|---|---|
| EXT-01 | Multi-outlet | Pilih outlet saat login; laporan per outlet & gabungan |
| EXT-02 | Offline mode | Transaksi berjalan tanpa internet, sinkron saat online |
| EXT-03 | Payment gateway | Dynamic QRIS + auto-confirm (Midtrans/Xendit) |
| EXT-04 | Promo & voucher | Aturan diskon otomatis, kode voucher |
| EXT-05 | Utang pelanggan | Bayar nanti, pelunasan terpisah |
| EXT-06 | 2FA TOTP | Untuk akun admin |
| EXT-07 | Notifikasi harian | Ringkasan penjualan via WA/email tiap tutup hari |
| EXT-08 | Mobile-friendly kasir | Layout kasir yang nyaman di tablet/HP |
| EXT-09 | Public REST API | Akses data untuk integrasi lain |
| EXT-10 | E-invoice / faktur pajak | Untuk usaha kena pajak |

---

## 8. Yang Sengaja TIDAK Masuk P0 (dan kenapa)

| Fitur | Alasan ditunda |
|---|---|
| Multi-outlet | Fakhri punya 1 toko; struktur data sudah menyiapkan `outlet_id` |
| Offline mode | Kasir selalu online di homelab; kompleksitas sinkronisasi tinggi |
| Payment gateway (QRIS dinamis) | Biaya & setup akun merchant; QRIS statis cukup untuk fase 1 |
| Varian produk | Menambah kompleksitas skema stok & cart; P1 kalau kebutuhan muncul |
| Promo otomatis / voucher | Aturan bisnis kompleks; diskon manual sudah menutup 90% kebutuhan |
| Utang pelanggan | Risiko akuntansi & alur pelunasan; P2 |
| Shift & kas (P1) | Penting tapi bisa menyusul — transaksi tetap valid tanpa shift |
| ESC/POS langsung | Printer thermal via browser print sudah cukup di fase 1 |

## 9. Catatan untuk Developer (Cross-cutting)

- **API design**: REST under `/api/v1`, JSON; error envelope konsisten `{ success, message, data }`; semua endpoint mutasi memerlukan auth (kecuali login).
- **Transaksi checkout = satu transaksi DB** (atomic): insert `transactions` + `transaction_items` + `payments` + update `products.stock` + insert `customer_points_log`. Gagal di tengah → rollback semua.
- **Concurrency stok**: gunakan update atomik `UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty`; jika 0 row affected → tolak item dengan pesan stok tidak cukup.
- **Money**: integer rupiah di DB (`numeric(12,0)` atau `bigint`); jangan pernah float.
- **Pembulatan**: diskon persen → `round(subtotal_item * pct / 100)` per item; PPN → `round(dpp * rate / 100)`; poin → `floor(total / rate)`.
- **Timestamp**: `timestamptz` UTC di DB; frontend render WIB (`Asia/Jakarta`) via date-fns/Luxon.
- **ID**: `cuid2`/UUID untuk semua tabel; nomor transaksi/return terpisah (format harian) untuk tampilan.
- **Pagination**: semua list (produk, transaksi, pelanggan, laporan) pakai cursor/offset pagination + search.
- **Soft delete** untuk produk & pelanggan (flag `deleted_at`) agar riwayat transaksi tidak putus.
- **Laba**: hitung di query laporan sebagai `Σ(qty × (harga_jual − harga_beli)) − diskon`; harga beli di-snapshot ke `transaction_items` saat checkout.
- **Frontend routes**: `/login`, `/pos` (kasir), `/products`, `/customers`, `/transactions`, `/reports`, `/dashboard`, `/settings`, `/users` (admin). Guard by role.
- **Seed data**: kategori awal (Makanan, Minuman, Snack, Lainnya), satuan (pcs, pack, kg), akun admin default, pengaturan toko & pajak default.
