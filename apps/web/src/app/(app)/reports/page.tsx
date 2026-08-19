"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { api, ApiError } from "@/lib/api";
import { downloadCSV, formatIDR, formatNumber, lastNDaysWIB, PAYMENT_METHOD_LABEL, todayWIB } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { LowStockRow, PaymentMethodRow, ProfitRow, SalesDailyRow, TopProductRow } from "@/lib/types";

type TabId = "sales" | "profit" | "low-stock" | "top-products";

export default function ReportsPage() {
  const searchParams = useSearchParams();
  const { isManager } = useAuth();
  const initialTab: TabId =
    searchParams.get("tab") === "low-stock"
      ? "low-stock"
      : searchParams.get("tab") === "top-products"
        ? "top-products"
        : searchParams.get("tab") === "profit" && isManager
          ? "profit"
          : "sales";

  const tabs: { id: TabId; label: string; managerOnly?: boolean }[] = [
    { id: "sales", label: "Penjualan" },
    { id: "profit", label: "Laba", managerOnly: true },
    { id: "low-stock", label: "Stok Menipis", managerOnly: true },
    { id: "top-products", label: "Produk Terlaris" },
  ];

  return (
    <>
      <PageHeader
        title="Laporan"
        description="Pantau penjualan, laba, dan kondisi stok. Semua laporan bisa diexport CSV."
      />
      <Tabs defaultValue={initialTab}>
        <TabsList className="flex-wrap">
          {tabs
            .filter((t) => !t.managerOnly || isManager)
            .map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
              </TabsTrigger>
            ))}
        </TabsList>
        <TabsContent value="sales">
          <SalesReport />
        </TabsContent>
        {isManager && (
          <TabsContent value="profit">
            <ProfitReport />
          </TabsContent>
        )}
        {isManager && (
          <TabsContent value="low-stock">
            <LowStockReport />
          </TabsContent>
        )}
        <TabsContent value="top-products">
          <TopProductsReport />
        </TabsContent>
      </Tabs>
    </>
  );
}

function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Dari</Label>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Sampai</Label>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
      </div>
    </div>
  );
}

