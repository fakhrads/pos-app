/**
 * Helper bersama Stok & Gudang (Fase 3, SPEC §3.3–3.4, §5).
 *
 * Satu-satunya tempat yang menyentuh `warehouse_stocks` + `stock_movements`
 * untuk mutasi stok (transfer, adjustment, sale_out/return_in/cancellation,
 * PATCH /products/:id/stock) — agar invariant §3.4 selalu terjaga:
 *   1. Σ warehouse_stocks = stock_on_hand per produk/varian
 *   2. setiap mutasi menulis ≥1 baris stock_movements dengan warehouse_id
 *   3. transfer netral (Σ transfer_out = Σ transfer_in per produk/varian)
 *
 * Semua update stok atomik: UPDATE ... WHERE quantity >= qty (anti oversell).
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx, type Tx } from '../db';
import {
  warehouses,
  warehouseStocks,
  products,
  productVariants,
  stockMovements,
  settings,
} from '../db/schema';
import { fail } from './errors';
import { toQty } from './money';
import { getSettings, strSetting } from './settings';

/** Nilai movement_type (selaras enum DB — ditambah 2 nilai Fase 3). */
export type MovementType =
  | 'initial'
  | 'purchase_in'
  | 'sale_out'
  | 'return_in'
  | 'adjustment'
  | 'cancellation'
  | 'transfer_out'
  | 'transfer_in';

