# SPEC — Fase 7: Offline / PWA

> **Proyek:** FakhriPOS — POS (Bun + Elysia + Drizzle ORM, Next.js + shadcn/ui, PostgreSQL `db_pos`)
> **Peran penulis:** System Analyst — output dari konteks Fase 2–6 & praktik offline POS UMKM (Pawoon, Olsera, majoo)
> **Tanggal:** 20 Agustus 2026
> **Status:** mengikat untuk developer (backend + frontend) Fase 7
> **Referensi:** `spec/features.md`, `spec/db-schema.md`, `spec/api-design.md`, `docs/phase2/SPEC.md`, `docs/phase4/SPEC.md`, `docs/phase6/SPEC.md`, `apps/api/src/db/schema.ts` (+ `ddl-phase2..5.sql`), `apps/api/src/routes/transactions.routes.ts` (Idempotency-Key), `apps/api/src/lib/sequence.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth-storage.ts`

**Notasi prioritas:** P0 = wajib Fase 7 ini · P1-late = setelah Fase 7 (disebut sebagai catatan, TIDAK dikerjakan Fase 7).
Semua angka uang = **integer rupiah** (BIGINT). Semua qty = **NUMERIC(12,3)**. Semua waktu = **TIMESTAMPTZ** UTC, tampilan WIB. Semua ID = UUID.

**Catatan penting hasil audit repo (per 20-Agustus-2026):** Kontrak fase menyebut "PWA setup sudah ada di `next.config.js`". **Audit menemukan `apps/web/next.config.ts` TIDAK memuat plugin PWA apa pun** (tidak ada `serwist`, `next-pwa`, `workbox`), dan **tidak ada** `manifest.webmanifest`, icon maskable, maupun service worker di `apps/web`. Karena itu Fase 7 **wajib mencakup pendirian tooling PWA itu sendiri** (F7-1), bukan hanya mengisi fitur di atas setup yang sudah ada. Tim dev harus memverifikasi kembali sebelum coding; jika setup sudah ditambahkan sejak audit ini, F7-1 dikurangi menjadi sekadar "cek & lengkapi".

---

## 1. Lingkup — masuk apa, TIDAK masuk apa

### 1.1 MASUK (Fase 7: Offline / PWA)

| # | Fitur | Catatan lingkup |
|---|---|---|
| F7-1 | **Tooling PWA & manifes** | Pasang `@serwist/next` (atau setara: `next-pwa`), konfigurasi `next.config.ts`, `manifest.webmanifest` (name, short_name, icons maskable 192/512, theme_color, display `standalone`, start_url `/`, id), meta viewport `viewport-fit=cover`. Hosting wajib HTTPS/statis. |
| F7-2 | **Registrasi SW + deteksi offline** | Registrasi SW di `layout.tsx` (production-only), listener `online`/`offline`, banner status koneksi, hook `useOnline()`, API client paham `navigator.onLine`. SW: **Network-first untuk API, Cache-first untuk aset statis/shell**. |
| F7-3 | **IndexedDB: cache produk + harga (+ varian & satuan)** | Tabel IDB `products` (snapshot harga jual + stok + varian + satuan) agar kasir tetap scan/jual saat offline. Disinkronkan saat online (pull). |
| F7-4 | **IndexedDB: antrean transaksi offline** | Tabel IDB `offline_orders` berisi draft transaksi lengkap (items, payments, discount). Ditandai `queued`, lalu disinkronkan. |
| F7-5 | **Background Sync: transaksi offline** | `sync.registration` saat online → POST ke server memakai `Idempotency-Key` (= `clientTxId`) → update status → struk final. Konflik stok ditangani eksplisit. |
| F7-6 | **UI status & riwayat sinkronisasi** | Panel "Antrean Sinkron" (jumlah antrean, status per item: queued/syncing/done/conflict), aksi retry manual, badge offline di header. |
| F7-7 | **Settings offline** | Key `offline.enabled`, `offline.auto_sync`, `offline.sync_mode` (manual/auto), `offline.stale_after_days`. |

### 1.2 TIDAK MASUK (sengaja, dengan catatan)

