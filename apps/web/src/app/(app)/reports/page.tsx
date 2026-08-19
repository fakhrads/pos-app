"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  ModuleHelpButton,
  ModuleIntroBadge,
} from "@/components/onboarding/module-intro";
import { api, ApiError } from "@/lib/api";
import { formatIDR, formatNumber, lastNDaysWIB, todayWIB } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { DateRange, ExportButtons, MiniStat, ReportCard } from "@/components/reports/report-ui";
import { SalesOverviewReport } from "@/components/reports/sales-overview";
import { SalesByProductReport } from "@/components/reports/sales-by-product";
import { SalesByCategoryReport } from "@/components/reports/sales-by-category";
import { SalesByCashierReport } from "@/components/reports/sales-by-cashier";
import { IncomeStatementReport } from "@/components/reports/income-statement";
import { CashFlowReport } from "@/components/reports/cash-flow";
import { InventoryValueReport } from "@/components/reports/inventory-value";
import { DeadStockReport } from "@/components/reports/dead-stock";
import { CashMovementsReport } from "@/components/reports/cash-movements";
import type { LowStockRow, TopProductRow } from "@/lib/types";

type TabId = "sales" | "finance" | "stock" | "top-products" | "cash";

export default function ReportsPage() {
  const searchParams = useSearchParams();
  const { isManager } = useAuth();

  // Kompatibel dengan tautan lama (?tab=low-stock / top-products / profit)
  const legacyTab = searchParams.get("tab");
  const initialTab: TabId =
    legacyTab === "low-stock"
      ? "stock"
      : legacyTab === "top-products"
        ? "top-products"
        : legacyTab === "profit" && isManager
          ? "finance"
          : "sales";

  const tabs: { id: TabId; label: string; managerOnly?: boolean }[] = [
    { id: "sales", label: "Penjualan" },
    { id: "finance", label: "Keuangan", managerOnly: true },
    { id: "stock", label: "Stok", managerOnly: true },
    { id: "top-products", label: "Produk Terlaris" },
    { id: "cash", label: "Kas", managerOnly: true },
  ];

  return (
    <>
      <PageHeader
        title="Laporan"
        description="Pantau penjualan, laba, kondisi stok, dan arus kas. Semua laporan bisa diexport Excel/PDF/CSV."
        actions={
          <>
            <ModuleHelpButton moduleId="reports" />
            <ModuleIntroBadge moduleId="reports" />
          </>
        }
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

        <TabsContent value="sales" className="mt-4">
          <Tabs defaultValue="overview">
            <TabsList className="flex-wrap">
              <TabsTrigger value="overview">Ringkasan</TabsTrigger>
              <TabsTrigger value="product">Per Produk</TabsTrigger>
              <TabsTrigger value="category">Per Kategori</TabsTrigger>
              <TabsTrigger value="cashier">Per Kasir</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <SalesOverviewReport />
            </TabsContent>
            <TabsContent value="product" className="mt-4">
              <SalesByProductReport />
            </TabsContent>
            <TabsContent value="category" className="mt-4">
              <SalesByCategoryReport />
            </TabsContent>
            <TabsContent value="cashier" className="mt-4">
              <SalesByCashierReport />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {isManager && (
          <TabsContent value="finance" className="mt-4">
            <Tabs defaultValue="income">
              <TabsList className="flex-wrap">
                <TabsTrigger value="income">Laba Rugi</TabsTrigger>
                <TabsTrigger value="cashflow">Arus Kas</TabsTrigger>
              </TabsList>
              <TabsContent value="income" className="mt-4">
                <IncomeStatementReport />
              </TabsContent>
              <TabsContent value="cashflow" className="mt-4">
                <CashFlowReport />
              </TabsContent>
            </Tabs>
          </TabsContent>
        )}

        {isManager && (
          <TabsContent value="stock" className="mt-4">
            <Tabs defaultValue="low-stock">
              <TabsList className="flex-wrap">
                <TabsTrigger value="low-stock">Stok Menipis</TabsTrigger>
                <TabsTrigger value="inventory">Nilai Persediaan</TabsTrigger>
                <TabsTrigger value="dead-stock">Dead Stock</TabsTrigger>
              </TabsList>
              <TabsContent value="low-stock" className="mt-4">
                <LowStockReport />
              </TabsContent>
              <TabsContent value="inventory" className="mt-4">
                <InventoryValueReport />
              </TabsContent>
              <TabsContent value="dead-stock" className="mt-4">
                <DeadStockReport />
              </TabsContent>
            </Tabs>
          </TabsContent>
        )}

        <TabsContent value="top-products" className="mt-4">
          <TopProductsReport />
        </TabsContent>

        {isManager && (
          <TabsContent value="cash" className="mt-4">
            <CashMovementsReport />
          </TabsContent>
        )}
      </Tabs>
    </>
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

  return (
    <ReportCard
      title="Stok Menipis"
      description="Produk dengan stok ≤ ambang batas (per produk / per varian), diurutkan dari paling menipis (termasuk stok 0)."
      actions={
        <ExportButtons
          path="/reports/low-stock"
          formats={["csv"]}
          disabled={rows.length === 0}
          buildQuery={(fmt) => `export=${fmt}`}
        />
      }
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
                    {r.variantName && <span className="text-muted-foreground"> · {r.variantName}</span>}
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
    </ReportCard>
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

  return (
    <ReportCard
      title="Produk Terlaris"
      description="Top 10 produk berdasarkan qty terjual & revenue."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      actions={
        <ExportButtons
          path="/reports/top-products"
          formats={["csv"]}
          disabled={byQty.length === 0 && byRevenue.length === 0}
          buildQuery={(fmt) => `from=${from}&to=${to}&limit=10&export=${fmt}`}
        />
      }
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
    </ReportCard>
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
