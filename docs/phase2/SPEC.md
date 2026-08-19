# SPEC — Fase 2: Data & Produk

> **Proyek:** FakhriPOS — POS (Bun + Elysia + Drizzle ORM, Next.js + shadcn/ui, PostgreSQL `db_pos`)
> **Peran penulis:** System Analyst — output dari riset BA (`docs/phase2/RESEARCH.md`)
> **Tanggal:** 19 Agustus 2026
> **Status:** mengikat untuk developer (backend + frontend) Fase 2
> **Referensi:** `spec/features.md` (PROD-01..14), `spec/db-schema.md` v2.0, `spec/api-design.md` v2.0, `docs/fase-0-schema.md`, `RESEARCH.md` (R1–R13), `apps/api/src/db/schema.ts`, `apps/web/src/lib/types.ts`, `apps/web/src/lib/types-warehouse.ts`

**Notasi prioritas:** P0 = wajib Fase 2 ini · P1-late = setelah Fase 2 (disebut sebagai catatan, TIDAK dikerjakan Fase 2).
Semua angka uang = **integer rupiah** (BIGINT). Semua qty = **NUMERIC(12,3)**. Semua waktu = **TIMESTAMPTZ** UTC, tampilan WIB. Semua ID = UUID.

---

## 1. Lingkup — masuk apa, TIDAK masuk apa

### 1.1 MASUK (Fase 2: Data & Produk)

| # | Fitur | Catatan lingkup |
|---|---|---|
| F2-1 | **DB schema update** | Tabel baru: `product_variants`, `product_units`, `warehouses`, `warehouse_stocks`, `stock_transfers`, `stock_adjustments`. Alter: `products` (+4 kolom), `transaction_items` (+3 kolom), `stock_movements` (+1 kolom). Migration idempotent. |
| F2-2 | **Seed script** | 60–80 produk Indonesia, ±15 produk ber-varian, ±20 produk multi-satuan, 3 produk jasa (`track_stock=false`), 4 gudang, ±25 pelanggan + member, 300+ transaksi, 4 user (1 admin, 1 manager, 2 kasir). Idempotent + self-check. |
| F2-3 | **CRUD produk dengan varian** | API penuh: produk (extend existing) + varian (sub-resource) + pencarian varian + scan barcode varian + adjust stok varian. UI list/detail/form varian. |
| F2-4 | **Konversi satuan** | `product_units` (unit dasar + faktor + harga per unit + flag jual/beli). API CRUD unit per produk. **Backend checkout/preview menerima `unit` + `variantId`** (UI kasir = Fase 4, tetapi kontrak & perhitungan server wajib benar di Fase 2 agar bisa diuji). |
| F2-5 | **Import/Export Excel** | Import produk+varian+satuan dari `.xlsx` (template download, validasi per baris, laporan error, atomic atau partial). Export `.xlsx` 3 sheet (Produk, Varian, Satuan) round-trip kompatibel dengan template import. |

### 1.2 TIDAK MASUK (sengaja, dengan catatan)

| Tidak masuk | Alasan / penanganan |
|---|---|
| CRUD gudang, stok per gudang, transfer, adjustment, kartu stok (API & UI) | Fase 3. Fase 2 hanya **membuat tabel** + seed 4 gudang + invariant `Σ warehouse_stocks = products.stock_on_hand`. |
| FEFO/batch penuh (per-batch expiry) | R3 BA: iterasi pertama cukup `expiry_date` per produk (P1-late untuk batch). |
| Harga grosir bertingkat otomatis (berubah saat qty cart melewati ambang) | R5 BA. Kolom `min_qty` **dibuat di skema**; logika pilih-harga otomatis saat cart = luar lingkup Fase 2 (Fase 4/P1-late). Yang WAJIB jalan Fase 2: harga per satuan dipakai sesuai satuan yang dipilih. |
| Modul pembelian & supplier (R6) | P1-late. `product_units.is_purchase_unit` hanya sebagai **data flag** di Fase 2. |
| Konsinyasi (R9), barcode internal & cetak label (R10), regulatory number BPOM/PIRT (R11) | P2. Tidak dikerjakan. |
| Varian + satuan sekaligus (varian yang juga multi-unit) | **Keputusan scope (catatan eksplisit):** di Fase 2 varian TIDAK punya `product_units` sendiri — varian dijual dalam unit dasar parent. Unit per varian = P1-late. |
| Offline/PWA, cart server-side | Keputusan P0 existing: online-only; cart tetap di frontend. |
| Import CSV | **Catatan eksplisit:** Fase 2 memakai `.xlsx` (SheetJS) sesuai fase-0-schema ("Import Excel"). Export CSV laporan (REP-05) existing tidak berubah. Dukungan CSV import = P1-late. |

### 1.3 Keputusan penyelarasan dengan dokumen existing (catatan eksplisit)

1. **Nama tabel konversi:** fase-0-schema.md menulis `unit_conversions`; RESEARCH.md R1 (riset BA, sumber utama fase ini) merekomendasikan `product_units` (unit + faktor + harga + flag). **Dipakai: `product_units`** — R1 adalah desain yang terbukti (Kasaba) dan lebih kaya. `unit_conversions` TIDAK dibuat.
2. **Kategori seed:** ddl.sql seed 4 kategori (Makanan, Minuman, Snack, Lainnya); `apps/web/src/data/products.ts` memakai 7 kategori. **Dipakai: 8 kategori** (Makanan, Minuman, Snack, Sembako, Bumbu Dapur, Produk Kebersihan, Rokok & Tembakau, Perlengkapan Mandi) — upsert by slug, deterministik.
3. **Nama varian produk:** PROD-12 menyebut "varian sederhana (ukuran/warna) sebagai produk turunan dengan stok & harga sendiri". RESEARCH R12 **memvalidasi desain ini** dan menambah "rasa". Varian = ukuran/warna/rasa.

---

## 2. User Story + Kriteria Penerimaan (Given/When/Then)

Konvensi: setiap AC ditulis Given/When/Then; **setiap AC wajib bisa diuji otomatis** (test backend via HTTP, atau query DB langsung). "Cepat" tidak diterima sebagai AC — semua AC waktu memakai angka milidetik/detik.

### US-01 — Tambah produk dengan varian
Sebagai **manager**, saya bisa menambah satu produk yang punya beberapa varian (ukuran/warna/rasa) beserta stok dan harga masing-masing, supaya katalog mencerminkan barang dagangan asli.
- AC-01.1: **Given** saya login sebagai manager dan membuka form produk baru, **When** saya mengisi data induk (kategori, nama, SKU, unit dasar "pcs", harga beli 5.000, harga jual 6.000) + 2 varian (A: SKU `MIN-001-A` harga jual 6.500 stok 30; B: SKU `MIN-001-B` harga jual 7.000 stok 20), **Then** `POST /products` mengembalikan 201 dengan `product.hasVariants=true`, `product.variants.length=2`, `products.stock_on_hand` induk = 0, dan stok varian tersimpan di `product_variants` (A=30, B=20).
- AC-01.2: **Given** produk induk ber-varian tersimpan, **When** `GET /products/:id` dipanggil, **Then** respons menyertakan `variants[]` lengkap (SKU, barcode, harga, stok, `isActive`) dan `units[]` (boleh kosong), dalam 1 request tanpa request tambahan.
- AC-01.3: **Given** saya mengirim produk dengan `variants` yang SKU-nya duplikat dengan produk lain yang aktif, **When** request `POST /products` diproses, **Then** respons 409 `DUPLICATE_VARIANT_SKU` dan TIDAK ada produk/varian apa pun yang tersimpan (rollback penuh).
- AC-01.4: **Given** saya mengirim varian dengan `stockOnHand` negatif, **When** request diproses, **Then** respons 422 `VALIDATION_ERROR` dengan `details.field='variants[0].stockOnHand'`.
- AC-01.5: **Given** produk induk ber-varian akan dihapus (soft delete) oleh admin, **When** `DELETE /products/:id` diproses, **Then** semua varian aktif ikut soft-delete (`deleted_at` terisi, `is_active=false`) dalam 1 transaksi DB.

