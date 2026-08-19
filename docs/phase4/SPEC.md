# SPEC — Fase 4: Kasir (Mobile POS)

> **Proyek:** FakhriPOS — POS (Bun + Elysia + Drizzle ORM, Next.js + shadcn/ui, PostgreSQL `db_pos`)
> **Peran penulis:** System Analyst — output dari riset BA (`docs/phase2/RESEARCH.md`) & praktik POS Indonesia (Pawoon, majoo, Olsera, Kasaba)
> **Tanggal:** 19 Agustus 2026
> **Status:** mengikat untuk developer (backend + frontend) Fase 4
> **Referensi:** `spec/features.md` (PROD-10 struk, PROD-14 retur), `spec/api-design.md`, `docs/phase2/SPEC.md` (§4.4 kontrak checkout, §8 dampak), `docs/phase3/SPEC.md`, `apps/api/src/db/schema.ts`, `apps/api/src/services/checkout.service.ts`, `apps/api/src/services/return.service.ts`, `apps/api/src/services/receipt.ts`, `apps/api/src/routes/transactions.routes.ts`, `apps/api/src/routes/returns.routes.ts`, `apps/web/src/app/(app)/pos/page.tsx`

**Notasi prioritas:** P0 = wajib Fase 4 ini · P1-late = setelah Fase 4 (disebut sebagai catatan, TIDAK dikerjakan Fase 4).
Semua angka uang = **integer rupiah** (BIGINT). Semua qty = **NUMERIC(12,3)**. Semua waktu = **TIMESTAMPTZ** UTC, tampilan WIB. Semua ID = UUID.

**Prinsip Fase 4:** layar yang dipakai ±200×/hari → setiap AC UX memakai **jumlah ketukan (tap)** dan **milidetik**, bukan kata "cepat". Backend checkout/return/receipt **TIDAK diubah logikanya** (lihat §1.3 & §8.1 — perubahan hanya additive: 2 tabel baru, guard di level route, key settings baru).

---

## 1. Lingkup — masuk apa, TIDAK masuk apa

### 1.1 MASUK (Fase 4: Kasir / Mobile POS)

| # | Fitur | Catatan lingkup |
|---|---|---|
| F4-1 | **Mobile-optimized POS** | Layout mobile-first: grid produk 2 kolom (390×844), tombol tap besar (min 56px), bottom sheet keranjang + bottom sheet pembayaran, FAB/badge jumlah item. Desktop: grid 4–6 kolom + panel samping (satu komponen, responsif). |
| F4-2 | **Keranjang (cart)** | Tambah (tap produk / scan barcode), naik/turun qty (tap +/−), ubah qty via keypad, hapus item, pilih **varian** (modal) & **satuan** (modal) per item, diskon per item (existing kontrak `items[].discount`). Persist localStorage (existing `pos.cart`). |
| F4-3 | **Split payment** | Bayar dengan **2+ metode dalam 1 transaksi** (cash + qris, cash + transfer, dst). Quick cash (50rb/100rb/200rb/uang pas), sisa yang harus dibayar tampil live, kembalian hanya dari leg cash, QRIS tampil QR (payload statis `store.qris_payload` existing), transfer isi nomor referensi. **Backend `payments[]` sudah mendukung — Fase 4 = UI + validasi UX saja.** |
| F4-4 | **Hold / parkir transaksi** | Simpan keranjang ke server (label + snapshot item) → transaksi dilanjutkan nanti (bisa dari perangkat berbeda). Batas per kasir per hari (setting). Kadaluarsa akhir hari WIB. |
| F4-5 | **Struk: cetak thermal + WhatsApp + QR** | Reprint/cetak struk 80mm via dialog print browser (CSS `@media print`, 40 kolom konsisten `receiptText`), kirim struk via WhatsApp (`wa.me` dengan teks struk), QR di struk = QRIS (existing) + opsional QR verifikasi transaksi. |
| F4-6 | **Shift management** | Buka shift (wajib: modal awal kas), tutup shift (modal akhir, laporan ringkas: penjualan per metode, retur, kas expected vs actual, selisih), daftar & detail shift, guard "wajib shift terbuka sebelum checkout/retur" (route-level, bisa dimatikan via setting). |
| F4-7 | **Retur barang dengan alasan** | UI retur dari POS: pilih transaksi → pilih item → alasan (daftar preset + alasan lain) → metode refund. **Backend `POST /returns` sudah jalan (alasan wajib per item, refund cash/qris/transfer/points, batas 7 hari) — Fase 4 = UI + preset alasan.** |

### 1.2 TIDAK MASUK (sengaja, dengan catatan)

| Tidak masuk | Alasan / penanganan |
|---|---|
| **Driver ESC/POS native (WebUSB/Bluetooth)** | P1-late. Fase 4 mencetak via **dialog print browser** (`window.print()` + CSS 80mm/58mm) — jalan di semua printer thermal yang terpasang sebagai driver OS (printer termal umum di UMKM terpasang sebagai printer Windows). Native driver = P1-late bila dibutuhkan. |
| **Pilih gudang saat checkout** | Tetap gudang **default** (`settings['stock.default_warehouse_id']`, keputusan Fase 3 §1.2). Pilih gudang per transaksi = P1-late. |
| **Shift lintas kasir / sesi bersama (1 shift dipakai 2 kasir bergantian)** | 1 shift = 1 user (pola majoo/Olsera). Kasir kedua buka shift sendiri. |
| **Approval tutup shift oleh manager** | P1-late. Fase 4: selisih ≠ 0 → shift tetap bisa ditutup dengan catatan wajib; selisih tampil di laporan shift & dilihat manager. |
| **Kartu/stempel/loyalitas fisik, e-wallet selain QRIS, BNPL** | Tidak dikerjakan. Metode bayar tetap `cash`/`qris`/`transfer` (enum existing). |
| **Offline/PWA penuh, antrian offline checkout** | Keputusan existing: online-only (Fase 2 §9.2). Cart tetap di frontend (localStorage); hold butuh server. |
| **Struk elektronik via email / link struk publik** | P1-late. Fase 4 cukup WhatsApp. |
| **Laporan shift agregat (per kasir per hari, grafik)** | P1-late. Fase 4: detail per shift + ringkasan di detail shift. |
| **Cetak ulang struk massal / reprint antar shift tanpa batas** | Reprint mengikuti rule existing: kasir hanya transaksi hari ini (server paksa, Fase 2 §8.1 / routes existing). |
| **Antrian print server-side / spooling** | Print 100% client-side (dialog browser). Tidak ada job queue. |
| **Reservasi stok untuk hold** | Tidak ada (konsisten Fase 3 §1.2: cek stok atomik saat checkout). Stok bisa habis sebelum transaksi di-resume → checkout menolak seperti biasa. |

### 1.3 Keputusan penyelarasan (catatan eksplisit — wajib dibaca developer)

1. **`payments[]` array & `processPayments` (checkout.service.ts) SUDAH mendukung split payment** — Fase 2 §4.4 & implementasi `commitCheckout` menerima banyak payment dalam 1 request (jumlah harus pas total, `PAYMENT_MISMATCH` bila tidak). Fase 4 **TIDAK mengubah** service ini; hanya UI yang menyusun array `payments` dengan benar. Kembalian hanya dihitung untuk leg `cash` (`cashReceived ≥ amount`, `changeAmount = cashReceived − applied`).
2. **Retur backend (`return.service.ts`) SUDAH lengkap** — alasan wajib per item (teks bebas, RET-04), qty ≤ sisa (`RETURN_QTY_EXCEEDED`), refund `cash/qris/transfer/points`, batas hari (`return.max_days` default 7). Fase 4 **TIDAK mengubah** service ini; UI menawarkan daftar alasan preset yang **dikirim sebagai teks** (tetap teks bebas di DB, bukan enum — daftar bisa berubah tanpa migrasi).
3. **Shift TIDAK menambah kolom `shift_id` di `transactions`/`returns`** — keputusan ini menjaga prinsip "jangan ubah checkout logic yang sudah jalan" secara maksimal: atribusi transaksi ke shift dihitung dari `(user_id, sold_at/returned_at)` dalam rentang `[opened_at, closed_at]` shift milik user tsb, dan **statistik shift di-snapshot ke baris `shifts` saat tutup** (histori tidak bergantung query ulang). Konsekuensi: 1 user hanya boleh punya 1 shift terbuka (dijaga aplikasi, `SHIFT_ALREADY_OPEN`) sehingga window waktu tidak ambigu. Perubahan ke file existing = **hanya guard 1 blok di route** (`transactions.routes.ts` & `returns.routes.ts`), bukan di service.
4. **Guard "wajib shift terbuka"** diimplementasikan di **route layer** (sebelum memanggil `commitCheckout`/`createReturn`), bukan di dalam service — `computeTransaction` dan logika harga/stok/payment sama sekali tidak tersentuh. Default **aktif** (`settings['shift.enforce_checkout']=true`); dimatikan untuk dev/demo.
5. **Struk thermal via `window.print()`** — `receiptText` (40 kolom, service existing) menjadi sumber konten; frontend merender HTML struk 80mm dan mencetak via dialog browser. `GET /transactions/:id/receipt?format=text` tetap dipakai untuk payload WhatsApp.
6. **Hold = snapshot JSONB, harga TIDAK dipercaya** — `held_carts.items` hanya untuk tampilan & pemulihan keranjang; saat resume → checkout, `computeTransaction` menghitung ulang semua harga/stok dari DB (prinsip existing api-design §3). Harga lama yang basi hanya tampil sesaat di keranjang, lalu dikoreksi oleh preview/checkout.
7. **QR di struk ada 2 macam, keduanya opsional via setting:** (a) QRIS — QR dari `store.qris_payload` (existing, dipakai saat pembayaran qris & bisa dicetak di struk); (b) verifikasi transaksi — QR berisi `FPOS|TRX-YYYYMMDD-XXXX|<transaction_id>` yang bisa di-scan kasir (input barcode) untuk membuka detail transaksi. TIDAK ada halaman publik verifikasi (homelab, P1-late).
8. **Shift & hold memakai 2 tabel baru + 1 enum baru** — `shifts`, `held_carts`, enum `shift_status`. Tidak ada ALTER tabel existing. Migrasi idempotent, `drizzle-kit check` lulus.

