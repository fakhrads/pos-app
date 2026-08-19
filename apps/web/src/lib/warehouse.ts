// ============================================================
// Helper Stok & Gudang (Fase 3) — fetch semua halaman, format qty.
// ============================================================
import { api } from "./api";
import type { Paginated, PaginationMeta } from "./types";

/**
 * Ambil SELURUH item dari endpoint paginated (loop halaman, perPage maks 100 —
 * batas backend lib/http.ts parsePagination). Dipakai picker produk/stok yang
 * butuh data lengkap, bukan hanya halaman pertama.
 */
export async function fetchAllPages<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  perPage = 100
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  for (;;) {
    const data = await api.get<Paginated<T>>(path, { ...params, page, perPage });
    items.push(...data.items);
    if (page >= data.meta.totalPages || data.items.length === 0) break;
    page += 1;
  }
  return items;
}

/** Kunci unik baris stok (produk×varian) untuk Select/state — "productId:variantId" */
export function stockKey(productId: string, variantId?: string | null): string {
  return `${productId}:${variantId ?? ""}`;
}

/** Parsing kunci stok → { productId, variantId } */
export function parseStockKey(key: string): {
  productId: string;
  variantId: string | null;
} {
  const [productId, variantId] = key.split(":");
  return { productId: productId ?? "", variantId: variantId || null };
}

/** Bulatkan qty ke maksimal 3 desimal (SPEC §5.11 — toQty round half-up) */
export function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** qty boleh desimal → true (max 3 desimal, > 0) */
export function isValidQty(raw: string): boolean {
  if (!/^\d+(\.\d{1,3})?$/.test(raw.trim())) return false;
  return Number(raw) > 0;
}

export type { PaginationMeta };
