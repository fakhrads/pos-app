"use client";

import { useEffect, useState } from "react";
import {
  BadgePercent,
  Loader2,
  Minus,
  ParkingCircle,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CustomerPicker } from "@/components/customer-picker";
import { api, ApiError } from "@/lib/api";
import { cn, formatIDR, formatNumber } from "@/lib/utils";
import type {
  CartDiscount,
  CartItem,
  Customer,
  DiscountType,
  PreviewResult,
  ProductDetail,
} from "@/lib/types";
import { cartTotalQty, lineKey, unitLabel } from "./cart-utils";

/** Kunci baris keranjang (produk + varian + satuan) */
export interface ItemKey {
  productId: string;
  variantId?: string | null;
  unit?: string;
}

export interface CartSummary {
  subtotal: number;
  itemDiscounts: number;
  txDiscountAmount: number;
  discountTotal: number;
  dpp: number;
  tax: number;
  total: number;
  redeemValue: number;
}

interface CartSheetProps {
  /** open sheet mobile */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartItem[];
  customer: Customer | null;
  onCustomerChange: (c: Customer | null) => void;
  txDiscount: CartDiscount | null;
  onTxDiscountChange: (d: CartDiscount | null) => void;
  redeemPoints: number;
  onRedeemPointsChange: (n: number) => void;
  maxRedeemPoints: number;
  summary: CartSummary;
  taxLabel: string;
  /** harga server (preview) berbeda dari estimasi lokal → badge "harga berubah" */
  priceChanged: boolean;
  canCheckout: boolean;
  checkoutBlockReason?: string | null;
  submitting: boolean;
  holding: boolean;
  holdCount: number;
  onSetQty: (key: ItemKey, quantity: number) => void;
  onRemoveItem: (key: ItemKey) => void;
  onSetItemDiscount: (key: ItemKey, discount: CartDiscount | null) => void;
  onUpdateItem: (key: ItemKey, patch: Partial<CartItem> & { name?: string }) => void;
  onClearCart: () => void;
  onPay: () => void;
  onHold: () => void;
  onOpenHolds: () => void;
}

export function CartSheet(props: CartSheetProps) {
  const { cart, open, onOpenChange } = props;
  const [detailKey, setDetailKey] = useState<ItemKey | null>(null);

  const detailItem = detailKey
    ? (cart.find((i) => lineKey(i) === lineKey(detailKey)) ?? null)
    : null;

  const qty = cartTotalQty(cart);

  return (
    <>
      {/* ===== Desktop: panel samping ===== */}
      <div className="hidden w-[400px] shrink-0 flex-col overflow-hidden rounded-lg border bg-card lg:flex">
        <CartContent {...props} onOpenDetail={setDetailKey} />
      </div>

      {/* ===== Mobile: FAB + bottom sheet ===== */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 lg:hidden">
        {props.holdCount > 0 && (
          <Button
            size="icon"
            variant="secondary"
            className="relative size-12 rounded-full shadow-md"
            onClick={props.onOpenHolds}
            title={`${props.holdCount} transaksi ditahan`}
          >
            <ParkingCircle className="size-5" />
            <Badge className="absolute -right-1 -top-1 size-5 justify-center rounded-full p-0 text-[10px]">
              {props.holdCount}
            </Badge>
          </Button>
        )}
        <Button
          size="icon"
          className="relative size-14 rounded-full shadow-lg"
          onClick={() => onOpenChange(true)}
          disabled={cart.length === 0}
          title="Buka keranjang"
        >
          <ShoppingCart className="size-6" />
          {qty > 0 && (
            <Badge className="absolute -right-1 -top-1 size-6 justify-center rounded-full p-0 text-xs">
              {qty}
            </Badge>
          )}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85vh] gap-0 rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <ShoppingCart className="size-4" />
              Keranjang
              {cart.length > 0 && <Badge variant="secondary">{qty}</Badge>}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CartContent {...props} onOpenDetail={setDetailKey} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Dialog detail item (AC-02.7) */}
      <ItemDetailDialog
        item={detailItem}
        onClose={() => setDetailKey(null)}
        onSetQty={props.onSetQty}
        onRemove={props.onRemoveItem}
        onSetItemDiscount={props.onSetItemDiscount}
        onUpdateItem={props.onUpdateItem}
      />
    </>
  );
}

/* ================= Isi keranjang (dipakai panel desktop & sheet mobile) ================= */

