/**
 * Koneksi PostgreSQL + instance Drizzle.
 * `prepare: false` wajib untuk postgres-js + transaksi (drizzle docs).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '../env';

export const client = postgres(env.DATABASE_URL, {
  max: 10,
  prepare: false,
  // idling connection 30s di homelab biar hemat resource
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export type DB = typeof db;

/** Tipe transaksi Drizzle — dipakai fungsi yang menerima db ATAU tx. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;
