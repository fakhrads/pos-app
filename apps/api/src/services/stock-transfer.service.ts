/**
 * Transfer stok antar gudang (SPEC Fase 3 §4.3, §5.3) — 1 transaksi DB atomik.
 * Route memanggil createStockTransfer; test memanggil service langsung.
 *
 * Urutan (SPEC §5.3): validasi (gudang beda & aktif, item unik, qty > 0,
 * produk ada & track_stock=true) → generate TRF-... → per item: update asal
 * ATOMIK (WHERE quantity >= qty; gagal → 409 + rollback SEMUA item) → upsert
 * tujuan → insert n baris stock_transfers → insert 2n stock_movements
 * (transfer_out asal / transfer_in tujuan, reference = TRF). Net 0 untuk
 * products.stock_on_hand (invariant §3.4.3).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { stockTransfers, products, productVariants } from '../db/schema';
import { fail } from '../lib/errors';
import { clientIp } from '../lib/http';
import { writeAudit } from '../lib/audit';
import { nextTransferNumber } from '../lib/sequence';
import { assertActiveWarehouse, applyWarehouseDelta, recordMovement, assertQtyValid } from '../lib/stock';
import type { AuthUser } from '../middleware/auth';

export interface TransferItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  notes?: string | null;
}

export interface TransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: TransferItemInput[];
  notes?: string | null;
}

export interface TransferResult {
  transferNumber: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  createdAt: Date;
  createdBy: { id: string; name: string };
  items: {
    id: string;
    productId: string;
    variantId: string | null;
    quantity: number;
    fromBefore: number;
    fromAfter: number;
    toBefore: number;
    toAfter: number;
  }[];
}

/** Validasi item transfer (SPEC §5.3, §7.3) — error 404/422 yang jelas. */
export async function validateTransferItems(
  dbOrTx: typeof db,
  items: TransferItemInput[],
): Promise<{ productId: string; variantId: string | null; quantity: number; notes: string | null }[]> {
  if (!items || items.length === 0) fail('VALIDATION_ERROR', 'Minimal 1 item transfer', 422, { field: 'items' });
  if (items.length > 50) fail('VALIDATION_ERROR', 'Maksimal 50 item per transfer', 422, { field: 'items' });

  // Duplikat (produk+varian) — AC-03.7
  const seen = new Set<string>();
  for (const it of items) {
    const key = `${it.productId}:${it.variantId ?? ''}`;
    if (seen.has(key)) fail('DUPLICATE_TRANSFER_ITEM', 'Item transfer duplikat (produk+varian sama muncul >1×)', 422, { productId: it.productId, variantId: it.variantId ?? null });
    seen.add(key);
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const prodRows = await dbOrTx.select().from(products).where(and(inArray(products.id, productIds), isNull(products.deletedAt)));
  const prodMap = new Map(prodRows.map((p) => [p.id, p]));

  const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is string => !!v))];
  const variantRows = variantIds.length
    ? await dbOrTx.select().from(productVariants).where(and(inArray(productVariants.id, variantIds), isNull(productVariants.deletedAt)))
    : [];
  const variantMap = new Map(variantRows.map((v) => [v.id, v]));

  const out: { productId: string; variantId: string | null; quantity: number; notes: string | null }[] = [];
  for (const it of items) {
    const p = prodMap.get(it.productId);
    if (!p) fail('PRODUCT_NOT_FOUND', `Produk tidak ditemukan (${it.productId})`, 404, { productId: it.productId });
    if (!p.trackStock) fail('STOCK_TRACKING_DISABLED', `Produk '${p.name}' tidak melacak stok (track_stock=false)`, 422, { productId: p.id });
    const qty = assertQtyValid(it.quantity);

    let variantId: string | null = null;
    if (it.variantId) {
      const v = variantMap.get(it.variantId);
      if (!v || v.productId !== p.id) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan untuk produk ini', 422, { productId: p.id, variantId: it.variantId });
      variantId = v.id;
    } else if (p.hasVariants) {
      fail('VALIDATION_ERROR', `Produk '${p.name}' ber-varian — wajib pilih varian`, 422, { field: 'items[].variantId', productId: p.id });
    }
    out.push({ productId: p.id, variantId, quantity: qty, notes: (it.notes ?? '').trim() || null });
  }
  return out;
}

