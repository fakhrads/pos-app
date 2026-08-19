/**
 * Fase 4 (SPEC §4.4, §5) — helper bersama Shift & Hold:
 *  - enforceShift: guard route "wajib shift terbuka" (checkout/retur/hold).
 *    ADDITIVE — tidak menyentuh computeTransaction/commitCheckout/createReturn.
 *  - computeShiftStats: agregat window atribusi [opened_at, closed_at/now())
 *    (SPEC §5.4–5.6) — dipakai saat close (snapshot) & saat open (live).
 *  - endOfDayWib / startOfDayWib: batas hari WIB utk hold (SPEC §3.3, §5.7).
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db';
import { shifts, transactions, payments, returns } from '../db/schema';
import { fail } from './errors';
import { getSettings, boolSetting } from './settings';
import { todayRangeWib } from './http';
import type { AuthUser } from '../middleware/auth';

/** Tipe agregat statistik shift — snapshot (closed) & live (open) sama bentuknya. */
export interface ShiftStats {
  cashSales: number;
  qrisSales: number;
  transferSales: number;
  refunds: number;
  cashRefunds: number;
  expectedCash: number;
  transactionCount: number;
  returnCount: number;
}

/**
 * Guard route (SPEC §4.4, AC-06.3, AC-07.8, AC-08.5):
 * bila settings['shift.enforce_checkout'] (default true) dan user TIDAK punya
 * shift open → 409 SHIFT_REQUIRED. `false` = dev/demo tanpa shift.
 * Mengembalikan shift open milik user (atau null saat guard dimatikan).
 */
export async function enforceShift(dbOrTx: DbOrTx = db, user: AuthUser): Promise<(typeof shifts.$inferSelect) | null> {
  const s = await getSettings();
  if (!boolSetting(s, 'shift.enforce_checkout', true)) return null;
  const [shift] = await dbOrTx
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, user.id), eq(shifts.status, 'open')))
    .limit(1);
  if (!shift) fail('SHIFT_REQUIRED', 'Buka shift dulu sebelum transaksi', 409);
  return shift;
}

/** Akhir hari WIB (23:59:59.999 WIB) untuk expires_at hold (SPEC §3.3, §5.7). */
export function endOfDayWib(date: Date = new Date()): Date {
  const { to } = todayRangeWib('Asia/Jakarta');
  return new Date(to.getTime() - 1);
}

/** Awal hari WIB (00:00:00.000 WIB) — dipakai hitung limit hold per hari (AC-04.8). */
export function startOfDayWib(date: Date = new Date()): Date {
  return todayRangeWib('Asia/Jakarta').from;
}

/** Sisa menit sebelum kadaluarsa (≥ 0) — dikirim server di GET /held-carts. */
export function remainingMinutes(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60_000));
}

/**
 * Hitung statistik shift untuk window [from, to):
 *  - cashSales/qrisSales/transferSales = Σ payments (type sale, status paid,
 *    transaksi completed, atribusi by sold_at) — SPEC §5.5
 *  - refunds = Σ returns.totalRefund (status completed, atribusi by returned_at)
 *  - cashRefunds = Σ refundPayment.amount (returns.refund_method='cash')
 *  - expectedCash = openingCash + cashSales − cashRefunds — SPEC §5.5
 *  - transactionCount/returnCount = jumlah baris dalam window
 */
export async function computeShiftStats(
  dbOrTx: DbOrTx,
  shift: Pick<typeof shifts.$inferSelect, 'id' | 'userId' | 'openingCash' | 'openedAt' | 'closedAt'>,
): Promise<ShiftStats> {
  // NOTE: postgres.js (prepare:false) TIDAK menserialisasi Date pada parameter
  // query raw (drizzle execute) → kirim ISO string, PG cast ke timestamptz.
  const to = (shift.closedAt ?? new Date()).toISOString();
  const from = shift.openedAt.toISOString();

  // postgres.js mengembalikan BIGINT sebagai string → Number() di semua agregat.
  const [sales] = await dbOrTx.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount END), 0)::bigint AS cash_sales,
      COALESCE(SUM(CASE WHEN p.method = 'qris' THEN p.amount END), 0)::bigint AS qris_sales,
      COALESCE(SUM(CASE WHEN p.method = 'transfer' THEN p.amount END), 0)::bigint AS transfer_sales
    FROM payments p
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.user_id = ${shift.userId}
      AND t.status = 'completed'
      AND p.type = 'sale'
      AND p.status = 'paid'
      AND t.sold_at >= ${from}
      AND t.sold_at < ${to}
  `);
  const [refundsRow] = await dbOrTx.execute(sql`
    SELECT
      COALESCE(SUM(r.total_refund), 0)::bigint AS refunds,
      COALESCE(SUM(CASE WHEN r.refund_method = 'cash' THEN p.amount END), 0)::bigint AS cash_refunds
    FROM returns r
    LEFT JOIN payments p ON p.id = r.refund_payment_id
    WHERE r.user_id = ${shift.userId}
      AND r.status = 'completed'
      AND r.returned_at >= ${from}
      AND r.returned_at < ${to}
  `);
  const [counts] = await dbOrTx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM transactions t
        WHERE t.user_id = ${shift.userId} AND t.status = 'completed'
          AND t.sold_at >= ${from} AND t.sold_at < ${to}) AS transaction_count,
      (SELECT count(*)::int FROM returns r
        WHERE r.user_id = ${shift.userId} AND r.status = 'completed'
          AND r.returned_at >= ${from} AND r.returned_at < ${to}) AS return_count
  `);

  const cashSales = Number(sales?.cash_sales ?? 0);
  const qrisSales = Number(sales?.qris_sales ?? 0);
  const transferSales = Number(sales?.transfer_sales ?? 0);
  const refundsTotal = Number(refundsRow?.refunds ?? 0);
  const cashRefunds = Number(refundsRow?.cash_refunds ?? 0);

  return {
    cashSales,
    qrisSales,
    transferSales,
    refunds: refundsTotal,
    cashRefunds,
    expectedCash: Number(shift.openingCash) + cashSales - cashRefunds,
    transactionCount: Number(counts?.transaction_count ?? 0),
    returnCount: Number(counts?.return_count ?? 0),
  };
}

/** Konversi baris shift + statistik → bentuk respons API (SPEC §4.1). */
export function shiftSummaryShape(
  shift: typeof shifts.$inferSelect,
  stats: ShiftStats,
): {
  openingCash: number;
  cashSales: number;
  qrisSales: number;
  transferSales: number;
  refunds: number;
  expectedCash: number;
  actualCash: number | null;
  discrepancy: number;
  transactionCount: number;
  returnCount: number;
} {
  return {
    openingCash: Number(shift.openingCash),
    cashSales: stats.cashSales,
    qrisSales: stats.qrisSales,
    transferSales: stats.transferSales,
    refunds: stats.refunds,
    expectedCash: stats.expectedCash,
    actualCash: shift.actualCash === null ? null : Number(shift.actualCash),
    discrepancy: Number(shift.discrepancy),
    transactionCount: stats.transactionCount,
    returnCount: stats.returnCount,
  };
}

/** Helper cek unik violation (23505) — pola checkout.service.ts. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

/** Pastikan UUID format valid (dipakai validasi manual hold items). */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
