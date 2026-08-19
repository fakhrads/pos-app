# SPEC — Fase 3: Stok & Gudang

> **Proyek:** FakhriPOS — POS (Bun + Elysia + Drizzle ORM, Next.js + shadcn/ui, PostgreSQL `db_pos`)
> **Peran penulis:** System Analyst — output dari riset BA (`docs/phase2/RESEARCH.md` R2, R4) & riset praktik UMKM (Pawoon, Olsera, majoo, Beecloud, Yapos)
> **Tanggal:** 19 Agustus 2026
> **Status:** mengikat untuk developer (backend + frontend) Fase 3
> **Referensi:** `spec/features.md` (PROD-09, PROD-13), `spec/db-schema.md`, `spec/api-design.md`, `docs/phase2/SPEC.md` (§3.6–3.8, §7.1, §8), `docs/phase2/RESEARCH.md` (R2: alasan adjustment; R4: track_stock), `apps/api/src/db/schema.ts`, `apps/web/src/lib/types-warehouse.ts`

**Notasi prioritas:** P0 = wajib Fase 3 ini · P1-late = setelah Fase 3 (disebut sebagai catatan, TIDAK dikerjakan Fase 3).
Semua angka uang = **integer rupiah** (BIGINT). Semua qty = **NUMERIC(12,3)**. Semua waktu = **TIMESTAMPTZ** UTC, tampilan WIB. Semua ID = UUID.

---

## 1. Lingkup — masuk apa, TIDAK masuk apa

### 1.1 MASUK (Fase 3: Stok & Gudang)

| # | Fitur | Catatan lingkup |
|---|---|---|
| F3-1 | **CRUD gudang** | Create, update, soft-delete (nonaktifkan), view detail. Soft delete = data & stok tetap ada (Yapos: nonaktifkan outlet tanpa hapus data). Satu gudang ditetapkan **default** (gudang penjualan). |
| F3-2 | **Stok per gudang** | Daftar stok per gudang (baris per produk/varian), search, filter kategori & stok menipis, sort, pagination. Kasir boleh lihat qty & harga jual, TIDAK harga beli. |
| F3-3 | **Transfer stok antar gudang** | Form multi-item (majoo: mutasi stok antar cabang), pilih asal→tujuan, validasi qty per item, 1 nomor dokumen transfer (`TRF-...`), langsung jadi (approval = P1-late, Olsera). |
| F3-4 | **Koreksi stok (adjustment)** | Manual adjust ± dengan **alasan wajib dari daftar pilihan** (R2: rusak, expired, hilang, salah catat, selisih supplier, lainnya). Riwayat adjustment read-only. |
| F3-5 | **Kartu stok / mutasi** | Riwayat perubahan stok per produk per gudang (Pawoon: kartu stok per produk per gudang, mutasi otomatis), read-only, filter tanggal/tipe, pagination. |
| F3-6 | **Peringatan stok menipis** | Threshold per produk (existing `min_stock`) & per gudang (`warehouse_stocks.min_stock`), dashboard widget (majoo: notifikasi stok minimum per produk). |

### 1.2 TIDAK MASUK (sengaja, dengan catatan)

| Tidak masuk | Alasan / penanganan |
|---|---|
| **Approval transfer** (Olsera: terima transfer dengan approval) | P1-late. Fase 3 transfer **langsung jadi** dalam 1 transaksi. Kolom status di `stock_transfers` TIDAK dibuat (hindari kolom mati); penambahan status = migrasi kecil saat P1-late. |
| **Stok opname penuh + cetak lembar hitung** (Beecloud) | P1-late. Fase 3 cukup **adjustment manual per produk** (PROD-13). Alur opname (mulai sesi → isi stok fisik → hitung selisih → approve) & cetak lembar = P1-late; `stock_adjustments` siap sebagai jejaknya. |
| **Pembelian / stok masuk dari supplier** (Olsera) | P1-late (R6, modul pembelian). `purchase_in` di ledger sudah ada; form pembelian + supplier = luar lingkup. |
| **Pilih gudang saat checkout di kasir** | Keputusan scope (catatan eksplisit): Fase 3 kasir menjual dari **gudang default** (`settings['stock.default_warehouse_id']`). Pilih gudang per transaksi di kasir = P1-late. |
| **Stok per outlet** (`outlet_id`) | Gudang = unit lokasi stok; `outlet_id` existing tidak dipakai untuk stok (multi-outlet = P1, catatan db-schema.md). |
| **Batch/FEFO per gudang, expiry per batch** | P2 (sudah dicatat Fase 2 §1.2). `expiry_date` per produk tetap info saja. |
| **Export/import stok per gudang (lembar opname .xlsx)** | P1-late. REP-03 existing tetap export CSV. |
| **Reservasi stok / backorder** | Tidak ada. Cek stok atomik saat transaksi/transfer/adjustment (anti oversell R13). |
| **Gudang bertingkat/hierarki, ongkir transfer, nilai uang stok per gudang** | Tidak dikerjakan. Detail gudang hanya menampilkan ringkasan qty (bukan nilai uang). |

### 1.3 Keputusan penyelarasan (catatan eksplisit — termasuk perubahan skema)

Skema Fase 2 sudah menyiapkan `warehouses`, `warehouse_stocks`, `stock_transfers`, `stock_adjustments` (§3.6–3.8 SPEC Fase 2). Fase 3 memakai tabel itu **tanpa tabel baru**, dengan **2 ALTER kecil** yang TIDAK ada di SPEC Fase 2 (perubahan skema eksplisit, dibahas detail di §3):

1. **`stock_movements` + kolom `warehouse_id`** — SPEC Fase 2 §3.5 tidak menyertakannya, tetapi **kartu stok per gudang (F3-5) tidak mungkin tanpa tahu gudang asal mutasi**. Kolom nullable FK, backfill ke gudang default (konsisten dengan invariant seed Fase 2: seluruh stok di `GUD-PUSAT`). Frontend `types-warehouse.ts` sudah mengantisipasi `StockMutation.warehouseId`.
2. **Enum `movement_type` + `transfer_out` & `transfer_in`** — ledger (sumber kebenaran) wajib mencatat transfer sebagai mutasi terpisah dari `adjustment`. `types-warehouse.ts` `MutationType` sudah berisi `transfer_in/transfer_out` — penyelarasan. Catatan rollback: nilai enum PostgreSQL tidak bisa di-drop tanpa recreate type (lihat §8.2).
3. **`stock_transfers` + kolom `transfer_number`** — skema Fase 2 adalah per-baris (1 baris = 1 produk). Form transfer **multi-item** (praktik mutasi antar cabang) butuh dokumen pengelompok: `TRF-YYYYMMDD-XXXX` (pola `lib/sequence.ts` existing, sama seperti TRX/RET). Seed Fase 2 tidak membuat baris transfer → backfill trivial (0 baris).
4. **Gudang default** disimpan di `settings['stock.default_warehouse_id']` (bukan kolom baru di `warehouses`) — tanpa migrasi, konsisten dengan pola settings existing, dan bisa dipindah tanpa sentuh skema.
5. **Alasan adjustment** = daftar tetap di aplikasi (R2), disimpan sebagai VARCHAR di `stock_adjustments.reason` (bukan enum DB) — daftar bisa diperluas tanpa migrasi. Nilai: `rusak`, `expired`, `hilang`, `salah_catat`, `selisih_supplier`, `laimnya`.

