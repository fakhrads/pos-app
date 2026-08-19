/**
 * Products (api-design.md §2.4 + SPEC fase 2 §4.1) — baca: kasir+; tulis: manager+; delete: admin.
 *  - GET    /products                       : list + filter + pagination (+variantCount, includeUnits)
 *  - GET    /products?q=                    : pencarian mencakup nama varian
 *  - GET    /products/barcode/:b            : scan barcode/SKU produk ATAU varian
 *  - GET    /products/:id                   : detail + variants[] + units[]
 *  - POST   /products                       : create (+ variants[], units[], trackStock, expiryDate)
 *  - PATCH  /products/:id                   : update parsial (+ trackStock, expiryDate; hasVariants DITOLAK)
 *  - DELETE /products/:id                   : soft delete (+ varian ikut, 1 transaksi)
 *  - PATCH  /products/:id/stock             : adjust stok (unit dasar)
 *  - GET    /products/:id/stock-movements   : ledger
 *  - GET    /products/export                : .xlsx 3 sheet (manager+)
 *  - GET    /products/import/template       : template .xlsx (manager+)
 *  - POST   /products/import                : multipart file (manager+, atomic/partial)
 *
 * Konvensi: kasir TIDAK menerima costPrice (AC-08.2); uang integer rupiah;
 * qty NUMERIC(12,3); SKU/barcode satu namespace global (produk+varian).
 */
import { Elysia, t } from 'elysia';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, type Tx } from '../db';
import { products, categories, stockMovements, productVariants, productUnits, warehouseStocks, warehouses, type Product } from '../db/schema';
import { ok, clientIp, parsePagination, paginationMeta, parseSort } from '../lib/http';
import { fail } from '../lib/errors';
import { toQty } from '../lib/money';
import { writeAudit } from '../lib/audit';
import {
  assertSkuAvailable,
  assertBarcodeAvailable,
  findProduct,
  listVariants,
  listUnits,
  serializeProduct,
  serializeVariant,
  serializeUnit,
  variantCounts,
  validateUnitPayload,
} from '../lib/catalog';
import {
  parseWorkbook,
  parseDateCell,
  buildImportTemplate,
  buildExportWorkbook,
  MAX_FILE_BYTES,
  MAX_ROWS,
  type ExportProductRow,
  type ParsedRow,
  type RowError,
} from '../lib/import-export';
import { mustAuth, mustManager, mustAdmin, getUser, type RouteCtx, type AuthUser } from '../middleware/auth';

/* ---------------- helpers ---------------- */

async function ensureCategoryExists(categoryId: string): Promise<void> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .limit(1);
  if (!rows[0]) fail('INVALID_PARAM', 'Kategori tidak ditemukan', 422, { field: 'categoryId' });
}

function buildListQuery(q: Record<string, string | undefined>, role: AuthUser['role']) {
  const conds: ReturnType<typeof and>[] = [isNull(products.deletedAt)];
  const search = q.q?.trim();
  if (search) {
    // Pencarian kini mencakup nama varian (produk aktif, varian aktif — SPEC §4.1)
    conds.push(
      or(
        ilike(products.name, `%${search}%`),
        ilike(products.sku, `%${search}%`),
        ilike(products.barcode, `%${search}%`),
        sql`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = ${products.id}
                    AND pv.deleted_at IS NULL AND pv.is_active AND pv.name ILIKE ${`%${search}%`})`,
      ) as any,
    );
  }
  if (q.categoryId) conds.push(eq(products.categoryId, q.categoryId));
  // Kasir: produk nonaktif tidak muncul (BA PROD-08)
  const isActive = role === 'kasir' ? true : q.isActive === undefined ? undefined : q.isActive === 'true';
  if (isActive !== undefined) conds.push(eq(products.isActive, isActive));
  if (q.lowStock === 'true') {
    conds.push(sql`${products.stockOnHand} <= ${products.minStock}`);
    conds.push(eq(products.isActive, true));
    conds.push(eq(products.trackStock, true)); // produk jasa tidak masuk laporan stok menipis (AC-04.2)
  }
  return and(...conds);
}

/** Resolve kategori by nama (import) — cache per run. */
async function resolveCategoryByName(tx: Tx | typeof db, name: string, cache: Map<string, string | null>): Promise<string | null> {
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const rows = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(isNull(categories.deletedAt), sql`lower(${categories.name}) = ${key}`))
    .limit(1);
  const id = rows[0]?.id ?? null;
  cache.set(key, id);
  return id;
}

async function findProductBySku(tx: Tx | typeof db, sku: string): Promise<Product | null> {
  const rows = await tx.select().from(products).where(and(eq(products.sku, sku), isNull(products.deletedAt))).limit(1);
  return rows[0] ?? null;
}

/** SKU/barcode bentrok dengan entitas DB (untuk validasi import). */
async function skuCollides(tx: Tx | typeof db, sku: string, excludeProductId?: string): Promise<boolean> {
  const p = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.sku, sku), isNull(products.deletedAt), excludeProductId ? sql`${products.id} <> ${excludeProductId}` : undefined))
    .limit(1);
  if (p[0]) return true;
  const v = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(eq(productVariants.sku, sku), isNull(productVariants.deletedAt)))
    .limit(1);
  return v.length > 0;
}

async function barcodeCollides(tx: Tx | typeof db, barcode: string, excludeProductId?: string): Promise<boolean> {
  const p = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.barcode, barcode), isNull(products.deletedAt), excludeProductId ? sql`${products.id} <> ${excludeProductId}` : undefined))
    .limit(1);
  if (p[0]) return true;
  const v = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(eq(productVariants.barcode, barcode), isNull(productVariants.deletedAt)))
    .limit(1);
  return v.length > 0;
}

