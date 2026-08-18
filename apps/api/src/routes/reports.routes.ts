/**
 * Reports & Dashboard (api-design.md §2.11) — M7/M8, P0.
 * Role split (BA §5, mengikat):
 *  - KASIR+   : sales-daily, top-products, payment-methods (tanpa laba)
 *  - MANAGER+ : profit, low-stock, returns, dashboard
 * Rentang from/to wajib (max 366 hari); grouping timezone toko (Asia/Jakarta)
 * via AT TIME ZONE. `?export=csv` → CSV BOM (Excel/Google Sheets, REP-05).
 */
import { Elysia } from 'elysia';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { transactions, transactionItems, payments, products, returns } from '../db/schema';
import { ok, toCsv } from '../lib/http';
import { fail } from '../lib/errors';
import { getSettings, numSetting, strSetting } from '../lib/settings';
import { todayRangeWib } from '../lib/http';
import { mustAuth, mustManager, getUser, type RouteCtx } from '../middleware/auth';

/* ---------------- helpers ---------------- */

/** Normalisasi hasil db.execute (postgres-js mengembalikan array baris). */
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (res && typeof res === 'object' && Array.isArray((res as { rows?: unknown }).rows)) {
    return (res as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

const num = (v: unknown): number => Number(v ?? 0);

/** Validasi rentang from/to wajib + max 366 hari (api-design.md §4). */
function requireRange(q: Record<string, string | undefined>): { from: string; to: string } {
  if (!q.from || !q.to) fail('INVALID_PARAM', 'Query `from` dan `to` wajib (ISO 8601)', 400);
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) fail('INVALID_PARAM', 'Format from/to tidak valid', 400);
  if (to.getTime() - from.getTime() > 366 * 86_400_000) fail('INVALID_PARAM', 'Rentang maksimal 366 hari', 400);
  // ISO string, bukan Date — postgres.js tidak menserialisasi Date pada raw db.execute
  return { from: from.toISOString(), to: to.toISOString() };
}

function csvOrJson(ctx: RouteCtx, data: unknown, filename: string): unknown {
  if (ctx.query.export === 'csv') {
    const rows = (data as { rows?: Record<string, unknown>[] }).rows ?? (data as Record<string, unknown>[]);
    ctx.set.headers = {
      ...(ctx.set.headers ?? {}),
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}.csv"`,
    };
    return toCsv(rows as Record<string, unknown>[]);
  }
  return ok(data);
}

/* ---------------- KASIR+: laporan tanpa laba ---------------- */
const kasirRoutes = new Elysia()
  .use(mustAuth)
  /* REP-01: penjualan per hari */
  .get('/reports/sales-daily', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');

    const res = await db.execute(sql`
      SELECT to_char(date_trunc('day', ${transactions.soldAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS date,
             sum(${transactions.total})::bigint AS revenue,
             count(*)::int AS transaction_count,
             coalesce(sum(tiq.qty), 0)::int AS items_sold,
             round(avg(${transactions.total}))::bigint AS avg_per_transaction
      FROM ${transactions}
      LEFT JOIN (SELECT ti.transaction_id, sum(ti.quantity) AS qty
                 FROM ${transactionItems} ti GROUP BY ti.transaction_id) tiq
        ON tiq.transaction_id = ${transactions.id}
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
      GROUP BY 1 ORDER BY 1
    `);
    const rows = rowsOf(res).map((r) => ({
      date: r.date,
      revenue: num(r.revenue),
      transactionCount: num(r.transaction_count),
      itemsSold: num(r.items_sold),
      avgPerTransaction: num(r.avg_per_transaction),
    }));

    const payRes = await db.execute(sql`
      SELECT to_char(date_trunc('day', ${transactions.soldAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS date,
             ${payments.method} AS method, sum(${payments.amount})::bigint AS amount
      FROM ${payments}
      JOIN ${transactions} ON ${transactions.id} = ${payments.transactionId}
      WHERE ${transactions.status} = 'completed' AND ${payments.type} = 'sale'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
      GROUP BY 1, 2 ORDER BY 1, 2
    `);
    const byDate = new Map<string, Record<string, number>>();
    for (const p of rowsOf(payRes)) {
      const key = String(p.date);
      const m = byDate.get(key) ?? {};
      m[String(p.method)] = (m[String(p.method)] ?? 0) + num(p.amount);
      byDate.set(key, m);
    }
    const merged = rows.map((r) => ({
      ...r,
      paymentBreakdown: {
        cash: byDate.get(String(r.date))?.['cash'] ?? 0,
        qris: byDate.get(String(r.date))?.['qris'] ?? 0,
        transfer: byDate.get(String(r.date))?.['transfer'] ?? 0,
      },
    }));
    return csvOrJson(ctx, { rows: merged }, 'sales-daily');
  })

  /* REP-04: produk terlaris */
  .get('/reports/top-products', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const limit = Math.min(50, Number.parseInt(ctx.query.limit ?? '10', 10) || 10);
    const res = await db.execute(sql`
      SELECT ti.product_id AS product_id, max(ti.product_name) AS product_name,
             sum(ti.quantity)::int AS qty_sold,
             sum(ti.quantity * ti.unit_price - ti.discount_amount)::bigint AS revenue
      FROM ${transactionItems} ti
      JOIN ${transactions} ON ${transactions.id} = ti.transaction_id
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
      GROUP BY ti.product_id ORDER BY qty_sold DESC LIMIT ${limit}
    `);
    const rows = rowsOf(res).map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      qtySold: num(r.qty_sold),
      revenue: num(r.revenue),
    }));
    return csvOrJson(ctx, { rows }, 'top-products');
  })

  /* REP-01 breakdown: per metode bayar */
  .get('/reports/payment-methods', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const res = await db.execute(sql`
      SELECT ${payments.method} AS method, sum(${payments.amount})::bigint AS total, count(*)::int AS count
      FROM ${payments}
      JOIN ${transactions} ON ${transactions.id} = ${payments.transactionId}
      WHERE ${transactions.status} = 'completed' AND ${payments.type} = 'sale'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
      GROUP BY ${payments.method} ORDER BY total DESC
    `);
    const refundRes = await db.execute(sql`
      SELECT sum(${payments.amount})::bigint AS total
      FROM ${payments}
      WHERE ${payments.type} = 'refund' AND ${payments.status} = 'paid'
        AND ${payments.paidAt} >= ${from} AND ${payments.paidAt} < ${to}
    `);
    const rows = rowsOf(res).map((r) => ({ method: r.method, total: num(r.total), count: num(r.count) }));
    return csvOrJson(ctx, { rows, refundTotal: num(rowsOf(refundRes)[0]?.total) }, 'payment-methods');
  });

