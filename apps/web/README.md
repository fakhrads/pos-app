# FakhriPOS — Frontend (apps/web)

Frontend Next.js (App Router) + shadcn/ui untuk aplikasi POS FakhriPOS.
Backend: `apps/api` (Bun + Elysia) — lihat `spec/api-design.md` untuk kontrak API `{ ok, data, error }`.

## Stack

- Next.js 15 (App Router, TypeScript, `output: standalone` untuk deploy Dokploy)
- Tailwind CSS 4 + shadcn/ui (radix-ui, lucide-react)
- Font: Geist (otomatis dari `next/font/google`)
- Auth: JWT access + refresh token. Token disimpan di `localStorage` (dipakai fetch wrapper) + mirror cookie `pos_token` untuk guard route di middleware.

## Menjalankan

```bash
cp .env.example .env.local   # sesuaikan NEXT_PUBLIC_API_URL
npm install
npm run dev                  # http://localhost:3000
```

Build & produksi:

```bash
npm run build
npm start                    # port default 3000 (PORT=xxxx npm start untuk custom)
```

> Catatan: `next.config.ts` memakai `output: "standalone"` (optimasi deploy container).
> `npm start` tetap berfungsi (hanya ada warning). Untuk Dokploy/container:
> `node .next/standalone/server.js` dengan `NEXT_PUBLIC_API_URL` di-set saat build.

## Environment

| Variabel | Default | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api/v1` | Base URL API backend |

## Halaman

| Route | Role | Deskripsi |
|---|---|---|
| `/login` | public | Login email+password, redirect sesuai role |
| `/pos` | semua | Layar kasir: grid produk, scan barcode/SKU, cart, diskon item/transaksi, redeem poin, pembayaran tunai/QRIS/transfer, struk 58mm |
| `/dashboard` | admin, manager | Statistik hari ini, grafik 7 hari, transaksi terbaru, produk terlaris, alert stok |
| `/products` | semua (CRUD: manager+) | List/search/filter produk, CRUD, ubah stok, aktif/nonaktif |
| `/categories` | manager+ | CRUD kategori |
| `/transactions` | semua (kasir: hari itu) | Riwayat transaksi + detail + cetak ulang struk |
| `/customers` | semua (kelola: manager+) | CRUD pelanggan, member, poin, histori |
| `/discounts` | manager+ (tulis: admin) | Promo terstruktur (kode, periode, kuota) |
| `/reports` | semua (laba/stok: manager+) | Penjualan, laba, stok menipis, terlaris — semua export CSV (UTF-8+BOM) |
| `/users` | admin | Kelola akun & role, reset password |
| `/settings` | admin | Profil toko (dipakai struk), QRIS payload, PPN, poin, threshold, cap diskon |
| `/profile` | semua | Ganti password sendiri |

## Struktur

```
src/
  app/            # route App Router (layout, halaman)
  components/
    ui/           # komponen shadcn/ui (via CLI)
    *.tsx         # app-shell, receipt 58mm, customer-picker, dll.
  lib/
    api.ts        # fetch wrapper {ok,data,error} + auto-refresh JWT
    types.ts      # tipe data sesuai spec/api-design.md
    utils.ts      # formatIDR, format WIB, downloadCSV, dll.
    auth-storage.ts
  providers/      # AuthProvider (React context)
  hooks/          # useSettings
  middleware.ts   # guard route per role (redirect /login, role check)
```

## Catatan integrasi

- Semua angka uang integer rupiah; server adalah sumber kebenaran (checkout di-re-hitung server, cart hanya di frontend + localStorage).
- Checkout mengirim `Idempotency-Key` (anti double-submit) dan memanggil `POST /transactions/preview` lalu `POST /transactions`.
- Print struk: `window.print()` dengan CSS 58mm — hanya elemen `.print-receipt` yang tercetak.
- Kasir tidak melihat: laba, stok menipis, dashboard, kelola produk (guard client + middleware + backend).
