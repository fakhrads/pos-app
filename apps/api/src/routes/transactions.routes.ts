/**
 * Transactions (api-design.md §2.9) — POS M3, P0.
 *  - POST /transactions/preview        : pra-hitung tanpa commit (kasir+)
 *  - POST /transactions                : checkout ATOMIK + Idempotency-Key (kasir+)
 *  - GET /transactions                 : list (kasir: hari itu saja — dipaksa server)
 *  - GET /transactions/:id             : detail header+items+payments+returnSummary
 *  - GET /transactions/:id/receipt     : data struk / teks 40 kolom (?format=text)
 *  - POST /transactions/:id/cancel     : void (manager+)
 *  - POST /transactions/:id/payments   : pembayaran tambahan partial (kasir+)
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { transactions } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta, todayRangeWib } from '../lib/http';
import { fail } from '../lib/errors';
import { rateLimit } from '../lib/rate-limit';
import { getSettings, strSetting } from '../lib/settings';
import { computeTransaction, commitCheckout, type CheckoutInput } from '../services/checkout.service';
import { cancelTransaction, addAdditionalPayment } from '../services/transaction.service';
import { loadTransactionDetail, buildReceipt, receiptText } from '../services/receipt';
import { enforceShift } from '../lib/shift';
import { mustAuth, mustManager, getUser, type RouteCtx } from '../middleware/auth';

/* ---------------- schema body checkout ---------------- */
const itemDiscountSchema = t.Object({
  type: t.Enum({ percentage: 'percentage', fixed: 'fixed' }),
  value: t.Number({ exclusiveMinimum: 0 }),
  reason: t.Optional(t.String()),
});
const checkoutBodySchema = t.Object({
  customerId: t.Optional(t.String({ format: 'uuid' })),
  items: t.Array(
    t.Object({
      productId: t.String({ format: 'uuid' }),
      // Fase 2 (SPEC §4.4): varian & satuan opsional — kontrak backward-compatible
      variantId: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
      unit: t.Optional(t.String({ maxLength: 20 })),
      quantity: t.Number({ exclusiveMinimum: 0 }),
      discount: t.Optional(itemDiscountSchema),
    }),
    { minItems: 1 },
  ),
  manualDiscount: t.Optional(itemDiscountSchema),
  discountCode: t.Optional(t.String({ maxLength: 50 })),
  redeemPoints: t.Optional(t.Integer({ exclusiveMinimum: 0 })),
  payments: t.Array(
    t.Object({
      method: t.Enum({ cash: 'cash', qris: 'qris', transfer: 'transfer' }),
      amount: t.Number({ exclusiveMinimum: 0 }),
      cashReceived: t.Optional(t.Number({ minimum: 0 })),
      referenceNumber: t.Optional(t.String({ maxLength: 100 })),
    }),
  ),
  notes: t.Optional(t.String()),
});

