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
import { transactions, transactionItems, payments, products, categories, returns, warehouses, warehouseStocks, productVariants, cashMovements, users } from '../db/schema';
import { ok, toCsv, parsePagination, paginationMeta } from '../lib/http';
import { fail } from '../lib/errors';
import { getSettings, numSetting, strSetting } from '../lib/settings';
import { todayRangeWib } from '../lib/http';
import { mustAuth, mustManager, getUser, type RouteCtx } from '../middleware/auth';
import { buildWorkbook, buildPdfTable, type PdfTableCol } from '../lib/report-export';

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

/** Helper export XLSX (1 sheet) — Fase 5 (SPEC §5, REP-05). */
type SpreadsheetRow = Record<string, unknown>;
interface ExportColumn {
  label: string; // header Indonesia
  key: string; // field di row
  align?: 'left' | 'right';
}
function exportXlsx(
  ctx: RouteCtx,
  sheetName: string,
  columns: ExportColumn[],
  rows: SpreadsheetRow[],
  filename: string,
): Uint8Array<ArrayBufferLike> {
  const header = columns.map((c) => c.label);
  const data = [[...header], ...rows.map((r) => columns.map((c) => r[c.key] ?? ''))];
  ctx.set.headers = {
    ...(ctx.set.headers ?? {}),
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${filename}.xlsx"`,
  };
  return buildWorkbook([{ name: sheetName, rows: data }]);
}

/** Helper export PDF (1 tabel) — Fase 5 (SPEC §5, REP-05). */
async function exportPdf(
  ctx: RouteCtx,
  title: string,
  subtitle: string,
  columns: ExportColumn[],
  rows: SpreadsheetRow[],
  filename: string,
): Promise<Uint8Array<ArrayBufferLike>> {
  const pdfCols: PdfTableCol[] = columns.map((c) => ({ label: c.label, align: c.align }));
  const dataRows = rows.map((r) => columns.map((c) => r[c.key] ?? ''));
  const bytes = await buildPdfTable({
    title,
    subtitle,
    columns: pdfCols,
    rows: dataRows,
  });
  ctx.set.headers = {
    ...(ctx.set.headers ?? {}),
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${filename}.pdf"`,
  };
  return bytes;
}