/* ---------------- MANAGER+: laba, stok, return, dashboard ---------------- */
const managerRoutes = new Elysia()
  .use(mustManager)
  /* REP-02: laba kotor (snapshot transaction_items) */
  .get('/reports/profit', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');
    const groupBy = ctx.query.groupBy === 'product' ? 'product' : 'day';

    const res =
      groupBy === 'day'
        ? await db.execute(sql`
            SELECT to_char(date_trunc('day', ${transactions.soldAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS date,
                   sum(ti.quantity * (ti.unit_price - ti.cost_price) - ti.discount_amount)::bigint AS gross_profit,
                   sum(ti.quantity * ti.unit_price - ti.discount_amount)::bigint AS revenue,
                   sum(ti.quantity * ti.cost_price)::bigint AS cogs,
                   sum(ti.quantity)::int AS items_sold
            FROM ${transactionItems} ti
            JOIN ${transactions} ON ${transactions.id} = ti.transaction_id
            WHERE ${transactions.status} = 'completed'
              AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
            GROUP BY 1 ORDER BY 1
          `)
        : await db.execute(sql`
            SELECT ti.product_id AS product_id, max(ti.product_name) AS product_name,
                   sum(ti.quantity * (ti.unit_price - ti.cost_price) - ti.discount_amount)::bigint AS gross_profit,
                   sum(ti.quantity * ti.unit_price - ti.discount_amount)::bigint AS revenue,
                   sum(ti.quantity)::int AS items_sold
            FROM ${transactionItems} ti
            JOIN ${transactions} ON ${transactions.id} = ti.transaction_id
            WHERE ${transactions.status} = 'completed'
              AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
            GROUP BY ti.product_id ORDER BY gross_profit DESC LIMIT 100
          `);

    const rows = rowsOf(res).map((r) => ({
      ...(groupBy === 'day' ? { date: r.date } : { productId: r.product_id, productName: r.product_name }),
      grossProfit: num(r.gross_profit),
      revenue: num(r.revenue),
      cogs: num(r.cogs),
      itemsSold: num(r.items_sold),
    }));
    return csvOrJson(ctx, { rows }, 'profit');
  })

  /* REP-03: stok menipis (termasuk stok 0) */
  .get('/reports/low-stock', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const s = await getSettings();
    const threshold = ctx.query.threshold !== undefined ? Number(ctx.query.threshold) : numSetting(s, 'low_stock.default_threshold', 5);
    const items = await db
      .select()
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.isActive, true), sql`${products.stockOnHand} <= ${threshold}`))
      .orderBy(asc(products.stockOnHand));
    const rows = items.map((p) => ({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      stockOnHand: Number(p.stockOnHand),
      minStock: Number(p.minStock),
      unit: p.unit,
      categoryId: p.categoryId,
    }));
    return csvOrJson(ctx, { rows }, 'low-stock');
  })

  /* REP-07: ringkasan return */
  .get('/reports/returns', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');
    const res = await db.execute(sql`
      SELECT to_char(date_trunc('day', ${returns.returnedAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS date,
             count(*)::int AS return_count,
             sum(${returns.totalRefund})::bigint AS total_refund,
             sum(${returns.pointsReversed})::bigint AS points_reversed
      FROM ${returns}
      WHERE ${returns.status} = 'completed'
        AND ${returns.returnedAt} >= ${from} AND ${returns.returnedAt} < ${to}
      GROUP BY 1 ORDER BY 1
    `);
    const rows = rowsOf(res).map((r) => ({
      date: r.date,
      returnCount: num(r.return_count),
      totalRefund: num(r.total_refund),
      pointsReversed: num(r.points_reversed),
    }));
    return csvOrJson(ctx, { rows }, 'returns');
  })

  /* DASH: dashboard */
  .get('/reports/dashboard', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const s = await getSettings();
    const tz = strSetting(s, 'report.timezone', 'Asia/Jakarta');
    const lowStockThreshold = numSetting(s, 'low_stock.default_threshold', 5);
    const { from: todayFrom, to: todayTo } = todayRangeWib(tz);
    // postgres.js raw-execute: param tanggal harus string ISO, bukan Date
    const todayFromIso = todayFrom.toISOString();
    const todayToIso = todayTo.toISOString();
    const last7From = new Date(todayFrom.getTime() - 6 * 86_400_000);
    const last7FromIso = last7From.toISOString();

    const todayRes = await db.execute(sql`
      SELECT count(*)::int AS transaction_count,
             sum(${transactions.total})::bigint AS revenue,
             coalesce(sum(tiq.qty), 0)::int AS items_sold
      FROM ${transactions}
      LEFT JOIN (SELECT ti.transaction_id, sum(ti.quantity) AS qty FROM ${transactionItems} ti GROUP BY ti.transaction_id) tiq
        ON tiq.transaction_id = ${transactions.id}
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${todayFromIso} AND ${transactions.soldAt} < ${todayToIso}
    `);
    const today = rowsOf(todayRes)[0] ?? {};
    const todayRevenue = num(today.revenue);
    const todayTransactions = num(today.transaction_count);
    const todayItemsSold = num(today.items_sold);

    const topToday = await db.execute(sql`
      SELECT ti.product_id AS product_id, max(ti.product_name) AS product_name,
             sum(ti.quantity)::int AS qty_sold,
             sum(ti.quantity * ti.unit_price - ti.discount_amount)::bigint AS revenue
      FROM ${transactionItems} ti
      JOIN ${transactions} ON ${transactions.id} = ti.transaction_id
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${todayFromIso} AND ${transactions.soldAt} < ${todayToIso}
      GROUP BY ti.product_id ORDER BY qty_sold DESC LIMIT 5
    `);

    const recent = await db
      .select({
        id: transactions.id,
        invoiceNumber: transactions.invoiceNumber,
        total: transactions.total,
        status: transactions.status,
        paymentStatus: transactions.paymentStatus,
        soldAt: transactions.soldAt,
      })
      .from(transactions)
      .orderBy(desc(transactions.soldAt))
      .limit(10);

    const lowStockRes = await db.execute(sql`
      SELECT count(*)::int AS count FROM ${products}
      WHERE ${products.deletedAt} IS NULL AND ${products.isActive}
        AND ${products.stockOnHand} <= ${lowStockThreshold}
    `);

    const last7 = await db.execute(sql`
      SELECT to_char(date_trunc('day', ${transactions.soldAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS date,
             sum(${transactions.total})::bigint AS revenue
      FROM ${transactions}
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${last7FromIso} AND ${transactions.soldAt} < ${todayToIso}
      GROUP BY 1 ORDER BY 1
    `);

    const payToday = await db.execute(sql`
      SELECT ${payments.method} AS method, sum(${payments.amount})::bigint AS total
      FROM ${payments}
      JOIN ${transactions} ON ${transactions.id} = ${payments.transactionId}
      WHERE ${transactions.status} = 'completed' AND ${payments.type} = 'sale'
        AND ${transactions.soldAt} >= ${todayFromIso} AND ${transactions.soldAt} < ${todayToIso}
      GROUP BY ${payments.method}
    `);

    return ok({
      todayRevenue,
      todayTransactions,
      todayItemsSold,
      avgPerTransaction: todayTransactions > 0 ? Math.round(todayRevenue / todayTransactions) : 0,
      topProductsToday: rowsOf(topToday).map((r) => ({
        productId: r.product_id,
        productName: r.product_name,
        qtySold: num(r.qty_sold),
        revenue: num(r.revenue),
      })),
      recentTransactions: recent,
      lowStockCount: num(rowsOf(lowStockRes)[0]?.count),
      salesLast7Days: rowsOf(last7).map((r) => ({ date: r.date, revenue: num(r.revenue) })),
      paymentMethodsToday: Object.fromEntries(rowsOf(payToday).map((r) => [r.method, num(r.total)])),
    });
  });

export const reportsRoutes = new Elysia().use(kasirRoutes).use(managerRoutes);
