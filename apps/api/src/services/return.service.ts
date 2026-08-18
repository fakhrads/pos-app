/**
 * Return / refund (M10, P1 — endpoint & skema sudah disiapkan, api-design.md §3.3):
 *  - Validasi transaksi asal completed, umur ≤ return.max_days (default 7)
 *  - qty ≤ qty asli − returned_quantity (RETURN_QTY_EXCEEDED), reason wajib (RET-04)
 *  - SATU transaksi DB: returns + return_items, returned_quantity, restock (return_in),
 *    payments type=refund (atau kredit poin saat refundMethod='points'),
 *    poin dibalik proporsional, audit return.create.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import {
  transactions,
  transactionItems,
  payments,
  returns,
  returnItems,
  products,
  stockMovements,
  memberships,
  pointMovements,
} from '../db/schema';
import { fail } from '../lib/errors';
import { toQty, roundMoney } from '../lib/money';
import { getSettings, numSetting } from '../lib/settings';
import { nextReturnNumber } from '../lib/sequence';
import { writeAudit } from '../lib/audit';
import type { AuthUser } from '../middleware/auth';

export interface ReturnItemInput {
  transactionItemId: string;
  quantity: number;
  reason: string;
}

export interface ReturnInput {
  transactionId: string;
  items: ReturnItemInput[];
  refundMethod: 'cash' | 'qris' | 'transfer' | 'points';
  notes?: string;
}

export async function createReturn(
  input: ReturnInput,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<{ return: typeof returns.$inferSelect; items: (typeof returnItems.$inferSelect)[]; refundPayment: (typeof payments.$inferSelect) | null }> {
  return db.transaction(async (tx) => {
    /* ---------- 1. Validasi transaksi asal ---------- */
    const [trx] = await tx.select().from(transactions).where(eq(transactions.id, input.transactionId)).for('update').limit(1);
    if (!trx) fail('NOT_FOUND', 'Transaksi asal tidak ditemukan', 404);
    if (trx.status !== 'completed') fail('INVALID_TRANSACTION', 'Hanya transaksi completed yang bisa diretur', 422);
    if (trx.paymentStatus === 'unpaid') fail('INVALID_TRANSACTION', 'Transaksi belum lunas', 422);

    const s = await getSettings();
    const maxDays = numSetting(s, 'return.max_days', 7);
    const ageMs = Date.now() - trx.soldAt.getTime();
    if (ageMs > maxDays * 86_400_000) {
      fail('RETURN_TOO_LATE', `Return hanya berlaku ${maxDays} hari setelah transaksi`, 422, { maxDays });
    }

    /* ---------- 2. Validasi item ---------- */
    const txItems = await tx
      .select()
      .from(transactionItems)
      .where(eq(transactionItems.transactionId, trx.id));
    const txItemMap = new Map(txItems.map((i) => [i.id, i]));

    const issues: { transactionItemId: string; available: number; requested: number }[] = [];
    const processed: { item: (typeof transactionItems.$inferSelect); quantity: number; reason: string }[] = [];
    for (const it of input.items) {
      const orig = txItemMap.get(it.transactionItemId);
      if (!orig) fail('INVALID_PARAM', `Item transaksi tidak ditemukan: ${it.transactionItemId}`, 422);
      const qty = toQty(it.quantity);
      if (qty <= 0) fail('VALIDATION_ERROR', 'Quantity return harus > 0', 422);
      if (!it.reason || it.reason.trim().length === 0) fail('VALIDATION_ERROR', 'Alasan return wajib diisi (RET-04)', 422);
      const available = toQty(Number(orig.quantity) - Number(orig.returnedQuantity));
      if (qty > available) issues.push({ transactionItemId: it.transactionItemId, available, requested: qty });
      processed.push({ item: orig, quantity: qty, reason: it.reason.trim() });
    }
    if (issues.length) {
      const first = issues[0]!;
      fail('RETURN_QTY_EXCEEDED', `Qty return melebihi sisa (maks ${first.available})`, 422, issues);
    }

    /* ---------- 3. Hitung total refund ---------- */
    const totalRefund = processed.reduce((a, p) => a + roundMoney(Number(p.item.unitPrice) * p.quantity), 0);
    if (totalRefund <= 0) fail('VALIDATION_ERROR', 'Total refund harus > 0', 422);

    /* ---------- 4. Insert return + items ---------- */
    const returnNumber = await nextReturnNumber(tx);
    const [ret] = await tx
      .insert(returns)
      .values({
        returnNumber,
        outletId: trx.outletId,
        transactionId: trx.id,
        customerId: trx.customerId,
        userId: user.id,
        status: 'completed',
        refundMethod: input.refundMethod,
        totalRefund,
        notes: input.notes ?? null,
        returnedAt: new Date(),
      })
      .returning();

    const retItems = await tx
      .insert(returnItems)
      .values(
        processed.map((p) => ({
          returnId: ret.id,
          transactionItemId: p.item.id,
          productId: p.item.productId,
          productName: p.item.productName,
          quantity: p.quantity,
          unitPrice: Number(p.item.unitPrice),
          subtotal: roundMoney(Number(p.item.unitPrice) * p.quantity),
          reason: p.reason,
        })),
      )
      .returning();

    /* ---------- 5. Update returned_quantity ---------- */
    for (const p of processed) {
      await tx
        .update(transactionItems)
        .set({ returnedQuantity: toQty(Number(p.item.returnedQuantity) + p.quantity) })
        .where(eq(transactionItems.id, p.item.id));
    }

    /* ---------- 6. Restock (return_in) + refund payment / kredit poin ---------- */
    for (const p of processed) {
      if (!p.item.productId) continue;
      const [prod] = await tx.select().from(products).where(eq(products.id, p.item.productId)).for('update').limit(1);
      if (!prod) continue;
      const before = Number(prod.stockOnHand);
      const after = toQty(before + p.quantity);
      await tx.update(products).set({ stockOnHand: after }).where(eq(products.id, prod.id));
      await tx.insert(stockMovements).values({
        productId: prod.id,
        type: 'return_in',
        quantity: p.quantity,
        beforeQty: before,
        afterQty: after,
        transactionId: trx.id,
        returnId: ret.id,
        note: `Return ${returnNumber}: ${p.reason}`,
        createdBy: user.id,
      });
    }

    let refundPayment: (typeof payments.$inferSelect) | null = null;
    let pointsCredited = 0;
    if (input.refundMethod === 'points') {
      // RET-03: refund dikonversi ke poin (nilai per poin dari settings)
      const redeemPerPoint = numSetting(s, 'points.redeem_value', 10);
      pointsCredited = redeemPerPoint > 0 ? Math.round(totalRefund / redeemPerPoint) : 0;
      if (pointsCredited > 0 && trx.customerId) {
        const [m] = await tx.select().from(memberships).where(eq(memberships.customerId, trx.customerId)).for('update').limit(1);
        if (m) {
          const newBalance = Number(m.pointsBalance) + pointsCredited;
          await tx.update(memberships).set({ pointsBalance: newBalance }).where(eq(memberships.id, m.id));
          await tx.insert(pointMovements).values({
            membershipId: m.id,
            transactionId: trx.id,
            type: 'adjustment',
            points: pointsCredited,
            balanceAfter: newBalance,
            note: `Refund ${returnNumber} ke poin (RET-03)`,
            createdBy: user.id,
          });
        }
      }
    } else {
      const [p] = await tx
        .insert(payments)
        .values({
          transactionId: trx.id,
          outletId: trx.outletId,
          type: 'refund',
          method: input.refundMethod,
          amount: totalRefund,
          status: 'paid',
          createdBy: user.id,
        })
        .returning();
      refundPayment = p;
      await tx.update(returns).set({ refundPaymentId: p.id }).where(eq(returns.id, ret.id));
    }

    /* ---------- 7. Balik poin earned proporsional (BA §8.5) ---------- */
    let pointsReversed = 0;
    if (trx.customerId && Number(trx.pointsEarned) > 0) {
      pointsReversed = Math.floor((Number(trx.pointsEarned) * totalRefund) / Number(trx.total));
      if (pointsReversed > 0) {
        const [m] = await tx.select().from(memberships).where(eq(memberships.customerId, trx.customerId)).for('update').limit(1);
        if (m) {
          const newBalance = Math.max(0, Number(m.pointsBalance) - pointsReversed);
          await tx.update(memberships).set({ pointsBalance: newBalance }).where(eq(memberships.id, m.id));
          await tx.insert(pointMovements).values({
            membershipId: m.id,
            transactionId: trx.id,
            type: 'adjustment',
            points: pointsReversed,
            balanceAfter: newBalance,
            note: `Return ${returnNumber}: poin dibatalkan proporsional`,
            createdBy: user.id,
          });
        }
      }
    }
    await tx.update(returns).set({ pointsReversed }).where(eq(returns.id, ret.id));

    /* ---------- 8. Audit ---------- */
    await writeAudit(tx, {
      userId: user.id,
      action: 'return.create',
      entityType: 'return',
      entityId: ret.id,
      newValues: {
        returnNumber,
        transactionId: trx.id,
        totalRefund,
        refundMethod: input.refundMethod,
        itemCount: retItems.length,
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return { return: ret, items: retItems, refundPayment };
  });
}

/** Detail return + items + refund payment. */
export async function loadReturnDetail(id: string) {
  const [ret] = await db.select().from(returns).where(eq(returns.id, id)).limit(1);
  if (!ret) return null;
  // Sequential (bukan Promise.all) — lihat catatan di services/receipt.ts
  const items = await db.select().from(returnItems).where(eq(returnItems.returnId, id));
  const refundPayment = ret.refundPaymentId
    ? ((await db.select().from(payments).where(eq(payments.id, ret.refundPaymentId)).limit(1))[0] ?? null)
    : null;
  const trx = (
    await db
      .select({ id: transactions.id, invoiceNumber: transactions.invoiceNumber })
      .from(transactions)
      .where(eq(transactions.id, ret.transactionId))
      .limit(1)
  )[0] ?? null;
  return {
    return: ret,
    items,
    refundPayment,
    transaction: trx,
  };
}