---

## 2. User Story + Kriteria Penerimaan (Given/When/Then)

Konvensi: setiap AC ditulis Given/When/Then; **setiap AC wajib bisa diuji otomatis** (test backend via HTTP, atau query DB langsung; AC UX diuji E2E/Playwright pada viewport 390×844). "Cepat" tidak diterima sebagai AC — semua AC waktu memakai angka milidetik/detik, semua AC UX memakai jumlah ketukan.

### US-01 — Layar kasir mobile: grid produk & tambah item
Sebagai **kasir**, saya bisa menemukan & menambahkan produk dalam ≤2 ketukan dari posisi apa pun, supaya antrean pelanggan tidak menumpuk.

- AC-01.1: **Given** kasir login & membuka `/pos` di viewport 390×844, **When** halaman dimuat, **Then** produk tampil sebagai **grid 2 kolom** (kartu: nama, harga, stok badge, unit dasar; tombol tap ≥ 56px), pencarian + tombol kategori di atas, dan FAB keranjang menampilkan badge jumlah item (0 saat kosong).
- AC-01.2: **Given** daftar produk 100 item, **When** halaman dimuat, **Then** `GET /products?isActive=true&perPage=100` selesai **p95 < 500 ms** (LAN, seed penuh) dan grid bisa di-scroll tanpa pagination manual (infinite scroll / load-more otomatis).
- AC-01.3: **Given** kasir mengetik "indo" di kotak pencarian, **When** input berhenti 250 ms, **Then** grid menampilkan produk yang cocok (termasuk match nama varian, konsisten Fase 2 US-01/AC pencarian) dan hasil < 200 ms p95.
- AC-01.4: **Given** produk "Indomie Goreng" (unit dasar `pcs`) tampil di grid, **When** kasir mengetuknya, **Then** item masuk keranjang qty 1, badge FAB naik 1, kartu memberi feedback visual (highlight/haptic singkat), **tanpa membuka modal apa pun** (1 ketukan = 1 tambah).
- AC-01.5: **Given** produk yang sama ditambah lagi, **When** kasir mengetuknya, **Then** qty baris keranjang naik 1 (bukan baris baru), dan bila qty+1 > stok tampil toast "Stok tidak mencukupi (sisa N)" dan qty TIDAK bertambah.
- AC-01.6: **Given** kasir men-scan barcode (input scanner tersembunyi selalu fokus), **When** barcode valid dikirim, **Then** produk/varian langsung masuk keranjang (≤ 2 ketukan total: 0 ketukan jika scanner hardware), `GET /products/barcode/:code` p95 < 300 ms, dan input scan otomatis kosong & siap scan berikutnya; barcode tidak dikenal → toast error, keranjang tidak berubah.
- AC-01.7: **Given** produk ber-varian diketuk, **When** kasir memilih varian di modal (mis. "Rasa Sapi Panggang"), **Then** varian masuk keranjang dengan `variantId` terisi; modal varian menampilkan stok & harga per varian; varian nonaktif TIDAK muncul.
- AC-01.8: **Given** produk multi-satuan diketuk, **When** kasir memilih satuan (mis. `dus`) di modal satuan, **Then** item masuk keranjang dengan `unit: 'dus'`, harga = `product_units.sell_price`, dan label baris menampilkan "2 dus × 12 pcs" (konsisten snapshot Fase 2 §3.4).
- AC-01.9: **Given** jaringan mati, **When** kasir mengetuk produk, **Then** item tetap masuk keranjang (localStorage), dan toast peringatan "Offline — transaksi tidak bisa diproses" muncul sekali; checkout tetap diblokir sampai online (online-only, Fase 2 §9.2).

### US-02 — Keranjang: ubah qty, hapus, ringkasan live
Sebagai **kasir**, saya bisa mengubah isi keranjang tanpa keluar dari alur, supaya kesalahan input bisa dikoreksi cepat.

- AC-02.1: **Given** keranjang berisi 3 item, **When** FAB keranjang diketuk, **Then** **bottom sheet keranjang** terbuka (drag-down untuk tutup) menampilkan tiap item: nama, varian/satuan, harga satuan, qty dengan tombol − / + (tap target ≥ 44px), subtotal baris, tombol hapus; total besar di bawah + tombol "Bayar".
- AC-02.2: **Given** item qty 2, **When** tombol + diketuk, **Then** qty 3; tombol − hingga qty 1 tetap menampilkan item; **− pada qty 1** menghapus item? — **TIDAK**: − pada qty 1 menonaktifkan tombol − (hapus hanya via tombol hapus — mencegah hapus tidak sengaja).
- AC-02.3: **Given** item qty 3 stok 5, **When** + diketuk 3×, **Then** qty berhenti di 5 dan toast "Stok tidak mencukupi (sisa 5)" (batas stok client-side, server tetap memvalidasi).
- AC-02.4: **Given** item dengan `unit='dus'`, **When** +/− diketuk, **Then** qty berubah per satuan penjualan (bukan per pcs), dan cek batas stok memakai `availableStock` dalam satuan yang sama (`floor(stok_pcs / factor)`, kontrak preview existing).
- AC-02.5: **Given** keranjang berubah (tambah/hapus/qty/diskon/pelanggan/poin), **When** ringkasan diperiksa, **Then** subtotal, diskon, PPN, total, dan poin dihitung ulang **client-side** dalam < 50 ms (tanpa request) dan tombol "Bayar" menampilkan total live.
- AC-02.6: **Given** kasir mengetuk "Bayar", **When** `POST /transactions/preview` dipanggil dengan isi keranjang, **Then** respons server (harga & stok otoritatif) ditampilkan; bila harga/stok server berbeda dari tampilan client → harga server dipakai & selisih ditandai (mis. badge "harga berubah").
- AC-02.7: **Given** bottom sheet keranjang terbuka, **When** kasir mengetuk item, **Then** modal detail item terbuka: ubah qty via keypad numerik, ganti varian/satuan (bila ada), diskon per item (`percentage`/`fixed` dengan batas cap existing `DISCOUNT_CAP_EXCEEDED`), hapus item.
- AC-02.8: **Given** keranjang dikosongkan (hapus semua item / tombol "Kosongkan" dengan konfirmasi), **When** selesai, **Then** badge FAB = 0, total = 0, dan state keranjang localStorage terhapus.

### US-03 — Split payment
Sebagai **kasir**, saya bisa menerima pembayaran campuran (tunai + QRIS + transfer) dalam satu transaksi, supaya pelanggan yang uang tunainya kurang tetap bisa membayar.

- AC-03.1: **Given** total Rp 150.000, **When** kasir membuka bottom sheet pembayaran, **Then** tampil total besar, tombol metode (Tunai/QRIS/Transfer), dan **sisa yang harus dibayar** live; default metode Tunai dengan quick cash (Uang Pas, 50rb, 100rb, 200rb) + input manual.
- AC-03.2: **Given** total Rp 150.000, **When** kasir memilih Tunai Rp 100.000 lalu menambah metode QRIS Rp 50.000, **Then** sisa = Rp 0, tombol "Selesai & Proses" aktif; `POST /transactions` menerima `payments: [{ method:'cash', amount:100000, cashReceived:100000 }, { method:'qris', amount:50000 }]` dan transaksi 201 dengan `paymentStatus='paid'`.
- AC-03.3: **Given** total Rp 150.000 dan pembayaran terisi Rp 120.000 (belum lunas), **When** kasir menekan proses, **Then** tombol proses nonaktif + indikator "Sisa Rp 30.000" (client memblokir kirim sebelum lunas; server tetap menjamin dengan `PAYMENT_MISMATCH`).
- AC-03.4: **Given** total Rp 150.000, **When** kasir memasukkan Tunai `cashReceived=200.000` (uang pas tidak dipilih), **Then** kembalian tampil live Rp 50.000; `POST /transactions` mengirim `{ method:'cash', amount:150000, cashReceived:200000 }` dan respons `payments[0].changeAmount=50000`.
- AC-03.5: **Given** total Rp 150.000 dibayar QRIS Rp 100.000 + Tunai Rp 50.000 (cashReceived 100.000), **When** transaksi sukses, **Then** `payments` tersimpan 2 baris: qris 100.000 (tanpa change) & cash 50.000 `changeAmount=50000` — **kembalian hanya dihitung dari leg cash**, bukan dari total (konsisten `processPayments` existing).
- AC-03.6: **Given** kasir memilih metode QRIS, **When** bottom sheet QRIS tampil, **Then** QR statis `store.qris_payload` dirender (react-qr-code, existing) dengan nominal total yang harus dibayar; tombol "Sudah Dibayar" menandai lunas (UX flow existing, konsisten pos/page.tsx).
- AC-03.7: **Given** kasir memilih Transfer, **When** form transfer tampil, **Then** ada input nomor referensi (wajib bila diisi, ≤100 char) yang dikirim sebagai `referenceNumber`; tanpa referensi, transaksi tetap bisa diproses.
- AC-03.8: **Given** pembayaran campuran > 2 leg (Tunai + QRIS + Transfer), **When** `POST /transactions` diproses, **Then** 201 dengan 3 baris `payments` (urutan dikirim), total leg = total transaksi, dan struk menampilkan 3 baris metode.
- AC-03.9: **Given** server mengembalikan 422 `PAYMENT_MISMATCH` (mis. total berubah karena harga server ≠ client), **When** kasir melihat error, **Then** bottom sheet menampilkan pesan jelas + total server yang baru, dan kasir bisa menyesuaikan pembayaran tanpa kehilangan isi keranjang.

