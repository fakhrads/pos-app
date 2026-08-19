"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import {
  cn,
  debounce,
  formatIDR,
  formatNumber,
  uuidv4,
} from "@/lib/utils";
import { useSettings, useSetting } from "@/hooks/use-settings";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useAuth } from "@/providers/auth-provider";
import {
  idbToProduct,
  searchProducts,
  getAllProducts,
  getProduct,
  findProductByBarcode,
} from "@/lib/offline-db";
import {
  pullCatalog,
  registerBackgroundSync,
  runSync,
  isCatalogStale,
} from "@/lib/sync";
import { ProductGrid, type PosAddOptions } from "@/components/pos/product-grid";
import { CartSheet, type CartSummary, type ItemKey } from "@/components/pos/cart-sheet";
import { PaymentDialog } from "@/components/pos/payment-dialog";
import { HoldList } from "@/components/pos/hold-list";
import { ShiftManager } from "@/components/pos/shift-manager";
import { ReceiptActions } from "@/components/pos/receipt-actions";
import { lineKey } from "@/components/pos/cart-utils";
import {
  ModuleHelpButton,
  ModuleIntroBadge,
} from "@/components/onboarding/module-intro";
import type {
  CartDiscount,
  CartItem,
  Category,
  CheckoutResult,
  Customer,
  DiscountType,
  HeldCart,
  HeldCartItem,
  Paginated,
  PreviewResult,
  Product,
  ProductDetail,
  Shift,
} from "@/lib/types";

