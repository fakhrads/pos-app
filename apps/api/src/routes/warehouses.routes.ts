/**
 * Warehouses & Stok per Gudang (SPEC Fase 3 §4.1, §4.2, §4.5) — P0.
 *  - GET    /warehouses                            : list + isDefault + itemCount/totalQty
 *  - GET    /warehouses/:id                        : detail + stockSummary
 *  - POST   /warehouses                            : create (manager+; pertama → default)
 *  - PATCH  /warehouses/:id                        : update parsial (manager+)
 *  - POST   /warehouses/:id/default                : set gudang default (manager+)
 *  - DELETE /warehouses/:id                        : soft delete (admin)
 *  - GET    /warehouses/:id/stocks                 : stok per gudang (kasir+, tanpa costPrice)
 *  - GET    /warehouses/:id/stocks/low-stock       : shortcut stok menipis (manager+)
 *  - GET    /warehouses/:id/stock-movements        : kartu stok per produk (kasir+, read-only)
 *  - GET    /warehouses/:id/stock-movements/export : CSV (manager+)
 *
 * Role guard (SPEC §9.3): baca = kasir+ (tanpa harga beli), mutasi = manager+,
 * soft-delete = admin. Semua endpoint mutasi menulis audit log.
 */
import { Elysia, t } from 'elysia';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  warehouses,
  warehouseStocks,
  products,
  productVariants,
  stockMovements,
  users,
  type Warehouse,
} from '../db/schema';
import { ok, toCsv, parsePagination, paginationMeta, clientIp } from '../lib/http';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import {
  getDefaultWarehouseId,
  setDefaultWarehouse,
  isDefaultWarehouse,
  findWarehouse,
  assertActiveWarehouse,
  MUTATION_TYPE_LABEL,
  dateRangeWib,
} from '../lib/stock';
import { mustAuth, mustManager, mustAdmin, getUser, type RouteCtx, type AuthUser } from '../middleware/auth';

/* ---------------- helpers ---------------- */

const num = (v: unknown): number => Number(v ?? 0);

/** Warehouse + ringkasan stok (itemCount = baris, totalQty = Σ qty). */
async function warehouseWithSummary(w: Warehouse): Promise<{ itemCount: number; totalQty: number }> {
  const [row] = await db
    .select({
      itemCount: count(warehouseStocks.id),
      totalQty: sql<number>`coalesce(sum(${warehouseStocks.quantity}), 0)::float8`,
    })
    .from(warehouseStocks)
    .where(eq(warehouseStocks.warehouseId, w.id));
  return { itemCount: num(row?.itemCount), totalQty: num(row?.totalQty) };
}