| Tidak masuk | Alasan / penanganan |
|---|---|
| **Sinkronisasi offline untuk master selain produk** (pelanggan, supplier, diskon, gudang) | P0 dictum: hanya produk+harga+transaksi. Pelanggan dipilih dari cache produk saat checkout; buat pelanggan baru saat offline = P1-late. |
| **Offline untuk shift management & pembukaan shift** | Shift tetap butuh server (validasi kasir & counter invoice). Saat offline, kasir TIDAK bisa buka shift baru; pembukaan/pemilihan shift dilakukan saat online. (Catatan §6.) |
| **Sinkronisasi dua arah penuh / CRDT / conflict resolution server-side** | Di luar lingkup. Fase 7 memakai **last-write-wins server + deteksi konflik stok**. |
| **Push notification / Web Push** | Di luar lingkup Fase 7 (tidak berhubungan). |
| **Offline untuk laporan / dashboard / pengaturan** | Hanya lihat data yang sudah ada di cache-shell; tidak sinkron laporan. |
| **Instalasi otomatis tanpa persetujuan** | `beforeinstallprompt` tetap butuh interaksi pengguna (best practice). |
| **Multi-perangkat sinkronisasi real-time (WebSocket/localStorage conflict)** | Single-browser offline-queue. |

---

## 2. User Story + Kriteria Penerimaan (Given/When/Then)

### US-01 — Install & Manifes PWA
Sebagai **pemilik toko**, saya bisa memasang FakhriPOS ke layar utama HP/desktop seperti aplikasi native, agar saya bisa membukanya tanpa mengetik URL.
- AC-01.1: **Given** situs dibuka via HTTPS, **When** halaman dimuat, **Then** `beforeinstallprompt` tersedia, dan tombol "Pasang Aplikasi" muncul di Pengaturan / banner.
- AC-01.2: **Given** pengguna menyetujui prompt, **When** diinstal, **Then** aplikasi terbuka dalam mode `standalone` penuh layar dengan `start_url=/`, tanpa tab browser.
- AC-01.3: **Given** `manifest.webmanifest` dimuat, **When** diperiksa, **Then** berisi `name`, `short_name`, `start_url`, `display=standalone`, `theme_color`, dan icon 192px + 512px (termasuk `purpose: maskable`).
- AC-01.4: **Given** halaman dimuat sekali (online), **When** browser dimatikan lalu dibuka offline, **Then** aplikasi (shell) tetap terbuka dari cache.

### US-02 — Deteksi offline & banner
Sebagai **kasir**, saya ingin tahu jelas saat koneksi putus, agar saya tidak menyangka transaksi online padahal offline.
- AC-02.1: **Given** koneksi normal, **When** jaringan putus, **Then** dalam < 2 detik muncul banner/badge "Offline — transaksi akan disimpan lalu disinkronkan", dan hook `useOnline()` bernilai `false`.
- AC-02.2: **When** koneksi pulih, **Then** banner hilang otomatis dalam < 2 detik dan `useOnline()` bernilai `true`.
- AC-02.3: **Given** transaksi dibuat saat offline, **When** halaman direfresh saat masih offline, **Then** transaksi tersebut TIDAK hilang (tetap di IndexedDB).

### US-03 — Stok produk tersedia offline
Sebagai **kasir**, saya bisa scan/lihat harga & stok produk saat koneksi putus, agar jualan tetap jalan.
- AC-03.1: **Given** aplikasi pernah online (produk ter-pull), **When** jaringan putus, **Then** pencarian produk & scan barcode bekerja dari IndexedDB dengan harga & stok snapshot terakhir.
- AC-03.2: **Given** produk diubah harganya di server, **When** perangkat kembali online & sinkronisasi berjalan, **Then** harga di IndexedDB diperbarui (stale data diganti).
- AC-03.3: **Given** cache produk kosong dan perangkat offline, **When** kasir mencoba cari produk, **Then** tampil pesan "Data produk tidak tersedia. Sambungkan ke internet untuk memuat katalog."

