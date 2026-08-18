/**
 * Settings (M9) — cache in-memory TTL 30 detik.
 * Struk & aturan bisnis (poin, diskon manual, return, timezone) dibaca dari sini.
 */
import { db } from '../db';
import { settings } from '../db/schema';

let cache: Record<string, unknown> | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function getSettings(force = false): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (!force && cache && now - cacheAt < TTL_MS) return cache;
  const rows = await db.select().from(settings);
  const map: Record<string, unknown> = {};
  for (const r of rows) map[r.key] = r.value;
  cache = map;
  cacheAt = now;
  return map;
}

export function numSetting(s: Record<string, unknown>, key: string, def: number): number {
  const v = s[key];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

export function strSetting(s: Record<string, unknown>, key: string, def: string): string {
  const v = s[key];
  return typeof v === 'string' && v !== '' ? v : def;
}
