/**
 * Drizzle ORM schema — FakhriPOS `db_pos` (PostgreSQL 16+)
 * Mapping mengikuti spec/db-schema.md §8.2:
 *  - UUID PK dengan defaultRandom()
 *  - Uang = BIGINT mode 'number' (integer rupiah, aman < 2^53)
 *  - Quantity = NUMERIC(12,3) mode 'number' (helper toQty di lib/money.ts)
 *  - TIMESTAMPTZ = timestamp({ withTimezone: true, mode: 'date' })
 *  - Enum native via pgEnum
 *
 * Catatan: DDL final (CREATE TYPE/TABLE/INDEX + trigger + seed) ada di
 * src/db/ddl.sql dan dieksekusi oleh `bun run db:migrate`. Schema di file ini
 * dipakai untuk query ORM (dan opsi `drizzle-kit push` saat dev).
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  bigint,
  numeric,
  integer,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  check,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* ENUM TYPES (12)                                                     */
/* ------------------------------------------------------------------ */
export const userRole = pgEnum('user_role', ['admin', 'manager', 'kasir']);
export const membershipTier = pgEnum('membership_tier', ['bronze', 'silver', 'gold']);
export const movementType = pgEnum('movement_type', ['initial', 'purchase_in', 'sale_out', 'return_in', 'adjustment', 'cancellation', 'transfer_out', 'transfer_in']);
export const transactionStatus = pgEnum('transaction_status', ['pending', 'completed', 'cancelled']);
export const paymentStatus = pgEnum('payment_status', ['unpaid', 'partial', 'paid', 'refunded', 'failed']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'qris', 'transfer']);
export const paymentType = pgEnum('payment_type', ['sale', 'refund']);
export const discountType = pgEnum('discount_type', ['percentage', 'fixed']);
export const discountScope = pgEnum('discount_scope', ['global', 'category', 'product']);
export const refundMethod = pgEnum('refund_method', ['cash', 'qris', 'transfer', 'points']);
export const returnStatus = pgEnum('return_status', ['completed', 'cancelled']);
export const pointMovementType = pgEnum('point_movement_type', ['earned', 'redeemed', 'adjustment']);
// Fase 4 (SPEC §3.1) — status shift: open = aktif, closed = snapshot tersimpan
export const shiftStatus = pgEnum('shift_status', ['open', 'closed']);

/** INET PostgreSQL — dipetakan sebagai string (postgres.js mengembalikan teks). */
const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'inet';
  },
});

/* ------------------------------------------------------------------ */
/* Konvensi timestamp                                                  */
/* ------------------------------------------------------------------ */
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
};

/* ------------------------------------------------------------------ */
/* 1. USERS — Auth (M1)                                                */
/* ------------------------------------------------------------------ */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 30 }),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull().default('kasir'),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [uniqueIndex('uq_users_email_active').on(t.email).where(sql`${t.deletedAt} IS NULL`)],
);

/* ------------------------------------------------------------------ */
/* 2. USER_SESSIONS — refresh token (M1)                               */
/* ------------------------------------------------------------------ */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_user_sessions_user').on(t.userId), index('idx_user_sessions_expires').on(t.expiresAt)],
);

/* ------------------------------------------------------------------ */
/* 3. CATEGORIES — 1 level (M2)                                        */
/* ------------------------------------------------------------------ */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [uniqueIndex('uq_categories_slug_active').on(t.slug).where(sql`${t.deletedAt} IS NULL`)],
);