### US-04 — Transaksi offline (antrean)
Sebagai **kasir**, saya bisa menyelesaikan penjualan saat offline, dan transaksinya otomatis masuk laporan saat online.
- AC-04.1: **Given** perangkat offline, **When** kasir checkout dengan pembayaran cash/qris, **Then** buat baris `offline_orders` status `queued`, struk sementara ditampilkan, dan TIDAK ada transaksi yang masuk DB server.
- AC-04.2: **Given** transaksi offline tersimpan, **When** perangkat online & background sync berjalan, **Then** tiap baris di-POST ke server dengan `Idempotency-Key` unik per transaksi; status menjadi `done`; server mengembalikan id & invoice number final.
- AC-04.3: **Given** dua perangkat menyimpan transaksi offline yang sama (kasus tepi), **When** keduanya sync, **Then** Idempotency-Key mencegah duplikat (server mengembalikan transaksi yang sama, bukan membuat baru).
- AC-04.4: **Given** transaksi offline dengan stok yang habis di server (konflik), **When** sync, **Then** transaksi ditandai `conflict` dengan pesan "Stok produk X tidak cukup", baris TIDAK dihapus, dan kasir bisa mengedit/retry.
- AC-04.5: **Given** transaksi sync gagal karena jaringan/5xx, **When** retry manual dilakukan, **Then** transaksi tidak terduplikasi (aman karena Idempotency-Key).

### US-05 — Panel status sinkronisasi
Sebagai **pemilik toko**, saya bisa melihat berapa transaksi offline yang belum masuk, agar saya yakin tidak ada penjualan yang hilang.
- AC-05.1: **Given** ada transaksi offline, **When** saya membuka panel "Antrean Sinkron", **Then** tampil daftar: jumlah, invoice sementara, total, status (queued/syncing/done/conflict), dan tombol "Sinkronkan Sekarang".
- AC-05.2: **When** ada item `conflict`, **Then** panel menampilkan alasan & tombol "Periksa" yang membuka detail agar kasir bisa ubah qty/hapus/retry.
- AC-05.3: **Given** semua transaksi tersinkron, **When** panel dibuka, **Then** tampil "Semua tersinkron."

### US-06 — Settings offline
Sebagai **admin**, saya bisa mengaktifkan/menonaktifkan mode offline & memilih sinkronisasi otomatis/manual.
- AC-06.1: **Given** admin di halaman Pengaturan, **When** toggle "Mode Offline" diubah, **Then** tersimpan ke `settings['offline.enabled']` dan efeknya tercatat di audit log.
- AC-06.2: **Given** `sync_mode=manual`, **When** perangkat online, **Then** transaksi offline TIDAK otomatis sync; hanya sync saat tombol ditekan atau aplikasi dibuka.
- AC-06.3: **Given** `sync_mode=auto`, **When** koneksi pulih, **Then** background sync otomatis menjalankan antrean.

### US-07 — Background Sync saat pulih
Sebagai **kasir**, saya tidak perlu menekan tombol apa pun saat koneksi pulih; transaksi tertunda tersinkron tanpa gangguan.
- AC-07.1: **Given** ada antrean offline & `sync_mode=auto`, **When** koneksi berlangsung (event `online` / sync event SW), **Then** antrean dikirim berurutan (FIFO) dan status UI diperbarui otomatis.
- AC-07.2: **Given** background sync tidak didukung browser, **When** koneksi pulih, **Then** fallback: sync manual saat tab dibuka (dipakai sebagai cadangan).

---

## 3. Model Data

### 3.1 IndexedDB (client-side) — struktur

Database: `fakhripos-idb` (versi 1). Object store & index:

**Store `products`** (keyPath `id`)
| Field | Tipe | Keterangan |
|---|---|---|
| id | string (UUID) | PK = product id |
| sku / barcode | string? | untuk pencarian & scan |
| name | string | |
| categoryName | string | |
| unit | string | unit dasar |
| sellingPrice | BIGINT | integer rupiah (snapshot) |
| trackStock | boolean | |
| stockOnHand | NUMERIC(12,3) | snapshot stok |
| variants | array | `[{ id, name, sku, barcode, sellingPrice, stockOnHand }]` |
| units | array | `[{ unit, factor, sellPrice, isSellable }]` |
| updatedAt | timestamp | versi untuk stale-check |
| Index: `by_sku_barcode`, `by_name` |

