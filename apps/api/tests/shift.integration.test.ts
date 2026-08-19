/**
 * Integration test: Shift management (SPEC §4.1, AC-06.x, US-08).
 * BUTUH DATABASE (dev/demo). Bila DB tidak tersedia → test di-skip (pola existing).
 * Data test dibuat & dihapus sendiri (isolated).
 *
 * Cakupan: open (AC-06.1/06.2), current live stats, close + rumus AC-06.5,
 * notes wajib saat selisih (AC-06.6), double-close (AC-06.7), akses lintas user
 * (AC-06.8), window atribusi (AC-06.10), audit (AC-08.3), guard enforceShift (AC-06.3).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { client, db } from '../src/db';
import { users, shifts, transactions, payments, returns, auditLogs, settings, heldCarts } from '../src/db/schema';
import { openShift, closeShift, getCurrentShift, listShifts, getShiftDetail } from '../src/services/shift.service';
import { createHeldCart, discardHeldCart } from '../src/services/held-cart.service';
import { enforceShift, startOfDayWib, endOfDayWib } from '../src/lib/shift';
import { nextInvoiceNumber, nextReturnNumber } from '../src/lib/sequence';
import { getSettings } from '../src/lib/settings';
import { isAppError } from '../src/lib/errors';
import type { AuthUser } from '../src/middleware/auth';

let dbAvailable = true;
let kasirA: AuthUser = { id: '', name: 'Kasir A', email: '', role: 'kasir', outletId: 1 };
let kasirB: AuthUser = { id: '', name: 'Kasir B', email: '', role: 'kasir', outletId: 1 };
let manager: AuthUser = { id: '', name: 'Manager', email: '', role: 'manager', outletId: 1 };
let tmpUserIds: string[] = [];
let createdShiftIds: string[] = [];
let createdTrxIds: string[] = [];
let createdReturnIds: string[] = [];

async function tryConnect(): Promise<boolean> {
  try {
    await db.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function getOrCreateUser(email: string, name: string, role: 'kasir' | 'manager'): Promise<AuthUser> {
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.email, email)).limit(1);
  if (u) return { id: u.id, name: u.name, email: u.email, role: u.role, outletId: 1 };
  const [created] = await db
    .insert(users)
    .values({ name, email, passwordHash: 'x', role, isActive: true, outletId: 1 })
    .returning();
  tmpUserIds.push(created.id);
  return { id: created.id, name: created.name, email: created.email, role: created.role, outletId: 1 };
}

beforeAll(async () => {
  dbAvailable = await tryConnect();
  if (!dbAvailable) return;
  kasirA = await getOrCreateUser(`test-kasir-a-${Date.now()}@local`, 'Kasir A', 'kasir');
  kasirB = await getOrCreateUser(`test-kasir-b-${Date.now()}@local`, 'Kasir B', 'kasir');
  manager = await getOrCreateUser(`test-mgr-${Date.now()}@local`, 'Manager', 'manager');
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (createdReturnIds.length) await db.delete(returns).where(inArray(returns.id, createdReturnIds));
  if (createdTrxIds.length) {
    await db.delete(payments).where(inArray(payments.transactionId, createdTrxIds));
    await db.delete(transactions).where(inArray(transactions.id, createdTrxIds));
  }
  if (createdShiftIds.length) await db.delete(shifts).where(inArray(shifts.id, createdShiftIds));
  // audit + held carts milik user test (FK: hapus hold sebelum hapus user)
  await db.delete(heldCarts).where(inArray(heldCarts.userId, [kasirA.id, kasirB.id]));
  await db.delete(auditLogs).where(inArray(auditLogs.userId, [kasirA.id, kasirB.id, manager.id]));
  if (tmpUserIds.length) await db.delete(users).where(inArray(users.id, tmpUserIds));
  await client.end();
});

async function failOf(fn: () => Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await fn();
  } catch (e) {
    if (isAppError(e)) return { code: e.code, details: e.details };
    throw e;
  }
  throw new Error('diharapkan throw AppError');
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({ target: settings.key, set: { value: value as never } });
  // getSettings punya cache TTL 30s — paksa reload agar test melihat nilai baru
  await getSettings(true);
}

/** Buat transaksi completed + payment sale (langsung insert — fokus logika shift). */
async function seedTransaction(userId: string, total: number, method: 'cash' | 'qris' | 'transfer', soldAt = new Date()) {
  const invoiceNumber = await nextInvoiceNumber(db, soldAt);
  const [trx] = await db
    .insert(transactions)
    .values({
      invoiceNumber,
      outletId: 1,
      userId,
      status: 'completed',
      subtotal: total,
      discountTotal: 0,
      taxTotal: 0,
      total,
      paymentStatus: 'paid',
      soldAt,
    })
    .returning();
  createdTrxIds.push(trx.id);
  await db.insert(payments).values({
    transactionId: trx.id,
    outletId: 1,
    type: 'sale',
    method,
    amount: total,
    status: 'paid',
    paidAt: soldAt,
  });
  return trx;
}