/* ------------------------------------------------------------------ */
/* 4. PRODUCTS — master produk (M2)                                    */
/* ------------------------------------------------------------------ */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    name: varchar('name', { length: 200 }).notNull(),
    sku: varchar('sku', { length: 50 }),
    barcode: varchar('barcode', { length: 100 }),
    description: text('description'),
    unit: varchar('unit', { length: 20 }).notNull().default('pcs'),
    costPrice: bigint('cost_price', { mode: 'number' }).notNull().default(0),
    sellingPrice: bigint('selling_price', { mode: 'number' }).notNull().default(0),
    stockOnHand: numeric('stock_on_hand', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    minStock: numeric('min_stock', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    isTaxable: boolean('is_taxable').notNull().default(true),
    // Fase 2 (SPEC §3.1) — semua kolom berdefault, backward-compatible
    hasVariants: boolean('has_variants').notNull().default(false),
    trackStock: boolean('track_stock').notNull().default(true),
    expiryDate: date('expiry_date', { mode: 'string' }),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('uq_products_sku_active').on(t.sku).where(sql`${t.deletedAt} IS NULL AND ${t.sku} IS NOT NULL`),
    uniqueIndex('uq_products_barcode_active').on(t.barcode).where(sql`${t.deletedAt} IS NULL AND ${t.barcode} IS NOT NULL`),
    index('idx_products_category').on(t.categoryId),
    // GIN trigram index (pencarian nama) ada di DDL raw: idx_products_name_trgm
    index('idx_products_low_stock')
      .on(t.minStock)
      .where(sql`${t.deletedAt} IS NULL AND ${t.isActive} AND ${t.stockOnHand} <= ${t.minStock}`),
    check('ck_products_cost', sql`${t.costPrice} >= 0`),
    check('ck_products_selling', sql`${t.sellingPrice} >= 0`),
    check('ck_products_stock', sql`${t.stockOnHand} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 5. CUSTOMERS — pelanggan (M5)                                       */
/* ------------------------------------------------------------------ */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 150 }).notNull(),
    phone: varchar('phone', { length: 30 }),
    email: varchar('email', { length: 255 }),
    address: text('address'),
    notes: text('notes'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [uniqueIndex('uq_customers_phone_active').on(t.phone).where(sql`${t.deletedAt} IS NULL AND ${t.phone} IS NOT NULL`)],
);

/* ------------------------------------------------------------------ */
/* 6. MEMBERSHIPS — 1:1 dengan customer (M5)                           */
/* ------------------------------------------------------------------ */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .unique()
      .references(() => customers.id, { onDelete: 'cascade' }),
    memberCode: varchar('member_code', { length: 30 }).notNull().unique(),
    tier: membershipTier('tier').notNull().default('bronze'),
    pointsBalance: bigint('points_balance', { mode: 'number' }).notNull().default(0),
    pointsEarnedTotal: bigint('points_earned_total', { mode: 'number' }).notNull().default(0),
    pointsRedeemedTotal: bigint('points_redeemed_total', { mode: 'number' }).notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (t) => [check('ck_memberships_balance', sql`${t.pointsBalance} >= 0`)],
);

/* ------------------------------------------------------------------ */
/* 7. DISCOUNTS — promo terstruktur (M6)                               */
/* ------------------------------------------------------------------ */
export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }),
    type: discountType('type').notNull(),
    value: numeric('value', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    scope: discountScope('scope').notNull().default('global'),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
    maxDiscountAmount: bigint('max_discount_amount', { mode: 'number' }),
    usageLimit: bigint('usage_limit', { mode: 'number' }),
    usedCount: bigint('used_count', { mode: 'number' }).notNull().default(0),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('uq_discounts_code_active').on(t.code).where(sql`${t.code} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('idx_discounts_active').on(t.isActive, t.validFrom, t.validTo),
  ],
);

/* ------------------------------------------------------------------ */
/* 8. TAX_RATES — pajak (M6)                                           */
/* ------------------------------------------------------------------ */
export const taxRates = pgTable(
  'tax_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    rate: numeric('rate', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    isInclusive: boolean('is_inclusive').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [check('ck_tax_rates_rate', sql`${t.rate} >= 0`)],
);

/* ------------------------------------------------------------------ */
/* 9. TRANSACTIONS — header penjualan (M3)                             */
/* ------------------------------------------------------------------ */
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: varchar('invoice_number', { length: 30 }).notNull().unique(),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: transactionStatus('status').notNull().default('completed'),
    subtotal: bigint('subtotal', { mode: 'number' }).notNull().default(0),
    discountTotal: bigint('discount_total', { mode: 'number' }).notNull().default(0),
    taxTotal: bigint('tax_total', { mode: 'number' }).notNull().default(0),
    total: bigint('total', { mode: 'number' }).notNull().default(0),
    discountId: uuid('discount_id').references(() => discounts.id, { onDelete: 'set null' }),
    discountName: varchar('discount_name', { length: 100 }),
    pointsEarned: bigint('points_earned', { mode: 'number' }).notNull().default(0),
    pointsRedeemed: bigint('points_redeemed', { mode: 'number' }).notNull().default(0),
    redeemedPointsValue: bigint('redeemed_points_value', { mode: 'number' }).notNull().default(0),
    paymentStatus: paymentStatus('payment_status').notNull().default('paid'),
    notes: text('notes'),
    soldAt: timestamp('sold_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('idx_transactions_sold_at').on(t.soldAt),
    index('idx_transactions_customer').on(t.customerId),
    index('idx_transactions_user').on(t.userId),
    index('idx_transactions_status').on(t.status),
    index('idx_transactions_sold_completed').on(t.soldAt).where(sql`${t.status} = 'completed'`),
    check('ck_transactions_total', sql`${t.total} = ${t.subtotal} - ${t.discountTotal} + ${t.taxTotal} - ${t.redeemedPointsValue}`),
  ],
);

