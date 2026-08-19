/**
 * Koreksi stok / adjustment (SPEC Fase 3 §4.4, §5.4) — 1 transaksi DB atomik.
 * Route memanggil createStockAdjustment; test memanggil service langsung.
 *
 * Urutan (SPEC §5.4): validasi (gudang aktif, produk track_stock, delta ≠ 0,
 * reason ∈ daftar) → delta < 0: UPDATE ... WHERE quantity >= |delta| (atomik) →
 * insert stock_adjustments → insert stock_movements type=adjustment
 * (reference = adjustment.id) → update stock_on_hand produk/varian (delta sama).
 * Immutable: koreksi kesalahan = adjustment baru (jejak audit utuh).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { stockAdjustments, products, productVariants } from '../db/schema';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import {
  assertActiveWarehouse,
  applyWarehouseDelta,
  syncStockOnHand,
  recordMovement,
  assertValidReason,
  assertQtyValid,
} from '../lib/stock';
import type { AuthUser } from '../middleware/auth';

export interface AdjustmentInput {
  warehouseId: string;
  productId: string;
  variantId?: string | null;
  quantityDelta: number;
  reason: string;
  note?: string | null;
}

export interface AdjustmentResult {
  adjustment: {
    id: string;
    warehouseId: string;
    productId: string;
    variantId: string | null;
    quantityDelta: number;
    reason: string;
    note: string | null;
    createdBy: { id: string; name: string };
    createdAt: Date;
  };
  beforeQty: number;
  afterQty: number;
}

export async function createStockAdjustment(
  input: AdjustmentInput,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<AdjustmentResult> {
  const warehouseId = input.warehouseId;
  const productId = input.productId;
  const reason = assertValidReason(input.reason); // AC-04.3: INVALID_REASON + details.allowed
  const note = (input.note ?? '').toString().trim() || null;

  await assertActiveWarehouse(db, warehouseId, 'Gudang');

  // Validasi produk & varian (di luar tx — pesan error jelas)
  const [prod] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), isNull(products.deletedAt)))
    .limit(1);
  if (!prod) fail('PRODUCT_NOT_FOUND', 'Produk tidak ditemukan', 404, { productId });
  if (!prod.trackStock) fail('STOCK_TRACKING_DISABLED', `Produk '${prod.name}' tidak melacak stok (track_stock=false)`, 422, { productId });

  let variantId: string | null = null;
  if (input.variantId) {
    const [v] = await db
      .select()
      .from(productVariants)
      .where(and(eq(productVariants.id, String(input.variantId)), isNull(productVariants.deletedAt)))
      .limit(1);
    if (!v || v.productId !== prod.id) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan untuk produk ini', 422, { productId, variantId: input.variantId });
    variantId = v.id;
  } else if (prod.hasVariants) {
    fail('VALIDATION_ERROR', `Produk '${prod.name}' ber-varian — wajib pilih varian`, 422, { field: 'variantId' });
  }

  const delta = assertQtyValid(input.quantityDelta, { allowZero: false });
  if (delta === 0) fail('ZERO_DELTA', 'quantityDelta tidak boleh 0', 422); // AC-04.2

  const result = await db.transaction(async (tx) => {
    // Stok gudang berubah dulu (atomik); STOCK_INSUFFICIENT → rollback (AC-04.4)
    const whMove = await applyWarehouseDelta(tx, warehouseId, productId, variantId, delta);
    // stock_on_hand produk/varian ikut (delta sama) — invariant Σ = stock_on_hand
    await syncStockOnHand(tx, productId, variantId, delta);

    const [adj] = await tx
      .insert(stockAdjustments)
      .values({
        warehouseId,
        productId,
        productVariantId: variantId,
        quantityDelta: delta,
        reason,
        note,
        createdBy: user.id,
      })
      .returning();

    await recordMovement(tx, {
      warehouseId,
      productId,
      productVariantId: variantId,
      type: 'adjustment',
      quantity: Math.abs(delta),
      beforeQty: whMove.before,
      afterQty: whMove.after,
      reference: adj.id, // AC-04.1: reference = adjustment.id
      note: note ?? `Koreksi stok: ${reason}`,
      createdBy: user.id,
    });

    await writeAudit(tx, {
      userId: user.id,
      action: 'stock.adjustment',
      entityType: 'stock_adjustment',
      entityId: adj.id,
      oldValues: { beforeQty: whMove.before },
      newValues: { afterQty: whMove.after, reason, delta },
      ipAddress: ip,
      userAgent: ua,
    });

    return { adj, whMove };
  });

  return {
    adjustment: {
      id: result.adj.id,
      warehouseId: result.adj.warehouseId,
      productId: result.adj.productId,
      variantId: result.adj.productVariantId,
      quantityDelta: Number(result.adj.quantityDelta),
      reason: result.adj.reason,
      note: result.adj.note,
      createdBy: { id: user.id, name: user.name },
      createdAt: result.adj.createdAt,
    },
    beforeQty: result.whMove.before,
    afterQty: result.whMove.after,
  };
}
