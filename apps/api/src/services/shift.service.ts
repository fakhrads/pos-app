/**
 * Fase 4 (SPEC §4.1, §5.4–5.6, §6.1) — Shift management.
 *  - openShift: 1 user ≤ 1 shift open (SHIFT_ALREADY_OPEN); nomor SHF-... retry 1×.
 *  - closeShift: row lock FOR UPDATE (double-tab aman), snapshot statistik window
 *    [opened_at, now), notes wajib bila |discrepancy| > shift.cash_tolerance.
 *  - getCurrentShift: statistik LIVE window [opened_at, now) utk banner kasir.
 *  - listShifts / getShiftDetail: kasir = milik sendiri, manager+ = semua (server paksa).
 *
 * Atribusi transaksi/retur ke shift via WINDOW WAKTU (bukan FK) — §1.3.3.
 * Snapshot shift TIDAK berubah oleh void/return setelah close (§3.2).
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db';
import { shifts, transactions, returns, users } from '../db/schema';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { nextShiftNumber } from '../lib/sequence';
import { getSettings, numSetting } from '../lib/settings';
import { computeShiftStats, isUniqueViolation, shiftSummaryShape, type ShiftStats } from '../lib/shift';
import type { AuthUser } from '../middleware/auth';

export interface ShiftInput {
  openingCash: number;
  notes?: string;
}

export interface CloseShiftInput {
  actualCash: number;
  notes?: string;
}

function isManager(user: AuthUser): boolean {
  return user.role === 'manager' || user.role === 'admin';
}

/** Statistik snapshot dari baris shift closed (authoritative — §3.2). */
function statsFromClosedRow(shift: typeof shifts.$inferSelect): ShiftStats {
  return {
    cashSales: Number(shift.cashSales),
    qrisSales: Number(shift.qrisSales),
    transferSales: Number(shift.transferSales),
    refunds: Number(shift.refunds),
    cashRefunds: Number(shift.openingCash) + Number(shift.cashSales) - Number(shift.expectedCash),
    expectedCash: Number(shift.expectedCash),
    transactionCount: shift.transactionCount,
    returnCount: shift.returnCount,
  };
}

/** Buka shift baru (AC-06.1, AC-06.2). */
export async function openShift(
  input: ShiftInput,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<typeof shifts.$inferSelect> {
  if (!Number.isInteger(input.openingCash) || input.openingCash < 0) {
    fail('VALIDATION_ERROR', 'Modal kas awal harus bilangan bulat ≥ 0', 422);
  }
  // 1 user ≤ 1 shift open (prasyarat atribusi window, §1.3.3)
  const [existing] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.userId, user.id), eq(shifts.status, 'open')))
    .limit(1);
  if (existing) fail('SHIFT_ALREADY_OPEN', 'Kamu sudah punya shift terbuka', 409, { shiftId: existing.id });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const shift = await db.transaction(async (tx) => {
        const shiftNumber = await nextShiftNumber(tx);
        const [row] = await tx
          .insert(shifts)
          .values({
            shiftNumber,
            outletId: user.outletId,
            userId: user.id,
            status: 'open',
            openingCash: input.openingCash,
            notes: input.notes?.trim() || null,
            createdBy: user.id,
          })
          .returning();
        await writeAudit(tx, {
          userId: user.id,
          action: 'shift.open',
          entityType: 'shift',
          entityId: row.id,
          newValues: { shiftNumber, openingCash: input.openingCash, status: 'open' },
          ipAddress: ip,
          userAgent: ua,
        });
        return row;
      });
      return shift;
    } catch (e) {
      // Konflik nomor unik (23505) — retry 1× (pola lib/sequence.ts)
      if (attempt === 0 && isUniqueViolation(e)) continue;
      throw e;
    }
  }
  throw new Error('unreachable');
}