const CART_KEY = "pos.cart";
const PAGE_SIZE = 60;

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
  const enforceShift = useSetting(settings, "shift.enforce_checkout", true);
  const cashTolerance = useSetting(settings, "shift.cash_tolerance", 0);
  const printWidthMm = useSetting(settings, "receipt.print_width_mm", 80);
  const showVerificationQr = useSetting(settings, "receipt.show_verification_qr", false);
  const showQrisQr = useSetting(settings, "receipt.show_qris_qr", false);
  const storeWhatsapp = useSetting(settings, "store.whatsapp_number", "");
  const staleAfterDays = useSetting(settings, "offline.stale_after_days", 14);

  // ---------- Offline / PWA ----------
  const online = useOnlineStatus();
  const offline = !online;
  const { user } = useAuth();
  const operatorName = user?.name ?? "Kasir";
  const storeAddress = useSetting(settings, "store.address", "");
  const storePhone = useSetting(settings, "store.phone", "");
  const receiptFooter = useSetting(settings, "receipt.footer", "");
  const storeProfile = {
    name: storeName,
    address: storeAddress,
    phone: storePhone,
    footer: receiptFooter,
  };
  const [catalogStale, setCatalogStale] = useState(false);

  // ---------- Katalog ----------
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement | null>(null);
  const pageRef = useRef(1);

  // ---------- Keranjang & checkout ----------
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [txDiscount, setTxDiscount] = useState<CartDiscount | null>(null);
  const [redeemPoints, setRedeemPoints] = useState<number>(0);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);

  // ---------- Shift & hold ----------
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftRefreshKey, setShiftRefreshKey] = useState(0);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdsRefreshKey, setHoldsRefreshKey] = useState(0);
  const [holdCount, setHoldCount] = useState(0);
  const [holding, setHolding] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  // Persist cart
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      // storage penuh / private mode — abaikan
    }
  }, [cart]);

  // Preview & total server hanya valid selama isi transaksi tidak berubah
  useEffect(() => {
    setPreview(null);
    setServerTotal(null);
  }, [cart, customer, txDiscount, redeemPoints]);

  // Tutup dialog bayar bila isi keranjang berubah di tengah alur
  const cartSignature = cart.map((i) => `${lineKey(i)}:${i.quantity}`).join("|");
  useEffect(() => {
    if (cartSignature) setPaymentOpen(false);
  }, [cartSignature]);

  // ---------- Load kategori & produk ----------
  useEffect(() => {
    if (offline) {
      // Offline: kategori disusun dari cache produk di IndexedDB
      getAllProducts()
        .then((all) => {
          const map = new Map<string, string>();
          all.forEach((p) => {
            if (p.categoryId && p.categoryName) map.set(p.categoryId, p.categoryName);
          });
          const cats: Category[] = Array.from(map.entries()).map(([id, name], i) => ({
            id,
            name,
            slug: name.toLowerCase().replace(/\s+/g, "-"),
            sortOrder: i,
            isActive: true,
          }));
          setCategories(cats);
        })
        .catch(() => {});
      return;
    }
    api
      .get<{ items: Category[] }>("/categories")
      .then((d) => setCategories(d.items))
      .catch(() => {});
  }, [offline]);

  const fetchProducts = useCallback(
    async (reset: boolean) => {
      if (offline) {
        // Offline: baca katalog dari IndexedDB (AC-03.1 / AC-03.3)
        if (reset) {
          setProductsLoading(true);
          setProductsError(null);
        }
        try {
          let items = await searchProducts(search);
          if (categoryId !== "all") {
            items = items.filter((p) => p.categoryId === categoryId);
          }
          const mapped = items.map(idbToProduct);
          setProducts(mapped);
          setHasMore(false);
        } catch (err) {
          if (reset) {
            setProductsError(
              "Data produk tidak tersedia. Sambungkan ke internet untuk memuat katalog."
            );
            setProducts([]);
          }
        } finally {
          setProductsLoading(false);
          setLoadingMore(false);
        }
        return;
      }
      if (reset) {
        setProductsLoading(true);
        setProductsError(null);
      } else {
        setLoadingMore(true);
      }
      const p = reset ? 1 : pageRef.current;
      try {
        const data = await api.get<Paginated<Product>>("/products", {
          q: search || undefined,
          categoryId: categoryId === "all" ? undefined : categoryId,
          isActive: true,
          perPage: PAGE_SIZE,
          page: p,
        });
        setProducts((prev) => (reset ? data.items : [...prev, ...data.items]));
        setHasMore(data.meta.page < data.meta.totalPages);
        pageRef.current = p + 1;
      } catch (err) {
        if (reset) {
          setProductsError(
            err instanceof ApiError ? err.message : "Gagal memuat produk"
          );
        }
      } finally {
        setProductsLoading(false);
        setLoadingMore(false);
      }
    },
    [search, categoryId, offline]
  );

  useEffect(() => {
    const run = debounce(() => fetchProducts(true), 250);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [fetchProducts]);

  // ---------- Hold count ----------
  const loadHoldCount = useCallback(async () => {
    try {
      const data = await api.get<Paginated<HeldCart>>("/held-carts", { perPage: 1 });
      setHoldCount(data.meta.total);
    } catch {
      setHoldCount(0);
    }
  }, []);

  useEffect(() => {
    loadHoldCount();
  }, [loadHoldCount, holdsRefreshKey]);

  // ---------- Background sync + cache katalog (Fase 7) ----------
  useEffect(() => {
    void registerBackgroundSync();
    void isCatalogStale(staleAfterDays).then(setCatalogStale);
    if (online) {
      // Saat online: tarik katalog ke IndexedDB & jalankan antrean tersisa
      void pullCatalog().catch(() => {});
      void runSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // ---------- Scan barcode / SKU ----------
  async function handleBarcode(e: React.FormEvent) {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code || barcodeBusy) return;
    setBarcodeBusy(true);
    try {
      if (offline) {
        // Offline: cari di IndexedDB (AC-03.1)
        const found =
          (await findProductByBarcode(code)) ??
          (await searchProducts(code))[0];
        if (found) {
          addToCart({ product: idbToProduct(found) });
          setBarcodeInput("");
        } else {
          toast.error("Barcode/SKU tidak ditemukan di cache offline");
        }
        return;
      }
      const data = await api.get<{ product: Product; stockOnHand: number }>(
        `/products/barcode/${encodeURIComponent(code)}`
      );
      addToCart({
        product: { ...data.product, stockOnHand: data.stockOnHand ?? data.product.stockOnHand },
      });
      setBarcodeInput("");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Barcode/SKU tidak ditemukan"
      );
    } finally {
      setBarcodeBusy(false);
      scanRef.current?.focus();
    }
  }

  // ---------- Operasi cart ----------
  function addToCart({ product, variant, unit }: PosAddOptions) {
    const factor = unit?.factor ?? 1;
    const key = {
      productId: product.id,
      variantId: variant?.id ?? null,
      unit: unit?.unit ?? product.unit,
    };
    const stockOnHand = variant
      ? variant.stockOnHand
      : Math.floor(product.stockOnHand / factor);

    setCart((prev) => {
      const existing = prev.find((i) => lineKey(i) === lineKey(key));
      if (existing) {
        if (existing.quantity + 1 > stockOnHand && stockOnHand > 0) {
          toast.error(`Stok tidak mencukupi (sisa ${formatNumber(stockOnHand)})`);
          return prev;
        }
        return prev.map((i) =>
          lineKey(i) === lineKey(key) ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      if (stockOnHand <= 0 && product.trackStock !== false) {
        toast.error(`Stok "${product.name}" habis`);
        return prev;
      }
      return [
        ...prev,
        {
          productId: product.id,
          variantId: variant?.id ?? null,
          name: variant ? `${product.name} — ${variant.name}` : product.name,
          sku: variant?.sku ?? product.sku,
          barcode: variant?.barcode ?? product.barcode,
          unit: unit?.unit ?? product.unit,
          unitFactor: factor,
          unitBaseLabel: unit ? `${formatNumber(factor)} ${product.unit}` : undefined,
          unitPrice: variant?.sellingPrice ?? unit?.sellPrice ?? product.sellingPrice,
          quantity: 1,
          stockOnHand,
          isTaxable: product.isTaxable,
          discount: null,
        },
      ];
    });
  }

  function setQty(key: ItemKey, quantity: number) {
    setCart((prev) => {
      const existing = prev.find((i) => lineKey(i) === lineKey(key));
      if (!existing) return prev;
      const stockCap = existing.stockOnHand > 0 ? existing.stockOnHand : Number.POSITIVE_INFINITY;
      if (quantity > stockCap) {
        toast.error(`Stok tidak mencukupi (sisa ${formatNumber(existing.stockOnHand)})`);
        return prev.map((i) =>
          lineKey(i) === lineKey(key) ? { ...i, quantity: Math.max(1, stockCap) } : i
        );
      }
      return prev.map((i) =>
        lineKey(i) === lineKey(key) ? { ...i, quantity: Math.max(1, quantity) } : i
      );
    });
  }

  function removeItem(key: ItemKey) {
    setCart((prev) => prev.filter((i) => lineKey(i) !== lineKey(key)));
  }

  function setItemDiscount(key: ItemKey, discount: CartDiscount | null) {
    setCart((prev) =>
      prev.map((i) => (lineKey(i) === lineKey(key) ? { ...i, discount } : i))
    );
  }

  function updateItem(key: ItemKey, patch: Partial<CartItem>) {
    setCart((prev) => {
      const existing = prev.find((i) => lineKey(i) === lineKey(key));
      if (!existing) return prev;
      const updated = { ...existing, ...patch };
      return [...prev.filter((i) => lineKey(i) !== lineKey(key)), updated];
    });
  }

  function clearCart() {
    setCart([]);
    setCustomer(null);
    setTxDiscount(null);
    setRedeemPoints(0);
    setPreview(null);
    setServerTotal(null);
  }

  // ---------- Perhitungan (konsisten Fase 2 — jangan diubah logikanya) ----------
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
    const redeemValue =
      redeemPoints > 0
        ? Math.min(redeemPoints * redeemValuePerPoint, beforePoints)
        : 0;
    const total = beforePoints - redeemValue;
    return { subtotal, itemDiscounts, txDiscountAmount, discountTotal, dpp, tax, total, redeemValue };
  }, [cart, txDiscount, redeemPoints, taxRate, redeemValuePerPoint]);

  // Angka server (preview) dipakai untuk bayar
  const effective = {
    subtotal: preview?.subtotal ?? calc.subtotal,
    discountTotal: preview?.discountTotal ?? calc.discountTotal,
    taxTotal: preview?.taxTotal ?? calc.tax,
    total: serverTotal ?? preview?.total ?? calc.total,
    redeemValue: calc.redeemValue,
  };

  const priceChanged =
    (preview != null && preview.total !== calc.total) ||
    (serverTotal != null && serverTotal !== calc.total);

  const maxRedeemPoints = customer?.membership?.pointsBalance ?? 0;
  const shiftOk = !enforceShift || !!shift;
  const checkoutBlockReason = !shiftOk ? "Buka shift dulu sebelum membayar" : null;

  const cartSummary: CartSummary = {
    subtotal: calc.subtotal,
    itemDiscounts: calc.itemDiscounts,
    txDiscountAmount: calc.txDiscountAmount,
    discountTotal: calc.discountTotal,
    dpp: calc.dpp,
    tax: calc.tax,
    total: calc.total,
    redeemValue: calc.redeemValue,
  };

  // ---------- Hold ----------
  async function handleHold() {
    if (cart.length === 0 || holding) return;
    setHolding(true);
    try {
      const data = await api.post<{ heldCart: HeldCart }>("/held-carts", {
        customerId: customer?.id,
        items: cart.map((i) => ({
          productId: i.productId,
          variantId: i.variantId ?? undefined,
          unit: i.unit ?? undefined,
          quantity: i.quantity,
          discount: i.discount ?? undefined,
        })),
      });
      toast.success(`Transaksi ditahan ${data.heldCart.holdNumber}`);
      clearCart();
      setHoldsRefreshKey((k) => k + 1);
      setCartSheetOpen(false);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Gagal menahan transaksi — coba lagi"
      );
    } finally {
      setHolding(false);
    }
  }

  /** Bangun CartItem dari snapshot hold — harga & stok diambil dari server (SPEC §1.3.6) */
  async function hydrateCartItems(items: HeldCartItem[]): Promise<CartItem[]> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const details = await Promise.all(
      ids.map(async (pid) => {
        try {
          return await api.get<ProductDetail>(`/products/${pid}`);
        } catch {
          return null;
        }
      })
    );
    const byId = new Map(
      details.filter((d): d is ProductDetail => d != null).map((d) => [d.product.id, d])
    );
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      toast.warning(
        `Beberapa item hold tidak tersedia lagi (${missing.length}) dan dilewati.`
      );
    }
    return items.flatMap((i) => {
      const d = byId.get(i.productId);
      if (!d) return [];
      const variant = i.variantId
        ? d.variants.find((v) => v.id === i.variantId)
        : undefined;
      const unit =
        i.unit && i.unit !== d.product.unit
          ? d.units.find((u) => u.unit === i.unit && u.isSellable)
          : undefined;
      const factor = unit?.factor ?? 1;
      const stock = variant
        ? variant.stockOnHand
        : Math.floor(d.stockOnHand / factor);
      return [
        {
          productId: i.productId,
          variantId: variant?.id ?? null,
          name: variant ? `${d.product.name} — ${variant.name}` : d.product.name,
          sku: variant?.sku ?? d.product.sku,
          barcode: variant?.barcode ?? d.product.barcode,
          unit: unit?.unit ?? d.product.unit,
          unitFactor: factor,
          unitBaseLabel: unit ? `${formatNumber(factor)} ${d.product.unit}` : undefined,
          unitPrice: variant?.sellingPrice ?? unit?.sellPrice ?? d.product.sellingPrice,
          quantity: i.quantity,
          stockOnHand: stock,
          isTaxable: d.product.isTaxable,
          discount: i.discount ?? null,
        },
      ];
    });
  }

  async function handleResumeHold(hold: HeldCart) {
    setResumingId(hold.id);
    try {
      const data = await api.post<{ heldCart: HeldCart }>(`/held-carts/${hold.id}/resume`);
      const hydrated = await hydrateCartItems(data.heldCart.items);
      if (hydrated.length === 0) {
        toast.error("Tidak ada item yang bisa dilanjutkan dari hold ini.");
        return;
      }
      setCart(hydrated);
      setCustomer(null);
      setHoldOpen(false);
      setHoldsRefreshKey((k) => k + 1);
      toast.success(`Hold ${data.heldCart.holdNumber} dilanjutkan — periksa kembali harga di server`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal melanjutkan hold");
    } finally {
      setResumingId(null);
    }
  }

  async function handleDiscardHold(hold: HeldCart) {
    try {
      await api.delete(`/held-carts/${hold.id}`);
      toast.success(`${hold.holdNumber} dibuang`);
      setHoldsRefreshKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal membuang hold");
    }
  }

  // ---------- Sukses checkout ----------
  function handleCheckoutSuccess(result: CheckoutResult) {
    setReceipt(result);
    clearCart();
    setPaymentOpen(false);
    setShiftRefreshKey((k) => k + 1);
  }

  const taxLabel = `PPN ${formatNumber(taxRate)}%`;

  return (
    <>
      <div className="flex h-[calc(100dvh-8.5rem)] min-h-0 flex-col gap-3 lg:h-[calc(100vh-11rem)] lg:flex-row">
        {/* Pengantar Modul Kasir & tombol "?" */}
        <div className="absolute right-4 top-2 z-30 flex items-center gap-1 md:right-6">
          <ModuleHelpButton moduleId="pos" />
        </div>
        <ModuleIntroBadge moduleId="pos" />
        {/* ===== Kiri: banner shift + katalog ===== */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {(offline || catalogStale) && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500"
            >
              {offline
                ? "Mode Offline — produk & harga dari cache; transaksi disimpan lalu disinkronkan otomatis saat online."
                : "Data harga mungkin tidak terbaru (cache katalog lama). Sambungkan ke internet untuk memperbarui."}
            </div>
          )}
          <ShiftManager
            enforceCheckout={enforceShift}
            cashTolerance={cashTolerance}
            refreshKey={shiftRefreshKey}
            onShiftChange={setShift}
          />
          <ProductGrid
            categories={categories}
            products={products}
            loading={productsLoading}
            loadingMore={loadingMore}
            error={productsError}
            hasMore={hasMore}
            search={search}
            onSearchChange={setSearch}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            barcodeInput={barcodeInput}
            onBarcodeInputChange={setBarcodeInput}
            onBarcodeSubmit={handleBarcode}
            barcodeBusy={barcodeBusy}
            onLoadMore={() => {
              if (!productsLoading && !loadingMore && hasMore) fetchProducts(false);
            }}
            onRetry={() => fetchProducts(true)}
            onAdd={addToCart}
            scanRef={scanRef}
            offline={offline}
          />
        </div>

        {/* ===== Kanan: keranjang (panel desktop) + FAB/sheet mobile ===== */}
        <CartSheet
          open={cartSheetOpen}
          onOpenChange={setCartSheetOpen}
          cart={cart}
          customer={customer}
          onCustomerChange={setCustomer}
          txDiscount={txDiscount}
          onTxDiscountChange={(d) => {
            setTxDiscount(d);
            setPreview(null);
            setServerTotal(null);
          }}
          redeemPoints={redeemPoints}
          onRedeemPointsChange={(n) => {
            setRedeemPoints(n);
            setPreview(null);
            setServerTotal(null);
          }}
          maxRedeemPoints={maxRedeemPoints}
          summary={cartSummary}
          taxLabel={taxLabel}
          priceChanged={priceChanged}
          canCheckout={cart.length > 0 && !submitting && shiftOk}
          checkoutBlockReason={checkoutBlockReason}
          submitting={submitting}
          holding={holding}
          holdCount={holdCount}
          onSetQty={setQty}
          onRemoveItem={removeItem}
          onSetItemDiscount={setItemDiscount}
          onUpdateItem={updateItem}
          onClearCart={clearCart}
          onPay={() => setPaymentOpen(true)}
          onHold={handleHold}
          onOpenHolds={() => setHoldOpen(true)}
        />
      </div>

      {/* ===== Split payment ===== */}
      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={effective.total}
        cart={cart}
        customer={customer}
        txDiscount={txDiscount}
        redeemPoints={redeemPoints}
        storeName={storeName}
        taxRate={taxRate}
        qrisPayload={qrisPayload}
        canCheckout={cart.length > 0 && !submitting && shiftOk}
        checkoutBlockReason={checkoutBlockReason}
        offline={offline}
        storeProfile={storeProfile}
        shiftId={shift?.id ?? null}
        redeemValuePerPoint={redeemValuePerPoint}
        operatorName={operatorName}
        onSuccess={handleCheckoutSuccess}
        onServerTotalChanged={(t) => {
          setServerTotal(t);
          setPreview(null);
        }}
      />

      {/* ===== Daftar hold ===== */}
      <HoldList
        open={holdOpen}
        onOpenChange={setHoldOpen}
        refreshKey={holdsRefreshKey}
        resumingId={resumingId}
        onResume={handleResumeHold}
        onDiscard={handleDiscardHold}
      />

      {/* ===== Struk / sukses ===== */}
      <ReceiptActions
        open={!!receipt}
        onOpenChange={(o) => !o && setReceipt(null)}
        result={receipt}
        storeName={storeName}
        qrisPayload={qrisPayload}
        printWidthMm={printWidthMm}
        showVerificationQr={showVerificationQr}
        showQrisQr={showQrisQr}
        storeWhatsapp={storeWhatsapp}
      />
    </>
  );
}