// ================= Penjualan =================
function SalesReport() {
  const [from, setFrom] = useState(todayWIB());
  const [to, setTo] = useState(todayWIB());
  const [rows, setRows] = useState<SalesDailyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: SalesDailyRow[] }>("/reports/sales-daily", { from, to });
      setRows(data.rows);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat laporan");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          revenue: acc.revenue + r.revenue,
          count: acc.count + r.transactionCount,
          items: acc.items + r.itemsSold,
          cash: acc.cash + (r.paymentBreakdown?.cash ?? 0),
          qris: acc.qris + (r.paymentBreakdown?.qris ?? 0),
          transfer: acc.transfer + (r.paymentBreakdown?.transfer ?? 0),
        }),
        { revenue: 0, count: 0, items: 0, cash: 0, qris: 0, transfer: 0 }
      ),
    [rows]
  );

  function exportCSV() {
    downloadCSV(`penjualan-${from}-sampai-${to}.csv`, [
      ["Tanggal", "Pendapatan (Rp)", "Transaksi", "Item Terjual", "Rata-rata/Transaksi (Rp)", "Tunai (Rp)", "QRIS (Rp)", "Transfer (Rp)"],
      ...rows.map((r) => [
        r.date,
        r.revenue,
        r.transactionCount,
        r.itemsSold,
        r.avgPerTransaction,
        r.paymentBreakdown?.cash ?? 0,
        r.paymentBreakdown?.qris ?? 0,
        r.paymentBreakdown?.transfer ?? 0,
      ]),
      [],
      ["TOTAL", summary.revenue, summary.count, summary.items, "", summary.cash, summary.qris, summary.transfer],
    ]);
  }

  return (
    <ReportLayout
      title="Laporan Penjualan"
      description="Penjualan per hari, termasuk breakdown metode pembayaran."
      range={
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
      }
      onExport={exportCSV}
      exportDisabled={rows.length === 0}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Total Penjualan" value={formatIDR(summary.revenue)} />
        <MiniStat label="Jumlah Transaksi" value={formatNumber(summary.count)} />
        <MiniStat label="Item Terjual" value={formatNumber(summary.items)} />
        <MiniStat
          label="Rata-rata / Transaksi"
          value={formatIDR(summary.count ? Math.round(summary.revenue / summary.count) : 0)}
        />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: "Tunai", value: summary.cash },
          { label: "QRIS", value: summary.qris },
          { label: "Transfer", value: summary.transfer },
        ].map((m) => (
          <Badge key={m.label} variant="secondary">
            {m.label}: {formatIDR(m.value)}
          </Badge>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada data pada rentang ini" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead className="text-right">Transaksi</TableHead>
              <TableHead className="text-right">Item</TableHead>
              <TableHead className="text-right">Tunai</TableHead>
              <TableHead className="text-right">QRIS</TableHead>
              <TableHead className="text-right">Transfer</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.date}>
                <TableCell className="font-medium">{r.date}</TableCell>
                <TableCell className="text-right">{formatNumber(r.transactionCount)}</TableCell>
                <TableCell className="text-right">{formatNumber(r.itemsSold)}</TableCell>
                <TableCell className="text-right">{formatIDR(r.paymentBreakdown?.cash ?? 0)}</TableCell>
                <TableCell className="text-right">{formatIDR(r.paymentBreakdown?.qris ?? 0)}</TableCell>
                <TableCell className="text-right">{formatIDR(r.paymentBreakdown?.transfer ?? 0)}</TableCell>
                <TableCell className="text-right font-semibold">{formatIDR(r.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportLayout>
  );
}

// ================= Laba =================
function ProfitReport() {
  const [from, setFrom] = useState(todayWIB());
  const [to, setTo] = useState(todayWIB());
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: ProfitRow[] }>("/reports/profit", { from, to, groupBy: "day" });
      setRows(data.rows);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat laporan laba");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({ revenue: acc.revenue + r.revenue, cost: acc.cost + r.cost, profit: acc.profit + r.profit }),
        { revenue: 0, cost: 0, profit: 0 }
      ),
    [rows]
  );

  function exportCSV() {
    downloadCSV(`laba-${from}-sampai-${to}.csv`, [
      ["Tanggal", "Pendapatan (Rp)", "HPP (Rp)", "Laba Kotor (Rp)"],
      ...rows.map((r) => [r.date, r.revenue, r.cost, r.profit]),
      [],
      ["TOTAL", summary.revenue, summary.cost, summary.profit],
    ]);
  }

  return (
    <ReportLayout
      title="Laporan Laba"
      description="Laba kotor = pendapatan − HPP (harga beli saat transaksi)."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      onExport={exportCSV}
      exportDisabled={rows.length === 0}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Pendapatan" value={formatIDR(summary.revenue)} />
        <MiniStat label="HPP" value={formatIDR(summary.cost)} />
        <MiniStat
          label="Laba Kotor"
          value={formatIDR(summary.profit)}
          className={summary.profit >= 0 ? "text-emerald-600" : "text-destructive"}
        />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada data pada rentang ini" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
              <TableHead className="text-right">HPP</TableHead>
              <TableHead className="text-right">Laba Kotor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.date}>
                <TableCell className="font-medium">{r.date}</TableCell>
                <TableCell className="text-right">{formatIDR(r.revenue)}</TableCell>
                <TableCell className="text-right">{formatIDR(r.cost)}</TableCell>
                <TableCell className="text-right font-semibold">{formatIDR(r.profit)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportLayout>
  );
}

