/**
 * Product Variants (SPEC fase 2 §4.2) — sub-resource produk.
 *  - GET    /product-variants/:id           : baca (kasir+; tanpa costPrice utk kasir)
 *  - POST   /products/:id/variants          : tambah varian (manager+)
 *  - PATCH  /product-variants/:id           : update parsial (manager+)
 *  - PATCH  /product-variants/:id/stock     : adjust stok varian (manager+, note wajib)
 *  - DELETE /product-variants/:id           : soft delete (admin)
 *
 * Aturan: SKU/barcode satu namespace global (produk+varian); produk
 * track_stock=false TIDAK boleh punya varian; induk has_variants otomatis;
 * soft-delete varian → stok varian pindah ke induk (tidak hilang dari total),
 * varian terakhir dihapus → has_variants=false.
 */
import { Elysia, t } from 'elysia';
import { and, eq, isNull } from 'drizzle-orm';
import { db, type Tx } from '../db';
import { products, productVariants, stockMovements, warehouseStocks } from '../db/schema';
import { ok, clientIp } from '../lib/http';
import { fail } from '../lib/errors';
import { toQty } from '../lib/money';
import { writeAudit } from '../lib/audit';
import { assertSkuAvailable, assertBarcodeAvailable, findProduct, findVariant, serializeVariant } from '../lib/catalog';
import { mustAuth, mustManager, mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

/* ---------------- body schemas ---------------- */
const variantBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  sku: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
  barcode: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  costPrice: t.Optional(t.Number({ minimum: 0 })),
  sellingPrice: t.Number({ minimum: 0 }),
  stockOnHand: t.Optional(t.Number({ minimum: 0 })),
  minStock: t.Optional(t.Number({ minimum: 0 })),
  isActive: t.Optional(t.Boolean()),
});

/** Tulis movement stok varian (product_id = induk, product_variant_id = varian). */
async function insertVariantMovement(
  tx: Tx,
  v: { id: string; productId: string },
  type: 'initial' | 'purchase_in' | 'adjustment' | 'sale_out' | 'return_in' | 'cancellation',
  quantity: number,
  before: number,
  after: number,
  extra: { transactionId?: string | null; reference?: string | null; note?: string | null; createdBy: string },
): Promise<void> {
  if (quantity <= 0) return; // CHECK stock_movements.quantity > 0
  await tx.insert(stockMovements).values({
    productId: v.productId,
    productVariantId: v.id,
    type,
    quantity,
    beforeQty: before,
    afterQty: after,
    transactionId: extra.transactionId ?? null,
    reference: extra.reference ?? null,
    note: extra.note ?? null,
    createdBy: extra.createdBy,
  });
}

/**
 * Pindahkan stok gudang varian (soft-deleted) ke baris induk di gudang yang sama
 * (invariant SPEC §3.7: Σ warehouse_stocks = stock_on_hand per produk/varian).
 * Baris varian dihapus; baris induk ditambah (atau dibuat bila belum ada).
 */
async function transferVariantWarehouseStock(tx: Tx, variantId: string, productId: string, parentMinStock: number): Promise<void> {
  const rows = await tx
    .select({ id: warehouseStocks.id, quantity: warehouseStocks.quantity, warehouseId: warehouseStocks.warehouseId })
    .from(warehouseStocks)
    .where(eq(warehouseStocks.productVariantId, variantId));
  if (rows.length === 0) return;
  const now = new Date();
  for (const w of rows) {
    const qty = Number(w.quantity);
    const [target] = await tx
      .select({ id: warehouseStocks.id, quantity: warehouseStocks.quantity })
      .from(warehouseStocks)
      .where(and(eq(warehouseStocks.warehouseId, w.warehouseId), eq(warehouseStocks.productId, productId), isNull(warehouseStocks.productVariantId)))
      .limit(1);
    if (target) {
      await tx
        .update(warehouseStocks)
        .set({ quantity: toQty(Number(target.quantity) + qty), updatedAt: now })
        .where(eq(warehouseStocks.id, target.id));
    } else {
      await tx.insert(warehouseStocks).values({
        warehouseId: w.warehouseId,
        productId,
        productVariantId: null,
        quantity: qty,
        minStock: toQty(parentMinStock),
        updatedAt: now,
      });
    }
    await tx.delete(warehouseStocks).where(eq(warehouseStocks.id, w.id));
  }
}

/* ---------------- read: kasir+ ---------------- */
const readRoutes = new Elysia()
  .use(mustAuth)
  .get('/product-variants/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const variant = await findVariant(db, ctx.params.id);
    if (!variant) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan', 404);
    const parent = await findProduct(db, variant.productId);
    if (!parent) fail('VARIANT_NOT_FOUND', 'Produk induk tidak ditemukan', 404);
    return ok({
      variant: serializeVariant(variant, user.role),
      product: { id: parent.id, name: parent.name, unit: parent.unit },
    });
  });

