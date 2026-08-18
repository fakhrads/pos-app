/**
 * Products (api-design.md §2.4) — baca: kasir+; tulis: manager+; delete: admin.
 *  - GET /products            : list + filter q/categoryId/isActive/lowStock + pagination
 *  - GET /products/barcode/:b : hot path POS (scan barcode/SKU)
 *  - POST /products           : create (harga integer rupiah)
 *  - PATCH /products/:id      : update parsial (riwayat harga via audit)
 *  - DELETE /products/:id     : soft delete (admin)
 *  - PATCH /products/:id/stock: adjust stok (purchase_in/adjustment, alasan wajib)
 *  - GET /products/:id/stock-movements : ledger
 */
import { Elysia, t } from 'elysia';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { products, categories, stockMovements } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta, parseSort } from '../lib/http';
import { fail } from '../lib/errors';
import { toQty } from '../lib/money';
import { writeAudit } from '../lib/audit';
import { mustAuth, mustManager, mustAdmin, getUser, type RouteCtx, type AuthUser } from '../middleware/auth';

/* ---------------- helpers ---------------- */

async function findProduct(id: string) {
  const rows = await db.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1);
  return rows[0] ?? null;
}

async function ensureCategoryExists(categoryId: string): Promise<void> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .limit(1);
  if (!rows[0]) fail('INVALID_PARAM', 'Kategori tidak ditemukan', 422, { field: 'categoryId' });
}

function buildListQuery(q: Record<string, string | undefined>, role: AuthUser['role']) {
  const conds: ReturnType<typeof and>[] = [isNull(products.deletedAt)];
  const search = q.q?.trim();
  if (search) {
    conds.push(or(ilike(products.name, `%${search}%`), ilike(products.sku, `%${search}%`), ilike(products.barcode, `%${search}%`)) as any);
  }
  if (q.categoryId) conds.push(eq(products.categoryId, q.categoryId));
  // Kasir: produk nonaktif tidak muncul (BA PROD-08)
  const isActive = role === 'kasir' ? true : q.isActive === undefined ? undefined : q.isActive === 'true';
  if (isActive !== undefined) conds.push(eq(products.isActive, isActive));
  if (q.lowStock === 'true') {
    conds.push(sql`${products.stockOnHand} <= ${products.minStock}`);
    conds.push(eq(products.isActive, true));
  }
  return and(...conds);
}

/* ---------------- read: kasir+ ---------------- */
const readRoutes = new Elysia()
  .use(mustAuth)
  .get('/products', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const where = buildListQuery(ctx.query, user.role);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
    const total = Number(countRows[0]?.total ?? 0);

    const sort = parseSort(ctx.query, ['created_at', 'name', 'selling_price', 'stock_on_hand']);
    let orderBy = desc(products.createdAt);
    if (sort) {
      const col = sort.field === 'name' ? products.name : sort.field === 'selling_price' ? products.sellingPrice : sort.field === 'stock_on_hand' ? products.stockOnHand : products.createdAt;
      orderBy = sort.dir === 'asc' ? asc(col) : desc(col);
    }
    const items = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(orderBy)
      .limit(perPage)
      .offset((page - 1) * perPage);

    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })
  .get('/products/barcode/:barcode', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const code = ctx.params.barcode.trim();
    const rows = await db
      .select()
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.isActive, true), or(eq(products.barcode, code), eq(products.sku, code))))
      .limit(1);
    const product = rows[0];
    if (!product) fail('BARCODE_NOT_FOUND', `Produk dengan barcode/SKU '${code}' tidak ditemukan`, 404);
    return ok({ product, stockOnHand: Number(product.stockOnHand) });
  })
  .get('/products/:id', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const product = await findProduct(ctx.params.id);
    if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
    return ok({ product, stockOnHand: Number(product.stockOnHand) });
  });