---

## 2. User Story + Kriteria Penerimaan (Given/When/Then)

Konvensi: setiap AC ditulis Given/When/Then; **setiap AC wajib bisa diuji otomatis** (test backend via HTTP, atau query DB langsung). "Cepat" tidak diterima sebagai AC — semua AC waktu memakai angka milidetik/detik.

### US-01 — Kelola gudang (tambah, ubah, nonaktifkan)
Sebagai **manager**, saya bisa menambah dan mengubah gudang serta menonaktifkan gudang yang tidak dipakai, supaya struktur lokasi stok mencerminkan kondisi nyata (gudang pusat + toko depan).
- AC-01.1: **Given** saya login sebagai manager, **When** `POST /warehouses` dengan `{ code: 'GUD-YOGYA', name: 'Gudang Yogyakarta', address, pic, capacity: 500 }`, **Then** 201 `{ warehouse }`, `isActive=true`, dan audit `warehouse.create` tercatat.
- AC-01.2: **Given** `GUD-YOGYA` tersimpan, **When** `PATCH /warehouses/:id` dengan `{ pic: 'Budi', capacity: 800 }`, **Then** 200 dengan `pic='Budi'`, `capacity=800`, audit `warehouse.update` tercatat.
- AC-01.3: **Given** kode `GUD-PUSAT` sudah dipakai gudang aktif, **When** `POST /warehouses` dengan kode yang sama, **Then** 409 `DUPLICATE_WAREHOUSE_CODE` dan tidak ada gudang baru tersimpan.
- AC-01.4: **Given** gudang dengan stok 250 pcs tersebar di 3 produk, **When** admin `DELETE /warehouses/:id`, **Then** 200 `{ deleted: true }`, gudang soft-delete (`deleted_at` terisi, `is_active=false`), **stok & riwayat tetap ada**, dan `Σ warehouse_stocks` per produk TIDAK berubah (invariant utuh).
- AC-01.5: **Given** gudang yang menjadi **default**, **When** admin `DELETE /warehouses/:id`, **Then** 409 `WAREHOUSE_IS_DEFAULT` — harus pindah default dulu (`POST /warehouses/:otherId/default`).
- AC-01.6: **Given** gudang nonaktif (`is_active=false`), **When** form transfer dibuka sebagai manager, **Then** gudang nonaktif TIDAK muncul di pilihan asal/tujuan, tetapi tetap tampil di list gudang (manager, `includeInactive=true`) dan riwayat transfer lama tetap menampilkan namanya.
- AC-01.7: **Given** kasir login, **When** memanggil `POST /warehouses`, `PATCH /warehouses/:id`, atau `DELETE /warehouses/:id`, **Then** 403 `FORBIDDEN`.

### US-02 — Lihat stok per gudang
Sebagai **manager**, saya bisa melihat seluruh stok di satu gudang dan mencarinya, supaya saya tahu barang apa yang harus di-transfer atau dibeli.
- AC-02.1: **Given** gudang `GUD-PUSAT` berisi 60 produk (10 ber-varian, total 70 baris), **When** `GET /warehouses/:id/stocks?perPage=20`, **Then** 200 `{ items: 20, meta }`; **baris varian tampil terpisah** dengan nama varian; item menyertakan `sku`, `unit`, `quantity`, `minStock` (per gudang), `productMinStock`, `status` (`ok`/`low`/`out`), `sellingPrice`; kasir menerima item **tanpa `costPrice`**.
- AC-02.2: **Given** baris stok dengan `quantity=0`, **When** `GET /warehouses/:id/stocks?lowStock=true`, **Then** item dengan qty 0 **ikut muncul** (stok habis termasuk menipis), urutan default `quantity ASC`.
- AC-02.3: **Given** stok gudang `GUD-BANDUNG` 40 pcs Indomie & 10 pcs Aqua, **When** `GET /warehouses/:id/stocks?q=indo`, **Then** hanya Indomie yang muncul (search nama/SKU/variant name, case-insensitive).
- AC-02.4: **Given** produk `track_stock=false` (jasa) memiliki baris di `warehouse_stocks` dengan qty 0, **When** `GET /warehouses/:id/stocks?lowStock=true`, **Then** produk jasa TIDAK muncul (konsisten REP-03, AC-04.2 Fase 2).
- AC-02.5: **Given** gudang tidak ada / soft-deleted, **When** `GET /warehouses/:id/stocks`, **Then** 404 `WAREHOUSE_NOT_FOUND`.
- AC-02.6: **Given** data konsisten, **When** query DB `Σ warehouse_stocks WHERE warehouse_id = X` dibandingkan per produk dengan `products.stock_on_hand` (atau varian), **Then** selisih = 0 untuk semua baris gudang aktif.

### US-03 — Transfer stok antar gudang
Sebagai **manager**, saya bisa memindahkan stok dari satu gudang ke gudang lain (banyak produk sekaligus), supaya toko depan tidak kehabisan barang saat gudang pusat masih punya.
- AC-03.1: **Given** stok `GUD-PUSAT`: Indomie 100 pcs, Aqua 50 pcs; `GUD-BANDUNG`: keduanya 0, **When** `POST /stock-transfers` dengan `{ fromWarehouseId: GUD-PUSAT, toWarehouseId: GUD-BANDUNG, items: [{ productId: Indomie, quantity: 40 }, { productId: Aqua, quantity: 20 }] }`, **Then** 201 `{ transferNumber: 'TRF-20260819-0001', items: [...] }`; query DB: `GUD-PUSAT` Indomie 60, Aqua 30; `GUD-BANDUNG` Indomie 40, Aqua 20; `stock_movements` berisi 4 baris (2× `transfer_out` di asal, 2× `transfer_in` di tujuan) dengan `reference = transferNumber`; invariant `Σ = stock_on_hand` tetap (net 0).
- AC-03.2: **Given** stok asal Indomie 10 pcs, **When** transfer `quantity: 15`, **Then** 409 `STOCK_INSUFFICIENT` dengan `details: { productId, available: 10, requested: 15 }`, stok kedua gudang TIDAK berubah, dan TIDAK ada movement baru (rollback penuh semua item, bukan hanya item yang gagal).
- AC-03.3: **Given** transfer multi-item dengan 1 item error (qty melebihi stok), **When** request diproses, **Then** seluruh transfer ditolak (atomic — tidak ada item valid yang tersimpan), 409 `STOCK_INSUFFICIENT`.
- AC-03.4: **Given** `fromWarehouseId = toWarehouseId`, **When** `POST /stock-transfers`, **Then** 422 `SAME_WAREHOUSE`.
- AC-03.5: **Given** gudang asal atau tujuan nonaktif, **When** transfer, **Then** 422 `WAREHOUSE_INACTIVE` (pesan menyebut gudang mana).
- AC-03.6: **Given** transfer stok **varian** (produk `hasVariants=true`, stok di varian), **When** `POST /stock-transfers` dengan `{ productId, variantId, quantity }`, **Then** stok varian di asal/tujuan berubah, `warehouse_stocks` baris varian ter-update, movement `transfer_out/in` memakai `product_variant_id`, dan `products.stock_on_hand` induk tetap 0.
- AC-03.7: **Given** body berisi item duplikat (produk+varian sama 2×), **When** transfer, **Then** 422 `DUPLICATE_TRANSFER_ITEM`.
- AC-03.8: **Given** produk `track_stock=false`, **When** transfer produk itu, **Then** 422 `STOCK_TRACKING_DISABLED`.
- AC-03.9: **Given** kasir login, **When** `POST /stock-transfers`, **Then** 403 `FORBIDDEN`.
- AC-03.10: **Given** saya membuka `GET /stock-transfers?from=&to=`, **When** respons diperiksa, **Then** item dikelompokkan per `transferNumber` (header + `lines[]`), diurutkan `createdAt DESC`.