**Store `offline_orders`** (keyPath `clientTxId`)
| Field | Tipe | Keterangan |
|---|---|---|
| clientTxId | string (ULID/UUID) | PK klien; dipakai sebagai Idempotency-Key |
| status | enum | `queued` / `syncing` / `done` / `conflict` |
| createdAt | timestamp (UTC) | |
| shiftId? | string | shift tempat transaksi dibuat (bila ada) |
| items | array | `[{ productId, variantId?, unit, unitFactor?, quantity, unitPrice, discount? }]` |
| subtotal / discountTotal / taxTotal / total | BIGINT | |
| payments | array | `[{ method, amount, paidAt? }]` |
| customerId? / pointsRedeemed? | string / BIGINT | opsional |
| serverResponse? | object | hasil POST (id, invoiceNumber) saat done |
| conflictMessage? | string | isi pesan konflik |
| syncAttempts | number | jumlah percobaan |
| Index: `by_status`, `by_created` |

**Store `sync_state`** (keyPath `key`)
- `products.lastSyncedAt` (timestamp), `products.hash/version` — memori stamp.
- `queue.version` (monotonic).

**TIDAK ada tabel DB server baru untuk Phase 7.** Semua ketahanan offline ada di IndexedDB. Server hanya menerima POST dengan Idempotency-Key yang sudah didukung (Fase 4).

### 3.2 Settings baru (tabel `settings` existing)

| Key | Tipe | Default | Deskripsi |
|---|---|---|---|
| `offline.enabled` | boolean | true | Mode offline aktif |
| `offline.auto_sync` | boolean | true | Background sync otomatis saat online |
| `offline.sync_mode` | string (`auto`/`manual`) | `auto` | Cara sinkronisasi |
| `offline.stale_after_days` | number | 14 | Cache produk dianggap basi setelah N hari tanpa sync (untuk validasi) |

**Catatan:** `offline.enabled=false` → SW TIDAK meng-cache katalog; kasir wajib online. Pengaturan disimpan di settings (server) karena mengikat per-akun & tampil di audit.

---

## 4. Kontrak API

### 4.1 Endpoint pull katalog (untuk caching offline)

| Method & Path | Role | Request | Response | Keterangan |
|---|---|---|---|---|
| `GET /sync/catalog` | kasir+ | `?since=<ISO timestamp>` (opsional; delta) | `{ items: [...produk aktif + varian + satuan + harga], deletedIds: [], serverTime: <ISO> }` | Payload ringkas untuk isi IndexedDB. Delta sejak `since`; bila tidak ada `since` → full snapshot. Kasir tanpa `costPrice`. |
| `GET /sync/state` | kasir+ | — | `{ catalogVersion, serverTime }` | Stamp untuk cek stale (bandingkan dengan `lastSyncedAt`). |

**Aturan:** endpoint baru `GET /sync/catalog` adalah **satu-satunya** jalur pull katalog untuk offline (bukan `GET /products`). Frontend memanggil ini saat online, menyimpan ke IDB. Ukuran minimal: field yang dipakai kasir saja (id, sku, barcode, name, categoryName, unit, sellingPrice, trackStock, stockOnHand, variants[], units[]).

### 4.2 Sinkronisasi transaksi (reuse existing POST, ditambah header idempotency)

TIDAK ada endpoint baru untuk kirim transaksi. Frontend memanggil `POST /transactions` (existing, Fase 4) memakai:
- Header `Idempotency-Key: <clientTxId>` (sudah wajib di Fase 4 — dipakai sebagai kunci anti-duplikat).
- Body item: `[{ productId, variantId?, unit, quantity, discount? }]` + `payments: [{ method, amount }]`.

Respons existing `{ transaction: { id, invoiceNumber, ... } }` dijadikan `serverResponse` di store `offline_orders` saat `done`.

### 4.3 Sinkronisasi status (konflik & hasil)

| Method & Path | Role | Request | Response | Keterangan |
|---|---|---|---|---|
| `GET /sync/orders` | kasir+ | — | `{ orders: [{ clientTxId, status, message?, transactionId?, invoiceNumber? }] }` | Query server untuk mencocokkan status antrean (opsional; utk recovery crash). Dapat dihilangkan bila idempotency cukup. |

**Catatan implementasi:** recovery lewat `GET /sync/orders` bersifat opsional (P1). Skema utama: klien cukup mengirim ulang dengan Idempotency-Key; server idempoten, jadi tanpa endpoint ini pun tidak terjadi duplikat.

### 4.4 Daftar kode error yang dimanfaatkan (existing, tidak ada error baru)