### US-04 — Hold / parkir transaksi
Sebagai **kasir**, saya bisa menunda transaksi yang belum selesai dan melanjutkannya nanti, supaya pelanggan yang harus mengambil dompet/telpon tidak menahan antrean.

- AC-04.1: **Given** keranjang berisi 3 item + pelanggan terpilih, **When** kasir mengetuk "Tahan" (ikon parkir, ada di header keranjang), **Then** `POST /held-carts` dipanggil dengan `{ label?, customerId?, items }`, respons 201 `{ heldCart }`, keranjang lokal dikosongkan, dan toast "Transaksi ditahan #HOLD-XXXX" tampil.
- AC-04.2: **Given** 2 keranjang ditahan, **When** kasir mengetuk tombol "Ditahan" (badge jumlah), **Then** daftar hold (bottom sheet/list) menampilkan label, jumlah item, total snapshot, waktu dibuat, sisa waktu sebelum kadaluarsa (akhir hari WIB).
- AC-04.3: **Given** kasir mengetuk salah satu hold, **When** "Lanjutkan" dipilih, **Then** `POST /held-carts/:id/resume` dipanggil, hold berstatus `resumed`, item dikembalikan ke keranjang lokal, dan kasir lanjut ke pembayaran.
- AC-04.4: **Given** hold di-resume lalu keranjang berubah (harga berubah di server), **When** kasir menekan "Bayar", **Then** `POST /transactions/preview` menghitung ulang dari DB (harga/stok otoritatif) dan transaksi memakai angka server — snapshot hold TIDAK pernah dipercaya (keputusan §1.3.6).
- AC-04.5: **Given** kasir tidak jadi melanjutkan hold, **When** "Buang" dipilih (konfirmasi), **Then** `DELETE /held-carts/:id` memanggil, status `discarded`, hold hilang dari daftar, TIDAK ada stok/transaksi yang terpengaruh.
- AC-04.6: **Given** hold dibuat jam 23:30 WIB dan tidak di-resume, **When** pukul 00:05 WIB daftar hold dibuka, **Then** hold **tidak muncul** (kadaluarsa akhir hari WIB); baris tetap di DB dengan status `held` + `expires_at` lampau (lazy cleanup — tidak ada job).
- AC-04.7: **Given** kasir A menahan keranjang, **When** kasir B memanggil `GET /held-carts`, **Then** hanya hold milik kasir B yang muncul (scoping per user, server paksa); kasir B memanggil `GET /held-carts/:id` milik A → 404 `HELD_CART_NOT_FOUND`.
- AC-04.8: **Given** kasir sudah punya 20 hold aktif hari ini (batas setting `pos.hold_per_day_limit`), **When** menahan lagi, **Then** 409 `HELD_CART_LIMIT` dan UI menyarankan membuang hold lama.
- AC-04.9: **Given** jaringan putus saat "Tahan", **When** request gagal, **Then** keranjang lokal TIDAK dikosongkan, toast error "Gagal menahan transaksi — coba lagi", dan tidak ada baris hold parsial di server (atomic).

### US-05 — Struk: cetak thermal, WhatsApp, QR
Sebagai **kasir**, saya bisa memberikan bukti transaksi (cetak / WhatsApp / QR) dalam ≤2 ketukan setelah checkout, supaya pelanggan punya bukti tanpa menunggu.

- AC-05.1: **Given** checkout sukses (respons berisi `receipt`), **When** layar sukses tampil, **Then** ada 3 aksi: "Cetak Struk", "Kirim WhatsApp", "Selesai" — dan aksi struk tersedia **tanpa request tambahan** (data struk sudah ada di respons checkout, existing).
- AC-05.2: **Given** "Cetak Struk" dipilih, **When** dialog print browser dibuka, **Then** halaman cetak hanya berisi struk (CSS `@media print`, `@page { size: 80mm auto }`, font monospace 12px, lebar konten 72mm, 40 kolom) — header/sidebar aplikasi TIDAK ikut tercetak; reprint berikutnya ≤ 2 ketukan dari detail transaksi (`GET /transactions/:id/receipt`).
- AC-05.3: **Given** struk dicetak, **When** konten diperiksa, **Then** memuat: nama/alamat/telepon toko (settings), `No: TRX-...`, tanggal WIB, kasir (nama, bukan UUID), item (nama, qty × harga, unit & varian bila ada, diskon, PPN), subtotal/diskon/PPN/total, rincian pembayaran per metode (termasuk kembalian), poin didapat, footer (`receipt.footer`) — setara `receiptText` service existing (40 kolom).
- AC-05.4: **Given** pelanggan punya nomor WhatsApp (di `customers.phone`), **When** "Kirim WhatsApp" dipilih, **Then** browser membuka `https://wa.me/<nomor_pelanggan>?text=<urlencoded receiptText>` di tab baru; tanpa nomor pelanggan → fallback ke `store.whatsapp_number` (setting) atau toast "Nomor WhatsApp pelanggan tidak tersedia".
- AC-05.5: **Given** setting `receipt.show_verification_qr=true`, **When** struk dicetak/ditampilkan, **Then** QR berisi `FPOS|TRX-YYYYMMDD-XXXX|<transaction_id>` tercetak di struk; kasir men-scan QR tersebut di input barcode POS → langsung membuka detail transaksi itu (kasir: hanya jika transaksi hari ini, rule existing).
- AC-05.6: **Given** setting `receipt.show_qris_qr=true` dan `store.qris_payload` terisi, **When** struk dicetak, **Then** QRIS statis toko tercetak di struk (pelanggan bisa scan untuk bayar); bila `store.qris_payload` kosong → QR TIDAK dicetak (tidak error).
- AC-05.7: **Given** transaksi lama milik kasir lain (bukan hari ini), **When** kasir membuka `GET /transactions/:id/receipt`, **Then** 403 `FORBIDDEN` (rule existing — kasir hanya transaksi hari ini, server paksa).
- AC-05.8: **Given** item dengan nama panjang > 40 kolom, **When** struk di-render, **Then** nama di-wrap ke baris berikutnya (bukan terpotong di tengah angka), dan qty/harga tetap sejajar kanan.

### US-06 — Shift: buka & tutup, modal kas, rekonsiliasi
Sebagai **kasir**, saya bisa membuka shift dengan modal awal dan menutupnya dengan laporan ringkas, supaya uang di laci bisa dipertanggungjawabkan.

