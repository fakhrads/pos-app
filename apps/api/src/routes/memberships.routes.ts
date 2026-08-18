/**
 * Memberships & Poin (api-design.md §2.6) — kelola: manager+; baca: kasir+.
 *  - POST /memberships                    : daftarkan member (member_code auto MBR-XXXXX)
 *  - GET /memberships/:id                 : detail tier/saldo poin
 *  - GET /memberships/:id/points-history  : riwayat point_movements (CUST-09)
 *  - PATCH /memberships/:id               : tier / expiresAt (tier otomatis = P1)
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { memberships, pointMovements, customers } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta } from '../lib/http';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { nextMemberCode } from '../lib/sequence';
import { mustAuth, mustManager, getUser, type RouteCtx } from '../middleware/auth';

const readRoutes = new Elysia()
  .use(mustAuth)
  .get('/memberships/:id', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const rows = await db.select().from(memberships).where(eq(memberships.id, ctx.params.id)).limit(1);
    const membership = rows[0];
    if (!membership) fail('NOT_FOUND', 'Membership tidak ditemukan', 404);
    return ok({
      membership: {
        id: membership.id,
        customerId: membership.customerId,
        memberCode: membership.memberCode,
        tier: membership.tier,
        pointsBalance: Number(membership.pointsBalance),
        pointsEarnedTotal: Number(membership.pointsEarnedTotal),
        pointsRedeemedTotal: Number(membership.pointsRedeemedTotal),
        joinedAt: membership.joinedAt,
        expiresAt: membership.expiresAt,
      },
    });
  })
  .get('/memberships/:id/points-history', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const rows = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.id, ctx.params.id)).limit(1);
    if (!rows[0]) fail('NOT_FOUND', 'Membership tidak ditemukan', 404);

    const { page, perPage } = parsePagination(ctx.query);
    const where = eq(pointMovements.membershipId, ctx.params.id);
    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(pointMovements).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select({
        id: pointMovements.id,
        type: pointMovements.type,
        points: pointMovements.points,
        balanceAfter: pointMovements.balanceAfter,
        note: pointMovements.note,
        transactionId: pointMovements.transactionId,
        createdAt: pointMovements.createdAt,
      })
      .from(pointMovements)
      .where(where)
      .orderBy(desc(pointMovements.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  });

const managerRoutes = new Elysia()
  .use(mustManager)
  .post(
    '/memberships',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const customerId = String(ctx.body.customerId);
      const customerRows = await db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
        .limit(1);
      if (!customerRows[0]) fail('NOT_FOUND', 'Pelanggan tidak ditemukan', 404);
      const dup = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.customerId, customerId)).limit(1);
      if (dup[0]) fail('ALREADY_MEMBER', 'Pelanggan sudah terdaftar sebagai member', 409);

      const memberCode = await nextMemberCode(db);
      const [membership] = await db
        .insert(memberships)
        .values({
          customerId,
          memberCode,
          tier: ctx.body.tier ?? 'bronze',
          expiresAt: ctx.body.expiresAt ? new Date(ctx.body.expiresAt) : null,
        })
        .returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'membership.create',
        entityType: 'membership',
        entityId: membership.id,
        newValues: { customerId, memberCode, tier: membership.tier },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ membership });
    },
    {
      body: t.Object({
        customerId: t.String({ format: 'uuid' }),
        tier: t.Optional(t.Enum({ bronze: 'bronze', silver: 'silver', gold: 'gold' })),
        expiresAt: t.Optional(t.String({ format: 'date-time' })),
      }),
    },
  )
  .patch(
    '/memberships/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const rows = await db.select().from(memberships).where(eq(memberships.id, ctx.params.id)).limit(1);
      const membership = rows[0];
      if (!membership) fail('NOT_FOUND', 'Membership tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      if (ctx.body.tier !== undefined) patch.tier = ctx.body.tier;
      if (ctx.body.expiresAt !== undefined) patch.expiresAt = ctx.body.expiresAt ? new Date(ctx.body.expiresAt) : null;

      const [updated] = await db.update(memberships).set(patch).where(eq(memberships.id, membership.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'membership.update',
        entityType: 'membership',
        entityId: membership.id,
        oldValues: { tier: membership.tier, expiresAt: membership.expiresAt },
        newValues: { tier: updated.tier, expiresAt: updated.expiresAt },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ membership: updated });
    },
    {
      body: t.Object({
        tier: t.Optional(t.Enum({ bronze: 'bronze', silver: 'silver', gold: 'gold' })),
        expiresAt: t.Optional(t.Union([t.String({ format: 'date-time' }), t.Null()])),
      }),
    },
  );

export const membershipsRoutes = new Elysia().use(readRoutes).use(managerRoutes);
