/**
 * Settings (api-design.md §2.13) — M9, P0.
 *  - GET /settings   : semua key publik (kasir+; dipakai struk & aturan bisnis)
 *  - PATCH /settings : upsert (admin) + audit settings.update
 */
import { Elysia, t } from 'elysia';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { settings } from '../db/schema';
import { ok, clientIp } from '../lib/http';
import { fail } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { getSettings } from '../lib/settings';
import { mustAuth, mustAdmin, getUser, type RouteCtx } from '../middleware/auth';

const KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;

const readRoutes = new Elysia()
  .use(mustAuth)
  .get('/settings', async (ctx: RouteCtx) => {
    void getUser(ctx);
    return ok({ settings: await getSettings(true) });
  });

const adminRoutes = new Elysia()
  .use(mustAdmin)
  .patch(
    '/settings',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const entries = ctx.body.settings as { key: string; value: unknown }[];
      const updated: Record<string, unknown> = {};

      await db.transaction(async (tx) => {
        for (const entry of entries) {
          const key = String(entry.key).trim();
          if (!KEY_PATTERN.test(key)) fail('VALIDATION_ERROR', `Key settings tidak valid: '${key}'`, 422);
          const existing = await tx.select({ key: settings.key, value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
          if (existing[0]) {
            await tx
              .update(settings)
              .set({ value: entry.value as never, updatedBy: user.id, updatedAt: new Date() })
              .where(eq(settings.key, key));
          } else {
            await tx.insert(settings).values({ key, value: entry.value as never, updatedBy: user.id });
          }
          updated[key] = entry.value;
          await writeAudit(tx, {
            userId: user.id,
            action: 'settings.update',
            entityType: 'settings',
            entityId: null, // entity_id = UUID; key settings dicatat di newValues
            oldValues: existing[0] ? { key, value: existing[0].value } : null,
            newValues: { key, value: entry.value },
            ipAddress: clientIp(ctx.headers),
            userAgent: ctx.headers['user-agent'] ?? null,
          });
        }
      });

      return ok({ settings: await getSettings(true), updated });
    },
    {
      body: t.Object({
        settings: t.Array(
          t.Object({
            key: t.String({ minLength: 1, maxLength: 100 }),
            value: t.Unknown(),
          }),
          { minItems: 1 },
        ),
      }),
    },
  );

export const settingsRoutes = new Elysia().use(readRoutes).use(adminRoutes);
