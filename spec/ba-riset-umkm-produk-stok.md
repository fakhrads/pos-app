# Riset BA — Praktik UMKM Indonesia untuk Modul Produk & Stok (M2)

> **Proyek:** FakhriPOS — POS (Bun + Elysia + Drizzle, Next.js)
> **Peran:** Business Analyst — riset praktik nyata UMKM Indonesia
> **Tanggal:** 19 Agustus 2026
> **Status:** Masukan untuk menyelaraskan `features.md` (M2, M7, M9) & `db-schema.md` dengan kebutuhan riil pasar
> **Sumber:** jurnal pengabdian/penelitian UMKM (toko kelontong, F&B, ritel), dokumentasi & blog POS lokal (Moka, majoo, Pawoon, Kasir Pintar, Kasaba, Youtap, Notix, AuliaSoft, iPos 5, Erzap, BEST ERP), regulasi BPOM/PIRT. Daftar sumber di §6.

---

## 1. Ringkasan Eksekutif

Riset dari studi lapangan (toko kelontong, warung, F&B, ritel kecil) menunjukkan pola konsisten:

1. **Mayoritas UMKM masih mencatat stok manual** (buku/ingatan/Excel) → selisih stok, overselling, penumpukan barang, dan barang kadaluarsa adalah masalah #1 (banyak studi pengabdian & penelitian).
2. **Pola beli = grosir, jual = eceran.** Toko membeli dalam `dus/lusin/kodi/renceng` lalu menjual per `pcs/bungkus`. Multisatuan + harga per satuan adalah fitur yang **paling sering dipasarkan** POS lokal (Kasir Pintar, majoo, Kasaba, AuliaSoft).
3. **Sebab selisih stok terbesar** (studi ritel frozen food): barang datang tidak langsung di-input, barang rusak/expired tidak terdata (33% kasus), retur tercampur stok aktif, mutasi telat dicatat, salah input, pencurian.
4. **Stok minus di sistem** sering terjadi di UMKM karena transaksi tidak real-time — FakhriPOS sudah benar dengan menolak stok negatif (PROD-07) + update atomik.
5. **Kadaluarsa & FEFO** penting untuk F&B, sembako (susu UHT, makanan kemasan), kosmetik — beberapa POS lokal (majoo) sudah punya batch number + expired date.
6. **Konsinyasi (titipan) dan kredit/hutang pelanggan** lazim di toko oleh-oleh, warung, retail kecil — keduanya belum di skema stok FakhriPOS (kredit sudah P2 di PAY-09).

**Kesimpulan utama untuk spec:** keputusan P0 existing sudah 90% tepat (ledger stok, stok non-negatif, snapshot harga, threshold). Gap terbesar: **multisatuan + konversi** (diusulkan naik ke P1), **stok opname/adjustment + laporan selisih** (naik ke P1-awal), **expiry date + laporan hampir expired** (tambah P1/P2), dan **produk jasa/tanpa stok** (flag kecil, murah).

---

## 2. Profil & Praktik UMKM (Temuan Lapangan)

### 2.1 Toko kelontong / warung (segmen terbesar)
- Pencatatan berbasis ingatan atau buku catatan; ~30–40% sudah mulai pakai aplikasi digital, sisanya manual (studi toko kelontong Madura, Solo).
- Sering membeli dari grosir/pasar tanpa sistem; harga beli naik-turun tanpa sadar → kesulitan menyesuaikan harga jual.
- **Kredit pelanggan** (bayar belakangan) adalah praktik sosial-budaya umum — beberapa POS desktop lokal (AuliaSoft, iPos) menjual fitur ini untuk segmen ini.
- Masalah khas: kelebihan/kekurangan stok, barang menumpuk (dead stock), fast-moving tidak teridentifikasi.

### 2.2 Toko sembako / grosir
- Satuan bervariasi berat/volume (kg, liter) + satuan jumlah (dus, renceng, ikat) → butuh qty desimal (sudah didukung `NUMERIC(12,3)`) dan multisatuan.
- Barang datang dari distributor sering **selisih** vs nota → perlu pencatatan penerimaan + adjustment.
- Expired date relevan (susu UHT, mie, snack kemasan).