// ================= Stok Menipis (Fase 3: { rows, meta } + breakdown per gudang) =================
function LowStockReport() {
  const [rows, setRows] = useState<LowStockRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: LowStockRow[]; meta: { total: number } }>(
        "/reports/low-stock",
        { page: 1, perPage: 100 }
      );
      setRows(data.rows);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat laporan stok");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function exportCSV() {
    downloadCSV("stok-menipis.csv", [
      ["Nama", "Varian", "SKU", "Stok Total", "Min. Stok", "Satuan", "Rincian Gudang"],
      ...rows.map((r) => [
        r.name,
        r.variantName ?? "",
        r.sku ?? "",
        r.totalStock,
        r.minStock,
        r.unit,
        r.warehouseBreakdown.map((b) => `${b.warehouseName}:${b.quantity}`).join("; "),
      ]),
    ]);
  }

  return (
    <ReportLayout
      title="Stok Menipis"
      description="Produk dengan stok ≤ ambang batas (per produk / per varian), diurutkan dari paling menipis (termasuk stok 0)."
      onExport={exportCSV}
      exportDisabled={rows.length === 0}
    >
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Semua stok aman 🎉" description="Tidak ada produk di bawah ambang batas." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead className="text-right">Stok</TableHead>
              <TableHead className="text-right">Min. Stok</TableHead>
              <TableHead>Rincian per Gudang</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.productId}-${r.variantId ?? ""}`}>
                <TableCell>
                  <p className="font-medium">
                    {r.name}
                    {r.variantName && (
                      <span className="text-muted-foreground"> · {r.variantName}</span>
                    )}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">{r.sku ?? "-"}</p>
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={r.totalStock <= 0 ? "destructive" : "secondary"}>
                    {formatNumber(r.totalStock)} {r.unit}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">{formatNumber(r.minStock)}</TableCell>
                <TableCell>
                  <p className="text-xs text-muted-foreground">
                    {r.warehouseBreakdown.length > 0
                      ? r.warehouseBreakdown
                          .map((b) => `${b.warehouseName}: ${formatNumber(b.quantity)}`)
                          .join(" · ")
                      : "—"}
                  </p>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportLayout>
  );
}

// ================= Produk Terlaris =================
function TopProductsReport() {
  const [from, setFrom] = useState(lastNDaysWIB(7)[0]);
  const [to, setTo] = useState(todayWIB());
  const [byQty, setByQty] = useState<TopProductRow[]>([]);
  const [byRevenue, setByRevenue] = useState<TopProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ byQuantity: TopProductRow[]; byRevenue: TopProductRow[] }>(
        "/reports/top-products",
        { from, to, limit: 10 }
      );
      setByQty(data.byQuantity ?? []);
      setByRevenue(data.byRevenue ?? []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat produk terlaris");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCSV() {
    const top = byQty.length >= byRevenue.length ? byQty : byRevenue;
    downloadCSV(`produk-terlaris-${from}-sampai-${to}.csv`, [
      ["Produk", "Qty Terjual", "Revenue (Rp)"],
      ...top.map((p, i) => [p.productName, byQty[i]?.quantity ?? 0, byRevenue[i]?.revenue ?? 0]),
    ]);
  }

  return (
    <ReportLayout
      title="Produk Terlaris"
      description="Top 10 produk berdasarkan qty terjual & revenue."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      onExport={exportCSV}
      exportDisabled={byQty.length === 0 && byRevenue.length === 0}
    >
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : byQty.length === 0 ? (
        <EmptyState title="Tidak ada penjualan pada rentang ini" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <RankTable title="By Qty Terjual" rows={byQty} valueKind="qty" />
          <RankTable title="By Revenue" rows={byRevenue} valueKind="revenue" />
        </div>
      )}
    </ReportLayout>
  );
}

function RankTable({ title, rows, valueKind }: { title: string; rows: TopProductRow[]; valueKind: "qty" | "revenue" }) {
  return (
    <div className="rounded-lg border">
      <p className="border-b px-4 py-2.5 text-sm font-medium">{title}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Produk</TableHead>
            <TableHead className="text-right">{valueKind === "qty" ? "Qty" : "Revenue"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.productName}-${i}`}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-medium">{r.productName}</TableCell>
              <TableCell className="text-right">
                {valueKind === "qty" ? formatNumber(r.quantity) : formatIDR(r.revenue)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ================= Layout umum laporan =================
function ReportLayout({
  title,
  description,
  range,
  onExport,
  exportDisabled,
  children,
}: {
  title: string;
  description: string;
  range?: React.ReactNode;
  onExport: () => void;
  exportDisabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {range}
          <Button variant="outline" size="sm" onClick={onExport} disabled={exportDisabled}>
            <Download className="size-4" /> Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MiniStat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${className}`}>{value}</p>
    </div>
  );
}
