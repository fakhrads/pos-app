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
import { api, ApiError } from "@/lib/api";
import { formatIDR, formatNumber, lastNDaysWIB, todayWIB } from "@/lib/utils";
import { DateRange, ExportButtons, ReportCard } from "./report-ui";
import type { SalesByCategoryRow } from "@/lib/types";

export function SalesByCategoryReport() {
  const [from, setFrom] = useState(lastNDaysWIB(7)[0]);
  const [to, setTo] = useState(todayWIB());
  const [rows, setRows] = useState<SalesByCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ rows: SalesByCategoryRow[] }>("/reports/sales-by-category", {
        from,
        to,
      });
      setRows(data.rows ?? []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat penjualan per kategori");
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
        (acc, r) => ({ revenue: acc.revenue + r.revenue, qty: acc.qty + r.qtySold }),
        { revenue: 0, qty: 0 }
      ),
    [rows]
  );

  return (
    <ReportCard
      title="Penjualan per Kategori"
      description="Kontribusi setiap kategori terhadap penjualan pada rentang tanggal."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      actions={
        <ExportButtons
          path="/reports/sales-by-category"
          disabled={rows.length === 0}
          buildQuery={(fmt) => `from=${from}&to=${to}&export=${fmt}`}
        />
      }
    >
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Tidak ada data pada rentang ini" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Item Terjual</TableHead>
              <TableHead className="text-right">Pendapatan</TableHead>
              <TableHead className="text-right">Kontribusi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const pct = summary.revenue ? Math.round((r.revenue / summary.revenue) * 100) : 0;
              return (
                <TableRow key={r.categoryId}>
                  <TableCell className="font-medium">{r.categoryName ?? "Tanpa kategori"}</TableCell>
                  <TableCell className="text-right">{formatNumber(r.qtySold)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatIDR(r.revenue)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{pct}%</TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold">{formatNumber(summary.qty)}</TableCell>
              <TableCell className="text-right font-semibold">{formatIDR(summary.revenue)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}
