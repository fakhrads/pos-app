/**
 * Customers (api-design.md §2.5) — kasir: tambah+baca; manager+: CRUD penuh.
 *  - GET /customers                 : list q/isMember/page
 *  - POST /customers                : kasir boleh buat saat checkout (CUST-02)
 *  - GET /customers/:id             : detail + membership + saldo poin
 *  - PATCH/DELETE                   : manager+/admin (soft delete)
 *  - GET /customers/:id/transactions: histori belanja (kasir: hari itu saja)
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { customers, memberships, transactions } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta, todayRangeWib } from '../lib/http';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { getSettings, strSetting } from '../lib/settings';
import { mustAuth, mustManager, mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

/* ---------------- baca & tambah: kasir+ ---------------- */
const kasirRoutes = new Elysia()
  .use(mustAuth)
  .get('/customers', async (ctx: RouteCtx) => {
    const { page, perPage } = parsePagination(ctx.query);
    const conds = [isNull(customers.deletedAt)];
    const q = ctx.query.q?.trim();
    if (q) conds.push(or(ilike(customers.name, `%${q}%`), ilike(customers.phone, `%${q}%`)) as any);
    if (ctx.query.isMember === 'true') {
      conds.push(sql`EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = ${customers.id})`);
    }
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        address: customers.address,
        notes: customers.notes,
        createdAt: customers.createdAt,
        isMember: sql<boolean>`EXISTS (SELECT 1 FROM memberships m WHERE m.customer_id = ${customers.id})`,
      })
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })
  .post(
    '/customers',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const phone = ctx.body.phone?.trim() || null;
      if (phone) {
        const dup = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.phone, phone), isNull(customers.deletedAt))).limit(1);
        if (dup[0]) fail('DUPLICATE_PHONE', `No. HP '${phone}' sudah terdaftar`, 409);
      }
      const [customer] = await db
        .insert(customers)
        .values({
          name: String(ctx.body.name),
          phone,
          email: ctx.body.email?.trim() || null,
          address: ctx.body.address ?? null,
          notes: ctx.body.notes ?? null,
        })
        .returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'customer.create',
        entityType: 'customer',
        entityId: customer.id,
        newValues: { name: customer.name, phone: customer.phone },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ customer });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 150 }),
        phone: t.Optional(t.String({ maxLength: 30 })),
        email: t.Optional(t.String({ format: 'email' })),
        address: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    },
  )
  .get('/customers/:id', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const rows = await db.select().from(customers).where(and(eq(customers.id, ctx.params.id), isNull(customers.deletedAt))).limit(1);
    const customer = rows[0];
    if (!customer) fail('NOT_FOUND', 'Pelanggan tidak ditemukan', 404);

    const membershipRows = await db.select().from(memberships).where(eq(memberships.customerId, customer.id)).limit(1);
    const membership = membershipRows[0] ?? null;
    return ok({
      customer,
      membership: membership
        ? {
            id: membership.id,
            memberCode: membership.memberCode,
            tier: membership.tier,
            pointsBalance: Number(membership.pointsBalance),
            pointsEarnedTotal: Number(membership.pointsEarnedTotal),
            pointsRedeemedTotal: Number(membership.pointsRedeemedTotal),
            joinedAt: membership.joinedAt,
            expiresAt: membership.expiresAt,
          }
        : null,
    });
  })
  .get('/customers/:id/transactions', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const rows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, ctx.params.id), isNull(customers.deletedAt))).limit(1);
    if (!rows[0]) fail('NOT_FOUND', 'Pelanggan tidak ditemukan', 404);

    const { page, perPage } = parsePagination(ctx.query);
    const conds = [eq(transactions.customerId, ctx.params.id)];
    // Kasir: dibatasi transaksi hari itu (BA §5)
    if (user.role === 'kasir') {
      const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');
      const { from, to } = todayRangeWib(tz);
      conds.push(gte(transactions.soldAt, from), lte(transactions.soldAt, to));
    }
    if (ctx.query.from) conds.push(gte(transactions.soldAt, new Date(ctx.query.from)));
    if (ctx.query.to) conds.push(lte(transactions.soldAt, new Date(ctx.query.to)));
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(transactions).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select({
        id: transactions.id,
        invoiceNumber: transactions.invoiceNumber,
        status: transactions.status,
        total: transactions.total,
        paymentStatus: transactions.paymentStatus,
        pointsEarned: transactions.pointsEarned,
        soldAt: transactions.soldAt,
      })
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.soldAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  });

/* ---------------- tulis: manager+ ---------------- */
const managerRoutes = new Elysia()
  .use(mustManager)
  .patch(
    '/customers/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const rows = await db.select().from(customers).where(and(eq(customers.id, ctx.params.id), isNull(customers.deletedAt))).limit(1);
      const customer = rows[0];
      if (!customer) fail('NOT_FOUND', 'Pelanggan tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      if (ctx.body.name !== undefined) patch.name = String(ctx.body.name);
      if (ctx.body.email !== undefined) patch.email = ctx.body.email?.trim() || null;
      if (ctx.body.address !== undefined) patch.address = ctx.body.address ?? null;
      if (ctx.body.notes !== undefined) patch.notes = ctx.body.notes ?? null;
      if (ctx.body.phone !== undefined) {
        const phone = String(ctx.body.phone).trim() || null;
        if (phone) {
          const dup = await db
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.phone, phone), isNull(customers.deletedAt), sql`${customers.id} <> ${customer.id}`))
            .limit(1);
          if (dup[0]) fail('DUPLICATE_PHONE', `No. HP '${phone}' sudah terdaftar`, 409);
        }
        patch.phone = phone;
      }

      const [updated] = await db.update(customers).set(patch).where(eq(customers.id, customer.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'customer.update',
        entityType: 'customer',
        entityId: customer.id,
        oldValues: { name: customer.name, phone: customer.phone },
        newValues: { name: updated.name, phone: updated.phone },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ customer: updated });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 150 })),
        phone: t.Optional(t.Union([t.String({ maxLength: 30 }), t.Null()])),
        email: t.Optional(t.Union([t.String({ format: 'email' }), t.Null()])),
        address: t.Optional(t.Union([t.String(), t.Null()])),
        notes: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  );

/* ---------------- delete: admin ---------------- */
const adminRoutes = new Elysia()
  .use(mustAdmin)
  .delete('/customers/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const rows = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, ctx.params.id), isNull(customers.deletedAt))).limit(1);
    if (!rows[0]) fail('NOT_FOUND', 'Pelanggan tidak ditemukan', 404);

    await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, ctx.params.id));
    await writeAudit(db, {
      userId: user.id,
      action: 'customer.delete',
      entityType: 'customer',
      entityId: ctx.params.id,
      newValues: { deletedAt: new Date().toISOString() },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: ctx.params.id, deleted: true });
  });

export const customersRoutes = new Elysia().use(kasirRoutes).use(managerRoutes).use(adminRoutes);
