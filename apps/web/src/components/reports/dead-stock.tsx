"use client";

import { useCallback, useEffect, useState } from "react";
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
import { formatIDR, formatNumber } from "@/lib/utils";
import { ExportButtons, MiniStat, ReportCard } from "./report-ui";
import type { DeadStockResult } from "@/lib/types";

export function DeadStockReport() {
  const [data, setData] = useState<DeadStockResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<DeadStockResult>("/reports/dead-stock"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat laporan dead stock");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];
  const days = data?.summary?.days ?? 90;
  const totalCostValue = data?.summary?.totalCostValue ?? 0;

  return (
    <ReportCard
      title="Dead Stock"
      description={`Produk yang tidak terjual dalam ${days} hari terakhir — potensi modal tersangkut.`}
      actions={
        <ExportButtons
          path="/reports/dead-stock"
          disabled={rows.length === 0}
          buildQuery={(fmt) => `export=${fmt}`}
        />
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Jumlah Produk Dead" value={formatNumber(rows.length)} />
        <MiniStat label="Periode (hari)" value={formatNumber(days)} />
        <MiniStat label="Nilai HPP Tersangkut" value={formatIDR(totalCostValue)} />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Tidak ada dead stock 🎉"
          description={`Semua produk aktif pernah terjual dalam ${days} hari terakhir.`}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produk</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Stok</TableHead>
              <TableHead className="text-right">Nilai HPP</TableHead>
              <TableHead className="text-right">Nilai Jual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId}>
                <TableCell>
                  <p className="font-medium">{r.name}</p>
                  {r.sku && <p className="font-mono text-[11px] text-muted-foreground">{r.sku}</p>}
                </TableCell>
                <TableCell>{r.categoryName ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="secondary">{formatNumber(r.stockQty)}</Badge>
                </TableCell>
                <TableCell className="text-right">{formatIDR(r.costValue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatIDR(r.sellingValue)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}