### US-04 — Koreksi stok manual
Sebagai **manager**, saya bisa mengoreksi stok (tambah/kurang) dengan alasan wajib, supaya stok sistem sesuai kondisi fisik (rusak, expired, hilang, selisih).
- AC-04.1: **Given** stok `GUD-PUSAT` Aqua 50 pcs, **When** `POST /stock-adjustments` `{ warehouseId, productId, quantityDelta: -2, reason: 'rusak', note: 'kemasan penyok' }`, **Then** 201 `{ adjustment, beforeQty: 50, afterQty: 48 }`, stok gudang 48, `stock_movements` 1 baris `adjustment` qty=2 (negatif), `reference = adjustment.id`, audit `stock.adjustment` tercatat.
- AC-04.2: **Given** saya mengirim `quantityDelta: 0`, **When** request diproses, **Then** 422 `ZERO_DELTA`.
- AC-04.3: **Given** saya mengirim `reason: 'banjir'` (tidak ada di daftar), **When** request diproses, **Then** 422 `INVALID_REASON` dengan `details.allowed = ['rusak','expired','hilang','salah_catat','selisih_supplier','laimnya']`.
- AC-04.4: **Given** stok gudang 5 pcs, **When** adjustment `quantityDelta: -10`, **Then** 409 `STOCK_INSUFFICIENT` (`available: 5, requested: 10`), stok & movement TIDAK berubah.
- AC-04.5: **Given** adjustment +5 sukses, **When** `GET /stock-adjustments?warehouseId=&productId=`, **Then** baris adjustment muncul dengan `reason`, `note`, `createdBy.name`, `createdAt`.
- AC-04.6: **Given** adjustment varian, **When** diproses, **Then** stok varian berubah, `product_variant_id` terisi di `stock_adjustments` & `stock_movements`, induk tetap 0.
- AC-04.7: **Given** kasir login, **When** `POST /stock-adjustments`, **Then** 403 `FORBIDDEN`.

### US-05 — Kartu stok / mutasi per produk per gudang
Sebagai **manager**, saya bisa melihat seluruh riwayat perubahan stok satu produk di satu gudang, supaya saya tahu kapan & kenapa stok berubah (Pawoon: kartu stok, mutasi otomatis).
- AC-05.1: **Given** produk Indomie di `GUD-PUSAT` punya 12 mutasi (initial, 3 sale_out, 1 return_in, 2 transfer_out, 2 transfer_in, 1 adjustment, 2 cancellation), **When** `GET /warehouses/:id/stock-movements?productId=`, **Then** 200 dengan 12 baris urut `createdAt DESC`, tiap baris berisi `type`, `typeLabel`, `quantity`, `beforeQty`, `afterQty`, `reference`, `note`, `createdBy`, `createdAt`; **tidak ada tombol edit/delete** (read-only).
- AC-05.2: **Given** mutasi dengan `quantityDelta` negatif (sale_out 3 pcs), **When** baris diperiksa, **Then** `beforeQty − afterQty = |quantity|` dan `type='sale_out'`; rantai `afterQty` baris terbaru = stok gudang saat ini (`warehouse_stocks.quantity`).
- AC-05.3: **Given** saya filter `?type=transfer_out&from=2026-08-01&to=2026-08-19`, **When** respons diperiksa, **Then** hanya mutasi transfer keluar dalam rentang (WIB) yang muncul.
- AC-05.4: **Given** transfer `TRF-20260819-0001`, **When** saya membuka kartu stok gudang asal & tujuan untuk produk yang sama, **Then** di asal muncul `transfer_out` dan di tujuan muncul `transfer_in` dengan `reference` yang sama, `quantity` sama, `createdAt` sama (±1 detik).
- AC-05.5: **Given** mutasi tanpa `productId` filter, **When** `GET /warehouses/:id/stock-movements` dipanggil, **Then** 422 `VALIDATION_ERROR` (`details.field='productId'`) — kartu stok wajib di-scope per produk (performa & keterbacaan).
- AC-05.6: **Given** `stock_movements` lama (Fase 1/2, sebelum kolom `warehouse_id`), **When** kartu stok dibuka, **Then** baris lama muncul ter-backfill ke gudang default (backfill migrasi) dan rantai before/after tetap kontinu.
- AC-05.7: **Given** kasir login, **When** `GET /warehouses/:id/stock-movements?productId=`, **Then** 200 tanpa `costPrice` di mana pun (respons kartu stok tidak mengandung harga sama sekali).

### US-06 — Peringatan stok menipis & dashboard widget
Sebagai **manager**, saya ingin tahu produk yang stoknya menipis (per produk maupun per gudang), supaya saya bisa transfer/order sebelum kehabisan (majoo: notifikasi stok minimum per produk).
- AC-06.1: **Given** produk Indomie `min_stock=20`, total stok semua gudang 15 (GUD-PUSAT 10 + GUD-BANDUNG 5), **When** `GET /reports/low-stock`, **Then** Indomie muncul dengan `totalStock=15` dan rincian per gudang aktif (`[{ warehouseId, warehouseName, quantity }]`).
- AC-06.2: **Given** `GET /reports/low-stock?warehouseId=GUD-BANDUNG` dan baris `warehouse_stocks` gudang itu `min_stock=8`, qty 5, **When** respons diperiksa, **Then** produk muncul (qty 5 ≤ min 8) walau total stok semua gudang (mis. 30) > `products.min_stock` — **filter per gudang memakai `warehouse_stocks.min_stock`**.
- AC-06.3: **Given** produk `track_stock=false` dan varian dengan `min_stock` masing-masing, **When** `GET /reports/low-stock`, **Then** produk jasa TIDAK muncul; **varian dihitung per varian** (baris per varian dengan `variantName`, `minStock` varian).
- AC-06.4: **Given** widget dashboard manager, **When** `GET /reports/low-stock?perPage=10` dipanggil, **Then** respons berisi `{ rows, meta }` dengan `meta.total` = jumlah produk menipis dan 10 item teratas — widget menampilkan count + list + link ke halaman stok.
- AC-06.5: **Given** saya mengubah `min_stock` produk via `PATCH /products/:id` (existing Fase 2), **When** `GET /reports/low-stock` dipanggil lagi, **Then** hasil mengikuti threshold baru (tanpa endpoint khusus).
- AC-06.6: **Given** kasir login, **When** memanggil `GET /reports/low-stock` atau `GET /reports/dashboard`, **Then** 403 `FORBIDDEN` (laporan = manager+, existing REP-03).

---

## 3. Model Data (tabel, kolom, tipe, constraint, index, relasi)

Konvensi global mengikuti `db-schema.md` §2 (UUID PK, uang BIGINT, qty NUMERIC(12,3), TIMESTAMPTZ, soft delete `deleted_at`, enum native). **Fase 3 TIDAK membuat tabel baru** — seluruh tabel sudah dibuat Fase 2 (§3.6–3.8 SPEC Fase 2) dan TIDAK diubah strukturnya kecuali 2 ALTER di bawah (catatan eksplisit §1.3).

