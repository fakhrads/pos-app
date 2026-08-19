/**
 * Shifts (SPEC §4.1) — Fase 4, F4-6.
 *  - POST /shifts          : buka shift (kasir+) — 1 user ≤ 1 shift open
 *  - GET /shifts/current   : shift open + statistik live (banner kasir)
 *  - POST /shifts/:id/close: tutup shift (pemilik / manager+) — snapshot statistik
 *  - GET /shifts           : list (kasir: milik sendiri; manager+: semua + filter)
 *  - GET /shifts/:id       : detail + summary + transaksi/retur window atribusi
 *
 * Guard shift utk checkout/retur/hold ada di lib/shift.ts (enforceShift) —
 * dipanggil route transactions/returns/held-carts, BUKAN di service (§4.4).
 */
import { Elysia, t } from 'elysia';
import { isUuid } from '../lib/shift';
import { ok, clientIp, parsePagination } from '../lib/http';
import { fail } from '../lib/errors';
import { mustAuth, getUser, type RouteCtx } from '../middleware/auth';
import { openShift, closeShift, getCurrentShift, listShifts, getShiftDetail } from '../services/shift.service';

const shiftRoutes = new Elysia()
  .use(mustAuth)
  .post(
    '/shifts',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const shift = await openShift(
        { openingCash: ctx.body.openingCash, notes: ctx.body.notes },
        user,
        clientIp(ctx.headers),
        ctx.headers['user-agent'] ?? null,
      );
      ctx.set.status = 201;
      return ok({ shift });
    },
    {
      body: t.Object({
        openingCash: t.Integer({ minimum: 0, error: 'Modal kas awal harus bilangan bulat ≥ 0' }),
        notes: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  )
  .get('/shifts/current', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    return ok(await getCurrentShift(user));
  })
  .post(
    '/shifts/:id/close',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const result = await closeShift(
        ctx.params.id,
        { actualCash: ctx.body.actualCash, notes: ctx.body.notes },
        user,
        clientIp(ctx.headers),
        ctx.headers['user-agent'] ?? null,
      );
      return ok(result);
    },
    {
      body: t.Object({
        actualCash: t.Integer({ minimum: 0, error: 'Modal kas akhir harus bilangan bulat ≥ 0' }),
        notes: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  )
  .get('/shifts', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    if (ctx.query.userId && !isUuid(ctx.query.userId)) fail('VALIDATION_ERROR', 'userId harus UUID valid', 422);
    if (ctx.query.from && Number.isNaN(new Date(ctx.query.from).getTime())) fail('VALIDATION_ERROR', 'Format `from` tidak valid', 422);
    if (ctx.query.to && Number.isNaN(new Date(ctx.query.to).getTime())) fail('VALIDATION_ERROR', 'Format `to` tidak valid', 422);
    const status = ctx.query.status;
    if (status && status !== 'open' && status !== 'closed') fail('VALIDATION_ERROR', 'status harus open atau closed', 422);
    return ok(
      await listShifts(user, {
        userId: ctx.query.userId,
        from: ctx.query.from,
        to: ctx.query.to,
        status: status as 'open' | 'closed' | undefined,
        page,
        perPage,
      }),
    );
  })
  .get('/shifts/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    return ok(await getShiftDetail(ctx.params.id, user));
  });

export const shiftsRoutes = new Elysia().use(shiftRoutes);
