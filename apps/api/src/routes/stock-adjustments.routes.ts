/**
 * Koreksi stok / adjustment (SPEC Fase 3 §4.4) — P0, manager+.
 *  - POST /stock-adjustments : manual adjust ±, alasan WAJIB dari daftar tetap
 *                              (logika: services/stock-adjustment.service.ts)
 *  - GET  /stock-adjustments : riwayat read-only (filter warehouse/product/reason/tanggal)
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { stockAdjustments, warehouses, products, productVariants, users } from '../db/schema';
import { ok, parsePagination, paginationMeta, clientIp } from '../lib/http';
import { ADJUSTMENT_REASON_LABEL, dateRangeWib } from '../lib/stock';
import { createStockAdjustment } from '../services/stock-adjustment.service';
import { mustManager, getUser, type RouteCtx } from '../middleware/auth';

const num = (v: unknown): number => Number(v ?? 0);

const adjustmentRoutes = new Elysia()
  .use(mustManager)

  /* POST /stock-adjustments — 1 transaksi DB atomik (AC-04.1–04.4, 04.6) */
  .post('/stock-adjustments', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const result = await createStockAdjustment(ctx.body, user, clientIp(ctx.headers), ctx.headers['user-agent'] ?? null);
    return ok(result);
  }, {
    body: t.Object({
      warehouseId: t.String({ format: 'uuid' }),
      productId: t.String({ format: 'uuid' }),
      variantId: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
      quantityDelta: t.Number(),
      reason: t.String({ minLength: 1, maxLength: 50 }),
      note: t.Optional(t.Union([t.String(), t.Null()])),
    }),
  })

  /* GET /stock-adjustments — riwayat read-only (AC-04.5) */
  .get('/stock-adjustments', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);

    const conds = [];
    if (ctx.query.warehouseId) conds.push(eq(stockAdjustments.warehouseId, ctx.query.warehouseId));
    if (ctx.query.productId) conds.push(eq(stockAdjustments.productId, ctx.query.productId));
    if (ctx.query.reason) conds.push(eq(stockAdjustments.reason, ctx.query.reason.trim().toLowerCase()));
    const { from, to } = dateRangeWib(ctx.query.from, ctx.query.to);
    if (from) conds.push(sql`${stockAdjustments.createdAt} >= ${from.toISOString()}`);
    if (to) conds.push(sql`${stockAdjustments.createdAt} <= ${to.toISOString()}`);
    const where = conds.length ? and(...conds) : undefined;

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(stockAdjustments).where(where);
    const total = num(countRows[0]?.total);

    const rows = await db
      .select({
        id: stockAdjustments.id,
        quantityDelta: stockAdjustments.quantityDelta,
        reason: stockAdjustments.reason,
        note: stockAdjustments.note,
        createdAt: stockAdjustments.createdAt,
        warehouseId: stockAdjustments.warehouseId,
        warehouseCode: warehouses.code,
        warehouseName: warehouses.name,
        productId: stockAdjustments.productId,
        productSku: products.sku,
        productName: products.name,
        variantId: stockAdjustments.productVariantId,
        variantName: productVariants.name,
        createdById: users.id,
        createdByName: users.name,
      })
      .from(stockAdjustments)
      .leftJoin(warehouses, eq(warehouses.id, stockAdjustments.warehouseId))
      .leftJoin(products, eq(products.id, stockAdjustments.productId))
      .leftJoin(productVariants, eq(productVariants.id, stockAdjustments.productVariantId))
      .leftJoin(users, eq(users.id, stockAdjustments.createdBy))
      .where(where)
      .orderBy(desc(stockAdjustments.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const items = rows.map((r) => ({
      id: r.id,
      warehouse: { id: r.warehouseId, code: r.warehouseCode ?? '', name: r.warehouseName ?? '' },
      product: { id: r.productId, sku: r.productSku, name: r.productName ?? '' },
      variant: r.variantId && r.variantName ? { id: r.variantId, name: r.variantName } : undefined,
      quantityDelta: num(r.quantityDelta),
      reason: r.reason,
      reasonLabel: ADJUSTMENT_REASON_LABEL[r.reason] ?? r.reason,
      note: r.note,
      createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '—' } : null,
      createdAt: r.createdAt,
    }));
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  });

export const stockAdjustmentsRoutes = adjustmentRoutes;
