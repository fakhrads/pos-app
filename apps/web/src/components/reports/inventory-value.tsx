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
import type { InventoryValueResult } from "@/lib/types";

export function InventoryValueReport() {
  const [data, setData] = useState<InventoryValueResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<InventoryValueResult>("/reports/inventory-value"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat nilai persediaan");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = data?.rows ?? [];
  const totalValue = data?.summary?.totalValue ?? 0;
  const valuation = data?.summary?.valuation ?? "cost";

  return (
    <ReportCard
      title="Nilai Persediaan"
      description={
        valuation === "selling"
          ? "Nilai stok dihitung dari harga jual per kategori."
          : "Nilai stok dihitung dari harga beli (HPP) per kategori."
      }
      actions={
        <ExportButtons
          path="/reports/inventory-value"
          disabled={rows.length === 0}
          buildQuery={(fmt) => `export=${fmt}`}
        />
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Total Nilai Stok" value={formatIDR(totalValue)} />
        <MiniStat
          label="Metode Penilaian"
          value={valuation === "selling" ? "Harga Jual" : "Harga Beli (HPP)"}
        />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="Belum ada stok tercatat" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kategori</TableHead>
              <TableHead className="text-right">Produk</TableHead>
              <TableHead className="text-right">Total Qty</TableHead>
              <TableHead className="text-right">Nilai Stok</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.categoryId}>
                <TableCell className="font-medium">{r.categoryName ?? "Tanpa kategori"}</TableCell>
                <TableCell className="text-right">{formatNumber(r.productCount)}</TableCell>
                <TableCell className="text-right">{formatNumber(r.totalQty)}</TableCell>
                <TableCell className="text-right font-semibold">{formatIDR(r.value)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold">
                {formatNumber(rows.reduce((a, r) => a + r.productCount, 0))}
              </TableCell>
              <TableCell className="text-right font-semibold">
                {formatNumber(rows.reduce((a, r) => a + r.totalQty, 0))}
              </TableCell>
              <TableCell className="text-right font-semibold">{formatIDR(totalValue)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportCard>
  );
}

export function InventoryValueWidget() {
  // Kompak untuk dashboard (jika dibutuhkan)
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get<InventoryValueResult>("/reports/inventory-value");
      setTotal(data.summary.totalValue);
    } catch {
      setTotal(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Badge variant="outline">Memuat…</Badge>;
  if (total == null) return null;
  return <Badge variant="secondary">Nilai Stok: {formatIDR(total)}</Badge>;
}
