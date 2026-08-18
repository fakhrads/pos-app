# POS App — monorepo
Point of Sales lengkap ala SaaS. Deploy: Dokploy (homelab fakhrads.dev).

## Stack
- Backend: Bun + Elysia (apps/api), PostgreSQL (db_pos), Drizzle ORM
- Frontend: Next.js + shadcn/ui (apps/web)
- Monorepo: workspace sederhana (masing-masing app independen, nggak wajib turborepo)

## Struktur
- spec/          <- spek dari Business Analyst + System Analyst (dibaca developer)
- apps/api       <- backend Bun Elysia
- apps/web       <- frontend Next.js + shadcn
- tests/         <- catatan & hasil QA tester

## Aturan
- Bahasa kode: English. Docs/komentar bebas (boleh Indonesia).
- Jangan simpan secret di repo. Konfigurasi via env.
- Database: PostgreSQL, nama db `db_pos`. Schema ada di spec/ setelah Phase 1.
- Deploy via Dokploy: backend & frontend jadi app terpisah (domain sendiri-sendiri).

## Status
- Phase 1 (spek): berjalan
- Phase 2 (dev): belum
- Phase 3 (QA): belum
- Phase 4-5 (deploy): belum