/* ------------------------------------------------------------------ */
/* 10. TRANSACTION_ITEMS — baris item (M3)                             */
/* ------------------------------------------------------------------ */
export const transactionItems = pgTable(
  'transaction_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    // Fase 2 (SPEC §3.4) — snapshot satuan & varian. product_id tetap = induk (laporan existing).
    productVariantId: uuid('product_variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    unit: varchar('unit', { length: 20 }).notNull().default('pcs'),
    unitFactor: numeric('unit_factor', { precision: 12, scale: 3, mode: 'number' }).notNull().default(1),
    productName: varchar('product_name', { length: 200 }).notNull(),
    productSku: varchar('product_sku', { length: 50 }).notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    costPrice: bigint('cost_price', { mode: 'number' }).notNull().default(0),
    discountAmount: bigint('discount_amount', { mode: 'number' }).notNull().default(0),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    lineTotal: bigint('line_total', { mode: 'number' }).notNull(),
    returnedQuantity: numeric('returned_quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_tx_items_transaction').on(t.transactionId), index('idx_tx_items_product').on(t.productId)],
);

/* ------------------------------------------------------------------ */
/* 11. PAYMENTS — pembayaran (M4)                                      */
/* ------------------------------------------------------------------ */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    type: paymentType('type').notNull().default('sale'),
    method: paymentMethod('method').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    cashReceived: bigint('cash_received', { mode: 'number' }),
    changeAmount: bigint('change_amount', { mode: 'number' }),
    referenceNumber: varchar('reference_number', { length: 100 }),
    status: paymentStatus('status').notNull().default('paid'),
    paidAt: timestamp('paid_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_payments_transaction').on(t.transactionId), index('idx_payments_paid_at').on(t.paidAt)],
);