/** Buat return completed + refund payment cash. */
async function seedReturn(userId: string, transactionId: string, totalRefund: number, returnedAt = new Date()) {
  const returnNumber = await nextReturnNumber(db, returnedAt);
  const [ret] = await db
    .insert(returns)
    .values({
      returnNumber,
      outletId: 1,
      transactionId,
      userId,
      status: 'completed',
      refundMethod: 'cash',
      totalRefund,
      returnedAt,
    })
    .returning();
  createdReturnIds.push(ret.id);
  const [p] = await db
    .insert(payments)
    .values({
      transactionId,
      outletId: 1,
      type: 'refund',
      method: 'cash',
      amount: totalRefund,
      status: 'paid',
      paidAt: returnedAt,
    })
    .returning();
  await db.update(returns).set({ refundPaymentId: p.id }).where(eq(returns.id, ret.id));
  return ret;
}

describe('shift: buka (AC-06.1, AC-06.2)', () => {
  test.skipIf(!dbAvailable)('openShift → 201 shift open SHF-..., openingCash tersimpan', async () => {
    const shift = await openShift({ openingCash: 200000 }, kasirA, null, null);
    createdShiftIds.push(shift.id);
    expect(shift.status).toBe('open');
    expect(shift.shiftNumber).toMatch(/^SHF-\d{8}-\d{4}$/);
    expect(Number(shift.openingCash)).toBe(200000);
    expect(shift.closedAt).toBeNull();
  });

  test.skipIf(!dbAvailable)('openShift kedua → 409 SHIFT_ALREADY_OPEN dengan details.shiftId', async () => {
    const r = await failOf(() => openShift({ openingCash: 100000 }, kasirA, null, null));
    expect(r.code).toBe('SHIFT_ALREADY_OPEN');
    expect((r.details as { shiftId: string }).shiftId).toBeTruthy();
  });

  test.skipIf(!dbAvailable)('openShift openingCash negatif → VALIDATION_ERROR', async () => {
    const r = await failOf(() => openShift({ openingCash: -5 }, kasirB, null, null));
    expect(r.code).toBe('VALIDATION_ERROR');
  });

  test.skipIf(!dbAvailable)('audit shift.open tercatat (AC-08.3)', async () => {
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, kasirA.id), eq(auditLogs.action, 'shift.open')))
      .orderBy(auditLogs.createdAt)
      .limit(1);
    expect(log).toBeTruthy();
    expect(log!.entityType).toBe('shift');
    expect((log!.newValues as { openingCash: number }).openingCash).toBe(200000);
  });
});

