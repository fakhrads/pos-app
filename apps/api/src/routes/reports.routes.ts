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
import { transactions, transactionItems, payments, products, returns, warehouses, warehouseStocks, productVariants } from '../db/schema';
import { ok, toCsv, parsePagination, paginationMeta } from '../lib/http';
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

/** Ringkasan stok per gudang AKTIF untuk produk-produk terpilih (AC-06.1). */
async function activeWarehouseBreakdown(
  productIds: string[],
): Promise<Map<string, { warehouseId: string; warehouseName: string; quantity: number }[]>> {
  const map = new Map<string, { warehouseId: string; warehouseName: string; quantity: number }[]>();
  if (productIds.length === 0) return map;
  const res = await db.execute(sql`
    SELECT ws.product_id, w.id AS warehouse_id, w.name AS warehouse_name,
           sum(ws.quantity) AS qty
    FROM ${warehouseStocks} ws
    JOIN ${warehouses} w ON w.id = ws.warehouse_id
    WHERE w.deleted_at IS NULL AND w.is_active
      AND ws.product_id IN ${productIds}
    GROUP BY ws.product_id, w.id, w.name
    ORDER BY w.name
  `);
  for (const r of rowsOf(res)) {
    const key = String(r.product_id);
    const arr = map.get(key) ?? [];
    arr.push({ warehouseId: String(r.warehouse_id), warehouseName: String(r.warehouse_name), quantity: num(r.qty) });
    map.set(key, arr);
  }
  return map;
}

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

  /* REP-03: stok menipis — Fase 3 (SPEC §4.6, AC-06.1–06.5)
   * Tanpa warehouseId : per produk (Σ stok gudang AKTIF ≤ products.min_stock);
   *                     varian = baris sendiri (product_variants.min_stock).
   * Dengan warehouseId: per baris warehouse_stocks (min_stock per gudang),
   *                     qty 0 ikut; min_stock=0 = threshold nonaktif kecuali qty 0.
   */
  .get('/reports/low-stock', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const warehouseId = ctx.query.warehouseId;
    const thresholdOverride = ctx.query.threshold !== undefined ? Number(ctx.query.threshold) : null;

    let rows: Record<string, unknown>[] = [];
    let total = 0;

    if (warehouseId) {
      // ---------- per gudang: warehouse_stocks.min_stock ----------
      const [wh] = await db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.id, warehouseId), isNull(warehouses.deletedAt)))
        .limit(1);
      if (!wh) fail('WAREHOUSE_NOT_FOUND', 'Gudang tidak ditemukan', 404);

      const base = await db
        .select({
          productId: warehouseStocks.productId,
          variantId: warehouseStocks.productVariantId,
          name: products.name,
          sku: products.sku,
          barcode: products.barcode,
          unit: products.unit,
          variantName: productVariants.name,
          productMinStock: products.minStock,
          minStock: warehouseStocks.minStock,
          quantity: warehouseStocks.quantity,
        })
        .from(warehouseStocks)
        .innerJoin(products, eq(products.id, warehouseStocks.productId))
        .leftJoin(productVariants, eq(productVariants.id, warehouseStocks.productVariantId))
        .where(
          and(
            eq(warehouseStocks.warehouseId, warehouseId),
            isNull(products.deletedAt),
            eq(products.isActive, true),
            eq(products.trackStock, true), // AC-06.3: jasa tidak muncul
            sql`NOT (${products.hasVariants} AND ${warehouseStocks.productVariantId} IS NULL)`,
            thresholdOverride !== null
              ? sql`${warehouseStocks.quantity} <= ${thresholdOverride}`
              : sql`(${warehouseStocks.quantity} = 0 OR (${warehouseStocks.minStock} > 0 AND ${warehouseStocks.quantity} <= ${warehouseStocks.minStock}))`,
          ),
        )
        .orderBy(asc(warehouseStocks.quantity));

      const productIds = [...new Set(base.map((r) => r.productId))];
      const breakdown = await activeWarehouseBreakdown(productIds);
      rows = base.map((r) => ({
        productId: r.productId,
        name: r.name,
        sku: r.sku,
        barcode: r.barcode,
        unit: r.unit,
        variantId: r.variantId,
        variantName: r.variantName,
        totalStock: num(r.quantity),
        minStock: thresholdOverride !== null ? thresholdOverride : num(r.minStock),
        productMinStock: num(r.productMinStock),
        warehouseBreakdown: breakdown.get(r.productId) ?? [],
      }));
    } else {
      // ---------- agregat per produk/varian (Σ gudang aktif) ----------
      const activeWhSub = sql`(SELECT id FROM ${warehouses} WHERE deleted_at IS NULL AND is_active)`;

      const prodRes = await db.execute(sql`
        SELECT p.id AS product_id, p.name, p.sku, p.barcode, p.unit,
               NULL::uuid AS variant_id, NULL::text AS variant_name,
               p.min_stock AS product_min_stock,
               coalesce(sum(ws.quantity), 0) AS total_stock
        FROM ${products} p
        LEFT JOIN ${warehouseStocks} ws
          ON ws.product_id = p.id AND ws.product_variant_id IS NULL
         AND ws.warehouse_id IN ${activeWhSub}
        WHERE p.deleted_at IS NULL AND p.is_active AND p.track_stock
          AND NOT p.has_variants
        GROUP BY p.id
        HAVING count(ws.id) > 0
           AND coalesce(sum(ws.quantity), 0) <= ${thresholdOverride !== null ? thresholdOverride : sql`p.min_stock`}
        ORDER BY total_stock ASC
      `);
      const varRes = await db.execute(sql`
        SELECT p.id AS product_id, p.name, p.sku, p.barcode, p.unit,
               pv.id AS variant_id, pv.name AS variant_name,
               pv.min_stock AS product_min_stock,
               coalesce(sum(ws.quantity), 0) AS total_stock
        FROM ${productVariants} pv
        JOIN ${products} p ON p.id = pv.product_id
        LEFT JOIN ${warehouseStocks} ws
          ON ws.product_variant_id = pv.id
         AND ws.warehouse_id IN ${activeWhSub}
        WHERE p.deleted_at IS NULL AND p.is_active AND p.track_stock
          AND pv.deleted_at IS NULL AND pv.is_active
        GROUP BY p.id, pv.id
        HAVING count(ws.id) > 0
           AND coalesce(sum(ws.quantity), 0) <= ${thresholdOverride !== null ? thresholdOverride : sql`pv.min_stock`}
        ORDER BY total_stock ASC
      `);

      const merged = [...rowsOf(prodRes), ...rowsOf(varRes)];
      const allProductIds = [...new Set(merged.map((r) => String(r.product_id)))];
      const breakdown = await activeWarehouseBreakdown(allProductIds);
      rows = merged.map((r) => ({
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        barcode: r.barcode,
        unit: r.unit,
        variantId: r.variant_id ?? null,
        variantName: r.variant_name ?? null,
        totalStock: num(r.total_stock),
        minStock: thresholdOverride !== null ? thresholdOverride : num(r.product_min_stock),
        productMinStock: num(r.product_min_stock),
        warehouseBreakdown: breakdown.get(String(r.product_id)) ?? [],
      }));
    }

    total = rows.length;
    const paged = rows.slice((page - 1) * perPage, page * perPage);
    if (ctx.query.export === 'csv') {
      const csvRows = paged.map((r) => ({
        ...r,
        warehouseBreakdown: (r.warehouseBreakdown as { warehouseName: string; quantity: number }[])
          .map((b) => `${b.warehouseName}:${b.quantity}`)
          .join('; '),
      }));
      ctx.set.headers = {
        ...(ctx.set.headers ?? {}),
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="low-stock.csv"',
      };
      return toCsv(csvRows);
    }
    return ok({ rows: paged, meta: paginationMeta(page, perPage, total) });
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
      WHERE ${products.deletedAt} IS NULL AND ${products.isActive} AND ${products.trackStock}
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
