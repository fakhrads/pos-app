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
import { LowStockWidget } from "@/components/dashboard/low-stock-widget";
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
              variant="accent"
            />
            <StatCard
              title="Transaksi"
              value={formatNumber(data.todayTransactions)}
              icon={<Receipt className="size-4" />}
              hint={`Rata-rata ${formatIDR(data.avgPerTransaction)} / transaksi`}
              variant="default"
            />
            <StatCard
              title="Item Terjual"
              value={formatNumber(data.todayItemsSold)}
              icon={<ShoppingBag className="size-4" />}
              variant="success"
            />
            <StatCard
              title="Stok Menipis"
              value={formatNumber(data.lowStockCount)}
              icon={<AlertTriangle className="size-4" />}
              variant={data.lowStockCount > 0 ? "warning" : "default"}
              hint={
                data.lowStockCount > 0 ? (
                  <Link href="/warehouses" className="text-accent hover:text-accent-hover underline transition-smooth">
                    Lihat halaman stok
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

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Transaksi terbaru */}
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-0">
                <CardTitle className="text-sm font-semibold">Transaksi Terbaru</CardTitle>
                <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-accent transition-smooth">
                  <Link href="/transactions">
                    Semua <ArrowRight className="ml-1 size-3" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-1 pt-4">
                {data.recentTransactions.length === 0 && (
                  <EmptyState title="Belum ada transaksi hari ini" />
                )}
                {data.recentTransactions.map((tx) => (
                  <Link
                    key={tx.id}
                    href={`/transactions/${tx.id}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-smooth group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground group-hover:text-accent transition-smooth shrink-0">
                        #{tx.invoiceNumber.slice(-3)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{tx.invoiceNumber}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDateTime(tx.soldAt)} · {tx.user?.name}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold font-mono shrink-0">{formatIDR(tx.total)}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>

            {/* Produk terlaris hari ini */}
            <Card className="overflow-hidden">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-0">
                <CardTitle className="text-sm font-semibold">Produk Terlaris Hari Ini</CardTitle>
                <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-accent transition-smooth">
                  <Link href="/reports?tab=top-products">
                    Laporan <ArrowRight className="ml-1 size-3" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-1 pt-4">
                {data.topProductsToday.length === 0 && (
                  <EmptyState title="Belum ada produk terjual" />
                )}
                {data.topProductsToday.map((p, i) => (
                  <div
                    key={`${p.productName}-${i}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-smooth"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                        i === 0 ? "bg-accent-muted text-accent" :
                        i === 1 ? "bg-violet-500/15 text-violet-400" :
                        "bg-success-muted text-success"
                      }`}>
                        {i + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.productName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatNumber(p.quantity)} terjual
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold font-mono">{formatIDR(p.revenue)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Stok menipis — widget Fase 3 (GET /reports/low-stock?perPage=10) */}
            <LowStockWidget />
          </div>
        </div>
      )}
    </ManagerOnly>
  );
}

/** Bar chart sederhana tanpa dependensi chart */
function BarChart({ data }: { data: { date: string; revenue: number }[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const today = new Date().toISOString().split("T")[0];
  
  return (
    <div className="flex h-48 items-end gap-2">
      {data.map((d) => {
        const isToday = d.date === today;
        return (
          <div key={d.date} className="group flex flex-1 flex-col items-center gap-2">
            <div className="relative flex w-full flex-1 items-end justify-center">
              <div
                className={`w-full max-w-[40px] rounded-t bar-fill transition-colors ${
                  isToday
                    ? "bg-gradient-to-t from-accent/80 to-accent ring-2 ring-accent/30"
                    : "bg-gradient-to-t from-accent/40 to-accent/70 group-hover:from-accent/60 group-hover:to-accent"
                }`}
                style={{ height: `${Math.max((d.revenue / max) * 100, 2)}%` }}
                title={`${d.date}: ${formatIDR(d.revenue)}`}
              />
            </div>
            <span className={`text-[10px] ${isToday ? "text-accent font-medium" : "text-muted-foreground"}`}>
              {new Date(d.date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "short" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