### 3.1 ALTER `stock_movements` (+1 kolom) & enum — P0 (perluasan SPEC Fase 2 §3.5)

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| warehouse_id | UUID | NULL, FK → warehouses.id, ON DELETE SET NULL | Gudang asal mutasi. NULL hanya untuk baris legacy yang gagal backfill (tidak boleh terjadi). |

- Enum `movement_type` + 2 nilai baru: `'transfer_out'`, `'transfer_in'` (ALTER TYPE ... ADD VALUE; lihat §8.2 catatan rollback).
- Index baru: `idx_stock_movements_wh_product ON (warehouse_id, product_id, created_at)` — akses kartu stok (F3-5).
- Backfill: seluruh baris existing → `warehouse_id = settings['stock.default_warehouse_id']` (saat migrasi = gudang aktif pertama, urut `created_at ASC`). Konsisten dengan invariant seed Fase 2 (seluruh stok di gudang pertama).

**Semantik (mengikat):** SETIAP mutasi stok (initial, purchase_in, sale_out, return_in, adjustment, cancellation, transfer_in, transfer_out) wajib mengisi `warehouse_id`. Penjualan/return/void memakai gudang default; transfer memakai gudang asal (transfer_out) / tujuan (transfer_in).

### 3.2 ALTER `stock_transfers` (+1 kolom) — P0 (perluasan SPEC Fase 2 §3.8)

| Kolom | Tipe | Constraint | Keterangan |
|---|---|---|---|
| transfer_number | VARCHAR(30) | NOT NULL | `TRF-YYYYMMDD-XXXX` (pola `lib/sequence.ts`, sekuensial per hari). Satu nomor = satu dokumen transfer multi-item (n baris berbagi nomor). |

- Unique index: `uq_stock_transfers_number UNIQUE (transfer_number)`.
- Index: `idx_stock_transfers_number_created ON (transfer_number, created_at)`.
- Backfill: seed Fase 2 tidak membuat baris transfer → 0 baris (jika ada data dev, generate `TRF-YYYYMMDD-XXXX` berurutan).

**Semantik:** `notes` tetap per baris; saat UI mengisi satu catatan untuk seluruh transfer, catatan disalin ke tiap baris (tidak ada tabel header baru — minimal change).

### 3.3 `settings` — key baru (bukan perubahan skema)

| Key | Tipe value | Default | Keterangan |
|---|---|---|---|
| `stock.default_warehouse_id` | string (UUID) | gudang aktif pertama (saat migrasi/seed) | Gudang penjualan: sale_out/return_in/cancellation & `PATCH /products/:id/stock` memotong/menambah stok gudang ini + `warehouse_id` di movement. |

### 3.4 Invariant (dijaga aplikasi, diuji otomatis — penguatan dari Fase 2)

1. **Σ warehouse_stocks = stock_on_hand** per produk/varian — sekarang dijaga di SEMUA alur mutasi stok: checkout, return, void/cancel, `PATCH /products/:id/stock`, transfer, adjustment. (Fase 2 hanya menjamin di seed.)
2. **Setiap mutasi stok menulis ≥1 baris `stock_movements`** dengan `warehouse_id` terisi (ledger = sumber kebenaran, db-schema.md).
3. **Transfer netral:** untuk satu `transfer_number`, `Σ transfer_out (asal)` = `Σ transfer_in (tujuan)` per (product, variant); total stok gabungan TIDAK berubah.
4. **Gudang nonaktif/soft-deleted tetap menyimpan stok** — `warehouse_stocks` tidak dihapus; invariant tetap berlaku untuk gudang nonaktif.

### 3.5 Ringkasan perubahan vs skema existing

| Objek | Perubahan | Breaking? |
|---|---|---|
| `stock_movements` | +1 kolom nullable FK + 2 nilai enum + 1 index | Tidak — query existing tetap jalan; enum ADD VALUE non-breaking |
| `stock_transfers` | +1 kolom NOT NULL (backfill) + 2 index | Tidak — tabel masih kosong di seed |
| `settings` | +1 key | Tidak |
| `warehouses`, `warehouse_stocks`, `stock_adjustments` | **Tidak diubah** (struktur Fase 2 dipakai apa adanya) | — |

**Migrasi (rencana):** file baru `apps/api/src/db/ddl-phase3.sql`, dieksekusi di `migrate.ts` setelah `ddl-phase2.sql` (tahap 3): (a) `ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'transfer_out'` dan `'transfer_in'` — **2 statement terpisah** (nilai enum baru tidak bisa dipakai dalam transaksi yang sama dengan ADD VALUE; jalankan di luar transaksi besar atau urutkan dengan benar); (b) `ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL`; (c) backfill warehouse_id (subquery ke settings/gudang pertama); (d) `CREATE INDEX IF NOT EXISTS idx_stock_movements_wh_product`; (e) `ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS transfer_number VARCHAR(30)`; (f) backfill transfer_number; (g) `ALTER COLUMN transfer_number SET NOT NULL` + unique index; (h) upsert `settings['stock.default_warehouse_id']`. `drizzle-kit check` harus lulus. Rollback: §8.2. Migrasi **idempotent**.

---

## 4. Kontrak API (endpoint, method, request, response, kode error)

Base: `/api/v1`. Envelope: `{ ok, data }` / `{ ok:false, error:{ code, message, details? } }` (api-design.md §1.2 — mengikat). Semua qty NUMERIC(12,3). Role guard: **baca stok = kasir+ (tanpa harga beli)**, **mutasi stok = manager+**, **soft-delete gudang = admin**. Semua endpoint mutasi menulis audit log.

### 4.1 Gudang

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `GET /warehouses` | kasir+ | query: `includeInactive` (manager+, default false), `q`, `page`, `perPage` | `{ items, meta }`; item: `{ id, code, name, address, pic, capacity, isActive, isDefault, itemCount, totalQty, createdAt, updatedAt }` (kasir tanpa `capacity`? — TIDAK: capacity bukan data harga, kasir boleh lihat) | — |
| `GET /warehouses/:id` | kasir+ | — | `{ warehouse, isDefault, stockSummary: { itemCount, totalQty } }` | `WAREHOUSE_NOT_FOUND` (404) |
| `POST /warehouses` | manager+ | `{ code, name, address?, pic?, capacity?, isActive? }` | 201 `{ warehouse, isDefault:false }`; bila ini gudang pertama → otomatis jadi default | `DUPLICATE_WAREHOUSE_CODE` (409), `VALIDATION_ERROR` (422) |
| `PATCH /warehouses/:id` | manager+ | parsial: code, name, address, pic, capacity, isActive | 200 `{ warehouse }` | `WAREHOUSE_NOT_FOUND` (404), `DUPLICATE_WAREHOUSE_CODE` (409) |
| `POST /warehouses/:id/default` | manager+ | — | 200 `{ warehouse, isDefault:true }`; set `settings['stock.default_warehouse_id']` | `WAREHOUSE_NOT_FOUND` (404), `WAREHOUSE_INACTIVE` (422 — gudang nonaktif tidak bisa jadi default) |
| `DELETE /warehouses/:id` | admin | — | 200 `{ id, deleted:true }` — soft delete (`deleted_at` + `is_active=false`); stok & riwayat tetap | `WAREHOUSE_NOT_FOUND` (404), `WAREHOUSE_IS_DEFAULT` (409) |

