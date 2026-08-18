/**
 * Operasi transaksi lanjutan:
 *  - cancelTransaction: void (POS-10, P1 — endpoint siap)
 *  - addAdditionalPayment: pembayaran tambahan untuk transaksi partial (PAY-07)
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { transactions, transactionItems, payments, products, stockMovements, memberships, pointMovements, returns } from '../db/schema';
import { fail } from '../lib/errors';
import { toQty } from '../lib/money';
import { writeAudit } from '../lib/audit';
import type { AuthUser } from '../middleware/auth';
import type { PaymentInput } from './checkout.service';

/**
 * Void transaksi (BA POS-10) — SATU transaksi DB:
 *  - status → cancelled, payment_status → refunded
 *  - stok dikembalikan (movement type 'cancellation')
 *  - pembayaran sale diganti baris payments type=refund
 *  - poin earned dibatalkan (sisa) + poin redeemed dikredit kembali
 *  - audit transaction.cancel
 */
export async function cancelTransaction(
  transactionId: string,
  reason: string,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<typeof transactions.$inferSelect> {
  return db.transaction(async (tx) => {
    const [trx] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for('update').limit(1);
    if (!trx) fail('NOT_FOUND', 'Transaksi tidak ditemukan', 404);
    if (trx.status === 'cancelled') fail('ALREADY_CANCELLED', 'Transaksi sudah dibatalkan', 409);

    // Restock sisa (qty − returned) per item
    const items = await tx.select().from(transactionItems).where(eq(transactionItems.transactionId, trx.id));
    for (const it of items) {
      const remaining = toQty(Number(it.quantity) - Number(it.returnedQuantity));
      if (remaining <= 0 || !it.productId) continue;
      const [p] = await tx.select().from(products).where(eq(products.id, it.productId)).for('update').limit(1);
      if (!p) continue;
      const before = Number(p.stockOnHand);
      const after = toQty(before + remaining);
      await tx.update(products).set({ stockOnHand: after }).where(eq(products.id, p.id));
      await tx.insert(stockMovements).values({
        productId: p.id,
        type: 'cancellation',
        quantity: remaining,
        beforeQty: before,
        afterQty: after,
        transactionId: trx.id,
        note: `Void ${trx.invoiceNumber}: ${reason}`,
        createdBy: user.id,
      });
    }

    // Payments sale → baris refund
    const paid = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.transactionId, trx.id), eq(payments.type, 'sale'), eq(payments.status, 'paid')));
    for (const p of paid) {
      await tx.insert(payments).values({
        transactionId: trx.id,
        outletId: trx.outletId,
        type: 'refund',
        method: p.method,
        amount: p.amount,
        status: 'paid',
        referenceNumber: p.referenceNumber,
        createdBy: user.id,
      });
    }

    // Poin: batalkan earned yang tersisa + kredit kembali redeemed
    if (trx.customerId) {
      const [m] = await tx.select().from(memberships).where(eq(memberships.customerId, trx.customerId)).for('update').limit(1);
      if (m) {
        const reversedRows = await tx
          .select({ total: sql<number>`coalesce(sum(${returns.pointsReversed}), 0)::int` })
          .from(returns)
          .where(and(eq(returns.transactionId, trx.id), eq(returns.status, 'completed')));
        const alreadyReversed = Number(reversedRows[0]?.total ?? 0);
        const remainingEarned = Math.max(0, Number(trx.pointsEarned) - alreadyReversed);
        const redeemed = Number(trx.pointsRedeemed);
        const delta = redeemed - remainingEarned; // +kredit redeem, −cabut earned
        // clamp ≥ 0: poin yang sudah diredeem di transaksi lain tidak bisa ditarik melebihi saldo
        const newBalance = Math.max(0, Number(m.pointsBalance) + delta);
        await tx.update(memberships).set({ pointsBalance: newBalance }).where(eq(memberships.id, m.id));
        if (remainingEarned > 0) {
          await tx.insert(pointMovements).values({
            membershipId: m.id,
            transactionId: trx.id,
            type: 'adjustment',
            points: remainingEarned,
            balanceAfter: newBalance,
            note: `Void ${trx.invoiceNumber}: poin earned dibatalkan`,
            createdBy: user.id,
          });
        }
        if (redeemed > 0) {
          await tx.insert(pointMovements).values({
            membershipId: m.id,
            transactionId: trx.id,
            type: 'adjustment',
            points: redeemed,
            balanceAfter: newBalance,
            note: `Void ${trx.invoiceNumber}: poin redeem dikembalikan`,
            createdBy: user.id,
          });
        }
      }
    }

    await writeAudit(tx, {
      userId: user.id,
      action: 'transaction.cancel',
      entityType: 'transaction',
      entityId: trx.id,
      newValues: { reason, invoiceNumber: trx.invoiceNumber },
      ipAddress: ip,
      userAgent: ua,
    });

    // Kembalikan baris TERBARU (status=cancelled), bukan snapshot sebelum update
    const [updated] = await tx
      .update(transactions)
      .set({
        status: 'cancelled',
        paymentStatus: 'refunded',
        notes: trx.notes ? `${trx.notes}\nVoid: ${reason}` : `Void: ${reason}`,
      })
      .where(eq(transactions.id, trx.id))
      .returning();

    return updated;
  });
}

