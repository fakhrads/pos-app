/**
 * Migration runner — `bun run db:migrate`
 *
 * 1. Eksekusi DDL final (src/db/ddl.sql): enum, 17 tabel, index, trigger, seed.
 * 2. Seed akun admin awal dari env SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *    (hash dibuat aplikasi dengan Bun.password argon2id — bukan SQL).
 *
 * Tidak perlu koneksi live untuk menulis kode ini; jalankan saat PostgreSQL siap:
 *   DATABASE_URL=... SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... bun run db:migrate
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { client, db } from './index';
import { users } from './schema';
import { env } from '../env';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DDL_PATH = path.join(__dirname, 'ddl.sql');

async function main(): Promise<void> {
  console.log('[migrate] target:', env.DATABASE_URL.replace(/\/\/.*@/, '//***@'));
  console.log('[migrate] mengeksekusi DDL (db_pos)...');

  // Simple query protocol postgres.js mendukung multi-statement
  await client.unsafe(readFileSync(DDL_PATH, 'utf-8'));
  console.log('[migrate] DDL + seed data selesai (17 tabel, 12 enum, trigger, seed).');

  // ---------- Seed admin awal ----------
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.warn('[migrate] SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD belum di-set — akun admin TIDAK dibuat.');
    console.warn('[migrate] Buat manual via: POST /api/v1/auth/login dengan akun admin, atau set env lalu jalankan ulang.');
  } else {
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      console.log('[migrate] admin sudah ada, skip seed admin.');
    } else {
      const passwordHash = await Bun.password.hash(env.SEED_ADMIN_PASSWORD);
      await db.insert(users).values({
        name: env.SEED_ADMIN_NAME,
        email,
        passwordHash,
        role: 'admin',
        isActive: true,
      });
      console.log(`[migrate] akun admin dibuat: ${email} (role=admin)`);
    }
  }

  await client.end();
  console.log('[migrate] selesai ✓');
}

main().catch((err) => {
  console.error('[migrate] GAGAL:', err);
  process.exit(1);
});
