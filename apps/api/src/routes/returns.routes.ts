/**
 * Returns (api-design.md §2.10) — M10, P1 (endpoint & skema sudah disiapkan).
 *  - POST /returns   : kasir+ (reason wajib per item, RET-04)
 *  - GET /returns    : kasir: transaksi sendiri; manager+: semua
 *  - GET /returns/:id: detail + items + refund payment + transaksi asal
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { returns } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta } from '../lib/http';
import { fail } from '../lib/errors';
import { createReturn, loadReturnDetail } from '../services/return.service';
import { enforceShift } from '../lib/shift';
import { mustAuth, getUser, type RouteCtx } from '../middleware/auth';

const returnRoutes = new Elysia()
  .use(mustAuth)
  .post(
    '/returns',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      // Fase 4 (SPEC §4.3, AC-07.8): guard wajib shift terbuka — route-level,
      // service return (createReturn) TIDAK disentuh.
      await enforceShift(undefined, user);
      const result = await createReturn(
        {
          transactionId: String(ctx.body.transactionId),
          items: ctx.body.items.map((i: { transactionItemId: string; quantity: number; reason: string }) => ({
            transactionItemId: i.transactionItemId,
            quantity: i.quantity,
            reason: i.reason,
          })),
          refundMethod: ctx.body.refundMethod,
          notes: ctx.body.notes ?? undefined,
        },
        user,
        clientIp(ctx.headers),
        ctx.headers['user-agent'] ?? null,
      );
      ctx.set.status = 201;
      return ok({ return: result.return, items: result.items, refundPayment: result.refundPayment });
    },
    {
      body: t.Object({
        transactionId: t.String({ format: 'uuid' }),
        items: t.Array(
          t.Object({
            transactionItemId: t.String({ format: 'uuid' }),
            quantity: t.Number({ exclusiveMinimum: 0 }),
            reason: t.String({ minLength: 1, error: 'Alasan return wajib (RET-04)' }),
          }),
          { minItems: 1 },
        ),
        refundMethod: t.Enum({ cash: 'cash', qris: 'qris', transfer: 'transfer', points: 'points' }),
        notes: t.Optional(t.String()),
      }),
    },
  )
  .get('/returns', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const conds = [eq(returns.status, 'completed')];
    // Kasir: hanya return yang diproses sendiri
    if (user.role === 'kasir') conds.push(eq(returns.userId, user.id));
    if (ctx.query.transactionId) conds.push(eq(returns.transactionId, ctx.query.transactionId));
    if (ctx.query.from) conds.push(gte(returns.returnedAt, new Date(ctx.query.from)));
    if (ctx.query.to) conds.push(lte(returns.returnedAt, new Date(ctx.query.to)));
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(returns).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select({
        id: returns.id,
        returnNumber: returns.returnNumber,
        transactionId: returns.transactionId,
        customerId: returns.customerId,
        userId: returns.userId,
        status: returns.status,
        refundMethod: returns.refundMethod,
        totalRefund: returns.totalRefund,
        pointsReversed: returns.pointsReversed,
        reason: returns.reason,
        returnedAt: returns.returnedAt,
      })
      .from(returns)
      .where(where)
      .orderBy(desc(returns.returnedAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })
  .get('/returns/:id', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const detail = await loadReturnDetail(ctx.params.id);
    if (!detail) fail('NOT_FOUND', 'Return tidak ditemukan', 404);
    return ok(detail);
  });

export const returnsRoutes = new Elysia().use(returnRoutes);