### US-02 — Kelola varian produk
Sebagai **manager**, saya bisa mengubah harga/stok varian dan menonaktifkan varian yang tidak laku.
- AC-02.1: **Given** varian `MIN-001-A` ada, **When** `PATCH /product-variants/:id` dengan `{ sellingPrice: 7000 }`, **Then** respons 200 dengan `sellingPrice=7000`, audit `variant.update` tercatat, dan `updatedAt` berubah.
- AC-02.2: **Given** varian nonaktif, **When** `GET /products?q=<nama varian>` dipanggil sebagai kasir, **Then** varian nonaktif TIDAK muncul di hasil.
- AC-02.3: **Given** varian dengan stok 10, **When** `PATCH /product-variants/:id/stock` `{ quantityDelta: -15, type: 'adjustment', note: 'hilang' }`, **Then** respons 409 `STOCK_INSUFFICIENT` dengan `details.available=10, requested=15`, stok tetap 10, dan TIDAK ada baris `stock_movements` baru.
- AC-02.4: **Given** varian aktif sedang dipakai di transaksi (sudah ada `transaction_items` merujuknya), **When** admin soft-delete varian, **Then** transaksi lama tetap utuh (snapshot tidak berubah) dan `product_variant_id` di `transaction_items` lama tetap bernilai.
- AC-02.5: **Given** produk induk `hasVariants=true` dan varian tersisa 1, **When** admin soft-delete varian terakhir, **Then** `hasVariants` induk otomatis menjadi `false` dan `products.stock_on_hand` induk = stok varian yang tersisa (atau 0 bila tidak ada).

### US-03 — Konversi satuan (beli dus, jual pcs)
Sebagai **manager**, saya bisa mendaftarkan satuan tambahan dengan faktor konversi dan harga masing-masing, supaya kasir menjual "1 dus" tanpa hitung manual dan stok tetap benar.
- AC-03.1: **Given** produk "Indomie Goreng" unit dasar `pcs` dengan `product_units` baris `{ unit: 'dus', factor: 40, sellPrice: 92.000 }`, **When** `POST /transactions/preview` dengan item `{ productId, unit: 'dus', quantity: 2 }`, **Then** `unitPrice=92000`, `lineTotal=184000`, dan `availableStock` dalam satuan dus = `floor(stok_pcs / 40)`.
- AC-03.2: **Given** stok produk 100 pcs, **When** checkout item `{ unit: 'dus', quantity: 3 }` (3×40=120 pcs), **Then** 409 `STOCK_INSUFFICIENT` (available 100, requested 120) dan stok TIDAK berubah.
- AC-03.3: **Given** checkout sukses 2 dus (faktor 40), **When** `GET /products/:id` dipanggil, **Then** `stock_on_hand` berkurang tepat 80 (100 → 20) dan `stock_movements` berisi 1 baris `sale_out` qty=80 (dalam unit dasar).
- AC-03.4: **Given** checkout sukses dengan `unit='dus'`, **When** `transaction_items` diperiksa, **Then** kolom `unit='dus'`, `unit_factor=40`, `unit_price=92000`, `cost_price = cost_price_pcs × 40`, `quantity=2` (qty satuan penjualan, bukan qty stok).
- AC-03.5: **Given** saya menambah satuan `{ unit: 'dus', factor: 0 }`, **When** `POST /products/:id/units`, **Then** 422 `INVALID_FACTOR` dengan pesan "factor harus > 0".
- AC-03.6: **Given** produk sudah punya unit `dus`, **When** saya menambah unit `dus` lagi, **Then** 409 `DUPLICATE_UNIT`.
- AC-03.7: **Given** qty desimal diizinkan (NUMERIC(12,3)), **When** checkout `{ unit: 'pcs', quantity: 0.5 }` dengan stok 1 pcs, **Then** checkout sukses, stok menjadi 0.5, `lineTotal = round(unit_price × 0.5)`.

### US-04 — Produk jasa / tanpa stok
Sebagai **manager**, saya bisa menandai produk sebagai jasa (tanpa stok), supaya layanan seperti "Jasa Service AC" bisa dijual tanpa cek stok.
- AC-04.1: **Given** produk dengan `trackStock=false` dan `stockOnHand=0`, **When** checkout item produk tersebut qty 5, **Then** checkout sukses (tanpa cek stok) dan TIDAK ada `stock_movements.sale_out` untuk produk itu.
- AC-04.2: **Given** produk `trackStock=false`, **When** `GET /reports/low-stock` dipanggil, **Then** produk itu TIDAK muncul walaupun `stockOnHand <= minStock`.
- AC-04.3: **Given** `trackStock=false` dipasang pada produk yang sudah punya stok 50, **When** simpan, **Then** stok 50 tetap dipertahankan (flag tidak menghapus stok), dan `POST /transactions` tetap memotong stoknya bila qty melebihi stok? — **TIDAK**: produk `trackStock=false` TIDAK pernah dicek/dipotong stoknya, `stockOnHand` dibiarkan apa adanya.
- AC-04.4: **Given** varian dibuat di bawah produk `trackStock=false`, **When** simpan, **Then** 422 `VALIDATION_ERROR` (`details.field='variants'`) — produk jasa tidak boleh punya varian.

### US-05 — Import produk dari Excel
Sebagai **manager**, saya bisa mengimpor banyak produk sekaligus dari template Excel, supaya tidak mengetik satu per satu.
- AC-05.1: **Given** saya mengunduh template (`GET /products/import/template`), **When** saya isi 10 baris valid (2 di antaranya SKU sudah ada di DB dengan harga jual berbeda), **Then** import sukses: 8 produk baru dibuat, 2 produk lama di-update (harga jual berubah, id tetap), respons `{ inserted: 8, updated: 2, failed: 0 }`.
- AC-05.2: **Given** file berisi 3 baris error (SKU duplikat dalam file, kategori tidak dikenal, harga jual < 0) dan 5 baris valid, **When** import dipanggil tanpa flag `partial`, **Then** 422 `IMPORT_VALIDATION_FAILED` dengan `details.rows` berisi 3 error berisi nomor baris + kolom + pesan, dan **tidak ada satu pun baris** (valid maupun tidak) tersimpan (atomic).
- AC-05.3: **Given** file yang sama, **When** import dipanggil dengan `partial=true`, **Then** 5 baris valid tersimpan, respons `{ inserted: 5, updated: 0, failed: 3 }` + detail error per baris.
- AC-05.4: **Given** file kosong atau tanpa sheet "Produk", **When** import diproses, **Then** 422 `IMPORT_EMPTY` / `IMPORT_INVALID_HEADER` dengan pesan yang menyebut sheet/header yang diharapkan.
- AC-05.5: **Given** file 3 MB berisi 800 baris, **When** import diproses, **Then** 422 `IMPORT_TOO_LARGE` (batas: 2 MB, 500 baris).
- AC-05.6: **Given** baris valid dengan kolom `varian` berisi "Sapi Panggang|SNK-101-A||7500|20;Cabe|SNK-101-B|8991234567890|7500|15", **When** import sukses, **Then** produk induk `hasVariants=true` dan 2 varian tersimpan lengkap (SKU, barcode, harga, stok).
- AC-05.7: **Given** kolom `satuan_tambahan` berisi "dus|40|92000|1|1;renceng|10|24000|1|0", **When** import sukses, **Then** 2 baris `product_units` tersimpan (dus: factor 40, harga 92.000, `isSellable=true`, `isPurchaseUnit=true`; renceng: factor 10, harga 24.000, `isSellable=true`, `isPurchaseUnit=false`).

