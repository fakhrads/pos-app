/**
 * Held carts (SPEC §4.2) — Fase 4, F4-4.
 *  - POST /held-carts           : tahan keranjang (kasir+ & guard shift) → 201
 *  - GET /held-carts            : list aktif milik user (lazy filter expires_at)
 *  - GET /held-carts/:id        : detail (pemilik; user lain → 404)
 *  - POST /held-carts/:id/resume: lanjutkan hold → status 'resumed' (sekali)
 *  - DELETE /held-carts/:id     : buang hold → status 'discarded' (soft)
 *
 * Guard shift (SHIFT_REQUIRED) dievaluasi di route — konsisten §4.4 & AC-08.5.
 * Validasi bentuk items manual → HELD_CART_INVALID_ITEMS (§4.5).
 */
import { Elysia, t } from 'elysia';
import { ok, clientIp, parsePagination } from '../lib/http';
import { fail } from '../lib/errors';
import { enforceShift } from '../lib/shift';
import { mustAuth, getUser, type RouteCtx } from '../middleware/auth';
import { createHeldCart, listHeldCarts, getHeldCart, resumeHeldCart, discardHeldCart } from '../services/held-cart.service';

const heldCartRoutes = new Elysia()
  .use(mustAuth)
  .post(
    '/held-carts',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      // Guard shift — hold mengikuti tanggung jawab uang yang sama (AC-08.5)
      await enforceShift(undefined, user);
      const heldCart = await createHeldCart(
        { label: ctx.body.label, customerId: ctx.body.customerId, items: ctx.body.items },
        user,
        clientIp(ctx.headers),
        ctx.headers['user-agent'] ?? null,
      );
      ctx.set.status = 201;
      return ok({ heldCart });
    },
    {
      // items divalidasi MANUAL di service (HELD_CART_INVALID_ITEMS, bukan VALIDATION_ERROR)
      body: t.Object({
        label: t.Optional(t.String({ maxLength: 100 })),
        customerId: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
        items: t.Unknown(),
      }),
    },
  )
  .get('/held-carts', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    return ok(await listHeldCarts(user, page, perPage));
  })
  .get('/held-carts/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    return ok({ heldCart: await getHeldCart(ctx.params.id, user) });
  })
  .post('/held-carts/:id/resume', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const heldCart = await resumeHeldCart(ctx.params.id, user, clientIp(ctx.headers), ctx.headers['user-agent'] ?? null);
    return ok({ heldCart });
  })
  .delete('/held-carts/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const result = await discardHeldCart(ctx.params.id, user, clientIp(ctx.headers), ctx.headers['user-agent'] ?? null);
    return ok(result);
  });

export const heldCartsRoutes = new Elysia().use(heldCartRoutes);
