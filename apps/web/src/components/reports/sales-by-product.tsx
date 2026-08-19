"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api";
import { formatIDR, formatNumber, lastNDaysWIB, todayWIB } from "@/lib/utils";
import { DateRange, ExportButtons, MiniStat, ReportCard } from "./report-ui";
import type { SalesByProductRow } from "@/lib/types";

export function SalesByProductReport() {
  const [from, setFrom] = useState(lastNDaysWIB(7)[0]);
  const [to, setTo] = useState(todayWIB());
  const [rows, setRows] = useState<SalesByProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: SalesByProductRow[] }>("/reports/sales-by-product", {
        from,
        to,
        limit: 200,
      });
      setRows(data.rows ?? []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat penjualan per produk");
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
          qty: acc.qty + r.qtySold,
          cogs: acc.cogs + r.cogs,
          profit: acc.profit + (r.revenue - r.cogs),
        }),
        { revenue: 0, qty: 0, cogs: 0, profit: 0 }
      ),
    [rows]
  );

  return (
    <ReportCard
      title="Penjualan per Produk"
      description="Produk paling laris berdasarkan jumlah terjual & pendapatan, termasuk rincian HPP."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      actions={
        <ExportButtons
          path="/reports/sales-by-product"
          disabled={rows.length === 0}
          buildQuery={(fmt) => `from=${from}&to=${to}&limit=200&export=${fmt}`}
        />
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Total Pendapatan" value={formatIDR(summary.revenue)} />
        <MiniStat label="Item Terjual" value={formatNumber(summary.qty)} />
        <MiniStat label="HPP" value={formatIDR(summary.cogs)} />
        <MiniStat
          label="Laba Kotor"
          value={formatIDR(summary.profit)}
          className={summary.profit >= 0 ? "text-emerald-600" : "text-destructive"}
        />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada penjualan pada rentang ini" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Produk</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">HPP</TableHead>
              <TableHead className="text-right">Laba</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.productId}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell>
                  <p className="font-medium">{r.productName}</p>
                  {r.productSku && (
                    <p className="font-mono text-[11px] text-muted-foreground">{r.productSku}</p>
                  )}
                </TableCell>
                <TableCell className="text-right">{formatNumber(r.qtySold)}</TableCell>
                <TableCell className="text-right">{formatIDR(r.revenue)}</TableCell>
                <TableCell className="text-right">{formatIDR(r.cogs)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={r.revenue - r.cogs >= 0 ? "secondary" : "destructive"}>
                    {formatIDR(r.revenue - r.cogs)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}