/* ------------------------------------------------------------------ */
/* Daftar tetap alasan adjustment (SPEC §1.3.5, R2)                    */
/* ------------------------------------------------------------------ */
export const ADJUSTMENT_REASONS = ['rusak', 'expired', 'hilang', 'salah_catat', 'selisih_supplier', 'laimnya'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABEL: Record<string, string> = {
  rusak: 'Rusak',
  expired: 'Expired',
  hilang: 'Hilang',
  salah_catat: 'Salah Catat',
  selisih_supplier: 'Selisih Supplier',
  lainnya: 'Lainnya',
};

/** Normalisasi reason: lowercase + trim ('Rusak' → 'rusak', SPEC §7.4.7). */
export function normalizeReason(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Validasi reason ∈ daftar; throw 422 INVALID_REASON dengan details.allowed. */
export function assertValidReason(raw: string): string {
  const r = normalizeReason(raw);
  if (!(ADJUSTMENT_REASONS as readonly string[]).includes(r)) {
    fail('INVALID_REASON', `Alasan tidak valid — gunakan salah satu: ${ADJUSTMENT_REASONS.join(', ')}`, 422, {
      allowed: ADJUSTMENT_REASONS,
    });
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Label tipe mutasi (UI — MUTATION_TYPE_LABEL + 2 nilai enum baru)    */
/* ------------------------------------------------------------------ */
export const MUTATION_TYPE_LABEL: Record<string, string> = {
  initial: 'Stok Awal',
  purchase_in: 'Pembelian',
  sale_out: 'Penjualan',
  return_in: 'Retur Masuk',
  adjustment: 'Koreksi Stok',
  cancellation: 'Pembatalan',
  transfer_out: 'Transfer Keluar',
  transfer_in: 'Transfer Masuk',
};

/* ------------------------------------------------------------------ */
/* Gudang default (settings['stock.default_warehouse_id'])             */
/* ------------------------------------------------------------------ */
const DEFAULT_WH_KEY = 'stock.default_warehouse_id';

/**
 * Gudang penjualan default. Urutan resolusi (SPEC §7.1.2):
 * 1. settings['stock.default_warehouse_id'] bila masih ada & aktif
 * 2. fallback: gudang aktif pertama (created_at ASC) — settings diperbaiki
 * 3. tidak ada gudang aktif → 404 (buat gudang dulu)
 */
export async function getDefaultWarehouseId(dbOrTx: DbOrTx = db): Promise<string> {
  const s = await getSettings();
  const configured = strSetting(s, DEFAULT_WH_KEY, '');
  if (configured) {
    const [w] = await dbOrTx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(and(eq(warehouses.id, configured), eq(warehouses.isActive, true), isNull(warehouses.deletedAt)))
      .limit(1);
    if (w) return w.id;
  }
  const [first] = await dbOrTx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.isActive, true), isNull(warehouses.deletedAt)))
    .orderBy(asc(warehouses.createdAt))
    .limit(1);
  if (!first) fail('WAREHOUSE_NOT_FOUND', 'Belum ada gudang aktif — buat gudang dulu', 404);
  try {
    await dbOrTx
      .insert(settings)
      .values({ key: DEFAULT_WH_KEY, value: first.id, description: 'Gudang penjualan default (dikelola via POST /warehouses/:id/default)' })
      .onConflictDoUpdate({ target: settings.key, set: { value: first.id } });
  } catch {
    /* self-heal best-effort — jangan gagalkan operasi karena settings */
  }
  return first.id;
}

/** Set gudang default (dipanggil route POST /warehouses/:id/default & create pertama). */
export async function setDefaultWarehouse(tx: Tx | typeof db, warehouseId: string): Promise<void> {
  await tx
    .insert(settings)
    .values({ key: DEFAULT_WH_KEY, value: warehouseId, description: 'Gudang penjualan default (dikelola via POST /warehouses/:id/default)' })
    .onConflictDoUpdate({ target: settings.key, set: { value: warehouseId } });
}

/** Apakah gudang adalah default saat ini. */
export async function isDefaultWarehouse(warehouseId: string): Promise<boolean> {
  try {
    return (await getDefaultWarehouseId()) === warehouseId;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Cari & validasi gudang                                              */
/* ------------------------------------------------------------------ */
export async function findWarehouse(dbOrTx: DbOrTx, id: string): Promise<(typeof warehouses.$inferSelect) | null> {
  const rows = await dbOrTx.select().from(warehouses).where(and(eq(warehouses.id, id), isNull(warehouses.deletedAt))).limit(1);
  return rows[0] ?? null;
}

/** Gudang harus ada (404) & aktif (422 WAREHOUSE_INACTIVE, pesan menyebut nama). */
export async function assertActiveWarehouse(dbOrTx: DbOrTx, id: string, label: string): Promise<(typeof warehouses.$inferSelect)> {
  const w = await findWarehouse(dbOrTx, id);
  if (!w) fail('WAREHOUSE_NOT_FOUND', `${label} tidak ditemukan`, 404, { warehouseId: id });
  if (!w.isActive) fail('WAREHOUSE_INACTIVE', `${label} '${w.name}' sedang nonaktif`, 422, { warehouseId: id, name: w.name });
  return w;
}

/* ------------------------------------------------------------------ */
/* Mutasi stok gudang — ATOMIK (anti oversell, R13)                    */
/* ------------------------------------------------------------------ */

/**
 * Terapkan delta (+/−) ke baris warehouse_stocks (warehouse, product, variant).
 * - delta > 0: upsert baris (buat bila belum ada, qty += delta)
 * - delta < 0: UPDATE ... WHERE quantity >= |delta| — gagal → 409
 *   STOCK_INSUFFICIENT (rollback otomatis oleh pemanggil yang memakai tx).
 * Mengembalikan { before, after } level gudang.
 */
export async function applyWarehouseDelta(
  tx: Tx,
  warehouseId: string,
  productId: string,
  variantId: string | null,
  delta: number,
): Promise<{ before: number; after: number }> {
  const now = new Date();
  const q = toQty(delta);

  if (q > 0) {
    const [row] = await tx
      .insert(warehouseStocks)
      .values({ warehouseId, productId, productVariantId: variantId, quantity: q, minStock: 0, updatedAt: now })
      .onConflictDoUpdate({
        target: variantId
          ? [warehouseStocks.warehouseId, warehouseStocks.productId, warehouseStocks.productVariantId]
          : [warehouseStocks.warehouseId, warehouseStocks.productId],
        targetWhere: variantId ? sql`${warehouseStocks.productVariantId} IS NOT NULL` : sql`${warehouseStocks.productVariantId} IS NULL`,
        set: { quantity: sql`${warehouseStocks.quantity} + ${q}`, updatedAt: now },
      })
      .returning({ quantity: warehouseStocks.quantity });
    const after = Number(row?.quantity ?? q);
    return { before: toQty(after - q), after };
  }

  // q < 0 — pengurangan atomik
  const [row] = await tx
    .update(warehouseStocks)
    .set({ quantity: sql`${warehouseStocks.quantity} + ${q}`, updatedAt: now })
    .where(
      and(
        eq(warehouseStocks.warehouseId, warehouseId),
        eq(warehouseStocks.productId, productId),
        variantId ? eq(warehouseStocks.productVariantId, variantId) : isNull(warehouseStocks.productVariantId),
        sql`${warehouseStocks.quantity} >= ${Math.abs(q)}`,
      ),
    )
    .returning({ quantity: warehouseStocks.quantity });
  if (row) {
    const after = Number(row.quantity);
    return { before: toQty(after + Math.abs(q)), after };
  }
  // Baris tidak ada atau stok kurang
  const [existing] = await tx
    .select({ quantity: warehouseStocks.quantity })
    .from(warehouseStocks)
    .where(
      and(
        eq(warehouseStocks.warehouseId, warehouseId),
        eq(warehouseStocks.productId, productId),
        variantId ? eq(warehouseStocks.productVariantId, variantId) : isNull(warehouseStocks.productVariantId),
      ),
    )
    .limit(1);
  fail(
    'STOCK_INSUFFICIENT',
    `Stok tidak cukup (tersedia ${existing ? Number(existing.quantity) : 0}, diminta ${Math.abs(q)})`,
    409,
    { productId, variantId: variantId ?? null, warehouseId, available: existing ? Number(existing.quantity) : 0, requested: Math.abs(q) },
  );
}

/**
 * Sinkronkan stock_on_hand produk/varian (invariant Σ gudang = stock_on_hand).
 * Delta sama dengan delta gudang (adjustment & PATCH /products/:id/stock).
 * Transfer TIDAK memanggil ini (net 0). Mengembalikan { before, after } level produk.
 */
export async function syncStockOnHand(
  tx: Tx,
  productId: string,
  variantId: string | null,
  delta: number,
): Promise<{ before: number; after: number }> {
  const q = toQty(delta);
  if (variantId) {
    const [v] = await tx
      .select({ id: productVariants.id, stockOnHand: productVariants.stockOnHand })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .for('update')
      .limit(1);
    if (!v) fail('PRODUCT_NOT_FOUND', 'Varian tidak ditemukan', 404);
    const before = Number(v.stockOnHand);
    const after = toQty(before + q);
    if (after < 0) fail('STOCK_INSUFFICIENT', `Stok varian tidak cukup (tersedia ${before})`, 409, { variantId, available: before, requested: Math.abs(q) });
    await tx.update(productVariants).set({ stockOnHand: after }).where(eq(productVariants.id, v.id));
    return { before, after };
  }
  const [p] = await tx
    .select({ id: products.id, stockOnHand: products.stockOnHand })
    .from(products)
    .where(eq(products.id, productId))
    .for('update')
    .limit(1);
  if (!p) fail('PRODUCT_NOT_FOUND', 'Produk tidak ditemukan', 404);
  const before = Number(p.stockOnHand);
  const after = toQty(before + q);
  if (after < 0) fail('STOCK_INSUFFICIENT', `Stok produk tidak cukup (tersedia ${before})`, 409, { productId, available: before, requested: Math.abs(q) });
  await tx.update(products).set({ stockOnHand: after }).where(eq(products.id, p.id));
  return { before, after };
}

/* ------------------------------------------------------------------ */
/* Ledger (stock_movements) — append-only, warehouse_id WAJIB terisi    */
/* ------------------------------------------------------------------ */
export interface MovementInput {
  warehouseId: string;
  productId: string;
  productVariantId?: string | null;
  type: MovementType;
  /** Selalu positif — tanda tercermin di beforeQty/afterQty (konvensi existing). */
  quantity: number;
  /** before/after LEVEL GUDANG (kartu stok per gudang, AC-05.2). */
  beforeQty: number;
  afterQty: number;
  reference?: string | null;
  note?: string | null;
  transactionId?: string | null;
  returnId?: string | null;
  createdBy?: string | null;
}

export async function recordMovement(tx: Tx, m: MovementInput): Promise<void> {
  await tx.insert(stockMovements).values({
    warehouseId: m.warehouseId,
    productId: m.productId,
    productVariantId: m.productVariantId ?? null,
    type: m.type,
    quantity: toQty(m.quantity),
    beforeQty: toQty(m.beforeQty),
    afterQty: toQty(m.afterQty),
    reference: m.reference ?? null,
    note: m.note ?? null,
    transactionId: m.transactionId ?? null,
    returnId: m.returnId ?? null,
    createdBy: m.createdBy ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Validasi qty (SPEC §5.11): > 0 (transfer) / <> 0 (adjustment),       */
/* presisi ≤ 3 desimal                                                  */
/* ------------------------------------------------------------------ */
export function assertQtyValid(raw: unknown, opts: { allowZero?: boolean } = {}): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) fail('INVALID_QUANTITY', 'Quantity harus berupa angka', 422);
  if (opts.allowZero ? n === 0 : n <= 0) {
    fail('INVALID_QUANTITY', opts.allowZero ? 'Quantity tidak boleh 0' : 'Quantity harus lebih dari 0', 422);
  }
  const rounded = Math.round(n * 1000) / 1000;
  if (Math.abs(n - rounded) > 1e-9) fail('INVALID_QUANTITY', 'Quantity maksimal 3 desimal (0.001)', 422);
  return rounded;
}

/** Rentang tanggal (string 'YYYY-MM-DD' atau ISO) dalam WIB → [start, end) UTC. */
export function dateRangeWib(fromRaw?: string, toRaw?: string): { from?: Date; to?: Date } {
  const parse = (raw: string): Date => {
    const d = new Date(raw.length === 10 ? `${raw}T00:00:00+07:00` : raw);
    if (Number.isNaN(d.getTime())) fail('INVALID_PARAM', `Format tanggal tidak valid: ${raw}`, 400);
    return d;
  };
  const out: { from?: Date; to?: Date } = {};
  if (fromRaw) out.from = parse(fromRaw);
  if (toRaw) {
    const to = parse(toRaw);
    // 'YYYY-MM-DD' → akhir hari WIB; ISO penuh dipakai apa adanya
    out.to = toRaw.length === 10 ? new Date(to.getTime() + 86_400_000 - 1) : to;
  }
  return out;
}