export async function createStockTransfer(
  input: TransferInput,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<TransferResult> {
  const fromId = input.fromWarehouseId;
  const toId = input.toWarehouseId;
  if (fromId === toId) fail('SAME_WAREHOUSE', 'Gudang asal dan tujuan tidak boleh sama', 422);

  // Validasi gudang SEBELUM transaksi (404/422 jelas untuk klien)
  const fromWh = await assertActiveWarehouse(db, fromId, 'Gudang asal');
  const toWh = await assertActiveWarehouse(db, toId, 'Gudang tujuan');
  const items = await validateTransferItems(db, input.items);
  const docNotes = (input.notes ?? '').trim() || null;

  const isUniqueViolation = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';

  let result!: { transferNumber: string; createdAt: Date; rows: (typeof stockTransfers.$inferSelect)[]; movements: { productId: string; variantId: string | null; quantity: number; fromBefore: number; fromAfter: number; toBefore: number; toAfter: number }[] };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result = await db.transaction(async (tx) => {
        const transferNumber = await nextTransferNumber(tx);
        const movements: { productId: string; variantId: string | null; quantity: number; fromBefore: number; fromAfter: number; toBefore: number; toAfter: number }[] = [];
        const rows: (typeof stockTransfers.$inferSelect)[] = [];

        for (const it of items) {
          // Asal: pengurangan ATOMIK — gagal → 409 + rollback SEMUA item (AC-03.2/03.3)
          const src = await applyWarehouseDelta(tx, fromId, it.productId, it.variantId, -it.quantity);
          // Tujuan: upsert (baris belum ada → dibuat, §7.3.3)
          const dst = await applyWarehouseDelta(tx, toId, it.productId, it.variantId, it.quantity);

          const [row] = await tx
            .insert(stockTransfers)
            .values({
              transferNumber,
              fromWarehouseId: fromId,
              toWarehouseId: toId,
              productId: it.productId,
              productVariantId: it.variantId,
              quantity: it.quantity,
              notes: it.notes ?? docNotes, // notes level dokumen disalin ke tiap baris (SPEC §3.2)
              createdBy: user.id,
            })
            .returning();
          rows.push(row);

          await recordMovement(tx, {
            warehouseId: fromId,
            productId: it.productId,
            productVariantId: it.variantId,
            type: 'transfer_out',
            quantity: it.quantity,
            beforeQty: src.before,
            afterQty: src.after,
            reference: transferNumber,
            note: `Transfer ke ${toWh.name}`,
            createdBy: user.id,
          });
          await recordMovement(tx, {
            warehouseId: toId,
            productId: it.productId,
            productVariantId: it.variantId,
            type: 'transfer_in',
            quantity: it.quantity,
            beforeQty: dst.before,
            afterQty: dst.after,
            reference: transferNumber,
            note: `Transfer dari ${fromWh.name}`,
            createdBy: user.id,
          });
          movements.push({
            productId: it.productId,
            variantId: it.variantId,
            quantity: it.quantity,
            fromBefore: src.before,
            fromAfter: src.after,
            toBefore: dst.before,
            toAfter: dst.after,
          });
        }

        await writeAudit(tx, {
          userId: user.id,
          action: 'stock.transfer',
          entityType: 'stock_transfer',
          entityId: rows[0]!.id,
          newValues: {
            transferNumber,
            itemCount: items.length,
            totalQty: items.reduce((a, i) => a + i.quantity, 0),
            fromWarehouseId: fromId,
            toWarehouseId: toId,
          },
          ipAddress: ip,
          userAgent: ua,
        });

        return { transferNumber, createdAt: new Date(), rows, movements };
      });
      break;
    } catch (e) {
      if (isUniqueViolation(e) && attempt === 0) continue; // tabrakan nomor → retry 1× (SPEC §7.3.6)
      throw e;
    }
  }

  return {
    transferNumber: result.transferNumber,
    fromWarehouseId: fromId,
    toWarehouseId: toId,
    createdAt: result.createdAt,
    createdBy: { id: user.id, name: user.name },
    items: result.movements.map((m, i) => ({
      id: result.rows[i]!.id,
      productId: m.productId,
      variantId: m.variantId,
      quantity: m.quantity,
      fromBefore: m.fromBefore,
      fromAfter: m.fromAfter,
      toBefore: m.toBefore,
      toAfter: m.toAfter,
    })),
  };
}

/** Audit helper untuk route (memakai ctx.headers) — dipanggil route saja. */
export function auditIp(headers: Record<string, string | undefined>): string | null {
  return clientIp(headers);
}
