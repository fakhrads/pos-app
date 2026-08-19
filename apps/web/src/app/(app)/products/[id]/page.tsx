"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  PackagePlus,
  Pencil,
  RefreshCw,
  Tags,
  Trash2,
  Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/shared/skeletons";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { StockBadge } from "@/components/products/stock-badge";
import { RowMenu } from "@/components/products/row-menu";
import { UnitConversionLabel } from "@/components/products/unit-conversion-label";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { VariantFormDialog } from "@/components/products/variant-form-dialog";
import { UnitFormDialog } from "@/components/products/unit-form-dialog";
import { StockAdjustDialog } from "@/components/products/stock-adjust-dialog";
import { api, ApiError } from "@/lib/api";
import {
  formatDateTime,
  formatIDR,
  formatNumber,
} from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type {
  Category,
  ProductDetail,
  ProductUnit,
  ProductVariant,
} from "@/lib/types";

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isManager, isAdmin } = useAuth();
  const canManage = isManager || isAdmin;

  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [editOpen, setEditOpen] = useState(false);
  const [variantForm, setVariantForm] = useState<{
    open: boolean;
    variant: ProductVariant | null;
  }>({ open: false, variant: null });
  const [unitForm, setUnitForm] = useState<{
    open: boolean;
    unit: ProductUnit | null;
  }>({ open: false, unit: null });
  const [stockTarget, setStockTarget] = useState<{
    id: string;
    name: string;
    unit: string;
    stockOnHand: number;
    kind: "product" | "variant";
  } | null>(null);
  // Konfirmasi
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    action: () => Promise<void> | void;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await api.get<ProductDetail>(`/products/${params.id}`);
      setDetail(data);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.code === "NOT_FOUND")) {
        setNotFound(true);
      } else {
        setError(err instanceof ApiError ? err.message : "Gagal memuat produk");
      }
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ items: Category[] }>("/categories")
      .then((d) => setCategories(d.items))
      .catch(() => {});
  }, []);

  // ---------- Aksi ----------
  async function toggleActive(p: { id: string; isActive: boolean }) {
    try {
      await api.patch(`/products/${p.id}`, { isActive: !p.isActive });
      toast.success(`${p.isActive ? "Produk dinonaktifkan" : "Produk diaktifkan"}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengubah status");
    }
  }

  async function toggleVariantActive(v: ProductVariant) {
    try {
      await api.patch(`/product-variants/${v.id}`, { isActive: !v.isActive });
      toast.success(
        `Varian ${v.name} ${v.isActive ? "dinonaktifkan" : "diaktifkan"}`
      );
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengubah status");
    }
  }

  async function deleteProduct() {
    if (!detail) return;
    try {
      await api.delete(`/products/${detail.product.id}`);
      toast.success("Produk dihapus");
      router.replace("/products");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus produk");
    }
  }

  async function deleteVariant(v: ProductVariant) {
    try {
      await api.delete(`/product-variants/${v.id}`);
      toast.success("Varian dinonaktifkan");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus varian");
    }
  }

  async function deleteUnit(u: ProductUnit) {
    try {
      await api.delete(`/product-units/${u.id}`);
      toast.success("Satuan dihapus");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus satuan");
    }
  }

  function askConfirm(
    title: string,
    description: string,
    action: () => Promise<void> | void
  ) {
    setConfirm({ title, description, action });
  }

  // ---------- Render ----------
  if (loading) {
    return (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-lg border border-border bg-surface-raised p-4">
              <Skeleton className="mb-4 h-4 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="mb-3 h-8 w-full" />
              ))}
            </div>
            <div className="rounded-lg border border-border bg-surface-raised p-4">
              <Skeleton className="mb-4 h-4 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="mb-3 h-8 w-full" />
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-raised p-4">
            <Skeleton className="mb-4 h-4 w-32" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="mb-3 h-8 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
        <AlertTriangle className="mb-4 size-12 text-warning" />
        <h3 className="text-base font-semibold text-text-primary">
          Produk tidak ditemukan
        </h3>
        <p className="mt-1 max-w-sm text-sm text-text-secondary">
          Produk mungkin sudah dihapus atau tautan salah.
        </p>
        <Button variant="outline" asChild className="mt-4 h-10">
          <Link href="/products">
            <ArrowLeft className="mr-2 size-3.5" />
            Kembali ke Produk
          </Link>
        </Button>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <ErrorState
        title="Gagal memuat produk"
        description="Cek koneksi internetmu, lalu coba lagi."
        onRetry={load}
      />
    );
  }

  const { product } = detail;
  const trackStock = product.trackStock !== false;
  const variants = detail.variants;
  const units = detail.units;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            asChild
          >
            <Link href="/products" aria-label="Kembali ke daftar produk">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {product.name}
              </h1>
              <Badge variant={product.isActive ? "default" : "outline"}>
                {product.isActive ? "Aktif" : "Nonaktif"}
              </Badge>
              {!trackStock && (
                <StockBadge stockOnHand={0} minStock={0} trackStock={false} />
              )}
            </div>
            <p className="mt-0.5 text-sm text-text-secondary">
              {product.category?.name ?? "-"} ·{" "}
              <span className="font-mono">{product.sku ?? "-"}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Desktop: tombol */}
          {canManage && (
            <div className="hidden flex-wrap gap-2 sm:flex">
              <Button
                variant="outline"
                className="h-10"
                onClick={() =>
                  setStockTarget({
                    id: product.id,
                    name: product.name,
                    unit: product.unit,
                    stockOnHand: product.stockOnHand,
                    kind: "product",
                  })
                }
              >
                <Warehouse className="size-4" />
                Koreksi Stok
              </Button>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-4" />
                Edit
              </Button>
              {isAdmin && (
                <Button
                  variant="outline"
                  className="h-10 text-danger hover:text-danger"
                  onClick={() =>
                    askConfirm(
                      "Hapus Produk?",
                      `Produk '${product.name}' akan dinonaktifkan dan tidak muncul di pencarian. Riwayat transaksi tetap tersimpan.`,
                      deleteProduct
                    )
                  }
                >
                  <Trash2 className="size-4" />
                  Hapus
                </Button>
              )}
            </div>
          )}
          {/* Mobile: menu ⋯ */}
          {canManage && (
            <div className="sm:hidden">
              <RowMenu
                label={`Aksi ${product.name}`}
                items={[
                  {
                    label: "Edit",
                    icon: <Pencil className="size-4" />,
                    onClick: () => setEditOpen(true),
                  },
                  {
                    label: "Koreksi Stok",
                    icon: <Warehouse className="size-4" />,
                    onClick: () =>
                      setStockTarget({
                        id: product.id,
                        name: product.name,
                        unit: product.unit,
                        stockOnHand: product.stockOnHand,
                        kind: "product",
                      }),
                  },
                  {
                    label: product.isActive ? "Nonaktifkan" : "Aktifkan",
                    icon: <Archive className="size-4" />,
                    onClick: () => toggleActive(product),
                  },
                  ...(isAdmin
                    ? [
                        {
                          label: "Hapus",
                          icon: <Trash2 className="size-4" />,
                          onClick: () =>
                            askConfirm(
                              "Hapus Produk?",
                              `Produk '${product.name}' akan dinonaktifkan dan tidak muncul di pencarian. Riwayat transaksi tetap tersimpan.`,
                              deleteProduct
                            ),
                          danger: true,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Kiri: Varian + Satuan */}
        <div className="space-y-4 lg:col-span-2">
          {/* Varian */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Tags className="size-4" />
                  Varian
                  {trackStock && variants.length > 0 && (
                    <Badge variant="secondary" className="bg-accent-subtle text-accent">
                      {formatNumber(variants.length)}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {trackStock
                    ? "Ukuran, rasa, atau warna dengan harga & stok sendiri."
                    : "Produk jasa"}
                </CardDescription>
              </div>
              {canManage && trackStock && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10"
                  onClick={() => setVariantForm({ open: true, variant: null })}
                >
                  <PackagePlus className="size-4" />
                  Tambah Varian
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {!trackStock ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-text-secondary">
                  Produk jasa tidak dapat memiliki varian.
                </p>
              ) : variants.length === 0 ? (
                <EmptyState
                  icon={<Tags className="size-6" />}
                  title="Belum ada varian"
                  description="Tambah ukuran, rasa, atau warna untuk produk ini."
                  action={
                    canManage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVariantForm({ open: true, variant: null })}
                      >
                        <PackagePlus className="size-4" />
                        Tambah Varian
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead>Kode</TableHead>
                        <TableHead className="text-right">Harga Jual</TableHead>
                        <TableHead className="text-right">Stok</TableHead>
                        {canManage && <TableHead className="w-14" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {variants.map((v) => (
                        <TableRow
                          key={v.id}
                          className={canManage ? "cursor-pointer hover:bg-muted/50" : undefined}
                          onClick={
                            canManage
                              ? () => setVariantForm({ open: true, variant: v })
                              : undefined
                          }
                          onKeyDown={
                            canManage
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setVariantForm({ open: true, variant: v });
                                  }
                                }
                              : undefined
                          }
                          tabIndex={canManage ? 0 : undefined}
                          aria-label={canManage ? `Edit varian ${v.name}` : undefined}
                        >
                          <TableCell>
                            <p
                              className={
                                v.isActive
                                  ? "font-medium"
                                  : "font-medium text-text-muted"
                              }
                            >
                              {v.name}
                            </p>
                            <p className="font-mono text-xs text-text-muted">
                              {v.barcode ?? ""}
                            </p>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-sm">{v.sku ?? "-"}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatIDR(v.sellingPrice)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-mono text-sm tabular-nums">
                                {formatNumber(v.stockOnHand)} {product.unit}
                              </span>
                              <StockBadge
                                stockOnHand={v.stockOnHand}
                                minStock={v.minStock}
                              />
                            </div>
                          </TableCell>
                          {canManage && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <RowMenu
                                label={`Aksi varian ${v.name}`}
                                items={[
                                  {
                                    label: "Edit",
                                    icon: <Pencil className="size-4" />,
                                    onClick: () =>
                                      setVariantForm({ open: true, variant: v }),
                                  },
                                  {
                                    label: "Koreksi Stok",
                                    icon: <Warehouse className="size-4" />,
                                    onClick: () =>
                                      setStockTarget({
                                        id: v.id,
                                        name: v.name,
                                        unit: product.unit,
                                        stockOnHand: v.stockOnHand,
                                        kind: "variant",
                                      }),
                                  },
                                  {
                                    label: v.isActive ? "Nonaktifkan" : "Aktifkan",
                                    icon: <Archive className="size-4" />,
                                    onClick: () => {
                                      if (v.isActive) {
                                        askConfirm(
                                          "Nonaktifkan Varian?",
                                          `Varian ${v.name} tidak muncul di pencarian kasir. Stok tetap tersimpan.`,
                                          () => toggleVariantActive(v)
                                        );
                                      } else {
                                        toggleVariantActive(v);
                                      }
                                    },
                                  },
                                  ...(isAdmin
                                    ? [
                                        {
                                          label: "Hapus",
                                          icon: <Trash2 className="size-4" />,
                                          onClick: () =>
                                            askConfirm(
                                              "Hapus Varian?",
                                              `Varian '${v.name}' akan dinonaktifkan. Riwayat transaksi tetap tersimpan.`,
                                              () => deleteVariant(v)
                                            ),
                                          danger: true,
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Satuan Tambahan */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-sm">Satuan Tambahan</CardTitle>
                <CardDescription>
                  Satuan besar seperti dus atau renceng untuk dijual di kasir.
                </CardDescription>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10"
                  onClick={() => setUnitForm({ open: true, unit: null })}
                >
                  <PackagePlus className="size-4" />
                  Tambah Satuan
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {units.length === 0 ? (
                <EmptyState
                  icon={<PackagePlus className="size-6" />}
                  title="Belum ada satuan tambahan"
                  description="Tambahkan dus, renceng, atau lusin agar kasir bisa menjual satuan besar."
                  action={
                    canManage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUnitForm({ open: true, unit: null })}
                      >
                        <PackagePlus className="size-4" />
                        Tambah Satuan
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="divide-y divide-border">
                  {units.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-sm font-medium">{u.unit}</p>
                          {u.isPurchaseUnit && (
                            <Badge variant="outline" className="border-info-subtle bg-info-subtle text-info">
                              Beli
                            </Badge>
                          )}
                        </div>
                        <UnitConversionLabel
                          unit={u.unit}
                          factor={u.factor}
                          baseUnit={product.unit}
                          className="text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm font-medium tabular-nums">
                          {formatIDR(u.sellPrice)}
                        </p>
                        {canManage && (
                          <RowMenu
                            label={`Aksi satuan ${u.unit}`}
                            items={[
                              {
                                label: "Edit",
                                icon: <Pencil className="size-4" />,
                                onClick: () => setUnitForm({ open: true, unit: u }),
                              },
                              {
                                label: "Hapus",
                                icon: <Trash2 className="size-4" />,
                                onClick: () =>
                                  askConfirm(
                                    "Hapus Satuan?",
                                    `Satuan '${u.unit}' akan dihapus permanen. Transaksi lama tetap memakai snapshot satuan.`,
                                    () => deleteUnit(u)
                                  ),
                                danger: true,
                              },
                            ]}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Kanan: Info Produk */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              Info Produk
              <Button variant="ghost" size="icon" className="size-10" onClick={load} aria-label="Muat ulang">
                <RefreshCw className="size-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-info-subtle bg-info-subtle/50 px-3 py-2.5">
              <p className="font-mono text-xl font-semibold tabular-nums">
                {formatNumber(product.stockOnHand)} {product.unit}
              </p>
              <p className="text-xs text-text-secondary">Stok Tersedia</p>
              {product.hasVariants && (
                <p className="mt-1 text-xs text-text-secondary">
                  Stok disimpan di tiap varian.
                </p>
              )}
            </div>

            <InfoRow
              label="Stok Minimum"
              value={`${formatNumber(product.minStock)} ${product.unit}`}
              mono
            />
            {canManage && (
              <InfoRow label="Harga Modal" value={formatIDR(product.costPrice)} mono />
            )}
            <InfoRow label="Harga Jual" value={formatIDR(product.sellingPrice)} mono />
            <InfoRow label="Satuan Dasar" value={product.unit} mono />
            <InfoRow label="Kena Pajak" value={product.isTaxable ? "Ya" : "Tidak"} />
            <InfoRow
              label="Kedaluwarsa"
              value={
                product.expiryDate
                  ? formatDateTime(product.expiryDate, { time: false })
                  : "—"
              }
            />
            <InfoRow
              label="Dibuat"
              value={
                product.createdAt
                  ? formatDateTime(product.createdAt, { time: false })
                  : "—"
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* ---------- Dialog ---------- */}
      <ProductFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        product={product}
        variants={variants}
        categories={categories}
        onSaved={() => {
          setEditOpen(false);
          load();
        }}
      />

      <VariantFormDialog
        open={variantForm.open}
        onOpenChange={(open) => setVariantForm((s) => ({ ...s, open }))}
        product={product}
        variant={variantForm.variant}
        onSaved={() => {
          setVariantForm({ open: false, variant: null });
          load();
        }}
      />

      <UnitFormDialog
        open={unitForm.open}
        onOpenChange={(open) => setUnitForm((s) => ({ ...s, open }))}
        product={product}
        unit={unitForm.unit}
        onSaved={() => {
          setUnitForm({ open: false, unit: null });
          load();
        }}
      />

      <StockAdjustDialog
        target={stockTarget}
        onClose={() => setStockTarget(null)}
        onSaved={() => {
          setStockTarget(null);
          load();
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmText={confirm?.title.startsWith("Hapus") ? "Hapus" : "Ya, Lanjutkan"}
        onConfirm={async () => {
          const fn = confirm?.action;
          setConfirm(null);
          if (fn) await fn();
        }}
      />
    </>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={mono ? "font-mono text-sm tabular-nums" : "text-sm font-medium"}>
        {value}
      </span>
    </div>
  );
}
