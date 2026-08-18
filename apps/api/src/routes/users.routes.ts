/**
 * Users (api-design.md §2.2) — admin only (AUTH-06).
 * Soft delete; tidak bisa hapus diri sendiri; reset password revoke semua session.
 */
import { Elysia, t } from 'elysia';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, userSessions } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta } from '../lib/http';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

const publicCols = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  role: users.role,
  outletId: users.outletId,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

export const usersRoutes = new Elysia()
  .use(mustAdmin)
  .get('/users', async (ctx: RouteCtx) => {
    const { page, perPage } = parsePagination(ctx.query);
    const conds = [isNull(users.deletedAt)];
    const q = ctx.query.q?.trim();
    if (q) {
      const nameQ = or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`));
      if (nameQ) conds.push(nameQ);
    }
    if (ctx.query.role) conds.push(eq(users.role, ctx.query.role as 'admin' | 'manager' | 'kasir'));
    if (ctx.query.isActive !== undefined) conds.push(eq(users.isActive, ctx.query.isActive === 'true'));
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select(publicCols)
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);

    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })
  .post(
    '/users',
    async (ctx: RouteCtx) => {
      const admin = getUser(ctx);
      const email = String(ctx.body.email).toLowerCase().trim();
      const dup = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
      if (dup[0]) fail('DUPLICATE_EMAIL', 'Email sudah terdaftar', 409);

      const passwordHash = await Bun.password.hash(String(ctx.body.password));
      const [user] = await db
        .insert(users)
        .values({
          name: String(ctx.body.name),
          email,
          phone: ctx.body.phone ?? null,
          passwordHash,
          role: ctx.body.role ?? 'kasir',
        })
        .returning(publicCols);

      await writeAudit(db, {
        userId: admin.id,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        newValues: { name: user.name, email: user.email, role: user.role },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ user });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        email: t.String({ format: 'email' }),
        phone: t.Optional(t.String({ maxLength: 30 })),
        role: t.Optional(t.Enum({ admin: 'admin', manager: 'manager', kasir: 'kasir' })),
        password: t.String({ minLength: 8, error: 'Password minimal 8 karakter' }),
      }),
    },
  )
  .get('/users/:id', async (ctx: RouteCtx) => {
    const rows = await db.select(publicCols).from(users).where(and(eq(users.id, ctx.params.id), isNull(users.deletedAt))).limit(1);
    const user = rows[0];
    if (!user) fail('NOT_FOUND', 'User tidak ditemukan', 404);
    return ok({ user });
  })
  .patch(
    '/users/:id',
    async (ctx: RouteCtx) => {
      const admin = getUser(ctx);
      const rows = await db.select().from(users).where(and(eq(users.id, ctx.params.id), isNull(users.deletedAt))).limit(1);
      const user = rows[0];
      if (!user) fail('NOT_FOUND', 'User tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      const oldValues = { name: user.name, email: user.email, phone: user.phone, role: user.role, isActive: user.isActive };
      if (ctx.body.name !== undefined) patch.name = String(ctx.body.name);
      if (ctx.body.phone !== undefined) patch.phone = ctx.body.phone === null ? null : String(ctx.body.phone);
      if (ctx.body.role !== undefined) patch.role = ctx.body.role;
      if (ctx.body.isActive !== undefined) patch.isActive = Boolean(ctx.body.isActive);
      if (ctx.body.email !== undefined) {
        const email = String(ctx.body.email).toLowerCase().trim();
        const dup = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email), isNull(users.deletedAt), sql`${users.id} <> ${user.id}`))
          .limit(1);
        if (dup[0]) fail('DUPLICATE_EMAIL', 'Email sudah terdaftar', 409);
        patch.email = email;
      }

      const [updated] = await db.update(users).set(patch).where(eq(users.id, user.id)).returning(publicCols);
      await writeAudit(db, {
        userId: admin.id,
        action: 'user.update',
        entityType: 'user',
        entityId: user.id,
        oldValues,
        newValues: { name: updated.name, email: updated.email, phone: updated.phone, role: updated.role, isActive: updated.isActive },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ user: updated });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        email: t.Optional(t.String({ format: 'email' })),
        phone: t.Optional(t.Union([t.String({ maxLength: 30 }), t.Null()])),
        role: t.Optional(t.Enum({ admin: 'admin', manager: 'manager', kasir: 'kasir' })),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete('/users/:id', async (ctx: RouteCtx) => {
    const admin = getUser(ctx);
    if (ctx.params.id === admin.id) fail('FORBIDDEN', 'Tidak bisa menghapus akun sendiri', 403);
    const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ctx.params.id), isNull(users.deletedAt))).limit(1);
    if (!rows[0]) fail('NOT_FOUND', 'User tidak ditemukan', 404);

    await db.update(users).set({ deletedAt: new Date(), isActive: false }).where(eq(users.id, ctx.params.id));
    await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, ctx.params.id));
    await writeAudit(db, {
      userId: admin.id,
      action: 'user.deactivate',
      entityType: 'user',
      entityId: ctx.params.id,
      newValues: { deletedAt: new Date().toISOString() },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: ctx.params.id, deleted: true });
  })
  .post(
    '/users/:id/reset-password',
    async (ctx: RouteCtx) => {
      const admin = getUser(ctx);
      const rows = await db.select({ id: users.id }).from(users).where(and(eq(users.id, ctx.params.id), isNull(users.deletedAt))).limit(1);
      if (!rows[0]) fail('NOT_FOUND', 'User tidak ditemukan', 404);

      const passwordHash = await Bun.password.hash(String(ctx.body.newPassword));
      await db.update(users).set({ passwordHash }).where(eq(users.id, ctx.params.id));
      await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, ctx.params.id));
      await writeAudit(db, {
        userId: admin.id,
        action: 'user.reset_password',
        entityType: 'user',
        entityId: ctx.params.id,
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ ok: true });
    },
    { body: t.Object({ newPassword: t.String({ minLength: 8, error: 'Password minimal 8 karakter' }) }) },
  );
