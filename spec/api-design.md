# Desain REST API — Backend Bun + Elysia (FakhriPOS)

> **Proyek:** FakhriPOS — backend Bun + Elysia (TypeScript), Drizzle ORM, PostgreSQL `db_pos`
> **Versi dokumen:** 2.0 (diselaraskan dengan `features.md` & `user-stories.md` BA)
> **Status:** final untuk implementasi backend phase berikutnya
> **Prioritas modul per BA:** M1–M9 = P0 (rilis pertama), M10 Return & M11 Audit = P1 (endpoint & skema sudah disiapkan di dokumen ini), M12 Shift = P1 (belum di desain API)

---

## 1. Konvensi Global

### 1.1 Base URL & versioning
- Semua endpoint di bawah prefix: **`/api/v1`** (BA §9).
- Homelab: `https://pos.fakhri.local/api/v1` (reverse proxy Dokploy/Traefik/Caddy).
- Konten: `application/json` selalu, kecuali export laporan (`?export=csv`) dan struk teks (`?format=text`).

### 1.2 Envelope respons seragam
> **Catatan penyelarasan:** BA §9 menuliskan `{ success, message, data }`; dokumen ini (spesifikasi teknis, mengikat) memakai **`{ ok, data, error }`** — struktur setara, satu format untuk semua endpoint. Developer backend wajib konsisten memakai format di bawah; frontend cukup membaca `ok` dan `data`/`error`.

```json
// Sukses
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "STOCK_INSUFFICIENT", "message": "Stok produk 'Kopi Arabica' tidak cukup (tersisa 2)", "details": [ { "productId": "…", "available": 2, "requested": 5 } ] } }
```