describe('shift: guard & current (AC-06.3, AC-06.1 banner)', () => {
  test.skipIf(!dbAvailable)('enforceShift dengan shift terbuka → mengembalikan shift', async () => {
    const s = await enforceShift(db, kasirA);
    expect(s).not.toBeNull();
    expect(s!.userId).toBe(kasirA.id);
  });

  test.skipIf(!dbAvailable)('enforceShift tanpa shift → 409 SHIFT_REQUIRED (kasirB belum buka)', async () => {
    const r = await failOf(() => enforceShift(db, kasirB));
    expect(r.code).toBe('SHIFT_REQUIRED');
  });

  test.skipIf(!dbAvailable)('enforceShift saat setting dimatikan → null (dev/demo)', async () => {
    await setSetting('shift.enforce_checkout', false);
    const s = await enforceShift(db, kasirB);
    expect(s).toBeNull();
    await setSetting('shift.enforce_checkout', true);
  });

  test.skipIf(!dbAvailable)('getCurrentShift: statistik live + shift null untuk kasir tanpa shift', async () => {
    const cur = await getCurrentShift(kasirA);
    expect(cur.shift).not.toBeNull();
    expect((cur.shift as { shiftNumber: string }).shiftNumber).toMatch(/^SHF-/);
    expect((cur.shift as { openingCash: number }).openingCash).toBe(200000);

    const none = await getCurrentShift(kasirB);
    expect(none.shift).toBeNull();
  });
});

describe('shift: tutup + rumus snapshot (AC-06.5, AC-06.6, AC-06.7)', () => {
  test.skipIf(!dbAvailable)('closeShift menghitung cashSales/qrisSales/refunds/expectedCash/discrepancy', async () => {
    // Window: shift kasirA sudah open (openingCash 200.000). Tambahkan:
    //  - transaksi tunai 250.000 (dalam window) — 20.000 darinya diretur
    //  - transaksi qris 100.000 (dalam window)
    //  - transaksi tunai 50.000 (dalam window)
    //  - retur tunai 20.000 (dalam window, terhadap transaksi 250.000)
    //  - transaksi tunai 999.000 SEBELUM openedAt (harus TIDAK masuk window)
    // Rumus (§5.5): cashSales = Σ payment sale cash (transaksi returned TETAP
    // dihitung — retur tidak mengubah status transaksi), expectedCash =
    // openingCash + cashSales − cashRefunds → 200k + 300k − 20k = 480k.
    const [openShift] = await db.select().from(shifts).where(and(eq(shifts.userId, kasirA.id), eq(shifts.status, 'open'))).limit(1);
    const tx250 = await seedTransaction(kasirA.id, 250000, 'cash');
    await seedTransaction(kasirA.id, 100000, 'qris');
    await seedTransaction(kasirA.id, 50000, 'cash');
    await seedTransaction(kasirA.id, 999000, 'cash', new Date(openShift.openedAt.getTime() - 60_000));
    await seedReturn(kasirA.id, tx250.id, 20000);

    const { shift, summary } = await closeShift(openShift.id, { actualCash: 300000, notes: 'Selisih kas ditutup dengan catatan (AC-06.5/06.6)' }, kasirA, null, null);
    createdShiftIds.push(shift.id);
    expect(shift.status).toBe('closed');
    expect(shift.closedAt).not.toBeNull();
    expect(summary.cashSales).toBe(300000); // 250 + 50 (999k di luar window)
    expect(summary.qrisSales).toBe(100000);
    expect(summary.transferSales).toBe(0);
    expect(summary.refunds).toBe(20000);
    expect(summary.expectedCash).toBe(200000 + 300000 - 20000); // opening + cashSales − cashRefunds
    expect(summary.actualCash).toBe(300000);
    expect(summary.discrepancy).toBe(300000 - 480000); // −180.000 (AC-06.5)
    expect(summary.transactionCount).toBe(3); // 250 + 100 + 50 (999k TIDAK dihitung)
    expect(summary.returnCount).toBe(1);
  });

  test.skipIf(!dbAvailable)('tutup shift yang sudah closed → 409 SHIFT_ALREADY_CLOSED (AC-06.7)', async () => {
    const [closed] = await db.select().from(shifts).where(and(eq(shifts.userId, kasirA.id), eq(shifts.status, 'closed'))).limit(1);
    const r = await failOf(() => closeShift(closed.id, { actualCash: 300000 }, kasirA, null, null));
    expect(r.code).toBe('SHIFT_ALREADY_CLOSED');
  });

  test.skipIf(!dbAvailable)('selisih ≠ 0 tanpa notes → 422 SHIFT_DISCREPANCY_NOTE_REQUIRED (AC-06.6)', async () => {
    const shift = await openShift({ openingCash: 100000 }, kasirB, null, null);
    createdShiftIds.push(shift.id);
    await seedTransaction(kasirB.id, 50000, 'cash');
    const r = await failOf(() => closeShift(shift.id, { actualCash: 200000 }, kasirB, null, null)); // selisih +50.000
    expect(r.code).toBe('SHIFT_DISCREPANCY_NOTE_REQUIRED');

    // Dengan notes → sukses
    const { shift: closed } = await closeShift(shift.id, { actualCash: 200000, notes: 'Uang lebih dari kembalian receh' }, kasirB, null, null);
    expect(closed.status).toBe('closed');
    expect(closed.notes).toBe('Uang lebih dari kembalian receh');
  });

  test.skipIf(!dbAvailable)('toleransi kas di-setting → selisih kecil tanpa notes diizinkan', async () => {
    await setSetting('shift.cash_tolerance', 10000);
    const shift = await openShift({ openingCash: 0 }, kasirB, null, null);
    createdShiftIds.push(shift.id);
    await seedTransaction(kasirB.id, 50000, 'cash');
    const { shift: closed } = await closeShift(shift.id, { actualCash: 50500 }, kasirB, null, null); // selisih +500 ≤ 10.000
    expect(closed.status).toBe('closed');
    await setSetting('shift.cash_tolerance', 0);
  });

  test.skipIf(!dbAvailable)('kasir lain menutup shift → 403 FORBIDDEN (AC-06.8)', async () => {
    const shift = await openShift({ openingCash: 0 }, kasirA, null, null);
    createdShiftIds.push(shift.id);
    const r = await failOf(() => closeShift(shift.id, { actualCash: 0 }, kasirB, null, null));
    expect(r.code).toBe('FORBIDDEN');
    // manager boleh
    const { shift: closed } = await closeShift(shift.id, { actualCash: 0 }, manager, null, null);
    expect(closed.status).toBe('closed');
  });

  test.skipIf(!dbAvailable)('audit shift.close mencatat discrepancy (AC-08.3)', async () => {
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, kasirB.id), eq(auditLogs.action, 'shift.close')))
      .orderBy(auditLogs.createdAt)
      .limit(1);
    expect(log).toBeTruthy();
    expect((log!.newValues as { discrepancy: number }).discrepancy).toBe(50000);
  });
});