### US-06 — Export produk ke Excel
Sebagai **manager**, saya bisa mengekspor seluruh katalog ke `.xlsx` yang bisa dibuka Excel/WPS, supaya bisa diolah atau dibackup.
- AC-06.1: **Given** katalog berisi 70 produk (15 ber-varian, 20 multi-satuan), **When** `GET /products/export`, **Then** 200 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` dengan 3 sheet bernama `Produk`, `Varian`, `Satuan`; sheet Produk = 70 baris data; sheet Varian = jumlah varian baris; sheet Satuan = jumlah unit baris.
- AC-06.2: **Given** file hasil export, **When** file yang sama di-import ulang tanpa perubahan, **Then** semua baris dikenali sebagai `updated` (bukan `inserted`) dan tidak ada duplikat.
- AC-06.3: **Given** kasir login, **When** memanggil `GET /products/export`, **Then** 403 `FORBIDDEN` (export berisi harga beli → manager+).
- AC-06.4: **Given** katalog kosong, **When** export, **Then** tetap mengembalikan file valid dengan header kolom lengkap dan 0 baris data (bukan error).

### US-07 — Seed data realistis
Sebagai **developer**, saya bisa menjalankan seed berulang kali tanpa merusak data, dan hasilnya konsisten untuk demo & test.
- AC-07.1: **Given** DB kosong (setelah migrate), **When** `bun run db:seed` dijalankan, **Then** berhenti dengan exit code 0 dan log ringkasan: jumlah produk (60–80), varian, unit, pelanggan, transaksi (≥300), gudang (4), total pendapatan.
- AC-07.2: **Given** seed sudah pernah dijalankan, **When** `bun run db:seed` dijalankan lagi, **Then** tidak ada duplikat (jumlah produk & transaksi identik dengan run pertama) dan exit code 0.
- AC-07.3: **Given** seed selesai, **When** query konsistensi dijalankan: `Σ(qty sale_out) per produk = stok_awal − stock_on_hand` dan `Σ warehouse_stocks = stock_on_hand` per produk, **Then** semua baris konsisten (selisih 0).
- AC-07.4: **Given** seed selesai, **When** `transactions` diperiksa, **Then** ≥300 baris `status='completed'`, invoice `TRX-YYYYMMDD-XXXX` unik & sekuensial per hari, dan tiap transaksi punya ≥1 item, ≥1 payment, dan `total = subtotal − discount_total + tax_total − redeemed_points_value`.
- AC-07.5: **Given** seed selesai, **When** `stock_on_hand` seluruh produk diperiksa, **Then** tidak ada nilai negatif, dan ada ≥5 produk `track_stock=false` (jasa) yang tidak pernah dicatat `sale_out`.
- AC-07.6: **Given** seed dijalankan dengan `--force`, **When** selesai, **Then** seluruh data seed (produk, varian, unit, transaksi, gudang, stok) ter-reset lalu dibuat ulang tanpa error.

### US-08 — Akses & keamanan data master
Sebagai **admin**, saya memastikan kasir hanya bisa membaca katalog, bukan mengubah harga atau stok.
- AC-08.1: **Given** kasir login, **When** memanggil `POST /products`, `POST /products/:id/variants`, `POST /products/:id/units`, atau `PATCH /product-variants/:id/stock`, **Then** 403 `FORBIDDEN`.
- AC-08.2: **Given** kasir login, **When** memanggil `GET /products`, `GET /products/:id` (termasuk variants/units), `GET /products/barcode/:code`, **Then** 200 dan respons TIDAK mengandung `costPrice`/`cost_price`.
- AC-08.3: **Given** manager login, **When** memanggil `DELETE /products/:id`, **Then** 403 `FORBIDDEN` (delete = admin saja).
- AC-08.4: **Given** setiap mutasi (create/update/delete produk, varian, unit, import, adjust stok), **When** `GET /audit-logs` diperiksa sebagai admin, **Then** ada baris audit dengan `action` sesuai (`product.create`, `variant.update`, `unit.create`, `stock.adjustment`, `product.import`, dll), `userId` benar, dan `newValues` berisi state setelah.

---

## 3. Model Data (tabel, kolom, tipe, constraint, index, relasi)

Konvensi global mengikuti `db-schema.md` §2 (UUID PK, uang BIGINT, qty NUMERIC(12,3), TIMESTAMPTZ, soft delete `deleted_at`, enum native). Kolom `created_at/updated_at/deleted_at` tidak diulang penuh di bawah (mengikuti konvensi).

### 3.1 ALTER `products` (+4 kolom) — P0

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| has_variants | BOOLEAN | NOT NULL DEFAULT FALSE | TRUE bila punya ≥1 varian aktif. Dijaga aplikasi (bukan trigger). |
| track_stock | BOOLEAN | NOT NULL DEFAULT TRUE | FALSE = produk jasa: tidak dicek/dipotong stok, tidak masuk laporan stok menipis (R4). |
| expiry_date | DATE | NULL | Opsional (R3). Hanya info produk; FEFO batch = P1-late. |
| deleted_at | TIMESTAMPTZ | NULL | **SUDAH ADA** — tidak diubah; disebut untuk kejelasan relasi varian. |

`products.unit` = **unit dasar** (faktor implisit 1); stok `stock_on_hand` & `min_stock` selalu dalam unit dasar. `cost_price`/`selling_price` = harga per unit dasar. `selling_price` induk tetap diisi = harga jual unit dasar (kompatibilitas kasir & laporan existing).

**Invariant (dijaga aplikasi, diuji):** jika `has_variants=true` maka `products.stock_on_hand = 0` dan semua stok hidup di `product_variants`.

### 3.2 Tabel baru `product_variants` — P0 (PROD-12, R12)

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK default gen_random_uuid() | |
| product_id | UUID | NOT NULL, FK → products.id, ON DELETE CASCADE | Induk. Soft-delete induk → varian ikut soft-delete (di aplikasi, 1 transaksi). |
| name | VARCHAR(200) | NOT NULL | Nama varian: "Ukuran 600ml", "Rasa Sapi Panggang", "Warna Hitam". |
| sku | VARCHAR(50) | NULL | Unik (partial aktif) |
| barcode | VARCHAR(100) | NULL | Unik (partial aktif) |
| cost_price | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | Harga beli per unit dasar varian |
| selling_price | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | Harga jual per unit dasar varian |
| stock_on_hand | NUMERIC(12,3) | NOT NULL DEFAULT 0, CHECK ≥ 0 | Stok varian (unit dasar parent) |
| min_stock | NUMERIC(12,3) | NOT NULL DEFAULT 0, CHECK ≥ 0 | Threshold varian |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE | Nonaktif tidak muncul di pencarian kasir |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | s.d. konvensi | |

Index:
- `uq_product_variants_sku_active ON (sku) WHERE deleted_at IS NULL AND sku IS NOT NULL`
- `uq_product_variants_barcode_active ON (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL`
- `idx_product_variants_product ON (product_id, is_active)`

**Aturan:** varian TIDAK punya `product_units` di Fase 2 (lihat §1.2). Nama varian + SKU induk membentuk identitas unik varian di UI; keunikan dijamin SKU/barcode.

### 3.3 Tabel baru `product_units` — P0 (R1 — menggantikan `unit_conversions`, lihat §1.3)

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK | |
| product_id | UUID | NOT NULL, FK → products.id, ON DELETE CASCADE | |
| unit | VARCHAR(20) | NOT NULL | Satuan tampilan: dus, renceng, karton, lusin, kodi, bungkus, ikat, dll. **Boleh = nama lain, TIDAK boleh sama dengan `products.unit`.** |
| factor | NUMERIC(12,3) | NOT NULL, CHECK (factor > 0) | Jumlah **unit dasar** per 1 satuan ini. `1 dus = 40 pcs` → factor 40. |
| sell_price | BIGINT | NOT NULL DEFAULT 0, CHECK ≥ 0 | Harga jual per satuan ini (R1: "tiap unit punya harga sendiri"). |
| is_sellable | BOOLEAN | NOT NULL DEFAULT TRUE | TRUE = kasir boleh pilih satuan ini. |
| is_purchase_unit | BOOLEAN | NOT NULL DEFAULT FALSE | Flag data untuk modul pembelian (R6, P1-late). |
| min_qty | NUMERIC(12,3) | NOT NULL DEFAULT 1, CHECK > 0 | **Disiapkan** untuk harga bertingkat R5 (P1-late). Di Fase 2 hanya disimpan, tidak dipakai logika harga. |
| created_at / updated_at | TIMESTAMPTZ | s.d. konvensi | Tidak ada soft delete — hapus fisik aman karena snapshot transaksi sudah independen. |

Constraint & index:
- `uq_product_units_product_unit UNIQUE (product_id, unit)`
- `idx_product_units_product ON (product_id)`
- CHECK tambahan: `factor` desimal diizinkan (contoh: 1 ikat = 0.5 kg → factor 0.5).

**Semantik konversi (mengikat):**
- `qty_stok = qty_penjualan × factor` (pembulatan hasil ke 3 desimal, round half-up — `lib/money.ts` `toQty`).
- Cek stok: `qty_penjualan × factor ≤ stock_on_hand` (atau stok varian).
- `unit_price` item = `sell_price` satuan tsb; bila produk tidak punya baris `product_units` → `products.selling_price` (unit dasar).
- `cost_price` snapshot per satuan = `cost_price_unit_dasar × factor`.
- Satuan bawaan (PROD-03): pcs, pack, box, kg, gram, liter, meter — tetap; `product_units` adalah **satuan tambahan per produk**.

### 3.4 ALTER `transaction_items` (+3 kolom) — P0 (R1 snapshot)

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| product_variant_id | UUID | NULL, FK → product_variants.id, ON DELETE SET NULL | Baris lama = NULL. Wajib diisi saat menjual varian. |
| unit | VARCHAR(20) | NOT NULL DEFAULT 'pcs' | **Snapshot** satuan penjualan (R1: struk & laporan benar). Baris lama backfill 'pcs'. |
| unit_factor | NUMERIC(12,3) | NOT NULL DEFAULT 1 | **Snapshot** faktor konversi saat transaksi (agar laporan qty konsisten walau konversi diubah kemudian — perluasan kecil dari R1, dicatat di §1.3). Baris lama backfill 1. |

Semantik: `quantity` = qty dalam **satuan penjualan** (`unit`). Stok terpotong = `quantity × unit_factor`. `product_id` tetap diisi **induk** walaupun menjual varian (laporan produk existing tidak berubah). CHECK baru (opsional kuat): `unit_factor > 0`.

### 3.5 ALTER `stock_movements` (+1 kolom) — P0

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| product_variant_id | UUID | NULL, FK → product_variants.id, ON DELETE SET NULL | Mutasi stok varian. `product_id` = induk varian. |

Semantik: mutasi varian menulis `product_id` = induk + `product_variant_id` = varian; mutasi produk non-varian menulis `product_variant_id = NULL`. `quantity`/`before_qty`/`after_qty` selalu dalam **unit dasar**.

### 3.6 Tabel baru `warehouses` — schema P0, CRUD Fase 3

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK | |
| code | VARCHAR(20) | NOT NULL | Unik (partial aktif): `GUD-PUSAT` |
| name | VARCHAR(150) | NOT NULL | |
| address | TEXT | NULL | |
| pic | VARCHAR(100) | NULL | Person in charge |
| capacity | NUMERIC(12,3) | NOT NULL DEFAULT 0, CHECK ≥ 0 | Kapasitas (opsional, untuk laporan) |
| is_active | BOOLEAN | NOT NULL DEFAULT TRUE | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | s.d. konvensi | |

Index: `uq_warehouses_code_active ON (code) WHERE deleted_at IS NULL`.

### 3.7 Tabel baru `warehouse_stocks` — schema P0, alur Fase 3

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK | |
| warehouse_id | UUID | NOT NULL, FK → warehouses.id, ON DELETE CASCADE | |
| product_id | UUID | NOT NULL, FK → products.id, ON DELETE CASCADE | |
| product_variant_id | UUID | NULL, FK → product_variants.id, ON DELETE CASCADE | NULL = stok produk non-varian; terisi = stok varian |
| quantity | NUMERIC(12,3) | NOT NULL DEFAULT 0, CHECK ≥ 0 | |
| min_stock | NUMERIC(12,3) | NOT NULL DEFAULT 0, CHECK ≥ 0 | Threshold per gudang (opsional) |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

Index (unique parsial — NULL variant tidak boleh bentrok):
- `uq_wh_stocks_product UNIQUE (warehouse_id, product_id) WHERE product_variant_id IS NULL`
- `uq_wh_stocks_variant UNIQUE (warehouse_id, product_id, product_variant_id) WHERE product_variant_id IS NOT NULL`

**Invariant seed Fase 2 (mengikat):** per produk/varian, `Σ warehouse_stocks.quantity = products.stock_on_hand` (atau `product_variants.stock_on_hand`). Seed menempatkan seluruh stok di gudang pertama (`GUD-PUSAT`), sisanya 0.

### 3.8 Tabel baru `stock_transfers` & `stock_adjustments` — schema P0, API Fase 3

`stock_transfers`:
| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK | |
| from_warehouse_id | UUID | NOT NULL, FK → warehouses.id | CHECK (from <> to) |
| to_warehouse_id | UUID | NOT NULL, FK → warehouses.id | |
| product_id | UUID | NOT NULL, FK → products.id | |
| product_variant_id | UUID | NULL, FK → product_variants.id | |
| quantity | NUMERIC(12,3) | NOT NULL, CHECK > 0 | Dalam unit dasar |
| notes | TEXT | NULL | |
| created_by | UUID | NULL, FK → users.id, ON DELETE SET NULL | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

`stock_adjustments`:
| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| id | UUID | PK | |
| warehouse_id | UUID | NOT NULL, FK → warehouses.id | |
| product_id | UUID | NOT NULL, FK → products.id | |
| product_variant_id | UUID | NULL, FK → product_variants.id | |
| quantity_delta | NUMERIC(12,3) | NOT NULL, CHECK (quantity_delta <> 0) | + = tambah, − = kurang |
| reason | VARCHAR(50) | NOT NULL | Wajib: `rusak`, `expired`, `hilang`, `salah_catat`, `selisih_supplier`, `laimnya` (R2) |
| note | TEXT | NULL | |
| created_by | UUID | NULL, FK → users.id, ON DELETE SET NULL | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

### 3.9 Ringkasan perubahan vs skema existing

| Objek | Perubahan | Breaking? |
|---|---|---|
| `products` | +4 kolom (semua default/optional) | Tidak — query existing tetap jalan |
| `transaction_items` | +3 kolom (default untuk baris lama) | Tidak |
| `stock_movements` | +1 kolom nullable | Tidak |
| 6 tabel baru | CREATE IF NOT EXISTS | Tidak |

**Migrasi (rencana):** file baru `apps/api/src/db/ddl-phase2.sql` (semua `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), dieksekusi di `migrate.ts` setelah ddl.sql (tahap 2). Backfill: `UPDATE transaction_items SET unit='pcs', unit_factor=1 WHERE unit IS NULL` (dengan ADD COLUMN DEFAULT tidak perlu backfill manual). `drizzle-kit check` harus lulus untuk schema.ts yang diperbarui. Rollback: drop 6 tabel baru + drop 8 kolom baru (urut terbalik). Migrasi **idempotent** — boleh dijalankan berulang.

