# FakhriPOS — Backend API (`apps/api`)

REST API Point of Sales (Bun + Elysia + Drizzle ORM, PostgreSQL `db_pos`).
Implementasi mengikuti `spec/db-schema.md`, `spec/api-design.md`, `spec/features.md`.

## Stack

- **Runtime**: Bun ≥ 1.1
- **Framework**: Elysia (validasi TypeBox, error handler global)
- **ORM**: Drizzle (schema di `src/db/schema.ts`; DDL final di `src/db/ddl.sql`)
- **DB**: PostgreSQL 16+ (`db_pos`)
- **Auth**: JWT HS256 (30 mnt, `jose`) + refresh token opaque (7 hari, hash SHA-256 di `user_sessions`, rotasi)
- **Password**: `Bun.password` (Argon2id)

## Struktur

```
apps/api/
├── src/
│   ├── index.ts               # entry Elysia: CORS, onError, /api/v1, /health
│   ├── env.ts                 # validasi env (DATABASE_URL, JWT_SECRET, PORT…)
│   ├── db/
│   │   ├── index.ts           # koneksi postgres-js + instance drizzle
│   │   ├── schema.ts          # 17 tabel + 12 enum (Drizzle)
│   │   ├── ddl.sql            # DDL final + seed (dari spec §6–7)
│   │   └── migrate.ts         # `bun run db:migrate` — eksekusi DDL + seed admin
│   ├── lib/                   # errors, http (envelope/pagination/CSV), jwt,
│   │   │                      # money (pembulatan), settings cache, audit,
│   │   │                      # idempotency, rate-limit, sequence (nomor trx)
│   ├── middleware/auth.ts     # mustAuth / mustManager / mustAdmin
│   ├── services/              # checkout (atomik), receipt, transaction, return
│   └── routes/                # plugin per resource (auth, users, products, …)
├── package.json
├── tsconfig.json
├── drizzle.config.ts          # opsional: drizzle-kit push/generate
├── Dockerfile                 # multi-stage oven/bun (Dokploy: rootDirectory apps/api)
└── .env.example
```

## Menjalankan

```bash
cd apps/api
cp .env.example .env          # isi DATABASE_URL, JWT_SECRET, SEED_ADMIN_*

bun install
bun run db:migrate            # eksekusi DDL + seed (kategori, PPN 11%, settings, admin awal)
bun run dev                   # dev dengan watch (port default 3000)
# atau
bun run start                 # produksi
```

Health check: `GET /health` · Docs (dev): `/api/v1/docs` (Swagger UI).

## Env penting

| Key | Keterangan |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db_pos` |
| `JWT_SECRET` | random ≥ 32 char (wajib diganti di produksi) |
| `PORT` | default 3000 |
| `CORS_ORIGIN` | origin frontend, `*` saat dev |
| `SEED_ADMIN_EMAIL/PASSWORD` | akun admin awal saat `db:migrate` |

## Perilaku penting (sesuai spec)

- **Checkout atomik**: `POST /transactions` = 1 transaksi DB (`FOR UPDATE` anti-oversell,
  stok + ledger + poin + audit dalam satu commit; rollback penuh jika gagal).
- **Idempotensi**: header `Idempotency-Key` wajib → dedupe double-submit 5 menit.
- **Uang**: integer rupiah (BIGINT). Quantity 3 desimal. Diskon persen & PPN dibulatkan
  per hitungan (round half-up); poin di-floor.
- **Kasir** dibatasi: riwayat transaksi hari ini saja (dipaksa server), laporan tanpa laba.
- **Soft delete** produk/kategori/pelanggan/user; unik parsial `WHERE deleted_at IS NULL`.
- **Nomor transaksi**: `TRX-YYYYMMDD-XXXX` (counter harian per outlet, retry 1× saat konflik unique).

## Deploy (Dokploy)

- Build: Dockerfile multi-stage `oven/bun:1` (non-root user, healthcheck `/health`).
- `rootDirectory`: `apps/api`.
- Set env `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` di Dokploy.
- Jalankan `bun run db:migrate` sekali (mis. via command/job Dokploy atau `docker compose run`).

## Verifikasi yang masih perlu dilakukan (butuh PostgreSQL live)

1. `bun run db:migrate` terhadap PostgreSQL 16 baru (DDL + seed + admin).
2. Smoke test end-to-end: login → buat kategori/produk → adjust stok → checkout (cash/QRIS) →
   preview → struk → cancel → return → laporan + dashboard → export CSV.
3. Uji konkurensi: 2 checkout paralel produk stok 1 (harus 1 sukses, 1 `STOCK_INSUFFICIENT`).
4. `tsc --noEmit` sudah hijau (lihat verifikasi lokal di bawah).