/**
 * Jaga invariant (SPEC §3.7, AC-07.3): Σ warehouse_stocks = products.stock_on_hand.
 * Delta positif → tambah ke baris stok gudang (prioritas qty terbesar);
 * delta negatif → kurangi dari baris-baris tersebut (tidak boleh negatif).
 * Produk tanpa baris warehouse_stocks (produk baru/import) → dibuatkan baris di
 * gudang default GUD-PUSAT agar invariant tetap terjaga.
 * DIPANGGIL DALAM TRANSAKSI yang sama dengan update products → atomic (bug QA-2).
 */
async function syncWarehouseStocks(tx: Tx, productId: string, delta: number, after: number, minStock: number): Promise<void> {
  if (delta === 0) return;
  const rows = await tx
    .select({ id: warehouseStocks.id, quantity: warehouseStocks.quantity })
    .from(warehouseStocks)
    .where(and(eq(warehouseStocks.productId, productId), isNull(warehouseStocks.productVariantId)))
    .orderBy(desc(warehouseStocks.quantity));

  if (rows.length === 0) {
    // Produk belum punya representasi stok gudang → buat baris di gudang default
    const [wh] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.code, 'GUD-PUSAT'), isNull(warehouses.deletedAt)))
      .limit(1);
    if (wh) {
      await tx
        .insert(warehouseStocks)
        .values({
          warehouseId: wh.id,
          productId,
          productVariantId: null,
          quantity: toQty(after),
          minStock: toQty(minStock),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
    }
    return;
  }

  let remaining = delta;
  const now = new Date();
  for (const w of rows) {
    if (remaining === 0) break;
    const qty = Number(w.quantity);
    if (remaining > 0) {
      await tx.update(warehouseStocks).set({ quantity: toQty(qty + remaining), updatedAt: now }).where(eq(warehouseStocks.id, w.id));
      remaining = 0;
    } else {
      const take = Math.min(qty, Math.abs(remaining));
      await tx.update(warehouseStocks).set({ quantity: toQty(qty - take), updatedAt: now }).where(eq(warehouseStocks.id, w.id));
      remaining += take;
    }
  }
  // Sisa negative (hanya mungkin bila invariant DB sudah rusak) dibiarkan —
  // CHECK quantity >= 0 mencegah baris negatif.
}

const variantInputSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  sku: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
  barcode: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  costPrice: t.Optional(t.Number({ minimum: 0 })),
  sellingPrice: t.Number({ minimum: 0 }),
  // stockOnHand sengaja tanpa minimum — divalidasi manual agar details.field = 'variants[i].stockOnHand' (AC-01.4)
  stockOnHand: t.Optional(t.Number()),
  minStock: t.Optional(t.Number({ minimum: 0 })),
  isActive: t.Optional(t.Boolean()),
});

const unitInputSchema = t.Object({
  unit: t.String({ minLength: 1, maxLength: 20 }),
  factor: t.Number(),
  sellPrice: t.Number({ minimum: 0 }),
  isSellable: t.Optional(t.Boolean()),
  isPurchaseUnit: t.Optional(t.Boolean()),
  minQty: t.Optional(t.Number({ exclusiveMinimum: 0 })),
});

const productBodySchema = t.Object({
  categoryId: t.String({ format: 'uuid' }),
  name: t.String({ minLength: 1, maxLength: 200 }),
  sku: t.Optional(t.String({ maxLength: 50 })),
  barcode: t.Optional(t.String({ maxLength: 100 })),
  unit: t.Optional(t.String({ maxLength: 20 })),
  description: t.Optional(t.String()),
  costPrice: t.Number({ minimum: 0 }),
  sellingPrice: t.Number({ minimum: 0 }),
  minStock: t.Optional(t.Number({ minimum: 0 })),
  isTaxable: t.Optional(t.Boolean()),
  // Fase 2
  trackStock: t.Optional(t.Boolean()),
  expiryDate: t.Optional(t.Union([t.String(), t.Null()])),
  // stockOnHand diterima (frontend mengirim 0) tapi SELALU dipaksa 0 di create —
  // stok produk baru = 0; penyesuaian hanya lewat PATCH /products/:id/stock (bug QA-1)
  stockOnHand: t.Optional(t.Number({ minimum: 0 })),
  variants: t.Optional(t.Array(variantInputSchema, { maxItems: 8 })),
  units: t.Optional(t.Array(unitInputSchema, { maxItems: 8 })),
});

