/**
 * Discounts (api-design.md §2.7) — promo terstruktur; tulis: admin.
 * Diskon manual kasir tidak lewat resource ini (dikirim langsung di body checkout).
 *  - GET /discounts                    : list (manager+)
 *  - GET /discounts/validate?code=...  : validasi kode saat checkout (kasir+)
 *  - POST/PATCH/DELETE                 : admin
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { discounts } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta } from '../lib/http';
import { fail } from '../lib/errors';
import { percentOf } from '../lib/money';
import { writeAudit } from '../lib/audit';
import { mustAuth, mustManager, mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

const readRoutes = new Elysia()
  .use(mustManager)
  .get('/discounts', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const conds = [isNull(discounts.deletedAt)];
    const q = ctx.query.q?.trim();
    if (q) conds.push(or(ilike(discounts.name, `%${q}%`), ilike(discounts.code, `%${q}%`)) as any);
    if (ctx.query.isActive !== undefined) conds.push(eq(discounts.isActive, ctx.query.isActive === 'true'));
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(discounts).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select()
      .from(discounts)
      .where(where)
      .orderBy(desc(discounts.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  });

const validateRoutes = new Elysia()
  .use(mustAuth)
  .get('/discounts/validate', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const code = String(ctx.query.code ?? '').trim();
    if (!code) fail('INVALID_PARAM', 'Query `code` wajib', 400);
    const now = new Date();
    const rows = await db
      .select()
      .from(discounts)
      .where(and(eq(discounts.code, code), eq(discounts.isActive, true), isNull(discounts.deletedAt)))
      .limit(1);
    const d = rows[0];
    if (!d) fail('DISCOUNT_INVALID', `Kode promo '${code}' tidak ditemukan`, 422);
    if (d.validFrom && d.validFrom > now) fail('DISCOUNT_INVALID', 'Kode promo belum berlaku', 422);
    if (d.validTo && d.validTo < now) fail('DISCOUNT_INVALID', 'Kode promo sudah kedaluwarsa', 422);
    if (d.usageLimit != null && Number(d.usedCount) >= Number(d.usageLimit)) {
      fail('DISCOUNT_INVALID', 'Kuota kode promo sudah habis', 422);
    }

    let calculatedAmount: number | null = null;
    const subtotal = ctx.query.subtotal !== undefined ? Number(ctx.query.subtotal) : NaN;
    if (Number.isFinite(subtotal) && subtotal > 0) {
      calculatedAmount =
        d.type === 'percentage' ? percentOf(subtotal, Number(d.value)) : Math.min(Math.round(Number(d.value)), subtotal);
      if (d.maxDiscountAmount != null) calculatedAmount = Math.min(calculatedAmount, Number(d.maxDiscountAmount));
    }

    return ok({
      discount: {
        id: d.id,
        name: d.name,
        code: d.code,
        type: d.type,
        value: Number(d.value),
        scope: d.scope,
        productId: d.productId,
        categoryId: d.categoryId,
        validFrom: d.validFrom,
        validTo: d.validTo,
        maxDiscountAmount: d.maxDiscountAmount != null ? Number(d.maxDiscountAmount) : null,
      },
      calculatedAmount,
    });
  });

const adminRoutes = new Elysia()
  .use(mustAdmin)
  .post(
    '/discounts',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const scope = ctx.body.scope;
      if (scope === 'product' && !ctx.body.productId) fail('VALIDATION_ERROR', 'productId wajib saat scope=product', 422);
      if (scope === 'category' && !ctx.body.categoryId) fail('VALIDATION_ERROR', 'categoryId wajib saat scope=category', 422);
      if (ctx.body.code) {
        const dup = await db.select({ id: discounts.id }).from(discounts).where(and(eq(discounts.code, ctx.body.code), isNull(discounts.deletedAt))).limit(1);
        if (dup[0]) fail('CONFLICT', `Kode '${ctx.body.code}' sudah dipakai`, 409);
      }
      const [discount] = await db
        .insert(discounts)
        .values({
          name: String(ctx.body.name),
          code: ctx.body.code ?? null,
          type: ctx.body.type,
          value: Number(ctx.body.value),
          scope,
          productId: ctx.body.productId ?? null,
          categoryId: ctx.body.categoryId ?? null,
          validFrom: ctx.body.validFrom ? new Date(ctx.body.validFrom) : null,
          validTo: ctx.body.validTo ? new Date(ctx.body.validTo) : null,
          maxDiscountAmount: ctx.body.maxDiscountAmount ?? null,
          usageLimit: ctx.body.usageLimit ?? null,
        })
        .returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'discount.create',
        entityType: 'discount',
        entityId: discount.id,
        newValues: { name: discount.name, code: discount.code, type: discount.type, value: Number(discount.value), scope: discount.scope },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ discount });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        code: t.Optional(t.String({ maxLength: 50 })),
        type: t.Enum({ percentage: 'percentage', fixed: 'fixed' }),
        value: t.Number({ exclusiveMinimum: 0 }),
        scope: t.Enum({ global: 'global', category: 'category', product: 'product' }),
        productId: t.Optional(t.String({ format: 'uuid' })),
        categoryId: t.Optional(t.String({ format: 'uuid' })),
        validFrom: t.Optional(t.String({ format: 'date-time' })),
        validTo: t.Optional(t.String({ format: 'date-time' })),
        maxDiscountAmount: t.Optional(t.Number({ minimum: 0 })),
        usageLimit: t.Optional(t.Number({ exclusiveMinimum: 0 })),
      }),
    },
  )
  .patch(
    '/discounts/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const rows = await db.select().from(discounts).where(and(eq(discounts.id, ctx.params.id), isNull(discounts.deletedAt))).limit(1);
      const discount = rows[0];
      if (!discount) fail('NOT_FOUND', 'Diskon tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      if (ctx.body.name !== undefined) patch.name = String(ctx.body.name);
      if (ctx.body.type !== undefined) patch.type = ctx.body.type;
      if (ctx.body.value !== undefined) patch.value = Number(ctx.body.value);
      if (ctx.body.isActive !== undefined) patch.isActive = Boolean(ctx.body.isActive);
      if (ctx.body.validFrom !== undefined) patch.validFrom = ctx.body.validFrom ? new Date(ctx.body.validFrom) : null;
      if (ctx.body.validTo !== undefined) patch.validTo = ctx.body.validTo ? new Date(ctx.body.validTo) : null;
      if (ctx.body.maxDiscountAmount !== undefined) patch.maxDiscountAmount = ctx.body.maxDiscountAmount ?? null;
      if (ctx.body.usageLimit !== undefined) patch.usageLimit = ctx.body.usageLimit ?? null;
      if (ctx.body.code !== undefined) {
        if (ctx.body.code) {
          const dup = await db
            .select({ id: discounts.id })
            .from(discounts)
            .where(and(eq(discounts.code, ctx.body.code), isNull(discounts.deletedAt), sql`${discounts.id} <> ${discount.id}`))
            .limit(1);
          if (dup[0]) fail('CONFLICT', `Kode '${ctx.body.code}' sudah dipakai`, 409);
        }
        patch.code = ctx.body.code || null;
      }

      const [updated] = await db.update(discounts).set(patch).where(eq(discounts.id, discount.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'discount.update',
        entityType: 'discount',
        entityId: discount.id,
        oldValues: { name: discount.name, isActive: discount.isActive },
        newValues: { name: updated.name, isActive: updated.isActive },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ discount: updated });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        code: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
        type: t.Optional(t.Enum({ percentage: 'percentage', fixed: 'fixed' })),
        value: t.Optional(t.Number({ exclusiveMinimum: 0 })),
        isActive: t.Optional(t.Boolean()),
        validFrom: t.Optional(t.Union([t.String({ format: 'date-time' }), t.Null()])),
        validTo: t.Optional(t.Union([t.String({ format: 'date-time' }), t.Null()])),
        maxDiscountAmount: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
        usageLimit: t.Optional(t.Union([t.Number({ exclusiveMinimum: 0 }), t.Null()])),
      }),
    },
  )
  .delete('/discounts/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const rows = await db.select({ id: discounts.id }).from(discounts).where(and(eq(discounts.id, ctx.params.id), isNull(discounts.deletedAt))).limit(1);
    if (!rows[0]) fail('NOT_FOUND', 'Diskon tidak ditemukan', 404);

    await db.update(discounts).set({ deletedAt: new Date(), isActive: false }).where(eq(discounts.id, ctx.params.id));
    await writeAudit(db, {
      userId: user.id,
      action: 'discount.delete',
      entityType: 'discount',
      entityId: ctx.params.id,
      newValues: { deletedAt: new Date().toISOString() },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: ctx.params.id, deleted: true });
  });

export const discountsRoutes = new Elysia().use(readRoutes).use(validateRoutes).use(adminRoutes);