- AC-06.1: **Given** kasir belum punya shift terbuka, **When** membuka `/pos` atau mengetuk banner "Shift belum dibuka", **Then** modal "Buka Shift" tampil dengan input **modal kas awal** (default 0, ≥ 0, rupiah); setelah simpan, `POST /shifts` → 201 `{ shift }` dan banner header berubah menjadi "Shift #SHF-... • Rp X" dengan tombol "Tutup".
- AC-06.2: **Given** kasir punya shift terbuka, **When** memanggil `POST /shifts` lagi, **Then** 409 `SHIFT_ALREADY_OPEN` dengan `details.shiftId` shift yang sedang terbuka — 1 user = maksimal 1 shift terbuka (prasyarat atribusi window, §1.3.3).
- AC-06.3: **Given** setting `shift.enforce_checkout=true` (default) dan kasir TIDAK punya shift terbuka, **When** `POST /transactions` dipanggil, **Then** 409 `SHIFT_REQUIRED` dan **tidak ada** transaksi/baris stok/payment yang dibuat; saat `shift.enforce_checkout=false` → checkout jalan tanpa shift (dev/demo).
- AC-06.4: **Given** setting `shift.enforce_checkout=true`, **When** kasir tanpa shift membuka **halaman POS**, **Then** UI menampilkan modal "Buka Shift" yang **menghalangi** alur checkout (produk bisa dilihat, keranjang tidak bisa dibayar) — mencegah 409 di tengah alur.
- AC-06.5: **Given** shift terbuka jam 08:00 (modal 200.000), lalu kasir checkout 3 transaksi (Tunai 250.000, QRIS 100.000, Tunai 50.000) dan 1 retur tunai 20.000, **When** kasir mengetuk "Tutup Shift" dan mengisi modal kas akhir **300.000**, **Then** `POST /shifts/:id/close` → 200 dengan summary: `openingCash=200000`, `cashSales=300000` (250+50), `qrisSales=100000`, `transferSales=0`, `refunds=20000`, `expectedCash=480000` (200.000 + 300.000 − 20.000), `actualCash=300000`, `discrepancy=-180000`; shift berstatus `closed`; baris shift menyimpan snapshot semua angka di atas.
- AC-06.6: **Given** shift ditutup dengan `discrepancy ≠ 0`, **When** close diproses, **Then** selisih ≠ 0 TIDAK memblokir tutup tetapi **wajib isi catatan** (`notes` min 1 char); audit `shift.close` mencatat selisih; laporan shift menampilkan selisih mencolok (badge merah).
- AC-06.7: **Given** shift sudah `closed`, **When** `POST /shifts/:id/close` dipanggil lagi, **Then** 409 `SHIFT_ALREADY_CLOSED`; kasir membuka shift baru → `POST /shifts` sukses (bukan menimpa shift lama).
- AC-06.8: **Given** kasir A membuka shift, **When** kasir B memanggil `GET /shifts/:id` milik A, **Then** 403 `FORBIDDEN`; manager memanggil endpoint yang sama → 200 lengkap (manager bisa melihat semua shift, detail + transaksi + retur dalam rentang shift).
- AC-06.9: **Given** manager membuka `GET /shifts`, **When** respons diperiksa, **Then** paginated, filter `?userId=&from=&to=&status=`, tiap item: `id`, `shiftNumber`, `userId`, `userName`, `openedAt`, `closedAt`, `openingCash`, `cashSales`, `nonCashSales`, `refunds`, `expectedCash`, `actualCash`, `discrepancy`, `transactionCount`, `status`; kasir hanya melihat shift miliknya (server paksa).
- AC-06.10: **Given** shift yang melewati tengah malam (buka 23:00 WIB, tutup 01:30 WIB), **When** close diproses, **Then** window atribusi = `[opened_at, closed_at]` (bukan hari kalender) sehingga seluruh transaksi & retur dalam rentang itu masuk shift yang sama — konsisten dengan keputusan §1.3.3.
- AC-06.11: **Given** kasir menahan keranjang lalu menutup shift, **When** close diproses, **Then** hold TIDAK menghalangi tutup (hold bukan transaksi); hold yang tersisa tetap tampil di hari berikutnya? — **TIDAK**: hold kadaluarsa akhir hari WIB, jadi saat shift baru dibuka hold lama sudah tidak tampil (AC-04.6).

### US-07 — Retur barang dengan alasan
Sebagai **kasir**, saya bisa menerima retur barang dengan alasan & memilih metode refund, supaya pelanggan yang komplain tidak diabaikan dan stok kembali tercatat.

- AC-07.1: **Given** transaksi completed hari ini (milik kasir mana pun? — **TIDAK**: rule existing, kasir hanya akses transaksi hari ini), **When** kasir membuka menu "Retur" dari detail transaksi, **Then** UI menampilkan item yang bisa diretur: nama, qty terjual, qty sudah diretur (`returnedQuantity`), sisa yang bisa diretur, harga satuan snapshot; item dengan sisa 0 tampil nonaktif.
- AC-07.2: **Given** kasir memilih 2 item & qty retur, **When** alasan dipilih dari **daftar preset** (`rusak`, `kadaluarsa`, `salah_item`, `tidak_jadi`, `lainnya`), **Then** `POST /returns` dipanggil dengan `items: [{ transactionItemId, quantity, reason: "<teks preset>" }]` dan 201 `{ return, items, refundPayment }`; untuk preset `lainnya` input teks bebas wajib diisi dan dikirim sebagai reason.
- AC-07.3: **Given** total refund Rp 80.000 dari transaksi yang dibayar tunai, **When** kasir memilih `refundMethod='cash'`, **Then** respons `refundPayment` = baris `payments` type `refund` amount 80.000; stok kembali ke gudang default (movement `return_in`, `note: "Return RET-...: <alasan>"` — existing return.service).
- AC-07.4: **Given** qty retur melebihi sisa (mis. jual 5, sudah diretur 3, retur lagi 3), **When** `POST /returns`, **Then** 422 `RETURN_QTY_EXCEEDED` (`details.available=2, requested=3`) dan tidak ada perubahan stok/refund (atomic, existing).
- AC-07.5: **Given** transaksi berumur > `return.max_days` (default 7), **When** kasir membuka menu retur, **Then** UI menampilkan "Retur hanya berlaku 7 hari setelah transaksi" dan tombol retur nonaktif; panggilan API langsung → 422 `RETURN_TOO_LATE` (existing).
- AC-07.6: **Given** kasir memilih refund ke **poin** member, **When** `POST /returns` dengan `refundMethod='points'`, **Then** saldo poin member bertambah sesuai `points.redeem_value` (existing return.service §RET-03) dan struk/laporan menampilkan "Refund via poin".
- AC-07.7: **Given** transaksi yang sama punya retur sebelumnya, **When** detail transaksi dibuka, **Then** `returnSummary` existing menampilkan total refund & status; item memperlihatkan sisa qty yang benar.
- AC-07.8: **Given** setting `shift.enforce_checkout=true` dan kasir tanpa shift terbuka, **When** `POST /returns`, **Then** 409 `SHIFT_REQUIRED` (guard sama dengan checkout, route-level) dan tidak ada return tersimpan.

### US-08 — Akses, audit, dan keamanan modul kasir
Sebagai **admin**, saya memastikan kasir hanya mengelola hal miliknya sendiri dan semua aksi uang tercatat.

- AC-08.1: **Given** kasir login, **When** memanggil `POST /shifts`, `POST /shifts/:id/close`, `GET /shifts/current`, `GET /held-carts*`, `POST /held-carts*`, `POST /returns`, `GET /transactions/:id/receipt`, **Then** semua sukses untuk resource miliknya (kasir+) — shift & hold TIDAK bisa diakses lintas user (404/403).
- AC-08.2: **Given** kasir login, **When** memanggil `PATCH /settings` (termasuk `store.qris_payload`, `receipt.*`, `shift.*`), **Then** 403 `FORBIDDEN` (settings tulis = admin, existing); `GET /settings` tetap 200 (kasir butuh `store.qris_payload` & `receipt.footer` untuk struk).
- AC-08.3: **Given** setiap aksi mutasi (shift open/close, hold create/resume/discard, retur), **When** `GET /audit-logs` diperiksa sebagai admin, **Then** ada baris audit: `shift.open`, `shift.close` (dengan `discrepancy`), `held_cart.create`, `held_cart.resume`, `held_cart.discard`, `return.create` (existing) — `userId` benar, `newValues` berisi state setelah.
- AC-08.4: **Given** manager login, **When** memanggil `POST /transactions/:id/cancel` (void) atau melihat `GET /shifts` semua user, **Then** sukses (manager+); kasir memanggil void → 403 `FORBIDDEN` (existing).
- AC-08.5: **Given** kasir tanpa shift membuka `POST /held-carts` atau `POST /returns`, **When** request diproses, **Then** hold boleh dibuat tanpa shift? — **TIDAK**: hold & retur mengikuti guard shift yang sama dengan checkout (konsistensi tanggung jawab uang) → 409 `SHIFT_REQUIRED`.
- AC-08.6: **Given** `GET /transactions/:id/receipt?format=text`, **When** kasir hari ini membukanya, **Then** teks 40 kolom dikembalikan (`content-type: text/plain`) — dipakai frontend untuk payload WhatsApp; konten TIDAK mengandung `costPrice` (struk hanya harga jual, existing).

---

## 3. Model Data (tabel, kolom, tipe, constraint, index, relasi)

Konvensi global mengikuti `db-schema.md` §2 (UUID PK, uang BIGINT, qty NUMERIC(12,3), TIMESTAMPTZ, soft delete `deleted_at`, enum native). Kolom `created_at/updated_at` tidak diulang penuh di bawah (mengikuti konvensi).

**Fase 4 membuat 2 tabel baru + 1 enum baru; TIDAK ada ALTER tabel existing** (keputusan §1.3.3 — atribusi shift via window waktu, bukan FK).

### 3.1 Enum `shift_status` — P0

| Nilai | Keterangan |
|---|---|
| `open` | Shift aktif — kasir boleh checkout |
| `closed` | Shift ditutup — snapshot statistik tersimpan |