| Kode | HTTP | Kapan | Penanganan klien |
|---|---|---|---|
| `STOCK_INSUFFICIENT` | 409 | Stok produk habis saat sync | offline_orders.status = `conflict` + message |
| `SHIFT_REQUIRED` | 409 | Transaksi butuh shift yang sudah ditutup | `conflict` (kasir buka shift lalu retry) |
| `DUPLICATE` (idempotency) / 200 with existing | — | Kiriman ulang transaksi yang sudah ada | anggap `done` (server kembalikan transaksi sama) |
| `401/UNAUTHORIZED` | 401 | Token kedaluwarsa saat sync | pause sync, minta login ulang |

---

## 5. Aturan Bisnis

1. **Idempotency-Key wajib** untuk semua transaksi offline: `clientTxId` di-generate sebelum simpan ke IDB, dipakai sebagai header `Idempotency-Key` saat sync. Ini mencegah duplikat walau retry berkali-kali.
2. **Server selalu menjadi sumber kebenaran (source of truth) harga & stok.** Saat online, katalog di-pull ke IDB; harga dari cache TIDAK pernah dikirim ke server sebagai harga (server hitung ulang).
3. **Sync FIFO:** antrean dikirim berurutan creation-time; jika satu item `conflict`, item setelahnya tetap diproses (jangan blok seluruh antrean).
4. **Conflict = STOCK_INSUFFICIENT / SHIFT_REQUIRED / VALIDATION:** baris offline TIDAK otomatis dihapus; ditandai `conflict`, kasir perbaiki (ubah qty, hapus, atau buka shift) lalu retry. `done` = server menerima.
5. **Stale cache:** jika `offline.stale_after_days` terlampaui sejak `lastSyncedAt` tanpa sync, tampilkan peringatan "Data harga mungkin tidak terbaru" sebelum checkout offline.
6. **Shift offline (catatan):** kasir TIDAK bisa BUKA shift saat offline (butuh server). Transaksi offline tetap boleh dibuat bila kasir sudah punya `shiftId` aktif (dari sesi online terakhir). Jika tidak, transaksi offline dilogoa sebagai `NO_SHIFT` dan ditandai konflik `SHIFT_REQUIRED` saat sync — harus dibuka shift dulu oleh kasir.
7. **Pembayaran:** metode cash/qris/transfer diterima offline & disimpan; verifikasi pembayaran tetap sama saat sync.
8. **Poin/member:** redemption poin saat offline = P1-late; transaksi offline tidak mengurangi poin sampai server setuju (hindari double-spend).

---

## 6. Alur Status (state machine)

### 6.1 Offline order lifecycle

```
[created] ──checkout offline──▶ queued
queued ──online + auto_sync──▶ syncing ──200 ok──▶ done
queued ──manual Sync Now──▶ syncing
syncing ──409 (STOCK_INSUFFICIENT / SHIFT_REQUIRED / VALIDATION)──▶ conflict
conflict ──edit/retry──▶ queued ──▶ (ulangi)
conflict ──hapus──▶ (dibuang, terminal)
syncing ──jaringan gagal / 5xx──▶ queued  (attempt++); retry tetapkan
```

- `done` = terminal sukses (server punya transaksi; simpan `serverResponse` utk struk final).
- `conflict` = perlu intervensi manual. Bukan kegagalan tak bisa dipulihkan.
- Setiap percobaan sync menambah `syncAttempts`; batas ambang (mis. 10) memunculkan peringatan tapi tidak menghapus.

### 6.2 Deteksi offline (koneksi)

```
[online] ◀──event online──▶ [offline]  (listener window 'online'/'offline' + navigator.onLine)
  SW caches-online: pull /sync/catalog → IDB
  offline: baca dari IDB; transaksi → offline_orders
```

### 6.3 Sinkronisasi (background)

```
[online & auto_sync] → SW 'sync' event / window 'online' → read queue FIFO
  → untuk tiap order: POST /transactions (Idempotency-Key)
       → 200/201 → done
       → 409 conflict → conflict
       → network fail → retry berikutnya (queued)
  → setelah semua: pull /sync/catalog (refresh stok/harga baru) → update lastSyncedAt
```

---

