"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TrendingUp, TrendingDown } from "lucide-react";
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
import type { IncomeStatementResult } from "@/lib/types";

export function IncomeStatementReport() {
  const [from, setFrom] = useState(lastNDaysWIB(30)[0]);
  const [to, setTo] = useState(todayWIB());
  const [data, setData] = useState<IncomeStatementResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<IncomeStatementResult>("/reports/income-statement", { from, to }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat laporan laba rugi");
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
      title="Laba Rugi"
      description="Laba bersih = Pendapatan − HPP − Pengeluaran kas operasional (mutasi kas keluar)."
      range={<DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />}
      actions={
        <ExportButtons
          path="/reports/income-statement"
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
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MiniStat label="Pendapatan" value={formatIDR(s.revenue)} />
            <MiniStat label="HPP" value={formatIDR(-s.cogs)} />
            <MiniStat
              label="Laba Kotor"
              value={formatIDR(s.grossProfit)}
              className={s.grossProfit >= 0 ? "text-emerald-600" : "text-destructive"}
            />
            <MiniStat label="Pengeluaran Operasional" value={formatIDR(-s.operatingExpenses)} />
            <MiniStat
              label="Laba Bersih"
              value={formatIDR(s.netProfit)}
              className={s.netProfit >= 0 ? "text-emerald-600" : "text-destructive"}
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
              {[
                { label: "Pendapatan", value: s.revenue, bold: false },
                { label: "HPP (Harga Pokok Penjualan)", value: -s.cogs, bold: false },
                { label: "Laba Kotor", value: s.grossProfit, bold: true },
                { label: "Pengeluaran Kas Operasional", value: -s.operatingExpenses, bold: false },
                { label: "LABA BERSIH", value: s.netProfit, bold: true },
              ].map((row) => (
                <TableRow key={row.label}>
                  <TableCell className={row.bold ? "font-semibold" : ""}>
                    {row.label}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${
                      row.bold ? "font-semibold" : "text-muted-foreground"
                    } ${row.value < 0 ? "text-destructive" : row.value > 0 && row.bold ? "text-emerald-600" : ""}`}
                  >
                    {formatIDR(row.value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
            {s.netProfit >= 0 ? (
              <TrendingUp className="size-5 text-emerald-600" />
            ) : (
              <TrendingDown className="size-5 text-destructive" />
            )}
            <p className="text-muted-foreground">
              {s.netProfit >= 0
                ? "Usaha menghasilkan laba bersih pada periode ini."
                : "Usaha mengalami rugi bersih pada periode ini — periksa margin & pengeluaran."}
            </p>
          </div>
        </>
      )}
    </ReportCard>
  );
}