| HTTP | Arti | `error.code` umum |
|---|---|---|
| 200 / 201 | Sukses (GET/POST/PATCH) | — |
| 400 | Bad request (param/query salah) | `INVALID_PARAM` |
| 401 | Belum login / token invalid / expired | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` |
| 403 | Role tidak berhak / akun nonaktif | `FORBIDDEN`, `ACCOUNT_DISABLED` |
| 404 | Resource tidak ada (atau soft-deleted) | `NOT_FOUND`, `BARCODE_NOT_FOUND` |
| 409 | Konflik bisnis (duplikat, stok kurang, sudah dibatalkan) | `CONFLICT`, `DUPLICATE_EMAIL`, `DUPLICATE_SKU`, `DUPLICATE_BARCODE`, `STOCK_INSUFFICIENT`, `ALREADY_MEMBER`, `ALREADY_CANCELLED` |
| 422 | Validasi schema body / aturan bisnis tak terpenuhi | `VALIDATION_ERROR` (details per field), `PAYMENT_MISMATCH`, `DISCOUNT_INVALID`, `INSUFFICIENT_POINTS`, `RETURN_QTY_EXCEEDED`, `RETURN_TOO_LATE` |
| 429 | Rate limit | `RATE_LIMITED` |
| 500 | Error server (jangan bocorkan stack trace) | `INTERNAL` |

Aturan: **selalu** JSON envelope; tidak ada 204 kosong. DELETE juga balas `{ ok: true, data: { id, deleted: true } }`.

### 1.3 Pagination, sort, filter
- Query: `page` (default 1), `perPage` (default 20, max 100).
- Respons list: `data: { items: [...], meta: { page, perPage, total, totalPages } }` (offset pagination — BA §9).
- Sort: `sort=-created_at` (prefix `-` = DESC). Filter: `q` (pencarian teks), `from`/`to` (ISO 8601 + offset, inklusif; dikonversi ke timezone toko dari settings `report.timezone`).

### 1.4 Autentikasi & Role Guard
- **JWT Bearer**: header `Authorization: Bearer <accessToken>`.
- **Access token**: JWT HS256, claim `{ sub: userId, role, name, iat, exp }`, umur **30 menit**.
- **Refresh token**: random opaque string, disimpan **hash** di `user_sessions`, umur **7 hari**, rotasi tiap refresh (token lama di-revoke).
- Role guard (Elysia macro/derive — deskriptif): `mustAuth` (semua role, user aktif), `mustManager` (manager+admin), `mustAdmin`. Cek user aktif **setiap request**.
- **Rate limit login** (BA AUTH-08): maks 5 percobaan gagal beruntun per akun/IP → blokir 5 menit (429 `RATE_LIMITED`).
- Pesan error login jelas (BA AUTH-01): email/password salah → 401 `INVALID_CREDENTIALS`; akun dinonaktifkan → 403 `ACCOUNT_DISABLED`.

**Matriks hak akses** (BA §5 — mengikat):

| Area | Kasir | Manager | Admin |
|---|---|---|---|
| Login / logout / ganti password | ✅ | ✅ | ✅ |
| Transaksi POS, pembayaran, struk | ✅ | ✅ | ✅ |
| Riwayat transaksi | ✅ **hari itu saja** | ✅ semua | ✅ semua |
| Kelola produk, kategori, stok | ❌ (baca saja) | ✅ | ✅ |
| Pelanggan (tambah/pilih saat checkout) | ✅ tambah+baca | ✅ | ✅ |
| Member & poin | ✅ baca + redeem di checkout | ✅ kelola | ✅ kelola |
| Diskon manual & redeem poin | ✅ (dengan cap settings) | ✅ | ✅ |
| Laporan penjualan | ✅ (tanpa laba) | ✅ | ✅ |
| Laporan laba (HPP) / stok menipis / dashboard | ❌ | ✅ | ✅ |
| Return / refund | ✅ (dengan alasan) | ✅ | ✅ |
| Kelola pengguna & role | ❌ | ❌ | ✅ |
| Konfigurasi toko, pajak, poin | ❌ | ❌ | ✅ |
| Lihat audit log | ❌ | ❌ | ✅ |

---

## 2. Endpoint per Resource

> Format: **Method Path** — role | deskripsi | body → respons. Semua path relatif ke `/api/v1`. Uang dalam **integer rupiah** (bukan sen, bukan float).

### 2.1 Auth (public: login/refresh)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `POST /auth/login` | public | Body: `{ email, password }` → `data: { accessToken, refreshToken, user: { id, name, email, role } }`. Rate limit 5 gagal → blokir 5 mnt. Audit `user.login` + update `users.last_login_at`. 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_DISABLED` |
| `POST /auth/refresh` | public | Body: `{ refreshToken }` → token baru (rotasi; token lama di-revoke). 401 `TOKEN_EXPIRED` |
| `POST /auth/logout` | mustAuth | Body: `{ refreshToken }` → revoke session. `data: { ok: true }` |
| `GET /auth/me` | mustAuth | Profil user login → `data: { user }` |
| `POST /auth/change-password` | mustAuth | Body: `{ currentPassword, newPassword }` (min 8 char). Revoke semua session lain (BA AUTH-05) |

### 2.2 Users (admin — BA AUTH-06)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /users` | admin | List; query `q, role, isActive, page, perPage` → `{ items, meta }` (tanpa `password_hash`) |
| `POST /users` | admin | Body: `{ name, email, phone?, role, password }` → 201 `{ user }`. 409 `DUPLICATE_EMAIL`. Audit `user.create` |
| `GET /users/:id` | admin | Detail user |
| `PATCH /users/:id` | admin | Body: `{ name?, email?, phone?, role?, isActive? }` (bukan password). Audit `user.update` |
| `DELETE /users/:id` | admin | Soft delete (deactivate). Tidak boleh hapus diri sendiri. Audit `user.deactivate` |
| `POST /users/:id/reset-password` | admin | Body: `{ newPassword }`. Revoke semua session user tsb |

### 2.3 Categories (baca: kasir+; tulis: manager+)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /categories` | mustKasir | List kategori aktif (1 level) → `{ items }` |
| `POST /categories` | mustManager | Body: `{ name, slug?, sortOrder? }` → 201. 409 `DUPLICATE_SLUG` |
| `PATCH /categories/:id` | mustManager | Body parsial. Audit `category.update` |
| `DELETE /categories/:id` | admin | Soft delete; produk di kategori tsb tetap utuh (FK RESTRICT → soft delete dulu). Audit |