/* ---------------- POS routes: kasir+ ---------------- */
const posRoutes = new Elysia()
  .use(mustAuth)
  .post(
    '/transactions/preview',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const body = ctx.body as CheckoutInput;
      const computed = await computeTransaction(db, body, { forUpdate: false, validatePayments: false });
      return ok({
        subtotal: computed.subtotal,
        discountTotal: computed.discountTotal,
        taxTotal: computed.taxTotal,
        total: computed.total,
        pointsEarned: computed.pointsEarned,
        redeemablePoints: computed.membership ? Number(computed.membership.pointsBalance) : 0,
        items: computed.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          name: l.productName,
          unit: l.unit,
          unitFactor: l.unitFactor,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          discountAmount: l.discountAmount,
          taxAmount: l.taxAmount,
          lineTotal: l.lineTotal,
          availableStock: l.availableStock,
        })),
        discountName: computed.discountName,
      });
    },
    {
      body: t.Omit(checkoutBodySchema, ['payments']),
    },
  )
  .post(
    '/transactions',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      if (!rateLimit(`checkout:user:${user.id}`, 30, 60_000)) {
        fail('RATE_LIMITED', 'Terlalu banyak transaksi per menit', 429);
      }
      const idemKey = String(ctx.headers['idempotency-key'] ?? '').trim();
      if (!idemKey) fail('INVALID_PARAM', 'Header Idempotency-Key wajib untuk checkout', 400);

      // Fase 4 (SPEC §4.4, AC-06.3): guard wajib shift terbuka — ADDITIVE, dievaluasi
      // SEBELUM idempotency reserve (409 lebih dulu daripada replay, SPEC §9.4).
      // Service checkout TIDAK disentuh.
      await enforceShift(undefined, user);

      const result = await commitCheckout(
        ctx.body as CheckoutInput,
        user,
        idemKey,
        clientIp(ctx.headers),
        ctx.headers['user-agent'] ?? null,
      );
      if (!result.replay) ctx.set.status = 201;
      return ok({
        transaction: result.transaction,
        items: result.items,
        payments: result.payments,
        receipt: result.receipt,
        pointsEarned: result.pointsEarned,
        replay: result.replay,
      });
    },
    { body: checkoutBodySchema },
  )
  .get('/transactions', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const conds: ReturnType<typeof and>[] = [];
    const q = ctx.query.q?.trim();
    if (q) conds.push(ilike(transactions.invoiceNumber, `%${q}%`) as any);
    if (ctx.query.status) conds.push(eq(transactions.status, ctx.query.status as 'pending' | 'completed' | 'cancelled'));
    if (ctx.query.customerId) conds.push(eq(transactions.customerId, ctx.query.customerId));
    if (ctx.query.userId) conds.push(eq(transactions.userId, ctx.query.userId));

    // Kasir: HANYA transaksi hari ini (dipaksa server — BA §5)
    if (user.role === 'kasir') {
      const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');
      const { from, to } = todayRangeWib(tz);
      conds.push(gte(transactions.soldAt, from), lte(transactions.soldAt, to));
    } else {
      if (ctx.query.from) conds.push(gte(transactions.soldAt, new Date(ctx.query.from)));
      if (ctx.query.to) conds.push(lte(transactions.soldAt, new Date(ctx.query.to)));
    }
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(transactions).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select({
        id: transactions.id,
        invoiceNumber: transactions.invoiceNumber,
        customerId: transactions.customerId,
        userId: transactions.userId,
        status: transactions.status,
        subtotal: transactions.subtotal,
        discountTotal: transactions.discountTotal,
        taxTotal: transactions.taxTotal,
        total: transactions.total,
        paymentStatus: transactions.paymentStatus,
        pointsEarned: transactions.pointsEarned,
        soldAt: transactions.soldAt,
      })
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.soldAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })
  .get('/transactions/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const detail = await loadTransactionDetail(db, ctx.params.id);
    if (!detail) fail('NOT_FOUND', 'Transaksi tidak ditemukan', 404);
    // Kasir: hanya transaksi hari ini
    if (user.role === 'kasir') {
      const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');
      const { from, to } = todayRangeWib(tz);
      const t = detail.transaction.soldAt.getTime();
      if (t < from.getTime() || t >= to.getTime()) fail('FORBIDDEN', 'Kasir hanya bisa mengakses transaksi hari ini', 403);
    }
    return ok(detail);
  })
  .get('/transactions/:id/receipt', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const receipt = await buildReceipt(db, ctx.params.id);
    if (!receipt) fail('NOT_FOUND', 'Transaksi tidak ditemukan', 404);
    if (user.role === 'kasir') {
      const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');
      const { from, to } = todayRangeWib(tz);
      const t = receipt.transaction.soldAt.getTime();
      if (t < from.getTime() || t >= to.getTime()) fail('FORBIDDEN', 'Kasir hanya bisa mengakses transaksi hari ini', 403);
    }
    if (ctx.query.format === 'text') {
      ctx.set.headers = { ...(ctx.set.headers ?? {}), 'content-type': 'text/plain; charset=utf-8' };
      return receiptText(receipt);
    }
    return ok(receipt);
  })
  .post(
    '/transactions/:id/payments',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const payment = await addAdditionalPayment(
        ctx.params.id,
        {
          method: ctx.body.method,
          amount: ctx.body.amount,
          cashReceived: ctx.body.cashReceived,
          referenceNumber: ctx.body.referenceNumber,
        },
        user,
        clientIp(ctx.headers),
        ctx.headers['user-agent'] ?? null,
      );
      ctx.set.status = 201;
      return ok({ payment });
    },
    {
      body: t.Object({
        method: t.Enum({ cash: 'cash', qris: 'qris', transfer: 'transfer' }),
        amount: t.Number({ exclusiveMinimum: 0 }),
        cashReceived: t.Optional(t.Number({ minimum: 0 })),
        referenceNumber: t.Optional(t.String({ maxLength: 100 })),
      }),
    },
  );

/* ---------------- cancel: manager+ ---------------- */
const managerRoutes = new Elysia()
  .use(mustManager)
  .post(
    '/transactions/:id/cancel',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const reason = String(ctx.body.reason ?? '').trim();
      if (!reason) fail('VALIDATION_ERROR', 'Alasan void wajib diisi', 422);
      const trx = await cancelTransaction(ctx.params.id, reason, user, clientIp(ctx.headers), ctx.headers['user-agent'] ?? null);
      return ok({ transaction: trx });
    },
    { body: t.Object({ reason: t.String({ minLength: 1 }) }) },
  );

export const transactionsRoutes = new Elysia().use(posRoutes).use(managerRoutes);
