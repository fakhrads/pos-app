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
  createdAt?: string;
  updatedAt?: string;
  category?: Category | null;
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
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit: string;
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
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    availableStock: number;
  }[];
}

export interface TransactionItem {
  id: string;
  transactionId: string;
  productId?: string | null;
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

export interface LowStockRow {
  id: string;
  name: string;
  sku?: string | null;
  stockOnHand: number;
  minStock: number;
  costPrice: number;
  unit: string;
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
  [key: string]: string | number | undefined;
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