### 2.4 Products (baca: kasir+; tulis: manager+)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /products` | mustKasir | List; query `q` (nama via trigram), `categoryId`, `isActive`, `lowStock=true` (stok ≤ min_stock), `page, perPage, sort` → `{ items, meta }`. Item: `{ ..., stockOnHand, minStock }` |
| `GET /products/barcode/:barcode` | mustKasir | **Hot path POS** (BA PROD-04/05): cari 1 produk by barcode/SKU, aktif & tidak deleted → `{ product, stockOnHand }`. 404 `BARCODE_NOT_FOUND` |
| `GET /products/:id` | mustKasir | Detail produk |
| `POST /products` | mustManager | Body: `{ categoryId, name, sku?, barcode?, unit?, description?, costPrice, sellingPrice, minStock?, isTaxable? }` — harga **integer rupiah**. 409 `DUPLICATE_SKU`/`DUPLICATE_BARCODE`. Audit `product.create` |
| `PATCH /products/:id` | mustManager | Body parsial (harga, nama, dll). Audit `product.update` — riwayat perubahan harga via audit (BA AUDIT-01) |
| `DELETE /products/:id` | admin | Soft delete. Audit `product.delete` |
| `PATCH /products/:id/stock` | mustManager | **Adjust stok** (opname/restock, BA PROD-13). Body: `{ quantityDelta, type: 'purchase_in'\|'adjustment', reference?, note? }` — alasan wajib. Server: `FOR UPDATE` → hitung `after` → update `stock_on_hand` + insert `stock_movements` (1 transaksi DB). 409 `STOCK_INSUFFICIENT` bila `after < 0`. Audit `stock.adjustment` |
| `GET /products/:id/stock-movements` | mustManager | Riwayat ledger; query `from, to, page` → `{ items, meta }` |

### 2.5 Customers (kasir: tambah+baca; manager+: CRUD penuh)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /customers` | mustKasir | List; query `q` (nama/HP), `isMember`, `page` → `{ items, meta }` |
| `POST /customers` | mustKasir | Body: `{ name, phone?, email?, address?, notes? }` → 201. Kasir boleh buat saat checkout (BA CUST-02). 409 `DUPLICATE_PHONE` |
| `GET /customers/:id` | mustKasir | Detail + `membership?` + saldo poin (BA CUST-06) |
| `PATCH /customers/:id` | mustManager | Body parsial |
| `DELETE /customers/:id` | admin | Soft delete |
| `GET /customers/:id/transactions` | mustKasir | Histori belanja (BA CUST-03); query `from, to, page`. Kasir: dibatasi hari itu |

### 2.6 Memberships & Poin (kelola: manager+; baca: kasir+)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `POST /memberships` | mustManager | Body: `{ customerId, tier?, expiresAt? }` → 201 `{ membership }`. 409 `ALREADY_MEMBER`. Member code auto `MBR-XXXXX` |
| `GET /memberships/:id` | mustKasir | Detail: tier, saldo poin, total earned/redeemed |
| `GET /memberships/:id/points-history` | mustKasir | Riwayat `point_movements` (BA CUST-09); query `page` |
| `PATCH /memberships/:id` | mustManager | Body: `{ tier?, expiresAt? }` (tier otomatis = P1). Audit `membership.update` |

### 2.7 Discounts (promo terstruktur; tulis: admin)

> Diskon **manual kasir** (DISC-01/02) tidak lewat resource ini — dikirim langsung di body checkout (`manualDiscount` / `items[].discount`), divalidasi cap dari settings, dicatat di audit.

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /discounts` | mustManager | List; query `q, isActive, page` |
| `GET /discounts/validate?code=HEMAT10` | mustKasir | Validasi kode promo saat checkout → `{ discount, calculatedAmount }` atau 422 `DISCOUNT_INVALID` (nonaktif/expired/kuota habis) |
| `POST /discounts` | admin | Body: `{ name, code?, type: 'percentage'\|'fixed', value, scope: 'global'\|'category'\|'product', categoryId?/productId?, validFrom?, validTo?, maxDiscountAmount?, usageLimit? }` → 201 |
| `PATCH /discounts/:id` | admin | Body parsial |
| `DELETE /discounts/:id` | admin | Soft delete |

### 2.8 Tax Rates (baca: manager+; tulis: admin)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /tax-rates` | mustManager | List aktif |
| `POST /tax-rates` | admin | Body: `{ name, rate, isInclusive?, isDefault? }` |
| `PATCH /tax-rates/:id` | admin | Body parsial |
| `DELETE /tax-rates/:id` | admin | Soft deactivate (`isActive=false`) — jangan hapus fisik |

