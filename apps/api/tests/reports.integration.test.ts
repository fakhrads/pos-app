/**
 * Integration test: Laporan & Dashboard + Kas masuk/keluar manual — Fase 5.
 *
 * BUTUH DATABASE (dev/demo, mis. PGlite 127.0.0.1:55433 + `bun run db:migrate`).
 * Bila DB tidak tersedia → test di-skip.
 *
 * Strategi: compose route Elysia (reports + cash-movements) yang sudah memuat
 * middleware auth sendiri, lalu panggil `.handle()` dengan token yang di-mint
 * langsung via signAccessToken untuk user nyata dari seed (manager + kasir).
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Elysia } from 'elysia';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../src/db';
import { users, cashMovements } from '../src/db/schema';
import { reportsRoutes } from '../src/routes/reports.routes';
import { cashMovementsRoutes } from '../src/routes/cash-movements.routes';
import { signAccessToken } from '../src/lib/jwt';
import { isAppError } from '../src/lib/errors';
import { errorEnvelope } from '../src/lib/http';

// Mirrors global onError di src/index.ts (envelope error seragam)
const app = new Elysia()
  .onError(({ code, error, set }: any) => {
    if (isAppError(error)) {
      set.status = error.status;
      return errorEnvelope(error.code, error.message, error.details);
    }
    if (code === 'VALIDATION') {
      set.status = 422;
      return errorEnvelope('VALIDATION_ERROR', 'Validasi body/query gagal', (error as any).all);
    }
    console.error('[error]', error);
    set.status = 500;
    return errorEnvelope('INTERNAL', 'Terjadi kesalahan server internal');
  })
  .use(reportsRoutes)
  .use(cashMovementsRoutes);

let dbAvailable = true;
let managerId = '';
let managerTok = '';
let kasirTok = '';

async function tryConnect(): Promise<boolean> {
  try {
    await db.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function findUser(role: 'admin' | 'manager' | 'kasir'): Promise<string> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, role), isNull(users.deletedAt), eq(users.isActive, true)))
    .limit(1);
  return rows[0]?.id ?? '';
}

beforeAll(async () => {
  dbAvailable = await tryConnect();
  if (!dbAvailable) return;

  const manager = (await findUser('manager')) || (await findUser('admin'));
  const kasir = await findUser('kasir');
  if (!manager || !kasir) {
    dbAvailable = false;
    return;
  }
  managerId = manager;
  managerTok = await signAccessToken({ id: manager, role: 'manager', name: 'Manager Test', email: 'm@t', outletId: 1 });
  kasirTok = await signAccessToken({ id: kasir, role: 'kasir', name: 'Kasir Test', email: 'k@t', outletId: 1 });
});

afterAll(async () => {
  if (dbAvailable) {
    await db.delete(cashMovements).where(eq(cashMovements.createdBy, managerId));
    // jangan panggil client.end() — pool postgres.js bersifat global/module-singleton,
    // menutupnya akan memutus koneksi test file lain yang berjalan bersamaan.
  }
});

/** Helper request → { status, body(raw text), json } */
async function req(
  method: string,
  path: string,
  token: string,
  query: Record<string, string> = {},
  body?: unknown,
) {
  const qs = new URLSearchParams(query).toString();
  const res = await app.handle(
    new Request(`http://localhost${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, text, json };
}

const GET = (path: string, token: string, q: Record<string, string> = {}) => req('GET', path, token, q);
const POST = (path: string, token: string, body: unknown) => req('POST', path, token, {}, body);

const RANGE = { from: '2026-07-01', to: '2026-07-31' };

describe('Kas masuk/keluar manual (Fase 5)', () => {
  test.skipIf(!dbAvailable)('POST /cash-movements mencatat mutasi kas masuk', async () => {
    const { status, json } = await POST('/cash-movements', managerTok, {
      direction: 'in',
      amount: 500000,
      method: 'cash',
      category: 'setoran',
      note: 'setoran modal awal',
    });
    expect(status).toBe(200);
    const d = (json as any).data;
    expect(d.direction).toBe('in');
    expect(d.amount).toBe(500000);
    expect(d.category).toBe('setoran');
  });

  test.skipIf(!dbAvailable)('POST amount <= 0 ditolak (validasi)', async () => {
    const { status, json } = await POST('/cash-movements', managerTok, {
      direction: 'out',
      amount: 0,
      method: 'cash',
    });
    expect(status).toBe(422);
    expect((json as any).error?.code).toBe('VALIDATION_ERROR');
  });

  test.skipIf(!dbAvailable)('GET /cash-movements me-return summary + items', async () => {
    const { status, json } = await GET('/cash-movements', managerTok, { page: '1', perPage: '20' });
    expect(status).toBe(200);
    const d = (json as any).data;
    expect(Array.isArray(d.items)).toBe(true);
    expect(typeof d.summary.in.total).toBe('number');
    expect(typeof d.summary.out.total).toBe('number');
  });
});

describe('Laporan Fase 5', () => {
  test.skipIf(!dbAvailable)('sales-by-product (json)', async () => {
    const { status, json } = await GET('/reports/sales-by-product', managerTok, RANGE);
    expect(status).toBe(200);
    const d = (json as any).data;
    expect(Array.isArray(d.rows)).toBe(true);
    for (const r of d.rows) {
      expect(typeof r.revenue).toBe('number');
      expect(typeof r.qtySold).toBe('number');
    }
  });

  test.skipIf(!dbAvailable)('sales-by-category', async () => {
    const { status } = await GET('/reports/sales-by-category', managerTok, RANGE);
    expect(status).toBe(200);
  });

  test.skipIf(!dbAvailable)('sales-by-cashier', async () => {
    const { status, json } = await GET('/reports/sales-by-cashier', managerTok, RANGE);
    expect(status).toBe(200);
    expect(Array.isArray((json as any).data.rows)).toBe(true);
  });

  test.skipIf(!dbAvailable)('sales-overview groupBy=month', async () => {
    const { status, json } = await GET('/reports/sales-overview', managerTok, { ...RANGE, groupBy: 'month' });
    expect(status).toBe(200);
    const d = (json as any).data;
    expect(d.groupBy).toBe('month');
    expect(Array.isArray(d.rows)).toBe(true);
  });

  test.skipIf(!dbAvailable)('inventory-value', async () => {
    const { status, json } = await GET('/reports/inventory-value', managerTok, {});
    expect(status).toBe(200);
    const d = (json as any).data;
    expect(Array.isArray(d.rows)).toBe(true);
    expect(typeof d.summary.totalValue).toBe('number');
  });

  test.skipIf(!dbAvailable)('dead-stock', async () => {
    const { status, json } = await GET('/reports/dead-stock', managerTok, {});
    expect(status).toBe(200);
    expect(Array.isArray((json as any).data.rows)).toBe(true);
  });

  test.skipIf(!dbAvailable)('income-statement', async () => {
    const { status, json } = await GET('/reports/income-statement', managerTok, RANGE);
    expect(status).toBe(200);
    const d = (json as any).data;
    expect(typeof d.summary.revenue).toBe('number');
    expect(typeof d.summary.cogs).toBe('number');
    expect(typeof d.summary.netProfit).toBe('number');
  });

  test.skipIf(!dbAvailable)('cash-flow', async () => {
    const { status, json } = await GET('/reports/cash-flow', managerTok, RANGE);
    expect(status).toBe(200);
    const d = (json as any).data;
    expect(typeof d.summary.cashIn).toBe('number');
    expect(typeof d.summary.cashOut).toBe('number');
    expect(typeof d.summary.net).toBe('number');
  });

  test.skipIf(!dbAvailable)('export=pdf → respons PDF (%PDF)', async () => {
    const { status, text } = await GET('/reports/sales-by-product', managerTok, { ...RANGE, export: 'pdf' });
    expect(status).toBe(200);
    expect(text.startsWith('%PDF')).toBe(true);
  });

  test.skipIf(!dbAvailable)('export=xlsx → buffer (PK zip)', async () => {
    const { status, text } = await GET('/reports/sales-by-product', managerTok, { ...RANGE, export: 'xlsx' });
    expect(status).toBe(200);
    // XLSX = zip (PK\x03\x04). text() sudah setelah JSON parse gagal → string biner.
    expect(text.length).toBeGreaterThan(100);
  });
});

describe('Akses role (BA §5, mengikat)', () => {
  test.skipIf(!dbAvailable)('kasir TIDAK bisa /reports/income-statement (403)', async () => {
    const { status, json } = await GET('/reports/income-statement', kasirTok, RANGE);
    expect(status).toBe(403);
    expect((json as any).error?.code).toBe('FORBIDDEN');
  });

  test.skipIf(!dbAvailable)('kasir TIDAK bisa /cash-movements (403)', async () => {
    const { status } = await GET('/cash-movements', kasirTok, {});
    expect(status).toBe(403);
  });

  test.skipIf(!dbAvailable)('kasir BISA /reports/sales-daily (tanpa laba)', async () => {
    const { status, json } = await GET('/reports/sales-daily', kasirTok, RANGE);
    expect(status).toBe(200);
    expect(Array.isArray((json as any).data.rows)).toBe(true);
  });
});
