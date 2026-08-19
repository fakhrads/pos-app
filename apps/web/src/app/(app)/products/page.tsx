"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Archive,
  FileDown,
  FileUp,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
  Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/shared/skeletons";
import { PageHeader } from "@/components/page-header";
import { PaginationControl } from "@/components/pagination-control";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StockBadge } from "@/components/products/stock-badge";
import { RowMenu } from "@/components/products/row-menu";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { StockAdjustDialog } from "@/components/products/stock-adjust-dialog";
import { ImportDialog } from "@/components/products/import-dialog";
import { api, ApiError } from "@/lib/api";
import { apiDownload } from "@/lib/download";
import { cn, debounce, formatIDR, formatNumber, todayWIB } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type {
  Category,
  Paginated,
  PaginationMeta,
  Product,
} from "@/lib/types";

export default function ProductsPage() {
  const { isManager, isAdmin } = useAuth();
  const canManage = isManager || isAdmin;

  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | undefined>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all"); // all | barang | jasa
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<{
    id: string;
    name: string;
    unit: string;
    stockOnHand: number;
    kind: "product";
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Paginated<Product>>("/products", {
        q: search || undefined,
        categoryId: categoryId === "all" ? undefined : categoryId,
        isActive: status === "all" ? undefined : status === "active",
        trackStock:
          type === "all" ? undefined : type === "jasa" ? false : true,
        page,
        perPage: 20,
      });
      setItems(data.items);
      setMeta(data.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat produk");
    } finally {
      setLoading(false);
    }
  }, [search, categoryId, status, type, page]);

  useEffect(() => {
    api
      .get<{ items: Category[] }>("/categories")
      .then((d) => setCategories(d.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const run = debounce(load, 300);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [load]);

  useEffect(() => setPage(1), [search, categoryId, status, type]);

  const isFiltered =
    search.trim() !== "" || categoryId !== "all" || status !== "all" || type !== "all";

  function resetFilters() {
    setSearch("");
    setCategoryId("all");
    setStatus("all");
    setType("all");
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const filename = `produk-${todayWIB()}.xlsx`;
      await apiDownload("/products/export", filename);
      toast.success(`Export selesai — ${filename}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Gagal mengekspor. Pastikan kamu punya izin manager."
      );
    } finally {
      setExporting(false);
    }
  }

  async function toggleActive(p: Product) {
    try {
      await api.patch(`/products/${p.id}`, { isActive: !p.isActive });
      toast.success(
        `${p.name} ${p.isActive ? "dinonaktifkan" : "diaktifkan"}`
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengubah status");
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/products/${deleting.id}`);
      toast.success("Produk dihapus");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus produk");
    }
  }

  const start = meta ? (meta.page - 1) * meta.perPage + 1 : 0;
  const end = meta ? Math.min(meta.page * meta.perPage, meta.total) : 0;

  return (
    <>
      <PageHeader
        title="Produk"
        description="Kelola barang, varian, dan satuan."
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-12 sm:h-10"
                onClick={() => setImportOpen(true)}
              >
                <FileUp className="size-4" />
                Import Excel
              </Button>
              <Button
                variant="outline"
                className="h-12 sm:h-10"
                onClick={handleExport}
                disabled={exporting}
              >
                <FileDown className="size-4" />
                {exporting ? "Mengekspor…" : "Export Excel"}
              </Button>
              <Button
                className="h-12 sm:h-10"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <PackagePlus className="size-4" />
                Tambah Produk
              </Button>
            </div>
          )
        }
      />

      {/* Filter */}
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_160px_150px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder="Cari produk, kode, atau barcode…"
            className="h-12 pl-9 sm:h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={categoryId}
          onValueChange={setCategoryId}
          disabled={loading}
        >
          <SelectTrigger className="h-12 w-full sm:h-10">
            <SelectValue placeholder="Semua Kategori" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Kategori</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus} disabled={loading}>
          <SelectTrigger className="h-12 w-full sm:h-10">
            <SelectValue placeholder="Semua Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="inactive">Nonaktif</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType} disabled={loading}>
          <SelectTrigger className="h-12 w-full sm:h-10">
            <SelectValue placeholder="Semua" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Tipe</SelectItem>
            <SelectItem value="barang">Barang</SelectItem>
            <SelectItem value="jasa">Jasa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading skeleton — desktop: tabel 6 baris, mobile: 4 kartu h-28 */}
      {loading ? (
        <div className="rounded-lg border bg-card">
          <div className="hidden space-y-3 p-4 md:block" aria-hidden>
            <div className="flex gap-4 border-b border-border pb-2">
              <Skeleton className="h-3 w-1/5" />
              <Skeleton className="h-3 w-1/5" />
              <Skeleton className="h-3 w-1/5" />
              <Skeleton className="h-3 w-1/5" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-2">
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-4 w-1/5" />
                <Skeleton className="h-4 w-1/5" />
                <Skeleton className="h-4 w-1/5" />
                <Skeleton className="h-4 w-1/5" />
              </div>
            ))}
          </div>
          <div className="space-y-3 p-4 md:hidden" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        </div>
      ) : error ? (
        <ErrorState
          title="Gagal memuat produk"
          description="Cek koneksi internetmu, lalu coba lagi."
          onRetry={load}
        />
      ) : items.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={<Search className="size-6" />}
            title="Produk tidak ditemukan"
            description="Coba kata kunci, kode, atau barcode lain."
            action={
              <Button variant="outline" onClick={resetFilters}>
                Hapus Pencarian
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<PackagePlus className="size-6" />}
            title="Belum ada produk"
            description={
              canManage
                ? "Tambahkan produk pertamamu untuk mulai berjualan."
                : "Hubungi pengelola untuk menambah produk."
            }
            action={
              canManage ? (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  Tambah Produk
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="rounded-lg border bg-card">
          {/* Desktop: tabel */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="hidden lg:table-cell">Kategori</TableHead>
                  <TableHead className="text-right">Harga Jual</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-center">Varian</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="w-14" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  const trackStock = p.trackStock !== false;
                  return (
                    <TableRow key={p.id} className="relative hover:bg-muted/50">
                      <TableCell>
                        <Link
                          href={`/products/${p.id}`}
                          className={cn(
                            "block min-w-0 after:absolute after:inset-0 focus-visible:outline-none",
                            !p.isActive && "opacity-60"
                          )}
                        >
                          <span className="block truncate font-medium">
                            {p.name}
                          </span>
                          <span className="block font-mono text-xs text-text-muted">
                            {p.sku ?? "-"}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {p.category?.name ?? "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatIDR(p.sellingPrice)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {trackStock ? (
                            <>
                              <span className="font-mono text-sm tabular-nums">
                                {formatNumber(p.stockOnHand)} {p.unit}
                              </span>
                              <StockBadge
                                stockOnHand={p.stockOnHand}
                                minStock={p.minStock}
                              />
                            </>
                          ) : (
                            <StockBadge stockOnHand={0} minStock={0} trackStock={false} />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {trackStock ? (
                          p.hasVariants ? (
                            <Badge variant="secondary" className="bg-accent-subtle text-accent">
                              <Tags className="size-3" />
                              {formatNumber(p.variantCount ?? 0)} varian
                            </Badge>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.isActive ? "default" : "outline"}>
                          {p.isActive ? "Aktif" : "Nonaktif"}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="relative z-10">
                          <RowMenu
                            label={`Aksi ${p.name}`}
                            items={[
                              {
                                label: "Edit",
                                icon: <Pencil className="size-4" />,
                                onClick: () => {
                                  setEditing(p);
                                  setFormOpen(true);
                                },
                              },
                              {
                                label: "Koreksi Stok",
                                icon: <Warehouse className="size-4" />,
                                onClick: () =>
                                  setAdjusting({
                                    id: p.id,
                                    name: p.name,
                                    unit: p.unit,
                                    stockOnHand: p.stockOnHand,
                                    kind: "product",
                                  }),
                              },
                              {
                                label: p.isActive ? "Nonaktifkan" : "Aktifkan",
                                icon: <Archive className="size-4" />,
                                onClick: () => toggleActive(p),
                              },
                              ...(isAdmin
                                ? [
                                    {
                                      label: "Hapus",
                                      icon: <Trash2 className="size-4" />,
                                      onClick: () => setDeleting(p),
                                      danger: true,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: kartu */}
          <ul className="divide-y divide-border md:hidden">
            {items.map((p) => {
              const trackStock = p.trackStock !== false;
              return (
                <li key={p.id}>
                  <Link
                    href={`/products/${p.id}`}
                    className={cn(
                      "block p-3 transition-transform active:scale-[0.99]",
                      !p.isActive && "opacity-60"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="font-mono text-xs text-text-muted">
                          {[p.sku, p.category?.name].filter(Boolean).join(" · ") || "-"}
                        </p>
                        <p className="mt-1 font-mono text-sm font-semibold tabular-nums">
                          {formatIDR(p.sellingPrice)}
                        </p>
                      </div>
                      {canManage && (
                        <div
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          className="shrink-0"
                        >
                          <RowMenu
                            label={`Aksi ${p.name}`}
                            items={[
                              {
                                label: "Edit",
                                icon: <Pencil className="size-4" />,
                                onClick: () => {
                                  setEditing(p);
                                  setFormOpen(true);
                                },
                              },
                              {
                                label: "Koreksi Stok",
                                icon: <Warehouse className="size-4" />,
                                onClick: () =>
                                  setAdjusting({
                                    id: p.id,
                                    name: p.name,
                                    unit: p.unit,
                                    stockOnHand: p.stockOnHand,
                                    kind: "product",
                                  }),
                              },
                              {
                                label: p.isActive ? "Nonaktifkan" : "Aktifkan",
                                icon: <Archive className="size-4" />,
                                onClick: () => toggleActive(p),
                              },
                              ...(isAdmin
                                ? [
                                    {
                                      label: "Hapus",
                                      icon: <Trash2 className="size-4" />,
                                      onClick: () => setDeleting(p),
                                      danger: true,
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {trackStock ? (
                        <>
                          <Badge variant="outline" className="font-mono tabular-nums">
                            {formatNumber(p.stockOnHand)} {p.unit}
                          </Badge>
                          <StockBadge
                            stockOnHand={p.stockOnHand}
                            minStock={p.minStock}
                          />
                        </>
                      ) : (
                        <StockBadge stockOnHand={0} minStock={0} trackStock={false} />
                      )}
                      {trackStock && p.hasVariants && (
                        <Badge variant="secondary" className="bg-accent-subtle text-accent">
                          <Tags className="size-3" />
                          {formatNumber(p.variantCount ?? 0)} varian
                        </Badge>
                      )}
                      <Badge variant={p.isActive ? "default" : "outline"}>
                        {p.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {meta && meta.total > 0 && (
            <div className="flex flex-col gap-1 px-4 pb-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-text-muted">
                Menampilkan {formatNumber(start)}–{formatNumber(end)} dari{" "}
                {formatNumber(meta.total)} produk
              </p>
              <PaginationControl meta={meta} onPageChange={setPage} />
            </div>
          )}
        </div>
      )}

      {/* Dialog & konfirmasi */}
      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categories}
        onSaved={() => {
          setFormOpen(false);
          load();
        }}
      />

      <StockAdjustDialog
        target={adjusting}
        onClose={() => setAdjusting(null)}
        onSaved={() => {
          setAdjusting(null);
          load();
        }}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          setImportOpen(false);
          load();
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus Produk?"
        description={`Produk '${deleting?.name ?? ""}' akan dinonaktifkan dan tidak muncul di pencarian. Riwayat transaksi tetap tersimpan.`}
        confirmText="Hapus"
        cancelText="Batal"
        onConfirm={handleDelete}
      />
    </>
  );
}
