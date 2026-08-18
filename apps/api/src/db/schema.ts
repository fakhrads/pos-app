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
export const movementType = pgEnum('movement_type', ['initial', 'purchase_in', 'sale_out', 'return_in', 'adjustment', 'cancellation']);
export const transactionStatus = pgEnum('transaction_status', ['pending', 'completed', 'cancelled']);
export const paymentStatus = pgEnum('payment_status', ['unpaid', 'partial', 'paid', 'refunded', 'failed']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'qris', 'transfer']);
export const paymentType = pgEnum('payment_type', ['sale', 'refund']);
export const discountType = pgEnum('discount_type', ['percentage', 'fixed']);
export const discountScope = pgEnum('discount_scope', ['global', 'category', 'product']);
export const refundMethod = pgEnum('refund_method', ['cash', 'qris', 'transfer', 'points']);
export const returnStatus = pgEnum('return_status', ['completed', 'cancelled']);
export const pointMovementType = pgEnum('point_movement_type', ['earned', 'redeemed', 'adjustment']);

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
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
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
