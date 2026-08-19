/**
 * Checkout & transaksi POS — inti aplikasi (api-design.md §3).
 *
 * Semua operasi mutasi dijalankan dalam SATU transaksi DB (db.transaction):
 *  - POST /transactions          → commitCheckout  (+ idempotensi 5 mnt, retry invoice 1×)
 *  - POST /transactions/preview  → computeTransaction (tanpa commit/stock, tanpa lock)
 *  - cancel/addPayment           → services/transaction.service.ts
 *  - return                      → services/return.service.ts
 *  - receipt                     → services/receipt.ts
 *
 * Server MENGHITUNG ULANG semua angka dari DB — harga klien hanya referensi.
 * Uang = integer rupiah (spec §8.4): diskon & PPN round per baris, poin floor.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db';
import {
  products,
  productVariants,
  productUnits,
  customers,
  memberships,
  transactions,
  transactionItems,
  payments,
  stockMovements,
  warehouseStocks,
  pointMovements,
  discounts,
  taxRates,
  type Discount,
  type Membership,
} from '../db/schema';
import { fail } from '../lib/errors';
import { clientIp } from '../lib/http';
import { formatIdr } from '../lib/http';
import { roundMoney, percentOf, toQty, taxExclusive, taxInclusive, pointsFrom } from '../lib/money';
import { convertToBaseQty, costForUnit } from '../lib/units';
import { getSettings, numSetting } from '../lib/settings';
import { writeAudit } from '../lib/audit';
import { reserveIdempotency, completeIdempotency, clearIdempotency } from '../lib/idempotency';
import { nextInvoiceNumber } from '../lib/sequence';
import { buildReceipt, loadTransactionDetail } from './receipt';
import { getDefaultWarehouseId, applyWarehouseDelta } from '../lib/stock';
import type { AuthUser } from '../middleware/auth';

/* ------------------------------------------------------------------ */
/* Input types (di-share dengan skema validasi route & preview)         */
/* ------------------------------------------------------------------ */
export interface ItemInput {
  productId: string;
  /** Fase 2 (SPEC §4.4): wajib untuk produk ber-varian. */
  variantId?: string | null;
  /** Fase 2: satuan penjualan; kosong/unit dasar → unit dasar. */
  unit?: string;
  quantity: number;
  discount?: { type: 'percentage' | 'fixed'; value: number; reason?: string };
}
export interface ManualDiscountInput {
  type: 'percentage' | 'fixed';
  value: number;
  reason?: string;
}
export interface PaymentInput {
  method: 'cash' | 'qris' | 'transfer';
  amount: number;
  cashReceived?: number;
  referenceNumber?: string;
}
export interface CheckoutInput {
  customerId?: string;
  items: ItemInput[];
  manualDiscount?: ManualDiscountInput;
  discountCode?: string;
  redeemPoints?: number;
  payments: PaymentInput[];
  notes?: string;
}

interface ComputedLine {
  productId: string | null;
  variantId: string | null;
  productName: string;
  productSku: string;
  categoryId: string;
  quantity: number; // qty dalam satuan PENJUALAN (unit)
  unit: string; // snapshot satuan penjualan
  unitFactor: number; // snapshot faktor konversi ke unit dasar
  unitPrice: number;
  costPrice: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
  availableStock: number;
  isTaxable: boolean;
  trackStock: boolean;
}
interface ComputedStockMove {
  productId: string;
  productVariantId: string | null;
  quantity: number; // dalam unit dasar
  beforeQty: number;
  afterQty: number;
  type: 'sale_out';
}
interface ComputedPayment {
  method: PaymentInput['method'];
  amount: number;
  cashReceived: number | null;
  changeAmount: number | null;
  referenceNumber: string | null;
  status: 'paid';
}
export interface ComputedTransaction {
  customerId: string | null;
  lines: ComputedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  redeemedPointsValue: number;
  total: number;
  pointsEarned: number;
  pointsRedeemed: number;
  discountId: string | null;
  discountName: string | null;
  membership: Membership | null;
  stockMovements: ComputedStockMove[];
  payments: ComputedPayment[];
}

