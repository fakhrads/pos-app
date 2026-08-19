/**
 * Helper katalog (produk/varian/satuan) — dipakai products.routes,
 * product-variants.routes, product-units.routes, import.
 *
 * Satu namespace SKU & barcode GLOBAL (SPEC §7.3.1): SKU/barcode varian
 * tidak boleh bentrok dengan entitas aktif mana pun (produk ATAU varian).
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db';
import { products, productVariants, productUnits, type Product, type ProductVariant, type ProductUnit } from '../db/schema';
import { fail } from './errors';

/** Cek SKU bebas di namespace produk+varian (kecuali excludeId bila diisi). */
export async function assertSkuAvailable(dbOrTx: DbOrTx, sku: string, excludeProductId?: string, excludeVariantId?: string): Promise<void> {
  const p = await dbOrTx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.sku, sku), isNull(products.deletedAt), excludeProductId ? ne(products.id, excludeProductId) : undefined))
    .limit(1);
  if (p[0]) fail('DUPLICATE_SKU', `SKU '${sku}' sudah dipakai`, 409);
  const v = await dbOrTx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(eq(productVariants.sku, sku), isNull(productVariants.deletedAt), excludeVariantId ? ne(productVariants.id, excludeVariantId) : undefined))
    .limit(1);
  if (v[0]) fail('DUPLICATE_VARIANT_SKU', `SKU varian '${sku}' sudah dipakai`, 409);
}

/** Cek barcode bebas di namespace produk+varian. */
export async function assertBarcodeAvailable(dbOrTx: DbOrTx, barcode: string, excludeProductId?: string, excludeVariantId?: string): Promise<void> {
  const p = await dbOrTx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.barcode, barcode), isNull(products.deletedAt), excludeProductId ? ne(products.id, excludeProductId) : undefined))
    .limit(1);
  if (p[0]) fail('DUPLICATE_BARCODE', `Barcode '${barcode}' sudah dipakai`, 409);
  const v = await dbOrTx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(eq(productVariants.barcode, barcode), isNull(productVariants.deletedAt), excludeVariantId ? ne(productVariants.id, excludeVariantId) : undefined))
    .limit(1);
  if (v[0]) fail('DUPLICATE_VARIANT_BARCODE', `Barcode varian '${barcode}' sudah dipakai`, 409);
}

export async function findProduct(dbOrTx: DbOrTx, id: string): Promise<Product | null> {
  const rows = await dbOrTx.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1);
  return rows[0] ?? null;
}

export async function findVariant(dbOrTx: DbOrTx, id: string): Promise<ProductVariant | null> {
  const rows = await dbOrTx.select().from(productVariants).where(and(eq(productVariants.id, id), isNull(productVariants.deletedAt))).limit(1);
  return rows[0] ?? null;
}

export async function findUnit(dbOrTx: DbOrTx, id: string): Promise<ProductUnit | null> {
  const rows = await dbOrTx.select().from(productUnits).where(eq(productUnits.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Varian aktif (non-deleted) milik produk — urut created_at. */
export async function listVariants(dbOrTx: DbOrTx, productId: string): Promise<ProductVariant[]> {
  return dbOrTx
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), isNull(productVariants.deletedAt)))
    .orderBy(productVariants.createdAt);
}

export async function listUnits(dbOrTx: DbOrTx, productId: string): Promise<ProductUnit[]> {
  return dbOrTx.select().from(productUnits).where(eq(productUnits.productId, productId)).orderBy(productUnits.createdAt);
}

/**
 * Validasi unit satuan tambahan (SPEC §3.3): factor > 0, unit != unit dasar,
 * unit unik dalam payload.
 */
export function validateUnitPayload(unit: string, factor: number, baseUnit: string, existing: string[]): void {
  const u = unit.trim();
  if (u === '' || u.length > 20) fail('VALIDATION_ERROR', 'Nama satuan wajib 1-20 karakter', 422, { field: 'unit' });
  if (!Number.isFinite(factor) || factor <= 0) fail('INVALID_FACTOR', 'factor harus > 0', 422);
  if (u.toLowerCase() === baseUnit.toLowerCase()) fail('DUPLICATE_UNIT', `Satuan '${u}' sama dengan unit dasar '${baseUnit}'`, 409);
  if (existing.some((e) => e.toLowerCase() === u.toLowerCase())) fail('DUPLICATE_UNIT', `Satuan '${u}' sudah terdaftar`, 409);
}

/** Serialisasi produk sesuai role: kasir TANPA costPrice (AC-08.2). */
export function serializeProduct(p: Product, role: 'admin' | 'manager' | 'kasir') {
  const { costPrice, ...rest } = p;
  return role === 'kasir' ? { ...rest, stockOnHand: Number(p.stockOnHand), minStock: Number(p.minStock) } : { ...p, stockOnHand: Number(p.stockOnHand), minStock: Number(p.minStock) };
}

export function serializeVariant(v: ProductVariant, role: 'admin' | 'manager' | 'kasir') {
  const { costPrice, ...rest } = v;
  const base = role === 'kasir' ? rest : v;
  return { ...base, stockOnHand: Number(v.stockOnHand), minStock: Number(v.minStock) };
}

export function serializeUnit(u: ProductUnit) {
  return { ...u, factor: Number(u.factor), sellPrice: Number(u.sellPrice), minQty: Number(u.minQty) };
}

/** Hitung jumlah varian per produk (untuk list — hindari N+1). */
export async function variantCounts(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: productVariants.productId, count: sql<number>`count(*)::int` })
    .from(productVariants)
    .where(and(inArray(productVariants.productId, productIds), isNull(productVariants.deletedAt)))
    .groupBy(productVariants.productId);
  return new Map(rows.map((r) => [r.productId, Number(r.count)]));
}