---

## 4. Kontrak API (endpoint, method, request, response, kode error)

Base: `/api/v1`. Envelope: `{ ok, data }` / `{ ok:false, error:{ code, message, details? } }` (api-design.md §1.2 — mengikat). Semua harga integer rupiah. Role guard: **baca = kasir+** (tanpa harga beli), **tulis = manager+**, **delete = admin**.

### 4.1 Produk (extend existing — api-design.md §2.4)

| Method & Path | Role | Request | Response | Error baru |
|---|---|---|---|---|
| `GET /products` | kasir+ | query existing + `includeUnits=true` (default false; embed `units[]` + `variantCount` selalu di item) | `{ items, meta }`; item + `hasVariants`, `trackStock`, `expiryDate`, `variantCount`, `units?` | — |
| `GET /products?q=` | kasir+ | existing | **Pencarian kini mencakup nama varian** (LIKE pada `product_variants.name` produk aktif) | — |
| `GET /products/barcode/:barcode` | kasir+ | existing | **Pencarian mencakup barcode/SKU varian.** Respons: `{ product, variant?, stockOnHand, unit }` — bila yang cocok varian, `variant` terisi & `stockOnHand` = stok varian, `unit` = unit dasar parent; tanpa varian → perilaku existing | — |
| `GET /products/:id` | kasir+ | — | `{ product, stockOnHand, variants: [...], units: [...] }` (variants/units selalu disertakan; kasir: tanpa `costPrice` di keduanya) | — |
| `POST /products` | manager+ | body existing + opsional: `variants?: [{ name, sku?, barcode?, costPrice?, sellingPrice, stockOnHand?, minStock?, isActive? }]`, `units?: [{ unit, factor, sellPrice, isSellable?, isPurchaseUnit?, minQty? }]`, `trackStock?: boolean`, `expiryDate?: string\|null` | 201 `{ product, variants?, units? }`; `hasVariants=true` bila variants dikirim | `DUPLICATE_VARIANT_SKU` (409), `DUPLICATE_VARIANT_BARCODE` (409), `DUPLICATE_UNIT` (409), `INVALID_FACTOR` (422), `INVALID_FACTOR_ZERO` → dipakai `INVALID_FACTOR`, `INVALID_EXPIRY` (422, tanggal < hari ini? — TIDAK: tanggal lampau diizinkan untuk stok lama; hanya format invalid → 422 `VALIDATION_ERROR`) |
| `PATCH /products/:id` | manager+ | body parsial existing + `trackStock?`, `expiryDate?`, `hasVariants?` (**TIDAK diedit langsung** — hanya lewat varian; jika dikirim → 422 `VALIDATION_ERROR`) | 200 `{ product }` | — |
| `DELETE /products/:id` | admin | — | 200 `{ id, deleted:true }` + **soft-delete varian ikut** (1 transaksi) | — |
| `PATCH /products/:id/stock` | manager+ | existing (unit dasar) | existing | — |
| `GET /products/:id/stock-movements` | manager+ | existing | existing | — |
| `GET /products/export` | **manager+** | `?format=xlsx` (default; `csv` = P1-late, 422 `INVALID_PARAM` bila selain xlsx) | 200 `.xlsx`, 3 sheet: `Produk`, `Varian`, `Satuan` (struktur kolom = template import, round-trip) | — |
| `GET /products/import/template` | manager+ | — | 200 `.xlsx` template (1 baris contoh + header; sheet sama 3 lembar) | — |
| `POST /products/import` | manager+ | multipart: file `file` (xlsx, ≤2 MB, ≤500 baris data) + query `partial=false`; opsional `updateBySku=true` (default true) | 201 `{ inserted, updated, failed, rows: [{ rowNumber, status:'ok'\|'error', message? }] }` — `failed>0` tanpa `partial` → 422 `IMPORT_VALIDATION_FAILED` (atomic, rollback semua) | `IMPORT_EMPTY` (422), `IMPORT_TOO_LARGE` (422), `IMPORT_INVALID_HEADER` (422), `IMPORT_VALIDATION_FAILED` (422, details.rows) |