/**
 * Pembayaran tambahan transaksi partial (PAY-07, P1 — endpoint siap).
 * Validasi: transaksi completed, belum lunas, nominal ≤ sisa tagihan.
 */
export async function addAdditionalPayment(
  transactionId: string,
  body: PaymentInput,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<typeof payments.$inferSelect> {
  return db.transaction(async (tx) => {
    const [trx] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for('update').limit(1);
    if (!trx) fail('NOT_FOUND', 'Transaksi tidak ditemukan', 404);
    if (trx.status !== 'completed') fail('INVALID_STATE', 'Transaksi tidak dalam status aktif', 422);
    if (trx.paymentStatus === 'paid' || trx.paymentStatus === 'refunded') {
      fail('INVALID_STATE', 'Transaksi sudah lunas', 422);
    }

    const paidRows = await tx
      .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.transactionId, trx.id), eq(payments.type, 'sale'), eq(payments.status, 'paid')));
    const paid = Number(paidRows[0]?.total ?? 0);
    const remaining = Number(trx.total) - paid;
    if (remaining <= 0) fail('INVALID_STATE', 'Transaksi sudah lunas', 422);

    const amount = Math.round(body.amount);
    if (amount <= 0) fail('VALIDATION_ERROR', 'Nominal pembayaran harus > 0', 422);
    if (amount > remaining) fail('PAYMENT_MISMATCH', `Nominal melebihi sisa tagihan ${remaining}`, 422);

    let cashReceived: number | null = null;
    let changeAmount: number | null = null;
    if (body.method === 'cash') {
      cashReceived = body.cashReceived != null ? Math.round(body.cashReceived) : amount;
      if (cashReceived < amount) fail('PAYMENT_MISMATCH', 'Uang tunai kurang', 422);
      changeAmount = cashReceived - amount;
    }

    const [payment] = await tx
      .insert(payments)
      .values({
        transactionId: trx.id,
        outletId: trx.outletId,
        type: 'sale',
        method: body.method,
        amount,
        cashReceived,
        changeAmount: changeAmount && changeAmount > 0 ? changeAmount : null,
        referenceNumber: body.referenceNumber ?? null,
        status: 'paid',
        createdBy: user.id,
      })
      .returning();

    const newPaid = paid + amount;
    const paymentStatus = newPaid >= Number(trx.total) ? 'paid' : 'partial';
    await tx.update(transactions).set({ paymentStatus }).where(eq(transactions.id, trx.id));

    await writeAudit(tx, {
      userId: user.id,
      action: 'payment.create',
      entityType: 'transaction',
      entityId: trx.id,
      newValues: { method: body.method, amount },
      ipAddress: ip,
      userAgent: ua,
    });

    return payment;
  });
}
