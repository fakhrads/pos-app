"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  ClipboardEdit,
  Download,
  Loader2,
  Package,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { PaginationControl } from "@/components/pagination-control";
import { WarehouseDetailSkeleton, TableSkeleton } from "@/components/shared/skeletons";
import { EmptyState, ErrorState, InlineError } from "@/components/shared/states";
import { StockBadge } from "@/components/products/stock-badge";
import { TransferForm } from "@/components/warehouses/transfer-form";
import {
  AdjustmentForm,
  type AdjustmentPreset,
} from "@/components/warehouses/adjustment-form";
import { api, ApiError } from "@/lib/api";
import { apiDownload } from "@/lib/download";
import { cn, debounce, formatDateTime, formatIDR, formatNumber } from "@/lib/utils";
import { fetchAllPages, parseStockKey, stockKey } from "@/lib/warehouse";
import { useAuth } from "@/providers/auth-provider";
import {
  MUTATION_TYPE_COLOR,
  MUTATION_TYPE_LABEL,
  type MovementType,
  type StockMovement,
  type Warehouse,
  type WarehouseStock,
} from "@/lib/types-warehouse";
import type { PaginationMeta } from "@/lib/types";

const MOVEMENT_TYPES = Object.keys(MUTATION_TYPE_LABEL) as MovementType[];

