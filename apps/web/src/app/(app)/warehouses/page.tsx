"use client";

import Link from "next/link";
import { useState } from "react";
import { Boxes, Edit, Eye, Plus, Search, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { formatIDR } from "@/lib/utils";
import { WAREHOUSES, WAREHOUSE_STOCKS, WAREHOUSE_STATS } from "@/data/warehouses";
import type { Warehouse as WarehouseType } from "@/lib/types-warehouse";

const STATUS_COLORS = {
  active: "bg-success-muted text-success",
  inactive: "bg-muted text-muted-foreground",
};

function WarehouseCard({ warehouse }: { warehouse: WarehouseType }) {
  const stockCount = WAREHOUSE_STOCKS.filter(
    (s) => s.warehouseId === warehouse.id
  ).length;
  const totalValue = WAREHOUSE_STOCKS.filter(
    (s) => s.warehouseId === warehouse.id
  ).reduce(
    (sum, s) => sum + (s.product?.costPrice ?? 0) * s.quantity,
    0
  );

  return (
    <Card className="overflow-hidden transition-smooth hover:border-accent/30">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent-muted">
              <Warehouse className="size-5 text-accent" />
            </div>
            <div>
              <Link
                href={`/warehouses/${warehouse.id}`}
                className="text-sm font-semibold hover:text-accent transition-smooth"
              >
                {warehouse.name}
              </Link>
              <p className="text-xs text-muted-foreground">{warehouse.code}</p>
            </div>
          </div>
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
              warehouse.isActive ? STATUS_COLORS.active : STATUS_COLORS.inactive
            }`}
          >
            {warehouse.isActive ? "Aktif" : "Non-aktif"}
          </span>
        </div>

        <p className="text-xs text-muted-foreground mb-3 line-clamp-1">
          {warehouse.address}
        </p>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-lg font-bold">{stockCount}</p>
            <p className="text-[10px] text-muted-foreground">SKU</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-lg font-bold">{warehouse.capacity.toLocaleString("id-ID")}</p>
            <p className="text-[10px] text-muted-foreground">Kapasitas</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-sm font-bold">{formatIDR(totalValue)}</p>
            <p className="text-[10px] text-muted-foreground">Nilai Stok</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">PIC: {warehouse.pic}</p>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="size-7" asChild>
              <Link href={`/warehouses/${warehouse.id}`}>
                <Eye className="size-3.5" />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="size-7">
              <Edit className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WarehousesPage() {
  const [search, setSearch] = useState("");

  const filtered = WAREHOUSES.filter(
    (w) =>
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.code.toLowerCase().includes(search.toLowerCase()) ||
      (w.pic ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Gudang"
        description={`${WAREHOUSE_STATS.activeWarehouses} gudang aktif · ${WAREHOUSE_STATS.totalProducts} produk`}
        actions={
          <Button size="sm">
            <Plus className="mr-1 size-3.5" /> Tambah Gudang
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total Nilai Stok</p>
          <p className="text-xl font-bold mt-1">{formatIDR(WAREHOUSE_STATS.totalStockValue)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Transfer Bulan Ini</p>
          <p className="text-xl font-bold mt-1">{WAREHOUSE_STATS.totalTransfers}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Adjustment Bulan Ini</p>
          <p className="text-xl font-bold mt-1">{WAREHOUSE_STATS.totalAdjustments}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Cari gudang..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Tidak ada gudang"
          description={search ? "Coba kata kunci lain" : "Belum ada gudang yang didaftarkan"}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((warehouse) => (
            <WarehouseCard key={warehouse.id} warehouse={warehouse} />
          ))}
        </div>
      )}

      {/* Quick Links */}
      <div className="mt-8 grid grid-cols-2 gap-4">
        <Link href="/warehouses?tab=transfers">
          <Card className="transition-smooth hover:border-accent/30 cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10">
                <Warehouse className="size-5 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Transfer Stok</p>
                <p className="text-xs text-muted-foreground">Pindah stok antar gudang</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/warehouses?tab=mutations">
          <Card className="transition-smooth hover:border-accent/30 cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-success-muted">
                <Boxes className="size-5 text-success" />
              </div>
              <div>
                <p className="text-sm font-medium">Riwayat Mutasi</p>
                <p className="text-xs text-muted-foreground">Log semua pergerakan stok</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