## 7. Kasus Tepi & Penanganan Error (minimal 5 per fitur)

### 7.1 PWA / SW
1. **PWA tidak bisa install (HTTP localhost / http)** → tampil keterangan "Pasang aplikasi hanya tersedia via HTTPS". Jangan crash.
2. **SW gagal registrasi (storage penuh / private mode)** → degradasi elegan: aplikasi tetap jalan online, cache offline di-skip, log console.
3. **Cache aset basi (SW versi lama)** → mekanisme update: `skipWaiting` + prompt "Versi baru tersedia. Muat ulang?"; jangan auto-kill tab aktif.
4. **Manifest/icon 404** → validasi build: pastikan path icon benar; Lighthouse PWA score ≥ 95.
5. **`beforeinstallprompt` tidak muncul** → tombol install di-sembunyikan; tetap tampilkan info "Buka menu browser > Pasang aplikasi".

### 7.2 Deteksi & cache katalog
1. **IDB penuh** → catch `QuotaExceededError`; kurangi cache (evict produk lama) & tampilkan pesan "Penyimpanan katalog penuh".
2. **Sync katalog macet (rekursif/loop)** → guard versi; jangan pull ulang bila `serverVersion == lastSyncedVersion`.
3. **Stale cache warn** → jika `now - lastSyncedAt > stale_after_days`, tampil warning saat checkout sebelum simpan.
4. **Katalog kosong di awal (belum pernah online)** → saat offline, kasir di-blokir dari kasir (tidak ada produk) dengan pesan jelas; jangan izinkan transaksi dengan produk kosong.
5. **Perubahan data di server saat offline** (harga/stok berubah) → saat sync pull berikutnya, IDB overwrite (last-pull-wins).

### 7.3 Antrean transaksi offline
1. **Dua tab browser terbuka menulis offline_orders** → IDB transaksi per-tab; gunakan lock/`clientTxId` unik agar tidak saling timpa (broadcastChannel utk notifikasi, P1).
2. **Transaksi offline dibuat setelah shift ditutup** → saat sync `SHIFT_REQUIRED` → conflict (kasir buka shift).
3. **Idempotency-Key duplikat antar dua kiriman** → server mengembalikan transaksi yang sama (200), klien anggap done, tidak duplikat.
4. **Payment tidak lengkap (tidak mencapai total)** → ikuti kebijakan Fase 4 (partial allowed) — simpan status payment apa adanya & sinkron.
5. **Antrean sangat panjang (100+)** → proses berurutan; tampilkan progress; jangan freez UI (sync di SW/background).
6. **App di-tutup saat sync setengah jalan** → pesan `sync_state` memori; saat dibuka lagi, deteksi & lanjutkan; recovery via `GET /sync/orders` opsional.

### 7.4 Background sync / konflik
1. **Background sync tidak didukung browser** → fallback: sync saat event `online` + saat tab difocus.
2. **Konflik stok: hanya sebagian item tidak cukup** → tandai transaksi `conflict` keseluruhan (transaksional) — jangan pecah jadi partial (hindari inkonsistensi payment).
3. **Server down lama (5xx berkepanjangan)** → retry backoff eksponensial; jaga antrean; tampil "Belum tersinkron, coba lagi nanti".
4. **Token kedaluwarsa saat sync** → pause, minta login; jangan hapus antrean; lanjutkan setelah refresh token.
5. **Retry berkali-kali tetap conflict** → setelah `syncAttempts` ≥ ambang, tonjolkan di panel agar pemilik intervensi.

### 7.5 Settings & audit
1. **Toggle offline dimatikan saat ada antrean** → tanya konfirmasi "N transaksi belum tersinkron tetap akan dikirim?"; antrean tetap diproses, hanya hentikan pull baru.
2. **stale_after_days tidak valid (<1)** → clamp ke 1, simpan dengan validasi.

---

## 8. Dampak ke Modul yang Sudah Ada + Rencana Migrasi

### 8.1 Dampak per modul

