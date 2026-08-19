"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDownload } from "@/lib/download";
import { ApiError } from "@/lib/api";

/** Rentang tanggal from/to (WIB, YYYY-MM-DD) */
export function DateRange({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Dari</Label>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-9 w-40"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Sampai</Label>
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-9 w-40"
        />
      </div>
    </div>
  );
}

/** Ringkasan angka kecil di atas tabel */
export function MiniStat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${className}`}>{value}</p>
    </div>
  );
}

/** Kartu wrapper laporan dengan header + range + tombol export */
export function ReportCard({
  title,
  description,
  range,
  actions,
  children,
}: {
  title: string;
  description: string;
  range?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {range}
          {actions}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Tombol export XLSX / PDF / CSV untuk laporan.
 * `path`   = endpoint reports TANPA query export, mis. "/reports/sales-by-product".
 * `buildQuery` = fungsi menghasilkan query string (from/to/groupBy/...), tanpa tanda '?'.
 * `formats` = daftar format yang didukung endpoint. Endpoint Fase 5 (by-product,
 *             by-category, by-cashier, inventory-value, dead-stock, income-statement,
 *             cash-flow) mendukung xlsx/pdf/csv. Endpoint lama (low-stock, top-products)
 *             hanya mendukung csv — jangan pasang tombol xlsx/pdf di sana.
 *             Endpoint sales-overview TIDAK punya export server — gunakan [] + CSV sisi klien.
 */
export function ExportButtons({
  path,
  buildQuery,
  formats = ["xlsx", "pdf", "csv"],
  disabled = false,
}: {
  path: string;
  buildQuery: (format: "xlsx" | "pdf" | "csv") => string;
  formats?: ("xlsx" | "pdf" | "csv")[];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | "csv" | null>(null);

  async function run(format: "xlsx" | "pdf" | "csv") {
    setBusy(format);
    try {
      const q = buildQuery(format);
      const ext = format === "csv" ? "csv" : format;
      await apiDownload(`${path}?${q}`, `laporan-${format}.${ext}`);
      toast.success("Export berhasil diunduh");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengunduh export");
    } finally {
      setBusy(null);
    }
  }

  const spinner = (
    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );

  const buttons: { format: "xlsx" | "pdf" | "csv"; label: string; icon: React.ReactNode }[] = [];
  if (formats.includes("xlsx"))
    buttons.push({ format: "xlsx", label: "Excel", icon: <FileSpreadsheet className="size-4" /> });
  if (formats.includes("pdf"))
    buttons.push({ format: "pdf", label: "PDF", icon: <FileText className="size-4" /> });
  if (formats.includes("csv"))
    buttons.push({ format: "csv", label: "CSV", icon: <Download className="size-4" /> });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {buttons.map((b) => (
        <Button
          key={b.format}
          variant="outline"
          size="sm"
          disabled={disabled || busy !== null}
          onClick={() => run(b.format)}
        >
          {busy === b.format ? spinner : b.icon}
          {b.label}
        </Button>
      ))}
    </div>
  );
}