### 2.9 Transactions (POS — M3, P0)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `POST /transactions/preview` | mustKasir | **Pra-hitung tanpa commit**. Body sama dengan checkout minus `payments` → `data: { subtotal, discountTotal, taxTotal, total, pointsEarned, redeemablePoints, items: [{ productId, name, quantity, unitPrice, lineTotal, availableStock }] }`. 422 `STOCK_INSUFFICIENT`/`DISCOUNT_INVALID`/`INSUFFICIENT_POINTS`/`DISCOUNT_CAP_EXCEEDED` |
| `POST /transactions` | mustKasir | **Checkout (commit)** — lihat §3 alur lengkap. Wajib header `Idempotency-Key` (dedupe 5 mnt). Body: `{ customerId?, items: [{ productId, quantity, discount?: { type, value, reason? } }], manualDiscount?: { type: 'percentage'\|'fixed', value, reason? }, discountCode?, redeemPoints?, payments: [{ method: 'cash'\|'qris'\|'transfer', amount, cashReceived? }], notes? }` → 201 `{ transaction, items, payments, receipt, pointsEarned }`. Aturan: Σ amount payments = total (kecuali cash boleh lebih → `changeAmount`); diskon manual kasir dibatasi cap settings `discount.manual_max_percent`/`manual_max_amount`. 409 `STOCK_INSUFFICIENT`, 422 `PAYMENT_MISMATCH`, `DISCOUNT_CAP_EXCEEDED` |
| `GET /transactions` | kasir: **hari itu saja**; manager+: semua | List; query `from, to, status, customerId, userId, q (nomor), page, perPage` → `{ items, meta }`. Kasir dipaksa filter `sold_at` = hari ini (WIB) di server — BA §5 |
| `GET /transactions/:id` | kasir: hari itu saja; manager+: semua | Detail: header + items + payments + returnSummary |
| `GET /transactions/:id/receipt` | kasir: hari itu saja; manager+: semua | Data struk (BA POS-05): `{ transaction, items, payments, store: { name, address, phone, footer } }`; `?format=text` → struk teks 40 kolom untuk browser print/PDF (BA §4.9) |
| `POST /transactions/:id/cancel` | mustManager | **Void** (BA POS-10, P1 — endpoint siap). Body: `{ reason }` wajib. Efek (1 transaksi DB): status `cancelled`, stok dikembalikan (movement `cancellation`), poin dibalik, pembayaran diganti baris `payments` type=refund, audit `transaction.cancel`. 409 `ALREADY_CANCELLED` |
| `POST /transactions/:id/payments` | mustKasir | Pembayaran tambahan (transaksi partial, P1 — BA PAY-07). Body: `{ method, amount, cashReceived?, referenceNumber? }` |

### 2.10 Returns (M10 — P1 di BA, endpoint sudah disiapkan)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `POST /returns` | mustKasir | Body: `{ transactionId, items: [{ transactionItemId, quantity, reason }] /* reason wajib (RET-04) */, refundMethod: 'cash'\|'qris'\|'transfer'\|'points', notes? }` → 201 `{ return, items, refundPayment? }`. Validasi: qty ≤ qty asli − `returned_quantity` (422 `RETURN_QTY_EXCEEDED`); transaksi ≤ `return.max_days` hari (default 7, 422 `RETURN_TOO_LATE`); transaksi asal completed. Efek (1 transaksi DB): insert return + items, update `returned_quantity`, restock (movement `return_in`), baris `payments` type=refund (atau kredit poin bila `refundMethod='points'`), poin dibalik proporsional, audit `return.create` |
| `GET /returns` | kasir: sendiri; manager+: semua | List; query `from, to, transactionId, page` |
| `GET /returns/:id` | mustKasir | Detail return + items + refund payment |

### 2.11 Reports (M7, P0 — akses per BA §5)

