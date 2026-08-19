"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  ClipboardEdit,
  Eye,
  Plus,
  Search,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CardSkeleton } from "@/components/shared/skeletons";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { TransferForm } from "@/components/warehouses/transfer-form";
import { AdjustmentForm } from "@/components/warehouses/adjustment-form";
import { WarehouseFormDialog } from "@/components/warehouses/warehouse-form-dialog";
import { api, ApiError } from "@/lib/api";
import { cn, debounce, formatNumber } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Warehouse } from "@/lib/types-warehouse";

function utilizationPercent(w: Warehouse): number | null {
  if (!w.capacity || w.capacity <= 0) return null;
  return Math.min(100, Math.round((w.totalQty / w.capacity) * 100));
}

function UtilizationBar({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  const color =
    percent >= 90
      ? "bg-destructive"
      : percent >= 70
        ? "bg-warning"
        : "bg-success";
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
        <span>Pemanfaatan Kapasitas</span>
        <span className="font-mono font-medium">{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-smooth", color)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function WarehouseCard({
  warehouse,
  onTransfer,
}: {
  warehouse: Warehouse;
  onTransfer: (whId: string) => void;
}) {
  const usage = utilizationPercent(warehouse);
  return (
    <Card className="overflow-hidden transition-smooth hover:border-accent/30">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-muted">
              <WarehouseIcon className="size-5 text-accent" />
            </div>
            <div className="min-w-0">
              <Link
                href={`/warehouses/${warehouse.id}`}
                className="block truncate text-sm font-semibold hover:text-accent transition-smooth"
              >
                {warehouse.name}
              </Link>
              <p className="text-xs text-muted-foreground">{warehouse.code}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {warehouse.isDefault && (
              <Badge className="bg-accent text-background">Default</Badge>
            )}
            <Badge variant={warehouse.isActive ? "outline" : "secondary"} className={cn(
              warehouse.isActive && "border-success-subtle bg-success-subtle text-success"
            )}>
              {warehouse.isActive ? "Aktif" : "Non-aktif"}
            </Badge>
          </div>
        </div>

        <p className="mb-3 line-clamp-1 text-xs text-muted-foreground">
          {warehouse.address || "—"}
        </p>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-lg font-bold">{formatNumber(warehouse.itemCount)}</p>
            <p className="text-[10px] text-muted-foreground">SKU</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-lg font-bold">{formatNumber(warehouse.totalQty)}</p>
            <p className="text-[10px] text-muted-foreground">Total Item</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-lg font-bold">{formatNumber(warehouse.capacity)}</p>
            <p className="text-[10px] text-muted-foreground">Kapasitas</p>
          </div>
        </div>

        <UtilizationBar percent={usage} />

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <p className="truncate text-xs text-muted-foreground">
            PIC: {warehouse.pic || "—"}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" className="min-h-11 px-2.5" asChild>
              <Link href={`/warehouses/${warehouse.id}`}>
                <Eye className="mr-1 size-3.5" /> Detail
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 px-2.5" onClick={() => onTransfer(warehouse.id)}>
              <ArrowRightLeft className="mr-1 size-3.5" /> Transfer
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WarehousesPage() {
  const { isManager } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [lowStockTotal, setLowStockTotal] = useState<number | null>(null);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferFrom, setTransferFrom] = useState<string | undefined>(undefined);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ items: Warehouse[]; meta: { total: number } }>(
        "/warehouses",
        {
          q: search.trim() || undefined,
          includeInactive: isManager ? "true" : undefined,
          page: 1,
          perPage: 100,
        }
      );
      setWarehouses(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat daftar gudang");
    } finally {
      setLoading(false);
    }
  }, [search, isManager]);

  // Statistik global: stok menipis (manager+ via /reports/low-stock)
  useEffect(() => {
    if (!isManager) return;
    api
      .get<{ rows: unknown[]; meta: { total: number } }>("/reports/low-stock", { page: 1, perPage: 1 })
      .then((d) => setLowStockTotal(d.meta.total))
      .catch(() => setLowStockTotal(null));
  }, [isManager]);

  useEffect(() => {
    const run = debounce(load, 300);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [load]);

  const stats = useMemo(
    () =>
      warehouses.reduce(
        (acc, w) => ({
          active: acc.active + (w.isActive ? 1 : 0),
          sku: acc.sku + w.itemCount,
          qty: acc.qty + w.totalQty,
        }),
        { active: 0, sku: 0, qty: 0 }
      ),
    [warehouses]
  );

  function openTransfer(presetFrom?: string) {
    setTransferFrom(presetFrom);
    setTransferOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Gudang"
        description={`${formatNumber(stats.active)} gudang aktif · ${formatNumber(stats.sku)} SKU · ${formatNumber(stats.qty)} item stok`}
        actions={
          isManager ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 size-3.5" /> Tambah Gudang
            </Button>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Gudang Aktif</p>
          <p className="mt-1 text-xl font-bold">{formatNumber(stats.active)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total SKU</p>
          <p className="mt-1 text-xl font-bold">{formatNumber(stats.sku)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Item Stok</p>
          <p className="mt-1 text-xl font-bold">{formatNumber(stats.qty)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Stok Menipis</p>
          <p className={cn("mt-1 text-xl font-bold", (lowStockTotal ?? 0) > 0 && "text-warning")}>
            {isManager && lowStockTotal !== null ? formatNumber(lowStockTotal) : "—"}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Cari gudang (nama / kode / PIC)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-11 pl-9"
        />
      </div>

      {/* Content — 4 states */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Gagal memuat gudang"
          description={error}
          onRetry={load}
        />
      ) : warehouses.length === 0 ? (
        <EmptyState
          title="Tidak ada gudang"
          description={
            search
              ? `Tidak ada gudang cocok dengan "${search}". Coba kata kunci lain.`
              : "Belum ada gudang yang didaftarkan. Buat gudang pertama untuk mulai menyimpan stok."
          }
          action={
            isManager ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 size-3.5" /> Tambah Gudang
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {warehouses.map((warehouse) => (
            <WarehouseCard
              key={warehouse.id}
              warehouse={warehouse}
              onTransfer={(whId) => openTransfer(whId)}
            />
          ))}
        </div>
      )}

      {/* Aksi cepat: transfer & koreksi */}
      {isManager && !loading && !error && (
        <div className="mt-8 grid grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => openTransfer(undefined)}
            className="group rounded-xl border border-border bg-card p-4 text-left transition-smooth hover:border-accent/30"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                <ArrowRightLeft className="size-5 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Transfer Stok</p>
                <p className="text-xs text-muted-foreground">Pindah stok antar gudang (multi-item)</p>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setAdjustOpen(true)}
            className="group rounded-xl border border-border bg-card p-4 text-left transition-smooth hover:border-accent/30"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-muted">
                <ClipboardEdit className="size-5 text-success" />
              </div>
              <div>
                <p className="text-sm font-medium">Koreksi Stok</p>
                <p className="text-xs text-muted-foreground">Adjust stok manual dengan alasan</p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Dialogs */}
      {isManager && (
        <>
          <TransferForm
            open={transferOpen}
            onOpenChange={setTransferOpen}
            onSaved={load}
            presetFrom={transferFrom}
          />
          <AdjustmentForm
            open={adjustOpen}
            onOpenChange={setAdjustOpen}
            onSaved={load}
          />
          <WarehouseFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onSaved={load}
          />
        </>
      )}
    </div>
  );
}