Audit: `warehouse.create`, `warehouse.update`, `warehouse.delete`, `warehouse.set_default`.

### 4.2 Stok per gudang

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `GET /warehouses/:id/stocks` | kasir+ | query: `q` (nama/SKU/nama varian), `categoryId`, `lowStock` (default false; `quantity ≤ minStock` per gudang, termasuk qty 0), `includeInactiveProduct` (manager+, default false), `sort` (`quantity:asc` default saat lowStock, `name:asc`, `sku:asc`), `page`, `perPage` | `{ items, meta }`; item: `{ warehouseId, productId, variantId?, sku, barcode?, name, variantName?, unit, quantity, minStock, productMinStock, status: 'ok'\|'low'\|'out', sellingPrice, costPrice? (manager+), updatedAt }` — **baris per (product, variant|null)** | `WAREHOUSE_NOT_FOUND` (404) |
| `GET /warehouses/:id/stocks/low-stock` | manager+ | — | `{ items }` — subset `lowStock=true`, urut qty ASC (shortcut untuk halaman "stok menipis per gudang") | `WAREHOUSE_NOT_FOUND` (404) |

### 4.3 Transfer stok

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `POST /stock-transfers` | manager+ | `{ fromWarehouseId, toWarehouseId, items: [{ productId, variantId?, quantity, notes? }], notes? }` (1..50 item; `notes` level dokumen disalin ke tiap baris) | 201 `{ transferNumber, fromWarehouseId, toWarehouseId, createdAt, createdBy, items: [{ id, productId, variantId?, quantity, fromBefore, fromAfter, toBefore, toAfter }] }` — 1 transaksi DB atomik | `SAME_WAREHOUSE` (422), `WAREHOUSE_INACTIVE` (422), `WAREHOUSE_NOT_FOUND` (404), `PRODUCT_NOT_FOUND` (404), `STOCK_TRACKING_DISABLED` (422), `DUPLICATE_TRANSFER_ITEM` (422), `INVALID_QUANTITY` (422, qty ≤ 0 atau > 3 desimal), `STOCK_INSUFFICIENT` (409, details per item) |
| `GET /stock-transfers` | manager+ | query: `fromWarehouseId`, `toWarehouseId`, `q` (cari transferNumber), `from`, `to` (createdAt, WIB), `page`, `perPage` | `{ items, meta }` — **dikelompokkan per transferNumber**: `{ transferNumber, createdAt, createdBy: {id,name}, fromWarehouse: {id,code,name}, toWarehouse: {id,code,name}, lineCount, totalQty, lines: [...] }`, urut `createdAt DESC` | — |
| `GET /stock-transfers/:transferNumber` | manager+ | — | `{ transfer: { ...header }, lines: [{ productId, variantId?, sku, name, variantName?, unit, quantity, notes }] }` | `STOCK_TRANSFER_NOT_FOUND` (404) |

Audit: `stock.transfer` (newValues: transferNumber, jumlah item, total qty, asal→tujuan).

### 4.4 Koreksi stok (adjustment)

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `POST /stock-adjustments` | manager+ | `{ warehouseId, productId, variantId?, quantityDelta, reason, note? }` — reason ∈ daftar §1.3.5 | 201 `{ adjustment: { id, warehouseId, productId, variantId?, quantityDelta, reason, note, createdBy, createdAt }, beforeQty, afterQty }` | `WAREHOUSE_NOT_FOUND` (404), `WAREHOUSE_INACTIVE` (422), `PRODUCT_NOT_FOUND` (404), `STOCK_TRACKING_DISABLED` (422), `INVALID_REASON` (422, details.allowed), `ZERO_DELTA` (422), `STOCK_INSUFFICIENT` (409) |
| `GET /stock-adjustments` | manager+ | query: `warehouseId`, `productId`, `reason`, `from`, `to`, `page`, `perPage` | `{ items, meta }`; item: `{ id, warehouse: {id,code,name}, product: {id,sku,name}, variant?: {id,name}, quantityDelta, reason, reasonLabel, note, createdBy: {id,name}, createdAt }` | — |

Audit: `stock.adjustment` (oldValues: beforeQty; newValues: afterQty, reason).

### 4.5 Kartu stok / mutasi (read-only)

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `GET /warehouses/:id/stock-movements` | kasir+ | query: `productId` (**wajib**), `variantId?`, `type?` (salah satu movement_type, boleh diulang), `from`, `to` (createdAt, WIB), `page`, `perPage` (default 50, max 200) | `{ items, meta }`; item: `{ id, type, typeLabel, quantity, beforeQty, afterQty, reference, note, createdAt, createdBy: {id,name} }` — urut `createdAt DESC`; **TIDAK ada endpoint tulis** | `WAREHOUSE_NOT_FOUND` (404), `VALIDATION_ERROR` (422 — tanpa productId) |
| `GET /warehouses/:id/stock-movements/export` | manager+ | query sama | 200 CSV (BOM, pola REP-05 existing) `stock-card-<gudang>-<product>.csv` | — |

`typeLabel` (UI, dari `types-warehouse.ts` `MUTATION_TYPE_LABEL` + 2 nilai enum baru): `initial`=Stok Awal, `purchase_in`=Pembelian, `sale_out`=Penjualan, `return_in`=Retur Masuk, `adjustment`=Koreksi Stok, `cancellation`=Pembatalan, `transfer_out`=Transfer Keluar, `transfer_in`=Transfer Masuk.

### 4.6 Peringatan stok menipis (extend existing)

| Method & Path | Role | Request | Response | Error |
|---|---|---|---|---|
| `GET /reports/low-stock` | manager+ | query existing + **`warehouseId?`** (bila ada: pakai `warehouse_stocks.min_stock` per gudang; tanpa: `products.min_stock`/`product_variants.min_stock` atas Σ stok gudang aktif) | row existing + `{ totalStock, minStock, warehouseBreakdown: [{ warehouseId, warehouseName, quantity }] }`; **varian = baris sendiri** (`variantName`, `variantId`) | — |

Dashboard widget: frontend memakai `GET /reports/low-stock?perPage=10` (kontrak dashboard route TIDAK berubah — lihat §8.1).

### 4.7 Daftar kode error baru (lengkap)

| Kode | HTTP | Kapan |
|---|---|---|
| `DUPLICATE_WAREHOUSE_CODE` | 409 | Kode gudang duplikat dengan gudang aktif lain |
| `WAREHOUSE_NOT_FOUND` | 404 | Gudang tidak ada / soft-deleted |
| `WAREHOUSE_INACTIVE` | 422 | Gudang nonaktif dipakai sebagai asal/tujuan transfer, adjustment, atau jadi default |
| `WAREHOUSE_IS_DEFAULT` | 409 | Soft-delete/nonaktifkan gudang yang sedang default |
| `SAME_WAREHOUSE` | 422 | `fromWarehouseId = toWarehouseId` |
| `STOCK_TRANSFER_NOT_FOUND` | 404 | Nomor transfer tidak ada |
| `DUPLICATE_TRANSFER_ITEM` | 422 | Produk+varian sama muncul >1× dalam satu transfer |
| `INVALID_QUANTITY` | 422 | qty ≤ 0, bukan angka, atau presisi > 3 desimal |
| `STOCK_TRACKING_DISABLED` | 422 | Transfer/adjustment produk `track_stock=false` |
| `INVALID_REASON` | 422 | Alasan adjustment tidak ada di daftar; details.allowed |
| `ZERO_DELTA` | 422 | `quantityDelta = 0` |
| `STOCK_INSUFFICIENT` | 409 | existing — dipakai ulang: transfer (asal), adjustment negatif, sale_out gudang default (details kini menyertakan `warehouseId`) |

