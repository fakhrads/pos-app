/**
 * Nomor transaksi/return & member code (spec/db-schema.md §8.6):
 *  - TRX-YYYYMMDD-XXXX / RET-YYYYMMDD-XXXX — counter harian per outlet.
 *  - MBR-XXXXX — member code.
 * Unique index di DB jadi jaring pengaman; caller retry 1× saat konflik (23505).
 */
import { desc, like } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { transactions, returns, memberships, stockTransfers } from '../db/schema';

const WIB_OFFSET_MS = 7 * 3600 * 1000;

/** Tanggal 'YYYYMMDD' dalam WIB (counter harian reset per hari toko). */
function yyyymmddWib(date: Date = new Date()): string {
  const d = new Date(date.getTime() + WIB_OFFSET_MS);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export async function nextInvoiceNumber(dbOrTx: DbOrTx, date: Date = new Date()): Promise<string> {
  const prefix = `TRX-${yyyymmddWib(date)}`;
  const rows = await dbOrTx
    .select({ invoiceNumber: transactions.invoiceNumber })
    .from(transactions)
    .where(like(transactions.invoiceNumber, `${prefix}-%`))
    .orderBy(desc(transactions.invoiceNumber))
    .limit(1);
  const last = rows[0]?.invoiceNumber;
  const seq = last ? Number.parseInt(last.split('-').pop() ?? '0', 10) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export async function nextReturnNumber(dbOrTx: DbOrTx, date: Date = new Date()): Promise<string> {
  const prefix = `RET-${yyyymmddWib(date)}`;
  const rows = await dbOrTx
    .select({ returnNumber: returns.returnNumber })
    .from(returns)
    .where(like(returns.returnNumber, `${prefix}-%`))
    .orderBy(desc(returns.returnNumber))
    .limit(1);
  const last = rows[0]?.returnNumber;
  const seq = last ? Number.parseInt(last.split('-').pop() ?? '0', 10) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export async function nextMemberCode(dbOrTx: DbOrTx): Promise<string> {
  const rows = await dbOrTx
    .select({ memberCode: memberships.memberCode })
    .from(memberships)
    .orderBy(desc(memberships.memberCode))
    .limit(1);
  const last = rows[0]?.memberCode;
  const seq = last ? Number.parseInt(last.replace(/^MBR-/, ''), 10) + 1 : 1;
  return `MBR-${String(seq).padStart(5, '0')}`;
}

/**
 * Fase 3 (SPEC §5.9): nomor dokumen transfer stok — TRF-YYYYMMDD-XXXX,
 * sekuensial per hari (pola TRX/RET). Satu nomor = satu dokumen multi-item.
 * Unique index uq_stock_transfers_number = jaring pengaman; caller retry 1× (23505).
 */
export async function nextTransferNumber(dbOrTx: DbOrTx, date: Date = new Date()): Promise<string> {
  const prefix = `TRF-${yyyymmddWib(date)}`;
  const rows = await dbOrTx
    .select({ transferNumber: stockTransfers.transferNumber })
    .from(stockTransfers)
    .where(like(stockTransfers.transferNumber, `${prefix}-%`))
    .orderBy(desc(stockTransfers.transferNumber))
    .limit(1);
  const last = rows[0]?.transferNumber;
  const seq = last ? Number.parseInt(last.split('-').pop() ?? '0', 10) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}
