import { uuidv4 } from "@/lib/utils";
import type {
  CartDiscount,
  CartItem,
  CheckoutResult,
  Customer,
  StoreProfile,
  Transaction,
  TransactionItem,
  Payment,
  PaymentMethod,
} from "@/lib/types";
import type { OfflineOrder, OfflineOrderItem, OfflineOrderPayment } from "@/lib/offline-db";

// ============================================================
// Offline checkout — menghitung transaksi lokal (tanpa server),
// menyusun OfflineOrder utk IndexedDB + struk sementara (SPEC §5, AC-04.1).
// Server tetap sumber kebenaran harga/stok saat sync (SPEC §5:2).
// ============================================================

interface BuildOfflineCheckoutArgs {
  cart: CartItem[];
  legs: { method: PaymentMethod; amount: number; cashReceived?: number; referenceNumber?: string }[];
  customer: Customer | null;
  txDiscount: CartDiscount | null;
  redeemPoints: number;
  taxRate: number;
  redeemValuePerPoint: number;
  total: number;
  storeName: string;
  storeProfile?: Partial<StoreProfile>;
  shiftId?: string | null;
  operatorName: string;
  qrisPayload?: string;
}

export function computeOfflineTotals(
  cart: CartItem[],
  txDiscount: CartDiscount | null,
  redeemPoints: number,
  taxRate: number,
  redeemValuePerPoint: number
) {
  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const itemDiscounts = cart.reduce(
    (s, i) =>
      s +
      (i.discount
        ? i.discount.type === "percentage"
          ? Math.round((i.unitPrice * i.quantity * i.discount.value) / 100)
          : Math.min(i.discount.value, i.unitPrice * i.quantity)
        : 0),
    0
  );
  const txDiscountAmount = txDiscount
    ? txDiscount.type === "percentage"
      ? Math.round((subtotal * txDiscount.value) / 100)
      : Math.min(txDiscount.value, subtotal)
    : 0;
  const discountTotal = Math.min(subtotal, Math.max(0, itemDiscounts + txDiscountAmount));
  const dpp = subtotal - discountTotal;
  const taxTotal = Math.round((dpp * taxRate) / 100);
  const beforePoints = dpp + taxTotal;
  const redeemValue =
    redeemPoints > 0 ? Math.min(redeemPoints * redeemValuePerPoint, beforePoints) : 0;
  const finalTotal = beforePoints - redeemValue;
  return { subtotal, itemDiscounts, txDiscountAmount, discountTotal, dpp, taxTotal, redeemValue, total: finalTotal };
}

export function buildOfflineCheckout(args: BuildOfflineCheckoutArgs): {
  order: OfflineOrder;
  result: CheckoutResult;
} {
  const {
    cart,
    legs,
    customer,
    txDiscount,
    redeemPoints,
    taxRate,
    redeemValuePerPoint,
    storeName,
    storeProfile,
    shiftId,
    operatorName,
  } = args;

  const clientTxId = uuidv4();
  const createdAt = new Date().toISOString();
  const t = computeOfflineTotals(cart, txDiscount, redeemPoints, taxRate, redeemValuePerPoint);

  const nowInv = new Date();
  const invoiceNumber = `OFF-${nowInv.getFullYear()}${String(nowInv.getMonth() + 1).padStart(2, "0")}${String(
    nowInv.getDate()
  ).padStart(2, "0")}-${clientTxId.slice(0, 6).toUpperCase()}`;

  const items: OfflineOrderItem[] = cart.map((i) => ({
    productId: i.productId,
    name: i.name,
    variantId: i.variantId ?? null,
    unit: i.unit ?? undefined,
    unitFactor: i.unitFactor,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    discount: i.discount ?? undefined,
  }));

  const payments: OfflineOrderPayment[] = legs.map((l) => ({
    method: l.method,
    amount: l.amount,
    cashReceived: l.method === "cash" ? l.cashReceived : undefined,
    referenceNumber:
      l.method === "transfer" && l.referenceNumber?.trim()
        ? l.referenceNumber.trim()
        : undefined,
  }));

  const order: OfflineOrder = {
    clientTxId,
    status: "queued",
    createdAt,
    shiftId: shiftId ?? null,
    items,
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    taxTotal: t.taxTotal,
    total: t.total,
    redeemValue: t.redeemValue,
    payments,
    customerId: customer?.id ?? null,
    manualDiscount: txDiscount ?? null,
    redeemPoints: redeemPoints > 0 ? redeemPoints : undefined,
    syncAttempts: 0,
    operatorName,
    storeName,
  };

  // ---------- Struk sementara (struktur menyerupai respons server) ----------
  const txItems: TransactionItem[] = cart.map((i, idx) => {
    const line = i.unitPrice * i.quantity;
    const disc =
      i.discount?.type === "percentage"
        ? Math.round((line * i.discount.value) / 100)
        : Math.min(i.discount?.value ?? 0, line);
    return {
      id: `${clientTxId}-i${idx}`,
      transactionId: clientTxId,
      productId: i.productId,
      variantId: i.variantId ?? null,
      unit: i.unit ?? undefined,
      unitFactor: i.unitFactor,
      productName: i.name,
      productSku: i.sku ?? "",
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      costPrice: 0,
      discountAmount: Math.max(0, disc),
      taxAmount: 0,
      lineTotal: line - Math.max(0, disc),
      returnedQuantity: 0,
    };
  });

  const salePayments: Payment[] = legs.map((l, idx) => ({
    id: `${clientTxId}-p${idx}`,
    transactionId: clientTxId,
    type: "sale",
    method: l.method,
    amount: l.amount,
    cashReceived: l.method === "cash" ? l.cashReceived ?? l.amount : undefined,
    changeAmount:
      l.method === "cash" && l.cashReceived != null
        ? Math.max(0, l.cashReceived - l.amount)
        : undefined,
    referenceNumber: l.referenceNumber,
    status: "paid",
    paidAt: createdAt,
  }));

  const tx: Transaction = {
    id: clientTxId,
    invoiceNumber,
    customerId: customer?.id ?? undefined,
    userId: "",
    status: "completed",
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    taxTotal: t.taxTotal,
    total: t.total,
    discountName: txDiscount?.reason ?? null,
    pointsEarned: 0,
    pointsRedeemed: redeemPoints > 0 ? redeemPoints : 0,
    redeemedPointsValue: t.redeemValue,
    paymentStatus: "paid",
    soldAt: createdAt,
    user: { id: "", name: operatorName },
    customer: customer
      ? { id: customer.id, name: customer.name, phone: customer.phone ?? null }
      : null,
  };

  const result: CheckoutResult = {
    transaction: tx,
    items: txItems,
    payments: salePayments,
    pointsEarned: 0,
    receipt: {
      transaction: tx,
      items: txItems,
      payments: salePayments,
      store: {
        name: storeName || "FakhriPOS",
        address: storeProfile?.address ?? "",
        phone: storeProfile?.phone ?? "",
        footer: storeProfile?.footer ?? "Struk sementara — menunggu sinkronisasi",
      },
    },
  };

  return { order, result };
}