function CartContent({
  cart,
  customer,
  onCustomerChange,
  txDiscount,
  onTxDiscountChange,
  redeemPoints,
  onRedeemPointsChange,
  maxRedeemPoints,
  summary,
  taxLabel,
  priceChanged,
  canCheckout,
  checkoutBlockReason,
  submitting,
  holding,
  holdCount,
  onSetQty,
  onRemoveItem,
  onClearCart,
  onPay,
  onHold,
  onOpenHolds,
  onOpenDetail,
}: CartSheetProps & { onOpenDetail: (key: ItemKey) => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShoppingCart className="size-4" />
          Keranjang
          {cart.length > 0 && <Badge variant="secondary">{cartTotalQty(cart)}</Badge>}
        </h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="relative h-11"
            onClick={onOpenHolds}
            title="Transaksi ditahan"
          >
            <ParkingCircle className="size-4" />
            <span className="hidden sm:inline">Ditahan</span>
            {holdCount > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">
                {holdCount}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11"
            onClick={onHold}
            disabled={cart.length === 0 || holding}
            title="Tahan transaksi (parkir)"
          >
            {holding ? <Loader2 className="size-4 animate-spin" /> : <ParkingCircle className="size-4" />}
            <span className="hidden sm:inline">Tahan</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-11 text-destructive"
            onClick={onClearCart}
            disabled={cart.length === 0}
            title="Kosongkan keranjang"
          >
            <Trash2 className="size-4" />
            <span className="hidden sm:inline">Kosongkan</span>
          </Button>
        </div>
      </div>

      {/* List item */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <ShoppingCart className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Keranjang kosong. Pilih produk dari katalog atau scan barcode.
            </p>
          </div>
        ) : (
          cart.map((item) => {
            const key: ItemKey = {
              productId: item.productId,
              variantId: item.variantId,
              unit: item.unit,
            };
            return (
              <div
                key={lineKey(item)}
                className="rounded-lg border p-2.5"
                onClick={() => onOpenDetail(key)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatIDR(item.unitPrice)} / {unitLabel(item)}
                      {item.discount && (
                        <span className="ml-1 text-emerald-600">
                          · diskon{" "}
                          {item.discount.type === "percentage"
                            ? `${item.discount.value}%`
                            : formatIDR(item.discount.value)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDetail(key);
                      }}
                      title="Diskon item"
                    >
                      <BadgePercent className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(key);
                      }}
                      title="Hapus item"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-11"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetQty(key, item.quantity - 1);
                      }}
                      disabled={item.quantity <= 1}
                      title="Kurangi qty"
                    >
                      <Minus className="size-4" />
                    </Button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDetail(key);
                      }}
                      className="h-11 w-14 rounded-md border bg-background text-center text-sm font-semibold tabular-nums"
                      title="Ubah qty"
                    >
                      {formatNumber(item.quantity)}
                    </button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-11"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetQty(key, item.quantity + 1);
                      }}
                      disabled={item.stockOnHand > 0 && item.quantity >= item.stockOnHand}
                      title="Tambah qty"
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatIDR(item.unitPrice * item.quantity)}
                  </p>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Sisa stok: {formatNumber(item.stockOnHand)} {item.unit || "pcs"}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="space-y-3 border-t p-3">
        <CustomerPicker value={customer} onChange={onCustomerChange} />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Diskon transaksi</Label>
            <Button
              variant="outline"
              size="sm"
              className="mt-1 h-11 w-full justify-start font-normal"
              onClick={() =>
                onTxDiscountChange(txDiscount ? null : { type: "percentage", value: 10 })
              }
            >
              {txDiscount ? (
                <span className="text-emerald-600">
                  {txDiscount.type === "percentage"
                    ? `${txDiscount.value}%`
                    : formatIDR(txDiscount.value)}{" "}
                  <X className="ml-1 inline size-3" />
                </span>
              ) : (
                "Tambah diskon"
              )}
            </Button>
          </div>
          <div>
            <Label className="text-xs">Redeem poin</Label>
            <Input
              className="mt-1 h-11"
              type="number"
              min={0}
              max={maxRedeemPoints}
              placeholder={customer ? `Poin: ${formatNumber(maxRedeemPoints)}` : "Pilih pelanggan dulu"}
              value={redeemPoints || ""}
              disabled={!customer?.membership}
              onChange={(e) => {
                const v = Number(e.target.value);
                onRedeemPointsChange(Math.min(Math.max(0, Math.floor(v)), maxRedeemPoints));
              }}
            />
          </div>
        </div>

        {/* Ringkasan live (AC-02.5) */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatIDR(summary.subtotal)}</span>
          </div>
          {summary.discountTotal > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Diskon</span>
              <span className="tabular-nums">-{formatIDR(summary.discountTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-muted-foreground">
            <span>{taxLabel}</span>
            <span className="tabular-nums">{formatIDR(summary.tax)}</span>
          </div>
          {summary.redeemValue > 0 && (
            <div className="flex justify-between text-amber-600">
              <span>Poin ({formatNumber(redeemPoints)})</span>
              <span className="tabular-nums">-{formatIDR(summary.redeemValue)}</span>
            </div>
          )}
          <Separator className="my-1" />
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatIDR(summary.total)}</span>
          </div>
          {priceChanged && (
            <p className="text-right text-[10px] font-medium text-amber-600">
              Harga berubah — gunakan angka server saat bayar
            </p>
          )}
        </div>

        <Button
          className="h-12 w-full text-base"
          disabled={!canCheckout || submitting || cart.length === 0}
          onClick={onPay}
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Memproses…
            </>
          ) : (
            <>Bayar {formatIDR(summary.total)}</>
          )}
        </Button>
        {checkoutBlockReason && (
          <p className="text-center text-[11px] text-destructive">{checkoutBlockReason}</p>
        )}
      </div>
    </div>
  );
}

