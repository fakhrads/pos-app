/**
 * Product Units (SPEC fase 2 §4.3) — satuan tambahan per produk (R1/Kasaba).
 *  - GET    /products/:id/units   : baca (kasir+)
 *  - POST   /products/:id/units   : tambah satuan (manager+)
 *  - PATCH  /product-units/:id    : update parsial (manager+)
 *  - DELETE /product-units/:id    : hapus fisik (manager+ — snapshot transaksi independen)
 *
 * Aturan: unit tidak boleh sama dengan `products.unit` (unit dasar);
 * factor > 0; unik per produk (case-insensitive). Tidak ada soft delete.
 */
import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { productUnits, products } from '../db/schema';
import { ok, clientIp } from '../lib/http';
import { fail } from '../lib/errors';
import { toQty } from '../lib/money';
import { writeAudit } from '../lib/audit';
import { findProduct, findUnit, listUnits, serializeUnit, validateUnitPayload } from '../lib/catalog';
import { mustAuth, mustManager, getUser, type RouteCtx } from '../middleware/auth';

const unitBodySchema = t.Object({
  unit: t.String({ minLength: 1, maxLength: 20 }),
  factor: t.Number(),
  sellPrice: t.Number({ minimum: 0 }),
  isSellable: t.Optional(t.Boolean()),
  isPurchaseUnit: t.Optional(t.Boolean()),
  minQty: t.Optional(t.Number({ exclusiveMinimum: 0 })),
});

const unitPatchSchema = t.Object({
  unit: t.Optional(t.String({ minLength: 1, maxLength: 20 })),
  factor: t.Optional(t.Number()),
  sellPrice: t.Optional(t.Number({ minimum: 0 })),
  isSellable: t.Optional(t.Boolean()),
  isPurchaseUnit: t.Optional(t.Boolean()),
  minQty: t.Optional(t.Number({ exclusiveMinimum: 0 })),
});

/* ---------------- read: kasir+ ---------------- */
const readRoutes = new Elysia()
  .use(mustAuth)
  .get('/products/:id/units', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const product = await findProduct(db, ctx.params.id);
    if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
    const units = await listUnits(db, product.id);
    return ok({ units: units.map(serializeUnit) });
  });

/* ---------------- write: manager+ ---------------- */
const writeRoutes = new Elysia()
  .use(mustManager)
  .post(
    '/products/:id/units',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const product = await findProduct(db, ctx.params.id);
      if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);

      const existing = (await listUnits(db, product.id)).map((u) => u.unit);
      validateUnitPayload(String(ctx.body.unit), Number(ctx.body.factor), product.unit, existing);

      const [unit] = await db
        .insert(productUnits)
        .values({
          productId: product.id,
          unit: String(ctx.body.unit).trim(),
          factor: toQty(Number(ctx.body.factor)),
          sellPrice: Math.round(Number(ctx.body.sellPrice)),
          isSellable: ctx.body.isSellable ?? true,
          isPurchaseUnit: ctx.body.isPurchaseUnit ?? false,
          minQty: toQty(ctx.body.minQty ?? 1),
        })
        .returning();

      await writeAudit(db, {
        userId: user.id,
        action: 'unit.create',
        entityType: 'product_unit',
        entityId: unit.id,
        newValues: { productId: product.id, unit: unit.unit, factor: Number(unit.factor), sellPrice: Number(unit.sellPrice), isSellable: unit.isSellable, isPurchaseUnit: unit.isPurchaseUnit },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ unit: serializeUnit(unit) });
    },
    { body: unitBodySchema },
  )
  .patch(
    '/product-units/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const unit = await findUnit(db, ctx.params.id);
      if (!unit) fail('UNIT_NOT_FOUND', 'Satuan tidak ditemukan', 404);
      const parent = await findProduct(db, unit.productId);
      if (!parent) fail('NOT_FOUND', 'Produk induk tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      const oldValues = { unit: unit.unit, factor: Number(unit.factor), sellPrice: Number(unit.sellPrice), isSellable: unit.isSellable, isPurchaseUnit: unit.isPurchaseUnit, minQty: Number(unit.minQty) };

      if (ctx.body.unit !== undefined) {
        const existing = (await listUnits(db, parent.id)).filter((u) => u.id !== unit.id).map((u) => u.unit);
        validateUnitPayload(String(ctx.body.unit), Number(ctx.body.factor ?? unit.factor), parent.unit, existing);
        patch.unit = String(ctx.body.unit).trim();
      }
      if (ctx.body.factor !== undefined) {
        if (!Number.isFinite(Number(ctx.body.factor)) || Number(ctx.body.factor) <= 0) fail('INVALID_FACTOR', 'factor harus > 0', 422);
        patch.factor = toQty(Number(ctx.body.factor));
      }
      if (ctx.body.sellPrice !== undefined) patch.sellPrice = Math.round(Number(ctx.body.sellPrice));
      if (ctx.body.isSellable !== undefined) patch.isSellable = Boolean(ctx.body.isSellable);
      if (ctx.body.isPurchaseUnit !== undefined) patch.isPurchaseUnit = Boolean(ctx.body.isPurchaseUnit);
      if (ctx.body.minQty !== undefined) patch.minQty = toQty(Number(ctx.body.minQty));

      const [updated] = await db.update(productUnits).set(patch).where(eq(productUnits.id, unit.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'unit.update',
        entityType: 'product_unit',
        entityId: unit.id,
        oldValues,
        newValues: { unit: updated.unit, factor: Number(updated.factor), sellPrice: Number(updated.sellPrice), isSellable: updated.isSellable, isPurchaseUnit: updated.isPurchaseUnit, minQty: Number(updated.minQty) },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ unit: serializeUnit(updated) });
    },
    { body: unitPatchSchema },
  )
  .delete('/product-units/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const unit = await findUnit(db, ctx.params.id);
    if (!unit) fail('UNIT_NOT_FOUND', 'Satuan tidak ditemukan', 404);

    // Hapus fisik aman — snapshot transaksi (unit/unit_factor) independen (SPEC §3.3)
    await db.delete(productUnits).where(eq(productUnits.id, unit.id));
    await writeAudit(db, {
      userId: user.id,
      action: 'unit.delete',
      entityType: 'product_unit',
      entityId: unit.id,
      newValues: { productId: unit.productId, unit: unit.unit, factor: Number(unit.factor) },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: unit.id, deleted: true });
  });

export const productUnitsRoutes = new Elysia().use(readRoutes).use(writeRoutes);
