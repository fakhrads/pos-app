"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import {
  Banknote,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerPicker } from "@/components/customer-picker";
import { ReceiptDialog } from "@/components/receipt";
import { api, ApiError } from "@/lib/api";
import {
  cn,
  debounce,
  formatIDR,
  formatNumber,
  PAYMENT_METHOD_LABEL,
  uuidv4,
} from "@/lib/utils";
import { useSettings, useSetting } from "@/hooks/use-settings";
import type {
  CartItem,
  Category,
  CheckoutResult,
  Customer,
  DiscountType,
  Paginated,
  PaymentMethod,
  PreviewResult,
  Product,
} from "@/lib/types";

const CART_KEY = "pos.cart";

function loadCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

export default function PosPage() {
  const { settings } = useSettings();
  const taxRate = useSetting(settings, "tax.rate", 11);
  const redeemValuePerPoint = useSetting(settings, "points.redeem_value", 10);
  const storeName = useSetting(settings, "store.name", "FakhriPOS");
  const qrisPayload = useSetting(settings, "store.qris_payload", "");

  // Produk & kategori
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeLoading = useRef(false);

  // Cart & checkout
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [txDiscount, setTxDiscount] = useState<{ type: DiscountType; value: number } | null>(null);
  const [redeemPoints, setRedeemPoints] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [refNumber, setRefNumber] = useState("");
  const [nonCashPaid, setNonCashPaid] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);
  const [discountItemId, setDiscountItemId] = useState<string | null>(null);

  // Persist cart
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      // storage penuh / private mode — abaikan
    }
  }, [cart]);

  // Preview server hanya valid selama isi transaksi tidak berubah
  useEffect(() => {
    setPreview(null);
  }, [cart, customer, txDiscount, redeemPoints]);

  // ---------- Load kategori & produk ----------
  useEffect(() => {
    api
      .get<{ items: Category[] }>("/categories")
      .then((d) => setCategories(d.items))
      .catch(() => {});
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const data = await api.get<Paginated<Product>>("/products", {
        q: search || undefined,
        categoryId: categoryId === "all" ? undefined : categoryId,
        isActive: true,
        perPage: 60,
      });
      setProducts(data.items);
    } catch {
      // daftar produk mungkin gagal — tampilkan kosong
    } finally {
      setProductsLoading(false);
    }
  }, [search, categoryId]);

  useEffect(() => {
    const run = debounce(loadProducts, 250);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [loadProducts]);

  // ---------- Scan barcode / SKU ----------
  async function handleBarcode(e: React.FormEvent) {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code || barcodeLoading.current) return;
    barcodeLoading.current = true;
    try {
      const data = await api.get<{ product: Product; stockOnHand: number }>(
        `/products/barcode/${encodeURIComponent(code)}`
      );
      addToCart({ ...data.product, stockOnHand: data.stockOnHand ?? data.product.stockOnHand });
      setBarcodeInput("");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Barcode/SKU tidak ditemukan"
      );
    } finally {
      barcodeLoading.current = false;
    }
  }

  // ---------- Operasi cart ----------
  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        if (existing.quantity + 1 > existing.stockOnHand) {
          toast.error(`Stok tidak mencukupi (sisa ${formatNumber(existing.stockOnHand)})`);
          return prev;
        }
        return prev.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      if (product.stockOnHand <= 0) {
        toast.error(`Stok "${product.name}" habis`);
        return prev;
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          unit: product.unit,
          unitPrice: product.sellingPrice,
          quantity: 1,
          stockOnHand: product.stockOnHand,
          isTaxable: product.isTaxable,
          discount: null,
        },
      ];
    });
  }

  function setQty(productId: string, quantity: number) {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.productId !== productId) return i;
          if (quantity > i.stockOnHand) {
            toast.error(`Stok tidak mencukupi (sisa ${formatNumber(i.stockOnHand)})`);
            return { ...i, quantity: i.stockOnHand };
          }
          return { ...i, quantity: Math.max(1, quantity) };
        })
        .filter((i) => i.quantity > 0)
    );
  }

  function removeItem(productId: string) {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }

  function setItemDiscount(
    productId: string,
    discount: { type: DiscountType; value: number } | null
  ) {
    setCart((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, discount } : i))
    );
    setDiscountItemId(null);
  }

  function clearCart() {
    setCart([]);
    setCustomer(null);
    setTxDiscount(null);
    setRedeemPoints(0);
    setPreview(null);
  }

  // ---------- Perhitungan ----------
  const calc = useMemo(() => {
    const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const itemDiscounts = cart.reduce((s, i) => {
      if (!i.discount) return s;
      const line = i.unitPrice * i.quantity;
      const amt =
        i.discount.type === "percentage"
          ? Math.round((line * i.discount.value) / 100)
          : Math.min(i.discount.value, line);
      return s + Math.max(0, amt);
    }, 0);
    let txDiscountAmount = 0;
    if (txDiscount) {
      txDiscountAmount =
        txDiscount.type === "percentage"
          ? Math.round((subtotal * txDiscount.value) / 100)
          : Math.min(txDiscount.value, subtotal);
      txDiscountAmount = Math.max(0, txDiscountAmount);
    }
    const discountTotal = Math.min(subtotal, itemDiscounts + txDiscountAmount);
    const dpp = subtotal - discountTotal;
    const tax = Math.round((dpp * taxRate) / 100);
    const beforePoints = dpp + tax;
    const redeemValue = redeemPoints > 0
      ? Math.min(redeemPoints * redeemValuePerPoint, beforePoints)
      : 0;
    const total = beforePoints - redeemValue;
    return { subtotal, itemDiscounts, txDiscountAmount, discountTotal, dpp, tax, total, redeemValue };
  }, [cart, txDiscount, redeemPoints, taxRate, redeemValuePerPoint]);

  // Bila server sudah menghitung (preview), angka server yang dipakai untuk bayar
  const effective = {
    subtotal: preview?.subtotal ?? calc.subtotal,
    discountTotal: preview?.discountTotal ?? calc.discountTotal,
    taxTotal: preview?.taxTotal ?? calc.tax,
    total: preview?.total ?? calc.total,
    redeemValue: calc.redeemValue, // preview tidak mengembalikan nilai poin — pakai estimasi lokal
  };

  const changeAmount =
    payMethod === "cash" && cashReceived !== "" ? Number(cashReceived) - effective.total : 0;

  const canPay = useMemo(() => {
    if (cart.length === 0 || submitting) return false;
    if (payMethod === "cash") {
      return cashReceived !== "" && Number(cashReceived) >= calc.total;
    }
    return nonCashPaid;
  }, [cart, submitting, payMethod, cashReceived, nonCashPaid, calc.total]);

  const maxRedeemPoints = customer?.membership?.pointsBalance ?? 0;

  // ---------- Checkout ----------
  async function handleCheckout() {
    if (!canPay) return;
    setSubmitting(true);
    setPreview(null);
    try {
      const payload = {
        customerId: customer?.id,
        items: cart.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          discount: i.discount ?? undefined,
        })),
        manualDiscount: txDiscount ?? undefined,
        redeemPoints: redeemPoints > 0 ? redeemPoints : undefined,
        payments: [
          {
            method: payMethod,
            amount: calc.total,
            cashReceived: payMethod === "cash" ? Number(cashReceived) : undefined,
            referenceNumber: payMethod === "transfer" && refNumber ? refNumber : undefined,
          },
        ],
        notes: undefined,
      };

      // 1) Pra-hitung (validasi stok & diskon di server — server sumber kebenaran)
      const pv = await api.post<PreviewResult>("/transactions/preview", payload);
      setPreview(pv);

      // Bila tunai dan nominal kurang dari total server, hentikan
      if (payMethod === "cash" && Number(cashReceived) < pv.total) {
        toast.error(`Nominal tunai kurang: total ${formatIDR(pv.total)}`);
        setSubmitting(false);
        return;
      }

      // 2) Commit — dengan Idempotency-Key anti double-submit
      const result = await api.post<CheckoutResult>(
        "/transactions",
        { ...payload, payments: [{ ...payload.payments[0], amount: pv.total }] },
        { headers: { "Idempotency-Key": uuidv4() } }
      );
      setReceipt(result);
      clearCart();
      setCashReceived("");
      setRefNumber("");
      setNonCashPaid(false);
      toast.success(`Transaksi ${result.transaction.invoiceNumber} berhasil`);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.message, { duration: 6000 });
      } else {
        toast.error("Terjadi kesalahan saat checkout.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const taxLabel = `PPN ${formatNumber(taxRate)}%`;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 lg:flex-row">
      {/* ============ Kiri: katalog ============ */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          {/* Scan barcode */}
          <form onSubmit={handleBarcode} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="Scan barcode / ketik SKU, lalu Enter…"
                className="pl-9 font-mono"
                autoFocus
              />
            </div>
            <Button type="submit" variant="secondary" className="shrink-0">
              Cari
            </Button>
          </form>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Semua kategori" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua kategori</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Grid produk */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card">
          {productsLoading ? (
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
              <p className="text-sm font-medium">Produk tidak ditemukan</p>
              <p className="text-xs text-muted-foreground">
                Coba kata kunci lain, atau{" "}
                <Link href="/products" className="underline">
                  kelola produk
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => {
                const lowStock = p.stockOnHand <= p.minStock;
                const out = p.stockOnHand <= 0;
                return (
                  <button
                    key={p.id}
                    disabled={out}
                    onClick={() => addToCart(p)}
                    className={cn(
                      "group flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                      out
                        ? "cursor-not-allowed opacity-50"
                        : "hover:border-primary/50 hover:bg-accent/40"
                    )}
                  >
                    <div className="flex w-full items-start justify-between gap-1">
                      <p className="line-clamp-2 text-sm font-medium leading-tight">
                        {p.name}
                      </p>
                      {p.barcode && (
                        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                          {p.barcode}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold">{formatIDR(p.sellingPrice)}</p>
                    <div className="mt-auto flex w-full items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {p.category?.name ?? ""}
                      </span>
                      <Badge
                        variant={out ? "destructive" : lowStock ? "secondary" : "outline"}
                        className={cn(
                          "text-[10px]",
                          out && "bg-destructive text-destructive-foreground"
                        )}
                      >
                        {out ? "Habis" : `${formatNumber(p.stockOnHand)} ${p.unit}`}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ============ Kanan: keranjang ============ */}
      <div className="flex w-full flex-col rounded-lg border bg-card lg:w-[400px]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart className="size-4" />
            Keranjang
            {cart.length > 0 && <Badge variant="secondary">{cart.length}</Badge>}
          </h2>
          <Button variant="ghost" size="sm" onClick={clearCart} disabled={cart.length === 0}>
            Kosongkan
          </Button>
        </div>

        {/* List item cart */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {cart.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <ShoppingCart className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Keranjang kosong. Pilih produk dari katalog atau scan barcode.
              </p>
            </div>
          )}
          {cart.map((item) => (
            <div key={item.productId} className="rounded-lg border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatIDR(item.unitPrice)} / {item.unit}
                    {item.discount && (
                      <span className="ml-1 text-emerald-600">
                        · diskon {item.discount.type === "percentage" ? `${item.discount.value}%` : formatIDR(item.discount.value)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setDiscountItemId(item.productId)}
                    title="Diskon item"
                  >
                    <BadgePercentIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    onClick={() => removeItem(item.productId)}
                    title="Hapus"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    onClick={() => setQty(item.productId, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <Input
                    className="h-7 w-14 text-center text-sm"
                    value={item.quantity}
                    inputMode="numeric"
                    onChange={(e) => setQty(item.productId, Number(e.target.value) || 1)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    onClick={() => setQty(item.productId, item.quantity + 1)}
                    disabled={item.quantity >= item.stockOnHand}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <p className="text-sm font-semibold">
                  {formatIDR(item.unitPrice * item.quantity)}
                </p>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Sisa stok: {formatNumber(item.stockOnHand)} {item.unit}
              </p>
            </div>
          ))}
        </div>

        {/* Pelanggan */}
        <div className="space-y-3 border-t p-3">
          <CustomerPicker value={customer} onChange={setCustomer} />

          {/* Diskon transaksi + poin */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Diskon transaksi</Label>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full justify-start font-normal"
                onClick={() => setTxDiscount((d) => (d ? null : { type: "percentage", value: 10 }))}
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
                className="mt-1 h-8"
                type="number"
                min={0}
                max={maxRedeemPoints}
                placeholder={customer ? `Poin: ${formatNumber(maxRedeemPoints)}` : "Pilih pelanggan dulu"}
                value={redeemPoints || ""}
                disabled={!customer?.membership}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRedeemPoints(
                    Math.min(Math.max(0, Math.floor(v)), maxRedeemPoints)
                  );
                }}
              />
            </div>
          </div>

          {/* Ringkasan */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatIDR(effective.subtotal)}</span>
            </div>
            {effective.discountTotal > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Diskon</span>
                <span>-{formatIDR(effective.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>{taxLabel}</span>
              <span>{formatIDR(effective.taxTotal)}</span>
            </div>
            {effective.redeemValue > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>Poin ({formatNumber(redeemPoints)})</span>
                <span>-{formatIDR(effective.redeemValue)}</span>
              </div>
            )}
            <Separator className="my-1" />
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span>{formatIDR(effective.total)}</span>
            </div>
            {preview && (
              <p className="text-right text-[10px] text-muted-foreground">
                dihitung server · {formatNumber(preview.items.length)} item
              </p>
            )}
          </div>

          {/* Metode pembayaran */}
          <div className="grid grid-cols-3 gap-2">
            {(["cash", "qris", "transfer"] as PaymentMethod[]).map((m) => (
              <Button
                key={m}
                variant={payMethod === m ? "default" : "outline"}
                size="sm"
                className="justify-center"
                onClick={() => {
                  setPayMethod(m);
                  setNonCashPaid(false);
                }}
              >
                {m === "cash" ? (
                  <Banknote className="size-4" />
                ) : m === "qris" ? (
                  <QrCode className="size-4" />
                ) : (
                  <CreditCard className="size-4" />
                )}
                {PAYMENT_METHOD_LABEL[m]}
              </Button>
            ))}
          </div>

          {/* Panel bayar */}
          {payMethod === "cash" && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Nominal diterima"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setCashReceived(String(effective.total))}
                >
                  Uang Pas
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[20000, 50000, 100000, 200000].map((amt) => (
                  <Button
                    key={amt}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setCashReceived(String(Math.max(amt, effective.total)))}
                  >
                    {formatIDR(amt)}
                  </Button>
                ))}
              </div>
              <p className="text-sm">
                Kembalian:{" "}
                <span className={cn("font-semibold", changeAmount < 0 ? "text-destructive" : "")}>
                  {formatIDR(Math.max(changeAmount, 0))}
                </span>
                {changeAmount < 0 && (
                  <span className="ml-1 text-xs text-destructive">(kurang)</span>
                )}
              </p>
            </div>
          )}

          {payMethod === "qris" && (
            <div className="space-y-3 rounded-lg bg-muted/50 p-3 text-center">
              {qrisPayload ? (
                <div className="mx-auto w-fit rounded-lg bg-white p-3">
                  <QRCode value={qrisPayload} size={140} />
                </div>
              ) : (
                <div className="mx-auto flex size-36 items-center justify-center rounded-lg border-2 border-dashed text-xs text-muted-foreground">
                  QRIS statis
                  <br />
                  belum diatur
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Minta pelanggan scan QR {storeName} lalu tandai lunas.
              </p>
              <Button
                variant={nonCashPaid ? "default" : "outline"}
                className="w-full"
                onClick={() => setNonCashPaid((v) => !v)}
              >
                {nonCashPaid ? "✓ Sudah Dibayar" : "Tandai Sudah Dibayar"}
              </Button>
            </div>
          )}

          {payMethod === "transfer" && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <Input
                placeholder="No. referensi transfer (opsional)"
                value={refNumber}
                onChange={(e) => setRefNumber(e.target.value)}
              />
              <Button
                variant={nonCashPaid ? "default" : "outline"}
                className="w-full"
                onClick={() => setNonCashPaid((v) => !v)}
              >
                {nonCashPaid ? "✓ Lunas" : "Tandai Lunas"}
              </Button>
            </div>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={!canPay}
            onClick={handleCheckout}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Memproses…
              </>
            ) : (
              <>Bayar {formatIDR(effective.total)}</>
            )}
          </Button>
        </div>
      </div>

      {/* Dialog diskon per item */}
      <ItemDiscountDialog
        item={cart.find((i) => i.productId === discountItemId) ?? null}
        onClose={() => setDiscountItemId(null)}
        onSave={setItemDiscount}
      />

      {/* Struk */}
      <ReceiptDialog
        open={!!receipt}
        onOpenChange={(open) => !open && setReceipt(null)}
        receipt={receipt?.receipt ?? null}
      />
    </div>
  );
}

function BadgePercentIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m15 9-6 6" />
      <path d="M9 9h.01" />
      <path d="M15 15h.01" />
    </svg>
  );
}

function ItemDiscountDialog({
  item,
  onClose,
  onSave,
}: {
  item: CartItem | null;
  onClose: () => void;
  onSave: (productId: string, discount: { type: DiscountType; value: number } | null) => void;
}) {
  const [type, setType] = useState<DiscountType>("percentage");
  const [value, setValue] = useState("10");

  useEffect(() => {
    if (item) {
      setType(item.discount?.type ?? "percentage");
      setValue(String(item.discount?.value ?? 10));
    }
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Diskon Item</DialogTitle>
          <DialogDescription className="truncate">{item?.name}</DialogDescription>
        </DialogHeader>
        {item && (
          <div className="space-y-3">
            <Select value={type} onValueChange={(v) => setType(v as DiscountType)}>
              <SelectTrigger>
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
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={type === "percentage" ? "10" : "5000"}
            />
            {type === "percentage" && (
              <p className="text-xs text-muted-foreground">
                = {formatIDR(Math.round((item.unitPrice * item.quantity * (Number(value) || 0)) / 100))}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => item && onSave(item.productId, null)}
            disabled={!item?.discount}
          >
            Hapus diskon
          </Button>
          <Button
            onClick={() =>
              item && onSave(item.productId, { type, value: Math.max(0, Number(value) || 0) })
            }
          >
            Terapkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