/* ------------------------------------------------------------------ */
/* Validasi kode promo                                                  */
/* ------------------------------------------------------------------ */
export async function validateDiscountCode(dbOrTx: DbOrTx, code: string): Promise<Discount> {
  const [d] = await dbOrTx
    .select()
    .from(discounts)
    .where(and(eq(discounts.code, code), isNull(discounts.deletedAt)))
    .limit(1);
  if (!d || !d.isActive) fail('DISCOUNT_INVALID', `Kode promo '${code}' tidak ditemukan atau nonaktif`, 422);
  const now = new Date();
  if (d.validFrom && d.validFrom > now) fail('DISCOUNT_INVALID', 'Kode promo belum berlaku', 422);
  if (d.validTo && d.validTo < now) fail('DISCOUNT_INVALID', 'Kode promo sudah kedaluwarsa', 422);
  if (d.usageLimit != null && Number(d.usedCount ?? 0) >= Number(d.usageLimit))
    fail('DISCOUNT_INVALID', 'Kuota pemakaian kode promo sudah habis', 422);
  return d;
}

function promoBase(promo: Discount, lines: ComputedLine[], afterLineDisc: number, manualAmount: number): number {
  if (promo.scope === 'global') return afterLineDisc - manualAmount;
  if (promo.scope === 'category' && promo.categoryId)
    return lines.filter((l) => l.categoryId === promo.categoryId).reduce((a, l) => a + (l.unitPrice * l.quantity - l.discountAmount), 0);
  if (promo.scope === 'product' && promo.productId)
    return lines.filter((l) => l.productId === promo.productId).reduce((a, l) => a + (l.unitPrice * l.quantity - l.discountAmount), 0);
  return afterLineDisc - manualAmount;
}

