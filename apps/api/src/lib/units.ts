/**
 * Konversi satuan & kuantitas (SPEC fase 2 §4.4, §5.1).
 * Stok selalu disimpan dalam UNIT DASAR (`products.unit`); satuan tambahan
 * (`product_units`) punya faktor konversi ke unit dasar.
 *
 * Semua fungsi MURNI (tanpa DB) — diuji unit di tests/units.test.ts.
 */
import { toQty } from './money';

/** qty_stok = round3(qty_penjualan × factor). */
export function convertToBaseQty(qtySale: number, factor: number): number {
  return toQty(qtySale * factor);
}

/** Stok tersedia dalam satuan pilihan (unit dasar → satuan jual): floor(stok / factor). */
export function availableInUnit(stockBase: number, factor: number): number {
  if (factor <= 0) return 0;
  return Math.floor(stockBase / factor);
}

/** HPP snapshot per satuan: round(cost_price_unit_dasar × factor). */
export function costForUnit(costPriceBase: number, factor: number): number {
  return Math.round(costPriceBase * factor);
}

/**
 * Validasi qty penjualan (SPEC §7.4.8): qty di bawah 0.001 ditolak agar
 * tidak ada transaksi qty 0 setelah pembulatan 3 desimal.
 */
export function normalizeSaleQty(qty: number): number | null {
  const q = toQty(qty);
  if (!Number.isFinite(qty) || q <= 0) return null;
  return q;
}

/** Tanda tangan satuan untuk pesan error ("tersisa 10 pcs, diminta 40 pcs"). */
export function stockMessage(availableBase: number, requestedBase: number, unit: string): string {
  return `Stok tidak cukup (tersisa ${availableBase} ${unit}, diminta ${requestedBase} ${unit})`;
}