/* ================= Dialog detail item: keypad qty + diskon + ganti varian/satuan ================= */

function ItemDetailDialog({
  item,
  onClose,
  onSetQty,
  onRemove,
  onSetItemDiscount,
  onUpdateItem,
}: {
  item: CartItem | null;
  onClose: () => void;
  onSetQty: (key: ItemKey, quantity: number) => void;
  onRemove: (key: ItemKey) => void;
  onSetItemDiscount: (key: ItemKey, discount: CartDiscount | null) => void;
  onUpdateItem: (key: ItemKey, patch: Partial<CartItem>) => void;
}) {
  const [qtyStr, setQtyStr] = useState("1");
  const [discType, setDiscType] = useState<DiscountType>("percentage");
  const [discValue, setDiscValue] = useState("10");
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    setQtyStr(String(item.quantity));
    setDiscType(item.discount?.type ?? "percentage");
    setDiscValue(String(item.discount?.value ?? 10));
    // Muat varian/satuan untuk opsi ganti (AC-02.7)
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    api
      .get<ProductDetail>(`/products/${item.productId}`)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => {})
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item?.productId, item?.variantId, item?.unit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  const current = item;
  const key: ItemKey = {
    productId: current.productId,
    variantId: current.variantId,
    unit: current.unit,
  };
  const stockCap = current.stockOnHand > 0 ? current.stockOnHand : Number.POSITIVE_INFINITY;

  function pressKey(k: string) {
    if (k === "⌫") {
      setQtyStr((s) => (s.length > 1 ? s.slice(0, -1) : s === "." ? "0" : "1"));
      return;
    }
    setQtyStr((s) => {
      const next = s === "1" && k !== "." ? k : s === "0" && k !== "." ? k : s + k;
      if (next === "." || (next.match(/\./g) ?? []).length > 1) return s;
      return next;
    });
  }

  function applyQty() {
    let q = Number(qtyStr);
    if (Number.isNaN(q) || q <= 0) q = 1;
    if (q > stockCap) {
      toast.error(`Stok tidak mencukupi (sisa ${formatNumber(current.stockOnHand)})`);
      q = stockCap;
    }
    onSetQty(key, q);
  }

  function switchTo(patch: Partial<CartItem>) {
    onUpdateItem(key, patch);
    onClose();
  }

  const variants = (detail?.variants ?? []).filter((v) => v.isActive);
  const units = (detail?.units ?? []).filter((u) => u.isSellable);

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="pr-6">{item.name}</DialogTitle>
          <DialogDescription>
            {formatIDR(item.unitPrice)} / {unitLabel(item)} · stok {formatNumber(item.stockOnHand)}{" "}
            {item.unit || "pcs"}
          </DialogDescription>
        </DialogHeader>

        {/* Keypad qty (AC-02.7) */}
        <div>
          <Label className="text-xs">Qty</Label>
          <div className="mt-1 rounded-lg border bg-muted/40 p-3 text-center text-3xl font-bold tabular-nums">
            {qtyStr}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"].map((k) => (
              <button
                key={k}
                onClick={() => pressKey(k)}
                className="h-12 rounded-lg border bg-background text-base font-semibold active:scale-95"
              >
                {k}
              </button>
            ))}
          </div>
          <Button className="mt-2 h-12 w-full" onClick={applyQty}>
            Terapkan Qty
          </Button>
        </div>

        {/* Diskon item */}
        <div className="space-y-2 border-t pt-3">
          <Label className="text-xs">Diskon item</Label>
          <div className="flex items-center gap-2">
            <Select value={discType} onValueChange={(v) => setDiscType(v as DiscountType)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Persen (%)</SelectItem>
                <SelectItem value="fixed">Nominal (Rp)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              value={discValue}
              onChange={(e) => setDiscValue(e.target.value)}
              placeholder={discType === "percentage" ? "10" : "5000"}
            />
            <Button
              variant="outline"
              className="h-11 shrink-0"
              onClick={() =>
                onSetItemDiscount(key, {
                  type: discType,
                  value: Math.max(0, Number(discValue) || 0),
                })
              }
            >
              Terapkan
            </Button>
          </div>
          {item.discount && (
            <Button
              variant="ghost"
              size="sm"
              className="h-11 text-destructive"
              onClick={() => onSetItemDiscount(key, null)}
            >
              Hapus diskon
            </Button>
          )}
        </div>

        {/* Ganti varian / satuan (AC-02.7) */}
        {(variants.length > 0 || units.length > 0) && (
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs">Ganti varian / satuan</Label>
            {detailLoading ? (
              <div className="space-y-2">
                <div className="skeleton h-11 rounded-lg" />
                <div className="skeleton h-11 rounded-lg" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {variants.map((v) => (
                  <button
                    key={v.id}
                    disabled={v.stockOnHand <= 0}
                    onClick={() =>
                      switchTo({
                        variantId: v.id,
                        name: `${detail?.product.name ?? item.name} — ${v.name}`,
                        sku: v.sku,
                        barcode: v.barcode,
                        unit: detail?.product.unit ?? item.unit,
                        unitFactor: 1,
                        unitBaseLabel: undefined,
                        unitPrice: v.sellingPrice,
                        stockOnHand: v.stockOnHand,
                      })
                    }
                    className={cn(
                      "rounded-lg border p-2 text-left text-xs",
                      item.variantId === v.id && "border-primary bg-accent/40",
                      v.stockOnHand <= 0 && "opacity-40"
                    )}
                  >
                    <p className="truncate font-medium">{v.name}</p>
                    <p className="tabular-nums text-muted-foreground">
                      {formatIDR(v.sellingPrice)} · stok {formatNumber(v.stockOnHand)}
                    </p>
                  </button>
                ))}
                {detail && (
                  <button
                    onClick={() =>
                      switchTo({
                        variantId: null,
                        name: detail.product.name,
                        sku: detail.product.sku,
                        barcode: detail.product.barcode,
                        unit: detail.product.unit,
                        unitFactor: 1,
                        unitBaseLabel: undefined,
                        unitPrice: detail.product.sellingPrice,
                        stockOnHand: detail.stockOnHand,
                      })
                    }
                    className={cn(
                      "rounded-lg border p-2 text-left text-xs",
                      !item.variantId && item.unit === detail.product.unit && "border-primary bg-accent/40"
                    )}
                  >
                    <p className="truncate font-medium">{detail.product.unit}</p>
                    <p className="tabular-nums text-muted-foreground">
                      {formatIDR(detail.product.sellingPrice)} · stok{" "}
                      {formatNumber(detail.stockOnHand)}
                    </p>
                  </button>
                )}
                {units.map((u) => (
                  <button
                    key={u.id}
                    disabled={Math.floor((detail?.stockOnHand ?? 0) / u.factor) <= 0}
                    onClick={() =>
                      switchTo({
                        variantId: null,
                        unit: u.unit,
                        unitFactor: u.factor,
                        unitBaseLabel: `${formatNumber(u.factor)} ${detail?.product.unit ?? item.unit}`,
                        unitPrice: u.sellPrice,
                        stockOnHand: Math.floor((detail?.stockOnHand ?? 0) / u.factor),
                      })
                    }
                    className={cn(
                      "rounded-lg border p-2 text-left text-xs",
                      item.unit === u.unit && !item.variantId && "border-primary bg-accent/40",
                      Math.floor((detail?.stockOnHand ?? 0) / u.factor) <= 0 && "opacity-40"
                    )}
                  >
                    <p className="truncate font-medium">
                      {u.unit} = {formatNumber(u.factor)} {detail?.product.unit ?? "pcs"}
                    </p>
                    <p className="tabular-nums text-muted-foreground">
                      {formatIDR(u.sellPrice)} · stok{" "}
                      {formatNumber(Math.floor((detail?.stockOnHand ?? 0) / u.factor))}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 border-t pt-3 sm:gap-0">
          <Button
            variant="destructive"
            className="h-12 flex-1"
            onClick={() => {
              onRemove(key);
              onClose();
            }}
          >
            <Trash2 className="size-4" />
            Hapus Item
          </Button>
          <Button className="h-12 flex-1" onClick={() => onClose()}>
            Selesai
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
