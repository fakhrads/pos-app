/**
 * Categories (api-design.md §2.3) — baca: kasir+; tulis: manager+; delete: admin.
 * 1 level (BA PROD-02). Soft delete; produk di kategori tetap utuh.
 */
import { Elysia, t } from 'elysia';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { categories } from '../db/schema';
import { ok, clientIp, slugify } from '../lib/http';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { mustAuth, mustManager, mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

/** Baca: semua role login */
const readRoutes = new Elysia()
  .use(mustAuth)
  .get('/categories', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const items = await db
      .select()
      .from(categories)
      .where(and(isNull(categories.deletedAt), eq(categories.isActive, true)))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return ok({ items });
  });

/** Tulis: manager+ */
const writeRoutes = new Elysia()
  .use(mustManager)
  .post(
    '/categories',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const slug = ctx.body.slug?.trim() ? String(ctx.body.slug).trim() : slugify(String(ctx.body.name));
      const dup = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.slug, slug), isNull(categories.deletedAt))).limit(1);
      if (dup[0]) fail('DUPLICATE_SLUG', 'Slug kategori sudah dipakai', 409);

      const [cat] = await db
        .insert(categories)
        .values({
          name: String(ctx.body.name),
          slug,
          sortOrder: ctx.body.sortOrder ?? 0,
          description: ctx.body.description ?? null,
        })
        .returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'category.create',
        entityType: 'category',
        entityId: cat.id,
        newValues: { name: cat.name, slug: cat.slug },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({ category: cat });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        slug: t.Optional(t.String({ maxLength: 120 })),
        sortOrder: t.Optional(t.Integer()),
        description: t.Optional(t.String()),
      }),
    },
  )
  .patch(
    '/categories/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const rows = await db.select().from(categories).where(and(eq(categories.id, ctx.params.id), isNull(categories.deletedAt))).limit(1);
      const cat = rows[0];
      if (!cat) fail('NOT_FOUND', 'Kategori tidak ditemukan', 404);

      const patch: Record<string, unknown> = {};
      if (ctx.body.name !== undefined) patch.name = String(ctx.body.name);
      if (ctx.body.description !== undefined) patch.description = ctx.body.description ?? null;
      if (ctx.body.sortOrder !== undefined) patch.sortOrder = ctx.body.sortOrder;
      if (ctx.body.isActive !== undefined) patch.isActive = Boolean(ctx.body.isActive);
      if (ctx.body.slug !== undefined) {
        const slug = String(ctx.body.slug).trim();
        const dup = await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.slug, slug), isNull(categories.deletedAt), sql`${categories.id} <> ${cat.id}`))
          .limit(1);
        if (dup[0]) fail('DUPLICATE_SLUG', 'Slug kategori sudah dipakai', 409);
        patch.slug = slug;
      }

      const [updated] = await db.update(categories).set(patch).where(eq(categories.id, cat.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'category.update',
        entityType: 'category',
        entityId: cat.id,
        oldValues: { name: cat.name, slug: cat.slug, sortOrder: cat.sortOrder, isActive: cat.isActive },
        newValues: { name: updated.name, slug: updated.slug, sortOrder: updated.sortOrder, isActive: updated.isActive },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ category: updated });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        slug: t.Optional(t.String({ maxLength: 120 })),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        sortOrder: t.Optional(t.Integer()),
        isActive: t.Optional(t.Boolean()),
      }),
    },
  );

/** Delete: admin */
const deleteRoutes = new Elysia()
  .use(mustAdmin)
  .delete('/categories/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const rows = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, ctx.params.id), isNull(categories.deletedAt))).limit(1);
    if (!rows[0]) fail('NOT_FOUND', 'Kategori tidak ditemukan', 404);

    await db.update(categories).set({ deletedAt: new Date(), isActive: false }).where(eq(categories.id, ctx.params.id));
    await writeAudit(db, {
      userId: user.id,
      action: 'category.delete',
      entityType: 'category',
      entityId: ctx.params.id,
      newValues: { deletedAt: new Date().toISOString() },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: ctx.params.id, deleted: true });
  });

export const categoriesRoutes = new Elysia().use(readRoutes).use(writeRoutes).use(deleteRoutes);
