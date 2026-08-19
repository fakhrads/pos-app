"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { downloadCSV, formatIDR, formatNumber, lastNDaysWIB, todayWIB } from "@/lib/utils";
import { DateRange, MiniStat, ReportCard } from "./report-ui";
import type { SalesOverviewGroup, SalesOverviewRow } from "@/lib/types";

const GROUP_LABEL: Record<SalesOverviewGroup, string> = {
  day: "Per Hari",
  week: "Per Minggu",
  month: "Per Bulan",
};

export function SalesOverviewReport() {
  const [from, setFrom] = useState(lastNDaysWIB(30)[0]);
  const [to, setTo] = useState(todayWIB());
  const [groupBy, setGroupBy] = useState<SalesOverviewGroup>("day");
  const [rows, setRows] = useState<SalesOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: SalesOverviewRow[] }>("/reports/sales-overview", {
        from,
        to,
        groupBy,
      });
      setRows(data.rows ?? []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat laporan penjualan");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy]);

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
      title="Laporan Penjualan"
      description="Ringkasan penjualan per hari, minggu, atau bulan — termasuk jumlah transaksi dan item terjual."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      actions={
        <>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as SalesOverviewGroup)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="Periode" />
            </SelectTrigger>
            <SelectContent>
              {(["day", "week", "month"] as SalesOverviewGroup[]).map((g) => (
                <SelectItem key={g} value={g}>
                  {GROUP_LABEL[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCSV(`penjualan-${from}-sampai-${to}.csv`, [
                ["Periode", "Transaksi", "Item Terjual", "Rata-rata/Transaksi (Rp)", "Pendapatan (Rp)"],
                ...rows.map((r) => [
                  r.period,
                  r.transactionCount,
                  r.itemsSold,
                  r.avgPerTransaction,
                  r.revenue,
                ]),
                [],
                ["TOTAL", summary.count, summary.items, "", summary.revenue],
              ])
            }
          >
            <Download className="size-4" /> Export CSV
          </Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Total Penjualan" value={formatIDR(summary.revenue)} />
        <MiniStat label="Jumlah Transaksi" value={formatNumber(summary.count)} />
        <MiniStat label="Item Terjual" value={formatNumber(summary.items)} />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada data pada rentang ini" />
      ) : (
        <>
          <div className="mb-4">
            <BarChart data={rows} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Periode</TableHead>
                <TableHead className="text-right">Transaksi</TableHead>
                <TableHead className="text-right">Item</TableHead>
                <TableHead className="text-right">Rata-rata / Transaksi</TableHead>
                <TableHead className="text-right">Pendapatan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.period}>
                  <TableCell className="font-medium">{formatPeriod(r.period, groupBy)}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.transactionCount)}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.itemsSold)}</TableCell>
                  <TableCell className="text-right">{formatIDR(r.avgPerTransaction)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatIDR(r.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </ReportCard>
  );
}

function formatPeriod(period: string, groupBy: SalesOverviewGroup): string {
  const d = new Date(period + "T00:00:00");
  if (Number.isNaN(d.getTime())) return period;
  if (groupBy === "month")
    return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  if (groupBy === "week")
    return `${d.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} (minggu ke-${Math.ceil(
      (d.getDate() + (d.getDay() === 0 ? 6 : 1 - d.getDay())) / 7
    )})`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function BarChart({ data }: { data: SalesOverviewRow[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="flex h-44 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.period} className="group flex flex-1 flex-col items-center gap-1.5">
          <div className="relative flex w-full flex-1 items-end justify-center">
            <div
              className="w-full max-w-9 rounded-t bg-gradient-to-t from-accent/40 to-accent/80 transition-colors group-hover:from-accent/60 group-hover:to-accent"
              style={{ height: `${Math.max((d.revenue / max) * 100, 2)}%` }}
              title={`${d.period}: ${formatIDR(d.revenue)}`}
            />
          </div>
          <span className="max-w-full truncate text-[9px] text-muted-foreground">
            {d.period.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
}