/* ---------------- read: kasir+ ---------------- */
const readRoutes = new Elysia()
  .use(mustAuth)
  .get('/products', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const { page, perPage } = parsePagination(ctx.query);
    const where = buildListQuery(ctx.query, user.role);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
    const total = Number(countRows[0]?.total ?? 0);

    const sort = parseSort(ctx.query, ['created_at', 'name', 'selling_price', 'stock_on_hand']);
    let orderBy = desc(products.createdAt);
    if (sort) {
      const col = sort.field === 'name' ? products.name : sort.field === 'selling_price' ? products.sellingPrice : sort.field === 'stock_on_hand' ? products.stockOnHand : products.createdAt;
      orderBy = sort.dir === 'asc' ? asc(col) : desc(col);
    }
    const items = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(orderBy)
      .limit(perPage)
      .offset((page - 1) * perPage);

    const ids = items.map((p) => p.id);
    const vCounts = await variantCounts(ids);
    let unitsByProduct = new Map<string, typeof productUnits.$inferSelect[]>();
    if (ctx.query.includeUnits === 'true') {
      const unitRows = ids.length ? await db.select().from(productUnits).where(inArray(productUnits.productId, ids)) : [];
      unitsByProduct = new Map(ids.map((id) => [id, []]));
      for (const u of unitRows) {
        const arr = unitsByProduct.get(u.productId) ?? [];
        arr.push(u);
        unitsByProduct.set(u.productId, arr);
      }
    }

    const out = items.map((p) => {
      const base = serializeProduct(p, user.role);
      const item: Record<string, unknown> = {
        ...base,
        hasVariants: p.hasVariants,
        trackStock: p.trackStock,
        expiryDate: p.expiryDate,
        variantCount: vCounts.get(p.id) ?? 0,
      };
      if (ctx.query.includeUnits === 'true') {
        item.units = (unitsByProduct.get(p.id) ?? []).map(serializeUnit);
      }
      return item;
    });

    return ok({ items: out, meta: paginationMeta(page, perPage, total) });
  })
  .get('/products/barcode/:barcode', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const code = ctx.params.barcode.trim();
    // 1) Produk (induk/non-varian) — prioritas (SPEC §7.3.6)
    const prodRows = await db
      .select()
      .from(products)
      .where(and(isNull(products.deletedAt), eq(products.isActive, true), or(eq(products.barcode, code), eq(products.sku, code))))
      .limit(1);
    const product = prodRows[0];
    if (product) {
      return ok({ product: serializeProduct(product, user.role), variant: null, stockOnHand: Number(product.stockOnHand), unit: product.unit });
    }
    // 2) Varian (barcode/SKU varian)
    const varRows = await db
      .select()
      .from(productVariants)
      .where(and(isNull(productVariants.deletedAt), eq(productVariants.isActive, true), or(eq(productVariants.barcode, code), eq(productVariants.sku, code))))
      .limit(2);
    if (varRows.length > 1) fail('CONFLICT', `SKU/barcode '${code}' ambigu (beberapa varian cocok)`, 409);
    if (varRows[0]) {
      const parent = await findProduct(db, varRows[0].productId);
      if (!parent || !parent.isActive) fail('BARCODE_NOT_FOUND', `Produk dengan barcode/SKU '${code}' tidak ditemukan`, 404);
      return ok({
        product: serializeProduct(parent, user.role),
        variant: serializeVariant(varRows[0], user.role),
        stockOnHand: Number(varRows[0].stockOnHand),
        unit: parent.unit,
      });
    }
    fail('BARCODE_NOT_FOUND', `Produk dengan barcode/SKU '${code}' tidak ditemukan`, 404);
  })
  .get('/products/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const product = await findProduct(db, ctx.params.id);
    if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
    // Sequential (bukan Promise.all): postgres.js pool + PGlite multiplexer (lihat services/receipt.ts)
    const variants = await listVariants(db, product.id);
    const units = await listUnits(db, product.id);
    return ok({
      product: serializeProduct(product, user.role),
      stockOnHand: Number(product.stockOnHand),
      variants: variants.map((v) => serializeVariant(v, user.role)),
      units: units.map(serializeUnit),
    });
  });