/* ------------------------------------------------------------------ */
/* 12. RETURNS — return/refund (M10, P1 — skema sudah disiapkan)       */
/* ------------------------------------------------------------------ */
export const returns = pgTable(
  'returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnNumber: varchar('return_number', { length: 30 }).notNull().unique(),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: returnStatus('status').notNull().default('completed'),
    refundMethod: refundMethod('refund_method').notNull(),
    refundPaymentId: uuid('refund_payment_id').references(() => payments.id, { onDelete: 'set null' }),
    totalRefund: bigint('total_refund', { mode: 'number' }).notNull(),
    pointsReversed: bigint('points_reversed', { mode: 'number' }).notNull().default(0),
    reason: text('reason'),
    notes: text('notes'),
    returnedAt: timestamp('returned_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('idx_returns_transaction').on(t.transactionId), index('idx_returns_returned_at').on(t.returnedAt)],
);

/* ------------------------------------------------------------------ */
/* 13. RETURN_ITEMS — baris return (M10)                               */
/* ------------------------------------------------------------------ */
export const returnItems = pgTable(
  'return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => returns.id, { onDelete: 'cascade' }),
    transactionItemId: uuid('transaction_item_id')
      .notNull()
      .references(() => transactionItems.id),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    productName: varchar('product_name', { length: 200 }).notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    subtotal: bigint('subtotal', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_return_items_return').on(t.returnId), index('idx_return_items_tx_item').on(t.transactionItemId)],
);

/* ------------------------------------------------------------------ */
/* 14. STOCK_MOVEMENTS — ledger stok (M2)                              */
/* ------------------------------------------------------------------ */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Fase 3 (SPEC §3.1) — gudang asal mutasi; wajib terisi untuk SEMUA mutasi
    // (kartu stok per gudang F3-5). NULL hanya baris legacy yang gagal backfill.
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    // Fase 2 (SPEC §3.5) — mutasi stok varian: product_id = induk, product_variant_id = varian
    productVariantId: uuid('product_variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    type: movementType('type').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    beforeQty: numeric('before_qty', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    afterQty: numeric('after_qty', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    transactionId: uuid('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    returnId: uuid('return_id').references(() => returns.id, { onDelete: 'set null' }),
    reference: varchar('reference', { length: 100 }),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_stock_movements_product').on(t.productId, t.createdAt),
    index('idx_stock_movements_tx').on(t.transactionId),
    index('idx_stock_movements_return').on(t.returnId),
    // Fase 3 (SPEC §3.1): akses kartu stok per gudang per produk
    index('idx_stock_movements_wh_product').on(t.warehouseId, t.productId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* 15. POINT_MOVEMENTS — riwayat poin (M5)                             */
/* ------------------------------------------------------------------ */
export const pointMovements = pgTable(
  'point_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    type: pointMovementType('type').notNull(),
    points: bigint('points', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_point_movements_membership').on(t.membershipId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* 16. AUDIT_LOGS — append-only (M11, P1)                              */
/* ------------------------------------------------------------------ */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 50 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id'),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_entity').on(t.entityType, t.entityId),
    index('idx_audit_created').on(t.createdAt),
    index('idx_audit_user').on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* 17. SETTINGS — konfigurasi key-value (M9)                           */
/* ------------------------------------------------------------------ */
export const settings = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull().unique(),
    value: jsonb('value').notNull(),
    description: text('description'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
);

/* ------------------------------------------------------------------ */
/* 18. PRODUCT_VARIANTS — Fase 2 (SPEC §3.2, PROD-12/R12)              */
/*     Varian = ukuran/warna/rasa; stok & harga sendiri (unit dasar induk) */
/* ------------------------------------------------------------------ */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    sku: varchar('sku', { length: 50 }),
    barcode: varchar('barcode', { length: 100 }),
    costPrice: bigint('cost_price', { mode: 'number' }).notNull().default(0),
    sellingPrice: bigint('selling_price', { mode: 'number' }).notNull().default(0),
    stockOnHand: numeric('stock_on_hand', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    minStock: numeric('min_stock', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('uq_product_variants_sku_active').on(t.sku).where(sql`${t.deletedAt} IS NULL AND ${t.sku} IS NOT NULL`),
    uniqueIndex('uq_product_variants_barcode_active')
      .on(t.barcode)
      .where(sql`${t.deletedAt} IS NULL AND ${t.barcode} IS NOT NULL`),
    index('idx_product_variants_product').on(t.productId, t.isActive),
    check('ck_variants_cost', sql`${t.costPrice} >= 0`),
    check('ck_variants_selling', sql`${t.sellingPrice} >= 0`),
    check('ck_variants_stock', sql`${t.stockOnHand} >= 0`),
    check('ck_variants_min_stock', sql`${t.minStock} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 19. PRODUCT_UNITS — satuan tambahan per produk (SPEC §3.3, R1)      */
/*     Menggantikan `unit_conversions` (keputusan §1.3.1).             */
/* ------------------------------------------------------------------ */
export const productUnits = pgTable(
  'product_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    unit: varchar('unit', { length: 20 }).notNull(),
    factor: numeric('factor', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    sellPrice: bigint('sell_price', { mode: 'number' }).notNull().default(0),
    isSellable: boolean('is_sellable').notNull().default(true),
    isPurchaseUnit: boolean('is_purchase_unit').notNull().default(false),
    minQty: numeric('min_qty', { precision: 12, scale: 3, mode: 'number' }).notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('uq_product_units_product_unit').on(t.productId, t.unit),
    index('idx_product_units_product').on(t.productId),
    check('ck_units_factor', sql`${t.factor} > 0`),
    check('ck_units_sell_price', sql`${t.sellPrice} >= 0`),
    check('ck_units_min_qty', sql`${t.minQty} > 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 20. WAREHOUSES — Fase 2 schema P0, CRUD Fase 3 (SPEC §3.6)          */
/* ------------------------------------------------------------------ */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    address: text('address'),
    pic: varchar('pic', { length: 100 }),
    capacity: numeric('capacity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('uq_warehouses_code_active').on(t.code).where(sql`${t.deletedAt} IS NULL`),
    check('ck_warehouses_capacity', sql`${t.capacity} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 21. WAREHOUSE_STOCKS — stok per gudang (SPEC §3.7)                  */
/*     Invariant seed: Σ warehouse_stocks = stock_on_hand per produk/varian */
/* ------------------------------------------------------------------ */
export const warehouseStocks = pgTable(
  'warehouse_stocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    productVariantId: uuid('product_variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    minStock: numeric('min_stock', { precision: 12, scale: 3, mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_wh_stocks_product')
      .on(t.warehouseId, t.productId)
      .where(sql`${t.productVariantId} IS NULL`),
    uniqueIndex('uq_wh_stocks_variant')
      .on(t.warehouseId, t.productId, t.productVariantId)
      .where(sql`${t.productVariantId} IS NOT NULL`),
    index('idx_wh_stocks_product').on(t.productId),
    check('ck_wh_stocks_qty', sql`${t.quantity} >= 0`),
    check('ck_wh_stocks_min', sql`${t.minStock} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 22. STOCK_TRANSFERS — Fase 2 schema P0, API Fase 3 (SPEC §3.8)      */
/* ------------------------------------------------------------------ */
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Fase 3 (SPEC §3.2): satu nomor = satu dokumen transfer multi-item
    transferNumber: varchar('transfer_number', { length: 30 }).notNull(),
    fromWarehouseId: uuid('from_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: uuid('to_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productVariantId: uuid('product_variant_id').references(() => productVariants.id),
    quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_stock_transfers_from').on(t.fromWarehouseId),
    index('idx_stock_transfers_to').on(t.toWarehouseId),
    // Fase 3 (SPEC §3.2): pengelompokan riwayat per nomor dokumen
    uniqueIndex('uq_stock_transfers_number').on(t.transferNumber),
    index('idx_stock_transfers_number_created').on(t.transferNumber, t.createdAt),
    check('ck_transfers_qty', sql`${t.quantity} > 0`),
    check('ck_transfers_diff', sql`${t.fromWarehouseId} <> ${t.toWarehouseId}`),
  ],
);

/* ------------------------------------------------------------------ */
/* 23. STOCK_ADJUSTMENTS — Fase 2 schema P0, API Fase 3 (SPEC §3.8)    */
/* ------------------------------------------------------------------ */
export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productVariantId: uuid('product_variant_id').references(() => productVariants.id),
    quantityDelta: numeric('quantity_delta', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    reason: varchar('reason', { length: 50 }).notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_stock_adjustments_wh').on(t.warehouseId),
    check('ck_adjustments_delta', sql`${t.quantityDelta} <> 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 24. SHIFTS — Fase 4 (SPEC §3.2, F4-6)                               */
/*     Atribusi transaksi/retur ke shift via WINDOW WAKTU              */
/*     [opened_at, closed_at) — bukan FK shift_id (§1.3.3).            */
/*     Statistik di-snapshot saat close; 1 user ≤ 1 shift open.        */
/* ------------------------------------------------------------------ */
export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftNumber: varchar('shift_number', { length: 30 }).notNull().unique(),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: shiftStatus('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    openingCash: bigint('opening_cash', { mode: 'number' }).notNull().default(0),
    cashSales: bigint('cash_sales', { mode: 'number' }).notNull().default(0),
    qrisSales: bigint('qris_sales', { mode: 'number' }).notNull().default(0),
    transferSales: bigint('transfer_sales', { mode: 'number' }).notNull().default(0),
    refunds: bigint('refunds', { mode: 'number' }).notNull().default(0),
    expectedCash: bigint('expected_cash', { mode: 'number' }).notNull().default(0),
    actualCash: bigint('actual_cash', { mode: 'number' }),
    discrepancy: bigint('discrepancy', { mode: 'number' }).notNull().default(0),
    transactionCount: integer('transaction_count').notNull().default(0),
    returnCount: integer('return_count').notNull().default(0),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('idx_shifts_user_status').on(t.userId, t.status),
    index('idx_shifts_opened_at').on(t.openedAt),
    index('idx_shifts_status').on(t.status),
    check('ck_shifts_opening_cash', sql`${t.openingCash} >= 0`),
    check('ck_shifts_cash_sales', sql`${t.cashSales} >= 0`),
    check('ck_shifts_qris_sales', sql`${t.qrisSales} >= 0`),
    check('ck_shifts_transfer_sales', sql`${t.transferSales} >= 0`),
    check('ck_shifts_refunds', sql`${t.refunds} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 25. HELD_CARTS — Fase 4 (SPEC §3.3, F4-4)                           */
/*     Snapshot JSONB tanpa harga (§1.3.6 — harga TIDAK dipercaya).    */
/*     Status VARCHAR (bukan enum) — terminal & bebas migrasi.         */
/*     Kadaluarsa akhir hari WIB; lazy filter tanpa job cleanup.       */
/* ------------------------------------------------------------------ */
export const heldCarts = pgTable(
  'held_carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    holdNumber: varchar('hold_number', { length: 30 }).notNull().unique(),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    label: varchar('label', { length: 100 }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    // Bentuk persis `items` checkout (Fase 2 §4.4): [{ productId, variantId?, unit?, quantity, discount? }]
    items: jsonb('items').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('held'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    resumedAt: timestamp('resumed_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('idx_held_carts_user_status').on(t.userId, t.status),
    index('idx_held_carts_expires').on(t.expiresAt),
    check('ck_held_carts_items_array', sql`jsonb_typeof(${t.items}) = 'array'`),
  ],
);

/* ------------------------------------------------------------------ */
/* 26. CASH_MOVEMENTS — kas masuk/keluar manual (Fase 5, SPEC §4.6)     */
/*     Mencatat setoran kasir, tarikan (prive), pengeluaran operasional */
/*     di luar penjualan. `direction` = 'in' (masuk) / 'out' (keluar).  */
/*     Numerik rupiah (BIGINT); amount > 0. Tidak ada relasi ke         */
/*     transaksi — murni mutasi kas manual.                             */
/* ------------------------------------------------------------------ */
export const cashMovementDirection = pgEnum('cash_movement_direction', ['in', 'out']);

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: bigint('outlet_id', { mode: 'number' }).notNull().default(1),
    // 'in' = kas masuk (setoran, modal, dsb) · 'out' = kas keluar (pengeluaran, prive, dsb)
    direction: cashMovementDirection('direction').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    method: paymentMethod('method').notNull().default('cash'),
    category: varchar('category', { length: 50 }),
    note: text('note'),
    reference: varchar('reference', { length: 100 }),
    movementAt: timestamp('movement_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('idx_cash_movements_movement_at').on(t.movementAt),
    index('idx_cash_movements_direction').on(t.direction),
    index('idx_cash_movements_created_by').on(t.createdBy),
    check('ck_cash_movements_amount', sql`${t.amount} > 0`),
  ],
);


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Discount = typeof discounts.$inferSelect;
export type TaxRate = typeof taxRates.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionItem = typeof transactionItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Return = typeof returns.$inferSelect;
export type ReturnItem = typeof returnItems.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type PointMovement = typeof pointMovements.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
export type ProductUnit = typeof productUnits.$inferSelect;
export type NewProductUnit = typeof productUnits.$inferInsert;
export type Warehouse = typeof warehouses.$inferSelect;
export type NewWarehouse = typeof warehouses.$inferInsert;
export type WarehouseStock = typeof warehouseStocks.$inferSelect;
export type NewWarehouseStock = typeof warehouseStocks.$inferInsert;
export type StockTransfer = typeof stockTransfers.$inferSelect;
export type NewStockTransfer = typeof stockTransfers.$inferInsert;
export type StockAdjustment = typeof stockAdjustments.$inferSelect;
export type NewStockAdjustment = typeof stockAdjustments.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type CashMovement = typeof cashMovements.$inferSelect;
export type NewCashMovement = typeof cashMovements.$inferInsert;
export type NewShift = typeof shifts.$inferInsert;
export type HeldCart = typeof heldCarts.$inferSelect;
export type NewHeldCart = typeof heldCarts.$inferInsert;
