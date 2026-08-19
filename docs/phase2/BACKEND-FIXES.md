# BACKEND-FIXES — QA Report Fase 2 (5 bug)

Tanggal: 19 Agustus 2026
Cakupan: `apps/api` (Bun + Elysia + Drizzle)
Status: **5/5 diperbaiki & terverifikasi E2E** (37/37 cek lulus di dev DB + `bun run typecheck` exit 0 + `bun test` 63 pass)

---

## 1. POST /products — stockOnHand=0 jadi 128 di DB

**File**: `apps/api/src/routes/products.routes.ts` (POST `/products`)

- **Akar masalah**: Nilai `stockOnHand` dari body create tidak ditangani eksplisit; risiko stok ikut nilai body/seed lama.
- **Fix**:
  - Insert produk baru sekarang **selalu `stockOnHand: 0`** (dipaksa, dengan komentar invariant).
  - `productBodySchema` kini **menerima field `stockOnHand` eksplisit** (min 0) — frontend mengirim `0` tidak lagi lewat jalur tak dikenal, dan nilai apa pun yang dikirim **diabaikan** (stok produk baru = 0; penyesuaian hanya via `PATCH /products/:id/stock`).
- **Cek seed script**: `seed.ts` sudah benar (`stockOnHand: hasVariants ? 0 : toQty(p.stock)`); angka 128 di seed hanyalah **harga** (Beras Medium 10kg `price: 128000`), bukan stok — tidak ada sumber 128 di jalur create.
- **Verifikasi E2E**: create dengan `stockOnHand: 0` → DB 0; create dengan `stockOnHand: 128` → DB tetap 0.

## 2. PATCH /products/:id/stock — 409 / stok tidak sinkron dengan warehouse_stocks

**File**: `apps/api/src/routes/products.routes.ts` (PATCH `/products/:id/stock`)

- **Akar masalah**: Endpoint hanya meng-update `products.stock_on_hand`, melanggar invariant seed (SPEC §3.7, AC-07.3): `Σ warehouse_stocks = stock_on_hand`.
- **Fix**: Helper baru `syncWarehouseStocks(tx, productId, delta, after, minStock)` dipanggil **dalam transaksi yang sama** (atomic):
  - Produk **sudah punya baris** `warehouse_stocks` → delta positif ditambahkan (prioritas baris qty terbesar), delta negatif dikurangi dari baris-baris (tidak boleh negatif).
  - Produk **tanpa baris** (produk baru) → baris baru dibuat di gudang default **GUD-PUSAT** (qty = stok akhir), sehingga invariant tetap terjaga.
  - Perilaku lama dipertahankan: stok kurang → `409 STOCK_INSUFFICIENT` dengan detail `available/requested`.
- **Verifikasi E2E**: +10 pada produk baru → `products.stock_on_hand=10` DAN baris GUD-PUSAT `qty=10`; lalu -4 → keduanya 6; stok kurang → 409.

## 3. POST/PATCH /products — expiryDate ISO 8601 (dengan T) ditolak

**File**: `apps/api/src/lib/import-export.ts` (`parseDateCell`) + pesan error di `products.routes.ts` & `parseWorkbook`

- **Akar masalah**: `parseDateCell` hanya menerima `YYYY-MM-DD`; frontend mengirim `2026-12-31T00:00:00Z` → 422.
- **Fix**: `parseDateCell` kini menerima **dua format**:
  1. `YYYY-MM-DD` (validasi ketat: `2026-02-31` tetap invalid),
  2. **ISO 8601 dengan T** (`2026-12-31T00:00:00Z`, `...T07:30:00+07:00`, dst).
  - Nilai balik selalu `YYYY-MM-DD` (kolom DATE). Komponen tanggal diambil **sebagaimana ditulis klien** (bukan konversi UTC) — menghindari `2026-01-01T00:00:00+07:00` berubah jadi `2025-12-31`.
  - Pesan error diperbarui: "expiryDate harus format YYYY-MM-DD **atau ISO 8601**".
  - Berlaku juga untuk kolom `expiry_date` di import Excel (fungsi sama).