/** Tutup shift: snapshot statistik + selisih kas (AC-06.5, AC-06.6, AC-06.7). */
export async function closeShift(
  id: string,
  input: CloseShiftInput,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<{ shift: typeof shifts.$inferSelect; summary: ReturnType<typeof shiftSummaryShape> }> {
  if (!Number.isInteger(input.actualCash) || input.actualCash < 0) {
    fail('VALIDATION_ERROR', 'Modal kas akhir harus bilangan bulat ≥ 0', 422);
  }
  const notes = input.notes?.trim() || null;

  return db.transaction(async (tx) => {
    // Row lock FOR UPDATE — double-tab close → 1 sukses, 1 SHIFT_ALREADY_CLOSED (§7.5.4)
    const [shift] = await tx.select().from(shifts).where(eq(shifts.id, id)).for('update').limit(1);
    if (!shift) fail('SHIFT_NOT_FOUND', 'Shift tidak ditemukan', 404);
    if (shift.status === 'closed') fail('SHIFT_ALREADY_CLOSED', 'Shift sudah ditutup', 409);
    if (shift.userId !== user.id && !isManager(user)) {
      fail('FORBIDDEN', 'Hanya pemilik shift atau manager yang bisa menutup shift ini', 403);
    }

    const stats = await computeShiftStats(tx, { ...shift, closedAt: null });
    const expectedCash = stats.expectedCash;
    const discrepancy = input.actualCash - expectedCash;

    // |discrepancy| > tolerance → notes WAJIB (AC-06.6, §5.5)
    const s = await getSettings();
    const tolerance = numSetting(s, 'shift.cash_tolerance', 0);
    if (Math.abs(discrepancy) > tolerance && !notes) {
      fail(
        'SHIFT_DISCREPANCY_NOTE_REQUIRED',
        'Selisih kas tidak nol — isi catatan sebelum menutup shift',
        422,
        { expectedCash, actualCash: input.actualCash, discrepancy, tolerance },
      );
    }

    const closedAt = new Date();
    const [updated] = await tx
      .update(shifts)
      .set({
        status: 'closed',
        closedAt,
        cashSales: stats.cashSales,
        qrisSales: stats.qrisSales,
        transferSales: stats.transferSales,
        refunds: stats.refunds,
        expectedCash,
        actualCash: input.actualCash,
        discrepancy,
        transactionCount: stats.transactionCount,
        returnCount: stats.returnCount,
        notes,
        updatedAt: closedAt,
      })
      .where(eq(shifts.id, id))
      .returning();

    await writeAudit(tx, {
      userId: user.id,
      action: 'shift.close',
      entityType: 'shift',
      entityId: id,
      newValues: {
        openingCash: Number(shift.openingCash),
        expectedCash,
        actualCash: input.actualCash,
        discrepancy,
        transactionCount: stats.transactionCount,
        returnCount: stats.returnCount,
        notes,
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return { shift: updated, summary: shiftSummaryShape(updated, statsFromClosedRow(updated)) };
  });
}

/** Shift open milik user + statistik LIVE (AC-06.1 banner, §5.6). */
export async function getCurrentShift(user: AuthUser): Promise<{ shift: unknown }> {
  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, user.id), eq(shifts.status, 'open')))
    .limit(1);
  if (!shift) return { shift: null };
  const stats = await computeShiftStats(db, shift);
  return {
    shift: {
      id: shift.id,
      shiftNumber: shift.shiftNumber,
      openedAt: shift.openedAt,
      openingCash: Number(shift.openingCash),
      cashSales: stats.cashSales,
      qrisSales: stats.qrisSales,
      transferSales: stats.transferSales,
      refunds: stats.refunds,
      expectedCash: stats.expectedCash,
      transactionCount: stats.transactionCount,
    },
  };
}

export interface ShiftListQuery {
  userId?: string;
  from?: string;
  to?: string;
  status?: 'open' | 'closed';
  page: number;
  perPage: number;
}

/** Daftar shift — kasir: milik sendiri; manager+: semua (+filter userId) (AC-06.9). */
export async function listShifts(user: AuthUser, q: ShiftListQuery): Promise<{ items: unknown[]; meta: unknown }> {
  const conds = [];
  if (user.role === 'kasir') {
    conds.push(eq(shifts.userId, user.id));
  } else if (q.userId) {
    conds.push(eq(shifts.userId, q.userId));
  }
  if (q.status) conds.push(eq(shifts.status, q.status));
  if (q.from) conds.push(gte(shifts.openedAt, new Date(q.from)));
  if (q.to) conds.push(lte(shifts.openedAt, new Date(q.to)));
  const where = and(...conds);

  const base = {
    id: shifts.id,
    shiftNumber: shifts.shiftNumber,
    userId: shifts.userId,
    userName: users.name,
    openedAt: shifts.openedAt,
    closedAt: shifts.closedAt,
    openingCash: shifts.openingCash,
    cashSales: shifts.cashSales,
    qrisSales: shifts.qrisSales,
    transferSales: shifts.transferSales,
    refunds: shifts.refunds,
    expectedCash: shifts.expectedCash,
    actualCash: shifts.actualCash,
    discrepancy: shifts.discrepancy,
    transactionCount: shifts.transactionCount,
    returnCount: shifts.returnCount,
    status: shifts.status,
  };

  const countRows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(shifts)
    .innerJoin(users, eq(shifts.userId, users.id))
    .where(where);
  const total = Number(countRows[0]?.total ?? 0);

  const rows = await db
    .select(base)
    .from(shifts)
    .innerJoin(users, eq(shifts.userId, users.id))
    .where(where)
    .orderBy(desc(shifts.openedAt))
    .limit(q.perPage)
    .offset((q.page - 1) * q.perPage);

  return {
    items: rows.map((r) => ({ ...r, ...numbers(r) })),
    meta: {
      page: q.page,
      perPage: q.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
    },
  };
}

/** Number() untuk semua kolom BIGINT dari postgres.js (string). */
function numbers(r: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of [
    'openingCash',
    'cashSales',
    'qrisSales',
    'transferSales',
    'refunds',
    'expectedCash',
    'discrepancy',
    'transactionCount',
    'returnCount',
  ]) {
    const v = r[k];
    out[k] = v === null || v === undefined ? v : Number(v);
  }
  if (r.actualCash !== null && r.actualCash !== undefined) out.actualCash = Number(r.actualCash);
  return out;
}