### 2.3 F&B / kafe / restoran
- Masalah utama: stok bahan baku (raw material) vs produk jadi, dan **barang kadaluarsa** (FEFO method dipakai di banyak studi: D'Fans Coffee, Toko Amin Jaya, Livana, Indomaret).
- Produk tanpa stok & porsi/satuan pangan (porsi, gelas) umum.
- Modifier/topping & varian umum di POS F&B (Pawoon, Youtap).

### 2.4 Jasa (laundry, servis, bengkel, salon)
- Produk = layanan, **tanpa stok** (atau stok bahan tak dilacak) — POS jasa (Youtap, Notix mode jasa) memisahkan alur "order perlu diproses" vs "produk instan".
- Implikasi: produk tanpa stok harus tetap bisa dijual (stok unlimited / flag `track_stock=false`).

### 2.5 Pola umum pembelian → penjualan
- Beli: 1 dus = 12 pcs, 1 renceng = 6/10 pcs, 1 karton = 48 pcs, 1 lusin = 12, 1 kodi = 20, 1 gross = 144, 1 rim = 500.
- Jual: per pcs/bungkus/ikat/gram — **harga eceran & harga grosir berbeda** (harga bertingkat by qty).

---

## 3. Temuan Kunci → Rekomendasi Modul Produk & Stok

### R1. Multisatuan + konversi satuan → **naikkan dari P2 ke P1** ⭐ (gap terbesar)
- **Bukti:** Kasir Pintar Desktop (multi-satuan + harga bertingkat), majoo (stok multisatuan), Kasaba (unit dasar + faktor konversi: 1 Box=12 Pcs, 1 Karton=48 Pcs; harga per unit), AuliaSoft (harga PAK/DUS/eceran/grosir), Bizera (satuan berlapis untuk sembako/grosir).
- **Pola nyata:** beli 1 dus (12 pcs) @ Rp 96.000, jual per pcs @ Rp 10.000 — tanpa konversi, kasir harus hitung manual & stok salah.
- **Desain yang terbukti (Kasaba):** satu produk punya **unit dasar** (untuk tracking stok, faktor=1) + beberapa unit penjualan/pembelian dengan faktor konversi; tiap unit punya harga sendiri.
- **Usulan implementasi murah di skema existing:**
  - Tambah tabel `product_units` (P1): `product_id, unit, factor (qty per unit dasar), sell_price, is_sellable, is_purchase_unit`.
  - `products.unit` (unit dasar) tetap; stok tersimpan dalam unit dasar.
  - Kasir pilih satuan saat menambah item; qty dikonversi ke unit dasar otomatis.
  - Snapshot di `transaction_items` perlu tambah kolom `unit` (P1) agar struk & laporan benar.
- **Alternatif minimal (kalau mau paling murah):** cukup tambah daftar satuan bawaan + kolom `unit` di snapshot, tanpa konversi. Tapi ini **tidak menyelesaikan pola beli-grosir-jual-eceran**.

### R2. Stok opname + adjustment + laporan selisih → **naikkan ke P1-awal** ⭐
- **Bukti:** seluruh literatur stok opname UMKM (Kasir Pintar, Jurnal.id, Equiperp, UNAIR Vokasi) — selisih stok itu normal & harus dicari penyebabnya; studi King Frozen: penyebab terbesar = barang datang tidak diinput, rusak/expired tidak terdata (33%), barang keluar belum diinput, selisih dari distributor, retur tercampur.
- **Fitur standar kompetitor:** Kasir Pintar (stock opname: stok fisik vs sistem → selisih), majoo (Stok Opname, Stok Terbuang), Moka premium, POSKasir, AuliaSoft.
- **Rekomendasi (selaras PROD-13 existing, tapi diperkaya):**
  - PROD-13 (stok adjustment manual, alasan wajib + otorisasi admin/manager) → **P0-late/P1-awal**.
  - Tambah laporan **selisih stok** (sistem vs fisik) dan riwayat opname.
  - `stock_movements.type` sudah punya `adjustment`; cukup tambah field `physical_qty`/`difference` di laporan (atau simpan di note) — **tanpa migrasi besar**.
  - Alasan wajib: rusak, expired, hilang/pencurian, salah catat, selisih supplier, lainnya.

### R3. Expiry date (batch) + laporan hampir expired → **tambah P1 (F&B/sembako) / P2 (lainnya)**
- **Bukti:** FEFO adalah metode standar di riset UMKM Indonesia (D'Fans Coffee, Toko Amin Jaya, Livana, Indomaret, Qeemla kosmetik) untuk menekan kerugian barang kadaluarsa; majoo sudah punya "Batch Number & Expired Date"; AuliaSoft punya expiry tracking.
- **Usulan:** kolom opsional `expiry_date` + (P2) batch di produk/`stock_movements`; laporan "barang hampir expired (≤30 hari)" + badge di dashboard. Untuk iterasi pertama cukup: field `expiry_date` per produk + kolom di laporan stok, FEFO penuh (batch) = P2.

### R4. Produk jasa / tanpa stok → **tambah flag `track_stock` (murah, P0-late/P1)**
- **Bukti:** Youtap (bisnis jasa), Notix (mode jasa: DP, status pesanan), POSKasir (laundry, service), majoo ("Produk Jasa", "Produk Jenis Layanan"), Antara.
- **Usulan:** boolean `track_stock` di `products` (default true). Jika false: tidak dicek stok, tidak dihitung di laporan stok menipis. Skema existing tinggal tambah 1 kolom — biaya kecil, menutup segmen jasa.

### R5. Harga grosir bertingkat (tiered pricing by qty) → **tambah P1** (bagian dari R1)
- **Bukti:** Kasir Pintar (harga bertingkat), Kasaba (tier: 1–11, 12–47, 48–143, 144+), AuliaSoft (multi price: eceran, grosir, pak, dus, range qty), majoo (harga grosir).
- **Usulan:** di `product_units` tambah `min_qty` (atau tabel `product_price_tiers`) — harga otomatis berubah saat qty cart melewati ambang. Ini fitur bernilai tinggi untuk toko sembako/grosir.

### R6. Modul pembelian & supplier → **tambah P1** (schema sudah menyiapkan)
- **Bukti:** `stock_movements.type` sudah punya `purchase_in` + kolom `reference` ("PO-001"); `cost_price` = harga beli terakhir (BA §4.8). Pawoon/majoo/Kasir Pintar semua punya Manajemen Pembelian & Supplier; studi menunjukkan "barang datang tidak diinput" = penyebab selisih #1 → **pencatatan penerimaan barang dari nota supplier menutup akar masalah selisih stok**.
- **Usulan P1:** modul minimal — catat pembelian (supplier, tanggal, item+qty+harga) → otomatis `purchase_in` + update `cost_price`; daftar supplier. Tanpa modul ini, `purchase_in` & `cost_price` hanya bisa diisi lewat adjustment (kurang rapi).

### R7. Reorder point & daftar belanja ulang → **tambah P1**
- **Bukti:** `min_stock` (PROD-09) sudah ada & sesuai praktik (ROP di studi Amin Jaya, buffer stock di D'Fans Coffee; auto reorder di AuliaSoft).
- **Usulan:** tambah `reorder_qty` opsional per produk + laporan "daftar belanja" (produk ≤ min_stock dengan qty yang disarankan) — pengembangan natural dari REP-03 (stok menipis). Tanpa `reorder_qty`, REP-03 sudah cukup untuk P0.

### R8. Klasifikasi fast/slow/non-moving (FSN) & dead stock → **tambah P1-late/P2**
- **Bukti:** banyak riset (UD Gajah Delta K-Means, Toko Enggal Murah EOQ+FSN, Toko Olahraga X) — dead stock = kerugian nyata; REP-04 (produk terlaris) hanya menangkap sisi fast moving.
- **Usulan:** laporan "barang tidak laku" (0 penjualan dalam 30/60/90 hari, masih aktif) — cukup query sederhana di atas `transaction_items` existing.

### R9. Konsinyasi (titipan) → **P2, dengan solusi ringan dulu**
- **Bukti:** lazim di toko oleh-oleh (Sari Rasa), retail (BEST ERP, iPos 5 konsinyasi masuk/keluar, Erzap, Yapos) — titip barang supplier, bayar saat laku, sisanya dikembalikan.
- **Usulan:** jangan bangun modul penuh di P0. Solusi ringan P1/P2: field `is_consignment` + `supplier_id` (kalau R6 jalan) di `products` + catat via adjustment/note. Modul penuh (tagihan barang laku, retur konsinyasi) = P2.

### R10. Barcode internal & scan saat opname → **P1** (dukung PROD-14)
- **Bukti:** studi toko kelontong & panduan opname (Kasir Pintar, Jurnal.id) — barcode scanner mempercepat checkout & opname, mengurangi salah input; produk UMKM tanpa EAN butuh **barcode internal** (cetak label).
- **Usulan:** generator barcode internal (format EAN-13 atau Code 128) saat buat produk tanpa barcode → PROD-14 (cetak label) jadi murah di P1.

### R11. Field izin edar (BPOM/PIRT/halal) → **P2, opsional** (khusus F&B kemasan)
- **Bukti:** pangan olahan kemasan wajib izin edar — BPOM MD/ML (15 digit), PIRT (16 digit, format PIRT-XX.XXXX.XX.XXXX), sertifikasi halal BPJPH; label wajib mencantumkan nomor + kedaluwarsa.
- **Usulan:** kolom opsional `regulatory_number` (+ jenis: BPOM MD / BPOM ML / PIRT / NIB) di `products` untuk toko yang menjual produk kemasan sendiri — berguna saat cetak label & audit. Bukan prioritas.

### R12. Varian produk → **tetap P1** (validasi)
- **Bukti:** varian (ukuran/warna) ada di Kasir Pintar, Youtap, POSKasir, majoo; spec PROD-12 (produk turunan dengan stok & harga sendiri) sudah tepat & murah.

### R13. Stok tidak negatif + toggle → **sudah benar, pertahankan**
- **Bukti:** studi UNAIR menemukan stok minus masif di sistem kasir UMKM karena pencatatan tidak real-time; BA §4.5 (stok non-negatif, toggle P1) terbukti keputusan tepat. Konkurensi via `UPDATE ... WHERE stock >= qty` (spec §9) = pola yang benar.

---

## 4. Matriks Rekomendasi vs Spec Existing

| # | Rekomendasi | Spec saat ini | Usulan | Biaya skema | Nilai bisnis |
|---|---|---|---|---|---|
| R1 | Multisatuan + konversi | Varian P2, satuan kustom P1 | **P1** (tabel `product_units`) | Sedang (1 tabel + snapshot `unit`) | ⭐⭐⭐ |
| R2 | Stok opname + laporan selisih | PROD-13 P1 | **P1-awal** | Rendah (pakai `adjustment` + laporan) | ⭐⭐⭐ |
| R3 | Expiry date + laporan hampir expired | Tidak ada | **P1** (field + laporan) | Rendah | ⭐⭐⭐ (F&B) |
| R4 | Flag produk tanpa stok (jasa) | Tidak ada | **P1** (`track_stock`) | Sangat rendah | ⭐⭐ |
| R5 | Harga grosir bertingkat | Tidak ada | **P1** (bagian R1) | Rendah | ⭐⭐⭐ (grosir) |
| R6 | Pembelian + supplier | Tidak ada (schema siap) | **P1** | Sedang (2–3 tabel) | ⭐⭐⭐ |
| R7 | Reorder qty + daftar belanja | `min_stock` P1 | **P1** | Rendah | ⭐⭐ |
| R8 | Laporan dead stock (FSN) | REP-04 terlaris | **P1-late/P2** | Sangat rendah (query) | ⭐⭐ |
| R9 | Konsinyasi | Tidak ada | **P2** (ringan) | Sedang | ⭐ |
| R10 | Barcode internal + cetak label | PROD-14 P2 | **P1** (generator) | Rendah | ⭐⭐ |
| R11 | Field izin edar (BPOM/PIRT/halal) | Tidak ada | **P2** | Sangat rendah | ⭐ |
| R12 | Varian | PROD-12 P1 | tetap P1 | — | ⭐⭐ |
| R13 | Stok non-negatif | PROD-07 P0 | **pertahankan** | — | ⭐⭐⭐ |

**Prioritas rekomendasi untuk iterasi 1 (kalau dev memungkinkan):** R2 (opname) → R1 (multisatuan) → R4 (flag jasa) → R3 (expiry) → R5 → R6 → sisanya P2.

---

## 5. Implikasi untuk Struk, Laporan & Konfigurasi (M7/M9)

- **Struk:** jika R1 jalan, struk harus menampilkan satuan per item (mis. "2 dus × 12 pcs" atau "12 pcs") — tambah kolom `unit` di `transaction_items` snapshot.
- **Laporan (M7):** REP-03 (stok menipis) sudah menutup kebutuhan R7 minimal; REP-04 (terlaris) menutup sebagian R8. Tambahan murah: kolom "terakhir terjual" per produk.
- **Konfigurasi (M9):** SET-04 (threshold global) sudah benar. Tambahan opsional: default satuan toko, pengaturan hari "hampir expired" (30 hari), format barcode.

---

## 6. Sumber Utama

**Praktik & tantangan UMKM:**
- Pelatihan pencatatan persediaan toko kelontong (JPMI) — jurnalistiqomah.org/index.php/jpmi/article/view/2637
- Pemberdayaan warung kelontong Mbak Lia, Kulon Progo (Excel/kartu stok) — jurnal-lp2m.umnaw.ac.id (AJPKM 5081)
- Toko kelontong Madura Solo — transformasi digital manual → aplikasi; kredit pelanggan (YUME, STIE Amkop)
- SAK EMKM & persediaan toko kelontong (Binjai; Warung Ami, Rancaekek)

**Selisih stok & opname:**
- Analisis DMAIC selisih stok King Frozen Food Ciwaruga (33% = barang rusak/expired tak terdata) — journal.um-surabaya.ac.id (Masharif Al-Syariah 22308)
- Stok minus di sistem kasir UMKM (UNAIR Vokasi) — vokasi.unair.ac.id
- Panduan stock opname UMKM (Kasir Pintar), stock opname & SOP (jurnal.id, Equiperp)

**FEFO / kadaluarsa:**
- D'Fans Coffee buffer stock+FEFO (JEECOM Unuja), Toko Amin Jaya FEFO+ROP (JINACS Unesa), Livana (UPN Jatim), Indomaret Cirewed (UMT), Qeemla kosmetik (SANTIKA UPN)

**Fitur kompetitor (produk & stok):**
- Kasir Pintar: multi-satuan & harga bertingkat; stock opname — kasirpintar.co.id & help.kasirpintar.co.id
- Kasaba: konversi satuan (unit dasar/faktor), harga grosir bertingkat — docs.kasaba.id
- majoo: multisatuan, COGS average, batch/expired date, serial number, stok opname, produk jasa — majoo.id/harga
- Moka: ingredients inventory, advanced inventory, stock opname/purchase order premium — mokapos.com
- Pawoon: manajemen produk, bahan baku, inventori, pembelian, supplier — pawoon.com/harga
- AuliaSoft (toko kelontong desktop): multi price (eceran/grosir/PAK/DUS), auto reorder, expiry tracking, kredit pelanggan
- iPos 5: konsinyasi masuk/keluar penuh; Yapos/Erzap/BEST ERP: konsinyasi, transfer antar outlet
- Youtap / Notix / POSKasir: produk & mode jasa (tanpa stok, DP, status pesanan)

**Regulasi produk (F&B kemasan):**
- BPOM Siripo: label pangan olahan (NIE/PB-UMKU, kedaluwarsa, halal) — rumahsiripo.pom.go.id
- PIRT (format 16 digit), BPOM MD/ML (15 digit), sertifikasi halal BPJPH; PP 86/2019 Pasal 15 — smartlegal.id, beginisob.com, oss-nib.com

**Satuan jumlah Indonesia:** lusin=12, kodi=20, gross=144 (12 lusin), rim=500; dus/renceng/ikat bervariasi per produk — detik.com, rumushitung.com, zonatika.com