- **Verifikasi E2E**: POST & PATCH dengan ISO → 201/200 & tersimpan `2026-12-31`; `31-12-2026` tetap 422. Unit test baru di `tests/import-export.test.ts`.

## 4. POST /products/import — parsial harus 207, bukan 200/201

**File**: `apps/api/src/routes/products.routes.ts` (POST `/products/import`)

- **Akar masalah**: Import `partial=true` dengan baris gagal tetap return 200/201 — tidak ada sinyal parsial.
- **Fix**: Bila `partial=true` **dan** ada baris gagal → **`207 Multi-Status`** dengan struktur persis QA:
  ```json
  {
    "ok": false,
    "error": { "code": "IMPORT_PARTIAL", "message": "2 berhasil, 1 gagal" },
    "details": { "imported": 2, "failed": 1, "errors": [ { "rowNumber": 4, "column": "harga_jual", "message": "..." } ], "rows": [...] }
  }
  ```
  - `imported` = inserted + updated; `errors` = semua error baris (file-level + DB-level).
  - Perilaku lain tidak berubah: semua valid → 201; `partial=false` + ada error → 422 (tidak ada yang tersimpan).
- **Verifikasi E2E**: workbook 2 valid + 1 invalid (`harga_jual` kosong) → 207, `ok:false`, `code:IMPORT_PARTIAL`, `imported:2/failed:1`, baris valid tersimpan, baris gagal tidak tersimpan; `partial=false` → 422.

## 5. DELETE /product-variants/:id — stok varian hilang (30 unit raib)

**File**: `apps/api/src/routes/product-variants.routes.ts` (DELETE `/product-variants/:id`)

- **Akar masalah**: Stok varian hanya dipindah ke induk bila varian **terakhir** yang dihapus; hapus 1 dari beberapa varian → stok varian (mis. 30) hilang dari total, movement dicatat tapi stok induk tidak bertambah.
- **Fix**: Setiap soft-delete varian (bukan hanya varian terakhir):
  - `product.stock_on_hand += variant.stock_on_hand` (dengan `FOR UPDATE` pada induk),
  - `variant.stock_on_hand = 0`, `variant.deleted_at = now`, `is_active = false`,
  - Ledger: movement `adjustment` di varian (30 → 0) **dan** movement di induk `adjustment` (+30, note `Transfer stok dari varian '<nama>' ke induk saat hapus varian`),
  - **warehouse_stocks**: baris stok gudang varian dipindah ke baris induk di gudang yang sama (helper `transferVariantWarehouseStock`) — invariant Σ gudang tetap terjaga.
  - Varian terakhir dihapus → `has_variants=false` (perilaku lama dipertahankan).
- **Verifikasi E2E**: varian stok 30 + baris gudang 30 → hapus → induk `stock_on_hand=30`, varian soft-deleted stok 0, movement transfer ada, baris warehouse varian hilang & induk `qty=30`, `has_variants=false`.

---

## File yang diubah

| File | Perubahan |
|---|---|
| `apps/api/src/routes/products.routes.ts` | Bug 1 (stock 0 eksplisit + schema), Bug 2 (`syncWarehouseStocks`), Bug 3 (pesan error), Bug 4 (207 IMPORT_PARTIAL) |
| `apps/api/src/lib/import-export.ts` | Bug 3 (`parseDateCell` terima ISO 8601) + pesan error import |
| `apps/api/src/routes/product-variants.routes.ts` | Bug 5 (transfer stok ke induk + warehouse) + header doc |
| `apps/api/tests/import-export.test.ts` | Unit test baru: ISO 8601 diterima, tanggal mustahil tetap ditolak |

## Verifikasi

- `bun run typecheck` → **exit 0**
- `bun test tests/` → **63 pass, 0 fail** (termasuk test ISO baru)
- E2E manual (API dev :3299 + PGlite dev DB, data test di-cleanup): **37/37 pass** — semua 5 bug direproduksi-dan-lulus
