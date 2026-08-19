"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import type { LowStockRow } from "@/lib/types";

/**
 * LowStockWidget (F3-6, M8) — widget dashboard "Stok Menipis".
 * Memakai GET /reports/low-stock?perPage=10 (manager+) — kontrak
 * /reports/dashboard TIDAK berubah (SPEC Fase 3 §4.6, §8.1).
 * Menampilkan count + 10 item teratas + link ke halaman stok.
 */
export function LowStockWidget() {
  const [rows, setRows] = useState<LowStockRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ rows: LowStockRow[]; meta: { total: number } }>(
        "/reports/low-stock",
        { page: 1, perPage: 10 }
      );
      setRows(data.rows);
      setTotal(data.meta.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat stok menipis");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" /> Stok Menipis
          </CardTitle>
          <CardDescription className="text-xs">
            Produk di bawah ambang minimum
          </CardDescription>
        </div>
        {!loading && !error && total !== null && (
          <Badge variant={total > 0 ? "destructive" : "outline"} className={total === 0 ? "border-success-subtle bg-success-subtle text-success" : ""}>
            {total > 0 ? `${formatNumber(total)} produk` : "Aman"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-1 pt-2">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="min-h-11">
              Coba Lagi
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-2">
            <EmptyState
              icon={<CheckCircle2 className="size-10 text-success" />}
              title="Semua stok aman"
              description="Tidak ada produk di bawah ambang batas."
            />
          </div>
        ) : (
          rows.map((r) => {
            const breakdown =
              r.warehouseBreakdown.length === 1
                ? `${r.warehouseBreakdown[0].warehouseName}: ${formatNumber(r.warehouseBreakdown[0].quantity)}`
                : `${formatNumber(r.totalStock)} ${r.unit} di ${r.warehouseBreakdown.length} gudang`;
            return (
              <div key={`${r.productId}-${r.variantId ?? ""}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-muted/50 transition-smooth">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {r.name}
                    {r.variantName && (
                      <span className="text-muted-foreground"> · {r.variantName}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{breakdown}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 font-mono">
                  {formatNumber(r.totalStock)} {r.unit}
                </Badge>
              </div>
            );
          })
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="pt-2">
            <Button variant="ghost" size="sm" asChild className="min-h-11 w-full text-muted-foreground hover:text-accent">
              <Link href="/warehouses">
                Lihat Halaman Stok <ArrowRight className="ml-1 size-3" />
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
