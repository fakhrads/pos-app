/**
 * Detail transaksi + struk (receipt) — dipakai checkout, reprint, dan detail.
 * Struk berisi data toko dari settings (M9) + snapshot item/payment.
 */
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { transactions, transactionItems, payments, returns } from '../db/schema';
import { getSettings, strSetting } from '../lib/settings';

export interface TransactionDetail {
  transaction: typeof transactions.$inferSelect;
  items: (typeof transactionItems.$inferSelect)[];
  payments: (typeof payments.$inferSelect)[];
  returnSummary: {
    id: string;
    returnNumber: string | null;
    totalRefund: number | null;
    status: string | null;
    returnedAt: Date | null;
  }[];
}

export async function loadTransactionDetail(dbOrTx: DbOrTx, id: string): Promise<TransactionDetail | null> {
  const [trx] = await dbOrTx.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  if (!trx) return null;

  // Sequential (bukan Promise.all): postgres.js pool + PGlite multiplexer
  // tidak menjamin kueri paralel lintas koneksi; urut lebih aman & cukup untuk skala homelab
  const items = await dbOrTx
    .select()
    .from(transactionItems)
    .where(eq(transactionItems.transactionId, id))
    .orderBy(asc(transactionItems.createdAt));
  const pays = await dbOrTx
    .select()
    .from(payments)
    .where(eq(payments.transactionId, id))
    .orderBy(asc(payments.createdAt));
  const rets = await dbOrTx
    .select({
      id: returns.id,
      returnNumber: returns.returnNumber,
      totalRefund: returns.totalRefund,
      status: returns.status,
      returnedAt: returns.returnedAt,
    })
    .from(returns)
    .where(eq(returns.transactionId, id));

  return { transaction: trx, items, payments: pays, returnSummary: rets };
}

/* ------------------------------------------------------------------ */
/* Struk                                                               */
/* ------------------------------------------------------------------ */

export interface ReceiptData {
  transaction: typeof transactions.$inferSelect;
  items: (typeof transactionItems.$inferSelect)[];
  payments: (typeof payments.$inferSelect)[];
  store: { name: string; address: string; phone: string; footer: string };
}

export async function buildReceipt(dbOrTx: DbOrTx, transactionId: string): Promise<ReceiptData | null> {
  const detail = await loadTransactionDetail(dbOrTx, transactionId);
  if (!detail) return null;
  const s = await getSettings();
  return {
    transaction: detail.transaction,
    items: detail.items,
    payments: detail.payments,
    store: {
      name: strSetting(s, 'store.name', 'FakhriPOS'),
      address: strSetting(s, 'store.address', ''),
      phone: strSetting(s, 'store.phone', ''),
      footer: strSetting(s, 'receipt.footer', 'Terima kasih atas kunjungan Anda'),
    },
  };
}

/** Struk teks 40 kolom (BA §4.9 — print browser / PDF). */
export function receiptText(r: ReceiptData): string {
  const W = 40;
  const line = (text: string) => text.padEnd(W, ' ');
  const center = (text: string) => {
    const pad = Math.max(0, Math.floor((W - text.length) / 2));
    return ' '.repeat(pad) + text;
  };
  const right = (label: string, value: string) => {
    const v = `${label}${value}`;
    if (v.length >= W) return v.slice(0, W);
    return v.padStart(W, ' ');
  };
  const sep = '-'.repeat(W);
  const idr = (n: number) => new Intl.NumberFormat('id-ID').format(n);
  const fmtDate = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const t = r.transaction;
  const lines: string[] = [];
  lines.push(center(r.store.name.toUpperCase()));
  if (r.store.address) lines.push(center(r.store.address));
  if (r.store.phone) lines.push(center(r.store.phone));
  lines.push(sep);
  lines.push(line(`No: ${t.invoiceNumber}`));
  lines.push(line(fmtDate.format(t.soldAt)));
  lines.push(line(`Kasir: ${t.userId.slice(0, 8)}`));
  if (t.customerId) lines.push(line(`Pelanggan: ${t.customerId.slice(0, 8)}`));
  lines.push(sep);
  for (const it of r.items) {
    lines.push(line(it.productName.slice(0, W)));
    lines.push(line(`  ${Number(it.quantity)} x ${idr(Number(it.unitPrice))}`));
    if (Number(it.discountAmount) > 0) lines.push(right('Diskon: ', `-${idr(Number(it.discountAmount))}`));
    if (Number(it.taxAmount) > 0) lines.push(right('PPN: ', idr(Number(it.taxAmount))));
    lines.push(right('', idr(Number(it.lineTotal))));
  }
  lines.push(sep);
  lines.push(right('Subtotal: ', idr(Number(t.subtotal))));
  if (Number(t.discountTotal) > 0) lines.push(right('Diskon: ', `-${idr(Number(t.discountTotal))}`));
  if (Number(t.taxTotal) > 0) lines.push(right('PPN: ', idr(Number(t.taxTotal))));
  if (Number(t.redeemedPointsValue) > 0) lines.push(right('Poin: ', `-${idr(Number(t.redeemedPointsValue))}`));
  lines.push(right('TOTAL: ', idr(Number(t.total))));
  lines.push(sep);
  for (const p of r.payments) {
    const method = p.method.toUpperCase();
    lines.push(right(`${method}: `, idr(Number(p.amount))));
    if (p.changeAmount != null && Number(p.changeAmount) > 0) lines.push(right('Kembali: ', idr(Number(p.changeAmount))));
  }
  if (Number(t.pointsEarned) > 0) lines.push(line(`Poin didapat: ${Number(t.pointsEarned)}`));
  lines.push('');
  if (r.store.footer) lines.push(center(r.store.footer));
  return lines.join('\n');
}
