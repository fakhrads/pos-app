/**
 * Sync (SPEC §4.2 / Fase 7) — endpoint sinkronisasi transaksi offline.
 *
 *  - POST /sync               : terima ARRAY transaksi offline (dari IndexedDB
 *                               offline_orders), proses SATU PER SATU via
 *                               commitCheckout yang SUDAH idempoten (reuse
 *                               POST /transactions Fase 4 — Idempotency-Key =
 *                               clientTxId). Kembalikan hasil per transaksi.
 *  - GET /sync/pending-count  : berapa transaksi offline (source='offline')
 *                               sudah masuk DB server (belum di-tarik status
 *                               final oleh klien).
 *
 * Sifat: FASE 7 TIDAK menambah tabel DB — semua ketahanan offline di
 * IndexedDB klien; server hanya menerima kiriman idempoten (SPEC §3.1, §4.2).
 * Server selalu jadi source of truth harga & stok (SPEC §5.2).
 */
import { Elysia, t } from 'elysia';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { transactions } from '../db/schema';
import { ok, clientIp } from '../lib/http';
import { AppError, isAppError } from '../lib/errors';
import { rateLimit } from '../lib/rate-limit';
import { commitCheckout, type CheckoutInput } from '../services/checkout.service';
import { mustAuth, getUser, type RouteCtx } from '../middleware/auth';

/* ---------------- schema item checkout (reuse kontrak POST /transactions) ---- */
const itemDiscountSchema = t.Object({
  type: t.Enum({ percentage: 'percentage', fixed: 'fixed' }),
  value: t.Number({ exclusiveMinimum: 0 }),
  reason: t.Optional(t.String()),
});
const orderItemSchema = t.Object({
  productId: t.String({ format: 'uuid' }),
  variantId: t.Optional(t.Union([t.String({ format: 'uuid' }), t.Null()])),
  unit: t.Optional(t.String({ maxLength: 20 })),
  quantity: t.Number({ exclusiveMinimum: 0 }),
  discount: t.Optional(itemDiscountSchema),
});
const paymentSchema = t.Object({
  method: t.Enum({ cash: 'cash', qris: 'qris', transfer: 'transfer' }),
  amount: t.Number({ exclusiveMinimum: 0 }),
  cashReceived: t.Optional(t.Number({ minimum: 0 })),
  referenceNumber: t.Optional(t.String({ maxLength: 100 })),
});

/** Satu entri antrean offline: clientTxId = Idempotency-Key = PK IndexedDB. */
const syncItemSchema = t.Object({
  clientTxId: t.String({ minLength: 8, maxLength: 64 }),
  customerId: t.Optional(t.String({ format: 'uuid' })),
  items: t.Array(orderItemSchema, { minItems: 1 }),
  manualDiscount: t.Optional(itemDiscountSchema),
  discountCode: t.Optional(t.String({ maxLength: 50 })),
  redeemPoints: t.Optional(t.Integer({ exclusiveMinimum: 0 })),
  payments: t.Array(paymentSchema),
  notes: t.Optional(t.String()),
});

const syncApiRoutes = new Elysia()
  .use(mustAuth)
  .post(
    '/sync',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      if (!rateLimit(`sync:user:${user.id}`, 120, 60_000)) {
        failRate('Terlalu banyak permintaan sinkronisasi per menit');
      }

      const orders = ctx.body.orders as Array<typeof syncItemSchema & { clientTxId: string }>;
      // Batas keamanan ukuran batch (SPEC §7.3.5: antrean panjang diproses
      // berurutan di klien; jangan biarkan satu request membebani server).
      if (orders.length > 200) failRate('Batch sinkronisasi maksimal 200 transaksi');

      const ip = clientIp(ctx.headers);
      const ua = ctx.headers['user-agent'] ?? null;

      const results: Array<{
        clientTxId: string;
        status: 'success' | 'duplicate' | 'conflict' | 'error';
        transactionId?: string | null;
        invoiceNumber?: string | null;
        message?: string;
      }> = [];

      // FIFO (SPEC §5.3): proses berurutan; satu conflict TIDAK memblokir sisa
      // antrean (rule 3) — setiap item ditangani independen yang transaksional.
      for (const order of orders) {
        const input: CheckoutInput = {
          customerId: order.customerId,
          items: order.items,
          manualDiscount: order.manualDiscount,
          discountCode: order.discountCode,
          redeemPoints: order.redeemPoints,
          payments: order.payments,
          notes: order.notes,
        };

        try {
          const result = await commitCheckout(input, user, order.clientTxId, ip, ua, 'offline');
          if (result.replay) {
            results.push({
              clientTxId: order.clientTxId,
              status: 'duplicate',
              transactionId: result.transaction?.id ?? null,
              invoiceNumber: result.transaction?.invoiceNumber ?? null,
            });
          } else {
            results.push({
              clientTxId: order.clientTxId,
              status: 'success',
              transactionId: result.transaction?.id ?? null,
              invoiceNumber: result.transaction?.invoiceNumber ?? null,
            });
          }
        } catch (e) {
          if (isAppError(e)) {
            // Konflik bisnis: stok habis / shift / validasi → 'conflict'
            results.push({
              clientTxId: order.clientTxId,
              status: 'conflict',
              message: e.message,
            });
          } else {
            // Kegagalan tak dikenal (DB/serialisasi) → 'error'; tidak memblokir
            // item lain. Klien bisa retry (aman — Idempotency-Key).
            console.error('[sync] error transaksi offline', order.clientTxId, e);
            results.push({
              clientTxId: order.clientTxId,
              status: 'error',
              message: 'Gagal memproses transaksi, coba lagi',
            });
          }
        }
      }

      return ok({ results });
    },
    {
      body: t.Object({
        orders: t.Array(syncItemSchema, { maxItems: 200 }),
      }),
    },
  )
  .get('/sync/pending-count', async (ctx: RouteCtx) => {
    getUser(ctx);
    // Transaksi offline yang sudah diterima server & belum dibatalkan.
    // Klien memakai angka ini untuk recovery status antrean (SPEC §4.3).
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.source, 'offline'), ne(transactions.status, 'cancelled')));
    return ok({ count: Number(row?.total ?? 0), source: 'offline' });
  });

function failRate(message: string): never {
  throw new AppError('RATE_LIMITED', message, 429);
}

export const syncRoutes = new Elysia().use(syncApiRoutes);
