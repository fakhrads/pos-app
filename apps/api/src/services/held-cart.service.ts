/**
 * Fase 4 (SPEC §4.2, §5.7, §6.2) — Hold / parkir transaksi.
 *  - createHeldCart: snapshot JSONB TANPA harga (§1.3.6 — harga tidak dipercaya);
 *    limit aktif per kasir per hari (pos.hold_per_day_limit); nomor HOLD-... retry 1×.
 *  - listHeldCarts: hanya status='held' AND expires_at > now() milik user (lazy, tanpa job).
 *  - resumeHeldCart: status → 'resumed' (sekali; resume ulang → HELD_CART_NOT_ACTIVE);
 *    TIDAK memvalidasi produk/stok — validasi terjadi saat checkout (existing).
 *  - discardHeldCart: status → 'discarded' (soft, bukan hapus fisik).
 *  - Scoping: hold TIDAK pernah bisa diakses lintas user oleh kasir (404, server paksa).
 */
import { and, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { heldCarts, customers } from '../db/schema';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { nextHoldNumber } from '../lib/sequence';
import { getSettings, numSetting } from '../lib/settings';
import { endOfDayWib, startOfDayWib, remainingMinutes, isUniqueViolation, isUuid } from '../lib/shift';
import type { AuthUser } from '../middleware/auth';

/** Bentuk item hold — sama dengan `items` checkout (Fase 2 §4.4), tanpa harga. */
export interface HeldItemInput {
  productId: string;
  variantId?: string | null;
  unit?: string;
  quantity: number;
  discount?: { type: 'percentage' | 'fixed'; value: number; reason?: string };
}

export interface CreateHeldCartInput {
  label?: string;
  customerId?: string;
  items: HeldItemInput[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validasi manual bentuk items → HELD_CART_INVALID_ITEMS (SPEC §4.5, bukan VALIDATION_ERROR). */
export function validateHeldItems(raw: unknown): HeldItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail('HELD_CART_INVALID_ITEMS', 'Items wajib berupa array minimal 1 item', 422, {
      issues: [{ index: 0, message: 'Minimal 1 item' }],
    });
  }
  const issues: { index: number; message: string }[] = [];
  raw.forEach((it: unknown, index: number) => {
    if (typeof it !== 'object' || it === null) {
      issues.push({ index, message: 'Item bukan objek' });
      return;
    }
    const item = it as Record<string, unknown>;
    if (!UUID_RE.test(String(item.productId ?? ''))) issues.push({ index, message: 'productId harus UUID valid' });
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) issues.push({ index, message: 'quantity harus > 0' });
    else if (Math.round(qty * 1000) / 1000 !== qty) issues.push({ index, message: 'quantity maksimal 3 desimal' });
    if (item.variantId !== undefined && item.variantId !== null && !UUID_RE.test(String(item.variantId)))
      issues.push({ index, message: 'variantId harus UUID valid' });
    if (item.unit !== undefined && (typeof item.unit !== 'string' || item.unit.length > 20))
      issues.push({ index, message: 'unit maksimal 20 karakter' });
    if (item.discount !== undefined) {
      const d = item.discount as Record<string, unknown>;
      const okType = d && (d.type === 'percentage' || d.type === 'fixed');
      const okValue = d && typeof d.value === 'number' && d.value > 0;
      if (!okType || !okValue) issues.push({ index, message: 'discount harus { type: percentage|fixed, value > 0 }' });
    }
  });
  if (issues.length) {
    fail('HELD_CART_INVALID_ITEMS', 'Bentuk items hold tidak valid', 422, { issues });
  }
  return raw.map((it) => {
    const item = it as Record<string, unknown>;
    const outItem: HeldItemInput = {
      productId: String(item.productId),
      quantity: Number(item.quantity),
    };
    if (item.variantId !== undefined && item.variantId !== null) outItem.variantId = String(item.variantId);
    if (typeof item.unit === 'string' && item.unit.trim()) outItem.unit = item.unit.trim();
    if (item.discount !== undefined) outItem.discount = item.discount as HeldItemInput['discount'];
    return outItem;
  });
}