export default function WarehouseDetailPage() {
  const params = useParams<{ id: string }>();
  const warehouseId = params.id;
  const { isManager } = useAuth();

  // ---- data gudang (header) ----
  const [wh, setWh] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- tab aktif ----
  const [tab, setTab] = useState<"stocks" | "card">("stocks");

  // ---- tab stok ----
  const [stocks, setStocks] = useState<WarehouseStock[]>([]);
  const [stockMeta, setStockMeta] = useState<PaginationMeta | undefined>();
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [stockPage, setStockPage] = useState(1);
  const [stockLoading, setStockLoading] = useState(true);
  const [stockError, setStockError] = useState<string | null>(null);
  const [lowCount, setLowCount] = useState<number | null>(null);

  // ---- tab kartu stok ----
  const [allStocks, setAllStocks] = useState<WarehouseStock[]>([]);
  const [productKey, setProductKey] = useState("");
  const [movType, setMovType] = useState("all");
  const [movPage, setMovPage] = useState(1);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movMeta, setMovMeta] = useState<PaginationMeta | undefined>();
  const [movLoading, setMovLoading] = useState(false);
  const [movError, setMovError] = useState<string | null>(null);

  // ---- dialog ----
  const [transferOpen, setTransferOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustPreset, setAdjustPreset] = useState<AdjustmentPreset | null>(null);
  const [exporting, setExporting] = useState(false);

  const productOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: WarehouseStock[] = [];
    for (const s of allStocks) {
      const k = stockKey(s.productId, s.variantId);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }, [allStocks]);

  /* ---------------- loaders ---------------- */
  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{
        warehouse: Warehouse;
        isDefault: boolean;
        stockSummary: { itemCount: number; totalQty: number };
      }>(`/warehouses/${warehouseId}`);
      setWh({ ...data.warehouse, isDefault: data.isDefault, itemCount: data.stockSummary.itemCount, totalQty: data.stockSummary.totalQty });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat gudang");
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  const loadStocks = useCallback(async () => {
    setStockLoading(true);
    setStockError(null);
    try {
      const data = await api.get<{ items: WarehouseStock[]; meta: PaginationMeta }>(
        `/warehouses/${warehouseId}/stocks`,
        {
          q: q.trim() || undefined,
          lowStock: lowOnly || undefined,
          page: stockPage,
          perPage: 20,
        }
      );
      setStocks(data.items);
      setStockMeta(data.meta);
    } catch (err) {
      setStockError(err instanceof ApiError ? err.message : "Gagal memuat stok gudang");
    } finally {
      setStockLoading(false);
    }
  }, [warehouseId, q, lowOnly, stockPage]);

  const loadAllStocks = useCallback(async () => {
    try {
      const all = await fetchAllPages<WarehouseStock>(`/warehouses/${warehouseId}/stocks`, {
        includeInactiveProduct: true,
      });
      setAllStocks(all);
    } catch {
      // picker gagal — tabel utama tetap jalan; picker kosong
      setAllStocks([]);
    }
  }, [warehouseId]);

  const loadLowCount = useCallback(async () => {
    try {
      const data = await api.get<{ meta: PaginationMeta }>(`/warehouses/${warehouseId}/stocks`, {
        lowStock: true,
        perPage: 1,
      });
      setLowCount(data.meta.total);
    } catch {
      setLowCount(null);
    }
  }, [warehouseId]);

  const loadMovements = useCallback(async () => {
    if (!productKey) return;
    const { productId, variantId } = parseStockKey(productKey);
    setMovLoading(true);
    setMovError(null);
    try {
      const data = await api.get<{ items: StockMovement[]; meta: PaginationMeta }>(
        `/warehouses/${warehouseId}/stock-movements`,
        {
          productId,
          variantId: variantId ?? undefined,
          type: movType === "all" ? undefined : movType,
          page: movPage,
          perPage: 50,
        }
      );
      setMovements(data.items);
      setMovMeta(data.meta);
    } catch (err) {
      setMovError(err instanceof ApiError ? err.message : "Gagal memuat kartu stok");
      setMovements([]);
      setMovMeta(undefined);
    } finally {
      setMovLoading(false);
    }
  }, [warehouseId, productKey, movType, movPage]);

  /* ---------------- effects ---------------- */
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const run = debounce(loadStocks, 300);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [loadStocks]);

  useEffect(() => {
    setStockPage(1);
  }, [q, lowOnly]);

  useEffect(() => {
    loadAllStocks();
    loadLowCount();
  }, [loadAllStocks, loadLowCount]);

  useEffect(() => {
    loadMovements();
  }, [loadMovements]);

  useEffect(() => {
    setMovPage(1);
  }, [productKey, movType]);

  /* ---------------- actions ---------------- */
  function openAdjustFromRow(row: WarehouseStock) {
    setAdjustPreset({
      warehouseId,
      productId: row.productId,
      variantId: row.variantId ?? null,
      quantity: row.quantity,
      unit: row.unit,
      name: row.variantName ? `${row.name} · ${row.variantName}` : row.name,
    });
    setAdjustOpen(true);
  }

  async function handleExport() {
    if (!productKey) return;
    const { productId, variantId } = parseStockKey(productKey);
    setExporting(true);
    try {
      const params = new URLSearchParams({ productId });
      if (variantId) params.set("variantId", variantId);
      if (movType !== "all") params.set("type", movType);
      await apiDownload(
        `/warehouses/${warehouseId}/stock-movements/export?${params.toString()}`,
        `kartu-stok-${wh?.code ?? "gudang"}-${productId.slice(0, 8)}.csv`
      );
      toast.success("Export kartu stok selesai");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengekspor kartu stok");
    } finally {
      setExporting(false);
    }
  }

  /* ---------------- render ---------------- */
  if (loading) {
    return (
      <div>
        <PageHeader title="Gudang" description="Memuat detail gudang…" />
        <WarehouseDetailSkeleton />
      </div>
    );
  }

  if (error || !wh) {
    return (
      <div>
        <PageHeader title="Gudang" description="Detail gudang" />
        <ErrorState
          title="Gudang tidak ditemukan"
          description={error ?? "Gudang mungkin sudah dihapus."}
          onRetry={loadDetail}
        />
        <div className="text-center">
          <Button variant="outline" asChild>
            <Link href="/warehouses">
              <ArrowLeft className="mr-1 size-3.5" /> Kembali ke Daftar Gudang
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const usage =
    wh.capacity > 0 ? Math.min(100, Math.round((wh.totalQty / wh.capacity) * 100)) : null;

  return (
    <div>
      <PageHeader
        title={wh.name}
        description={`${wh.code} · ${wh.isDefault ? "Gudang default" : "Bukan default"}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/warehouses">
                <ArrowLeft className="mr-1 size-3.5" /> Kembali
              </Link>
            </Button>
            {isManager && (
              <>
                <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}>
                  <ArrowRightLeft className="mr-1 size-3.5" /> Transfer
                </Button>
                <Button size="sm" onClick={() => { setAdjustPreset(null); setAdjustOpen(true); }}>
                  <ClipboardEdit className="mr-1 size-3.5" /> Koreksi Stok
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Info gudang */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Alamat</p>
              <p className="mt-0.5 text-sm font-medium">{wh.address || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">PIC</p>
              <p className="mt-0.5 text-sm font-medium">{wh.pic || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Kapasitas</p>
              <p className="mt-0.5 text-sm font-medium">{formatNumber(wh.capacity)} unit</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant={wh.isActive ? "outline" : "secondary"} className={cn(wh.isActive && "border-success-subtle bg-success-subtle text-success")}>
                  {wh.isActive ? "Aktif" : "Non-aktif"}
                </Badge>
                {wh.isDefault && <Badge className="bg-accent text-background">Default</Badge>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ringkasan stok — qty saja (SPEC §1.2: detail gudang tidak menampilkan nilai uang) */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{formatNumber(wh.itemCount)}</p>
          <p className="text-xs text-muted-foreground">Total SKU</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{formatNumber(wh.totalQty)}</p>
          <p className="text-xs text-muted-foreground">Total Item</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className={cn("text-2xl font-bold", usage !== null && usage >= 90 && "text-destructive", usage !== null && usage >= 70 && usage < 90 && "text-warning")}>
            {usage !== null ? `${usage}%` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Kapasitas Terpakai</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className={cn("text-2xl font-bold", (lowCount ?? 0) > 0 && "text-warning")}>
            {lowCount !== null ? formatNumber(lowCount) : "—"}
          </p>
          <p className="text-xs text-muted-foreground">Stok Menipis</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "stocks" | "card")}>
        <TabsList>
          <TabsTrigger value="stocks">Stok Gudang</TabsTrigger>
          <TabsTrigger value="card">Kartu Stok / Mutasi</TabsTrigger>
        </TabsList>

        {/* ================= TAB STOK ================= */}
        <TabsContent value="stocks">
          <Card>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Package className="size-4" /> Produk di Gudang Ini
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Cari produk / SKU…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="h-10 w-56 pl-8"
                  />
                </div>
                <Button
                  variant={lowOnly ? "default" : "outline"}
                  size="sm"
                  className="h-10"
                  onClick={() => setLowOnly((v) => !v)}
                >
                  <Boxes className="mr-1 size-3.5" /> Stok Menipis
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {stockLoading ? (
                <TableSkeleton rows={6} />
              ) : stockError ? (
                <InlineError message={stockError} onRetry={loadStocks} />
              ) : stocks.length === 0 ? (
                <EmptyState
                  title={lowOnly ? "Tidak ada stok menipis" : "Belum ada produk di gudang ini"}
                  description={
                    lowOnly
                      ? "Semua stok di atas ambang batas. 🎉"
                      : "Stok muncul setelah produk pertama masuk ke gudang ini (transfer, koreksi, atau pembelian)."
                  }
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produk</TableHead>
                          <TableHead className="text-right">Stok</TableHead>
                          <TableHead className="text-right">Min Stok</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Harga Jual</TableHead>
                          {isManager && (
                            <TableHead className="text-right">Nilai Stok (beli)</TableHead>
                          )}
                          {isManager && <TableHead className="w-16" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stocks.map((s) => (
                          <TableRow key={stockKey(s.productId, s.variantId)}>
                            <TableCell>
                              <p className="font-medium">
                                {s.name}
                                {s.variantName && (
                                  <span className="text-muted-foreground"> · {s.variantName}</span>
                                )}
                              </p>
                              <p className="font-mono text-[11px] text-muted-foreground">{s.sku ?? "—"}</p>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(s.quantity)} <span className="text-[11px] text-muted-foreground">{s.unit}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {formatNumber(s.minStock)}
                            </TableCell>
                            <TableCell>
                              <StockBadge stockOnHand={s.quantity} minStock={s.minStock} />
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatIDR(s.sellingPrice)}</TableCell>
                            {isManager && (
                              <TableCell className="text-right font-mono">
                                {formatIDR((s.costPrice ?? 0) * s.quantity)}
                              </TableCell>
                            )}
                            {isManager && (
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-10 px-2 text-muted-foreground hover:text-accent"
                                  onClick={() => openAdjustFromRow(s)}
                                >
                                  Koreksi
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <PaginationControl meta={stockMeta} onPageChange={setStockPage} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TAB KARTU STOK ================= */}
        <TabsContent value="card">
          <Card>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Boxes className="size-4" /> Kartu Stok / Riwayat Mutasi
              </CardTitle>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Produk (wajib)</Label>
                  <Select value={productKey || undefined} onValueChange={setProductKey}>
                    <SelectTrigger className="min-h-10 w-64">
                      <SelectValue placeholder="Pilih produk untuk melihat mutasi" />
                    </SelectTrigger>
                    <SelectContent>
                      {productOptions.map((s) => (
                        <SelectItem key={stockKey(s.productId, s.variantId)} value={stockKey(s.productId, s.variantId)}>
                          {s.name}
                          {s.variantName ? ` · ${s.variantName}` : ""} ({s.sku ?? "—"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipe Mutasi</Label>
                  <Select value={movType} onValueChange={setMovType}>
                    <SelectTrigger className="min-h-10 w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Tipe</SelectItem>
                      {MOVEMENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {MUTATION_TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {isManager && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    onClick={handleExport}
                    disabled={!productKey || exporting}
                  >
                    {exporting ? (
                      <Loader2 className="mr-1 size-3.5 animate-spin" />
                    ) : (
                      <Download className="mr-1 size-3.5" />
                    )}
                    Export CSV
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!productKey ? (
                <EmptyState
                  icon={<Boxes className="size-10 text-muted-foreground" />}
                  title="Pilih produk dulu"
                  description="Kartu stok menampilkan seluruh mutasi (penjualan, transfer, koreksi) satu produk di gudang ini. Read-only."
                />
              ) : movLoading ? (
                <TableSkeleton rows={8} />
              ) : movError ? (
                <InlineError message={movError} onRetry={loadMovements} />
              ) : movements.length === 0 ? (
                <EmptyState title="Belum ada mutasi" description="Tidak ada perubahan stok untuk produk ini di gudang ini." />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tanggal</TableHead>
                          <TableHead>Tipe</TableHead>
                          <TableHead className="text-right">Perubahan</TableHead>
                          <TableHead className="text-right">Sebelum</TableHead>
                          <TableHead className="text-right">Sesudah</TableHead>
                          <TableHead>Referensi</TableHead>
                          <TableHead>Catatan</TableHead>
                          <TableHead>Oleh</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movements.map((m) => {
                          const in_ = m.afterQty >= m.beforeQty;
                          return (
                            <TableRow key={m.id}>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {formatDateTime(m.createdAt)}
                              </TableCell>
                              <TableCell>
                                <span className={cn("text-xs font-medium", MUTATION_TYPE_COLOR[m.type])}>
                                  {m.typeLabel}
                                </span>
                              </TableCell>
                              <TableCell className={cn("text-right font-mono", in_ ? "text-success" : "text-destructive")}>
                                {in_ ? "+" : "−"}
                                {formatNumber(m.quantity)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {formatNumber(m.beforeQty)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatNumber(m.afterQty)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {m.reference ?? "—"}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                                {m.note ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {m.createdBy?.name ?? "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <PaginationControl meta={movMeta} onPageChange={setMovPage} />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {isManager && (
        <>
          <TransferForm
            open={transferOpen}
            onOpenChange={setTransferOpen}
            onSaved={() => {
              loadDetail();
              loadStocks();
              loadAllStocks();
              loadLowCount();
            }}
            presetFrom={warehouseId}
          />
          <AdjustmentForm
            open={adjustOpen}
            onOpenChange={setAdjustOpen}
            onSaved={() => {
              loadDetail();
              loadStocks();
              loadAllStocks();
              loadLowCount();
              if (productKey) loadMovements();
            }}
            preset={adjustPreset}
          />
        </>
      )}
    </div>
  );
}
