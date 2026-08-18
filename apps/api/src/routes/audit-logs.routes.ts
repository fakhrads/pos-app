/**
 * Audit Logs (api-design.md §2.12) — M11, P1 — admin only, read-only (append-only).
 */
import { Elysia } from 'elysia';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs } from '../db/schema';
import { ok, parsePagination, paginationMeta } from '../lib/http';
import { mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

export const auditLogsRoutes = new Elysia()
  .use(mustAdmin)
  .get('/audit-logs', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const conds = [];
    if (ctx.query.action) conds.push(eq(auditLogs.action, ctx.query.action));
    if (ctx.query.entityType) conds.push(eq(auditLogs.entityType, ctx.query.entityType));
    if (ctx.query.entityId) conds.push(eq(auditLogs.entityId, ctx.query.entityId));
    if (ctx.query.userId) conds.push(eq(auditLogs.userId, ctx.query.userId));
    if (ctx.query.from) conds.push(gte(auditLogs.createdAt, new Date(ctx.query.from)));
    if (ctx.query.to) conds.push(lte(auditLogs.createdAt, new Date(ctx.query.to)));
    const where = conds.length ? and(...conds) : undefined;

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  });