/** Buat hold (AC-04.1, AC-04.8, AC-04.9 — atomic 1 insert). */
export async function createHeldCart(
  input: CreateHeldCartInput,
  user: AuthUser,
  ip: string | null,
  ua: string | null,
): Promise<typeof heldCarts.$inferSelect> {
  const items = validateHeldItems(input.items);
  const label = input.label?.trim().slice(0, 100) || null;

  if (input.customerId !== undefined && input.customerId !== null) {
    if (!isUuid(input.customerId)) fail('VALIDATION_ERROR', 'customerId harus UUID valid', 422);
    const [c] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), sql`${customers.deletedAt} IS NULL`))
      .limit(1);
    if (!c) fail('CUSTOMER_NOT_FOUND', 'Pelanggan tidak ditemukan', 404);
  }

  // Limit aktif per kasir per hari WIB (AC-04.8, §3.3)
  const s = await getSettings();
  const limit = Math.max(1, numSetting(s, 'pos.hold_per_day_limit', 20));
  const [cnt] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(heldCarts)
    .where(and(eq(heldCarts.userId, user.id), eq(heldCarts.status, 'held'), gte(heldCarts.createdAt, startOfDayWib())));
  if (Number(cnt?.total ?? 0) >= limit) {
    fail('HELD_CART_LIMIT', `Maksimal ${limit} transaksi ditahan per hari — buang hold lama dulu`, 409, { limit });
  }

  const expiresAt = endOfDayWib();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const heldCart = await db.transaction(async (tx) => {
        const holdNumber = await nextHoldNumber(tx);
        const [row] = await tx
          .insert(heldCarts)
          .values({
            holdNumber,
            outletId: user.outletId,
            userId: user.id,
            label,
            customerId: input.customerId ?? null,
            items: items as unknown as typeof heldCarts.$inferInsert.items,
            status: 'held',
            expiresAt,
            createdBy: user.id,
          })
          .returning();
        await writeAudit(tx, {
          userId: user.id,
          action: 'held_cart.create',
          entityType: 'held_cart',
          entityId: row.id,
          newValues: { holdNumber, itemCount: items.length, label, expiresAt },
          ipAddress: ip,
          userAgent: ua,
        });
        return row;
      });
      return heldCart;
    } catch (e) {
      if (attempt === 0 && isUniqueViolation(e)) continue;
      throw e;
    }
  }
  throw new Error('unreachable');
}

/** Daftar hold aktif milik user — status='held' AND expires_at > now() (AC-04.2, AC-04.6). */
export async function listHeldCarts(user: AuthUser, page: number, perPage: number): Promise<{ items: unknown[]; meta: unknown }> {
  const where = and(eq(heldCarts.userId, user.id), eq(heldCarts.status, 'held'), gt(heldCarts.expiresAt, new Date()));
  const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(heldCarts).where(where);
  const total = Number(countRows[0]?.total ?? 0);
  const rows = await db
    .select()
    .from(heldCarts)
    .where(where)
    .orderBy(desc(heldCarts.createdAt))
    .limit(perPage)
    .offset((page - 1) * perPage);
  return {
    items: rows.map((h) => ({
      id: h.id,
      holdNumber: h.holdNumber,
      label: h.label,
      customerId: h.customerId,
      items: h.items,
      status: h.status,
      expiresAt: h.expiresAt,
      remainingMinutes: remainingMinutes(h.expiresAt),
      createdAt: h.createdAt,
    })),
    meta: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
  };
}

/** Ambil hold milik user; hold user lain → 404 tanpa bocorkan keberadaan (AC-04.7). */
export async function getHeldCart(id: string, user: AuthUser): Promise<typeof heldCarts.$inferSelect> {
  const [row] = await db.select().from(heldCarts).where(eq(heldCarts.id, id)).limit(1);
  if (!row || row.userId !== user.id) fail('HELD_CART_NOT_FOUND', 'Transaksi ditahan tidak ditemukan', 404);
  return row;
}

/** Resume hold → status 'resumed' + items dikembalikan utuh (AC-04.3, AC-04.6). */
export async function resumeHeldCart(id: string, user: AuthUser, ip: string | null, ua: string | null): Promise<typeof heldCarts.$inferSelect> {
  const row = await getHeldCart(id, user);
  if (row.status !== 'held') fail('HELD_CART_NOT_ACTIVE', 'Hold sudah tidak aktif (resumed/discarded)', 409);
  if (row.expiresAt.getTime() <= Date.now()) fail('HELD_CART_EXPIRED', 'Hold sudah kadaluarsa (akhir hari WIB)', 409, { expiresAt: row.expiresAt });

  const [updated] = await db
    .update(heldCarts)
    .set({ status: 'resumed', resumedAt: new Date() })
    .where(and(eq(heldCarts.id, id), eq(heldCarts.status, 'held')))
    .returning();
  await writeAudit(db, {
    userId: user.id,
    action: 'held_cart.resume',
    entityType: 'held_cart',
    entityId: id,
    newValues: { holdNumber: row.holdNumber, status: 'resumed', itemCount: Array.isArray(row.items) ? row.items.length : 0 },
    ipAddress: ip,
    userAgent: ua,
  });
  return updated;
}

/** Buang hold → status 'discarded' (soft, AC-04.5). */
export async function discardHeldCart(id: string, user: AuthUser, ip: string | null, ua: string | null): Promise<{ id: string; discarded: true }> {
  const row = await getHeldCart(id, user);
  if (row.status !== 'held') fail('HELD_CART_NOT_ACTIVE', 'Hold sudah tidak aktif (resumed/discarded)', 409);

  await db
    .update(heldCarts)
    .set({ status: 'discarded' })
    .where(and(eq(heldCarts.id, id), eq(heldCarts.status, 'held')));
  await writeAudit(db, {
    userId: user.id,
    action: 'held_cart.discard',
    entityType: 'held_cart',
    entityId: id,
    newValues: { holdNumber: row.holdNumber, status: 'discarded' },
    ipAddress: ip,
    userAgent: ua,
  });
  return { id, discarded: true };
}