/* ------------------------------------------------------------------ */
/* Compute (dipakai preview & commit). forUpdate=true → lock stok.      */
/* ------------------------------------------------------------------ */
export async function computeTransaction(
  dbOrTx: DbOrTx,
  input: CheckoutInput,
  opts: { forUpdate: boolean; validatePayments?: boolean },
): Promise<ComputedTransaction> {
  if (!input.items || input.items.length === 0)
    fail('VALIDATION_ERROR', 'Keranjang kosong — minimal 1 item', 422, [{ field: 'items', message: 'Minimal 1 item' }]);

  const ids = [...new Set(input.items.map((i) => i.productId))];
  const baseQuery = dbOrTx.select().from(products).where(and(inArray(products.id, ids), isNull(products.deletedAt)));
  // `for('update')` mengembalikan tipe builder berbeda — cast agar tipe baris produk tetap terjaga
  const query = opts.forUpdate ? (baseQuery.for('update') as typeof baseQuery) : baseQuery;
  const prodRows = await query.orderBy(products.id);
  const prodMap = new Map(prodRows.map((p) => [p.id, p]));

  // Fase 2 (SPEC §4.4): resolusi varian & satuan — load sekali per request
  const variantIds = [...new Set(input.items.map((i) => i.variantId).filter((v): v is string => !!v))];
  let variantRows: (typeof productVariants.$inferSelect)[] = [];
  if (variantIds.length > 0) {
    const vBase = dbOrTx
      .select()
      .from(productVariants)
      .where(and(inArray(productVariants.id, variantIds), isNull(productVariants.deletedAt)));
    const vQuery = opts.forUpdate ? (vBase.for('update') as typeof vBase) : vBase;
    variantRows = await vQuery.orderBy(productVariants.id);
  }
  const variantMap = new Map(variantRows.map((v) => [v.id, v]));
  const unitRows = await dbOrTx.select().from(productUnits).where(inArray(productUnits.productId, ids));
  const unitMap = new Map<string, (typeof productUnits.$inferSelect)>();
  for (const u of unitRows) unitMap.set(`${u.productId}:${u.unit.toLowerCase()}`, u);

  // Fase 3 (SPEC §5.1): stok operasional = stok gudang DEFAULT (bukan total
  // semua gudang). Cek stok & before/after memakai warehouse_stocks gudang
  // default; baris tidak ada = stok 0 (invariant §3.4.1: baris dibuat saat
  // stok pertama masuk). Lock FOR UPDATE saat commit (anti oversell R13).
  const defaultWhId = await getDefaultWarehouseId(dbOrTx);
  let whStockRows: (typeof warehouseStocks.$inferSelect)[] = [];
  if (ids.length > 0) {
    const whBase = dbOrTx
      .select()
      .from(warehouseStocks)
      .where(and(eq(warehouseStocks.warehouseId, defaultWhId), inArray(warehouseStocks.productId, ids)));
    const whQuery = opts.forUpdate ? (whBase.for('update') as typeof whBase) : whBase;
    whStockRows = await whQuery;
  }
  const whStockMap = new Map<string, number>();
  for (const r of whStockRows) whStockMap.set(`${r.productId}:${r.productVariantId ?? ''}`, Number(r.quantity));

  const s = await getSettings();
  const maxManualPct = numSetting(s, 'discount.manual_max_percent', 20);
  const maxManualAmt = numSetting(s, 'discount.manual_max_amount', 50000);

  const lines: ComputedLine[] = [];
  let subtotal = 0;
  const stockIssues: {
    productId: string;
    variantId: string | null;
    unit: string;
    available: number; // unit dasar (SPEC §7.4.2)
    requested: number; // unit dasar
    availableInUnit: number; // floor, satuan pilihan
    requestedInUnit: number; // qty satuan pilihan
    warehouseId: string; // F3: gudang default (SPEC §4.7)
  }[] = [];

  for (let itemIdx = 0; itemIdx < input.items.length; itemIdx++) {
    const item = input.items[itemIdx]!;
    const p = prodMap.get(item.productId);
    if (!p) fail('NOT_FOUND', `Produk tidak ditemukan (${item.productId})`, 404);
    if (!p.isActive) fail('PRODUCT_INACTIVE', `Produk '${p.name}' sedang nonaktif`, 422);
    const qty = toQty(item.quantity);
    if (qty <= 0) fail('VALIDATION_ERROR', `Qty '${p.name}' harus lebih dari 0 (presisi 0.001)`, 422, { field: `items[${itemIdx}].quantity` });

    // 1) Resolusi varian (SPEC §4.4 urutan evaluasi)
    let variant: (typeof productVariants.$inferSelect) | null = null;
    let stockBase: number;
    if (item.variantId) {
      variant = variantMap.get(item.variantId) ?? null;
      if (!variant || variant.productId !== p.id) fail('VARIANT_NOT_FOUND', 'Varian tidak ditemukan untuk produk ini', 422, { field: `items[${itemIdx}].variantId` });
      if (!variant.isActive) fail('VALIDATION_ERROR', `Varian '${variant.name}' sedang nonaktif`, 422);
      stockBase = whStockMap.get(`${p.id}:${variant.id}`) ?? 0; // F3: stok gudang default
    } else {
      if (p.hasVariants) {
        fail('VALIDATION_ERROR', `Produk '${p.name}' ber-varian — wajib pilih varian`, 422, { field: `items[${itemIdx}].variantId` });
      }
      stockBase = whStockMap.get(`${p.id}:`) ?? 0; // F3: stok gudang default
    }

    // 2) Resolusi satuan (SPEC §4.4.2)
    const baseUnit = p.unit;
    let unit = (item.unit ?? '').trim() || baseUnit;
    let unitFactor = 1;
    let unitPrice = variant ? Number(variant.sellingPrice) : Number(p.sellingPrice);
    const costBase = variant ? Number(variant.costPrice) : Number(p.costPrice);
    if (unit.toLowerCase() !== baseUnit.toLowerCase()) {
      const pu = unitMap.get(`${p.id}:${unit.toLowerCase()}`);
      if (!pu) fail('UNIT_NOT_FOUND', `Satuan '${unit}' tidak terdaftar untuk produk '${p.name}'`, 422, { field: `items[${itemIdx}].unit` });
      if (!pu.isSellable) fail('UNIT_NOT_SELLABLE', `Satuan '${unit}' tidak boleh dijual`, 422, { field: `items[${itemIdx}].unit` });
      unit = pu.unit; // normalisasi huruf dari DB
      unitFactor = Number(pu.factor);
      unitPrice = Number(pu.sellPrice); // server SELALU hitung ulang dari DB (§5.2)
    }

    // 3) Hitung konversi & snapshot harga
    const qtyStock = convertToBaseQty(qty, unitFactor); // round3(qty × factor)
    const costPrice = costForUnit(costBase, unitFactor);

    // 4) Cek stok (kecuali track_stock=false — produk jasa, AC-04.1)
    if (p.trackStock && qtyStock > stockBase) {
      stockIssues.push({
        productId: p.id,
        variantId: variant?.id ?? null,
        unit,
        available: stockBase,
        requested: qtyStock,
        availableInUnit: Math.floor(stockBase / unitFactor),
        requestedInUnit: qty,
        warehouseId: defaultWhId, // F3 (SPEC §4.7): details menyertakan gudang
      });
    }

    const lineSubtotal = roundMoney(unitPrice * qty);
    let dAmount = 0;
    if (item.discount) {
      if (item.discount.type === 'percentage') {
        if (item.discount.value > maxManualPct) fail('DISCOUNT_CAP_EXCEEDED', `Diskon item melebihi cap ${maxManualPct}%`, 422);
        dAmount = Math.min(percentOf(lineSubtotal, item.discount.value), lineSubtotal);
      } else {
        if (item.discount.value > maxManualAmt) fail('DISCOUNT_CAP_EXCEEDED', `Diskon item melebihi cap ${formatIdr(maxManualAmt)}`, 422);
        dAmount = Math.min(Math.round(item.discount.value), lineSubtotal);
      }
    }
    subtotal += lineSubtotal;
    lines.push({
      productId: p.id,
      variantId: variant?.id ?? null,
      productName: variant ? `${p.name} — ${variant.name}` : p.name,
      productSku: variant?.sku ?? p.sku ?? '',
      categoryId: p.categoryId,
      quantity: qty,
      unit,
      unitFactor,
      unitPrice,
      costPrice,
      discountAmount: dAmount,
      taxAmount: 0,
      lineTotal: 0,
      availableStock: p.trackStock ? Math.floor(stockBase / unitFactor) : Number(p.stockOnHand),
      isTaxable: p.isTaxable,
      trackStock: p.trackStock,
    });
  }
  if (stockIssues.length > 0) {
    const first = stockIssues[0]!;
    const firstName = first.variantId ? variantMap.get(first.variantId)?.name : prodMap.get(first.productId)?.name;
    fail(
      'STOCK_INSUFFICIENT',
      `Stok '${firstName}' tidak cukup (tersisa ${first.available} ${first.unit === 'pcs' ? 'pcs' : first.unit}, diminta ${first.requested} ${first.unit === 'pcs' ? 'pcs' : first.unit})`,
      409,
      stockIssues,
    );
  }

  // Diskon transaksi manual (setelah diskon item)
  const afterLineDisc = lines.reduce((a, l) => a + (l.unitPrice * l.quantity - l.discountAmount), 0);
  let manualAmount = 0;
  let manualName: string | null = null;
  if (input.manualDiscount) {
    if (input.manualDiscount.type === 'percentage') {
      if (input.manualDiscount.value > maxManualPct) fail('DISCOUNT_CAP_EXCEEDED', `Diskon manual melebihi cap ${maxManualPct}%`, 422);
      manualAmount = Math.min(percentOf(afterLineDisc, input.manualDiscount.value), afterLineDisc);
      manualName = `Diskon manual ${input.manualDiscount.value}%`;
    } else {
      if (input.manualDiscount.value > maxManualAmt) fail('DISCOUNT_CAP_EXCEEDED', `Diskon manual melebihi cap ${formatIdr(maxManualAmt)}`, 422);
      manualAmount = Math.min(Math.round(input.manualDiscount.value), afterLineDisc);
      manualName = `Diskon manual ${formatIdr(manualAmount)}`;
    }
  }

  // Kode promo terstruktur
  let discountId: string | null = null;
  let promoName: string | null = null;
  let promoAmount = 0;
  let txPromo: Discount | null = null; // referensi promo untuk alokasi DPP pajak
  if (input.discountCode) {
    const promo = await validateDiscountCode(dbOrTx, input.discountCode);
    discountId = promo.id;
    promoName = promo.name;
    txPromo = promo;
    const base = promoBase(promo, lines, afterLineDisc, manualAmount);
    promoAmount =
      promo.type === 'percentage'
        ? Math.min(percentOf(base, Number(promo.value)), promo.maxDiscountAmount != null ? Number(promo.maxDiscountAmount) : base)
        : Math.min(Math.round(Number(promo.value)), base);
  }

  const lineDiscountTotal = lines.reduce((a, l) => a + l.discountAmount, 0);
  const discountTotal = lineDiscountTotal + manualAmount + promoAmount;

  // Pajak (PPN SETELAH diskon — features.md §4.6): DPP per baris = subtotal baris −
  // diskon baris − alokasi diskon transaksi (manual + promo, proporsional subtotal baris).
  // Alokasi dibuat eksak (sisa rupiah di baris terakhir) agar ΣDPP = subtotal − discountTotal.
  const [taxRow] = await dbOrTx
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.isDefault, true), eq(taxRates.isActive, true)))
    .limit(1);
  const rate = Number(taxRow?.rate ?? 0);
  const inclusive = taxRow?.isInclusive ?? false;

  const txDiscAlloc = new Map<string, number>();
  if (manualAmount + promoAmount > 0) {
    const totalSub = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
    const allocAcross = (amount: number, targets: ComputedLine[]): void => {
      if (amount <= 0 || targets.length === 0) return;
      const scopeSub = targets.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
      if (scopeSub <= 0) return;
      let remaining = amount;
      targets.forEach((l, idx) => {
        const share = Math.round((amount * (l.unitPrice * l.quantity)) / scopeSub);
        const alloc = idx === targets.length - 1 ? remaining : Math.min(share, remaining);
        txDiscAlloc.set(l.productId!, (txDiscAlloc.get(l.productId!) ?? 0) + alloc);
        remaining -= alloc;
      });
    };
    if (totalSub > 0) {
      allocAcross(manualAmount, lines); // diskon manual: seluruh baris
      if (promoAmount > 0 && txPromo) {
        const scopeLines = lines.filter(
          (l) =>
            txPromo!.scope === 'global' ||
            (txPromo!.scope === 'category' && txPromo!.categoryId != null && l.categoryId === txPromo!.categoryId) ||
            (txPromo!.scope === 'product' && txPromo!.productId != null && l.productId === txPromo!.productId),
        );
        allocAcross(promoAmount, scopeLines);
      }
    }
  }

  let taxTotal = 0;
  for (const l of lines) {
    if (!l.isTaxable || rate <= 0) continue;
    const dpp = Math.max(0, l.unitPrice * l.quantity - l.discountAmount - (txDiscAlloc.get(l.productId!) ?? 0));
    const tax = inclusive ? taxInclusive(dpp, rate) : taxExclusive(dpp, rate);
    l.taxAmount = tax;
    taxTotal += tax;
  }

  // Poin member
  let membership: Membership | null = null;
  let redeemedPointsValue = 0;
  let pointsRedeemed = 0;
  if (input.customerId) {
    const [cust] = await dbOrTx
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), isNull(customers.deletedAt)))
      .limit(1);
    if (!cust) fail('NOT_FOUND', 'Pelanggan tidak ditemukan', 404);
    const [m] = await dbOrTx.select().from(memberships).where(eq(memberships.customerId, cust.id)).limit(1);
    membership = m ?? null;

    if (input.redeemPoints && membership) {
      if (input.redeemPoints > Number(membership.pointsBalance))
        fail('INSUFFICIENT_POINTS', `Saldo poin tidak cukup (tersisa ${membership.pointsBalance})`, 422);
      const baseTotal = subtotal - discountTotal + taxTotal;
      const valPerPoint = numSetting(s, 'points.redeem_value', 10);
      const value = Math.min(Math.floor(input.redeemPoints * valPerPoint), baseTotal);
      pointsRedeemed = Math.floor(value / valPerPoint);
      redeemedPointsValue = pointsRedeemed * valPerPoint;
    }
  }

  const total = subtotal - discountTotal + taxTotal - redeemedPointsValue;
  if (total < 0) fail('VALIDATION_ERROR', 'Total transaksi tidak boleh negatif', 422);

  const earnPerIdr = numSetting(s, 'points.earn_per_idr', 1000);
  const pointsEarned = membership ? pointsFrom(total, earnPerIdr) : 0;

  for (const l of lines) l.lineTotal = l.unitPrice * l.quantity - l.discountAmount + l.taxAmount;

  // Movement stok: TIDAK ada untuk produk jasa (track_stock=false, AC-04.1);
  // quantity dalam UNIT DASAR = qty penjualan × unit_factor (SPEC §3.3, §5.1)
  const computedStockMovements: ComputedStockMove[] = [];
  for (const l of lines) {
    if (!l.trackStock) continue;
    const before = l.variantId ? Number(variantMap.get(l.variantId)!.stockOnHand) : Number(prodMap.get(l.productId!)!.stockOnHand);
    const qtyStock = convertToBaseQty(l.quantity, l.unitFactor);
    computedStockMovements.push({
      productId: l.productId!,
      productVariantId: l.variantId,
      quantity: qtyStock,
      beforeQty: before,
      afterQty: toQty(before - qtyStock),
      type: 'sale_out',
    });
  }

  const payments2 = opts.validatePayments === false ? [] : processPayments(input.payments, total);

  return {
    customerId: input.customerId ?? null,
    lines,
    subtotal,
    discountTotal,
    taxTotal,
    redeemedPointsValue,
    total,
    pointsEarned,
    pointsRedeemed,
    discountId,
    discountName: manualName ?? promoName,
    membership,
    stockMovements: computedStockMovements,
    payments: payments2,
  };
}