/** Detail shift + summary + transaksi/retur dalam window atribusi (AC-06.8). */
export async function getShiftDetail(id: string, user: AuthUser): Promise<unknown> {
  const [row] = await db
    .select({ shift: shifts, userName: users.name })
    .from(shifts)
    .innerJoin(users, eq(shifts.userId, users.id))
    .where(eq(shifts.id, id))
    .limit(1);
  if (!row) fail('SHIFT_NOT_FOUND', 'Shift tidak ditemukan', 404);
  const shift = row.shift;
  if (shift.userId !== user.id && !isManager(user)) {
    fail('FORBIDDEN', 'Hanya pemilik shift atau manager yang bisa melihat shift ini', 403);
  }

  // summary = snapshot (closed) atau live (open) — §4.1
  const stats = shift.status === 'closed' ? statsFromClosedRow(shift) : await computeShiftStats(db, shift);
  const summary = shiftSummaryShape(shift, stats);

  const to = shift.closedAt ?? new Date();
  const transactionsInWindow = await db
    .select({
      id: transactions.id,
      invoiceNumber: transactions.invoiceNumber,
      total: transactions.total,
      paymentStatus: transactions.paymentStatus,
      soldAt: transactions.soldAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, shift.userId),
        eq(transactions.status, 'completed'),
        gte(transactions.soldAt, shift.openedAt),
        lte(transactions.soldAt, to),
      ),
    )
    .orderBy(desc(transactions.soldAt))
    .limit(500);

  const returnsInWindow = await db
    .select({
      id: returns.id,
      returnNumber: returns.returnNumber,
      totalRefund: returns.totalRefund,
      returnedAt: returns.returnedAt,
    })
    .from(returns)
    .where(
      and(
        eq(returns.userId, shift.userId),
        eq(returns.status, 'completed'),
        gte(returns.returnedAt, shift.openedAt),
        lte(returns.returnedAt, to),
      ),
    )
    .orderBy(desc(returns.returnedAt))
    .limit(500);

  return {
    shift: {
      id: shift.id,
      shiftNumber: shift.shiftNumber,
      userId: shift.userId,
      userName: row.userName,
      outletId: shift.outletId,
      status: shift.status,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      notes: shift.notes,
      ...numbers({
        openingCash: shift.openingCash,
        cashSales: shift.cashSales,
        qrisSales: shift.qrisSales,
        transferSales: shift.transferSales,
        refunds: shift.refunds,
        expectedCash: shift.expectedCash,
        actualCash: shift.actualCash,
        discrepancy: shift.discrepancy,
        transactionCount: shift.transactionCount,
        returnCount: shift.returnCount,
      }),
    },
    summary,
    transactions: transactionsInWindow.map((t) => ({ ...t, total: Number(t.total) })),
    returns: returnsInWindow.map((r) => ({ ...r, totalRefund: Number(r.totalRefund) })),
  };
}