### 4.2 Varian (sub-resource baru)

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `GET /product-variants/:id` | kasir+ | — | `{ variant, product: { id, name, unit } }` | `VARIANT_NOT_FOUND` (404) |
| `POST /products/:id/variants` | manager+ | `{ name, sku?, barcode?, costPrice?, sellingPrice, stockOnHand?, minStock?, isActive? }` | 201 `{ variant }`; induk `hasVariants=true` otomatis | `DUPLICATE_VARIANT_SKU` (409), `DUPLICATE_VARIANT_BARCODE` (409), `PARENT_NO_STOCK_TRACKING` (422 — induk `trackStock=false`), `NOT_FOUND` (404) |
| `PATCH /product-variants/:id` | manager+ | parsial: name, sku, barcode (nullable), costPrice, sellingPrice, minStock, isActive | 200 `{ variant }` | `VARIANT_NOT_FOUND` (404), `DUPLICATE_VARIANT_SKU/BARCODE` (409) |
| `PATCH /product-variants/:id/stock` | manager+ | `{ quantityDelta, type: 'purchase_in'\|'adjustment', reference?, note }` — note wajib (PROD-13) | 200 `{ variantId, before, after, type }`; menulis `stock_movements` dengan `product_variant_id` | `STOCK_INSUFFICIENT` (409, details: `{ variantId, available, requested }`) |
| `DELETE /product-variants/:id` | admin | — | 200 `{ id, deleted:true }`; bila varian terakhir aktif → induk `hasVariants=false`, `stock_on_hand` induk = stok varian terakhir | `VARIANT_NOT_FOUND` (404) |

Audit: `variant.create`, `variant.update`, `variant.delete`, `variant.stock.adjustment`, `product.import`, `unit.create`, `unit.update`, `unit.delete`.

### 4.3 Satuan (sub-resource baru)

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `GET /products/:id/units` | kasir+ | — | `{ units: [...] }` | — |
| `POST /products/:id/units` | manager+ | `{ unit, factor, sellPrice, isSellable?, isPurchaseUnit?, minQty? }` | 201 `{ unit }` | `DUPLICATE_UNIT` (409, termasuk bila `unit` = `products.unit`), `INVALID_FACTOR` (422, factor ≤ 0), `NOT_FOUND` (404) |
| `PATCH /product-units/:id` | manager+ | parsial (unit, factor, sellPrice, isSellable, isPurchaseUnit, minQty) | 200 `{ unit }` | `UNIT_NOT_FOUND` (404), `DUPLICATE_UNIT` (409), `INVALID_FACTOR` (422) |
| `DELETE /product-units/:id` | manager+ | — | 200 `{ id, deleted:true }` — hapus fisik aman (snapshot transaksi independen) | `UNIT_NOT_FOUND` (404) |

### 4.4 Checkout & preview (perubahan kontrak — Fase 4 UI, Fase 2 backend)

`POST /transactions/preview` dan `POST /transactions` — item berubah dari `{ productId, quantity, discount? }` menjadi:
```json
{ "productId": "uuid", "variantId": "uuid|null", "unit": "pcs|dus|...", "quantity": 2.5, "discount": { "type": "percentage", "value": 10 } }
```
Aturan server (mengikat, urutan evaluasi):
1. Resolusi: `variantId` ada → ambil `product_variants` (wajib `is_active`, induk aktif); stok sumber = varian. Tidak ada → produk.
2. Satuan: `unit` ada & ≠ unit dasar → cari `product_units` (wajib `is_sellable=true`); TIDAK ketemu → 422 `UNIT_NOT_FOUND` (atau `UNIT_NOT_SELLABLE` bila ada tapi `is_sellable=false`). Tanpa `unit` → unit dasar.
3. Hitung: `qty_stok = round3(quantity × unit_factor)`; `unit_price = sell_price` satuan (atau `selling_price` produk/varian untuk unit dasar); `cost_price = round(cost_price_base × unit_factor)`.
4. Cek stok (kecuali `trackStock=false`): `qty_stok ≤ stok` → 409 `STOCK_INSUFFICIENT` (details: `productId`, `variantId?`, `unit`, `available` dalam unit yang dipilih, `requested` dalam unit yang dipilih).
5. Snapshot ke `transaction_items`: `product_variant_id`, `unit`, `unit_factor`, `unit_price`, `cost_price`; stok dipotong `qty_stok`; `stock_movements.quantity = qty_stok`.
6. Preview mengembalikan tambahan per item: `{ productId, variantId?, name, unit, unitPrice, quantity, lineTotal, availableStock }` (availableStock dalam satuan yang dipilih, `floor`).

**Perilaku backward-compatible:** request tanpa `variantId`/`unit` menghasilkan angka identik dengan Fase 1 (unit='pcs', unit_factor=1).

### 4.5 Daftar kode error baru (lengkap)