### 3.2 Tabel baru `shifts` — P0 (F4-6)

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK default gen_random_uuid() | |
| shift_number | VARCHAR(30) | NOT NULL, UNIQUE | `SHF-YYYYMMDD-XXXX` (pola `lib/sequence.ts`, sekuensial per hari) |
| outlet_id | BIGINT | NOT NULL DEFAULT 1 | Konsisten `transactions.outlet_id` |
| user_id | UUID | NOT NULL, FK → users.id | Pemilik shift. 1 user ≤ 1 shift open (dijaga aplikasi). |
| status | shift_status | NOT NULL DEFAULT 'open' | |
| opened_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Waktu buka (UTC; tampilan WIB) |
| closed_at | TIMESTAMPTZ | NULL | Terisi saat close |
| opening_cash | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | Modal kas awal (rupiah) |
| cash_sales | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | **Snapshot saat close**: Σ `payments.method='cash'` type `sale` dalam window |
| qris_sales | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | Snapshot Σ qris |
| transfer_sales | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | Snapshot Σ transfer |
| refunds | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | Snapshot Σ `returns.totalRefund` dalam window (semua metode refund) |
| expected_cash | BIGINT | NOT NULL DEFAULT 0 | `opening_cash + cash_sales − cash_refunds`. **Catatan:** cash_refunds dihitung dari refund leg cash — lihat §5.6 untuk rumus pasti |
| actual_cash | BIGINT | NULL | Modal kas akhir yang diinput kasir saat close |
| discrepancy | BIGINT | NOT NULL DEFAULT 0 | `actual_cash − expected_cash` (negatif = kurang, positif = lebih) |
| transaction_count | INTEGER | NOT NULL DEFAULT 0 | Snapshot jumlah transaksi `completed` dalam window |
| return_count | INTEGER | NOT NULL DEFAULT 0 | Snapshot jumlah return dalam window |
| notes | TEXT | NULL | Catatan wajib bila `discrepancy ≠ 0` |
| created_by | UUID | NULL, FK → users.id, ON DELETE SET NULL | |
| created_at / updated_at | TIMESTAMPTZ | s.d. konvensi | Tidak ada soft delete — shift adalah riwayat |

Index:
- `idx_shifts_user_status ON (user_id, status)` — cek shift terbuka per user (guard) + daftar shift kasir.
- `idx_shifts_opened_at ON (opened_at)` — filter rentang & laporan.
- `idx_shifts_status ON (status)`.

**Semantik (mengikat):**
- Window atribusi transaksi ke shift = `transactions.user_id = shifts.user_id AND sold_at >= opened_at AND sold_at < closed_at` (atau `< now()` saat shift masih open, untuk statistik live).
- Statistik `cash_sales/qris_sales/transfer_sales/refunds/transaction_count/return_count/expected_cash` dihitung **sekali saat close** dan disimpan sebagai snapshot. Bila transaksi divoid/return setelah shift ditutup → snapshot TIDAK berubah (histori shift tetap; koreksi terlihat di laporan transaksi, bukan di shift).
- Void transaksi (existing, manager+) TIDAK mengubah shift mana pun.

### 3.3 Tabel baru `held_carts` — P0 (F4-4)

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK default gen_random_uuid() | |
| hold_number | VARCHAR(30) | NOT NULL, UNIQUE | `HOLD-YYYYMMDD-XXXX` (pola `lib/sequence.ts`, sekuensial per hari) |
| outlet_id | BIGINT | NOT NULL DEFAULT 1 | |
| user_id | UUID | NOT NULL, FK → users.id | Pemilik hold (scoping kasir) |
| label | VARCHAR(100) | NULL | Nama pengingat: "Bu Rina — dompet", "Paket A". Kosong → fallback tampilan hold_number. |
| customer_id | UUID | NULL, FK → customers.id, ON DELETE SET NULL | Pelanggan terpilih saat hold (opsional) |
| items | JSONB | NOT NULL | Snapshot array `[{ productId, variantId?, unit?, quantity, discount? }]` — bentuk persis `items` body checkout (Fase 2 §4.4). Harga TIDAK disimpan (keputusan §1.3.6). |
| status | VARCHAR(20) | NOT NULL DEFAULT 'held' | `held` / `resumed` / `discarded` (VARCHAR, bukan enum — status terminal & bebas migrasi) |
| expires_at | TIMESTAMPTZ | NOT NULL | Akhir hari WIB saat dibuat (`23:59:59.999 WIB`). Kadaluarsa → tidak tampil di list (lazy, tanpa job). |
| resumed_at | TIMESTAMPTZ | NULL | Terisi saat resume |
| created_by | UUID | NULL, FK → users.id, ON DELETE SET NULL | |
| created_at / updated_at | TIMESTAMPTZ | s.d. konvensi | |

Constraint & index:
- `idx_held_carts_user_status ON (user_id, status)` — list hold aktif per kasir.
- `idx_held_carts_expires ON (expires_at)`.
- CHECK: `items` adalah JSON array (validasi aplikasi; CHECK `jsonb_typeof(items) = 'array'` sebagai jaring pengaman).

**Semantik (mengikat):**
- Hold TIDAK memvalidasi harga/stok saat dibuat (hanya bentuk item + `productId` ada). Semua validasi terjadi saat resume → checkout (existing `computeTransaction`).
- Produk/varian yang dihapus/nonaktif setelah hold → saat checkout via `POST /transactions` gagal seperti biasa (`NOT_FOUND`/`PRODUCT_INACTIVE`/`VARIANT_NOT_FOUND`) — kasir membuang item tsb dari keranjang hasil resume.
- Kadaluarsa tidak menghapus baris (riwayat); `GET /held-carts` hanya mengembalikan `status='held' AND expires_at > now()`.
- Limit aktif per user per hari (WIB) = `settings['pos.hold_per_day_limit']` (default 20); yang dihitung = hold dengan `status='held'` dibuat hari ini WIB.

### 3.4 `settings` — key baru (bukan perubahan skema)

| Key | Tipe value | Default | Keterangan |
|---|---|---|---|
| `shift.enforce_checkout` | boolean | `true` | Guard route: checkout/retur/hold wajib shift terbuka milik user. `false` = dev/demo tanpa shift. |
| `shift.cash_tolerance` | number (rupiah) | `0` | Ambang selisih kas yang TIDAK memerlukan catatan. |discrepancy| > tolerance → notes wajib saat close. |
| `store.whatsapp_number` | string | `''` | Nomor WA toko format internasional `628xxx` — fallback kirim struk saat pelanggan tanpa nomor. |
| `receipt.print_width_mm` | number | `80` | Lebar kertas struk (80/58) — dipakai frontend pilih class CSS print. |
| `receipt.show_verification_qr` | boolean | `false` | Cetak QR verifikasi `FPOS\|TRX-...\|<id>` di struk. |
| `receipt.show_qris_qr` | boolean | `false` | Cetak QRIS statis toko di struk (butuh `store.qris_payload` terisi; kosong → QR di-skip). |
| `pos.hold_per_day_limit` | number | `20` | Maks hold aktif per kasir per hari. |

Frontend `use-settings.ts` & `lib/types.ts` ditambah key di atas (pola existing `store.qris_payload`, `receipt.footer`).

### 3.5 Ringkasan perubahan vs skema existing

| Objek | Perubahan | Breaking? |
|---|---|---|
| `shifts` | Tabel baru (CREATE IF NOT EXISTS) | Tidak |
| `held_carts` | Tabel baru (CREATE IF NOT EXISTS) | Tidak |
| enum `shift_status` | Enum baru | Tidak |
| `transactions`, `returns`, `payments`, `checkout/return/receipt service` | **TIDAK diubah** (keputusan §1.3.3) | — |

**Migrasi (rencana):** file baru `apps/api/src/db/ddl-phase4.sql` (semua `CREATE TABLE IF NOT EXISTS` + `CREATE TYPE IF NOT EXISTS` — pola: `DO $$ BEGIN CREATE TYPE shift_status ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`), dieksekusi di `migrate.ts` setelah `ddl-phase3.sql` (tahap 4). `drizzle-kit check` lulus. Rollback: drop `held_carts`, `shifts`, drop type `shift_status` (urut terbalik; catatan: drop type butuh tabel kosong). Migrasi **idempotent**.

---

## 4. Kontrak API (endpoint, method, request, response, kode error)

Base: `/api/v1`. Envelope: `{ ok, data }` / `{ ok:false, error:{ code, message, details? } }` (api-design.md §1.2 — mengikat). Semua uang integer rupiah, qty NUMERIC(12,3). Role guard: **shift & hold = pemilik (kasir+) / manager+ utk lintas user**, **settings tulis = admin** (existing), **void = manager+** (existing).

### 4.1 Shift

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `POST /shifts` | kasir+ | `{ openingCash: number ≥ 0, notes? }` | 201 `{ shift }` (status `open`) | `SHIFT_ALREADY_OPEN` (409, details.shiftId), `VALIDATION_ERROR` (422, openingCash < 0) |
| `GET /shifts/current` | kasir+ | — | `{ shift: null \| { id, shiftNumber, openedAt, openingCash, cashSales, qrisSales, transferSales, refunds, expectedCash, transactionCount } }` — statistik live dihitung dari window `[opened_at, now())`; `null` bila tidak ada shift open milik user | — |
| `POST /shifts/:id/close` | pemilik atau manager+ | `{ actualCash: number ≥ 0, notes? }` | 200 `{ shift, summary }` — shift berstatus `closed`; `summary` = snapshot lengkap (openingCash, cashSales, qrisSales, transferSales, refunds, expectedCash, actualCash, discrepancy, transactionCount, returnCount) | `SHIFT_NOT_FOUND` (404), `SHIFT_ALREADY_CLOSED` (409), `FORBIDDEN` (403 — bukan pemilik & bukan manager), `VALIDATION_ERROR` (422 — actualCash < 0), `SHIFT_DISCREPANCY_NOTE_REQUIRED` (422 — \|discrepancy\| > `shift.cash_tolerance` dan notes kosong) |
| `GET /shifts` | kasir: milik sendiri; manager+: semua | query: `userId` (manager+), `from`, `to`, `status` (`open`/`closed`), `page`, `perPage` | `{ items, meta }` — item: `{ id, shiftNumber, userId, userName, openedAt, closedAt, openingCash, cashSales, qrisSales, transferSales, refunds, expectedCash, actualCash, discrepancy, transactionCount, returnCount, status }` | — |
| `GET /shifts/:id` | pemilik atau manager+ | — | `{ shift, summary, transactions: [{ id, invoiceNumber, total, paymentStatus, soldAt }], returns: [{ id, returnNumber, totalRefund, returnedAt }] }` — transaksi/retur dalam window atribusi (§3.2); `summary` = snapshot (closed) atau live (open) | `SHIFT_NOT_FOUND` (404), `FORBIDDEN` (403) |

