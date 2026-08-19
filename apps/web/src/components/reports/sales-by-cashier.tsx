"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { api, ApiError } from "@/lib/api";
import { formatIDR, formatNumber, lastNDaysWIB, todayWIB } from "@/lib/utils";
import { DateRange, ExportButtons, MiniStat, ReportCard } from "./report-ui";
import type { SalesByCashierRow } from "@/lib/types";

export function SalesByCashierReport() {
  const [from, setFrom] = useState(lastNDaysWIB(7)[0]);
  const [to, setTo] = useState(todayWIB());
  const [rows, setRows] = useState<SalesByCashierRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: SalesByCashierRow[] }>("/reports/sales-by-cashier", {
        from,
        to,
      });
      setRows(data.rows ?? []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat penjualan per kasir");
      setRows([]);
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
        }),
        { revenue: 0, count: 0, items: 0 }
      ),
    [rows]
  );

  return (
    <ReportCard
      title="Penjualan per Kasir"
      description="Kinerja setiap kasir: jumlah transaksi, item terjual, dan total pendapatan."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      actions={
        <ExportButtons
          path="/reports/sales-by-cashier"
          disabled={rows.length === 0}
          buildQuery={(fmt) => `from=${from}&to=${to}&export=${fmt}`}
        />
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Total Pendapatan" value={formatIDR(summary.revenue)} />
        <MiniStat label="Transaksi" value={formatNumber(summary.count)} />
        <MiniStat label="Item Terjual" value={formatNumber(summary.items)} />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada data pada rentang ini" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kasir</TableHead>
              <TableHead className="text-right">Transaksi</TableHead>
              <TableHead className="text-right">Item Terjual</TableHead>
              <TableHead className="text-right">Rata-rata / Transaksi</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.cashierId}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                      <UserCircle2 className="size-4 text-muted-foreground" />
                    </div>
                    <span className="font-medium">{r.cashierName ?? "—"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">{formatNumber(r.transactionCount)}</TableCell>
                <TableCell className="text-right">{formatNumber(r.itemsSold)}</TableCell>
                <TableCell className="text-right">
                  {formatIDR(r.transactionCount ? Math.round(r.revenue / r.transactionCount) : 0)}
                </TableCell>
                <TableCell className="text-right font-semibold">{formatIDR(r.revenue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}
