/**
 * Environment & konfigurasi — dibaca dari .env (Bun auto-load) / env vars.
 * Validasi minimal; gagal cepat (fail-fast) saat produksi tanpa konfigurasi penting.
 */

export const env = {
  /** PostgreSQL connection string, mis. postgres://user:pass@host:5432/db_pos */
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  /** Secret JWT HS256 — WAJIB diganti di produksi */
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me',
  /** Secret lama untuk rotasi (claim `kid`), dipisah koma */
  JWT_SECRET_PREVIOUS: (process.env.JWT_SECRET_PREVIOUS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  JWT_KID: process.env.JWT_KID ?? 'v1',
  /** Umur access token, format jose/ms: 30m, 1h, 2d ... */
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL ?? '30m',
  /** Umur refresh token (hari) */
  REFRESH_TTL_DAYS: Number(process.env.REFRESH_TTL_DAYS ?? 7),
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  /** Origin CORS yang diizinkan ("*" = semua, dev) */
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  /** Seed admin (dipakai `bun run db:migrate` saat boot pertama) */
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL ?? '',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD ?? '',
  SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME ?? 'Administrator',
};

export function assertEnv(): void {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL wajib di-set. Salin .env.example ke .env dan isi DATABASE_URL.');
  }
  if (env.NODE_ENV === 'production' && (env.JWT_SECRET === 'dev-only-insecure-secret-change-me' || env.JWT_SECRET.length < 16)) {
    throw new Error('JWT_SECRET wajib diganti dengan string acak panjang di produksi.');
  }
}

export const isProd = env.NODE_ENV === 'production';
