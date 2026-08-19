/**
 * Settings (M9) — cache in-memory TTL 30 detik.
 * Struk & aturan bisnis (poin, diskon manual, return, timezone) dibaca dari sini.
 */
import { db } from '../db';
import { settings } from '../db/schema';

/**
 * Default settings (Fase 6: Rich Content — SPEC §3/Model Data).
 * Onboarding wizard & Mode Latihan disimpan client-side (localStorage), bukan di
 * server (lihat SPEC §1.1 & Catatan §3). Default di sini hanya referensi agar
 * GET /settings selalu konsisten & bisa di-reset ke nilai awal bila dibutuhkan.
 */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'practice_mode': false,
  'onboarding.completed': false,
  'onboarding.businessName': '',
  'onboarding.businessType': '',
  'onboarding.outlets': 1,
  'onboarding.sellsProduct': true,
  'onboarding.sellsService': false,
  'onboarding.trackStock': true,
  'onboarding.hasStaff': false,
};

let cache: Record<string, unknown> | null = null;
let cacheAt = 0;
const TTL_MS = 30_000;

export async function getSettings(force = false): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (!force && cache && now - cacheAt < TTL_MS) return cache;
  const rows = await db.select().from(settings);
  // Mulai dari default (Fase 6) — baris DB menimpa nilai default.
  const map: Record<string, unknown> = { ...DEFAULT_SETTINGS };
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

/** Boolean setting dengan default (Fase 4: shift.enforce_checkout, receipt.show_*. */
export function boolSetting(s: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = s[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return def;
  }
  if (typeof v === 'number') return v === 1;
  return def;
}
