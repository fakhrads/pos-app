/**
 * Tax Rates (api-design.md §2.8) — baca: manager+; tulis: admin.
 * DELETE = soft deactivate (is_active=false) — jangan hapus fisik.
 * Saat isDefault=true di-set, default lain di-unset dalam 1 transaksi.
 */
import { Elysia, t } from 'elysia';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { taxRates } from '../db/schema';
import { ok, clientIp } from '../lib/http';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { mustManager, mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

const readRoutes = new Elysia()
  .use(mustManager)
  .get('/tax-rates', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const items = await db
      .select()
      .from(taxRates)
      .where(eq(taxRates.isActive, true))
      .orderBy(asc(taxRates.createdAt));
    return ok({ items });
  });

const adminRoutes = new Elysia()
  .use(mustAdmin)
  .post(
    '/tax-rates',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const [tax] = await db.transaction(async (tx) => {
        if (ctx.body.isDefault) {
          await tx.update(taxRates).set({ isDefault: false }).where(eq(taxRates.isDefault, true));
        }
        return tx
          .insert(taxRates)
          .values({
            name: String(ctx.body.name),
            rate: Number(ctx.body.rate),
            isInclusive: ctx.body.isInclusive ?? false,
            isDefault: ctx.body.isDefault ?? false,
            isActive: true,
          })
          .returning();
      });
      await writeAudit(db, {
        userId: user.id,
        action: 'tax_rate.create',
        entityType: 'tax_rate',
        entityId: tax.id,
        newValues: { name: tax.name, rate: Number(tax.rate), isDefault: tax.isDefault },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ taxRate: tax });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        rate: t.Number({ minimum: 0, maximum: 100 }),
        isInclusive: t.Optional(t.Boolean()),
        isDefault: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    '/tax-rates/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const rows = await db.select().from(taxRates).where(eq(taxRates.id, ctx.params.id)).limit(1);
      const tax = rows[0];
      if (!tax) fail('NOT_FOUND', 'Pajak tidak ditemukan', 404);

      const updatedRows = await db.transaction(async (tx) => {
        if (ctx.body.isDefault === true) {
          await tx.update(taxRates).set({ isDefault: false }).where(and(eq(taxRates.isDefault, true), sql`${taxRates.id} <> ${tax.id}`));
        }
        const patch: Record<string, unknown> = {};
        if (ctx.body.name !== undefined) patch.name = String(ctx.body.name);
        if (ctx.body.rate !== undefined) patch.rate = Number(ctx.body.rate);
        if (ctx.body.isInclusive !== undefined) patch.isInclusive = Boolean(ctx.body.isInclusive);
        if (ctx.body.isDefault !== undefined) patch.isDefault = Boolean(ctx.body.isDefault);
        if (ctx.body.isActive !== undefined) patch.isActive = Boolean(ctx.body.isActive);
        return tx.update(taxRates).set(patch).where(eq(taxRates.id, tax.id)).returning();
      });
      await writeAudit(db, {
        userId: user.id,
        action: 'tax_rate.update',
        entityType: 'tax_rate',
        entityId: tax.id,
        oldValues: { name: tax.name, rate: Number(tax.rate), isDefault: tax.isDefault },
        newValues: { name: updatedRows[0].name, rate: Number(updatedRows[0].rate), isDefault: updatedRows[0].isDefault },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ taxRate: updatedRows[0] });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        rate: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        isInclusive: t.Optional(t.Boolean()),
        isDefault: t.Optional(t.Boolean()),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete('/tax-rates/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const rows = await db.select({ id: taxRates.id }).from(taxRates).where(eq(taxRates.id, ctx.params.id)).limit(1);
    if (!rows[0]) fail('NOT_FOUND', 'Pajak tidak ditemukan', 404);

    await db.update(taxRates).set({ isActive: false }).where(eq(taxRates.id, ctx.params.id));
    await writeAudit(db, {
      userId: user.id,
      action: 'tax_rate.deactivate',
      entityType: 'tax_rate',
      entityId: ctx.params.id,
      newValues: { isActive: false },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: ctx.params.id, deleted: true });
  });

export const taxRatesRoutes = new Elysia().use(readRoutes).use(adminRoutes);