Semua endpoint laporan mendukung `?export=csv` (BA REP-05) → `Content-Type: text/csv; charset=utf-8` + BOM (kompatibel Excel/Google Sheets). Rentang `from`/`to` wajib (max 366 hari).

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /reports/sales-daily?from&to` | mustKasir (tanpa laba); manager+ | `data: { rows: [{ date, revenue, transactionCount, itemsSold, avgPerTransaction, paymentBreakdown: { cash, qris, transfer } }] }` (BA REP-01) |
| `GET /reports/profit?from&to&groupBy=day\|product` | mustManager | Laba kotor = Σ(qty × (harga_jual − harga_beli)) − diskon, dari snapshot `transaction_items` (BA REP-02, §4.8) |
| `GET /reports/low-stock?threshold` | mustManager | Produk stok ≤ threshold (default dari settings), urut paling menipis, **termasuk stok 0** (BA REP-03) |
| `GET /reports/top-products?from&to&limit=10` | mustKasir (tanpa laba); manager+ | Top 10 by qty & by revenue (BA REP-04) |
| `GET /reports/payment-methods?from&to` | mustKasir | Σ per metode (cash/qris/transfer) + refund total (BA REP-01 breakdown) |
| `GET /reports/dashboard` | mustManager | **Dashboard** (BA DASH-01/02/03): `{ todayRevenue, todayTransactions, todayItemsSold, avgPerTransaction, topProductsToday: [...], recentTransactions: [10], lowStockCount, salesLast7Days: [{ date, revenue }], paymentMethodsToday }` |
| `GET /reports/returns?from&to` | mustManager | Ringkasan return (BA REP-07, P1) |

### 2.12 Audit Logs (M11 — P1, admin only — BA AUDIT-02/03)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /audit-logs` | admin | Query: `action, entityType, entityId, userId, from, to, page, perPage` → `{ items, meta }`. Append-only (tidak ada endpoint update/delete) |

### 2.13 Settings (M9, P0)

| Method & Path | Role | Deskripsi |
|---|---|---|
| `GET /settings` | mustKasir | Semua key publik (profil toko untuk struk, aturan poin, threshold, timezone) → `{ settings }` |
| `PATCH /settings` | admin | Body: `{ settings: [{ key, value }] }` (upsert). Audit `settings.update` |

---

## 3. Alur Checkout (urutan panggilan + transaksi DB)

**Keputusan desain:** keranjang (cart) **hidup di frontend** (state + localStorage) — tidak ada cart server-side; cukup untuk toko tunggal (BA §4: single outlet). Server **menghitung ulang semua angka** saat checkout — angka dari klien hanya dipakai sebagai referensi, bukan kebenaran.

### 3.1 Urutan dari sisi klien (kasir)

1. **Scan/lookup produk** → `GET /products/barcode/:barcode` (atau `GET /products?q=...` + pilih). Item masuk keranjang lokal: `{ productId, name, unitPrice, quantity }`. (BA POS-01/02, US-05)
2. **Pilih pelanggan** (opsional) → `GET /customers?q=...` atau `POST /customers` untuk walk-in baru (BA CUST-02, US-15).
3. **Terapkan diskon/poin** (opsional): diskon manual per item / per transaksi, atau kode promo via `GET /discounts/validate?code=`, atau `redeemPoints` dari saldo member (BA DISC-01/02, CUST-05).
4. **Pra-hitung** → `POST /transactions/preview` — kasir melihat subtotal, diskon, PPN, total, poin sebelum minta bayar; tombol "Bayar" di-enable.
5. **Commit checkout** → `POST /transactions` dengan header `Idempotency-Key` (BA POS-03, US-08).
6. **Cetak struk** dari `data.receipt` pada respons checkout (tanpa request tambahan); reprint via `GET /transactions/:id/receipt` (BA POS-05, US-10).

### 3.2 Yang terjadi di server pada `POST /transactions` — SATU transaksi database

Semua langkah di bawah berjalan dalam **satu transaksi DB** (Drizzle `db.transaction`); error apa pun → `ROLLBACK` + respons error dengan kode spesifik (BA §9: "Gagal di tengah → rollback semua"):