| Kode | HTTP | Kapan |
|---|---|---|
| `DUPLICATE_VARIANT_SKU` / `DUPLICATE_VARIANT_BARCODE` | 409 | SKU/barcode varian duplikat dengan entitas aktif mana pun (produk atau varian) |
| `VARIANT_NOT_FOUND` | 404 | Varian tidak ada / soft-deleted |
| `DUPLICATE_UNIT` | 409 | Satuan duplikat per produk, atau = unit dasar |
| `UNIT_NOT_FOUND` | 422 | Satuan di body checkout tidak terdaftar |
| `UNIT_NOT_SELLABLE` | 422 | Satuan terdaftar tapi `is_sellable=false` |
| `INVALID_FACTOR` | 422 | `factor ≤ 0` atau bukan angka |
| `PARENT_NO_STOCK_TRACKING` | 422 | Tambah varian pada produk `track_stock=false` |
| `IMPORT_EMPTY` | 422 | File tanpa sheet `Produk` atau 0 baris data |
| `IMPORT_TOO_LARGE` | 422 | File > 2 MB atau > 500 baris data |
| `IMPORT_INVALID_HEADER` | 422 | Header kolom tidak cocok template (nama kolom wajib, urutan bebas) |
| `IMPORT_VALIDATION_FAILED` | 422 | Ada baris error & `partial=false` (atomic); details.rows |
| `STOCK_INSUFFICIENT` | 409 | existing; details kini menyertakan `unit`, `variantId?` |

---

## 5. Aturan Bisnis (rumus, ambang batas, urutan)

1. **Unit dasar & stok (R1):** stok selalu disimpan dalam unit dasar (`products.unit`). Konversi: `qty_stok = qty_satuan × factor`; pembulatan hasil ke 3 desimal round half-up (`toQty` di `lib/money.ts`). Cek stok sebelum checkout: `qty_stok ≤ stok` (kecuali `track_stock=false`).
2. **Harga per satuan:** `unit_price` = `product_units.sell_price` untuk satuan yang dipilih; fallback `products.selling_price` (produk) atau `product_variants.selling_price` (varian) untuk unit dasar. **Server selalu menghitung ulang dari DB** — harga dari klien tidak pernah dipercaya (api-design.md §3).
3. **HPP snapshot per satuan:** `cost_price_item = round(cost_price_unit_dasar × unit_factor)` — rumus laba REP-02 (`Σ qty × (unit_price − cost_price) − diskon`) tetap valid tanpa perubahan formula.
4. **Varian:** produk `has_variants=true` → `products.stock_on_hand = 0`; seluruh stok di varian. Jual varian → `product_id` = induk (laporan produk tidak berubah) + `product_variant_id` = varian. Varian tidak punya satuan tambahan (Fase 2).
5. **track_stock=false (R4):** tidak dicek stok saat checkout, tidak memotong stok, tidak menulis `stock_movements.sale_out`, tidak muncul di REP-03 low-stock. Boleh punya `stockOnHand` tersisa (tidak dihapus). Tidak boleh punya varian. Flag tidak bisa diubah ke `false` bila produk sedang dipakai transaksi? — **TIDAK**: flag bebas diubah kapan pun (catatan: transaksi lama tetap pakai snapshot).
6. **Threshold:** `min_stock` produk/varian tetap mengikuti SET-04 default (5) saat create bila tidak diisi.
7. **Import (urutan):** validasi header → baca baris (max 500) → validasi per baris (kumpulkan semua error, jangan stop di error pertama) → bila `partial=false` dan ada error: rollback semua + 422; bila `partial=true`: simpan baris valid, laporkan error. `updateBySku=true` (default): SKU yang sudah ada aktif → update kolom yang diisi (nama/kategori/harga/stok? — **hanya kolom yang terisi di file**; `stok_awal` pada update = **set stok absolut** bila terisi, bukan delta); `updateBySku=false` → SKU duplikat = error baris. Varian/unit dalam file: di-reset penuh per produk yang di-import (delete-then-insert dalam 1 transaksi, agar file round-trip konsisten).
8. **Format baris template import (mengikat):**
   - Sheet `Produk` (header wajib): `kategori`, `nama`, `sku`, `barcode`, `unit_dasar`, `harga_beli`, `harga_jual`, `stok_awal`, `stok_minimum`, `kena_pajak` (TRUE/FALSE), `track_stock` (TRUE/FALSE), `expiry_date` (YYYY-MM-DD atau kosong), `varian` (format: `Nama|SKU|Barcode|HargaJual|Stok`; beberapa dipisah `;`; HargaJual wajib, lainnya opsional), `satuan_tambahan` (format: `unit|factor|sell_price|is_sellable|is_purchase_unit`, dipisah `;`; `is_sellable`/`is_purchase_unit` = 1/0).
   - Kategori harus sudah ada di DB (import tidak membuat kategori) → baris dengan kategori tak dikenal = error baris (pesan menyebut kategori).
   - `harga_jual` wajib > 0; `harga_beli` ≥ 0; `stok_awal` ≥ 0; `factor` > 0.
9. **Export:** 3 sheet dengan header yang sama persis dengan import (round-trip AC-06.2). Kolom `stok_awal` di export = stok saat ini (`stock_on_hand` produk / varian).
10. **Seed (aturan data):** produk 60–80; ≥10 produk ber-varian (2–4 varian, ukuran/warna/rasa); ≥15 produk multi-satuan dengan faktor realistis Indonesia (dus=12/24/40/48, renceng=6/10, karton=48, lusin=12, kodi=20 — mengikuti RESEARCH §2.5); harga per unit-dasar dari satuan besar ≤ harga unit dasar (grosir ≤ eceran); 3 produk `track_stock=false`; sembako & minuman kemasan `is_taxable=false`; transaksi 300+ tersebar 60 hari terakhir (WIB), 1–8 item, cash 60% / qris 30% / transfer 10%, ≥25 pelanggan dengan ≥10 member, poin sesuai `floor(total/1000)`; 2 transaksi `cancelled` (stok kembali via `cancellation`) sebagai data test void; tidak ada stok negatif kapan pun (urutan transaksi per produk diacak sedemikian rupa).
11. **Invoice seed:** `TRX-YYYYMMDD-XXXX` sekuensial per hari (pakai `lib/sequence.ts` existing).
12. **Self-check seed (wajib berjalan di akhir & gagal dengan exit ≠ 0 bila tidak lolos):** (a) jumlah produk 60–80; (b) transaksi ≥ 300; (c) `Σ sale_out + Σ cancellation_out? = stok awal − stok akhir` per produk (net); (d) `Σ warehouse_stocks = stock_on_hand` per produk/varian; (e) tidak ada `stock_on_hand < 0`; (f) invoice unik; (g) `total = subtotal − discount_total + tax_total − redeemed_points_value` untuk semua transaksi.

---

## 6. Alur Status (state machine)

### 6.1 Produk & varian: lifecycle

```
[draft? TIDAK — langsung aktif]
active ──PATCH isActive=false──▶ inactive ──PATCH isActive=true──▶ active
active/inactive ──DELETE (admin, soft)──▶ deleted (terminal, tidak bisa diaktifkan kembali;
                                           tetap tampil di riwayat/laporan; TIDAK muncul di pencarian)
```
Aturan transisi:
- **Varian:** sama seperti di atas, ditambah efek ke induk: soft-delete varian → bila induk `has_variants` dan tidak ada varian aktif tersisa → `has_variants=false` dan `products.stock_on_hand = stok varian non-deleted terakhir` (0 bila tidak ada). Soft-delete induk → seluruh varian (aktif/inaktif) ikut `deleted_at` + `is_active=false` dalam 1 transaksi DB.
- **Produk jasa (`track_stock=false`):** tidak boleh ada transisi menambah varian (`PARENT_NO_STOCK_TRACKING`).
- **Satuan (`product_units`):** tidak berstatus (tidak ada is_active). Hapus fisik = terminal; tidak pernah di-restore (transaksi lama memakai snapshot).

### 6.2 Import Excel: state pekerjaan

Import adalah **sinkron dalam 1 request** (tidak ada job queue). Status hasil:
```
request diterima → validasi file (header/ukuran) → validasi baris (kumpulkan error)
  → [partial=false & ada error]  → 422 IMPORT_VALIDATION_FAILED  (0 baris tersimpan)
  → [partial=true]               → 201 { inserted, updated, failed }  (baris valid tersimpan)
  → [tidak ada error]            → 201 { inserted, updated, failed:0 } (semua tersimpan)
```
Tidak ada status perantara yang terlihat klien; kegagalan parsial transaksi DB (constraint runtime tak terduga) → rollback penuh + 500 `INTERNAL`.