---

## 5. Aturan Bisnis (rumus, ambang batas, urutan)

1. **Gudang default & penjualan:** `settings['stock.default_warehouse_id']`. Checkout (`sale_out`), return (`return_in`), dan void (`cancellation`) memotong/menambah `warehouse_stocks` **gudang default** + menulis `stock_movements.warehouse_id` = gudang default. **Cek stok sale_out = stok gudang default, bukan total semua gudang** (stok gudang adalah kebenaran operasional) — kasir melihat stok gabungan? **TIDAK**: kasir melihat stok gudang default; UI menampilkan gudang aktif saat ini. Bila stok gudang default < qty → 409 `STOCK_INSUFFICIENT` dengan `details.warehouseId` (meski gudang lain punya stok — solusi = transfer dulu, F3-3).
2. **`PATCH /products/:id/stock` (existing Fase 2)** tetap berjalan backward-compatible, tetapi kini juga: update `warehouse_stocks` gudang default + `warehouse_id` di movement (agar invariant §3.4.1 selalu utuh). **Catatan:** untuk koreksi per gudang, gunakan `POST /stock-adjustments` (F3-4); endpoint produk = shortcut gudang default.
3. **Transfer (urutan, 1 transaksi DB):** validasi (gudang beda & aktif, item unik, qty > 0, produk ada & `track_stock=true`) → generate `TRF-...` → per item: `UPDATE warehouse_stocks SET quantity = quantity - q WHERE warehouse_id=asal AND product... AND quantity >= q` (atomik, gagal → rollback semua + 409) → `UPDATE ... + q` di tujuan (upsert baris bila belum ada) → insert n baris `stock_transfers` → insert 2n baris `stock_movements` (`transfer_out` asal, `transfer_in` tujuan, `reference = transferNumber`, before/after per gudang) → update `products.stock_on_hand`/varian TIDAK perlu (net 0, invariant otomatis).
4. **Adjustment (urutan):** validasi (gudang aktif, produk `track_stock=true`, `delta ≠ 0`, reason ∈ daftar) → `quantityDelta < 0`: `UPDATE ... WHERE quantity >= |delta|` atomik → insert `stock_adjustments` → insert `stock_movements` type `adjustment` (`quantity = |delta|`, tanda tercermin di before/after; `reference = adjustment.id`) → update `stock_on_hand` produk/varian (delta sama) agar invariant utuh.
5. **Daftar alasan (R2, mengikat):** `rusak`, `expired`, `hilang`, `salah_catat`, `selisih_supplier`, `laimnya`. `note` opsional tapi disarankan (ditampilkan di kartu stok & riwayat adjustment).
6. **Peringatan menipis:** per produk = `Σ quantity` semua **gudang aktif** ≤ `products.min_stock` (varian: `product_variants.min_stock`), `track_stock=true`; per gudang = `warehouse_stocks.quantity ≤ warehouse_stocks.min_stock` (bila `min_stock = 0` → baris tidak dihitung menipis). `min_stock` produk bisa diubah via `PATCH /products/:id` existing; `min_stock` per gudang via API stok? — **P1-late** (Fase 3 hanya baca `warehouse_stocks.min_stock`; pengelolaannya via seed/admin SQL — catatan: nilai default 0 = nonaktif).
7. **Varian di stok per gudang:** baris `warehouse_stocks` per varian; transfer/adjustment varian menulis `product_variant_id`; stok induk (`products.stock_on_hand`) tetap 0 selama `has_variants=true`.
8. **Soft delete gudang:** admin only; `deleted_at` + `is_active=false` dalam 1 transaksi; TIDAK menyentuh `warehouse_stocks`/riwayat; gudang default ditolak (409) — pindah default dulu. `PATCH isActive=false` = nonaktif reversible (masih tampil di list manager, tidak di pilihan operasional).
9. **Nomor dokumen:** `TRF-YYYYMMDD-XXXX` via `lib/sequence.ts` (extend prefix, pola TRX/RET existing). Unik, sekuensial per hari, retry 1× saat konflik.
10. **Read-only:** kartu stok & riwayat transfer/adjustment TIDAK punya endpoint update/delete — koreksi kesalahan = adjustment baru (jejak audit utuh).
11. **Qty & pembulatan:** semua qty NUMERIC(12,3), `toQty` (round half-up 3 desimal). qty ≤ 0 ditolak; presisi > 3 desimal ditolak (`INVALID_QUANTITY`).

---

## 6. Alur Status (state machine)

### 6.1 Gudang: lifecycle

```
active ──PATCH isActive=false (manager)──▶ inactive ──PATCH isActive=true──▶ active
active/inactive ──DELETE (admin, soft)──▶ deleted (terminal; data & stok tetap;
                                          tampil di riwayat transfer/kartu stok;
                                          TIDAK muncul di list default, pilihan transfer,
                                          atau stok operasional)
```
Aturan transisi:
- `is_active=false` → 422 bila gudang sedang default (`WAREHOUSE_IS_DEFAULT`).
- Soft-delete (`DELETE`) → otomatis `is_active=false` + `deleted_at`; gudang default ditolak (409).
- Gudang nonaktif/soft-deleted **tetap menyimpan stok** (invariant §3.4.4) — stoknya tidak bisa di-transfer keluar (ditolak `WAREHOUSE_INACTIVE`), menjadi tanggung jawab admin untuk menormalisasi (reactivate → transfer → nonaktifkan lagi).

### 6.2 Transfer & adjustment: tidak ada status

Transfer langsung jadi dalam 1 transaksi (tanpa pending/approve — approval = P1-late, Olsera). Adjustment langsung jadi. Keduanya immutable setelah commit; koreksi hanya lewat adjustment baru. Tidak ada state machine baru di Fase 3.

### 6.3 Kartu stok: append-only

Ledger `stock_movements` read-only dari sisi API; satu-satunya penulis adalah service mutasi stok (checkout, return, void, transfer, adjustment, `PATCH /products/:id/stock`, seed). Tidak ada update/delete.

---

## 7. Kasus Tepi & Penanganan Error (minimal 5 per fitur)

### 7.1 CRUD gudang
1. **Kode gudang duplikat dengan gudang soft-deleted** → diizinkan (unique partial `WHERE deleted_at IS NULL`); kode lama bisa dipakai ulang setelah soft-delete.
2. **Gudang pertama dibuat** → otomatis jadi default (settings di-set); bila settings sudah terisi tapi gudangnya soft-deleted (korup) → migrasi/startup memvalidasi & fallback ke gudang aktif pertama.
3. **Soft-delete gudang yang jadi asal/tujuan transfer historis** → riwayat tetap utuh (JOIN mengambil nama gudang tanpa filter aktif; FK `ON DELETE SET NULL` hanya untuk hapus fisik yang diblokir).
4. **Gudang nonaktif sementara tapi masih punya stok besar** → stok tetap; operasional menolak pemakaian (`WAREHOUSE_INACTIVE`); admin diarahkan: aktifkan → transfer → nonaktifkan lagi.
5. **Gudang default di-soft-delete via API lama** → 409 `WAREHOUSE_IS_DEFAULT`; pesan menyebut cara: `POST /warehouses/:id/default` ke gudang lain dulu.
6. **PATCH isActive=false pada gudang default** → 409 `WAREHOUSE_IS_DEFAULT` (sama dengan soft-delete).

