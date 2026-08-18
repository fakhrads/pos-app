"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Package,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ManagerOnly } from "@/components/role-guard";
import { api } from "@/lib/api";
import {
  formatDateTime,
  formatIDR,
  formatNumber,
  PAYMENT_METHOD_LABEL,
} from "@/lib/utils";
import type { DashboardData } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DashboardData>("/reports/dashboard")
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat dashboard"));
  }, []);

  return (
    <ManagerOnly>
      <PageHeader
        title="Dashboard"
        description="Ringkasan performa toko hari ini."
        actions={
          <Button asChild>
            <Link href="/pos">Buka Kasir</Link>
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Statistik hari ini */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Penjualan Hari Ini"
              value={formatIDR(data.todayRevenue)}
              icon={<TrendingUp className="size-4" />}
            />
            <StatCard
              title="Transaksi"
              value={formatNumber(data.todayTransactions)}
              icon={<Receipt className="size-4" />}
              hint={`Rata-rata ${formatIDR(data.avgPerTransaction)} / transaksi`}
            />
            <StatCard
              title="Item Terjual"
              value={formatNumber(data.todayItemsSold)}
              icon={<ShoppingBag className="size-4" />}
            />
            <StatCard
              title="Stok Menipis"
              value={formatNumber(data.lowStockCount)}
              icon={<AlertTriangle className="size-4" />}
              hint={
                data.lowStockCount > 0 ? (
                  <Link href="/reports?tab=low-stock" className="underline">
                    Lihat laporan stok
                  </Link>
                ) : (
                  "Semua aman"
                )
              }
            />
          </div>

          {/* Grafik 7 hari + breakdown metode */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm">Penjualan 7 Hari Terakhir</CardTitle>
                <CardDescription>Total pendapatan per hari (WIB)</CardDescription>
              </CardHeader>
              <CardContent>
                {data.salesLast7Days.length === 0 ? (
                  <EmptyState title="Belum ada penjualan" />
                ) : (
                  <BarChart data={data.salesLast7Days} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Metode Pembayaran Hari Ini</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(data.paymentMethodsToday).length === 0 && (
                  <p className="text-xs text-muted-foreground">Belum ada pembayaran hari ini.</p>
                )}
                {Object.entries(data.paymentMethodsToday).map(([method, amount]) => (
                  <div key={method} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Banknote className="size-4" />
                      {PAYMENT_METHOD_LABEL[method] ?? method}
                    </span>
                    <span className="font-medium">{formatIDR(amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t pt-3 text-sm font-semibold">
                  <span>Total</span>
                  <span>{formatIDR(data.todayRevenue)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Transaksi terbaru */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Transaksi Terbaru</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/transactions">
                    Semua <ArrowRight className="ml-1 size-3" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.recentTransactions.length === 0 && (
                  <EmptyState title="Belum ada transaksi hari ini" />
                )}
                {data.recentTransactions.map((tx) => (
                  <Link
                    key={tx.id}
                    href={`/transactions/${tx.id}`}
                    className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{tx.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(tx.soldAt)} · {tx.user?.name}
                      </p>
                    </div>
                    <p className="text-sm font-semibold">{formatIDR(tx.total)}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>

            {/* Produk terlaris hari ini */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Produk Terlaris Hari Ini</CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/reports?tab=top-products">
                    Laporan <ArrowRight className="ml-1 size-3" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.topProductsToday.length === 0 && (
                  <EmptyState title="Belum ada produk terjual" />
                )}
                {data.topProductsToday.map((p, i) => (
                  <div
                    key={`${p.productName}-${i}`}
                    className="flex items-center justify-between rounded-md px-2 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(p.quantity)} terjual
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold">{formatIDR(p.revenue)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </ManagerOnly>
  );
}

/** Bar chart sederhana tanpa dependensi chart */
function BarChart({ data }: { data: { date: string; revenue: number }[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.date} className="group flex flex-1 flex-col items-center gap-1">
          <div className="relative flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
              style={{ height: `${Math.max((d.revenue / max) * 100, 2)}%` }}
              title={`${d.date}: ${formatIDR(d.revenue)}`}
            />
          </div>
          <span className="text-[9px] text-muted-foreground">
            {new Date(d.date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short" })}
          </span>
        </div>
      ))}
    </div>
  );
}
