/**
 * Uang & pembulatan (spec/db-schema.md §8.4):
 *  - Uang = integer rupiah (BIGINT). Semua perhitungan diskon/pajak dibulatkan
 *    ke rupiah terdekat (round half-up) — Math.round sudah half-up untuk positif.
 *  - Quantity = 3 desimal (NUMERIC(12,3)).
 *  - Poin = floor (pembulatan ke bawah).
 */

/** Bulatkan ke rupiah terdekat (half-up). */
export function roundMoney(n: number): number {
  return Math.round(n);
}

/** Persen dari base: round(base * pct / 100). */
export function percentOf(base: number, pct: number): number {
  return Math.round((base * pct) / 100);
}

/** Normalisasi quantity ke 3 desimal. */
export function toQty(n: number | string): number {
  const v = typeof n === 'string' ? Number.parseFloat(n) : n;
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 1000) / 1000;
}

/** Pajak eksklusif: tax = round(dpp × rate / 100). */
export function taxExclusive(dpp: number, ratePct: number): number {
  return Math.round((dpp * ratePct) / 100);
}

/** Pajak inklusif: tax = round(lineTotal − lineTotal/(1+rate/100)). */
export function taxInclusive(lineTotal: number, ratePct: number): number {
  return Math.round(lineTotal - lineTotal / (1 + ratePct / 100));
}

/** Poin: floor(total / rate). */
export function pointsFrom(total: number, earnPerIdr: number): number {
  if (earnPerIdr <= 0 || total <= 0) return 0;
  return Math.floor(total / earnPerIdr);
}

/** Nilai rupiah redeem: poin × nilai per poin (dibatasi maxValue oleh pemanggil). */
export function redeemValue(points: number, redeemValuePerPoint: number): number {
  return Math.floor(points * redeemValuePerPoint);
}