### 7.2 Stok per gudang
1. **Produk punya baris stok di 4 gudang** → muncul di tiap list gudang dengan qty masing-masing; `GET /reports/low-stock` (tanpa warehouseId) mengagregasi Σ.
2. **Produk tanpa baris `warehouse_stocks` di gudang X** → TIDAK muncul di list stok gudang X (bukan qty 0) — baris dibuat saat stok pertama masuk (transfer/adjustment/purchase). Catatan: seed Fase 2 membuat baris untuk semua produk di gudang pertama saja.
3. **Varian & produk non-varian bercampur** → baris terpisah; `variantName` null untuk produk non-varian; filter `q` mencakup nama varian.
4. **`lowStock=true` dengan `warehouse_stocks.min_stock = 0`** → baris tidak menipis (0 = threshold nonaktif) kecuali qty = 0 (stok habis = menipis, konsisten AC-02.2).
5. **Kasir minta `sort`/filter apa pun** → respons selalu tanpa `costPrice`; serializer tunggal di `lib/catalog` (pola Fase 2, AC-08.2).
6. **Gudang nonaktif diminta list stoknya** → boleh (manager+): stok gudang nonaktif tetap bisa dilihat & diekspor.

### 7.3 Transfer
1. **Stok asal cukup per item tapi tidak untuk semua item** → rollback total (atomic, AC-03.3); klien menerima 409 + item yang gagal; tidak ada state parsial.
2. **Transfer varian dengan qty melebihi stok varian** → 409 `STOCK_INSUFFICIENT` (details pakai `variantId`, `available` = stok varian di gudang asal).
3. **Baris `warehouse_stocks` tujuan belum ada** → upsert (insert baris baru qty = qty transfer) — jangan sampai gagal FK.
4. **Transfer qty desimal (mis. 2.5 kg)** → valid; `INVALID_QUANTITY` hanya untuk ≤ 0 / presisi > 3 desimal / bukan angka.
5. **Dua transfer bersamaan untuk produk yang sama** → baris asal dikunci `FOR UPDATE` (atau `UPDATE ... WHERE quantity >= q` atomik); satu menang, satu 409.
6. **Nomor transfer bentrok (konkurensi tinggi)** → retry `lib/sequence.ts` 1×; tetap gagal → 500 `INTERNAL` (pola TRX existing).
7. **Transfer ke gudang nonaktif** → 422 `WAREHOUSE_INACTIVE` (cek sebelum update stok).

### 7.4 Adjustment
1. **Adjustment negatif saat stok menipis (stok 2, delta −3)** → 409 `STOCK_INSUFFICIENT`; tidak ada movement parsial.
2. **Adjustment + (stok bertambah) pada gudang nonaktif** → tetap ditolak `WAREHOUSE_INACTIVE` (konsistensi: semua mutasi lewat gudang aktif).
3. **Adjustment varian** → stok varian berubah, `stock_on_hand` induk tetap 0; `reference` = adjustment id di movement.
4. **Adjustment qty desimal negatif (−0.5)** → valid; pembulatan `toQty`.
5. **Kesalahan adjustment (salah ketik qty)** → TIDAK bisa edit/hapus; koreksi = adjustment baru berlawanan arah (jejak audit utuh, §5.10).
6. **Adjustment produk `track_stock=false`** → 422 `STOCK_TRACKING_DISABLED` (jasa tanpa stok).
7. **`reason` dengan spasi/kapital** → normalisasi lowercase & trim; `'Rusak'` → valid; `'banjir'` → 422 `INVALID_REASON`.

### 7.5 Kartu stok
1. **Produk dengan 10.000+ mutasi** → pagination wajib (default 50, max 200); index `(warehouse_id, product_id, created_at)`; tanpa `productId` → 422 (anti full-scan).
2. **Mutasi transfer di kartu stok** → tampil `transfer_out`/`transfer_in` dengan `reference = TRF-...`; klik → detail transfer (link).
3. **Baris legacy (pre-Fase 3) setelah backfill** → `warehouse_id` = gudang default; `beforeQty/afterQty` kontinu dengan mutasi baru (backfill tidak mengubah qty).
4. **Void/cancel transaksi di kartu stok** → `cancellation` dengan `reference` = invoice/transaction id (pola existing).
5. **Export kartu stok CSV besar** → streamed (pola REP-05); nama file `stock-card-<code>-<sku>-YYYYMMDD.csv`.
6. **Mutasi `purchase_in` dari endpoint produk Fase 2** → muncul di kartu stok gudang default (konsisten §5.2).

### 7.6 Peringatan stok menipis
1. **Threshold berubah (min_stock naik/turun)** → laporan mengikuti tanpa cache (query live).
2. **Produk menipis di satu gudang tapi cukup total** → tanpa `warehouseId`: TIDAK muncul (Σ > min produk); dengan `warehouseId`: MUNCUL (per-gudang threshold) — dua semantik berbeda, didokumentasikan di UI ("menipis di gudang ini").
3. **Varian menipis, induk `stock_on_hand = 0`** → varian muncul sebagai baris sendiri; induk tidak muncul ganda.
4. **Gudang nonaktif dengan stok besar** → TIDAK dihitung dalam Σ produk (hanya gudang aktif) — mencegah false-positive saat gudang sedang dikosongkan.
5. **Widget dashboard saat low-stock kosong** → `meta.total = 0`, `rows = []`, UI menampilkan state "semua aman" (bukan error).
6. **Produk `track_stock=false` berubah jadi `true`** → ikut laporan sesuai threshold (Fase 2 AC-04.2 sudah mengecualikan jasa).

---

## 8. Dampak ke Modul yang Sudah Ada + Rencana Migrasi

### 8.1 Dampak per modul