/** Tentukan format export: json (default) | csv | xlsx | pdf. */
function exportFormat(ctx: RouteCtx): 'csv' | 'xlsx' | 'pdf' | null {
  const f = ctx.query.export;
  if (f === 'csv' || f === 'xlsx' || f === 'pdf') return f;
  return null;
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
  })

  /* ================= FASE 5 — Laporan & Dashboard (SPEC §4) ================= */

  /* REP-01b: penjualan per periode — groupBy=day|week|month */
  .get('/reports/sales-overview', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');
    const groupBy = ['day', 'week', 'month'].includes(ctx.query.groupBy ?? '') ? ctx.query.groupBy : 'day';
    const trunc = groupBy === 'week' ? 'week' : groupBy === 'month' ? 'month' : 'day';

    const res = await db.execute(sql`
      SELECT to_char(date_trunc('${sql.raw(trunc)}', ${transactions.soldAt} AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS period,
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
      period: r.period,
      revenue: num(r.revenue),
      transactionCount: num(r.transaction_count),
      itemsSold: num(r.items_sold),
      avgPerTransaction: num(r.avg_per_transaction),
    }));
    return ok({ groupBy, rows });
  })

  /* REP-01c: penjualan per produk (wajib rentang) — jumlah & revenue */
  .get('/reports/sales-by-product', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const limit = Math.min(200, Number.parseInt(ctx.query.limit ?? '100', 10) || 100);
    const categoryId = ctx.query.categoryId;
    const res = await db.execute(sql`
      SELECT ti.product_id AS product_id, max(ti.product_name) AS product_name,
             max(ti.product_sku) AS product_sku,
             coalesce(sum(p.cost_price * ti.quantity), 0)::bigint AS cogs,
             sum(ti.quantity)::int AS qty_sold,
             sum(ti.quantity * ti.unit_price - ti.discount_amount)::bigint AS revenue
      FROM ${transactionItems} ti
      JOIN ${transactions} ON ${transactions.id} = ti.transaction_id
      LEFT JOIN ${products} p ON p.id = ti.product_id
      ${categoryId ? sql`LEFT JOIN ${categories} c ON c.id = p.category_id` : sql``}
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
        ${categoryId ? sql`AND p.category_id = ${categoryId}` : sql``}
      GROUP BY ti.product_id ORDER BY qty_sold DESC LIMIT ${limit}
    `);
    const rows = rowsOf(res).map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      productSku: r.product_sku,
      qtySold: num(r.qty_sold),
      revenue: num(r.revenue),
      cogs: num(r.cogs),
    }));
    const fmt = exportFormat(ctx);
    if (fmt === 'xlsx')
      return exportXlsx(ctx, 'Penjualan Produk', [
        { label: 'Produk', key: 'productName' },
        { label: 'SKU', key: 'productSku', align: 'left' },
        { label: 'Qty Terjual', key: 'qtySold', align: 'right' },
        { label: 'Revenue (Rp)', key: 'revenue', align: 'right' },
        { label: 'HPP (Rp)', key: 'cogs', align: 'right' },
      ], rows, 'penjualan-produk');
    if (fmt === 'pdf')
      return exportPdf(ctx, 'Laporan Penjualan per Produk', `${from} s/d ${to}`, [
        { label: 'Produk', key: 'productName' },
        { label: 'Qty', key: 'qtySold', align: 'right' },
        { label: 'Revenue (Rp)', key: 'revenue', align: 'right' },
        { label: 'HPP (Rp)', key: 'cogs', align: 'right' },
      ], rows, 'penjualan-produk');
    if (fmt === 'csv') return csvOrJson(ctx, { rows }, 'penjualan-produk');
    return ok({ rows });
  })

  /* REP-01d: penjualan per kategori */
  .get('/reports/sales-by-category', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const res = await db.execute(sql`
      SELECT p.category_id AS category_id, max(c.name) AS category_name,
             sum(ti.quantity)::int AS qty_sold,
             sum(ti.quantity * ti.unit_price - ti.discount_amount)::bigint AS revenue
      FROM ${transactionItems} ti
      JOIN ${transactions} ON ${transactions.id} = ti.transaction_id
      LEFT JOIN ${products} p ON p.id = ti.product_id
      LEFT JOIN ${categories} c ON c.id = p.category_id
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
      GROUP BY p.category_id HAVING p.category_id IS NOT NULL ORDER BY revenue DESC
    `);
    const rows = rowsOf(res).map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      qtySold: num(r.qty_sold),
      revenue: num(r.revenue),
    }));
    const fmt = exportFormat(ctx);
    if (fmt === 'xlsx') return exportXlsx(ctx, 'Kategori', [
      { label: 'Kategori', key: 'categoryName' },
      { label: 'Qty Terjual', key: 'qtySold', align: 'right' },
      { label: 'Revenue (Rp)', key: 'revenue', align: 'right' },
    ], rows, 'penjualan-kategori');
    if (fmt === 'pdf') return exportPdf(ctx, 'Laporan Penjualan per Kategori', `${from} s/d ${to}`, [
      { label: 'Kategori', key: 'categoryName' },
      { label: 'Qty', key: 'qtySold', align: 'right' },
      { label: 'Revenue (Rp)', key: 'revenue', align: 'right' },
    ], rows, 'penjualan-kategori');
    if (fmt === 'csv') return csvOrJson(ctx, { rows }, 'penjualan-kategori');
    return ok({ rows });
  })

  /* REP-01e: penjualan per kasir */
  .get('/reports/sales-by-cashier', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const res = await db.execute(sql`
      SELECT ${transactions.userId} AS cashier_id, max(u.name) AS cashier_name,
             count(*)::int AS transaction_count,
             sum(${transactions.total})::bigint AS revenue,
             coalesce(sum(tiq.qty), 0)::int AS items_sold
      FROM ${transactions}
      LEFT JOIN ${users} u ON u.id = ${transactions.userId}
      LEFT JOIN (SELECT ti.transaction_id, sum(ti.quantity) AS qty FROM ${transactionItems} ti GROUP BY ti.transaction_id) tiq
        ON tiq.transaction_id = ${transactions.id}
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
      GROUP BY ${transactions.userId} ORDER BY revenue DESC
    `);
    const rows = rowsOf(res).map((r) => ({
      cashierId: r.cashier_id,
      cashierName: r.cashier_name,
      transactionCount: num(r.transaction_count),
      revenue: num(r.revenue),
      itemsSold: num(r.items_sold),
    }));
    const fmt = exportFormat(ctx);
    if (fmt === 'xlsx') return exportXlsx(ctx, 'Kasir', [
      { label: 'Kasir', key: 'cashierName' },
      { label: 'Transaksi', key: 'transactionCount', align: 'right' },
      { label: 'Revenue (Rp)', key: 'revenue', align: 'right' },
      { label: 'Item Terjual', key: 'itemsSold', align: 'right' },
    ], rows, 'penjualan-kasir');
    if (fmt === 'pdf') return exportPdf(ctx, 'Laporan Penjualan per Kasir', `${from} s/d ${to}`, [
      { label: 'Kasir', key: 'cashierName' },
      { label: 'Transaksi', key: 'transactionCount', align: 'right' },
      { label: 'Revenue (Rp)', key: 'revenue', align: 'right' },
    ], rows, 'penjualan-kasir');
    if (fmt === 'csv') return csvOrJson(ctx, { rows }, 'penjualan-kasir');
    return ok({ rows });
  })

  /* REP-11: nilai persediaan — Σ qty × (cost|selling) per gudang aktif */
  .get('/reports/inventory-value', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const s = await getSettings();
    const valuation = strSetting(s, 'report.inventory_valuation', 'cost') === 'selling' ? 'selling' : 'cost';

    const res = await db.execute(
      sql.raw(`
      SELECT p.category_id AS category_id, max(c.name) AS category_name,
             count(DISTINCT p.id)::int AS product_count,
             coalesce(sum(wsc.qty), 0)::numeric AS total_qty,
             coalesce(sum(wsc.qty * ${valuation === 'selling' ? 'p.selling_price' : 'p.cost_price'}), 0)::bigint AS value
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN (SELECT ws.product_id, sum(ws.quantity) AS qty
                 FROM warehouse_stocks ws
                 JOIN warehouses w ON w.id = ws.warehouse_id
                 WHERE w.deleted_at IS NULL AND w.is_active
                 GROUP BY ws.product_id) wsc ON wsc.product_id = p.id
      WHERE p.deleted_at IS NULL AND p.is_active AND p.track_stock
      GROUP BY p.category_id HAVING p.category_id IS NOT NULL
      ORDER BY value DESC`),
    );
    const rows = rowsOf(res).map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      productCount: num(r.product_count),
      totalQty: num(r.total_qty),
      value: num(r.value),
    }));
    const totalValue = rows.reduce((a, r) => a + r.value, 0);
    const fmt = exportFormat(ctx);
    if (fmt === 'xlsx') return exportXlsx(ctx, 'Nilai Persediaan', [
      { label: 'Kategori', key: 'categoryName' },
      { label: 'Jumlah Produk', key: 'productCount', align: 'right' },
      { label: 'Total Qty', key: 'totalQty', align: 'right' },
      { label: 'Nilai (Rp)', key: 'value', align: 'right' },
    ], [...rows, { categoryName: 'TOTAL', productCount: rows.reduce((a, r) => a + r.productCount, 0), totalQty: rows.reduce((a, r) => a + r.totalQty, 0), value: totalValue }], 'nilai-persediaan');
    if (fmt === 'pdf') return exportPdf(ctx, 'Nilai Persediaan', `Metode: ${valuation === 'cost' ? 'Harga beli (HPP)' : 'Harga jual'}`, [
      { label: 'Kategori', key: 'categoryName' },
      { label: 'Produk', key: 'productCount', align: 'right' },
      { label: 'Qty', key: 'totalQty', align: 'right' },
      { label: 'Nilai (Rp)', key: 'value', align: 'right' },
    ], [...rows, { categoryName: 'TOTAL', productCount: rows.reduce((a, r) => a + r.productCount, 0), totalQty: rows.reduce((a, r) => a + r.totalQty, 0), value: totalValue }], 'nilai-persediaan');
    if (fmt === 'csv') return csvOrJson(ctx, { rows }, 'nilai-persediaan');
    return ok({ rows, summary: { totalValue, valuation } });
  })

  /* REP-12: dead stock — produk aktif yang TIDAK terjual dalam N hari */
  .get('/reports/dead-stock', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const s = await getSettings();
    const days = Math.min(365, Math.max(1, numSetting(s, 'report.deadstock_days', 90)));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const res = await db.execute(
      sql.raw(`
      SELECT p.id AS product_id, p.name, p.sku, p.barcode, p.unit,
             max(c.name) AS category_name,
             coalesce(sum(ws.quantity), 0)::numeric AS stock_qty,
             p.cost_price AS cost_price, p.selling_price AS selling_price
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN warehouse_stocks ws ON ws.product_id = p.id
      WHERE p.deleted_at IS NULL AND p.is_active AND p.track_stock
        AND NOT EXISTS (
          SELECT 1 FROM transaction_items ti
          JOIN transactions t ON t.id = ti.transaction_id
          WHERE ti.product_id = p.id AND t.status = 'completed'
            AND t.sold_at >= to_timestamp('${cutoff}', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      GROUP BY p.id ORDER BY stock_qty DESC`),
    );
    const rows = rowsOf(res).map((r) => ({
      productId: r.product_id,
      name: r.name,
      sku: r.sku,
      categoryName: r.category_name,
      stockQty: num(r.stock_qty),
      costValue: num(r.stock_qty) * num(r.cost_price),
      sellingValue: num(r.stock_qty) * num(r.selling_price),
      days: days,
    }));
    const fmt = exportFormat(ctx);
    if (fmt === 'xlsx') return exportXlsx(ctx, 'Dead Stock', [
      { label: 'Produk', key: 'name' },
      { label: 'SKU', key: 'sku' },
      { label: 'Kategori', key: 'categoryName' },
      { label: 'Stok', key: 'stockQty', align: 'right' },
      { label: 'Nilai HPP (Rp)', key: 'costValue', align: 'right' },
    ], rows, 'dead-stock');
    if (fmt === 'pdf') return exportPdf(ctx, 'Laporan Dead Stock', `Produk tanpa penjualan dalam ${days} hari terakhir`, [
      { label: 'Produk', key: 'name' },
      { label: 'Stok', key: 'stockQty', align: 'right' },
      { label: 'Nilai HPP (Rp)', key: 'costValue', align: 'right' },
    ], rows, 'dead-stock');
    if (fmt === 'csv') return csvOrJson(ctx, { rows }, 'dead-stock');
    return ok({ rows, summary: { days, count: rows.length, totalCostValue: rows.reduce((a, r) => a + r.costValue, 0) } });
  })

  /* REP-13: laba rugi sederhana (income statement) */
  .get('/reports/income-statement', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const s = await getSettings();
    const tz = strSetting(s, 'report.timezone', 'Asia/Jakarta');
    const grossRes = await db.execute(sql`
      SELECT sum(ti.quantity * ti.unit_price - ti.discount_amount)::bigint AS revenue,
             sum(ti.quantity * ti.cost_price)::bigint AS cogs,
             sum(ti.quantity * (ti.unit_price - ti.cost_price) - ti.discount_amount)::bigint AS gross_profit
      FROM ${transactionItems} ti
      JOIN ${transactions} ON ${transactions.id} = ti.transaction_id
      WHERE ${transactions.status} = 'completed'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
    `);
    const g = rowsOf(grossRes)[0] ?? {};
    const revenue = num(g.revenue);
    const cogs = num(g.cogs);
    const grossProfit = num(g.gross_profit);

    // Pengeluaran kas operasional ('out') dalam rentang = beban kas sederhana
    const opxRes = await db.execute(sql`
      SELECT coalesce(sum(${cashMovements.amount}), 0)::bigint AS total
      FROM ${cashMovements}
      WHERE ${cashMovements.direction} = 'out'
        AND ${cashMovements.movementAt} >= ${from} AND ${cashMovements.movementAt} < ${to}
    `);
    const operatingExpenses = num(rowsOf(opxRes)[0]?.total);
    const netProfit = revenue - cogs - operatingExpenses;

    const summary = { revenue, cogs, grossProfit, operatingExpenses, netProfit };
    const fmt = exportFormat(ctx);
    if (fmt === 'xlsx') return exportXlsx(ctx, 'Laba Rugi', [
      { label: 'Komponen', key: 'label' },
      { label: 'Nilai (Rp)', key: 'value', align: 'right' },
    ], [
      { label: 'Pendapatan', value: revenue },
      { label: 'HPP', value: -cogs },
      { label: 'Laba Kotor', value: grossProfit },
      { label: 'Pengeluaran Kas Operasional', value: -operatingExpenses },
      { label: 'LABA BERSIH', value: netProfit },
    ], 'laba-rugi');
    if (fmt === 'pdf') return exportPdf(ctx, 'Laporan Laba Rugi', `${from} s/d ${to}`, [
      { label: 'Komponen', key: 'label' },
      { label: 'Nilai (Rp)', key: 'value', align: 'right' },
    ], [
      { label: 'Pendapatan', value: revenue },
      { label: 'HPP', value: -cogs },
      { label: 'Laba Kotor', value: grossProfit },
      { label: 'Pengeluaran Kas Operasional', value: -operatingExpenses },
      { label: 'LABA BERSIH', value: netProfit },
    ], 'laba-rugi');
    if (fmt === 'csv') return csvOrJson(ctx, { rows: [
      { label: 'Pendapatan', value: revenue },
      { label: 'HPP', value: -cogs },
      { label: 'Laba Kotor', value: grossProfit },
      { label: 'Pengeluaran Kas Operasional', value: -operatingExpenses },
      { label: 'LABA BERSIH', value: netProfit },
    ] }, 'laba-rugi');
    return ok({ period: { from, to }, summary });
  })

  /* REP-14: arus kas — kas masuk vs keluar (penjualan + mutasi manual) */
  .get('/reports/cash-flow', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const { from, to } = requireRange(ctx.query);
    const tz = strSetting(await getSettings(), 'report.timezone', 'Asia/Jakarta');

    // Kas masuk dari penjualan (cash/qris/transfer terbayar)
    const saleIn = await db.execute(sql`
      SELECT coalesce(sum(${payments.amount}), 0)::bigint AS total
      FROM ${payments}
      JOIN ${transactions} ON ${transactions.id} = ${payments.transactionId}
      WHERE ${transactions.status} = 'completed' AND ${payments.type} = 'sale' AND ${payments.status} = 'paid'
        AND ${transactions.soldAt} >= ${from} AND ${transactions.soldAt} < ${to}
    `);
    // Refund (kas keluar via retur)
    const refundsOut = await db.execute(sql`
      SELECT coalesce(sum(${payments.amount}), 0)::bigint AS total
      FROM ${payments}
      WHERE ${payments.type} = 'refund' AND ${payments.status} = 'paid'
        AND ${payments.paidAt} >= ${from} AND ${payments.paidAt} < ${to}
    `);
    // Mutasi manual
    const manual = await db.execute(sql`
      SELECT direction, coalesce(sum(${cashMovements.amount}), 0)::bigint AS total
      FROM ${cashMovements}
      WHERE ${cashMovements.movementAt} >= ${from} AND ${cashMovements.movementAt} < ${to}
      GROUP BY direction
    `);
    const manualIn = num(rowsOf(manual).find((r) => r.direction === 'in')?.total);
    const manualOut = num(rowsOf(manual).find((r) => r.direction === 'out')?.total);

    const cashIn = num(saleIn[0]?.total as never) + manualIn;
    const cashOut = num(refundsOut[0]?.total as never) + manualOut;
    const net = cashIn - cashOut;

    const fmt = exportFormat(ctx);
    const rows = [
      { label: 'Kas masuk — penjualan', value: num(saleIn[0]?.total as never) },
      { label: 'Kas masuk — mutasi manual', value: manualIn },
      { label: 'Kas keluar — refund', value: -num(refundsOut[0]?.total as never) },
      { label: 'Kas keluar — mutasi manual', value: -manualOut },
      { label: 'ARUS KAS BERSIH', value: net },
    ];
    if (fmt === 'xlsx') return exportXlsx(ctx, 'Arus Kas', [
      { label: 'Komponen', key: 'label' },
      { label: 'Nilai (Rp)', key: 'value', align: 'right' },
    ], rows, 'arus-kas');
    if (fmt === 'pdf') return exportPdf(ctx, 'Laporan Arus Kas', `${from} s/d ${to}`, [
      { label: 'Komponen', key: 'label' },
      { label: 'Nilai (Rp)', key: 'value', align: 'right' },
    ], rows, 'arus-kas');
    if (fmt === 'csv') return csvOrJson(ctx, { rows }, 'arus-kas');
    return ok({ period: { from, to }, summary: { cashIn, cashOut, net } });
  });

export const reportsRoutes = new Elysia().use(kasirRoutes).use(managerRoutes);
