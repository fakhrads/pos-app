"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
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
import { formatIDR, lastNDaysWIB, todayWIB } from "@/lib/utils";
import { DateRange, ExportButtons, MiniStat, ReportCard } from "./report-ui";
import type { CashFlowResult } from "@/lib/types";

export function CashFlowReport() {
  const [from, setFrom] = useState(lastNDaysWIB(30)[0]);
  const [to, setTo] = useState(todayWIB());
  const [data, setData] = useState<CashFlowResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<CashFlowResult>("/reports/cash-flow", { from, to }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat laporan arus kas");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;

  return (
    <ReportCard
      title="Arus Kas"
      description="Rekap kas masuk (penjualan + mutasi manual) vs kas keluar (refund + mutasi manual)."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      actions={
        <ExportButtons
          path="/reports/cash-flow"
          disabled={!data}
          buildQuery={(fmt) => `from=${from}&to=${to}&export=${fmt}`}
        />
      }
    >
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : !s ? (
        <EmptyState title="Tidak ada data pada rentang ini" />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <MiniStat
              label="Kas Masuk"
              value={formatIDR(s.cashIn)}
              className="text-emerald-600"
            />
            <MiniStat
              label="Kas Keluar"
              value={formatIDR(-s.cashOut)}
              className="text-destructive"
            />
            <MiniStat
              label="Arus Kas Bersih"
              value={formatIDR(s.net)}
              className={s.net >= 0 ? "text-emerald-600" : "text-destructive"}
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Komponen</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="flex items-center gap-2">
                  <ArrowUpCircle className="size-4 text-emerald-600" />
                  Kas masuk — penjualan
                </TableCell>
                <TableCell className="text-right font-mono text-emerald-600">
                  {formatIDR(s.cashIn)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="flex items-center gap-2">
                  <ArrowDownCircle className="size-4 text-destructive" />
                  Kas keluar — refund & mutasi manual
                </TableCell>
                <TableCell className="text-right font-mono text-destructive">
                  {formatIDR(-s.cashOut)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-semibold">ARUS KAS BERSIH</TableCell>
                <TableCell
                  className={`text-right font-mono font-semibold ${
                    s.net >= 0 ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {formatIDR(s.net)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
    </ReportCard>
  );
}