/* ---------------- write: manager+ ---------------- */
const writeRoutes = new Elysia()
  .use(mustManager)
  .post(
    '/products/:id/variants',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const parent = await findProduct(db, ctx.params.id);
      if (!parent) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
      if (!parent.trackStock) fail('PARENT_NO_STOCK_TRACKING', 'Produk jasa (track_stock=false) tidak boleh punya varian', 422);

      const sku = ctx.body.sku?.trim() || null;
      const barcode = ctx.body.barcode?.trim() || null;
      const stock = toQty(ctx.body.stockOnHand ?? 0);
      if (stock < 0) fail('VALIDATION_ERROR', 'Stok varian tidak boleh negatif', 422, { field: 'stockOnHand' });
      if (sku) await assertSkuAvailable(db, sku);
      if (barcode) await assertBarcodeAvailable(db, barcode);

      const variant = await db.transaction(async (tx) => {
        const [v] = await tx
          .insert(productVariants)
          .values({
            productId: parent.id,
            name: String(ctx.body.name).trim(),
            sku,
            barcode,
            costPrice: Math.round(Number(ctx.body.costPrice ?? 0)),
            sellingPrice: Math.round(Number(ctx.body.sellingPrice)),
            stockOnHand: stock,
            minStock: toQty(ctx.body.minStock ?? 5), // SET-04 default 5
            isActive: ctx.body.isActive ?? true,
          })
          .returning();
        if (stock > 0) {
          await insertVariantMovement(tx, v, 'initial', stock, 0, stock, { createdBy: user.id });
        }
        await tx.update(products).set({ hasVariants: true }).where(eq(products.id, parent.id));
        return v;
      });

      await writeAudit(db, {
        userId: user.id,
        action: 'variant.create',
        entityType: 'product_variant',
        entityId: variant.id,
        newValues: { productId: parent.id, name: variant.name, sku: variant.sku, sellingPrice: Number(variant.sellingPrice), stockOnHand: Number(variant.stockOnHand) },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ variant: serializeVariant(variant, user.role) });
    },
    { body: variantBodySchema },
  )
  .patch(
    '/product-variants/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const variant = await findVariant(db, ctx.params.id);
      if (!variant) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      const oldValues = {
        name: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        costPrice: Number(variant.costPrice),
        sellingPrice: Number(variant.sellingPrice),
        minStock: Number(variant.minStock),
        isActive: variant.isActive,
      };
      if (ctx.body.name !== undefined) patch.name = String(ctx.body.name).trim();
      if (ctx.body.costPrice !== undefined) patch.costPrice = Math.round(Number(ctx.body.costPrice));
      if (ctx.body.sellingPrice !== undefined) patch.sellingPrice = Math.round(Number(ctx.body.sellingPrice));
      if (ctx.body.minStock !== undefined) patch.minStock = toQty(ctx.body.minStock);
      if (ctx.body.isActive !== undefined) patch.isActive = Boolean(ctx.body.isActive);

      if (ctx.body.sku !== undefined) {
        const sku = String(ctx.body.sku).trim() || null;
        if (sku) await assertSkuAvailable(db, sku, undefined, variant.id);
        patch.sku = sku;
      }
      if (ctx.body.barcode !== undefined) {
        const barcode = String(ctx.body.barcode).trim() || null;
        if (barcode) await assertBarcodeAvailable(db, barcode, undefined, variant.id);
        patch.barcode = barcode;
      }

      const [updated] = await db.update(productVariants).set(patch).where(eq(productVariants.id, variant.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'variant.update',
        entityType: 'product_variant',
        entityId: variant.id,
        oldValues,
        newValues: {
          name: updated.name,
          sku: updated.sku,
          barcode: updated.barcode,
          costPrice: Number(updated.costPrice),
          sellingPrice: Number(updated.sellingPrice),
          minStock: Number(updated.minStock),
          isActive: updated.isActive,
        },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ variant: serializeVariant(updated, user.role) });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        sku: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
        barcode: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
        costPrice: t.Optional(t.Number({ minimum: 0 })),
        sellingPrice: t.Optional(t.Number({ minimum: 0 })),
        minStock: t.Optional(t.Number({ minimum: 0 })),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    '/product-variants/:id/stock',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const variant = await findVariant(db, ctx.params.id);
      if (!variant) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan', 404);

      const type = ctx.body.type as 'purchase_in' | 'adjustment';
      const delta = toQty(ctx.body.quantityDelta);
      if (delta === 0) fail('VALIDATION_ERROR', 'quantityDelta tidak boleh 0', 422);
      if (type === 'purchase_in' && delta < 0) {
        fail('VALIDATION_ERROR', 'purchase_in hanya untuk menambah stok (delta > 0)', 422);
      }
      const note = String(ctx.body.note ?? '').trim();
      if (!note) fail('VALIDATION_ERROR', 'Alasan (note) wajib diisi', 422);

      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(productVariants)
          .where(and(eq(productVariants.id, variant.id), isNull(productVariants.deletedAt)))
          .for('update')
          .limit(1);
        if (!locked) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan', 404);
        const before = Number(locked.stockOnHand);
        const after = toQty(before + delta);
        if (after < 0) {
          fail('STOCK_INSUFFICIENT', `Stok varian tidak cukup (tersisa ${before}, diminta ${Math.abs(delta)})`, 409, {
            variantId: variant.id,
            available: before,
            requested: Math.abs(delta),
          });
        }
        await tx.update(productVariants).set({ stockOnHand: after }).where(eq(productVariants.id, variant.id));
        await tx.insert(stockMovements).values({
          productId: variant.productId,
          productVariantId: variant.id,
          type,
          quantity: Math.abs(delta),
          beforeQty: before,
          afterQty: after,
          reference: ctx.body.reference ?? null,
          note,
          createdBy: user.id,
        });
        return { before, after };
      });

      await writeAudit(db, {
        userId: user.id,
        action: 'variant.stock.adjustment',
        entityType: 'product_variant',
        entityId: variant.id,
        newValues: { type, delta, before: result.before, after: result.after, note },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ variantId: variant.id, before: result.before, after: result.after, type });
    },
    {
      body: t.Object({
        quantityDelta: t.Number(),
        type: t.Enum({ purchase_in: 'purchase_in', adjustment: 'adjustment' }),
        reference: t.Optional(t.String({ maxLength: 100 })),
        note: t.String({ minLength: 1, error: 'Alasan wajib diisi' }),
      }),
    },
  );