| Modul / file | Dampak | Aksi wajib |
|---|---|---|
| **Checkout** (`services/checkout.service.ts`, `POST /transactions`) | sale_out kini memotong `warehouse_stocks` **gudang default** + `stock_movements.warehouse_id`; cek stok = stok gudang default (bukan total) | Update service + test regresi: angka stok total tidak berubah (Σ gudang = stock_on_hand); kasus stok cukup total tapi kurang di gudang default → 409 |
| **Return** (`services/return.service.ts`) | `return_in` balik ke gudang default + `warehouse_id` | Update service + test |
| **Void transaksi** (`POST /transactions/:id/cancel`) | `cancellation` balik ke gudang default + `warehouse_id` | Update service + test |
| **`PATCH /products/:id/stock`** (Fase 2) | Sekarang juga update `warehouse_stocks` gudang default + `warehouse_id` di movement | Update handler (backward-compatible; shortcut gudang default, §5.2) |
| **REP-03 low-stock** (`routes/reports.routes.ts`) | + query `warehouseId` (semantik per-gudang), row + `warehouseBreakdown`, varian = baris sendiri | Update query & serializer; test AC-06.1–06.3 |
| **Dashboard (M8)** | Widget stok menipis memakai `GET /reports/low-stock?perPage=10` (manager+) — **kontrak `/reports/dashboard` TIDAK berubah** | Frontend widget baru; backend tidak disentuh |
| **`lib/sequence.ts`** | Prefix baru `TRF` (pola `TRX`/`RET` existing) | Extend helper + test |
| **`lib/catalog.ts` / serializer** | Serializer stok per gudang (kasir tanpa costPrice) | Tambah serializer + test |
| **Types frontend** (`types.ts`, `types-warehouse.ts`) | `Warehouse` + `isDefault`; `StockTransfer` + `transferNumber`, `lines[]`; `StockMovement` + `warehouseId` + type `transfer_out/in` (sudah ada di `MutationType`); `WarehouseStock` + join fields (`sku`, `name`, `variantName`, `status`, `productMinStock`) | Update tipe paralel dengan API |
| **Settings (M9)** | + key `stock.default_warehouse_id` (managed via `POST /warehouses/:id/default`, bukan form settings) | Tambah seed/upsert key saat migrasi |
| **Seed Fase 2** | Tidak diubah strukturnya; invariant §3.4.1 sudah dijamin. Self-check seed Fase 2 tetap valid | Test Fase 3 menambah cek: semua movement punya `warehouse_id` (baru) |
| **Kasir UI (Fase 4)** | Menampilkan stok gudang default (label gudang di header) | Data tersedia dari `GET /warehouses` + `GET /warehouses/:id/stocks` |

### 8.2 Rencana migrasi (urutan eksekusi)

1. **DDL**: buat `apps/api/src/db/ddl-phase3.sql` (idempotent) + panggil dari `migrate.ts` setelah ddl-phase2.sql (tahap 3): ADD VALUE enum (2 statement terpisah), ADD COLUMN `warehouse_id`, backfill, index, ADD COLUMN `transfer_number`, backfill, SET NOT NULL, unique index, upsert settings default warehouse.
2. **Schema**: update `apps/api/src/db/schema.ts` (+`warehouseId` di `stockMovements`, +`transferNumber` di `stockTransfers`, +2 nilai enum `movementType`) → `drizzle-kit check` lulus.
3. **Backfill verifikasi**: `SELECT count(*) FROM stock_movements WHERE warehouse_id IS NULL` = 0; `SELECT count(*) FROM stock_transfers WHERE transfer_number IS NULL` = 0.
4. **API**: routes baru `warehouses.routes.ts`, `stock-transfers.routes.ts`, `stock-adjustments.routes.ts`; update `reports.routes.ts` (low-stock), checkout/return/void services, `PATCH /products/:id/stock`.
5. **Types**: update `types.ts` + `types-warehouse.ts`.
6. **Test**: test otomatis semua AC §2 (HTTP + query DB), jalan di CI dengan DB test terpisah; khusus: invariant Σ warehouse_stocks = stock_on_hand setelah checkout/return/void/transfer/adjustment.
7. **Rollback**: drop index baru & kolom baru (`stock_movements.warehouse_id`, `stock_transfers.transfer_number`) + drop settings key. **Catatan eksplisit:** nilai enum PostgreSQL tidak bisa di-drop; rollback penuh enum = recreate type (`CREATE TYPE ... AS ENUM` baru tanpa transfer_* → ALTER COLUMN type → DROP TYPE lama) — mahal & berisiko; **rekomendasi: biarkan 2 nilai enum ada** (harmless) dan hanya drop kolom/index. Tidak ada data Fase 1/2 yang hilang.
8. **Deploy**: Dokploy — jalankan migrasi sebelum deploy API baru; seed hanya dev/demo (`SEED_DEMO=true` guard existing).

---

## 9. Bukan-Fungsional (target waktu muat, perilaku offline, hak akses)

### 9.1 Performa (angka target — p95, LAN homelab, DB lokal; diuji dengan seed penuh 80 produk × 4 gudang)

| Operasi | Target | Catatan |
|---|---|---|
| `GET /warehouses` (list + isDefault) | < 100 ms | Tabel kecil; settings dibaca 1× |
| `GET /warehouses/:id/stocks?perPage=20` | < 200 ms | Index `(warehouse_id, product_id)` + join produk |
| `GET /warehouses/:id/stocks?lowStock=true` | < 200 ms | Partial index low-stock per gudang (atau filter qty ≤ min) |
| `POST /stock-transfers` (5 item) | < 800 ms | 1 transaksi DB; lock asal per item |
| `GET /stock-transfers?from=&to=` (grouped) | < 300 ms | Group by transfer_number via index `(transfer_number, created_at)` |
| `POST /stock-adjustments` | < 300 ms | 1 transaksi DB |
| `GET /warehouses/:id/stock-movements?productId=` (50 baris) | < 300 ms | Index `(warehouse_id, product_id, created_at)` |
| `GET /reports/low-stock` (+warehouseBreakdown) | < 250 ms | Agregasi Σ per gudang aktif |
| Export kartu stok CSV (5.000 baris) | < 2 s | Streamed |
| Respons list | < 200 KB | Tanpa detail movement di list stok |

### 9.2 Perilaku offline
- **Tidak berubah dari P0:** aplikasi online-only (keputusan BA §4.2). Tidak ada queue offline untuk transfer/adjustment.
- Kegagalan jaringan saat submit transfer/adjustment → request gagal total (HTTP error), tidak ada state parsial di server (atomic); klien menampilkan error state & menawarkan retry. Retry transfer TIDAK otomatis (menghindari duplikasi dokumen) — user memverifikasi riwayat transfer dulu.

### 9.3 Hak akses (ringkas — detail §2 & §4)

| Aksi | Kasir | Manager | Admin |
|---|---|---|---|
| Lihat gudang, stok per gudang, kartu stok (tanpa harga beli) | ✅ | ✅ | ✅ |
| CRUD gudang, set default, nonaktifkan (`isActive`) | ❌ | ✅ | ✅ |
| Soft-delete gudang (`DELETE`) | ❌ | ❌ | ✅ |
| Transfer stok, adjustment stok | ❌ | ✅ | ✅ |
| Laporan low-stock (per produk & per gudang) | ❌ | ✅ | ✅ |
| Lihat `costPrice` di stok per gudang | ❌ | ✅ | ✅ |
| Export kartu stok CSV | ❌ | ✅ | ✅ |
| Lihat audit log | ❌ | ❌ | ✅ |

### 9.4 Keamanan & integritas
- Semua endpoint mutasi: role guard + audit log (append-only): `warehouse.create/update/delete/set_default`, `stock.transfer`, `stock.adjustment`.
- Validasi body via TypeBox (pola existing): UUID format, qty bounds (`> 0` transfer, `<> 0` adjustment, ≤ 3 desimal), reason whitelist, panjang teks.
- **Jangan pernah mengembalikan `cost_price` ke role kasir** di endpoint stok per gudang atau mana pun (serializer tunggal, diuji).
- Semua update stok tetap pola atomik `UPDATE ... WHERE quantity >= qty` / `FOR UPDATE` dalam 1 transaksi DB (anti oversell, R13) — berlaku untuk sale_out (gudang default), transfer (asal), adjustment negatif.
- Kartu stok & riwayat transfer/adjustment: read-only total (tidak ada endpoint tulis yang bisa disalahgunakan).
- Nomor dokumen `TRF-...` dibentuk server (klien tidak bisa memalsukan); unique constraint + retry sequence.
