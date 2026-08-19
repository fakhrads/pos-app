/**
 * Kas masuk / kas keluar manual (Fase 5, SPEC §4.6 & F5-6) — P0, manager+.
 *  - POST /cash-movements  : catat mutasi kas (direction 'in'/'out', amount > 0)
 *  - GET  /cash-movements  : riwayat read-only (filter direction/method/kategori/tanggal)
 *  - GET  /cash-movements/:id : detail satu mutasi
 *  - DELETE /cash-movements/:id : hapus mutasi (koreksi salah input) — audit
 *
 * Mutasi kas manual = setoran kasir, tarikan (prive), pengeluaran operasional
 * di luar penjualan. TIDAK terkait transaksi penjualan. Untuk laporan keuangan
 * sederhana (laba rugi), kas 'out' kategori operasional bisa jadi beban kas,
 * bukan beban akrual — lihat laporan income-statement (reports.routes.ts).
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { cashMovements, users } from '../db/schema';
import { ok, parsePagination, paginationMeta, clientIp } from '../lib/http';
import { writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { mustManager, getUser, type RouteCtx } from '../middleware/auth';

const num = (v: unknown): number => Number(v ?? 0);

const DIRECTION = ['in', 'out'] as const;
type Direction = (typeof DIRECTION)[number];

const managerRoutes = new Elysia()
  .use(mustManager)

  /* POST /cash-movements — catat mutasi kas (AC-? spec §4.6) */
  .post(
    '/cash-movements',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const amount = Math.round(Number(ctx.body.amount));
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        fail('INVALID_AMOUNT', 'amount harus bilangan bulat > 0 (rupiah)', 422);
      }

      const [row] = await db
        .insert(cashMovements)
        .values({
          outletId: user.outletId,
          direction: ctx.body.direction as Direction,
          amount,
          method: ctx.body.method ?? 'cash',
          category: ctx.body.category ?? null,
          note: ctx.body.note ?? null,
          reference: ctx.body.reference ?? null,
          movementAt: ctx.body.movementAt ? new Date(ctx.body.movementAt) : new Date(),
          createdBy: user.id,
        })
        .returning();

      await writeAudit(db, {
        userId: user.id,
        action: 'cash_movement.create',
        entityType: 'cash_movements',
        entityId: row.id,
        newValues: {
          direction: row.direction,
          amount: row.amount,
          method: row.method,
          category: row.category,
          note: row.note,
          reference: row.reference,
          movementAt: row.movementAt,
        },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });

      return ok({
        id: row.id,
        direction: row.direction,
        amount: row.amount,
        method: row.method,
        category: row.category,
        note: row.note,
        reference: row.reference,
        movementAt: row.movementAt,
      });
    },
    {
      body: t.Object({
        direction: t.Enum({ in: 'in', out: 'out' }),
        amount: t.Number({ minimum: 1 }),
        method: t.Optional(t.Enum({ cash: 'cash', qris: 'qris', transfer: 'transfer' })),
        category: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
        note: t.Optional(t.Union([t.String(), t.Null()])),
        reference: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
        movementAt: t.Optional(t.String()),
      }),
    },
  )

  /* GET /cash-movements — riwayat read-only */
  .get('/cash-movements', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);

    const conds = [];
    if (ctx.query.direction === 'in' || ctx.query.direction === 'out') conds.push(eq(cashMovements.direction, ctx.query.direction));
    if (ctx.query.method) conds.push(sql`${cashMovements.method} = ${ctx.query.method as 'cash' | 'qris' | 'transfer'}`);
    if (ctx.query.category) conds.push(eq(cashMovements.category, ctx.query.category));
    if (ctx.query.reference) conds.push(sql`${cashMovements.reference} ILIKE ${`%${ctx.query.reference}%`}`);

    const fromRaw = ctx.query.from
      ? new Date(ctx.query.from.length === 10 ? `${ctx.query.from}T00:00:00+07:00` : ctx.query.from)
      : undefined;
    const toRaw = ctx.query.to
      ? new Date(ctx.query.to.length === 10 ? `${ctx.query.to}T00:00:00+07:00` : ctx.query.to)
      : undefined;
    if (fromRaw && !Number.isNaN(fromRaw.getTime())) conds.push(sql`${cashMovements.movementAt} >= ${fromRaw.toISOString()}`);
    if (toRaw && !Number.isNaN(toRaw.getTime())) {
      // akhir hari WIB untuk format tanggal saja
      const isDateOnly = ctx.query.to!.length === 10;
      const toEnd = isDateOnly ? new Date(toRaw.getTime() + 86_400_000 - 1) : toRaw;
      conds.push(sql`${cashMovements.movementAt} <= ${toEnd.toISOString()}`);
    }

    const where = conds.length ? and(...conds) : undefined;

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(cashMovements).where(where);
    const total = num(countRows[0]?.total);

    // Ringkasan per direction (untuk header kartu)
    const summaryRows = await db
      .select({
        direction: cashMovements.direction,
        totalAmount: sql<number>`coalesce(sum(${cashMovements.amount}),0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(cashMovements)
      .where(where)
      .groupBy(cashMovements.direction);

    const summary = {
      in: { total: 0, count: 0 },
      out: { total: 0, count: 0 },
    };
    for (const s of summaryRows) {
      if (s.direction === 'in' || s.direction === 'out') {
        summary[s.direction] = { total: num(s.totalAmount), count: num(s.count) };
      }
    }

    const rows = await db
      .select({
        id: cashMovements.id,
        direction: cashMovements.direction,
        amount: cashMovements.amount,
        method: cashMovements.method,
        category: cashMovements.category,
        note: cashMovements.note,
        reference: cashMovements.reference,
        movementAt: cashMovements.movementAt,
        createdById: users.id,
        createdByName: users.name,
      })
      .from(cashMovements)
      .leftJoin(users, eq(users.id, cashMovements.createdBy))
      .where(where)
      .orderBy(desc(cashMovements.movementAt), desc(cashMovements.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    const items = rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      amount: num(r.amount),
      method: r.method,
      category: r.category,
      note: r.note,
      reference: r.reference,
      movementAt: r.movementAt,
      createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '—' } : null,
    }));

    return ok({ items, summary, meta: paginationMeta(page, perPage, total) });
  })

  /* GET /cash-movements/:id — detail satu mutasi */
  .get('/cash-movements/:id', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const [r] = await db
      .select({
        id: cashMovements.id,
        direction: cashMovements.direction,
        amount: cashMovements.amount,
        method: cashMovements.method,
        category: cashMovements.category,
        note: cashMovements.note,
        reference: cashMovements.reference,
        movementAt: cashMovements.movementAt,
        createdById: users.id,
        createdByName: users.name,
        createdAt: cashMovements.createdAt,
        updatedAt: cashMovements.updatedAt,
      })
      .from(cashMovements)
      .leftJoin(users, eq(users.id, cashMovements.createdBy))
      .where(eq(cashMovements.id, ctx.params.id))
      .limit(1);
    if (!r) fail('NOT_FOUND', 'Mutasi kas tidak ditemukan', 404);
    return ok({
      id: r.id,
      direction: r.direction,
      amount: num(r.amount),
      method: r.method,
      category: r.category,
      note: r.note,
      reference: r.reference,
      movementAt: r.movementAt,
      createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '—' } : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  })

  /* DELETE /cash-movements/:id — hapus mutasi (koreksi salah input) */
  .delete('/cash-movements/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const [row] = await db
      .select({ id: cashMovements.id, direction: cashMovements.direction, amount: cashMovements.amount })
      .from(cashMovements)
      .where(eq(cashMovements.id, ctx.params.id))
      .limit(1);
    if (!row) fail('NOT_FOUND', 'Mutasi kas tidak ditemukan', 404);

    await db.delete(cashMovements).where(eq(cashMovements.id, row.id));

    await writeAudit(db, {
      userId: user.id,
      action: 'cash_movement.delete',
      entityType: 'cash_movements',
      entityId: row.id,
      oldValues: { direction: row.direction, amount: row.amount },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });

    return ok({ deleted: true, id: row.id });
  });

export const cashMovementsRoutes = managerRoutes;