function serializeWarehouse(w: Warehouse, summary: { itemCount: number; totalQty: number }, isDefault: boolean) {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    address: w.address,
    pic: w.pic,
    capacity: num(w.capacity),
    isActive: w.isActive,
    isDefault,
    itemCount: summary.itemCount,
    totalQty: summary.totalQty,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

/** Kode gudang unik di antara gudang non-deleted (partial unique, SPEC §7.1.1). */
async function assertWarehouseCodeAvailable(code: string, excludeId?: string): Promise<void> {
  const conds = [eq(warehouses.code, code), isNull(warehouses.deletedAt)];
  if (excludeId) conds.push(sql`${warehouses.id} <> ${excludeId}`);
  const rows = await db.select({ id: warehouses.id }).from(warehouses).where(and(...conds)).limit(1);
  if (rows[0]) fail('DUPLICATE_WAREHOUSE_CODE', `Kode gudang '${code}' sudah dipakai`, 409);
}

function stockStatus(quantity: number, minStock: number): 'ok' | 'low' | 'out' {
  if (quantity <= 0) return 'out';
  if (minStock > 0 && quantity <= minStock) return 'low';
  return 'ok';
}

/** Serializer baris stok — kasir TANPA costPrice (SPEC §4.2, AC-02.1). */
function serializeStockRow(row: {
  warehouseId: string;
  productId: string;
  variantId: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  variantName: string | null;
  unit: string;
  quantity: number;
  minStock: number;
  productMinStock: number;
  sellingPrice: number;
  costPrice: number;
  updatedAt: Date;
}, role: AuthUser['role']) {
  const status = stockStatus(row.quantity, row.minStock);
  const base = {
    warehouseId: row.warehouseId,
    productId: row.productId,
    variantId: row.variantId,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    variantName: row.variantName,
    unit: row.unit,
    quantity: row.quantity,
    minStock: row.minStock,
    productMinStock: row.productMinStock,
    status,
    sellingPrice: row.sellingPrice,
    updatedAt: row.updatedAt,
  };
  if (role === 'kasir') return base;
  return { ...base, costPrice: row.costPrice };
}

/* ---------------- read: kasir+ ---------------- */
const kasirRoutes = new Elysia()
  .use(mustAuth)

  /* GET /warehouses — list + isDefault + ringkasan stok */
  .get('/warehouses', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const q = ctx.query.q?.trim();
    const includeInactive = ctx.query.includeInactive === 'true' && user.role !== 'kasir';

    const conds = [isNull(warehouses.deletedAt)];
    if (!includeInactive) conds.push(eq(warehouses.isActive, true));
    if (q) conds.push(or(ilike(warehouses.code, `%${q}%`), ilike(warehouses.name, `%${q}%`)) as any);
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(warehouses).where(where);
    const total = num(countRows[0]?.total);

    const rows = await db
      .select({
        id: warehouses.id,
        code: warehouses.code,
        name: warehouses.name,
        address: warehouses.address,
        pic: warehouses.pic,
        capacity: warehouses.capacity,
        isActive: warehouses.isActive,
        createdAt: warehouses.createdAt,
        updatedAt: warehouses.updatedAt,
        itemCount: count(warehouseStocks.id),
        totalQty: sql<number>`coalesce(sum(${warehouseStocks.quantity}), 0)::float8`,
      })
      .from(warehouses)
      .leftJoin(warehouseStocks, eq(warehouseStocks.warehouseId, warehouses.id))
      .where(where)
      .groupBy(warehouses.id)
      .orderBy(asc(warehouses.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const defaultWhId = await getDefaultWarehouseId(db);
    const items = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      address: r.address,
      pic: r.pic,
      capacity: num(r.capacity),
      isActive: r.isActive,
      isDefault: r.id === defaultWhId,
      itemCount: num(r.itemCount),
      totalQty: num(r.totalQty),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })

  /* GET /warehouses/:id — detail + stockSummary */
  .get('/warehouses/:id', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const w = await findWarehouse(db, ctx.params.id);
    if (!w) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);
    const summary = await warehouseWithSummary(w);
    return ok({ warehouse: serializeWarehouse(w, summary, await isDefaultWarehouse(w.id)), isDefault: await isDefaultWarehouse(w.id) });
  })

  /* GET /warehouses/:id/stocks — stok per gudang (kasir tanpa costPrice) */
  .get('/warehouses/:id/stocks', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const w = await findWarehouse(db, ctx.params.id);
    if (!w) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);

    const { page, perPage } = parsePagination(ctx.query);
    const q = ctx.query.q?.trim();
    const lowStock = ctx.query.lowStock === 'true';
    const includeInactiveProduct = ctx.query.includeInactiveProduct === 'true' && user.role !== 'kasir';

    const conds = [eq(warehouseStocks.warehouseId, w.id), isNull(products.deletedAt)];
    // Kasir: produk nonaktif tidak pernah muncul
    if (!includeInactiveProduct) conds.push(eq(products.isActive, true));
    if (q) {
      conds.push(
        or(
          ilike(products.name, `%${q}%`),
          ilike(products.sku, `%${q}%`),
          ilike(products.barcode, `%${q}%`),
          ilike(productVariants.name, `%${q}%`),
        ) as any,
      );
    }
    if (ctx.query.categoryId) conds.push(eq(products.categoryId, ctx.query.categoryId));
    if (lowStock) {
      // AC-02.2 & §7.2.4: qty 0 ikut; min_stock=0 = threshold nonaktif kecuali qty 0
      conds.push(
        sql`(${warehouseStocks.quantity} = 0 OR (${warehouseStocks.minStock} > 0 AND ${warehouseStocks.quantity} <= ${warehouseStocks.minStock}))`,
      );
      conds.push(eq(products.trackStock, true)); // AC-02.4: jasa tidak muncul
    }
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(warehouseStocks).where(where);
    const total = num(countRows[0]?.total);

    // Sort: lowStock default quantity ASC (AC-02.2); lain default name ASC
    let orderBy: any;
    const sort = ctx.query.sort;
    if (sort === 'sku:asc') orderBy = asc(products.sku);
    else if (sort === 'quantity:asc') orderBy = asc(warehouseStocks.quantity);
    else if (sort === 'name:asc') orderBy = asc(products.name);
    else orderBy = lowStock ? asc(warehouseStocks.quantity) : asc(products.name);

    const rows = await db
      .select({
        warehouseId: warehouseStocks.warehouseId,
        productId: warehouseStocks.productId,
        variantId: warehouseStocks.productVariantId,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        variantName: productVariants.name,
        unit: products.unit,
        quantity: warehouseStocks.quantity,
        minStock: warehouseStocks.minStock,
        productMinStock: products.minStock,
        sellingPrice: products.sellingPrice,
        costPrice: products.costPrice,
        updatedAt: warehouseStocks.updatedAt,
        trackStock: products.trackStock,
      })
      .from(warehouseStocks)
      .innerJoin(products, eq(products.id, warehouseStocks.productId))
      .leftJoin(productVariants, eq(productVariants.id, warehouseStocks.productVariantId))
      .where(where)
      .orderBy(orderBy)
      .limit(perPage)
      .offset((page - 1) * perPage);

    const items = rows.map((r) =>
      serializeStockRow(
        {
          warehouseId: r.warehouseId,
          productId: r.productId,
          variantId: r.variantId,
          sku: r.sku,
          barcode: r.barcode,
          name: r.name,
          variantName: r.variantName,
          unit: r.unit,
          quantity: num(r.quantity),
          minStock: num(r.minStock),
          productMinStock: num(r.productMinStock),
          sellingPrice: num(r.sellingPrice),
          costPrice: num(r.costPrice),
          updatedAt: r.updatedAt,
        },
        user.role,
      ),
    );
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })

  /* GET /warehouses/:id/stock-movements — kartu stok per produk (read-only) */
  .get('/warehouses/:id/stock-movements', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const w = await findWarehouse(db, ctx.params.id);
    if (!w) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);
    const productId = ctx.query.productId;
    if (!productId) fail('VALIDATION_ERROR', 'Kartu stok wajib di-scope per produk (query `productId`)', 422, { field: 'productId' });

    const page = Math.max(1, Number.parseInt(ctx.query.page ?? '1', 10) || 1);
    const perPage = Math.min(200, Math.max(1, Number.parseInt(ctx.query.perPage ?? '50', 10) || 50));

    const conds = [eq(stockMovements.warehouseId, w.id), eq(stockMovements.productId, productId)];
    if (ctx.query.variantId) conds.push(eq(stockMovements.productVariantId, ctx.query.variantId));
    // type boleh diulang (?type=a&type=b)
    const typeRaw = ctx.query.type;
    if (typeRaw) {
      const types = Array.isArray(typeRaw) ? typeRaw : [typeRaw];
      conds.push(inArray(stockMovements.type, types as never));
    }
    const { from, to } = dateRangeWib(ctx.query.from, ctx.query.to);
    if (from) conds.push(sql`${stockMovements.createdAt} >= ${from.toISOString()}`);
    if (to) conds.push(sql`${stockMovements.createdAt} <= ${to.toISOString()}`);
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(stockMovements).where(where);
    const total = num(countRows[0]?.total);

    const rows = await db
      .select({
        id: stockMovements.id,
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        beforeQty: stockMovements.beforeQty,
        afterQty: stockMovements.afterQty,
        reference: stockMovements.reference,
        note: stockMovements.note,
        createdAt: stockMovements.createdAt,
        createdById: stockMovements.createdBy,
        createdByName: users.name,
      })
      .from(stockMovements)
      .leftJoin(users, eq(users.id, stockMovements.createdBy))
      .where(where)
      .orderBy(desc(stockMovements.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const items = rows.map((r) => ({
      id: r.id,
      type: r.type,
      typeLabel: MUTATION_TYPE_LABEL[r.type] ?? r.type,
      quantity: num(r.quantity),
      beforeQty: num(r.beforeQty),
      afterQty: num(r.afterQty),
      reference: r.reference,
      note: r.note,
      createdAt: r.createdAt,
      createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '—' } : null,
    }));
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  });

