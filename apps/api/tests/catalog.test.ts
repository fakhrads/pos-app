/**
 * Unit test: helper katalog (lib/catalog.ts) — validasi satuan, serialisasi
 * role (kasir tanpa costPrice — AC-08.2), namespace SKU (AC-01.3).
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { validateUnitPayload, serializeProduct, serializeVariant } from '../src/lib/catalog';
import { fail, isAppError } from '../src/lib/errors';
import type { Product, ProductVariant } from '../src/db/schema';

/** Jalankan fn; tangkap AppError pertama (fail() throw). */
function expectFail(fn: () => void): { code: string; status: number; details?: unknown } {
  try {
    fn();
  } catch (e) {
    if (isAppError(e)) return { code: e.code, status: e.status, details: e.details };
    throw e;
  }
  throw new Error('diharapkan throw, tapi tidak');
}

describe('validateUnitPayload (SPEC §3.3, §4.3)', () => {
  test('factor ≤ 0 → INVALID_FACTOR 422 (AC-03.5)', () => {
    const r = expectFail(() => validateUnitPayload('dus', 0, 'pcs', []));
    expect(r.code).toBe('INVALID_FACTOR');
    expect(r.status).toBe(422);
  });
  test('unit = unit dasar → DUPLICATE_UNIT 409 (SPEC §7.4.7)', () => {
    const r = expectFail(() => validateUnitPayload('pcs', 40, 'pcs', []));
    expect(r.code).toBe('DUPLICATE_UNIT');
    expect(r.status).toBe(409);
  });
  test('unit duplikat dalam payload → DUPLICATE_UNIT 409 (AC-03.6)', () => {
    const r = expectFail(() => validateUnitPayload('dus', 40, 'pcs', ['dus']));
    expect(r.code).toBe('DUPLICATE_UNIT');
  });
  test('valid → tidak throw', () => {
    validateUnitPayload('dus', 40, 'pcs', []);
    validateUnitPayload('renceng', 5, 'pcs', ['dus']);
  });
});

describe('serializeProduct/serializeVariant — role stripping (AC-08.2)', () => {
  const baseProduct = {
    id: 'p1', categoryId: 'c1', name: 'Test', sku: 'T-1', barcode: null, description: null,
    unit: 'pcs', costPrice: 5000, sellingPrice: 6500, stockOnHand: 10, minStock: 5,
    outletId: 1, isActive: true, isTaxable: true, hasVariants: false, trackStock: true,
    expiryDate: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  } as unknown as Product;

  test('kasir: costPrice TIDAK ada', () => {
    const out = serializeProduct(baseProduct, 'kasir') as Record<string, unknown>;
    expect(out).not.toHaveProperty('costPrice');
    expect(out.sellingPrice).toBe(6500);
  });
  test('manager: costPrice ada', () => {
    const out = serializeProduct(baseProduct, 'manager') as Record<string, unknown>;
    expect(out.costPrice).toBe(5000);
  });

  const baseVariant = {
    id: 'v1', productId: 'p1', name: 'Varian A', sku: 'T-1-A', barcode: null,
    costPrice: 5000, sellingPrice: 7000, stockOnHand: 30, minStock: 5,
    isActive: true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  } as unknown as ProductVariant;

  test('kasir: costPrice varian TIDAK ada', () => {
    const out = serializeVariant(baseVariant, 'kasir') as Record<string, unknown>;
    expect(out).not.toHaveProperty('costPrice');
  });
});

describe('error helper', () => {
  test('fail() menghasilkan AppError dengan kode & status', () => {
    const r = expectFail(() => fail('STOCK_INSUFFICIENT', 'x', 409, { available: 10 }));
    expect(r).toMatchObject({ code: 'STOCK_INSUFFICIENT', status: 409, details: { available: 10 } });
  });
});