/**
 * Pisah pembayaran (split payment, US-03 / SPEC §4.5): mengalokasikan total
 * transaksi ke 1+ metode (cash/qris/transfer) hingga jumlah persis total.
 * Dipanggil saat checkout (computeTransaction) dan diuji isolasi di unit test.
 * Cash menghitung kembalian; nominal melebihi sisa → PAYMENT_MISMATCH.
 */
export function processPayments(raw: PaymentInput[], total: number): ComputedPayment[] {
  if (!raw || raw.length === 0) fail('PAYMENT_MISMATCH', 'Minimal 1 metode pembayaran', 422, { total });
  let remaining = total;
  const out: ComputedPayment[] = [];
  for (const p of raw) {
    if (p.amount <= 0) fail('VALIDATION_ERROR', 'Nominal pembayaran harus > 0', 422);
    if (p.method === 'cash') {
      const cashReceived = p.cashReceived ?? p.amount;
      if (cashReceived < p.amount) fail('PAYMENT_MISMATCH', 'Uang tunai kurang dari nominal pembayaran', 422);
      const applied = Math.min(p.amount, remaining);
      if (applied <= 0) fail('PAYMENT_MISMATCH', 'Nominal pembayaran melebihi total transaksi', 422);
      remaining -= applied;
      out.push({
        method: 'cash',
        amount: applied,
        cashReceived,
        changeAmount: cashReceived - applied,
        referenceNumber: p.referenceNumber ?? null,
        status: 'paid',
      });
    } else {
      const applied = Math.min(p.amount, remaining);
      if (applied <= 0) fail('PAYMENT_MISMATCH', 'Nominal pembayaran melebihi total transaksi', 422);
      remaining -= applied;
      out.push({
        method: p.method,
        amount: applied,
        cashReceived: null,
        changeAmount: null,
        referenceNumber: p.referenceNumber ?? null,
        status: 'paid',
      });
    }
  }
  if (remaining !== 0)
    fail('PAYMENT_MISMATCH', 'Jumlah pembayaran tidak sama dengan total transaksi', 422, {
      total,
      paid: total - remaining,
    });
  return out;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

/* ------------------------------------------------------------------ */
/* Commit checkout — SATU transaksi DB + idempotensi + retry invoice    */
/* ------------------------------------------------------------------ */
export async function commitCheckout(
  input: CheckoutInput,
  user: AuthUser,
  idempotencyKey: string,
  ip: string | null,
  ua: string | null,
  source: 'online' | 'offline' = 'online',
): Promise<{ replay: boolean; transaction: any; items: any[]; payments: any[]; receipt: any; pointsEarned: number }> {
  const reserve = reserveIdempotency(idempotencyKey);
  if (reserve.status === 'processing') fail('REQUEST_IN_PROGRESS', 'Transaksi sedang diproses — tunggu sebentar', 409);
  if (reserve.status === 'replay') {
    const detail = await loadTransactionDetail(db, reserve.transactionId);
    if (detail && detail.transaction) {
      const receipt = await buildReceipt(db, detail.transaction.id);
      return {
        replay: true,
        transaction: detail.transaction,
        items: detail.items,
        payments: detail.payments,
        receipt,
        pointsEarned: Number(detail.transaction.pointsEarned ?? 0),
      };
    }
    clearIdempotency(idempotencyKey); // transaksi asli tak ditemukan → proses ulang
  }

  try {
    let result!: {
      transaction: typeof transactions.$inferSelect;
      items: (typeof transactionItems.$inferSelect)[];
      payments: (typeof payments.$inferSelect)[];
      computed: ComputedTransaction;
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await db.transaction(async (tx) => {
          const computed = await computeTransaction(tx, input, { forUpdate: true });
          const invoiceNumber = await nextInvoiceNumber(tx);
          const [trx] = await tx
            .insert(transactions)
            .values({
              invoiceNumber,
              outletId: user.outletId,
              customerId: computed.customerId,
              userId: user.id,
              status: 'completed',
              subtotal: computed.subtotal,
              discountTotal: computed.discountTotal,
              taxTotal: computed.taxTotal,
              total: computed.total,
              discountId: computed.discountId,
              discountName: computed.discountName,
              pointsEarned: computed.pointsEarned,
              pointsRedeemed: computed.pointsRedeemed,
              redeemedPointsValue: computed.redeemedPointsValue,
              paymentStatus: 'paid',
              source,
              notes: input.notes ?? null,
              soldAt: new Date(),
            })
            .returning();

          const items = await tx
            .insert(transactionItems)
            .values(
              computed.lines.map((l) => ({
                transactionId: trx.id,
                productId: l.productId,
                productVariantId: l.variantId,
                unit: l.unit,
                unitFactor: l.unitFactor,
                productName: l.productName,
                productSku: l.productSku,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                costPrice: l.costPrice,
                discountAmount: l.discountAmount,
                taxAmount: l.taxAmount,
                lineTotal: l.lineTotal,
              })),
            )
            .returning();

          const pays = await tx
            .insert(payments)
            .values(
              computed.payments.map((p) => ({
                transactionId: trx.id,
                outletId: user.outletId,
                type: 'sale' as const,
                method: p.method,
                amount: p.amount,
                cashReceived: p.cashReceived,
                changeAmount: p.changeAmount,
                referenceNumber: p.referenceNumber,
                status: p.status,
                createdBy: user.id,
              })),
            )
            .returning();

          // Stock: update denormalisasi + ledger, dalam transaksi yang sama.
          // Varian → product_variants; non-varian → products (stok sudah di-lock
          // & divalidasi di computeTransaction terhadap GUDANG DEFAULT — F3 §5.1).
          const defaultWhId = await getDefaultWarehouseId(tx);
          for (const sm of computed.stockMovements) {
            // stok_on_hand produk/varian (level produk — invariant Σ gudang)
            if (sm.productVariantId) {
              await tx.update(productVariants).set({ stockOnHand: sm.afterQty }).where(eq(productVariants.id, sm.productVariantId));
            } else {
              await tx.update(products).set({ stockOnHand: sm.afterQty }).where(eq(products.id, sm.productId));
            }
            // stok gudang default ATOMIK + ledger level gudang (kartu stok AC-05.2)
            const wh = await applyWarehouseDelta(tx, defaultWhId, sm.productId, sm.productVariantId, -sm.quantity);
            await tx.insert(stockMovements).values({
              warehouseId: defaultWhId,
              productId: sm.productId,
              productVariantId: sm.productVariantId,
              type: sm.type,
              quantity: sm.quantity,
              beforeQty: wh.before,
              afterQty: wh.after,
              transactionId: trx.id,
              createdBy: user.id,
            });
          }

          if (computed.discountId) {
            await tx
              .update(discounts)
              .set({ usedCount: sql`${discounts.usedCount} + 1` })
              .where(eq(discounts.id, computed.discountId));
          }

          // Poin member: earn & redeem (update balance + movement)
          if (computed.membership) {
            const [m] = await tx
              .select()
              .from(memberships)
              .where(eq(memberships.id, computed.membership.id))
              .for('update')
              .limit(1);
            if (m) {
              let bal = Number(m.pointsBalance);
              if (computed.pointsEarned > 0) {
                bal += computed.pointsEarned;
                await tx
                  .update(memberships)
                  .set({ pointsBalance: bal, pointsEarnedTotal: sql`${memberships.pointsEarnedTotal} + ${computed.pointsEarned}` })
                  .where(eq(memberships.id, m.id));
                await tx.insert(pointMovements).values({
                  membershipId: m.id,
                  transactionId: trx.id,
                  type: 'earned',
                  points: computed.pointsEarned,
                  balanceAfter: bal,
                  createdBy: user.id,
                });
              }
              if (computed.pointsRedeemed > 0) {
                bal -= computed.pointsRedeemed;
                await tx
                  .update(memberships)
                  .set({ pointsBalance: bal, pointsRedeemedTotal: sql`${memberships.pointsRedeemedTotal} + ${computed.pointsRedeemed}` })
                  .where(eq(memberships.id, m.id));
                await tx.insert(pointMovements).values({
                  membershipId: m.id,
                  transactionId: trx.id,
                  type: 'redeemed',
                  points: computed.pointsRedeemed,
                  balanceAfter: bal,
                  createdBy: user.id,
                });
              }
            }
          }

          await writeAudit(tx, {
            userId: user.id,
            action: 'transaction.checkout',
            entityType: 'transaction',
            entityId: trx.id,
            newValues: {
              total: computed.total,
              subtotal: computed.subtotal,
              discountTotal: computed.discountTotal,
              taxTotal: computed.taxTotal,
              pointsEarned: computed.pointsEarned,
              itemCount: items.length,
              paymentMethods: pays.map((p) => p.method),
              discounts: computed.discountName ? [computed.discountName] : [],
            },
            ipAddress: ip,
            userAgent: ua,
          });

          return { transaction: trx, items, payments: pays, computed };
        });
        break; // sukses
      } catch (e) {
        if (isUniqueViolation(e) && attempt === 0) continue; // tabrakan nomor invoice → retry
        throw e;
      }
    }

    completeIdempotency(idempotencyKey, result.transaction.id);
    const receipt = await buildReceipt(db, result.transaction.id);
    return {
      replay: false,
      transaction: result.transaction,
      items: result.items,
      payments: result.payments,
      receipt,
      pointsEarned: result.computed.pointsEarned,
    };
  } catch (e) {
    clearIdempotency(idempotencyKey);
    throw e;
  }
}
