// ============================================================
// Tipe data — diselaraskan dengan spec/api-design.md & db-schema.md
// Uang selalu integer rupiah.
// ============================================================

export type Role = "admin" | "manager" | "kasir";
export type PaymentMethod = "cash" | "qris" | "transfer";
export type DiscountType = "percentage" | "fixed";
export type DiscountScope = "global" | "category" | "product";
export type TxStatus = "pending" | "completed" | "cancelled";
export type MembershipTier = "bronze" | "silver" | "gold";

export interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

// ---------- Auth ----------
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface AuthMeResult {
  user: User;
}

// ---------- Categories ----------
export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt?: string;
}

// ---------- Products ----------
// Fase 2 (SPEC §3.1): hasVariants, trackStock, expiryDate, deleted_at.
// Field baru opsional agar dummy data (data/products.ts) tetap kompatibel;
// backend selalu mengembalikannya.
export interface Product {
  id: string;
  categoryId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  stockOnHand: number;
  minStock: number;
  isActive: boolean;
  isTaxable: boolean;
  hasVariants?: boolean;
  trackStock?: boolean;
  expiryDate?: string | null;
  variantCount?: number;
  createdAt?: string;
  updatedAt?: string;
  category?: Category | null;
  variants?: ProductVariant[];
  units?: ProductUnit[];
}

export interface ProductPayload {
  categoryId: string;
  name: string;
  sku?: string;
  barcode?: string;
  unit?: string;
  description?: string;
  costPrice: number;
  sellingPrice: number;
  minStock?: number;
  isTaxable?: boolean;
  /** Stok awal (satuan dasar) — hanya dipakai saat create; edit lewat Koreksi Stok */
  stockOnHand?: number;
  /** Fase 2: produk jasa = tanpa cek/potong stok */
  trackStock?: boolean;
  expiryDate?: string | null;
  /** Fase 2: varian dibuat sekaligus dengan produk (AC-01.1) */
  variants?: ProductVariantPayload[];
  /** Fase 2: satuan tambahan (opsional; UI utama = halaman detail) */
  units?: ProductUnitPayload[];
}

// ---------- Product Variants (SPEC §3.2) ----------
export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  costPrice: number;
  sellingPrice: number;
  stockOnHand: number;
  minStock: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductVariantPayload {
  name: string;
  sku?: string;
  barcode?: string;
  costPrice?: number;
  sellingPrice: number;
  stockOnHand?: number;
  minStock?: number;
  isActive?: boolean;
}

