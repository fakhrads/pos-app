/**
 * Auth (M1) — api-design.md §2.1. Public: login/refresh. mustAuth: logout/me/change-password.
 */
import { Elysia, t } from 'elysia';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { users, userSessions } from '../db/schema';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from '../lib/jwt';
import { fail } from '../lib/errors';
import { ok, clientIp } from '../lib/http';
import { writeAudit } from '../lib/audit';
import { rateLimit, loginBlocked, recordLoginFail, resetLoginFails } from '../lib/rate-limit';
import { env, assertEnv } from '../env';
import { getUser, mustAuth, type RouteCtx } from '../middleware/auth';

const refreshTtlMs = env.REFRESH_TTL_DAYS * 24 * 3600 * 1000;
assertEnv();

export const authRoutes = new Elysia({ prefix: '/auth' })

  .post(
    '/login',
    async ({ body, headers, set }: RouteCtx) => {
      const ip = clientIp(headers);
      const email = (body.email as string).toLowerCase();
      const key = `${email}|${ip}`;

      if (loginBlocked(key)) fail('RATE_LIMITED', 'Terlalu banyak percobaan login. Coba lagi 5 menit lagi.', 429);

      const rows = await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
      const user = rows[0];
      const valid = user && (await Bun.password.verify(body.password as string, user.passwordHash));
      if (!valid || !user) {
        recordLoginFail(key);
        fail('INVALID_CREDENTIALS', 'Email atau password salah', 401);
      }
      if (!user.isActive) fail('ACCOUNT_DISABLED', 'Akun dinonaktifkan. Hubungi admin.', 403);

      resetLoginFails(key);
      const accessToken = await signAccessToken({
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        outletId: Number(user.outletId),
      });
      const refreshToken = generateRefreshToken();
      await db.insert(userSessions).values({
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        userAgent: headers['user-agent'] ?? null,
        ipAddress: ip,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      });
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await writeAudit(db, {
        userId: user.id,
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        newValues: { email: user.email },
        ipAddress: ip,
        userAgent: headers['user-agent'] ?? null,
      });
      return ok({
        accessToken,
        refreshToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    },
    {
      body: t.Object({ email: t.String({ format: 'email' }), password: t.String({ minLength: 1 }) }),
    },
  )

  .post(
    '/refresh',
    async ({ body }: RouteCtx) => {
      const token = body.refreshToken as string;
      const hash = hashRefreshToken(token);
      const sessions = await db
        .select()
        .from(userSessions)
        .where(and(eq(userSessions.refreshTokenHash, hash), isNull(userSessions.revokedAt)))
        .limit(1);
      const session = sessions[0];
      if (!session || session.expiresAt < new Date()) fail('TOKEN_EXPIRED', 'Refresh token tidak valid atau kedaluwarsa', 401);

      const rows = await db.select().from(users).where(and(eq(users.id, session.userId), isNull(users.deletedAt))).limit(1);
      const user = rows[0];
      if (!user || !user.isActive) fail('UNAUTHORIZED', 'Akun tidak ditemukan atau nonaktif', 401);

      // Rotasi: revoke lama, buat baru
      await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, session.id));
      const newRefresh = generateRefreshToken();
      await db.insert(userSessions).values({
        userId: user.id,
        refreshTokenHash: hashRefreshToken(newRefresh),
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      });

      const accessToken = await signAccessToken({
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        outletId: Number(user.outletId),
      });
      return ok({ accessToken, refreshToken: newRefresh, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    },
    { body: t.Object({ refreshToken: t.String({ minLength: 1 }) }) },
  )

  .use(mustAuth)

  .post('/logout', async ({ body, headers }: RouteCtx) => {
    const token = body.refreshToken as string;
    await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.refreshTokenHash, hashRefreshToken(token)));
    return ok({ ok: true });
  }, { body: t.Object({ refreshToken: t.String() }) })

  .get('/me', async ({ store }: RouteCtx) => {
    return ok({ user: store.user });
  })

  .post(
    '/change-password',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      const current = rows[0];
      if (!current || !(await Bun.password.verify(ctx.body.currentPassword as string, current.passwordHash)))
        fail('INVALID_CREDENTIALS', 'Password lama salah', 401);
      if (ctx.body.newPassword === ctx.body.currentPassword) fail('VALIDATION_ERROR', 'Password baru tidak boleh sama dengan lama', 422);
      const newHash = await Bun.password.hash(ctx.body.newPassword as string);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
      // Revoke semua session user lain (BA AUTH-05)
      await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, user.id));
      await writeAudit(db, {
        userId: user.id,
        action: 'user.change_password',
        entityType: 'user',
        entityId: user.id,
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ ok: true });
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 8, maxLength: 128 }),
      }),
    },
  );