describe('shift: list & detail (AC-06.8, AC-06.9)', () => {
  test.skipIf(!dbAvailable)('listShifts kasir → hanya shift miliknya', async () => {
    const { items, meta } = await listShifts(kasirA, { page: 1, perPage: 50 });
    expect(items.length).toBeGreaterThanOrEqual(1);
    for (const it of items as { userId: string }[]) expect(it.userId).toBe(kasirA.id);
    expect((meta as { total: number }).total).toBe(items.length);
    const item = items[0] as { userName: string; shiftNumber: string; openingCash: number; status: string };
    expect(item.userName).toBe('Kasir A');
    expect(item.shiftNumber).toMatch(/^SHF-/);
    expect(typeof item.openingCash).toBe('number');
  });

  test.skipIf(!dbAvailable)('listShifts manager → semua shift + filter userId & status', async () => {
    const all = await listShifts(manager, { page: 1, perPage: 100 });
    expect((all.items as unknown[]).length).toBeGreaterThanOrEqual(createdShiftIds.length - 0);
    const closedOnly = await listShifts(manager, { page: 1, perPage: 100, status: 'closed' });
    for (const it of closedOnly.items as { status: string }[]) expect(it.status).toBe('closed');
    const filterA = await listShifts(manager, { page: 1, perPage: 100, userId: kasirA.id });
    for (const it of filterA.items as { userId: string }[]) expect(it.userId).toBe(kasirA.id);
  });

  test.skipIf(!dbAvailable)('getShiftDetail kasir lain → 403; manager → 200 + transaksi window', async () => {
    const [closedShift] = await db.select().from(shifts).where(eq(shifts.userId, kasirA.id)).orderBy(shifts.closedAt).limit(1);
    const forbidden = await failOf(() => getShiftDetail(closedShift.id, kasirB));
    expect(forbidden.code).toBe('FORBIDDEN');

    const detail = (await getShiftDetail(closedShift.id, manager)) as {
      summary: { cashSales: number; expectedCash: number; discrepancy: number };
      transactions: { invoiceNumber: string; total: number }[];
      returns: unknown[];
      shift: { userName: string };
    };
    expect(detail.shift.userName).toBe('Kasir A');
    expect(detail.summary.cashSales).toBe(300000);
    expect(detail.summary.discrepancy).toBe(-180000);
    // Window atribusi: transaksi 999.000 sebelum openedAt TIDAK ikut
    expect(detail.transactions.map((t) => t.total)).not.toContain(999000);
    expect(detail.transactions.length).toBe(3);
    expect(detail.returns.length).toBe(1);
  });

  test.skipIf(!dbAvailable)('getShiftDetail shift tidak ada → 404 SHIFT_NOT_FOUND', async () => {
    const r = await failOf(() => getShiftDetail('00000000-0000-4000-8000-000000000000', manager));
    expect(r.code).toBe('SHIFT_NOT_FOUND');
  });
});