### 6.3 Entitas lain: tidak ada state machine baru di Fase 2
Transaksi/return/payment memakai state existing (`transaction_status`, `return_status`, `payment_status`) yang TIDAK berubah. `warehouse_stocks/stock_transfers/stock_adjustments` dipakai penuh di Fase 3.

---

## 7. Kasus Tepi & Penanganan Error (minimal 5 per fitur)

### 7.1 DB schema & migrasi
1. **Migrasi dijalankan di DB yang sudah berisi data Fase 1** → semua `ALTER ... ADD COLUMN IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS`; `drizzle-kit check` lulus; tidak ada drop data.
2. **Migrasi dijalankan ulang (idempotensi)** → tidak error, tidak duplikat tabel/kolom.
3. **Kolom baru `unit`/`unit_factor` di `transaction_items`** → default `'pcs'`/`1` membuat semua baris lama tetap valid; laporan Fase 1 tidak berubah.
4. **FK `product_variant_id` ke varian yang di-soft-delete** → `ON DELETE SET NULL` hanya untuk hapus fisik; soft delete tidak menyentuh FK (transaksi lama tetap menunjuk varian nonaktif — benar untuk riwayat).
5. **Hapus gudang yang punya `warehouse_stocks`** → hapus fisik diblokir FK (Fase 3 memakai soft delete); seed tidak pernah menghapus gudang.
6. **Konflik nama tabel `unit_conversions` (fase-0-schema) vs `product_units`** → keputusan §1.3.1; developer dilarang membuat keduanya.
7. **Varian dengan stok desimal** → `NUMERIC(12,3)` mendukung (mis. 1.5 kg varian "Beras Premium 5kg"); CHECK ≥ 0.

### 7.2 Seed
1. **Seed di DB berisi data user/test** → seed hanya mengisi tabel master & transaksi; TIDAK menghapus data yang tidak dikenalnya (non-seed). `--force` menghapus hanya data seed (produk+varian+unit+transaksi+gudang+stok+pelanggan seed).
2. **Invoice counter bentrok** → seed memakai `lib/sequence.ts` (retry 1× saat konflik unique).
3. **Stok hampir habis saat urutan transaksi acak** → generator menjamin stok tidak negatif: sortir transaksi per produk lalu cek `stok − kumulatif ≥ 0`; bila gagal, kurangi qty item (bukan gagalkan seed).
4. **Produk dengan `track_stock=false` ikut di-generate transaksi** → boleh dijual berapa pun (tanpa movement); self-check (e) tidak berlaku untuk produk ini.
5. **Waktu transaksi lintas hari** → `sold_at` di-generate dalam WIB lalu disimpan UTC; grouping laporan tetap benar (test: transaksi jam 00:30 WIB masuk hari yang benar).
6. **Seed user dengan password test** → password `Fase2Test!123` (argon2id) untuk 4 user; hanya boleh ada di dev/seed, tidak di produksi (catatan README).
7. **Seed selesai sebagian (crash tengah jalan)** → seluruh seed dibungkus transaksi DB besar? **TIDAK** (300+ transaksi = 1 transaksi besar lambat & berisiko lock). Strategi: idempotensi berbasis penanda — seed menulis `settings['seed.fase2.version'] = '2.1'` di akhir; run berikutnya yang menemukan versi sama → skip (kecuali `--force`). Crash tengah jalan → run ulang aman karena insert pakai skip-if-exists per batch.

### 7.3 CRUD produk & varian
1. **SKU varian = SKU produk induk lain** → `DUPLICATE_VARIANT_SKU` 409; validasi memeriksa tabel `products` DAN `product_variants` (satu namespace SKU).
2. **Varian terakhir dihapus** → `hasVariants=false` + stok pindah ke induk (AC-02.5); jangan sampai induk `has_variants=true` tanpa varian.
3. **Update harga varian saat sedang ada cart aktif** → tidak masalah: harga dibaca server saat checkout (server-side truth); cart frontend hanya tampilan.
4. **PATCH `hasVariants` langsung dari klien** → 422 `VALIDATION_ERROR` (hanya derivasi dari varian).
5. **Produk nonaktif dengan varian aktif** → pencarian kasir: produk nonaktif & semua variannya tidak muncul (cek induk aktif dulu).
6. **`GET /products/barcode/:barcode` mencocokkan SKU produk & SKU varian sekaligus** → SKU unik global (produk+varian satu namespace) sehingga maksimal 1 kecocokan; bila ada duplikat data (bug), prioritaskan produk non-varian → varian → 409 `CONFLICT` bila ambigu.
7. **Adjust stok varian dengan `purchase_in` negatif** → 422 (sama seperti produk, existing rule).
8. **Stok varian minus saat jual di Fase 4** → `UPDATE ... WHERE stock >= qty` atomik (pola existing) → 409 `STOCK_INSUFFICIENT`.

### 7.4 Konversi satuan
1. **Factor desimal (`1 ikat = 0.5 kg`)** → konversi dibulatkan 3 desimal; cek stok pakai qty terkonversi, bukan qty satuan.
2. **Sisa stok kurang dari 1 satuan besar** → stok 10 pcs, jual 1 dus (faktor 40) → 409 `STOCK_INSUFFICIENT` dengan `available=10` (dalam pcs) dan `requested=40`; pesan menyebut satuan: "Stok tidak cukup (tersisa 10 pcs, diminta 40 pcs)".
3. **`unit` di body checkout tidak terdaftar** → 422 `UNIT_NOT_FOUND` (jangan fallback diam-diam ke unit dasar — salah hitung lebih bahaya).
4. **`unit` terdaftar tapi `is_sellable=false`** → 422 `UNIT_NOT_SELLABLE` (satuan hanya pembelian).
5. **Unit dihapus setelah pernah dipakai transaksi** → snapshot (`unit`, `unit_factor`) membuat struk & laporan lama tetap benar; tidak ada blokade hapus.
6. **Konversi ganda (dus → pcs → kg)** → TIDAK didukung: semua satuan merujuk langsung ke unit dasar (faktor tunggal). Satuan bertingkat = P2.
7. **`unit` = unit dasar dikirim di body** → dianggap valid (setara tanpa `unit`); `product_units` dengan `unit` = `products.unit` DITOLAK saat create (`DUPLICATE_UNIT`).
8. **Qty pembulatan menghasilkan 0 stok** → jual 0.001 pcs dari stok 0.001 → valid (qty > 0); jual 0.0004 pcs → qty desimal < 0.001 dibulatkan ke 0.001? **TIDAK**: qty di bawah 0.001 ditolak 422 `VALIDATION_ERROR` (precision limit), hindari transaksi qty 0.

### 7.5 Import/Export Excel
1. **Sel kosong vs 0** → `harga_beli` kosong = 0 (valid); `harga_jual` kosong = error baris; `stok_awal` kosong = 0.
2. **Angka dengan format Excel (string "1.500" atau "Rp 1.500")** → parses sebagai teks; format "Rp 1.500" → error baris (pesan: "harga harus angka, tanpa 'Rp'/titik ribuan") — hindari parsing ambigu.
3. **Baris duplikat SKU dalam satu file** → baris kedua = error "SKU duplikat dalam file"; pada `partial=true` hanya baris pertama diproses.
4. **Nama kolom header beda urutan / ada kolom ekstra** → urutan bebas (match by nama header), kolom tak dikenal diabaikan dengan warning di respons; header wajib hilang → `IMPORT_INVALID_HEADER`.
5. **File `.csv` dikirim ke `/products/import`** → 422 `IMPORT_INVALID_HEADER` dengan pesan "Fase 2 hanya menerima .xlsx" (lihat §1.2).
6. **Import 500 baris dengan 499 valid + 1 error, `partial=true`** → 499 tersimpan, respons `failed:1`; total durasi < 10 detik (target, diuji dengan seed data 80 produk + 420 baris baru).
7. **Sheet Varian/Satuan tidak ada saat import** → tidak wajib: produk di-import tanpa varian/unit (sheet Produk saja sudah cukup).
8. **Export saat koneksi lambat (3G)** → file < 1 MB untuk 80 produk; waktu generate < 2 detik di server; header `Content-Disposition` benar (`attachment; filename="produk-YYYYMMDD.xlsx"`).
9. **Import produk yang sedang dipakai di transaksi** → update kolom master aman (snapshot transaksi independen); stok absolut hanya diubah bila kolom `stok_awal` terisi → menulis `stock_movements` type `adjustment` (note "IMPORT-<file>") agar ledger konsisten.

