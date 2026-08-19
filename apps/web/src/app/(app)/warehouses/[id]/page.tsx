"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Boxes, Edit, Package, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { formatDateTime, formatIDR, formatNumber } from "@/lib/utils";
import { WAREHOUSES, WAREHOUSE_STOCKS, STOCK_MUTATIONS } from "@/data/warehouses";
import { PRODUCTS } from "@/data/products";
import { MUTATION_TYPE_LABEL, MUTATION_TYPE_COLOR } from "@/lib/types-warehouse";

export default function WarehouseDetailPage() {
  const params = useParams();
  const warehouseId = params.id as string;
  const warehouse = WAREHOUSES.find((w) => w.id === warehouseId);

  if (!warehouse) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Gudang tidak ditemukan</p>
        <Button variant="ghost" asChild className="mt-4">
          <Link href="/warehouses">Kembali</Link>
        </Button>
      </div>
    );
  }

  const stocks = WAREHOUSE_STOCKS.filter((s) => s.warehouseId === warehouseId);
  const mutations = STOCK_MUTATIONS.filter((m) => m.warehouseId === warehouseId);

  const totalSKU = stocks.length;
  const totalValue = stocks.reduce(
    (sum, s) => sum + (s.product?.costPrice ?? 0) * s.quantity,
    0
  );
  const totalItems = stocks.reduce((sum, s) => sum + s.quantity, 0);
  const lowStockCount = stocks.filter(
    (s) => s.quantity > 0 && s.quantity < s.minStock
  ).length;

  return (
    <div>
      <PageHeader
        title={warehouse.name}
        description={warehouse.code}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/warehouses">
                <ArrowLeft className="mr-1 size-3.5" /> Kembali
              </Link>
            </Button>
            <Button size="sm">
              <Edit className="mr-1 size-3.5" /> Edit
            </Button>
          </>
        }
      />

      {/* Info Card */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Alamat</p>
              <p className="text-sm font-medium mt-0.5">{warehouse.address}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">PIC</p>
              <p className="text-sm font-medium mt-0.5">{warehouse.pic}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Kapasitas</p>
              <p className="text-sm font-medium mt-0.5">{warehouse.capacity.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <span
                className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${
                  warehouse.isActive
                    ? "bg-success-muted text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {warehouse.isActive ? "Aktif" : "Non-aktif"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalSKU}</p>
            <p className="text-xs text-muted-foreground">Total SKU</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalItems}</p>
            <p className="text-xs text-muted-foreground">Total Item</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{formatIDR(totalValue)}</p>
            <p className="text-xs text-muted-foreground">Nilai Stok</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-warning">{lowStockCount}</p>
            <p className="text-xs text-muted-foreground">Stok Menipis</p>
          </CardContent>
        </Card>
      </div>

      {/* Product List */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Package className="size-4" /> Produk di Gudang Ini
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stocks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Belum ada produk di gudang ini</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">SKU</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Produk</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Stok</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Min Stok</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((s) => {
                    const isLow = s.quantity > 0 && s.quantity < s.minStock;
                    const isOut = s.quantity === 0;
                    return (
                      <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">
                          {s.product?.sku ?? "-"}
                        </td>
                        <td className="py-2.5 px-3 font-medium">{s.product?.name}</td>
                        <td className="py-2.5 px-3 font-mono">{s.quantity}</td>
                        <td className="py-2.5 px-3 font-mono text-muted-foreground">{s.minStock}</td>
                        <td className="py-2.5 px-3">
                          {isOut ? (
                            <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">Kosong</span>
                          ) : isLow ? (
                            <span className="text-xs bg-warning-muted text-warning px-2 py-0.5 rounded-full">Menipis</span>
                          ) : (
                            <span className="text-xs bg-success-muted text-success px-2 py-0.5 rounded-full">Aman</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {formatIDR((s.product?.costPrice ?? 0) * s.quantity)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mutation Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Boxes className="size-4" /> Riwayat Mutasi Stok
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mutations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Belum ada mutasi stok</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Tanggal</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Tipe</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Produk</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Sebelum</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Delta</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Sesudah</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {mutations.slice(0, 20).map((m) => (
                    <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs font-medium ${MUTATION_TYPE_COLOR[m.type]}`}>
                          {MUTATION_TYPE_LABEL[m.type]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{m.product?.name}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-muted-foreground">
                        {m.quantityBefore}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        <span className={m.quantityDelta > 0 ? "text-success" : "text-destructive"}>
                          {m.quantityDelta > 0 ? "+" : ""}{m.quantityDelta}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{m.quantityAfter}</td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-[200px] truncate">
                        {m.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
