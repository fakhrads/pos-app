/**
 * Integration test: checkout dengan varian & satuan (SPEC §4.4, AC-03.x, AC-04.x).
 *
 * BUTUH DATABASE (dev/demo, mis. PGlite 127.0.0.1:55433 + `bun run db:seed`).
 * Bila DB tidak tersedia → test di-skip (bukan gagal) agar CI tanpa DB tetap hijau.
 * Produk test dibuat & dihapus sendiri (isolated, tidak menyentuh data seed).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { client, db } from '../src/db';
import { products, productVariants, productUnits, categories, users, transactions, transactionItems, stockMovements, warehouseStocks } from '../src/db/schema';
import { computeTransaction, commitCheckout, type CheckoutInput } from '../src/services/checkout.service';
import { getDefaultWarehouseId } from '../src/lib/stock';
import { isAppError } from '../src/lib/errors';
import type { AuthUser } from '../src/middleware/auth';

let dbAvailable = true;
let catId = '';
let baseProductId = ''; // unit dasar pcs, stok 100, unit tambahan dus=40
let variantProductId = ''; // ber-varian: A stok 30 harga 6500
let variantAId = '';
let jasaProductId = ''; // track_stock=false

const testUser: AuthUser = { id: '', name: 'Test', email: 'test@local', role: 'admin', outletId: 1 };

async function tryConnect(): Promise<boolean> {
  try {
    await db.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  dbAvailable = await tryConnect();
  if (!dbAvailable) return;
  // User nyata (FK transactions.user_id) — dari seed demo
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'kasir1@fakhripos.local')).limit(1);
  if (u) testUser.id = u.id;

  const [cat] = await db
    .insert(categories)
    .values({ name: `TestCat-${Date.now()}`, slug: `test-cat-${Date.now()}`, sortOrder: 0 })
    .returning();
  catId = cat.id;

  // Produk non-varian + satuan dus (faktor 40)
  const [bp] = await db
    .insert(products)
    .values({ categoryId: catId, name: 'Test Base Product', sku: `TBP-${Date.now()}`, unit: 'pcs', costPrice: 1000, sellingPrice: 1200, stockOnHand: 100, minStock: 0, isTaxable: false })
    .returning();
  baseProductId = bp.id;
  await db.insert(productUnits).values({ productId: bp.id, unit: 'dus', factor: 40, sellPrice: 40000, isSellable: true, isPurchaseUnit: true, minQty: 1 });

  // Produk ber-varian
  const [vp] = await db
    .insert(products)
    .values({ categoryId: catId, name: 'Test Variant Product', sku: `TVP-${Date.now()}`, unit: 'pcs', costPrice: 1000, sellingPrice: 6000, stockOnHand: 0, hasVariants: true, minStock: 0, isTaxable: false })
    .returning();
  variantProductId = vp.id;
  const [va] = await db
    .insert(productVariants)
    .values({ productId: vp.id, name: 'Varian A', sku: `TVA-${Date.now()}`, sellingPrice: 6500, stockOnHand: 30, minStock: 0 })
    .returning();
  variantAId = va.id;

  // Produk jasa
  const [jp] = await db
    .insert(products)
    .values({ categoryId: catId, name: 'Test Jasa', sku: `TJ-${Date.now()}`, unit: 'unit', costPrice: 0, sellingPrice: 15000, stockOnHand: 0, trackStock: false, minStock: 0, isTaxable: false })
    .returning();
  jasaProductId = jp.id;

  // Fase 3 (SPEC §5.1): stok operasional = stok GUDANG DEFAULT — test membuat
  // baris warehouse_stocks agar invariant Σ gudang = stock_on_hand utuh.
  const defaultWhId = await getDefaultWarehouseId(db);
  await db.insert(warehouseStocks).values([
    { warehouseId: defaultWhId, productId: bp.id, productVariantId: null, quantity: 100, minStock: 0 },
    { warehouseId: defaultWhId, productId: vp.id, productVariantId: va.id, quantity: 30, minStock: 0 },
  ]);
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Cleanup: movement → transaksi test → produk test (cascade varian/unit/wh_stocks)
  const ids = [baseProductId, variantProductId, jasaProductId].filter(Boolean);
  if (ids.length > 0) {
    if (variantAId) await db.delete(stockMovements).where(eq(stockMovements.productVariantId, variantAId));
    await db.delete(stockMovements).where(inArray(stockMovements.productId, ids));
    const txRows = await db
      .select({ id: transactionItems.transactionId })
      .from(transactionItems)
      .where(and(isNull(transactionItems.productId), eq(transactionItems.productName, 'Test Base Product')));
    for (const t of txRows) {
      await db.delete(transactions).where(eq(transactions.id, t.id));
    }
    for (const id of ids) {
      await db.delete(products).where(eq(products.id, id));
    }
  }
  if (catId) await db.delete(categories).where(eq(categories.id, catId));
  await client.end();
});

async function failOf(fn: () => Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await fn();
  } catch (e) {
    if (isAppError(e)) return { code: e.code, details: e.details };
    throw e;
  }
  throw new Error('diharapkan throw AppError');
}

describe('checkout: konversi satuan (AC-03.1, AC-03.2, AC-03.7)', () => {
  test.skipIf(!dbAvailable)('preview 2 dus → unitPrice 40000, lineTotal 80000, availableStock 2', async () => {
    const input: CheckoutInput = { items: [{ productId: baseProductId, unit: 'dus', quantity: 2 }], payments: [] };
    const c = await computeTransaction(db, input, { forUpdate: false, validatePayments: false });
    const line = c.lines[0]!;
    expect(line.unitPrice).toBe(40000);
    expect(line.unit).toBe('dus');
    expect(line.unitFactor).toBe(40);
    expect(line.lineTotal).toBe(80000);
    expect(line.availableStock).toBe(2); // floor(100/40)
  });

  test.skipIf(!dbAvailable)('3 dus (120 pcs) dari stok 100 → 409 STOCK_INSUFFICIENT available 100 requested 120 (AC-03.2)', async () => {
    const r = await failOf(() =>
      computeTransaction(db, { items: [{ productId: baseProductId, unit: 'dus', quantity: 3 }], payments: [] }, { forUpdate: false, validatePayments: false }),
    );
    expect(r.code).toBe('STOCK_INSUFFICIENT');
    const d = (r.details as { available: number; requested: number; unit: string }[])[0]!;
    expect(d.available).toBe(100);
    expect(d.requested).toBe(120);
    expect(d.unit).toBe('dus');
  });

  test.skipIf(!dbAvailable)('unit tidak terdaftar → 422 UNIT_NOT_FOUND (SPEC §7.4.3)', async () => {
    const r = await failOf(() =>
      computeTransaction(db, { items: [{ productId: baseProductId, unit: 'karton', quantity: 1 }], payments: [] }, { forUpdate: false, validatePayments: false }),
    );
    expect(r.code).toBe('UNIT_NOT_FOUND');
  });

  test.skipIf(!dbAvailable)('qty desimal 0.5 pcs → sukses (AC-03.7)', async () => {
    const c = await computeTransaction(db, { items: [{ productId: baseProductId, quantity: 0.5 }], payments: [] }, { forUpdate: false, validatePayments: false });
    const line = c.lines[0]!;
    expect(line.quantity).toBe(0.5);
    expect(line.lineTotal).toBe(Math.round(1200 * 0.5));
    expect(line.availableStock).toBe(100);
  });
});

describe('checkout: varian (AC-01.1, AC-01.4, SPEC §4.4)', () => {
  test.skipIf(!dbAvailable)('produk ber-varian tanpa variantId → 422', async () => {
    const r = await failOf(() =>
      computeTransaction(db, { items: [{ productId: variantProductId, quantity: 1 }], payments: [] }, { forUpdate: false, validatePayments: false }),
    );
    expect(r.code).toBe('VALIDATION_ERROR');
  });

  test.skipIf(!dbAvailable)('jual varian A: unitPrice 6500, stok sumber varian (30)', async () => {
    const c = await computeTransaction(
      db,
      { items: [{ productId: variantProductId, variantId: variantAId, quantity: 2 }], payments: [] },
      { forUpdate: false, validatePayments: false },
    );
    const line = c.lines[0]!;
    expect(line.variantId).toBe(variantAId);
    expect(line.unitPrice).toBe(6500);
    expect(line.availableStock).toBe(30);
    expect(line.productId).toBe(variantProductId); // product_id = induk
  });

  test.skipIf(!dbAvailable)('stok varian kurang → 409 STOCK_INSUFFICIENT dengan variantId', async () => {
    const r = await failOf(() =>
      computeTransaction(db, { items: [{ productId: variantProductId, variantId: variantAId, quantity: 50 }], payments: [] }, { forUpdate: false, validatePayments: false }),
    );
    expect(r.code).toBe('STOCK_INSUFFICIENT');
    const d = (r.details as { variantId: string; available: number; requested: number }[])[0]!;
    expect(d.variantId).toBe(variantAId);
    expect(d.available).toBe(30);
    expect(d.requested).toBe(50);
  });
});

describe('checkout: produk jasa (AC-04.1)', () => {
  test.skipIf(!dbAvailable)('track_stock=false qty 5 → sukses tanpa cek stok & tanpa movement', async () => {
    const c = await computeTransaction(db, { items: [{ productId: jasaProductId, quantity: 5 }], payments: [] }, { forUpdate: false, validatePayments: false });
    expect(c.lines[0]!.quantity).toBe(5);
    expect(c.stockMovements).toHaveLength(0);
  });
});

describe('commitCheckout: snapshot satuan/varian (AC-03.4)', () => {
  test.skipIf(!dbAvailable)('checkout 2 dus → transaction_items.unit=dus, unit_factor=40, unit_price=40000, cost=1000×40', async () => {
    const input: CheckoutInput = {
      items: [{ productId: baseProductId, unit: 'dus', quantity: 2 }],
      payments: [{ method: 'cash', amount: 80000, cashReceived: 100000 }],
    };
    const res = await commitCheckout(input, testUser, `itest-${Date.now()}`, null, 'test');
    const item = res.items[0]!;
    expect(item.unit).toBe('dus');
    expect(Number(item.unitFactor)).toBe(40);
    expect(Number(item.unitPrice)).toBe(40000);
    expect(Number(item.costPrice)).toBe(40000); // 1000 × 40
    expect(Number(item.quantity)).toBe(2);
    // movement sale_out qty = 80 (unit dasar)
    const mov = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.transactionId, res.transaction.id), eq(stockMovements.type, 'sale_out')))
      .limit(1);
    expect(Number(mov[0]!.quantity)).toBe(80);
    // stok berkurang tepat 80 (100 → 20, AC-03.3)
    const [p] = await db.select({ stockOnHand: products.stockOnHand }).from(products).where(eq(products.id, baseProductId));
    expect(Number(p!.stockOnHand)).toBe(20);
    // invariant F3: stok gudang default juga 20
    const defaultWhId = await getDefaultWarehouseId(db);
    const [ws] = await db
      .select({ id: warehouseStocks.id, quantity: warehouseStocks.quantity })
      .from(warehouseStocks)
      .where(and(eq(warehouseStocks.warehouseId, defaultWhId), eq(warehouseStocks.productId, baseProductId), isNull(warehouseStocks.productVariantId)));
    expect(Number(ws!.quantity)).toBe(20);
    // cleanup transaksi test
    await db.delete(transactions).where(eq(transactions.id, res.transaction.id));
    await db.update(products).set({ stockOnHand: 100 }).where(eq(products.id, baseProductId));
    await db.update(warehouseStocks).set({ quantity: 100 }).where(eq(warehouseStocks.id, ws!.id));
  }, 30_000);
});