```
BEGIN
 1. SELECT ... FOR UPDATE products (semua productId di body, urut id — cegah deadlock & oversell)
 2. Validasi stok (qty ≤ stock_on_hand) → 409 STOCK_INSUFFICIENT (detail per produk)
 3. Re-hitung harga dari DB: unitPrice = selling_price saat ini (tidak menerima harga dari klien)
 4. Terapkan diskon: manual (per item & transaksi, cek cap settings) dan/atau promo code
    (cek aktif/periode/kuota → increment used_count)
 5. Validasi redeem poin (bila ada) → cek saldo member, hitung redeemed_points_value
 6. Hitung: subtotal, discount_total, tax_total (per baris, round half-up — §8.4 db-schema), total
 7. INSERT transactions (status=completed, payment_status=paid/partial, snapshot diskon, poin)
 8. INSERT transaction_items × N (snapshot product_name, sku, unit_price, cost_price)
 9. INSERT payments (validasi Σamount = total; cash → hitung change_amount)
10. UPDATE products.stock_on_hand (after = before − qty) + INSERT stock_movements (sale_out)
11. Member: UPDATE memberships.points_balance + INSERT point_movements (earned / redeemed)
12. INSERT audit_logs (action=transaction.checkout, entity_id=transaction.id,
    new_values={ total, itemCount, paymentMethods, discounts: [...] })
COMMIT
```

**Mengapa satu transaksi DB?** Konsistensi finansial: tidak mungkin transaksi tanpa item, stok terpotong tanpa transaksi, atau poin ter-accrue tanpa penjualan. `FOR UPDATE` mencegah oversell saat 2 kasir checkout bersamaan; `Idempotency-Key` mencegah double-submit tombol "Bayar".

### 3.3 Alur Return (ringkas — M10, P1)

```
POST /returns → 1 transaksi DB:
 1. Validasi transaksi asal (completed, bukan cancelled) & umur ≤ return.max_days (default 7)
 2. Validasi tiap item: qty ≤ qty asli − returned_quantity → 422 RETURN_QTY_EXCEEDED; reason wajib
 3. INSERT returns + return_items (snapshot harga, subtotal = unit_price × qty)
 4. UPDATE transaction_items.returned_quantity
 5. UPDATE products.stock_on_hand (+qty) + INSERT stock_movements (return_in) — RET-02
 6. INSERT payments (type=refund, method=refundMethod) → returns.refund_payment_id,
    ATAU kredit poin bila refundMethod='points' (RET-03)
 7. Balik poin proporsional: UPDATE memberships + INSERT point_movements (adjustment)
 8. INSERT audit_logs (return.create)
COMMIT
```

---

## 4. Keamanan & Performansi

- **Password**: Argon2id (rekomendasi); jangan pernah log password/hash/token.
- **JWT secret** dari env (`JWT_SECRET`), dukung rotasi via claim `kid`.
- **Validasi**: semua body lewat schema Elysia/TypeBox (length, enum, range, format email) → 422 `VALIDATION_ERROR` + `details` per field. Jangan pernah trust klien untuk harga/status/qty.
- **SQL injection**: semua query via Drizzle (parameterized). Jangan string-concat SQL.
- **CORS**: allow origin frontend Next.js (`https://pos.fakhri.local`).
- **Rate limit**: `auth/login` 5 gagal → blokir 5 mnt (BA AUTH-08); `POST /transactions` 30/mnt/user; sisanya 120/mnt/user.
- **Audit** (BA AUDIT-01): tulis `audit_logs` untuk login/logout, CRUD produk & perubahan harga, diskon (terutama manual — siapa/kapan/berapa), void, return, CRUD pengguna, perubahan pengaturan. Append-only.
- **Pagination default** 20, max 100; laporan wajib rentang `from`/`to` (max 366 hari).
- **Timezone**: grouping laporan pakai `report.timezone` (default `Asia/Jakarta`) via `AT TIME ZONE` — indeks `sold_at` tetap terpakai.

## 5. Catatan Implementasi Elysia (deskriptif)

- Struktur: satu instance Elysia di `src/index.ts`; plugin per resource (`auth.plugin.ts`, `products.plugin.ts`, `transactions.plugin.ts`, …) di-`group('/api/v1')`.
- Guard via `derive`/`macro`: `mustAuth`, `mustManager`, `mustAdmin` — diterapkan per route.
- Validasi: schema `t.Object(...)` per route; error handler global (`onError`) memetakan error TypeBox + error bisnis ke envelope `{ ok, error }`.
- Error bisnis: custom `AppError(code, message, details?, httpStatus)` — satu titik format envelope.
- OpenAPI: dekorator `response` Elysia → `/api/v1/openapi` + Swagger UI (dev) otomatis.
