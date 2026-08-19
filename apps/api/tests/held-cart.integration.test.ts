/**
 * Integration test: Held carts (SPEC §4.2, AC-04.x, AC-08.3).
 * BUTUH DATABASE (dev/demo). Bila DB tidak tersedia → test di-skip (pola existing).
 *
 * Cakupan: create (AC-04.1), validasi items (HELD_CART_INVALID_ITEMS, §4.5),
 * limit harian (AC-04.8), list aktif + remainingMinutes (AC-04.2/04.6),
 * scoping lintas user (AC-04.7), resume (AC-04.3), resume ulang (NOT_ACTIVE),
 * expired (AC-04.6), discard (AC-04.5), audit (AC-08.3).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { client, db } from '../src/db';
import { users, heldCarts, auditLogs, settings } from '../src/db/schema';
import {
  createHeldCart,
  listHeldCarts,
  getHeldCart,
  resumeHeldCart,
  discardHeldCart,
  validateHeldItems,
} from '../src/services/held-cart.service';
import { isAppError } from '../src/lib/errors';
import { getSettings } from '../src/lib/settings';
import { endOfDayWib } from '../src/lib/shift';
import type { AuthUser } from '../src/middleware/auth';

let dbAvailable = true;
let kasirA: AuthUser = { id: '', name: 'Kasir A', email: '', role: 'kasir', outletId: 1 };
let kasirB: AuthUser = { id: '', name: 'Kasir B', email: '', role: 'kasir', outletId: 1 };
let tmpUserIds: string[] = [];
let createdHoldIds: string[] = [];

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001'; // UUID valid, produk boleh tidak ada (hold tidak validasi produk)

async function tryConnect(): Promise<boolean> {
  try {
    await db.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function getOrCreateUser(email: string, name: string): Promise<AuthUser> {
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.email, email)).limit(1);
  if (u) return { id: u.id, name: u.name, email: u.email, role: u.role, outletId: 1 };
  const [created] = await db.insert(users).values({ name, email, passwordHash: 'x', role: 'kasir', isActive: true, outletId: 1 }).returning();
  tmpUserIds.push(created.id);
  return { id: created.id, name: created.name, email: created.email, role: created.role, outletId: 1 };
}

beforeAll(async () => {
  dbAvailable = await tryConnect();
  if (!dbAvailable) return;
  kasirA = await getOrCreateUser(`test-hold-a-${Date.now()}@local`, 'Hold Kasir A');
  kasirB = await getOrCreateUser(`test-hold-b-${Date.now()}@local`, 'Hold Kasir B');
});

afterAll(async () => {
  if (!dbAvailable) return;
  if (createdHoldIds.length) await db.delete(heldCarts).where(inArray(heldCarts.id, createdHoldIds));
  await db.delete(auditLogs).where(inArray(auditLogs.userId, [kasirA.id, kasirB.id]));
  // Kembalikan setting ke default (jangan hapus — key ini di-seed DDL)
  await db
    .insert(settings)
    .values({ key: 'pos.hold_per_day_limit', value: 20, description: 'Maks hold aktif per kasir per hari.' })
    .onConflictDoUpdate({ target: settings.key, set: { value: 20 } });
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

describe('held-cart: validasi items (HELD_CART_INVALID_ITEMS, §4.5)', () => {
  test.skipIf(!dbAvailable)('items kosong → HELD_CART_INVALID_ITEMS', () => {
    const r = (() => {
      try {
        validateHeldItems([]);
      } catch (e) {
        return e as { code: string };
      }
      return null;
    })();
    expect(r).not.toBeNull();
    expect(r!.code).toBe('HELD_CART_INVALID_ITEMS');
  });

  test.skipIf(!dbAvailable)('productId bukan UUID / qty ≤ 0 / discount salah → HELD_CART_INVALID_ITEMS', () => {
    for (const bad of [
      [{ productId: 'bukan-uuid', quantity: 1 }],
      [{ productId: PRODUCT_ID, quantity: 0 }],
      [{ productId: PRODUCT_ID, quantity: -2 }],
      [{ productId: PRODUCT_ID, quantity: 1.0005 }],
      [{ productId: PRODUCT_ID, quantity: 1, discount: { type: 'persen', value: 10 } }],
    ]) {
      try {
        validateHeldItems(bad);
        throw new Error('seharusnya throw');
      } catch (e) {
        if (!isAppError(e)) throw e;
        expect((e as { code: string }).code).toBe('HELD_CART_INVALID_ITEMS');
      }
    }
  });

  test.skipIf(!dbAvailable)('bentuk valid diterima & dinormalisasi', () => {
    const out = validateHeldItems([
      { productId: PRODUCT_ID, quantity: 2 },
      { productId: PRODUCT_ID, variantId: '00000000-0000-4000-8000-000000000002', unit: 'dus', quantity: 1.5, discount: { type: 'fixed', value: 1000 } },
    ]);
    expect(out.length).toBe(2);
    expect(out[1]!.unit).toBe('dus');
    expect(out[1]!.discount).toEqual({ type: 'fixed', value: 1000 });
  });
});

describe('held-cart: create (AC-04.1, AC-04.8, AC-04.9)', () => {
  test.skipIf(!dbAvailable)('create → holdNumber HOLD-..., status held, expiresAt akhir hari WIB', async () => {
    const held = await createHeldCart(
      { label: 'Bu Rina — dompet', items: [{ productId: PRODUCT_ID, quantity: 2 }] },
      kasirA,
      null,
      null,
    );
    createdHoldIds.push(held.id);
    expect(held.holdNumber).toMatch(/^HOLD-\d{8}-\d{4}$/);
    expect(held.status).toBe('held');
    expect(held.label).toBe('Bu Rina — dompet');
    expect(held.userId).toBe(kasirA.id);
    expect(Array.isArray(held.items)).toBe(true);
    expect((held.items as { productId: string; quantity: number }[])[0]).toMatchObject({ productId: PRODUCT_ID, quantity: 2 });
    // expiresAt = akhir hari WIB (23:59:59.999 WIB)
    expect(held.expiresAt.getTime()).toBe(endOfDayWib().getTime());
  });

  test.skipIf(!dbAvailable)('create dengan varian + satuan + diskon (bentuk checkout items)', async () => {
    const held = await createHeldCart(
      { items: [{ productId: PRODUCT_ID, variantId: '00000000-0000-4000-8000-000000000002', unit: 'dus', quantity: 1, discount: { type: 'percentage', value: 10 } }] },
      kasirA,
      null,
      null,
    );
    createdHoldIds.push(held.id);
    expect((held.items as { productId: string; unit: string; discount: object }[])[0]).toMatchObject({ productId: PRODUCT_ID, unit: 'dus', discount: { type: 'percentage', value: 10 } });
  });

  test.skipIf(!dbAvailable)('limit harian → 409 HELD_CART_LIMIT (AC-04.8)', async () => {
    await setSetting('pos.hold_per_day_limit', 2);
    const h1 = await createHeldCart({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, kasirB, null, null);
    const h2 = await createHeldCart({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, kasirB, null, null);
    createdHoldIds.push(h1.id, h2.id);
    const r = await failOf(() => createHeldCart({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, kasirB, null, null));
    expect(r.code).toBe('HELD_CART_LIMIT');
    expect((r.details as { limit: number }).limit).toBe(2);
    // Hold yang sudah resumed/discarded TIDAK dihitung limit → buang satu lalu bisa lagi
    await discardHeldCart(h1.id, kasirB, null, null);
    const h3 = await createHeldCart({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, kasirB, null, null);
    createdHoldIds.push(h3.id);
    await setSetting('pos.hold_per_day_limit', 20);
  });

  test.skipIf(!dbAvailable)('audit held_cart.create tercatat (AC-08.3)', async () => {
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, kasirA.id), eq(auditLogs.action, 'held_cart.create')))
      .orderBy(auditLogs.createdAt)
      .limit(1);
    expect(log).toBeTruthy();
    expect(log!.entityType).toBe('held_cart');
    expect((log!.newValues as { itemCount: number }).itemCount).toBeGreaterThanOrEqual(1);
  });
});

describe('held-cart: list & scoping (AC-04.2, AC-04.6, AC-04.7)', () => {
  test.skipIf(!dbAvailable)('list → hanya hold aktif milik user + remainingMinutes', async () => {
    const { items, meta } = await listHeldCarts(kasirA, 1, 50);
    expect((meta as { total: number }).total).toBeGreaterThanOrEqual(1);
    for (const it of items as { userId?: string; remainingMinutes: number; status: string }[]) {
      expect(it.status).toBe('held');
      expect(it.remainingMinutes).toBeGreaterThanOrEqual(0);
      expect(it.remainingMinutes).toBeLessThanOrEqual(24 * 60);
    }
  });

  test.skipIf(!dbAvailable)('hold milik kasir lain → 404 HELD_CART_NOT_FOUND (AC-04.7)', async () => {
    const [mine] = await db.select().from(heldCarts).where(eq(heldCarts.userId, kasirA.id)).limit(1);
    const r = await failOf(() => getHeldCart(mine.id, kasirB));
    expect(r.code).toBe('HELD_CART_NOT_FOUND');
    const r2 = await failOf(() => resumeHeldCart(mine.id, kasirB, null, null));
    expect(r2.code).toBe('HELD_CART_NOT_FOUND');
  });

  test.skipIf(!dbAvailable)('hold kadaluarsa tidak muncul di list (AC-04.6 — lazy, tanpa job)', async () => {
    // Insert langsung dengan expires_at di masa lalu (status tetap 'held' di DB)
    const [expired] = await db
      .insert(heldCarts)
      .values({
        holdNumber: `HOLD-EXP-${Date.now()}`,
        outletId: 1,
        userId: kasirA.id,
        label: 'Expired',
        items: [{ productId: PRODUCT_ID, quantity: 1 }] as never,
        status: 'held',
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    createdHoldIds.push(expired.id);
    const { items } = await listHeldCarts(kasirA, 1, 50);
    expect((items as { id: string }[]).some((i) => i.id === expired.id)).toBe(false);
    // Resume hold expired → 409 HELD_CART_EXPIRED
    const r = await failOf(() => resumeHeldCart(expired.id, kasirA, null, null));
    expect(r.code).toBe('HELD_CART_EXPIRED');
  });
});

describe('held-cart: resume & discard state machine (AC-04.3, AC-04.5, §6.2)', () => {
  test.skipIf(!dbAvailable)('resume → status resumed + resumedAt; resume ulang → HELD_CART_NOT_ACTIVE', async () => {
    const held = await createHeldCart({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, kasirA, null, null);
    createdHoldIds.push(held.id);
    const resumed = await resumeHeldCart(held.id, kasirA, null, null);
    expect(resumed.status).toBe('resumed');
    expect(resumed.resumedAt).not.toBeNull();
    expect(resumed.items).toEqual(held.items); // item dikembalikan utuh

    const r = await failOf(() => resumeHeldCart(held.id, kasirA, null, null));
    expect(r.code).toBe('HELD_CART_NOT_ACTIVE');
    const r2 = await failOf(() => discardHeldCart(held.id, kasirA, null, null));
    expect(r2.code).toBe('HELD_CART_NOT_ACTIVE');
    // TIDAK muncul di list aktif lagi
    const { items } = await listHeldCarts(kasirA, 1, 50);
    expect((items as { id: string }[]).some((i) => i.id === held.id)).toBe(false);
  });

  test.skipIf(!dbAvailable)('discard → { discarded:true }; discard ulang → HELD_CART_NOT_ACTIVE', async () => {
    const held = await createHeldCart({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, kasirA, null, null);
    createdHoldIds.push(held.id);
    const res = await discardHeldCart(held.id, kasirA, null, null);
    expect(res).toEqual({ id: held.id, discarded: true });
    const r = await failOf(() => discardHeldCart(held.id, kasirA, null, null));
    expect(r.code).toBe('HELD_CART_NOT_ACTIVE');
  });

  test.skipIf(!dbAvailable)('audit held_cart.resume & held_cart.discard tercatat (AC-08.3)', async () => {
    const [resumeLog] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, kasirA.id), eq(auditLogs.action, 'held_cart.resume')))
      .orderBy(auditLogs.createdAt)
      .limit(1);
    expect(resumeLog).toBeTruthy();
    expect((resumeLog!.newValues as { status: string }).status).toBe('resumed');
    const [discardLog] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, kasirA.id), eq(auditLogs.action, 'held_cart.discard')))
      .orderBy(auditLogs.createdAt)
      .limit(1);
    expect(discardLog).toBeTruthy();
  });
});