/* ---------------- manager+ ---------------- */
const managerRoutes = new Elysia()
  .use(mustManager)

  /* GET /warehouses/:id/stocks/low-stock — shortcut halaman "stok menipis per gudang" */
  .get('/warehouses/:id/stocks/low-stock', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const w = await findWarehouse(db, ctx.params.id);
    if (!w) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);

    const rows = await db
      .select({
        warehouseId: warehouseStocks.warehouseId,
        productId: warehouseStocks.productId,
        variantId: warehouseStocks.productVariantId,
        sku: products.sku,
        barcode: products.barcode,
        name: products.name,
        variantName: productVariants.name,
        unit: products.unit,
        quantity: warehouseStocks.quantity,
        minStock: warehouseStocks.minStock,
        productMinStock: products.minStock,
        sellingPrice: products.sellingPrice,
        costPrice: products.costPrice,
        updatedAt: warehouseStocks.updatedAt,
        trackStock: products.trackStock,
      })
      .from(warehouseStocks)
      .innerJoin(products, eq(products.id, warehouseStocks.productId))
      .leftJoin(productVariants, eq(productVariants.id, warehouseStocks.productVariantId))
      .where(
        and(
          eq(warehouseStocks.warehouseId, w.id),
          isNull(products.deletedAt),
          eq(products.isActive, true),
          eq(products.trackStock, true),
          sql`(${warehouseStocks.quantity} = 0 OR (${warehouseStocks.minStock} > 0 AND ${warehouseStocks.quantity} <= ${warehouseStocks.minStock}))`,
        ),
      )
      .orderBy(asc(warehouseStocks.quantity));

    const items = rows.map((r) =>
      serializeStockRow(
        {
          warehouseId: r.warehouseId,
          productId: r.productId,
          variantId: r.variantId,
          sku: r.sku,
          barcode: r.barcode,
          name: r.name,
          variantName: r.variantName,
          unit: r.unit,
          quantity: num(r.quantity),
          minStock: num(r.minStock),
          productMinStock: num(r.productMinStock),
          sellingPrice: num(r.sellingPrice),
          costPrice: num(r.costPrice),
          updatedAt: r.updatedAt,
        },
        'manager',
      ),
    );
    return ok({ items });
  })

  /* GET /warehouses/:id/stock-movements/export — CSV kartu stok (REP-05 pola) */
  .get('/warehouses/:id/stock-movements/export', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const w = await findWarehouse(db, ctx.params.id);
    if (!w) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);
    const productId = ctx.query.productId;
    if (!productId) fail('VALIDATION_ERROR', 'Kartu stok wajib di-scope per produk (query `productId`)', 422, { field: 'productId' });

    const conds = [eq(stockMovements.warehouseId, w.id), eq(stockMovements.productId, productId)];
    if (ctx.query.variantId) conds.push(eq(stockMovements.productVariantId, ctx.query.variantId));
    const typeRaw = ctx.query.type;
    if (typeRaw) {
      const types = Array.isArray(typeRaw) ? typeRaw : [typeRaw];
      conds.push(inArray(stockMovements.type, types as never));
    }
    const { from, to } = dateRangeWib(ctx.query.from, ctx.query.to);
    if (from) conds.push(sql`${stockMovements.createdAt} >= ${from.toISOString()}`);
    if (to) conds.push(sql`${stockMovements.createdAt} <= ${to.toISOString()}`);
    const where = and(...conds);

    const rows = await db
      .select({
        type: stockMovements.type,
        quantity: stockMovements.quantity,
        beforeQty: stockMovements.beforeQty,
        afterQty: stockMovements.afterQty,
        reference: stockMovements.reference,
        note: stockMovements.note,
        createdAt: stockMovements.createdAt,
        createdByName: users.name,
      })
      .from(stockMovements)
      .leftJoin(users, eq(users.id, stockMovements.createdBy))
      .where(where)
      .orderBy(desc(stockMovements.createdAt))
      .limit(10_000);

    const skuRow = await db
      .select({ sku: products.sku })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const sku = skuRow[0]?.sku ?? 'produk';
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const csvRows = rows.map((r) => ({
      tanggal: (r.createdAt as Date).toISOString(),
      tipe: MUTATION_TYPE_LABEL[r.type] ?? r.type,
      masuk: num(r.quantity) > 0 && (r.beforeQty as number) <= (r.afterQty as number) ? num(r.quantity) : '',
      keluar: (r.beforeQty as number) > (r.afterQty as number) ? num(r.quantity) : '',
      sebelum: num(r.beforeQty),
      sesudah: num(r.afterQty),
      referensi: r.reference ?? '',
      catatan: r.note ?? '',
      dibuat_oleh: r.createdByName ?? '',
    }));

    ctx.set.headers = {
      ...(ctx.set.headers ?? {}),
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="stock-card-${w.code}-${sku}-${today}.csv"`,
    };
    return toCsv(csvRows);
  })

  /* POST /warehouses — create (pertama → otomatis default, SPEC §4.1) */
  .post('/warehouses', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const code = String(ctx.body.code).trim();
    if (!code) fail('VALIDATION_ERROR', 'Kode gudang wajib diisi', 422, { field: 'code' });
    await assertWarehouseCodeAvailable(code);

    const isFirst = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(isNull(warehouses.deletedAt))
      .limit(1);

    const [w] = await db
      .insert(warehouses)
      .values({
        code,
        name: String(ctx.body.name).trim(),
        address: ctx.body.address ?? null,
        pic: ctx.body.pic ?? null,
        capacity: num(ctx.body.capacity ?? 0),
        isActive: ctx.body.isActive ?? true,
      })
      .returning();

    let isDefault = false;
    if (isFirst.length === 0) {
      // Gudang pertama → default (SPEC §4.1, §7.1.2)
      await setDefaultWarehouse(db, w.id);
      isDefault = true;
    }

    await writeAudit(db, {
      userId: user.id,
      action: 'warehouse.create',
      entityType: 'warehouse',
      entityId: w.id,
      newValues: { code: w.code, name: w.name, capacity: num(w.capacity), isActive: w.isActive, isDefault },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ warehouse: serializeWarehouse(w, { itemCount: 0, totalQty: 0 }, isDefault), isDefault });
  }, {
    body: t.Object({
      code: t.String({ minLength: 1, maxLength: 20 }),
      name: t.String({ minLength: 1, maxLength: 150 }),
      address: t.Optional(t.Union([t.String(), t.Null()])),
      pic: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
      capacity: t.Optional(t.Number({ minimum: 0 })),
      isActive: t.Optional(t.Boolean()),
    }),
  })

  /* PATCH /warehouses/:id — update parsial; nonaktifkan default → 409 */
  .patch('/warehouses/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const w = await findWarehouse(db, ctx.params.id);
    if (!w) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);

    const patch: Partial<Warehouse> = {};
    if (ctx.body.code !== undefined) {
      const code = String(ctx.body.code).trim();
      if (!code) fail('VALIDATION_ERROR', 'Kode gudang wajib diisi', 422, { field: 'code' });
      await assertWarehouseCodeAvailable(code, w.id);
      patch.code = code;
    }
    if (ctx.body.name !== undefined) patch.name = String(ctx.body.name).trim();
    if (ctx.body.address !== undefined) patch.address = ctx.body.address ?? null;
    if (ctx.body.pic !== undefined) patch.pic = ctx.body.pic ?? null;
    if (ctx.body.capacity !== undefined) patch.capacity = num(ctx.body.capacity);
    if (ctx.body.isActive !== undefined) {
      if (ctx.body.isActive === false && (await isDefaultWarehouse(w.id))) {
        fail('WAREHOUSE_IS_DEFAULT', 'Gudang default tidak bisa dinonaktifkan — pindah default dulu via POST /warehouses/:id/default', 409);
      }
      patch.isActive = Boolean(ctx.body.isActive);
    }

    if (Object.keys(patch).length === 0) fail('VALIDATION_ERROR', 'Tidak ada field yang bisa di-update', 422);

    const [updated] = await db.update(warehouses).set(patch).where(eq(warehouses.id, w.id)).returning();
    await writeAudit(db, {
      userId: user.id,
      action: 'warehouse.update',
      entityType: 'warehouse',
      entityId: w.id,
      oldValues: { code: w.code, name: w.name, pic: w.pic, capacity: num(w.capacity), isActive: w.isActive },
      newValues: {
        code: updated.code,
        name: updated.name,
        pic: updated.pic,
        capacity: num(updated.capacity),
        isActive: updated.isActive,
      },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ warehouse: serializeWarehouse(updated, await warehouseWithSummary(updated), await isDefaultWarehouse(updated.id)) });
  }, {
    body: t.Object({
      code: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
      name: t.Optional(t.String({ minLength: 1, maxLength: 150 })),
      address: t.Optional(t.Union([t.String(), t.Null()])),
      pic: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
      capacity: t.Optional(t.Number({ minimum: 0 })),
      isActive: t.Optional(t.Boolean()),
    }),
  })

  /* POST /warehouses/:id/default — set gudang penjualan default */
  .post('/warehouses/:id/default', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const w = await assertActiveWarehouse(db, ctx.params.id, 'Gudang');
    await setDefaultWarehouse(db, w.id);
    await writeAudit(db, {
      userId: user.id,
      action: 'warehouse.set_default',
      entityType: 'warehouse',
      entityId: w.id,
      newValues: { code: w.code, name: w.name },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ warehouse: serializeWarehouse(w, await warehouseWithSummary(w), true), isDefault: true });
  });

/* ---------------- admin: soft-delete ---------------- */
const adminRoutes = new Elysia()
  .use(mustAdmin)

  /* DELETE /warehouses/:id — soft delete; default → 409; stok & riwayat tetap */
  .delete('/warehouses/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const w = await findWarehouse(db, ctx.params.id);
    if (!w) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);
    if (await isDefaultWarehouse(w.id)) {
      fail('WAREHOUSE_IS_DEFAULT', 'Gudang default tidak bisa dihapus — pindah default dulu via POST /warehouses/:id/default', 409);
    }
    await db
      .update(warehouses)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(warehouses.id, w.id));
    await writeAudit(db, {
      userId: user.id,
      action: 'warehouse.delete',
      entityType: 'warehouse',
      entityId: w.id,
      oldValues: { code: w.code, name: w.name, isActive: w.isActive },
      newValues: { deleted: true },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: w.id, deleted: true });
  });

export const warehousesRoutes = new Elysia().use(kasirRoutes).use(managerRoutes).use(adminRoutes);