/* ---------------- write: manager+ ---------------- */
const writeRoutes = new Elysia()
  .use(mustManager)

  /* POST /products — create dengan variants/units opsional (1 transaksi) */
  .post(
    '/products',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      await ensureCategoryExists(String(ctx.body.categoryId));

      const sku = ctx.body.sku?.trim() || null;
      const barcode = ctx.body.barcode?.trim() || null;
      const trackStock = ctx.body.trackStock ?? true;
      const hasVariants = Array.isArray(ctx.body.variants) && ctx.body.variants.length > 0;

      if (sku) await assertSkuAvailable(db, sku);
      if (barcode) await assertBarcodeAvailable(db, barcode);
      if (!trackStock && hasVariants) {
        fail('VALIDATION_ERROR', 'Produk jasa (track_stock=false) tidak boleh punya varian', 422, { field: 'variants' });
      }

      // Validasi varian
      const variantsIn = (ctx.body.variants ?? []) as { name: string; sku?: string | null; barcode?: string | null; costPrice?: number; sellingPrice: number; stockOnHand?: number; minStock?: number; isActive?: boolean }[];
      for (let i = 0; i < variantsIn.length; i++) {
        const v = variantsIn[i]!;
        if (v.stockOnHand !== undefined && toQty(v.stockOnHand) < 0) {
          fail('VALIDATION_ERROR', 'Stok varian tidak boleh negatif', 422, { field: `variants[${i}].stockOnHand`, message: 'Stok varian tidak boleh negatif' });
        }
        const vSku = v.sku?.trim() || null;
        const vBarcode = v.barcode?.trim() || null;
        if (vSku) await assertSkuAvailable(db, vSku);
        if (vBarcode) await assertBarcodeAvailable(db, vBarcode);
      }

      // Validasi unit (terhadap unit dasar + duplikat dalam payload)
      const unitsIn = (ctx.body.units ?? []) as { unit: string; factor: number; sellPrice: number; isSellable?: boolean; isPurchaseUnit?: boolean; minQty?: number }[];
      const baseUnit = String(ctx.body.unit ?? 'pcs');
      const unitNames: string[] = [];
      for (const u of unitsIn) {
        validateUnitPayload(u.unit, Number(u.factor), baseUnit, unitNames);
        unitNames.push(u.unit.trim());
      }

      // Validasi format expiry_date (tanggal lampau diizinkan — SPEC §4.1)
      let expiryDate: string | null = null;
      if (ctx.body.expiryDate !== undefined && ctx.body.expiryDate !== null) {
        const parsed = parseDateCell(String(ctx.body.expiryDate));
        if (parsed.invalid) fail('VALIDATION_ERROR', 'expiryDate harus format YYYY-MM-DD atau ISO 8601 (mis. 2026-12-31T00:00:00Z)', 422, { field: 'expiryDate' });
        expiryDate = parsed.value;
      }

      const result = await db.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({
            categoryId: String(ctx.body.categoryId),
            name: String(ctx.body.name),
            sku,
            barcode,
            unit: baseUnit,
            description: ctx.body.description ?? null,
            costPrice: Math.round(Number(ctx.body.costPrice)),
            sellingPrice: Math.round(Number(ctx.body.sellingPrice)),
            minStock: toQty(ctx.body.minStock ?? 5),
            isTaxable: ctx.body.isTaxable ?? true,
            isActive: true,
            trackStock,
            hasVariants,
            // Invariant (SPEC fase 2 §3.1/§4.1): produk baru SELALU stok 0.
            // Induk ber-varian → stok hidup di varian; non-varian → stok di-set
            // via PATCH /products/:id/stock. Nilai stockOnHand dari body DIABAIKAN
            // (bug QA-1: stok 0 tidak boleh berubah jadi angka lain saat create).
            stockOnHand: 0,
            expiryDate,
          })
          .returning();

        const variantsOut: typeof productVariants.$inferSelect[] = [];
        for (const v of variantsIn) {
          const stock = toQty(v.stockOnHand ?? 0);
          const [row] = await tx
            .insert(productVariants)
            .values({
              productId: product.id,
              name: v.name.trim(),
              sku: v.sku?.trim() || null,
              barcode: v.barcode?.trim() || null,
              costPrice: Math.round(Number(v.costPrice ?? 0)),
              sellingPrice: Math.round(Number(v.sellingPrice)),
              stockOnHand: stock,
              minStock: toQty(v.minStock ?? 5),
              isActive: v.isActive ?? true,
            })
            .returning();
          if (stock > 0) {
            await tx.insert(stockMovements).values({
              productId: product.id,
              productVariantId: row.id,
              type: 'initial',
              quantity: stock,
              beforeQty: 0,
              afterQty: stock,
              createdBy: user.id,
            });
          }
          variantsOut.push(row);
        }

        const unitsOut: typeof productUnits.$inferSelect[] = [];
        for (const u of unitsIn) {
          const [row] = await tx
            .insert(productUnits)
            .values({
              productId: product.id,
              unit: u.unit.trim(),
              factor: toQty(Number(u.factor)),
              sellPrice: Math.round(Number(u.sellPrice)),
              isSellable: u.isSellable ?? true,
              isPurchaseUnit: u.isPurchaseUnit ?? false,
              minQty: toQty(u.minQty ?? 1),
            })
            .returning();
          unitsOut.push(row);
        }
        return { product, variantsOut, unitsOut };
      });

      await writeAudit(db, {
        userId: user.id,
        action: 'product.create',
        entityType: 'product',
        entityId: result.product.id,
        newValues: { name: result.product.name, sku: result.product.sku, sellingPrice: Number(result.product.sellingPrice), hasVariants, variantCount: variantsIn.length, unitCount: unitsIn.length },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      ctx.set.status = 201;
      return ok({
        product: serializeProduct(result.product, user.role),
        variants: result.variantsOut.map((v) => serializeVariant(v, user.role)),
        units: result.unitsOut.map(serializeUnit),
      });
    },
    { body: productBodySchema },
  )

  /* PATCH /products/:id */
  .patch(
    '/products/:id',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const product = await findProduct(db, ctx.params.id);
      if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);

      // hasVariants TIDAK bisa diedit langsung — hanya derivasi dari varian (SPEC §4.1)
      if ((ctx.body as Record<string, unknown>).hasVariants !== undefined) {
        fail('VALIDATION_ERROR', 'hasVariants hanya derivasi dari varian — kelola lewat endpoint varian', 422, { field: 'hasVariants' });
      }

      const patch: Record<string, unknown> = {};
      const oldValues = {
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        costPrice: Number(product.costPrice),
        sellingPrice: Number(product.sellingPrice),
        isActive: product.isActive,
        isTaxable: product.isTaxable,
        minStock: Number(product.minStock),
        unit: product.unit,
        categoryId: product.categoryId,
        trackStock: product.trackStock,
        expiryDate: product.expiryDate,
      };
      if (ctx.body.name !== undefined) patch.name = String(ctx.body.name);
      if (ctx.body.description !== undefined) patch.description = ctx.body.description ?? null;
      if (ctx.body.unit !== undefined) patch.unit = String(ctx.body.unit);
      if (ctx.body.categoryId !== undefined) {
        await ensureCategoryExists(String(ctx.body.categoryId));
        patch.categoryId = String(ctx.body.categoryId);
      }
      if (ctx.body.costPrice !== undefined) patch.costPrice = Math.round(Number(ctx.body.costPrice));
      if (ctx.body.sellingPrice !== undefined) patch.sellingPrice = Math.round(Number(ctx.body.sellingPrice));
      if (ctx.body.minStock !== undefined) patch.minStock = toQty(ctx.body.minStock);
      if (ctx.body.isActive !== undefined) patch.isActive = Boolean(ctx.body.isActive);
      if (ctx.body.isTaxable !== undefined) patch.isTaxable = Boolean(ctx.body.isTaxable);
      if (ctx.body.trackStock !== undefined) {
        if (ctx.body.trackStock === false && product.hasVariants) {
          fail('PARENT_NO_STOCK_TRACKING', 'Produk ber-varian tidak bisa diubah menjadi jasa (track_stock=false)', 422);
        }
        patch.trackStock = Boolean(ctx.body.trackStock);
      }
      if (ctx.body.expiryDate !== undefined) {
        if (ctx.body.expiryDate === null) {
          patch.expiryDate = null;
        } else {
          const parsed = parseDateCell(String(ctx.body.expiryDate));
          if (parsed.invalid) fail('VALIDATION_ERROR', 'expiryDate harus format YYYY-MM-DD atau ISO 8601 (mis. 2026-12-31T00:00:00Z)', 422, { field: 'expiryDate' });
          patch.expiryDate = parsed.value;
        }
      }

      if (ctx.body.sku !== undefined) {
        const sku = String(ctx.body.sku).trim() || null;
        if (sku) await assertSkuAvailable(db, sku, product.id);
        patch.sku = sku;
      }
      if (ctx.body.barcode !== undefined) {
        const barcode = String(ctx.body.barcode).trim() || null;
        if (barcode) await assertBarcodeAvailable(db, barcode, product.id);
        patch.barcode = barcode;
      }

      if (Object.keys(patch).length === 0) {
        fail('VALIDATION_ERROR', 'Tidak ada field yang bisa di-update', 422);
      }

      const [updated] = await db.update(products).set(patch).where(eq(products.id, product.id)).returning();
      await writeAudit(db, {
        userId: user.id,
        action: 'product.update',
        entityType: 'product',
        entityId: product.id,
        oldValues,
        newValues: {
          name: updated.name,
          sku: updated.sku,
          barcode: updated.barcode,
          costPrice: Number(updated.costPrice),
          sellingPrice: Number(updated.sellingPrice),
          isActive: updated.isActive,
          isTaxable: updated.isTaxable,
          minStock: Number(updated.minStock),
          unit: updated.unit,
          categoryId: updated.categoryId,
          trackStock: updated.trackStock,
          expiryDate: updated.expiryDate,
        },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ product: serializeProduct(updated, user.role) });
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        categoryId: t.Optional(t.String({ format: 'uuid' })),
        sku: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
        barcode: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        unit: t.Optional(t.String({ maxLength: 20 })),
        costPrice: t.Optional(t.Number({ minimum: 0 })),
        sellingPrice: t.Optional(t.Number({ minimum: 0 })),
        minStock: t.Optional(t.Number({ minimum: 0 })),
        isActive: t.Optional(t.Boolean()),
        isTaxable: t.Optional(t.Boolean()),
        trackStock: t.Optional(t.Boolean()),
        expiryDate: t.Optional(t.Union([t.String(), t.Null()])),
        // hasVariants TIDAK diterima — 422 VALIDATION_ERROR (SPEC §4.1: hanya derivasi dari varian)
      }),
    },
  )
  .patch(
    '/products/:id/stock',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const product = await findProduct(db, ctx.params.id);
      if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);

      const type = ctx.body.type as 'purchase_in' | 'adjustment';
      const delta = toQty(ctx.body.quantityDelta);
      if (delta === 0) fail('VALIDATION_ERROR', 'quantityDelta tidak boleh 0', 422);
      if (type === 'purchase_in' && delta < 0) {
        fail('VALIDATION_ERROR', 'purchase_in hanya untuk menambah stok (delta > 0)', 422);
      }
      const reason = String(ctx.body.note ?? '').trim();
      if (!reason) fail('VALIDATION_ERROR', 'Alasan (note) wajib diisi', 422);

      const result = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(products).where(eq(products.id, product.id)).for('update').limit(1);
        if (!locked) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
        const before = Number(locked.stockOnHand);
        const after = toQty(before + delta);
        if (after < 0) {
          fail('STOCK_INSUFFICIENT', `Stok tidak cukup (tersisa ${before}, diminta ${Math.abs(delta)})`, 409, {
            productId: product.id,
            available: before,
            requested: Math.abs(delta),
          });
        }
        await tx.update(products).set({ stockOnHand: after }).where(eq(products.id, product.id));
        // Bug QA-2: update products + warehouse_stocks ATOMIC (invariant Σ gudang = stock_on_hand)
        await syncWarehouseStocks(tx, product.id, delta, after, Number(locked.minStock ?? 0));
        await tx.insert(stockMovements).values({
          productId: product.id,
          type,
          quantity: Math.abs(delta),
          beforeQty: before,
          afterQty: after,
          reference: ctx.body.reference ?? null,
          note: reason,
          createdBy: user.id,
        });
        return { before, after };
      });

      await writeAudit(db, {
        userId: user.id,
        action: 'stock.adjustment',
        entityType: 'product',
        entityId: product.id,
        newValues: { type, delta, before: result.before, after: result.after, note: reason },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });
      return ok({ productId: product.id, before: result.before, after: result.after, type });
    },
    {
      body: t.Object({
        quantityDelta: t.Number(),
        type: t.Enum({ purchase_in: 'purchase_in', adjustment: 'adjustment' }),
        reference: t.Optional(t.String({ maxLength: 100 })),
        note: t.String({ minLength: 1, error: 'Alasan wajib diisi' }),
      }),
    },
  )
  .get('/products/:id/stock-movements', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const product = await findProduct(db, ctx.params.id);
    if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);
    const { page, perPage } = parsePagination(ctx.query);
    const conds = [eq(stockMovements.productId, product.id)];
    if (ctx.query.from) conds.push(gte(stockMovements.createdAt, new Date(ctx.query.from)));
    if (ctx.query.to) conds.push(lte(stockMovements.createdAt, new Date(ctx.query.to)));
    const where = and(...conds);

    const countRows = await db.select({ total: sql<number>`count(*)::int` }).from(stockMovements).where(where);
    const total = Number(countRows[0]?.total ?? 0);
    const items = await db
      .select()
      .from(stockMovements)
      .where(where)
      .orderBy(desc(stockMovements.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return ok({ items, meta: paginationMeta(page, perPage, total) });
  })

  /* ---------------- Import / Export (manager+) ---------------- */

  .get('/products/import/template', async (ctx: RouteCtx) => {
    void getUser(ctx);
    const buf = buildImportTemplate();
    ctx.set.headers = {
      ...(ctx.set.headers ?? {}),
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="template-import-produk.xlsx"',
    };
    return new Response(buf);
  })

  .post(
    '/products/import',
    async (ctx: RouteCtx) => {
      const user = getUser(ctx);
      const file = ctx.body.file as File;
      if (!file) fail('IMPORT_INVALID_HEADER', 'Kolom file (multipart) wajib diisi', 422);
      if (file.size > MAX_FILE_BYTES) fail('IMPORT_TOO_LARGE', `File melebihi batas ${MAX_FILE_BYTES / 1024 / 1024} MB`, 422);

      const fileName = file.name ?? '';
      if (!fileName.toLowerCase().endsWith('.xlsx')) {
        fail('IMPORT_INVALID_HEADER', 'Fase 2 hanya menerima .xlsx', 422);
      }

      const buffer = new Uint8Array(await file.arrayBuffer());
      const parsed = parseWorkbook(buffer);
      if (parsed.tooManyRows) fail('IMPORT_TOO_LARGE', `Maksimal ${MAX_ROWS} baris data`, 422);
      if (parsed.sheetMissing) fail('IMPORT_EMPTY', 'File tidak memiliki sheet "Produk"', 422);
      if (parsed.headerMissing.length > 0) {
        fail('IMPORT_INVALID_HEADER', `Header wajib hilang: ${parsed.headerMissing.join(', ')} (sheet Produk)`, 422);
      }
      if (parsed.empty) fail('IMPORT_EMPTY', 'Tidak ada baris data di sheet Produk', 422);

      const partial = ctx.query.partial === 'true';
      const updateBySku = ctx.query.updateBySku !== 'false';

      // ---- Validasi level DB (kategori + SKU) — kumpulkan SEMUA error ----
      const dbErrors: RowError[] = [];
      const catCache = new Map<string, string | null>();
      const validRows: ParsedRow[] = [];
      for (const row of parsed.rows) {
        const catId = await resolveCategoryByName(db, row.category, catCache);
        if (!catId) {
          dbErrors.push({ rowNumber: row.rowNumber, column: 'kategori', message: `Kategori tidak dikenal: '${row.category}'` });
          continue;
        }
        if (!updateBySku && row.sku) {
          const existing = await findProductBySku(db, row.sku);
          if (existing) {
            dbErrors.push({ rowNumber: row.rowNumber, column: 'sku', message: `SKU '${row.sku}' sudah ada di DB (updateBySku=false)` });
            continue;
          }
        }
        // SKU/barcode varian vs DB (kecuali milik produk yang sedang di-update)
        const target = row.sku ? await findProductBySku(db, row.sku) : null;
        let variantCollision = false;
        for (const v of row.variants) {
          if (v.sku && (await skuCollides(db, v.sku, target?.id))) {
            dbErrors.push({ rowNumber: row.rowNumber, column: 'varian', message: `SKU varian '${v.sku}' sudah dipakai entitas aktif` });
            variantCollision = true;
            break;
          }
          if (v.barcode && (await barcodeCollides(db, v.barcode, target?.id))) {
            dbErrors.push({ rowNumber: row.rowNumber, column: 'varian', message: `Barcode varian '${v.barcode}' sudah dipakai entitas aktif` });
            variantCollision = true;
            break;
          }
        }
        if (variantCollision) continue;
        validRows.push(row);
      }

      const allErrors = [...parsed.errors, ...dbErrors];
      if (allErrors.length > 0 && !partial) {
        fail('IMPORT_VALIDATION_FAILED', `${allErrors.length} baris gagal validasi (partial=false → tidak ada yang tersimpan)`, 422, { rows: allErrors });
      }

      // ---- Simpan (1 transaksi DB) ----
      let inserted = 0;
      let updated = 0;
      const fileLabel = `IMPORT-${fileName}`;
      await db.transaction(async (tx) => {
        for (const row of validRows) {
          const catId = (await resolveCategoryByName(tx, row.category, catCache))!;
          const target = row.sku ? await findProductBySku(tx, row.sku) : null;

          if (target && updateBySku) {
            // UPDATE — hanya kolom yang TERISI di file (SPEC §5.7)
            updated++;
            const patch: Record<string, unknown> = {};
            const isFilled = (col: string): boolean => row.filled.includes(col);
            if (isFilled('nama')) patch.name = row.name;
            if (isFilled('kategori')) patch.categoryId = catId;
            if (isFilled('barcode')) patch.barcode = row.barcode;
            if (isFilled('unit_dasar')) patch.unit = row.unit;
            if (isFilled('harga_beli')) patch.costPrice = Math.round(row.costPrice);
            if (isFilled('harga_jual')) patch.sellingPrice = Math.round(row.sellingPrice);
            if (isFilled('stok_minimum')) patch.minStock = toQty(row.minStock);
            if (isFilled('kena_pajak')) patch.isTaxable = row.isTaxable;
            if (isFilled('track_stock')) patch.trackStock = row.trackStock;
            if (isFilled('expiry_date')) patch.expiryDate = row.expiryDate;
            if (Object.keys(patch).length > 0) await tx.update(products).set(patch).where(eq(products.id, target.id));

            // Reset varian/unit bila ADA dalam file (delete-then-insert, SPEC §5.7)
            if (row.variants.length > 0 || row.units.length > 0) {
              const oldVariants = await tx
                .select({ id: productVariants.id, stockOnHand: productVariants.stockOnHand })
                .from(productVariants)
                .where(and(eq(productVariants.productId, target.id), isNull(productVariants.deletedAt)));
              const now = new Date();
              for (const ov of oldVariants) {
                await tx.update(productVariants).set({ deletedAt: now, isActive: false }).where(eq(productVariants.id, ov.id));
              }
              await tx.delete(productUnits).where(eq(productUnits.productId, target.id));
            }
            if (row.variants.length > 0) {
              await tx.update(products).set({ hasVariants: true, stockOnHand: 0 }).where(eq(products.id, target.id));
              for (const v of row.variants) {
                const [nv] = await tx
                  .insert(productVariants)
                  .values({
                    productId: target.id,
                    name: v.name,
                    sku: v.sku,
                    barcode: v.barcode,
                    costPrice: Number(target.costPrice),
                    sellingPrice: Math.round(v.sellingPrice),
                    stockOnHand: toQty(v.stock),
                    minStock: Number(target.minStock),
                    isActive: true,
                  })
                  .returning();
                if (v.stock > 0) {
                  await tx.insert(stockMovements).values({
                    productId: target.id,
                    productVariantId: nv.id,
                    type: 'initial',
                    quantity: toQty(v.stock),
                    beforeQty: 0,
                    afterQty: toQty(v.stock),
                    note: fileLabel,
                    createdBy: user.id,
                  });
                }
              }
            } else if (row.variants.length === 0) {
              await tx.update(products).set({ hasVariants: false }).where(eq(products.id, target.id));
            }
            // stok_awal terisi → stok absolut + movement adjustment (SPEC §7.5.9)
            if (isFilled('stok_awal') && row.variants.length === 0) {
              const [cur] = await tx.select({ stockOnHand: products.stockOnHand }).from(products).where(eq(products.id, target.id)).for('update');
              const before = Number(cur?.stockOnHand ?? 0);
              const after = toQty(row.stock);
              if (after !== before) {
                await tx.update(products).set({ stockOnHand: after }).where(eq(products.id, target.id));
                await tx.insert(stockMovements).values({
                  productId: target.id,
                  type: 'adjustment',
                  quantity: Math.abs(after - before),
                  beforeQty: before,
                  afterQty: after,
                  note: `${fileLabel}: stok_awal absolut`,
                  createdBy: user.id,
                });
              }
            }
            for (const u of row.units) {
              await tx
                .insert(productUnits)
                .values({
                  productId: target.id,
                  unit: u.unit,
                  factor: toQty(u.factor),
                  sellPrice: Math.round(u.sellPrice),
                  isSellable: u.isSellable,
                  isPurchaseUnit: u.isPurchaseUnit,
                  minQty: toQty(u.minQty ?? 1),
                })
                .onConflictDoNothing();
            }
          } else {
            // INSERT produk baru
            inserted++;
            const hasVariants = row.variants.length > 0;
            const [np] = await tx
              .insert(products)
              .values({
                categoryId: catId,
                name: row.name,
                sku: row.sku,
                barcode: row.barcode,
                unit: row.unit,
                costPrice: Math.round(row.costPrice),
                sellingPrice: Math.round(row.sellingPrice),
                stockOnHand: hasVariants ? 0 : toQty(row.stock),
                minStock: toQty(row.minStock),
                isTaxable: row.isTaxable,
                trackStock: row.trackStock,
                hasVariants,
                expiryDate: row.expiryDate,
                isActive: true,
              })
              .returning();
            if (!hasVariants && row.stock > 0) {
              await tx.insert(stockMovements).values({
                productId: np.id,
                type: 'initial',
                quantity: toQty(row.stock),
                beforeQty: 0,
                afterQty: toQty(row.stock),
                note: fileLabel,
                createdBy: user.id,
              });
            }
            for (const v of row.variants) {
              const [nv] = await tx
                .insert(productVariants)
                .values({
                  productId: np.id,
                  name: v.name,
                  sku: v.sku,
                  barcode: v.barcode,
                  costPrice: Math.round(row.costPrice),
                  sellingPrice: Math.round(v.sellingPrice),
                  stockOnHand: toQty(v.stock),
                  minStock: toQty(row.minStock),
                  isActive: true,
                })
                .returning();
              if (v.stock > 0) {
                await tx.insert(stockMovements).values({
                  productId: np.id,
                  productVariantId: nv.id,
                  type: 'initial',
                  quantity: toQty(v.stock),
                  beforeQty: 0,
                  afterQty: toQty(v.stock),
                  note: fileLabel,
                  createdBy: user.id,
                });
              }
            }
            for (const u of row.units) {
              await tx
                .insert(productUnits)
                .values({
                  productId: np.id,
                  unit: u.unit,
                  factor: toQty(u.factor),
                  sellPrice: Math.round(u.sellPrice),
                  isSellable: u.isSellable,
                  isPurchaseUnit: u.isPurchaseUnit,
                  minQty: toQty(u.minQty ?? 1),
                })
                .onConflictDoNothing();
            }
          }
        }
      });

      const rows: { rowNumber: number; status: 'ok' | 'error'; message?: string }[] = parsed.rows.map((r) => ({
        rowNumber: r.rowNumber,
        status: 'ok' as const,
      }));
      for (const e of allErrors) {
        rows.push({ rowNumber: e.rowNumber, status: 'error' as const, message: `${e.column}: ${e.message}` });
      }
      rows.sort((a, b) => a.rowNumber - b.rowNumber);

      await writeAudit(db, {
        userId: user.id,
        action: 'product.import',
        entityType: 'product',
        entityId: null,
        newValues: { fileName, inserted, updated, failed: allErrors.length, partial },
        ipAddress: clientIp(ctx.headers),
        userAgent: ctx.headers['user-agent'] ?? null,
      });

      // Bug QA-4: import parsial (ada baris gagal + partial=true) → 207 Multi-Status
      // dengan struktur { ok:false, error:{code:'IMPORT_PARTIAL',...}, details:{imported,failed,errors} }
      const imported = inserted + updated;
      if (allErrors.length > 0 && partial) {
        ctx.set.status = 207;
        return {
          ok: false,
          error: { code: 'IMPORT_PARTIAL', message: `${imported} berhasil, ${allErrors.length} gagal` },
          details: { imported, failed: allErrors.length, errors: allErrors, rows },
        };
      }

      ctx.set.status = 201;
      return ok({ inserted, updated, failed: allErrors.length, rows });
    },
    {
      body: t.Object({ file: t.File() }),
    },
  )

  /* GET /products/export — manager+ (berisi harga beli, AC-06.3) */
  .get('/products/export', async (ctx: RouteCtx) => {
    void getUser(ctx);
    if (ctx.query.format && ctx.query.format !== 'xlsx') {
      fail('INVALID_PARAM', 'Fase 2 hanya mendukung format=xlsx (csv = P1-late)', 422);
    }
    const prodRows = await db.select().from(products).where(isNull(products.deletedAt)).orderBy(asc(products.name));
    const ids = prodRows.map((p) => p.id);
    // Sequential (bukan Promise.all): postgres.js pool + PGlite multiplexer (lihat services/receipt.ts)
    const variantRows = ids.length ? await db.select().from(productVariants).where(and(inArray(productVariants.productId, ids), isNull(productVariants.deletedAt))) : [];
    const unitRows = ids.length ? await db.select().from(productUnits).where(inArray(productUnits.productId, ids)) : [];
    const catRows = await db.select().from(categories);
    const catMap = new Map(catRows.map((c) => [c.id, c.name]));
    const vByP = new Map<string, typeof productVariants.$inferSelect[]>();
    for (const v of variantRows) {
      const arr = vByP.get(v.productId) ?? [];
      arr.push(v);
      vByP.set(v.productId, arr);
    }
    const uByP = new Map<string, typeof productUnits.$inferSelect[]>();
    for (const u of unitRows) {
      const arr = uByP.get(u.productId) ?? [];
      arr.push(u);
      uByP.set(u.productId, arr);
    }

    const rows: ExportProductRow[] = prodRows.map((p) => ({
      categoryName: catMap.get(p.categoryId) ?? '',
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      unit: p.unit,
      costPrice: Number(p.costPrice),
      sellingPrice: Number(p.sellingPrice),
      stock: Number(p.stockOnHand), // stok saat ini (SPEC §5.9)
      minStock: Number(p.minStock),
      isTaxable: p.isTaxable,
      trackStock: p.trackStock,
      expiryDate: p.expiryDate,
      variants: (vByP.get(p.id) ?? []).map((v) => ({
        name: v.name,
        sku: v.sku,
        barcode: v.barcode,
        sellingPrice: Number(v.sellingPrice),
        stock: Number(v.stockOnHand),
      })),
      units: (uByP.get(p.id) ?? []).map((u) => ({
        unit: u.unit,
        factor: Number(u.factor),
        sellPrice: Number(u.sellPrice),
        isSellable: u.isSellable,
        isPurchaseUnit: u.isPurchaseUnit,
        minQty: Number(u.minQty),
      })),
    }));

    const buf = buildExportWorkbook(rows);
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    ctx.set.headers = {
      ...(ctx.set.headers ?? {}),
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="produk-${ymd}.xlsx"`,
    };
    return new Response(buf);
  });

/* ---------------- delete: admin ---------------- */
const deleteRoutes = new Elysia()
  .use(mustAdmin)
  .delete('/products/:id', async (ctx: RouteCtx) => {
    const user = getUser(ctx);
    const product = await findProduct(db, ctx.params.id);
    if (!product) fail('NOT_FOUND', 'Produk tidak ditemukan', 404);

    // Soft delete induk + SEMUA varian dalam 1 transaksi DB (AC-01.5)
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(products).set({ deletedAt: now, isActive: false }).where(eq(products.id, product.id));
      await tx
        .update(productVariants)
        .set({ deletedAt: now, isActive: false })
        .where(and(eq(productVariants.productId, product.id), isNull(productVariants.deletedAt)));
    });

    await writeAudit(db, {
      userId: user.id,
      action: 'product.delete',
      entityType: 'product',
      entityId: product.id,
      newValues: { name: product.name, deletedAt: new Date().toISOString() },
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers['user-agent'] ?? null,
    });
    return ok({ id: product.id, deleted: true });
  });

export const productsRoutes = new Elysia().use(readRoutes).use(writeRoutes).use(deleteRoutes);