// ---------- Product Units — konversi satuan (SPEC §3.3, R1) ----------
export interface ProductUnit {
  id: string;
  productId: string;
  unit: string;
  factor: number;
  sellPrice: number;
  isSellable: boolean;
  isPurchaseUnit: boolean;
  minQty: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductUnitPayload {
  unit: string;
  factor: number;
  sellPrice: number;
  isSellable?: boolean;
  isPurchaseUnit?: boolean;
  minQty?: number;
}

// ---------- Detail produk (GET /products/:id, SPEC §4.1) ----------
export interface ProductDetail {
  product: Product;
  stockOnHand: number;
  variants: ProductVariant[];
  units: ProductUnit[];
}

// ---------- Pencarian barcode/SKU (GET /products/barcode/:barcode) ----------
export interface BarcodeLookupResult {
  product: Product;
  variant?: ProductVariant | null;
  stockOnHand: number;
  unit: string;
}

// ---------- Koreksi stok varian (PATCH /product-variants/:id/stock) ----------
export interface VariantStockResult {
  variantId: string;
  before: number;
  after: number;
  type: "purchase_in" | "adjustment";
}

// ---------- Import / Export Excel (SPEC §4.1, US-05/US-06) ----------
export interface ImportRowResult {
  rowNumber: number;
  status: "ok" | "error";
  message?: string;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
}

export interface DeleteResult {
  id: string;
  deleted: boolean;
}

export interface StockAdjustPayload {
  quantityDelta: number;
  type: "purchase_in" | "adjustment";
  reference?: string;
  note?: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  /** Fase 2 (SPEC §3.5): terisi bila mutasi stok varian */
  productVariantId?: string | null;
  type: string;
  quantity: number;
  beforeQty: number;
  afterQty: number;
  reference?: string | null;
  note?: string | null;
  createdAt: string;
}

// ---------- Customers & Members ----------
export interface Membership {
  id: string;
  customerId: string;
  memberCode: string;
  tier: MembershipTier;
  pointsBalance: number;
  pointsEarnedTotal: number;
  pointsRedeemedTotal: number;
  joinedAt: string;
  expiresAt?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  createdAt?: string;
  membership?: Membership | null;
}

export interface CustomerPayload {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface PointMovement {
  id: string;
  membershipId: string;
  transactionId?: string | null;
  type: "earned" | "redeemed" | "adjustment";
  points: number;
  balanceAfter: number;
  note?: string | null;
  createdAt: string;
}

// ---------- Discounts ----------
export interface Discount {
  id: string;
  name: string;
  code?: string | null;
  type: DiscountType;
  value: number;
  scope: DiscountScope;
  productId?: string | null;
  categoryId?: string | null;
  isActive: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  maxDiscountAmount?: number | null;
  usageLimit?: number | null;
  usedCount: number;
  createdAt?: string;
}

export interface DiscountPayload {
  name: string;
  code?: string;
  type: DiscountType;
  value: number;
  scope: DiscountScope;
  categoryId?: string;
  productId?: string;
  validFrom?: string;
  validTo?: string;
  maxDiscountAmount?: number;
  usageLimit?: number;
}

// ---------- Transactions / POS ----------
export interface CartDiscount {
  type: DiscountType;
  value: number;
  reason?: string;
}

export interface CartItem {
  productId: string;
  /** Fase 2: terisi saat menjual varian */
  variantId?: string | null;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit: string;
  /** Snapshot faktor konversi saat item masuk cart (unit dasar = 1) */
  unitFactor?: number;
  /** Label konversi untuk tampilan, mis. "12 pcs" (unit dasar) — Fase 4 */
  unitBaseLabel?: string;
  unitPrice: number;
  quantity: number;
  stockOnHand: number;
  isTaxable: boolean;
  discount?: CartDiscount | null;
}

export interface CheckoutPayload {
  customerId?: string;
  items: {
    productId: string;
    /** Fase 2: wajib diisi saat menjual varian */
    variantId?: string | null;
    /** Fase 2: satuan penjualan (dus, renceng, …). Kosong = unit dasar */
    unit?: string;
    quantity: number;
    discount?: CartDiscount;
  }[];
  manualDiscount?: CartDiscount;
  discountCode?: string;
  redeemPoints?: number;
  payments: {
    method: PaymentMethod;
    amount: number;
    cashReceived?: number;
    referenceNumber?: string;
  }[];
  notes?: string;
}

export interface PreviewResult {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  pointsEarned: number;
  redeemablePoints: number;
  items: {
    productId: string;
    variantId?: string | null;
    name: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    /** Stok tersedia dalam satuan yang dipilih (floor) */
    availableStock: number;
  }[];
}

export interface TransactionItem {
  id: string;
  transactionId: string;
  productId?: string | null;
  /** Fase 2 (SPEC §3.4): snapshot varian saat transaksi */
  variantId?: string | null;
  /** Snapshot satuan penjualan */
  unit?: string;
  /** Snapshot faktor konversi (qty stok = quantity × unitFactor) */
  unitFactor?: number;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
  returnedQuantity: number;
}

export interface Payment {
  id: string;
  transactionId: string;
  type: "sale" | "refund";
  method: PaymentMethod;
  amount: number;
  cashReceived?: number | null;
  changeAmount?: number | null;
  referenceNumber?: string | null;
  status: "paid" | "pending" | "failed" | "refunded";
  paidAt: string;
}

export interface Transaction {
  id: string;
  invoiceNumber: string;
  outletId?: number;
  customerId?: string | null;
  userId: string;
  status: TxStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  discountName?: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  redeemedPointsValue: number;
  paymentStatus: string;
  notes?: string | null;
  soldAt: string;
  user?: { id: string; name: string } | null;
  customer?: { id: string; name: string; phone?: string | null } | null;
  items?: TransactionItem[];
  payments?: Payment[];
}

export interface CheckoutResult {
  transaction: Transaction;
  items: TransactionItem[];
  payments: Payment[];
  receipt: ReceiptData;
  pointsEarned: number;
}

export interface StoreProfile {
  name: string;
  address: string;
  phone: string;
  footer: string;
}

export interface ReceiptData {
  transaction: Transaction;
  items: TransactionItem[];
  payments: Payment[];
  store: StoreProfile;
}

// ---------- Reports / Dashboard ----------
export interface SalesDailyRow {
  date: string;
  revenue: number;
  transactionCount: number;
  itemsSold: number;
  avgPerTransaction: number;
  paymentBreakdown: { cash: number; qris: number; transfer: number };
}

export interface ProfitRow {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  transactionCount?: number;
}

export interface TopProductRow {
  productName: string;
  productSku?: string;
  quantity: number;
  revenue: number;
}

/** Baris laporan stok menipis (GET /reports/low-stock, Fase 3 §4.6) */
export interface LowStockRow {
  productId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit: string;
  /** Fase 3: varian = baris sendiri (AC-06.3) */
  variantId?: string | null;
  variantName?: string | null;
  /** Σ stok gudang aktif (tanpa warehouseId) / qty gudang (dengan warehouseId) */
  totalStock: number;
  minStock: number;
  productMinStock: number;
  /** Rincian stok per gudang aktif */
  warehouseBreakdown: { warehouseId: string; warehouseName: string; quantity: number }[];
}

export interface PaymentMethodRow {
  method: string;
  amount: number;
  count: number;
}

export interface DashboardData {
  todayRevenue: number;
  todayTransactions: number;
  todayItemsSold: number;
  avgPerTransaction: number;
  topProductsToday: TopProductRow[];
  recentTransactions: Transaction[];
  lowStockCount: number;
  salesLast7Days: { date: string; revenue: number }[];
  paymentMethodsToday: Record<string, number>;
}

// ---------- Settings ----------
export interface Settings {
  "store.name"?: string;
  "store.address"?: string;
  "store.phone"?: string;
  "receipt.footer"?: string;
  "store.qris_payload"?: string;
  "points.earn_per_idr"?: number;
  "points.redeem_value"?: number;
  "low_stock.default_threshold"?: number;
  "discount.manual_max_percent"?: number;
  "discount.manual_max_amount"?: number;
  "return.max_days"?: number;
  "report.timezone"?: string;
  // ---------- Fase 4 (SPEC §3.4): shift, hold, struk, WhatsApp ----------
  "shift.enforce_checkout"?: boolean;
  "shift.cash_tolerance"?: number;
  "store.whatsapp_number"?: string;
  "receipt.print_width_mm"?: number;
  "receipt.show_verification_qr"?: boolean;
  "receipt.show_qris_qr"?: boolean;
  "pos.hold_per_day_limit"?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface SettingsResponse {
  settings: Settings;
}

export interface AuditLog {
  id: string;
  userId?: string | null;
  user?: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ReturnRecord {
  id: string;
  returnNumber: string;
  transactionId: string;
  customerId?: string | null;
  userId: string;
  status: "completed" | "cancelled";
  refundMethod: "cash" | "qris" | "transfer" | "points";
  totalRefund: number;
  pointsReversed: number;
  reason?: string | null;
  notes?: string | null;
  returnedAt: string;
}

// ============================================================
// Fase 4 — Kasir: Shift & Held Cart (SPEC §3.2, §3.3, §4.1, §4.2)
// ============================================================

export type ShiftStatus = "open" | "closed";

export interface Shift {
  id: string;
  shiftNumber: string;
  outletId?: number;
  userId: string;
  userName?: string | null;
  status: ShiftStatus;
  openedAt: string;
  closedAt?: string | null;
  openingCash: number;
  cashSales: number;
  qrisSales: number;
  transferSales: number;
  refunds: number;
  expectedCash: number;
  actualCash?: number | null;
  discrepancy: number;
  transactionCount: number;
  returnCount?: number;
  notes?: string | null;
}

/** Snapshot statistik shift (SPEC §5.5) — dikirim pada close & detail */
export interface ShiftSummary {
  openingCash: number;
  cashSales: number;
  qrisSales: number;
  transferSales: number;
  refunds: number;
  cashRefunds: number;
  expectedCash: number;
  actualCash?: number | null;
  discrepancy: number;
  transactionCount: number;
  returnCount: number;
}

export interface ShiftDetailResult {
  shift: Shift;
  summary: ShiftSummary;
  transactions: {
    id: string;
    invoiceNumber: string;
    total: number;
    paymentStatus: string;
    soldAt: string;
  }[];
  returns: {
    id: string;
    returnNumber: string;
    totalRefund: number;
    returnedAt: string;
  }[];
}

/** Item hold — bentuk persis items body checkout, TANPA harga (SPEC §1.3.6) */
export interface HeldCartItem {
  productId: string;
  variantId?: string | null;
  unit?: string;
  quantity: number;
  discount?: CartDiscount | null;
}

export type HeldCartStatus = "held" | "resumed" | "discarded";

export interface HeldCart {
  id: string;
  holdNumber: string;
  label?: string | null;
  customerId?: string | null;
  items: HeldCartItem[];
  status: HeldCartStatus;
  expiresAt: string;
  remainingMinutes?: number | null;
  createdAt?: string;
}

export interface HeldCartCreatePayload {
  label?: string;
  customerId?: string;
  items: HeldCartItem[];
}

/** Item baris list hold (GET /held-carts) */
export interface HeldCartListItem extends HeldCart {
  itemCount: number;
  totalQuantity: number;
}