describe('shift: window lintas tengah malam & hold tidak menghalangi tutup (AC-06.10, AC-06.11)', () => {
  test.skipIf(!dbAvailable)('window = [opened_at, closed_at) — transaksi sebelum open & setelah close TIDAK masuk', async () => {
    const shift = await openShift({ openingCash: 0 }, kasirB, null, null);
    createdShiftIds.push(shift.id);
    const t1 = await seedTransaction(kasirB.id, 10000, 'cash', new Date(shift.openedAt.getTime() - 10_000));
    const t2 = await seedTransaction(kasirB.id, 20000, 'cash');
    const { summary } = await closeShift(shift.id, { actualCash: 20000 }, kasirB, null, null);
    expect(summary.cashSales).toBe(20000); // t1 sebelum open tidak dihitung
    expect(summary.transactionCount).toBe(1);
    const t3 = await seedTransaction(kasirB.id, 30000, 'cash'); // setelah close
    const detail = (await getShiftDetail(shift.id, manager)) as { transactions: { total: number }[] };
    expect(detail.transactions.map((t) => t.total)).not.toContain(30000);
    expect(detail.transactions.map((t) => t.total)).toContain(20000);
    void t1;
    void t3;
  });

  test.skipIf(!dbAvailable)('hold tidak menghalangi tutup shift (AC-06.11)', async () => {
    const shift = await openShift({ openingCash: 0 }, kasirB, null, null);
    createdShiftIds.push(shift.id);
    const held = await createHeldCart({ label: 'Paket A', items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 1 }] }, kasirB, null, null);
    const { shift: closed } = await closeShift(shift.id, { actualCash: 0 }, kasirB, null, null);
    expect(closed.status).toBe('closed');
    await discardHeldCart(held.id, kasirB, null, null);
  });
});

describe('shift: helper tanggal WIB (hold expiry, limit per hari)', () => {
  test.skipIf(!dbAvailable)('endOfDayWib = 23:59:59.999 WIB; startOfDayWib = 00:00 WIB', () => {
    const end = endOfDayWib();
    const start = startOfDayWib();
    expect(end.getTime() - start.getTime()).toBe(86_400_000 - 1);
    // Konversi balik ke WIB: end harus 23:59:59.999
    const endWib = new Date(end.getTime() + 7 * 3600_000);
    expect(endWib.getUTCHours()).toBe(23);
    expect(endWib.getUTCMinutes()).toBe(59);
    expect(endWib.getUTCSeconds()).toBe(59);
  });
});