| Modul / file | Dampak | Aksi wajib |
|---|---|---|
| **`next.config.ts`** | Tidak ada plugin PWA saat ini | Tambah `@serwist/next` (atau setara) + konfigurasi SW/manifest. Wajib per §1.1 F7-1. |
| **`layout.tsx`** | Tambah registrasi SW + manifest meta + viewport | Update (production-only SW registration) |
| **`lib/api.ts`** | API client harus tahu offline & idempotency header | Tambah helper `postTransactionOffline` memakai `Idempotency-Key`; deteksi `navigator.onLine` |
| **`lib/auth-storage.ts`** | Token sesi (localStorage + cookie) tetap dipakai offline | Tidak berubah secara fungsional; pastikan token tersimpan utk sync |
| **Kasir (POS)** | Jika offline → baca produk dari IDB, simpan transaksi ke offline_orders bukan POST langsung | Bercabang: `navigator.onLine ? apiCheckout : queueOffline` |
| **Struk (`receipt-actions.tsx`)** | Struk sementara saat offline; struk final setelah sync | Dukung struk dari `offline_orders` (reuse data struk) |
| **Settings** | Tambah section "Offline" (toggle + sync_mode + stale days) | Update |
| **Header / komponen global** | Tambah badge offline + panel Antrean Sinkron | Update |
| **API server** | `GET /sync/catalog`, `GET /sync/state` (baru, ringan) | Tambah routes; `POST /transactions` idempotency sudah ada (reuse) |
| **DB server** | Tidak ada tabel baru | — (settings key saja, idempotent insert) |

### 8.2 Rencana migrasi (urutan eksekusi)

1. **Tooling:** pasang `@serwist/next`; konfigurasi `next.config.ts`; buat `manifest.webmanifest` + icon (192/512 maskable) + `sw.ts`.
2. **Settings:** tambah key offline via `ddl-phase7.sql` (idempotent `ON CONFLICT DO NOTHING`) di `migrate.ts`.
3. **API:** routes `GET /sync/catalog` & `GET /sync/state` (kasir+); test idempotency POST.
4. **IDB:** buat `lib/idb.ts` (open db, store products/offline_orders/sync_state) + helper.
5. **Deteksi offline:** hook `useOnline` + banner.
6. **Kasir offline:** cabang queue vs online checkout.
7. **Sync engine:** `lib/sync.ts` (FIFO, idempotency, conflict), SW registration + background sync, retry fallback.
8. **Panel Antrean Sinkron + Settings UI.**
9. **Test:** semua AC §2; tes manual Chrome DevTools (offline, throttling), Lighthouse PWA.
10. **Rollback:** hapus plugin PWA dari config + file SW/manifest; hapus routes sync (opsional); IDB kosong otomatis jika tak dipakai. Tidak ada perubahan destruktif ke DB server.

---

## 9. Bukan-Fungsional (performa, offline, akses)

### 9.1 Performa & load

| Operasi | Target | Catatan |
|---|---|---|
| First meaningful paint (FMP) saat online | < 2 detik (LAN homelab) | shell di-cache |
| Load ulang offline (utk kembali ke app) | < 1 detik (dari cache) | Cache-first aset |
| Pull katalog `GET /sync/catalog` full | < 1 detik (80 produk) | payload ringan, tanpa N+1 |
| Tulis transaksi ke IDB | < 50 ms | synchronous-lite, jangan blok UI |
| Sync 1 antrean (round-trip) | < 500 ms (LAN) | reuse idempotent POST |
| Deteksi offline→banner | < 2 detik | event listener |

### 9.2 Offline
- Aplikasi (shell) bisa dibuka dan dipakai untuk kasir dasar (produk cache + transaksi queue) saat **true offline**.
- Semua state kritis bertahan di IndexedDB (bukan localStorage) agar aman untuk volume transaksi & query terindeks.

### 9.3 Hak akses & keamanan
- Token tetap dibutuhkan untuk sync (dipakai lagi di background sync memakai access token cache; refresh saat kedaluwarsa).
- Kasir TIDAK menerima `costPrice` di cache katalog (konsisten AC-08.2 Fase 2).
- Jangan pernah menyimpan password; token di-indexedDB/localStorage (kebijakan existing auth-storage, tidak diperketat di Fase ini).

### 9.4 Aksesibilitas & UX
- Banner offline & panel antrean harus accessible (role/status live-region).
- Instal PWA: tombol jelas, langkah fail (non-HTTPS) diberi pesan.
- Mode `standalone` harus menampilkan header aplikasi sendiri (karena tidak ada browser chrome).

---