Audit: `shift.open`, `shift.close` (newValues: openingCash, expectedCash, actualCash, discrepancy, transactionCount, returnCount).

### 4.2 Held carts

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `POST /held-carts` | kasir+ (guard shift) | `{ label?, customerId?, items: [{ productId, variantId?, unit?, quantity, discount? }] }` — bentuk persis items checkout; min 1 item | 201 `{ heldCart }` — `{ id, holdNumber, label, customerId, items, status:'held', expiresAt }` | `VALIDATION_ERROR` (422 — items kosong / bentuk salah / productId bukan UUID), `HELD_CART_LIMIT` (409), `SHIFT_REQUIRED` (409) |
| `GET /held-carts` | kasir+ | query: `page`, `perPage` | `{ items, meta }` — hanya `status='held' AND expires_at > now()` milik user; item + `expiresAt`, `remainingMinutes` (hitung server) | — |
| `GET /held-carts/:id` | pemilik | — | `{ heldCart }` | `HELD_CART_NOT_FOUND` (404 — termasuk hold milik user lain, tanpa bocorkan keberadaan) |
| `POST /held-carts/:id/resume` | pemilik | — | 200 `{ heldCart }` — status `resumed`, `resumedAt` terisi, `items` dikembalikan utuh; item yang produknya nonaktif/hapus TETAP dikembalikan (validasi terjadi saat checkout) | `HELD_CART_NOT_FOUND` (404), `HELD_CART_EXPIRED` (409 — expires_at lampau), `HELD_CART_NOT_ACTIVE` (409 — sudah resumed/discarded) |
| `DELETE /held-carts/:id` | pemilik | — | 200 `{ id, discarded:true }` — status `discarded` (soft, bukan hapus fisik) | `HELD_CART_NOT_FOUND` (404), `HELD_CART_NOT_ACTIVE` (409) |

Audit: `held_cart.create`, `held_cart.resume`, `held_cart.discard`.

### 4.3 Struk (perluasan kecil dari existing — TIDAK ada endpoint baru)

| Method & Path | Role | Request | Response | Keterangan |
|---|---|---|---|---|
| `GET /transactions/:id/receipt` | kasir+ (rule existing: kasir hanya hari ini) | query: `format=text` (existing) | existing | **TIDAK diubah.** Frontend memakai `?format=text` untuk payload WhatsApp, dan JSON `receipt` (dari respons checkout) untuk render print. |
| `GET /transactions/:id` | kasir+ (rule existing) | — | existing `loadTransactionDetail` | Frontend detail transaksi (dipakai menu retur & reprint). Tidak diubah. |
| `POST /returns` | kasir+ (guard shift) | existing body (`transactionId`, `items[{transactionItemId, quantity, reason}]`, `refundMethod`, `notes?`) | existing 201 | **Service tidak diubah**; hanya route ditambah guard `SHIFT_REQUIRED` (bila `shift.enforce_checkout=true`). Alasan dari UI preset dikirim sebagai teks. |

### 4.4 Guard shift (perubahan route — satu-satunya perubahan kode existing)

Di `apps/api/src/routes/transactions.routes.ts` (POST `/transactions`) dan `apps/api/src/routes/returns.routes.ts` (POST `/returns`), SEBELUM memanggil service:

```ts
// Pseudo — guard additive, logika service TIDAK disentuh
if (await enforceShift(user)) fail('SHIFT_REQUIRED', 'Buka shift dulu sebelum transaksi', 409);
```

- `enforceShift` membaca `settings['shift.enforce_checkout']` (default true) → `false` = skip.
- Membaca shift `open` milik `user.id` (query `idx_shifts_user_status`). Tidak ada → 409.
- Sama sekali tidak menyentuh `computeTransaction`, `commitCheckout`, `createReturn`.

### 4.5 Daftar kode error baru (lengkap)

| Kode | HTTP | Kapan |
|---|---|---|
| `SHIFT_ALREADY_OPEN` | 409 | `POST /shifts` saat user sudah punya shift `open` (details.shiftId) |
| `SHIFT_NOT_FOUND` | 404 | Shift tidak ada |
| `SHIFT_ALREADY_CLOSED` | 409 | Tutup shift yang sudah `closed` |
| `SHIFT_REQUIRED` | 409 | Checkout/retur/hold tanpa shift terbuka saat `shift.enforce_checkout=true` |
| `SHIFT_DISCREPANCY_NOTE_REQUIRED` | 422 | \|discrepancy\| > tolerance & notes kosong saat close |
| `HELD_CART_NOT_FOUND` | 404 | Hold tidak ada / milik user lain |
| `HELD_CART_LIMIT` | 409 | Melebihi `pos.hold_per_day_limit` hold aktif |
| `HELD_CART_EXPIRED` | 409 | Resume hold yang `expires_at` lampau |
| `HELD_CART_NOT_ACTIVE` | 409 | Resume/discard hold berstatus `resumed`/`discarded` |
| `HELD_CART_INVALID_ITEMS` | 422 | items kosong / bentuk salah / qty ≤ 0 / productId bukan UUID (dipakai menggantikan `VALIDATION_ERROR` generik untuk hold) |

---

## 5. Aturan Bisnis (rumus, ambang batas, urutan)

1. **Split payment (konsisten existing `processPayments`):** `Σ payments[].amount` harus = total transaksi, else 422 `PAYMENT_MISMATCH`. Kembalian (`changeAmount`) hanya dihitung & disimpan untuk leg `cash` (`cashReceived − applied`). Leg non-cash tidak pernah punya change. UI memblokir kirim sebelum lunas (UX), server tetap menjamin (authoritative).
2. **Quick cash:** tombol "Uang Pas" set `cashReceived = total`; tombol pecahan (50.000/100.000/200.000) set `cashReceived` ke pecahan terpilih (boleh < total? — TIDAK: `cashReceived < amount` → 422 `PAYMENT_MISMATCH` existing; UI menyembunyikan pecahan < total dan menandai pecahan yang menghasilkan kembalian).
3. **Harga & stok tidak pernah dipercaya dari client/hold:** hold menyimpan hanya `{productId, variantId?, unit?, quantity, discount?}` (tanpa harga); resume → preview/checkout menghitung ulang dari DB (existing api-design §3). Harga basi di keranjang tampil sampai preview mengoreksi (badge "harga berubah").
4. **Atribusi shift (window waktu):** transaksi milik shift `S` (user `u`) bila `sold_at ∈ [S.opened_at, S.closed_at)` (atau `< now()` saat open) dan `transactions.user_id = u`. Retur: `returned_at` dalam window yang sama & `returns.user_id = u`. Prasyarat tak-ambigu: 1 user ≤ 1 shift open (`SHIFT_ALREADY_OPEN`).
5. **Rumus tutup shift (snapshot, dihitung & disimpan saat `POST /shifts/:id/close`):**
   - `cashSales = Σ payments.amount` (method `cash`, type `sale`, transaksi window, status transaksi `completed`, status payment `paid`).
   - `qrisSales` / `transferSales` = analog untuk method masing-masing.
   - `refunds = Σ returns.totalRefund` (window, status `completed`).
   - `cashRefunds = Σ refundPayment.amount` (payments type `refund`, method `cash`, window) — untuk rumus kas.
   - `expectedCash = openingCash + cashSales − cashRefunds`.
   - `discrepancy = actualCash − expectedCash` (positif = lebih, negatif = kurang).
   - `transactionCount` = jumlah transaksi window; `returnCount` = jumlah return window.
   - Bila `|discrepancy| > settings['shift.cash_tolerance']` (default 0) → `notes` wajib (422 `SHIFT_DISCREPANCY_NOTE_REQUIRED`).