---

## 8. Dampak ke Modul yang Sudah Ada + Rencana Migrasi

### 8.1 Dampak per modul

| Modul / file | Dampak | Aksi wajib |
|---|---|---|
| **Checkout** (`services/checkout.service.ts`, `POST /transactions`, `/preview`) | Body item + `variantId`/`unit`; hitung ulang harga & stok dalam unit dasar; snapshot +3 kolom | Update service + test regresi: request tanpa variant/unit = angka identik Fase 1 |
| **Return** (`services/return.service.ts`, M10 P1) | Restock harus balik ke `product_variant_id` yang benar | Update service: saat return item ber-varian, stok varian bertambah; movement `return_in` dengan `product_variant_id` |
| **Void transaksi** (`POST /transactions/:id/cancel`) | Restock via `cancellation` harus balik ke varian/unit yang benar | Update: `quantity` movement = `qty × unit_factor`; `product_variant_id` disalin dari item |
| **Laporan** (`routes/reports.routes.ts`) | REP-02 laba: formula tetap (cost snapshot per satuan sudah benar); REP-04 top products: group by `product_id` (induk) — tidak berubah; REP-03 low-stock: produk `track_stock=false` harus dikecualikan + varian menipis belum masuk (Fase 5) | Update REP-03 filter `track_stock=true`; sisanya Fase 5 |
| **Pencarian produk** (`GET /products?q=`, `/products/barcode/:barcode`) | Harus mencakup varian | Update query (JOIN `product_variants` + UNION barcode) |
| **Kasir UI (Fase 4)** | Grid/search/pilih satuan & varian, cart pakai `unit` | TIDAK di Fase 2 (kontrak API sudah siap, AC via API) |
| **Struk (Fase 4)** | Tampil "2 dus × 12 pcs" | Data sudah tersedia (`unit`, `unit_factor`) |
| **Types frontend** (`lib/types.ts`, `types-warehouse.ts`) | `Product` + `hasVariants/trackStock/expiryDate`, `ProductVariant`, `ProductUnit`, `CartItem` + `variantId/unit/unitFactor`, `TransactionItem` + `variantId/unit/unitFactor`, `WarehouseStock` + `productVariantId` | Update tipe paralel dengan schema |
| **Dashboard (M8)** | Tidak berubah (Fase 2) | — |
| **Settings (M9)** | Tidak ada key baru di Fase 2 (default satuan toko = catatan P1-late) | — |
| **Dummy data frontend** (`data/products.ts`, `data/warehouses.ts`) | Digantikan data dari API; tetap ada sebagai fallback offline | Pindah konten ke seed script (sumber tunggal: DB) |

### 8.2 Rencana migrasi (urutan eksekusi)

1. **Schema**: update `apps/api/src/db/schema.ts` (6 tabel baru + 8 kolom baru) → `drizzle-kit check` lulus.
2. **DDL**: buat `apps/api/src/db/ddl-phase2.sql` (idempotent) + panggil dari `migrate.ts` setelah ddl.sql.
3. **Backfill**: tidak diperlukan manual (semua kolom baru berdefault); verifikasi query: `SELECT count(*) FROM transaction_items WHERE unit IS NULL` = 0.
4. **Seed**: buat `apps/api/src/db/seed.ts` + script `bun run db:seed` (+ `--force`) di `package.json`.
5. **API**: extend products routes + routes baru `product-variants`, `product-units`, import/export; update checkout/return/void services.
6. **Types**: update `apps/web/src/lib/types.ts` + `types-warehouse.ts`.
7. **Test**: test otomatis untuk semua AC §2 (backend HTTP + query DB), jalan di CI dengan DB test terpisah.
8. **Rollback**: drop 6 tabel baru (urutan: stock_adjustments, stock_transfers, warehouse_stocks, warehouses, product_units, product_variants) + drop 8 kolom baru (products ×4, transaction_items ×3, stock_movements ×1). Tidak ada data Fase 1 yang hilang.
9. **Deploy**: Dokploy — jalankan migrasi sebelum deploy API baru; seed hanya di dev/demo (`SEED_DEMO=true` guard agar tidak jalan di produksi tanpa sengaja).

---

## 9. Bukan-Fungsional (target waktu muat, perilaku offline, hak akses)

### 9.1 Performa (angka target — p95, LAN homelab, DB lokal; diuji dengan seed penuh)

| Operasi | Target | Catatan |
|---|---|---|
| `GET /products?perPage=20` (list + variantCount) | < 150 ms | Index `(category_id)`, trigram name |
| `GET /products?q=...` (termasuk match varian) | < 200 ms | Hindari N+1: JOIN agregat varian per halaman |
| `GET /products/barcode/:barcode` (scan) | < 100 ms | Unique index partial |
| `GET /products/:id` (detail + variants + units) | < 150 ms | 3 query paralel / join |
| `POST /products` dengan 4 varian + 2 unit | < 400 ms | 1 transaksi DB |
| `POST /transactions` (5 item, 2 unit berbeda) | < 800 ms | Satu transaksi DB (existing) + resolusi unit/variant |
| `GET /products/export` (80 produk) | < 2 s | Generate xlsx di server |
| `POST /products/import` (500 baris) | < 10 s | Validasi batch + insert bulk |
| `bun run db:seed` (full) | < 60 s | Idempotent skip < 5 s |
| Respons list | < 200 KB | Tanpa variants detail; `includeUnits` menambah payload — jangan diaktifkan di list kasir |

### 9.2 Perilaku offline
- **Tidak berubah dari P0:** aplikasi online-only di Fase 2 (keputusan BA §4.2). Tidak ada queue offline untuk produk/import.
- **Satu-satunya pengecualian:** cart kasir tetap di frontend (existing) — Fase 2 tidak menambah persyaratan sinkronisasi.
- Kegagalan jaringan saat import → request gagal total (HTTP error), tidak ada state parsial di server (atomic); klien menampilkan error state dan menawarkan retry.

### 9.3 Hak akses (ringkas — detail §2 US-08 & §4)

| Aksi | Kasir | Manager | Admin |
|---|---|---|---|
| Baca produk/varian/unit (tanpa harga beli) | ✅ | ✅ | ✅ |
| Baca harga beli (`costPrice`) produk/varian | ❌ | ✅ | ✅ |
| CRUD produk, varian, unit, adjust stok | ❌ | ✅ | ✅ |
| Delete produk/varian | ❌ | ❌ | ✅ |
| Export Excel (mengandung harga beli) | ❌ | ✅ | ✅ |
| Import Excel, download template | ❌ | ✅ | ✅ |
| Checkout dengan `variantId`/`unit` | ✅ | ✅ | ✅ |
| Lihat audit log | ❌ | ❌ | ✅ |

### 9.4 Keamanan & integritas
- Semua endpoint mutasi: role guard + audit log (append-only).
- Validasi body via TypeBox (seperti existing): angka dibatasi (`minimum`), panjang teks, format UUID.
- **Jangan pernah mengembalikan `cost_price`/`cost_price` ke role kasir** di endpoint mana pun (termasuk detail varian & import template? — template TIDAK berisi harga contoh nyata, hanya header + placeholder).
- Upload import: validasi ekstensi & MIME (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` atau `application/octet-stream` dari browser), ukuran ≤ 2 MB; file diproses di memori (tidak disimpan ke disk), dihapus setelah selesai.
- XLSX diparse dengan library (SheetJS) dalam mode sel teks (`cellText`) — tidak mengeksekusi formula/macro; sel berisi `=` ditolak.
- Stok & konversi: semua update stok tetap pola atomik `UPDATE ... WHERE stock >= qty` / `FOR UPDATE` dalam 1 transaksi DB (anti oversell, R13).