/* ---------------- write: manager+ ---------------- */
const writeRoutes = new Elysia()
  .use(mustManager)
  .post(
    '/products',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      await ensureCategoryExists(String(ctx.body.categoryId));

      const sku = ctx.body.sku?.trim() || null;
      const barcode = ctx.body.barcode?.trim() || null;
      if (sku) {
        const dup = await db.select({ id: products.id }).from(products).where(and(eq(products.sku, sku), isNull(products.deletedAt))).limit(1);
        if (dup[0]) fail('DUPLICATE_SKU', `SKU '${sku}' sudah dipakai`, 409);
      }
      if (barcode) {
        const dup = await db.select({ id: products.id }).from(products).where(and(eq(products.barcode, barcode), isNull(products.deletedAt))).limit(1);
        if (dup[0]) fail('DUPLICATE_BARCODE', `Barcode '${barcode}' sudah dipakai`, 409);
      }

      const [product] = await db
        .insert(products)
        .values({
          categoryId: String(ctx.body.categoryId),
          name: String(ctx.body.name),
          sku,
          barcode,
          unit: ctx.body.unit ?? 'pcs',
          description: ctx.body.description ?? null,
          costPrice: Math.round(Number(ctx.body.costPrice)),
          sellingPrice: Math.round(Number(ctx.body.sellingPrice)),
          minStock: toQty(ctx.body.minStock ?? 0),
          isTaxable: ctx.body.isTaxable ?? true,
          isActive: true,
        })
        .returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'product.create',
        entityType: 'product',
        entityId: product.id,
        newValues: { name: product.name, sku: product.sku, sellingPrice: Number(product.sellingPrice) },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ product });
    },
    {
      body: t.Object({
        categoryId: t.String({ format: 'uuid' }),
        name: t.String({ minLength: 1, maxLength: 200 }),
        sku: t.Optional(t.String({ maxLength: 50 })),
        barcode: t.Optional(t.String({ maxLength: 100 })),
        unit: t.Optional(t.String({ maxLength: 20 })),
        description: t.Optional(t.String()),
        costPrice: t.Number({ minimum: 0 }),
        sellingPrice: t.Number({ minimum: 0 }),
        minStock: t.Optional(t.Number({ minimum: 0 })),
        isTaxable: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    '/products/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const product = await findProduct(ctx.params.id);
      if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      const oldValues = {
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        costPrice: Number(product.costPrice),
        sellingPrice: Number(product.sellingPrice),
        isActive: product.isActive,
        isTaxable: product.isTaxable,
        minStock: Number(product.minStock),
        unit: product.unit,
        categoryId: product.categoryId,
      };
      if (ctx.body.name !== undefined) patch.name = String(ctx.body.name);
      if (ctx.body.description !== undefined) patch.description = ctx.body.description ?? null;
      if (ctx.body.unit !== undefined) patch.unit = String(ctx.body.unit);
      if (ctx.body.categoryId !== undefined) {
        await ensureCategoryExists(String(ctx.body.categoryId));
        patch.categoryId = String(ctx.body.categoryId);
      }
      if (ctx.body.costPrice !== undefined) patch.costPrice = Math.round(Number(ctx.body.costPrice));
      if (ctx.body.sellingPrice !== undefined) patch.sellingPrice = Math.round(Number(ctx.body.sellingPrice));
      if (ctx.body.minStock !== undefined) patch.minStock = toQty(ctx.body.minStock);
      if (ctx.body.isActive !== undefined) patch.isActive = Boolean(ctx.body.isActive);
      if (ctx.body.isTaxable !== undefined) patch.isTaxable = Boolean(ctx.body.isTaxable);

      if (ctx.body.sku !== undefined) {
        const sku = String(ctx.body.sku).trim() || null;
        if (sku) {
          const dup = await db
            .select({ id: products.id })
            .from(products)
            .where(and(eq(products.sku, sku), isNull(products.deletedAt), sql`${products.id} <> ${product.id}`))
            .limit(1);
          if (dup[0]) fail('DUPLICATE_SKU', `SKU '${sku}' sudah dipakai`, 409);
        }
        patch.sku = sku;
      }
      if (ctx.body.barcode !== undefined) {
        const barcode = String(ctx.body.barcode).trim() || null;
        if (barcode) {
          const dup = await db
            .select({ id: products.id })
            .from(products)
            .where(and(eq(products.barcode, barcode), isNull(products.deletedAt), sql`${products.id} <> ${product.id}`))
            .limit(1);
          if (dup[0]) fail('DUPLICATE_BARCODE', `Barcode '${barcode}' sudah dipakai`, 409);
        }
        patch.barcode = barcode;
      }

      const [updated] = await db.update(products).set(patch).where(eq(products.id, product.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'product.update',
        entityType: 'product',
        entityId: product.id,
        oldValues,
        newValues: {
          name: updated.name,
          sku: updated.sku,
          barcode: updated.barcode,
          costPrice: Number(updated.costPrice),
          sellingPrice: Number(updated.sellingPrice),
          isActive: updated.isActive,
          isTaxable: updated.isTaxable,
          minStock: Number(updated.minStock),
          unit: updated.unit,
          categoryId: updated.categoryId,
        },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ product: updated });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        categoryId: t.Optional(t.String({ format: 'uuid' })),
        sku: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
        barcode: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        unit: t.Optional(t.String({ maxLength: 20 })),
        costPrice: t.Optional(t.Number({ minimum: 0 })),
        sellingPrice: t.Optional(t.Number({ minimum: 0 })),
        minStock: t.Optional(t.Number({ minimum: 0 })),
        isActive: t.Optional(t.Boolean()),
        isTaxable: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    '/products/:id/stock',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const product = await findProduct(ctx.params.id);
      if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);

      const type = ctx.body.type as 'purchase_in' | 'adjustment';
      const delta = toQty(ctx.body.quantityDelta);
      if (delta === 0) fail('VALIDATION_ERROR', 'quantityDelta tidak boleh 0', 422);
      if (type === 'purchase_in' && delta < 0) {
        fail('VALIDATION_ERROR', 'purchase_in hanya untuk menambah stok (delta > 0)', 422);
      }
      const reason = String(ctx.body.note ?? '').trim();
      if (!reason) fail('VALIDATION_ERROR', 'Alasan (note) wajib diisi', 422);

      const result = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(products).where(eq(products.id, product.id)).for('update').limit(1);
        if (!locked) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
        const before = Number(locked.stockOnHand);
        const after = toQty(before + delta);
        if (after < 0) {
          fail('STOCK_INSUFFICIENT', `Stok tidak cukup (tersisa ${before}, diminta ${Math.abs(delta)})`, 409, {
            productId: product.id,
            available: before,
            requested: Math.abs(delta),
          });
        }
        await tx.update(products).set({ stockOnHand: after }).where(eq(products.id, product.id));
        await tx.insert(stockMovements).values({
          productId: product.id,
          type,
          quantity: Math.abs(delta),
          beforeQty: before,
          afterQty: after,
          reference: ctx.body.reference ?? null,
          note: reason,
          createdBy: user.id,
        });
        return { before, after };
      });

      await writeAudit(db, {
        userId: user.id,
        action: 'stock.adjustment',
        entityType: 'product',
        entityId: product.id,
        newValues: { type, delta, before: result.before, after: result.after, note: reason },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ productId: product.id, before: result.before, after: result.after, type });
    },
    {
      body: t.Object({
        quantityDelta: t.Number(),
        type: t.Enum({ purchase_in: 'purchase_in', adjustment: 'adjustment' }),
        reference: t.Optional(t.String({ maxLength: 100 })),
        note: t.String({ minLength: 1, error: 'Alasan wajib diisi' }),
      }),
    },
  )
  .get('/products/:id/stock-movements', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const product = await findProduct(ctx.params.id);
    if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
    const { page, perPage } = parsePagination(ctx.query);
    const conds = [eq(stockMovements.productId, product.id)];
    if (ctx.query.from) conds.push(gte(stockMovements.createdAt, new Date(ctx.query.from)));
    if (ctx.query.to) conds.push(lte(stockMovements.createdAt, new Date(ctx.query.to)));
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(stockMovements).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select()
      .from(stockMovements)
      .where(where)
      .orderBy(desc(stockMovements.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  });

/* ---------------- delete: admin ---------------- */
const deleteRoutes = new Elysia()
  .use(mustAdmin)
  .delete('/products/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const product = await findProduct(ctx.params.id);
    if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);

    await db.update(products).set({ deletedAt: new Date(), isActive: false }).where(eq(products.id, product.id));
    await writeAudit(db, {
      userId: user.id,
      action: 'product.delete',
      entityType: 'product',
      entityId: product.id,
      newValues: { name: product.name, deletedAt: new Date().toISOString() },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: product.id, deleted: true });
  });

export const productsRoutes = new Elysia().use(readRoutes).use(writeRoutes).use(deleteRoutes);