6. **Statistik shift live (GET /shifts/current & detail open):** query window `[opened_at, now())` dengan rumus sama; `expectedCash` live = `openingCash + cashSales − cashRefunds` (kasir melihat posisi kas realtime di banner).
7. **Hold:** `expiresAt = akhir hari WIB tanggal dibuat` (23:59:59.999). List hanya `status='held' AND expires_at > now()`. Limit aktif dihitung dari hold `status='held'` dengan `created_at` hari ini WIB. Resume tidak memvalidasi produk/stok (validasi di checkout); resume boleh dilakukan berkali-kali? — **TIDAK**: resume sekali → status `resumed`; resume ulang → 409 `HELD_CART_NOT_ACTIVE` (kasir membuat hold baru bila perlu).
8. **Preset alasan retur (UI):** `rusak` (Barang rusak/cacat), `kadaluarsa` (Kadaluarsa), `salah_item` (Salah item), `tidak_jadi` (Tidak jadi / berubah pikiran), `lainnya` (wajib isi teks bebas). Dikirim sebagai teks ke `POST /returns` (backend tidak diubah, tetap teks bebas ≥ 1 char).
9. **Struk:** lebar 40 kolom (konsisten `receiptText`), `@page size: <receipt.print_width_mm>mm auto`; konten struk = `ReceiptData` existing (toko dari settings + snapshot item/payment). WA: `https://wa.me/<nomor>?text=<urlencoded receiptText>` — nomor pelanggan (`customers.phone`, normalisasi `08xx` → `628xx`) → fallback `store.whatsapp_number` → toast error bila kosong. QR verifikasi: `FPOS|TRX-YYYYMMDD-XXXX|<transaction_id>`; scan via input barcode POS → `GET /transactions/:id` (rule kasir hari ini tetap berlaku).
10. **Prioritas stok di kartu produk POS:** tampil `availableStock` dalam unit dasar (atau satuan terpilih saat modal satuan) dari gudang default (Fase 3 §5.1) — kasir melihat stok operasional, bukan total semua gudang.

---

## 6. Alur Status (state machine)

### 6.1 Shift

```
open ──POST /shifts/:id/close (actualCash, notes?)──▶ closed (terminal; snapshot tersimpan)
 │
 └──(user buka lagi)──▶ shift baru open (SHF-... baru; SHIFT_ALREADY_OPEN dicegah selama ada open)
```
Aturan transisi:
- `open → closed` hanya oleh pemilik shift atau manager+; pemilik tanpa shift lain yang open (409 `SHIFT_ALREADY_OPEN` tidak relevan — close tidak menciptakan shift).
- Shift `closed` TIDAK bisa dibuka ulang / diedit (histori; koreksi via void/return di level transaksi).
- Void transaksi (existing) setelah shift ditutup: snapshot shift tidak berubah (documented limitation, §3.2).

### 6.2 Held cart

```
held ──POST /:id/resume──▶ resumed (terminal; item dipindah ke cart lokal)
held ──DELETE /:id───────▶ discarded (terminal)
held ──(expires_at lewat)─▶ tetap 'held' di DB, tidak tampil di list (lazy)
```
Aturan transisi: hanya pemilik; `resumed`/`discarded` tidak bisa diubah lagi (409 `HELD_CART_NOT_ACTIVE`). Resume TIDAK membuat transaksi — alur dilanjutkan kasir ke pembayaran seperti keranjang biasa.

### 6.3 Transaksi, retur, payment
Tidak ada state machine baru — seluruhnya memakai state existing (`transaction_status`, `return_status`, `payment_status`) yang TIDAK berubah (Fase 2 §6.3). Fase 4 hanya menambah guard shift sebelum membuat transaksi/retur.

---

## 7. Kasus Tepi & Penanganan Error (minimal 5 per fitur)

### 7.1 Mobile POS & keranjang
1. **Viewport sempit (320px) / landscape** → grid turun ke 1–2 kolom via breakpoint; bottom sheet max-height 80vh dengan scroll; tombol tetap ≥ 44px.
2. **Scanner kirim barcode + Enter saat fokus di input lain** → input scan tersembunyi selalu fokus (kecuali saat keypad/modal terbuka); `Enter` pada input scan tidak submit form lain.
3. **Produk di-grid stok 0 tapi `trackStock=false` (jasa)** → tetap bisa ditambah (tidak dicek stok, konsisten AC-04.1 Fase 2); badge menampilkan "Jasa" bukan "Stok habis".
4. **qty desimal (0.5 kg)** → keypad qty menerima desimal; format `toQty` 3 desimal; cek batas stok client memakai `availableStock` (floor) — konsisten server.
5. **Dua kasir di perangkat sama (logout/login bergantian)** → cart localStorage di-scope per user? — **TIDAK**: `pos.cart` global per browser (existing); hold server-side adalah mekanisme pemisahan yang benar — kasir yang berganti login menahan cart-nya sebelum logout (dokumentasi UI).
6. **Total > 1 milyar (overflow tampilan)** → formatIDR existing; tidak ada batas baru (BIGINT aman).

### 7.2 Split payment
1. **Pembayaran campuran dengan kembalian** → kembalian hanya dari leg cash; UI menampilkan "Kembalian Rp X" sekali (bukan per leg).
2. **Total berubah setelah pembayaran terisi (harga server ≠ client)** → preview di "Bayar" memakai total server; UI menyesuaikan & menandai selisih; pembayaran client di-reset bila total naik (mencegah PAYMENT_MISMATCH membingungkan).
3. **Uang pas dipilih lalu total berubah** → `cashReceived` ikut diset ulang ke total baru.
4. **Leg qris lebih besar dari total** → UI memblokir (amount ≤ sisa); server tetap 422 `PAYMENT_MISMATCH` ("Nominal pembayaran melebihi total transaksi").
5. **QRIS payload kosong (`store.qris_payload=''`)** → tombol QRIS tetap ada, QR diganti placeholder "Minta pembayaran QRIS manual / scan pelanggan" tanpa error; transaksi qris tetap bisa ditandai lunas (existing flow).

### 7.3 Hold
1. **Hold di-resume setelah produk dihapus (soft delete)** → item tetap dikembalikan; checkout → 404 `NOT_FOUND`; kasir hapus item tsb dari cart.
2. **Hold di-resume saat stok kurang** → checkout → 409 `STOCK_INSUFFICIENT` (existing); kasir kurangi qty.
3. **Hold lintas tengah malam** → `expires_at` = akhir hari WIB saat dibuat → expired; resume → 409 `HELD_CART_EXPIRED`.
4. **Crash server saat POST /held-carts** → atomic (1 insert); client retry aman (hold_number unique, retry 1× pola `lib/sequence.ts`).
5. **Hold berisi item `unit='dus'` lalu satuan dihapus dari master** → checkout → 422 `UNIT_NOT_FOUND` (existing); kasir ganti satuan.
6. **Banyak hold lama menumpuk** → tidak ada job cleanup (lazy filter by expires_at); DB row kecil; arsip bisa dibersihkan manual (P1-late).

### 7.4 Struk
1. **Nama item > 40 kolom** → wrap baris berikutnya; angka tetap rata kanan (AC-05.8).
2. **Printer thermal 58mm dipilih via setting** → CSS 58mm (lebar konten ~48mm, font 10px, 32 kolom) — TIDAK ada backend baru (frontend class print).
3. **`wa.me` diblokir popup** → buka di tab baru (`window.open`) bukan popup; fallback: salin teks struk ke clipboard + toast.
4. **QRIS payload invalid (bukan string QR valid)** → `react-qr-code` render tetap jalan (teks apa pun jadi QR); bila kosong → QR di-skip (AC-05.6).
5. **Reprint transaksi kemarin oleh kasir** → 403 `FORBIDDEN` (rule existing; manager boleh).
6. **Print saat offline** → data struk sudah ada di respons checkout (client-side); print jalan offline; WA tetap butuh internet (buka tab, browser menangani).

### 7.5 Shift
1. **Kasir lupa tutup shift lalu buka shift baru** → 409 `SHIFT_ALREADY_OPEN` dengan details.shiftId; UI menawarkan "Tutup shift lama" (menuju modal tutup) — tidak ada auto-close.
2. **Shift open saat server restart** → tidak ada state in-memory; shift open tetap terbaca dari DB; window atribusi memakai `closed_at IS NULL → now()` — transaksi sebelum restart tetap masuk shift.
3. **Selisih kas besar (mis. −500.000)** → close tetap diizinkan dengan notes wajib; audit `shift.close` mencatat; manager melihat badge merah di list shift.
4. **Kasir tutup shift di tengah transaksi berjalan (double-tab)** → close dalam 1 transaksi DB dengan lock baris shift (`FOR UPDATE`); tab kedua mendapat `SHIFT_ALREADY_CLOSED`; transaksi yang sudah commit sebelum close tetap masuk shift (window).
5. **Shift melewati tengah malam** → window `[opened_at, closed_at]` menangani (AC-06.10); `shift_number` tetap tanggal buka.
6. **`GET /shifts/current` saat shift open dan kasir baru checkout** → statistik live terhitung; banner "Kas: Rp X" memberi kasir posisi kas realtime.

### 7.6 Retur
1. **Retur item yang sudah diretur sebagian** → sisa dihitung `quantity − returnedQuantity` (existing); UI menampilkan sisa.
2. **Retur dengan guard shift aktif tapi kasir pindah shift (tutup lalu buka baru)** → guard membaca shift open saat request → shift baru; retur tercatat di window shift baru (returned_at).
3. **Retur transaksi yang sudah divoid** → 422 `INVALID_TRANSACTION` (existing — hanya completed).
4. **Preset `lainnya` tanpa teks** → UI memblokir (reason wajib, RET-04 existing); server juga memvalidasi ≥ 1 char.
5. **Refund qris/transfer saat QRIS pelanggan tidak tersedia** → kasir pilih cash/points; tidak ada alur QRIS dinamis (P1-late).