/* ---------------- delete: admin ---------------- */
const deleteRoutes = new Elysia()
  .use(mustAdmin)
  .delete('/product-variants/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const variant = await findVariant(db, ctx.params.id);
    if (!variant) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan', 404);

    const parent = await findProduct(db, variant.productId);
    if (!parent) fail('NOT_FOUND', 'Produk induk tidak ditemukan', 404);

    await db.transaction(async (tx) => {
      const now = new Date();
      const stock = Number(variant.stockOnHand);

      // Kunci induk agar update stok aman (FOR UPDATE)
      const [parentLocked] = await tx.select().from(products).where(eq(products.id, parent.id)).for('update').limit(1);
      const parentBefore = Number(parentLocked?.stockOnHand ?? 0);

      // Soft delete varian; stok varian dinolkan (dipindah ke induk — bug QA-5)
      await tx
        .update(productVariants)
        .set({ deletedAt: now, isActive: false, stockOnHand: 0 })
        .where(eq(productVariants.id, variant.id));

      // Stok varian TIDAK boleh hilang dari total: pindahkan ke induk + ledger + warehouse_stocks
      if (stock > 0) {
        // Ledger varian: stok varian 30 → 0
        await insertVariantMovement(tx, variant, 'adjustment', stock, stock, 0, {
          createdBy: user.id,
          note: `Varian dihapus (admin) — stok pindah ke induk`,
        });
        // Ledger induk: stok induk bertambah (AC-02.5)
        const parentAfter = toQty(parentBefore + stock);
        await tx.update(products).set({ stockOnHand: parentAfter }).where(eq(products.id, parent.id));
        await tx.insert(stockMovements).values({
          productId: parent.id,
          productVariantId: variant.id,
          type: 'adjustment',
          quantity: stock,
          beforeQty: parentBefore,
          afterQty: parentAfter,
          reference: null,
          note: `Transfer stok dari varian '${variant.name}' ke induk saat hapus varian`,
          createdBy: user.id,
        });
        // Invariant warehouse_stocks: stok gudang varian → baris induk
        await transferVariantWarehouseStock(tx, variant.id, parent.id, Number(parentLocked?.minStock ?? 0));
      }

      // Varian terakhir dihapus → induk tidak ber-varian lagi (has_variants=false)
      const remaining = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(productVariants.productId, parent.id), isNull(productVariants.deletedAt)));
      if (remaining.length === 0) {
        await tx.update(products).set({ hasVariants: false }).where(eq(products.id, parent.id));
      }
    });

    await writeAudit(db, {
      userId: user.id,
      action: 'variant.delete',
      entityType: 'product_variant',
      entityId: variant.id,
      newValues: { productId: parent.id, name: variant.name, sku: variant.sku, deletedAt: new Date().toISOString() },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: variant.id, deleted: true });
  });

export const productVariantsRoutes = new Elysia().use(readRoutes).use(writeRoutes).use(deleteRoutes);
