"use client";

import { todayWIB, uuidv4 } from "@/lib/utils";
import type {
  CartItem,
  CheckoutResult,
  Customer,
  Payment,
  Transaction,
  TransactionItem,
} from "@/lib/types";

/**
 * RC-03 — Mode Latihan: Bangun CheckoutResult palsu (local-only)
 *
 * Saat Mode Latihan aktif, transaksi TIDAK dikirim ke server. Kita membuat
 * objek CheckoutResult lengkap secara lokal (agar layar sukses/struk tetap bisa
 * berfungsi tanpa mengubah data asli), lalu menyimpannya ke localStorage.
 */

interface BuildPracticeCheckoutArgs {
  cart: CartItem[];
  legs: { method: string; amount: number; cashReceived?: number; referenceNumber?: string }[];
  customer: Customer | null;
  storeName: string;
  total: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  operatorName: string;
  manualDiscountName?: string | null;
  redeemPoints?: number;
  taxRate?: number;
}

export function buildPracticeCheckout({
  cart,
  legs,
  customer,
  storeName,
  total,
  subtotal,
  discountTotal,
  taxTotal,
  operatorName,
  manualDiscountName = null,
  redeemPoints = 0,
  taxRate = 0.11,
}: BuildPracticeCheckoutArgs): CheckoutResult {
  const now = new Date().toISOString();
  const txId = uuidv4();
  const invoiceNumber = `LAT-${todayWIB().replace(/-/g, "")}-${String(
    Math.floor(100 + Math.random() * 900)
  )}`;

  const items: TransactionItem[] = cart.map((c) => {
    const lineBefore = c.unitPrice * c.quantity;
    const discountAmount = c.discount
      ? c.discount.type === "percentage"
        ? Math.round((lineBefore * c.discount.value) / 100)
        : Math.min(c.discount.value, lineBefore)
      : 0;
    const taxAmount = c.isTaxable ? Math.round(((lineBefore - discountAmount) * taxRate) / 100) : 0;
    return {
      id: uuidv4(),
      transactionId: txId,
      productId: c.productId ?? null,
      variantId: c.variantId ?? null,
      unit: c.unit,
      unitFactor: c.unitFactor,
      productName: c.name,
      productSku: c.sku ?? "-",
      quantity: c.quantity,
      unitPrice: c.unitPrice,
      costPrice: 0, // Mode latihan: modal tidak dihitung
      discountAmount,
      taxAmount,
      lineTotal: lineBefore - discountAmount + taxAmount,
      returnedQuantity: 0,
    };
  });

  const payments: Payment[] = legs.map((l) => ({
    id: uuidv4(),
    transactionId: txId,
    type: "sale",
    method: l.method as Payment["method"],
    amount: l.amount,
    cashReceived: l.method === "cash" ? l.cashReceived : null,
    changeAmount:
      l.method === "cash" && l.cashReceived != null
        ? Math.max(0, l.cashReceived - l.amount)
        : null,
    referenceNumber: l.referenceNumber ?? null,
    status: "paid",
    paidAt: new Date().toISOString(),
  }));

  const transaction: Transaction = {
    id: txId,
    invoiceNumber,
    outletId: undefined,
    customerId: customer?.id ?? null,
    userId: "practice",
    status: "completed",
    subtotal,
    discountTotal,
    taxTotal,
    total,
    discountName: manualDiscountName,
    pointsEarned: 0,
    pointsRedeemed: redeemPoints ?? 0,
    redeemedPointsValue: 0,
    paymentStatus: "paid",
    notes: "Mode Latihan — tidak disimpan ke database",
    soldAt: now,
    user: { id: "practice", name: operatorName || "Kasir Latihan" },
    customer: customer
      ? { id: customer.id, name: customer.name, phone: customer.phone ?? null }
      : null,
    items,
    payments,
  };

  return {
    transaction,
    items,
    payments,
    pointsEarned: 0,
    receipt: {
      transaction,
      items,
      payments,
      store: { name: storeName || "FakhriPOS", address: "", phone: "", footer: "" },
    },
  };
}