---

## 8. Dampak ke Modul yang Sudah Ada + Rencana Migrasi

### 8.1 Dampak per modul

| Modul / file | Dampak | Aksi wajib |
|---|---|---|
| **Checkout** (`services/checkout.service.ts`) | **TIDAK diubah** | Regresi: `POST /transactions` dengan `payments[]` multi-metode (2–3 leg) menghasilkan 201 & paymentStatus `paid`; angka identik Fase 2 untuk payload lama (1 payment) |
| **`routes/transactions.routes.ts`** | +guard `SHIFT_REQUIRED` (1 blok sebelum `commitCheckout`, §4.4) | Tambah; test: kasir tanpa shift → 409, dengan shift → 201 |
| **Return** (`services/return.service.ts`) | **TIDAK diubah** (alasan preset dikirim sebagai teks) | Regresi: retur dengan reason preset & `lainnya`-bebas → 201; stok balik `return_in` |
| **`routes/returns.routes.ts`** | +guard `SHIFT_REQUIRED` (1 blok sebelum `createReturn`) | Tambah; test 409 tanpa shift |
| **Receipt** (`services/receipt.ts`, `buildReceipt`, `receiptText`) | **TIDAK diubah** | Frontend print & WA memakai output existing |
| **Schema** (`db/schema.ts`) | +2 tabel (`shifts`, `held_carts`) + enum `shift_status` | `drizzle-kit check` lulus; `ddl-phase4.sql` di `migrate.ts` (tahap 4) |
| **Sequence** (`lib/sequence.ts`) | +`nextShiftNumber()` (`SHF-...`) & `nextHoldNumber()` (`HOLD-...`) — pola `nextTransferNumber` existing | Tambah; retry 1× saat konflik (23505) |
| **Settings** (`lib/settings.ts`, `use-settings.ts`, `types.ts`) | +7 key (§3.4) | Default di kedua sisi (server & hook) |
| **POS page** (`apps/web/src/app/(app)/pos/page.tsx`) | Refactor ke komponen: `pos-product-grid`, `pos-cart-sheet`, `pos-payment-sheet` (split), `pos-hold-list`, `pos-shift-banner` (buka/tutup), `pos-return-dialog`, `receipt-actions` (print/WA/QR) | UI Fase 4; logika cart & checkout existing dipertahankan (jangan tulis ulang hitung) |
| **Detail transaksi** (`transactions/[id]/page.tsx`, `receipt.tsx`) | +aksi cetak/WA/QR & tombol retur | Tambah |
| **Types frontend** (`lib/types.ts`) | +`Shift`, `ShiftSummary`, `HeldCart`, `HeldCartItem`, `ReceiptActions`; `Settings` +7 key | Update paralel schema |
| **Dashboard / laporan** | Tidak berubah (shift report = P1-late) | — |
| **Audit** | +`shift.open`, `shift.close`, `held_cart.*` | Tambah di service baru |

### 8.2 Rencana migrasi (urutan eksekusi)

1. **Schema**: update `apps/api/src/db/schema.ts` (+2 tabel, +1 enum, +2 helper sequence) → `drizzle-kit check` lulus.
2. **DDL**: buat `apps/api/src/db/ddl-phase4.sql` (idempotent: `CREATE TABLE IF NOT EXISTS`, enum via `DO $$ ... EXCEPTION WHEN duplicate_object`) + panggil dari `migrate.ts` setelah `ddl-phase3.sql`.
3. **Backfill**: tidak ada (tabel baru kosong; kolom existing tidak disentuh).
4. **API**: routes baru `shifts.routes.ts`, `held-carts.routes.ts`; guard 1 blok di `transactions.routes.ts` & `returns.routes.ts`; `nextShiftNumber`/`nextHoldNumber` di `lib/sequence.ts`.
5. **Settings**: default server (`lib/settings.ts`) + hook frontend + tipe.
6. **UI**: refactor POS page (grid/sheet/payment/hold/shift/return) + receipt actions.
7. **Test**: seluruh AC §2 (backend HTTP + query DB + E2E Playwright viewport 390×844 untuk US-01..07), jalan di CI.
8. **Rollback**: drop `held_carts`, `shifts`, drop type `shift_status`; hapus guard 2 baris dari routes; hapus key settings (tidak destruktif). Tidak ada data Fase 1–3 yang hilang.
9. **Deploy**: Dokploy — jalankan migrasi sebelum deploy API baru; `shift.enforce_checkout` default `true` di produksi, `false` hanya dev/demo.

---

## 9. Bukan-Fungsional (target waktu, perilaku offline, hak akses)

### 9.1 Performa (angka target — p95, LAN homelab, DB lokal; diuji dengan seed penuh; POS = layar 200×/hari)

| Operasi | Target | Catatan |
|---|---|---|
| `GET /products?isActive=true&perPage=100` (grid POS) | < 500 ms | Index existing; tanpa `includeUnits` di list (Fase 2 §9.1) |
| `GET /products?q=` (pencarian grid) | < 200 ms | Trigram name existing |
| `GET /products/barcode/:code` (scan) | < 300 ms | Unique index partial |
| `GET /products/:id` (detail: variants + units, modal varian/satuan) | < 200 ms | Dipanggil hanya saat modal dibuka (bukan per grid) |
| Tambah item ke keranjang (client-only) | < 50 ms | Tanpa request; state React |
| `POST /transactions/preview` (5 item) | < 300 ms | Tanpa lock (existing) |
| `POST /transactions` (5 item, split 2–3 payment) | < 1 s | Satu transaksi DB (existing) |
| `POST /held-carts` / resume / discard | < 200 ms | 1 insert/update |
| `POST /shifts` / `POST /shifts/:id/close` | < 300 ms | Close: 1 transaksi + 3 query agregat window |
| `GET /shifts/current` (banner kasir) | < 150 ms | Index (user_id, status) |
| `GET /transactions/:id/receipt` (reprint) | < 200 ms | Existing |
| Render + dialog print struk | < 500 ms | Client-side; data sudah di tangan |
| Respons list shift/hold | < 300 ms | Paginated |

**Target UX (E2E):** alur umum "3 item → tunai 100rb → proses" = **≤ 6 ketukan** setelah produk tampil (3× tap produk + 1 FAB + 1 quick-cash + 1 proses). Checkout double-tap tidak menghasilkan duplikat (Idempotency-Key existing + tombol disabled saat submit).

### 9.2 Perilaku offline
- **Tetap online-only** (keputusan Fase 2 §9.2): checkout, preview, hold, shift, retur butuh server.
- **Satu-satunya pengecualian:** cart lokal (localStorage, existing) & struk print (data dari respons checkout) jalan offline. Barcode scan butuh server (`/products/barcode`) → offline gagal dengan toast.
- Hold offline → gagal total, cart lokal dipertahankan (AC-04.9); retry manual.
- Tidak ada antrian offline/queue (Fase 2 §9.2 — tidak berubah).

### 9.3 Hak akses (ringkas — detail §4 & US-08)

| Aksi | Kasir | Manager | Admin |
|---|---|---|---|
| POS: grid, cart, split payment, struk print/WA/QR | ✅ | ✅ | ✅ |
| Buka/tutup shift **milik sendiri**, `GET /shifts/current` | ✅ | ✅ | ✅ |
| Lihat semua shift / tutup shift kasir lain | ❌ | ✅ | ✅ |
| Hold: buat/lihat/resume/buang **milik sendiri** | ✅ | ✅ | ✅ |
| Hold milik kasir lain | ❌ | ❌ | ❌ (404) |
| Retur (dengan alasan, refund cash/qris/transfer/points) | ✅ (transaksi hari ini) | ✅ | ✅ |
| Void transaksi | ❌ | ✅ | ✅ |
| Baca settings publik (`store.qris_payload`, `receipt.*`, `shift.*`) | ✅ | ✅ | ✅ |
| Tulis settings | ❌ | ❌ | ✅ |
| Lihat audit log | ❌ | ❌ | ✅ |

### 9.4 Keamanan & integritas
- Semua endpoint mutasi baru (shift, hold) → role guard + audit log (append-only).
- Validasi body via TypeBox (pola existing): `openingCash`/`actualCash` integer ≥ 0, UUID format, `items` array min 1, qty > 0, string length caps.
- **Scoping server-side:** hold & shift TIDAK pernah bisa diakses lintas user oleh kasir (404/403 server-paksa, bukan hanya sembunyi di UI).
- **Harga tidak pernah dikirim dari client untuk hitung** — hold menyimpan tanpa harga; checkout menghitung ulang (existing). Struk/`receiptText` tidak mengandung `costPrice`.
- QRIS payload & nomor WA toko: baca kasir (dibutuhkan struk), tulis admin. Nomor WA pelanggan hanya dipakai client-side untuk membuka `wa.me` — tidak dikirim ke server pihak ketiga lain.
- Idempotency-Key existing tetap wajib untuk `POST /transactions` (double-tap aman); guard `SHIFT_REQUIRED` dievaluasi **sebelum** idempotency reserve (409 lebih dulu daripada replay).
- Print thermal via dialog browser: tidak ada data yang keluar dari browser selain ke printer lokal (tanpa driver native, tanpa server print).
