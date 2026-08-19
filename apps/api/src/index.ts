/**
 * FakhriPOS API — entry point (Bun + Elysia).
 * Semua endpoint di bawah /api/v1, envelope { ok, data, error } (api-design.md §1.2).
 * Konfigurasi via .env (Bun auto-load): DATABASE_URL, JWT_SECRET, PORT.
 */
import { Elysia } from 'elysia';
import { env, assertEnv, isProd } from './env';
import { isAppError } from './lib/errors';
import { errorEnvelope } from './lib/http';
import { authRoutes } from './routes/auth.routes';
import { usersRoutes } from './routes/users.routes';
import { categoriesRoutes } from './routes/categories.routes';
import { productsRoutes } from './routes/products.routes';
import { productVariantsRoutes } from './routes/product-variants.routes';
import { productUnitsRoutes } from './routes/product-units.routes';
import { customersRoutes } from './routes/customers.routes';
import { membershipsRoutes } from './routes/memberships.routes';
import { discountsRoutes } from './routes/discounts.routes';
import { taxRatesRoutes } from './routes/tax-rates.routes';
import { transactionsRoutes } from './routes/transactions.routes';
import { returnsRoutes } from './routes/returns.routes';
import { shiftsRoutes } from './routes/shifts.routes';
import { heldCartsRoutes } from './routes/held-carts.routes';
import { reportsRoutes } from './routes/reports.routes';
import { auditLogsRoutes } from './routes/audit-logs.routes';
import { settingsRoutes } from './routes/settings.routes';
import { warehousesRoutes } from './routes/warehouses.routes';
import { stockTransfersRoutes } from './routes/stock-transfers.routes';
import { stockAdjustmentsRoutes } from './routes/stock-adjustments.routes';

assertEnv();

/* ------------------------------------------------------------------ */
/* Global error handler → envelope seragam                             */
/* ------------------------------------------------------------------ */
function onError({ code, error, set }: any) {
  // Error bisnis (AppError)
  if (isAppError(error)) {
    set.status = error.status;
    return errorEnvelope(error.code, error.message, error.details);
  }

  // Validasi schema Elysia/TypeBox → 422 VALIDATION_ERROR + details per field
  if (code === 'VALIDATION') {
    set.status = 422;
    const issues = (error as { all?: { path?: string; message?: string }[] }).all ?? [];
    const details = issues.map((i) => ({
      field: i.path ?? 'body',
      message: i.message ?? 'nilai tidak valid',
    }));
    return errorEnvelope('VALIDATION_ERROR', 'Validasi body/query gagal', details);
  }

  if (code === 'PARSE') {
    set.status = 400;
    return errorEnvelope('INVALID_JSON', 'Body request bukan JSON valid');
  }

  if (code === 'NOT_FOUND') {
    set.status = 404;
    return errorEnvelope('NOT_FOUND', 'Endpoint tidak ditemukan');
  }

  // Error tak dikenal → 500 INTERNAL (jangan bocorkan stack trace)
  console.error('[error]', error);
  set.status = 500;
  return errorEnvelope('INTERNAL', 'Terjadi kesalahan server internal');
}

/* ------------------------------------------------------------------ */
/* CORS manual (Dokploy/Traefik reverse proxy; origin frontend Next.js) */
/* ------------------------------------------------------------------ */
function corsHandler({ request, set }: any) {
  const origin = request.headers.get('origin') ?? '';
  const allowOrigin = env.CORS_ORIGIN === '*' ? origin || '*' : env.CORS_ORIGIN;
  set.headers = {
    ...(set.headers ?? {}),
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
  if (request.method === 'OPTIONS') {
    set.status = 204;
    return new Response(null, { status: 204 });
  }
}

/* ------------------------------------------------------------------ */
/* Aplikasi                                                            */
/* ------------------------------------------------------------------ */
const app = new Elysia()
  .onRequest(corsHandler)
  .onError(onError)
  .get('/health', () => ({
    ok: true,
    data: { service: 'fakhripos-api', status: 'ok', time: new Date().toISOString() },
  }))
  .group('/api/v1', (group) =>
    group
      .use(authRoutes)
      .use(usersRoutes)
      .use(categoriesRoutes)
      .use(productsRoutes)
      .use(productVariantsRoutes)
      .use(productUnitsRoutes)
      .use(customersRoutes)
      .use(membershipsRoutes)
      .use(discountsRoutes)
      .use(taxRatesRoutes)
      .use(transactionsRoutes)
      .use(returnsRoutes)
      .use(shiftsRoutes)
      .use(heldCartsRoutes)
      .use(reportsRoutes)
      .use(auditLogsRoutes)
      .use(settingsRoutes)
      .use(warehousesRoutes)
      .use(stockTransfersRoutes)
      .use(stockAdjustmentsRoutes),
  );

// Swagger UI — dev only (dependency @elysiajs/swagger di devDependencies)
if (!isProd) {
  try {
    const { swagger } = await import('@elysiajs/swagger');
    app.use(swagger({ path: '/api/v1/docs', documentation: { info: { title: 'FakhriPOS API', version: '0.1.0' } } }));
    console.log('[swagger] docs tersedia di /api/v1/docs');
  } catch {
    console.warn('[swagger] @elysiajs/swagger tidak terpasang — lewati (dev only)');
  }
}

app.listen({ port: env.PORT, hostname: '0.0.0.0' });

console.log(`[fakhripos] API berjalan: http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
console.log(`[fakhripos] health check: http://0.0.0.0:${env.PORT}/health`);
console.log(`[fakhripos] api prefix: /api/v1`);

export type App = typeof app;
export { app };
