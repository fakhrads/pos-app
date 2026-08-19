/**
 * Transfer stok antar gudang (SPEC Fase 3 §4.3) — P0, manager+.
 *  - POST /stock-transfers             : multi-item, 1 nomor dokumen TRF-xxx,
 *                                        langsung jadi (logika: services/stock-transfer.service.ts)
 *  - GET  /stock-transfers             : riwayat dikelompokkan per transferNumber
 *  - GET  /stock-transfers/:number     : detail 1 dokumen (read-only)
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db';
import { stockTransfers, warehouses, products, productVariants, users } from '../db/schema';
import { ok, parsePagination, paginationMeta, clientIp } from '../lib/http';
import { fail } from '../lib/errors';
import { dateRangeWib } from '../lib/stock';
import { createStockTransfer } from '../services/stock-transfer.service';
import { mustManager, getUser, type RouteCtx } from '../middleware/auth';

const num = (v: unknown): number => Number(v ?? 0);

const fromWhAlias = alias(warehouses, 'from_wh');
const toWhAlias = alias(warehouses, 'to_wh');

const transferRoutes = new Elysia()
  .use(mustManager)

  /* POST /stock-transfers — 1 transaksi DB atomik (AC-03.1–03.9) */
  .post('/stock-transfers', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const result = await createStockTransfer(ctx.body, user, clientIp(ctx.headers), ctx.headers['user-agent'] ?? null);
    return ok(result);
  }, {
    body: t.Object({
      fromWarehouseId: t.String({ format: 'uuid' }),
      toWarehouseId: t.String({ format: 'uuid' }),
      items: t.Array(
        t.Object({
          productId: t.String({ format: 'uuid' }),
          variantId: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
          quantity: t.Number(),
          notes: t.Optional(t.Union([t.String(), t.Null()])),
        }),
        { minItems: 1, maxItems: 50 },
      ),
      notes: t.Optional(t.Union([t.String(), t.Null()])),
    }),
  })

  /* GET /stock-transfers — riwayat dikelompokkan per transferNumber (AC-03.10) */
  .get('/stock-transfers', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const q = ctx.query.q?.trim();

    const conds = [];
    if (q) conds.push(ilike(stockTransfers.transferNumber, `%${q}%`));
    if (ctx.query.fromWarehouseId) conds.push(eq(stockTransfers.fromWarehouseId, ctx.query.fromWarehouseId));
    if (ctx.query.toWarehouseId) conds.push(eq(stockTransfers.toWarehouseId, ctx.query.toWarehouseId));
    const { from, to } = dateRangeWib(ctx.query.from, ctx.query.to);
    if (from) conds.push(sql`${stockTransfers.createdAt} >= ${from.toISOString()}`);
    if (to) conds.push(sql`${stockTransfers.createdAt} <= ${to.toISOString()}`);
    const where = conds.length ? and(...conds) : undefined;

    const countRows = await db
      .select({ total: sql<number>`count(DISTINCT ${stockTransfers.transferNumber})::int` })
      .from(stockTransfers)
      .where(where);
    const total = num(countRows[0]?.total);

    const rows = await db
      .select({
        id: stockTransfers.id,
        transferNumber: stockTransfers.transferNumber,
        quantity: stockTransfers.quantity,
        notes: stockTransfers.notes,
        createdAt: stockTransfers.createdAt,
        fromWarehouseId: stockTransfers.fromWarehouseId,
        fromCode: fromWhAlias.code,
        fromName: fromWhAlias.name,
        toWarehouseId: stockTransfers.toWarehouseId,
        toCode: toWhAlias.code,
        toName: toWhAlias.name,
        createdById: users.id,
        createdByName: users.name,
        productId: stockTransfers.productId,
        variantId: stockTransfers.productVariantId,
        sku: products.sku,
        name: products.name,
        variantName: productVariants.name,
        unit: products.unit,
      })
      .from(stockTransfers)
      .leftJoin(fromWhAlias, eq(fromWhAlias.id, stockTransfers.fromWarehouseId))
      .leftJoin(toWhAlias, eq(toWhAlias.id, stockTransfers.toWarehouseId))
      .leftJoin(users, eq(users.id, stockTransfers.createdBy))
      .leftJoin(products, eq(products.id, stockTransfers.productId))
      .leftJoin(productVariants, eq(productVariants.id, stockTransfers.productVariantId))
      .where(where)
      .orderBy(desc(stockTransfers.createdAt), desc(stockTransfers.transferNumber))
      .limit(2000);

    // Grouping per transferNumber — baris satu dokumen berbagi createdAt (1 tx),
    // jadi urutan (createdAt DESC, transferNumber) membuat tiap grup kontigu.
    const groups = new Map<string, {
      transferNumber: string;
      createdAt: Date;
      createdBy: { id: string | null; name: string | null };
      fromWarehouse: { id: string; code: string; name: string };
      toWarehouse: { id: string; code: string; name: string };
      lineCount: number;
      totalQty: number;
      lines: { id: string; productId: string; variantId: string | null; sku: string | null; name: string; variantName: string | null; unit: string; quantity: number; notes: string | null }[];
    }>();
    for (const r of rows) {
      let g = groups.get(r.transferNumber);
      if (!g) {
        g = {
          transferNumber: r.transferNumber,
          createdAt: r.createdAt,
          createdBy: { id: r.createdById, name: r.createdByName },
          fromWarehouse: { id: r.fromWarehouseId, code: r.fromCode ?? '', name: r.fromName ?? '' },
          toWarehouse: { id: r.toWarehouseId, code: r.toCode ?? '', name: r.toName ?? '' },
          lineCount: 0,
          totalQty: 0,
          lines: [],
        };
        groups.set(r.transferNumber, g);
      }
      g.lineCount += 1;
      g.totalQty = num((g.totalQty + num(r.quantity)).toFixed(3));
      g.lines.push({
        id: r.id,
        productId: r.productId,
        variantId: r.variantId,
        sku: r.sku,
        name: r.name ?? '',
        variantName: r.variantName,
        unit: r.unit ?? '',
        quantity: num(r.quantity),
        notes: r.notes,
      });
    }

    const all = [...groups.values()];
    const items = all.slice((page - 1) * perPage, page * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })

  /* GET /stock-transfers/:transferNumber — detail 1 dokumen */
  .get('/stock-transfers/:transferNumber', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const tn = ctx.params.transferNumber;
    const rows = await db
      .select({
        id: stockTransfers.id,
        transferNumber: stockTransfers.transferNumber,
        quantity: stockTransfers.quantity,
        notes: stockTransfers.notes,
        createdAt: stockTransfers.createdAt,
        fromWarehouseId: stockTransfers.fromWarehouseId,
        fromCode: fromWhAlias.code,
        fromName: fromWhAlias.name,
        toWarehouseId: stockTransfers.toWarehouseId,
        toCode: toWhAlias.code,
        toName: toWhAlias.name,
        createdById: users.id,
        createdByName: users.name,
        productId: stockTransfers.productId,
        variantId: stockTransfers.productVariantId,
        sku: products.sku,
        name: products.name,
        variantName: productVariants.name,
        unit: products.unit,
      })
      .from(stockTransfers)
      .leftJoin(fromWhAlias, eq(fromWhAlias.id, stockTransfers.fromWarehouseId))
      .leftJoin(toWhAlias, eq(toWhAlias.id, stockTransfers.toWarehouseId))
      .leftJoin(users, eq(users.id, stockTransfers.createdBy))
      .leftJoin(products, eq(products.id, stockTransfers.productId))
      .leftJoin(productVariants, eq(productVariants.id, stockTransfers.productVariantId))
      .where(eq(stockTransfers.transferNumber, tn))
      .orderBy(stockTransfers.createdAt);

    if (rows.length === 0) fail('STOCK_TRANSFER_NOT_FOUND', 'Nomor transfer tidak ditemukan', 404, { transferNumber: tn });
    const first = rows[0]!;
    const header = {
      transferNumber: first.transferNumber,
      createdAt: first.createdAt,
      createdBy: { id: first.createdById, name: first.createdByName },
      fromWarehouse: { id: first.fromWarehouseId, code: first.fromCode ?? '', name: first.fromName ?? '' },
      toWarehouse: { id: first.toWarehouseId, code: first.toCode ?? '', name: first.toName ?? '' },
      lineCount: rows.length,
      totalQty: num(rows.reduce((a, r) => a + num(r.quantity), 0).toFixed(3)),
    };
    const lines = rows.map((r) => ({
      productId: r.productId,
      variantId: r.variantId,
      sku: r.sku,
      name: r.name ?? '',
      variantName: r.variantName,
      unit: r.unit ?? '',
      quantity: num(r.quantity),
      notes: r.notes,
    }));
    return ok({ transfer: header, lines });
  });

export const stockTransfersRoutes = transferRoutes;
