"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, PackageSearch, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineError } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api";
import { cn, formatIDR, formatNumber } from "@/lib/utils";
import type {
  Category,
  Product,
  ProductDetail,
  ProductUnit,
  ProductVariant,
} from "@/lib/types";

export interface PosAddOptions {
  product: Product;
  variant?: ProductVariant;
  unit?: ProductUnit;
}

interface ProductGridProps {
  categories: Category[];
  products: Product[];
  /** loading awal / saat search berganti */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  categoryId: string;
  onCategoryChange: (v: string) => void;
  barcodeInput: string;
  onBarcodeInputChange: (v: string) => void;
  onBarcodeSubmit: (e: React.FormEvent) => void;
  barcodeBusy: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onAdd: (opts: PosAddOptions) => void;
  /** ref input scan — supaya bisa di-fokus ulang dari luar */
  scanRef: React.RefObject<HTMLInputElement | null>;
  /** Saat offline: pakai variants/units yang sudah tertanam di objek produk (dari IDB),
   *  jangan fetch /products/:id ke server (SPEC Fase 7 §3.1). */
  offline?: boolean;
}

/** Modal pilih varian (AC-01.7) / satuan (AC-01.8) — data dari GET /products/:id */
function ProductPickerDialog({
  product,
  detail,
  loading,
  error,
  onRetry,
  onClose,
  onSelect,
}: {
  product: Product | null;
  detail: ProductDetail | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  onSelect: (opts: PosAddOptions) => void;
}) {
  const open = !!product;
  if (!open) return null;

  const variants = (detail?.variants ?? []).filter((v) => v.isActive);
  const units = (detail?.units ?? []).filter((u) => u.isSellable);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{product?.name}</DialogTitle>
          <DialogDescription>
            {variants.length > 0
              ? "Pilih varian produk"
              : units.length > 0
                ? "Pilih satuan penjualan"
                : "Pilih produk"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-14 rounded-lg" />
            ))}
          </div>
        )}

        {!loading && error && (
          <InlineError message={error} onRetry={onRetry} />
        )}

        {!loading && !error && detail && (
          <div className="space-y-2">
            {variants.length > 0 ? (
              variants.map((v) => {
                const out = v.stockOnHand <= 0 && detail.product.trackStock !== false;
                return (
                  <button
                    key={v.id}
                    disabled={out}
                    onClick={() => onSelect({ product: detail.product, variant: v })}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors active:scale-[0.99]",
                      out
                        ? "cursor-not-allowed opacity-50"
                        : "hover:border-primary/50 hover:bg-accent/40"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{v.name}</p>
                      {v.sku && (
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {v.sku}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold">{formatIDR(v.sellingPrice)}</p>
                      <Badge
                        variant={out ? "destructive" : "outline"}
                        className="mt-0.5 text-[10px]"
                      >
                        {out ? "Stok habis" : `Stok ${formatNumber(v.stockOnHand)}`}
                      </Badge>
                    </div>
                  </button>
                );
              })
            ) : (
              <>
                {/* Unit dasar selalu tersedia */}
                <UnitOption
                  label={detail.product.unit}
                  conversion={`1 ${detail.product.unit} = 1 ${detail.product.unit}`}
                  price={detail.product.sellingPrice}
                  stock={detail.stockOnHand}
                  out={detail.stockOnHand <= 0 && detail.product.trackStock !== false}
                  onClick={() => onSelect({ product: detail.product })}
                />
                {units.map((u) => (
                  <UnitOption
                    key={u.id}
                    label={u.unit}
                    conversion={`1 ${u.unit} = ${formatNumber(u.factor)} ${detail.product.unit}`}
                    price={u.sellPrice}
                    stock={Math.floor(detail.stockOnHand / u.factor)}
                    out={
                      Math.floor(detail.stockOnHand / u.factor) <= 0 &&
                      detail.product.trackStock !== false
                    }
                    onClick={() => onSelect({ product: detail.product, unit: u })}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UnitOption({
  label,
  conversion,
  price,
  stock,
  out,
  onClick,
}: {
  label: string;
  conversion: string;
  price: number;
  stock: number;
  out: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={out}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors active:scale-[0.99]",
        out ? "cursor-not-allowed opacity-50" : "hover:border-primary/50 hover:bg-accent/40"
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{conversion}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold">{formatIDR(price)}</p>
        <Badge variant={out ? "destructive" : "outline"} className="mt-0.5 text-[10px]">
          {out ? "Stok habis" : `Stok ${formatNumber(stock)}`}
        </Badge>
      </div>
    </button>
  );
}

export function ProductGrid({
  categories,
  products,
  loading,
  loadingMore,
  error,
  hasMore,
  search,
  onSearchChange,
  categoryId,
  onCategoryChange,
  barcodeInput,
  onBarcodeInputChange,
  onBarcodeSubmit,
  barcodeBusy,
  onLoadMore,
  onRetry,
  onAdd,
  scanRef,
  offline = false,
}: ProductGridProps) {
  const [picker, setPicker] = useState<Product | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // ---------- Infinite scroll (AC-01.2) ----------
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || loadingMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentinelRef.current, hasMore, loading, loadingMore, onLoadMore]);

  // ---------- Pilih varian / satuan (AC-01.7, AC-01.8) ----------
  const openPicker = useCallback(async (product: Product) => {
    setPicker(product);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      if (offline) {
        // Offline: varian & satuan sudah tertanam di objek produk (dari IDB)
        setDetail({
          product,
          stockOnHand: product.stockOnHand,
          variants: product.variants ?? [],
          units: product.units ?? [],
        });
        return;
      }
      const d = await api.get<ProductDetail>(`/products/${product.id}`);
      setDetail(d);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Gagal memuat detail produk");
    } finally {
      setDetailLoading(false);
    }
  }, [offline]);

  function handleCardTap(product: Product) {
    if (product.hasVariants || (product.units && product.units.length > 0)) {
      openPicker(product);
      return;
    }
    onAdd({ product });
  }

  // Scanner hardware selalu fokus (AC-01.6) — kecuali modal/sheet terbuka
  function handleScanBlur() {
    setTimeout(() => {
      if (document.querySelector('[role="dialog"]')) return;
      if (document.querySelector('[data-slot="sheet-content"]')) return;
      scanRef.current?.focus();
    }, 150);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Scan barcode + kategori */}
      <div className="grid gap-2 lg:grid-cols-[1fr_200px]">
        <form onSubmit={onBarcodeSubmit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanBarcode className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={scanRef}
              value={barcodeInput}
              onChange={(e) => onBarcodeInputChange(e.target.value)}
              onBlur={handleScanBlur}
              placeholder="Scan barcode / ketik SKU, lalu Enter…"
              className="h-12 pl-9 font-mono"
              autoFocus
              autoComplete="off"
            />
            {barcodeBusy && (
              <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
        </form>
        <Select value={categoryId} onValueChange={onCategoryChange}>
          <SelectTrigger className="h-12">
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
        {loading ? (
          /* State: loading */
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          /* State: error */
          <div className="flex h-full items-center justify-center p-6">
            <InlineError message={error} onRetry={onRetry} />
          </div>
        ) : products.length === 0 ? (
          /* State: kosong */
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <PackageSearch className="size-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">Produk tidak ditemukan</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Coba kata kunci lain atau ubah kategori. Produk nonaktif tidak tampil di kasir.
            </p>
          </div>
        ) : (
          /* State: data */
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {products.map((p) => {
              const out = p.stockOnHand <= 0 && p.trackStock !== false;
              const lowStock = !out && p.stockOnHand <= p.minStock && p.trackStock !== false;
              const isService = p.trackStock === false;
              return (
                <button
                  key={p.id}
                  disabled={out}
                  onClick={() => handleCardTap(p)}
                  className={cn(
                    "group flex min-h-[88px] flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all active:scale-[0.98]",
                    out
                      ? "cursor-not-allowed opacity-50"
                      : "hover:border-primary/50 hover:bg-accent/40"
                  )}
                >
                  <div className="flex w-full items-start justify-between gap-1">
                    <p className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</p>
                    {p.hasVariants && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        {p.variantCount ?? "varian"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold tabular-nums">{formatIDR(p.sellingPrice)}</p>
                  <div className="mt-auto flex w-full items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-muted-foreground">
                      {p.category?.name ?? ""}
                    </span>
                    <Badge
                      variant={
                        out ? "destructive" : lowStock ? "secondary" : "outline"
                      }
                      className={cn("shrink-0 text-[10px]", out && "bg-destructive text-destructive-foreground")}
                    >
                      {isService
                        ? "Jasa"
                        : out
                          ? "Habis"
                          : `${formatNumber(p.stockOnHand)} ${p.unit}`}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Sentinel infinite scroll */}
        {!loading && !error && products.length > 0 && hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-3">
            {loadingMore ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-[10px] text-muted-foreground">gulir untuk memuat lagi…</span>
            )}
          </div>
        )}
      </div>

      {/* Modal pilih varian / satuan */}
      <ProductPickerDialog
        product={picker}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onRetry={() => picker && openPicker(picker)}
        onClose={() => {
          setPicker(null);
          setDetail(null);
        }}
        onSelect={(opts) => {
          onAdd(opts);
          setPicker(null);
          setDetail(null);
          toast.success(`"${opts.product.name}" ditambahkan`);
        }}
      />
    </div>
  );
}
