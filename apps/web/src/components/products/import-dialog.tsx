"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InlineError } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api";
import { apiDownload } from "@/lib/download";
import { cn, formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import type { ImportResult } from "@/lib/types";

type Phase = "idle" | "importing" | "result";

const MAX_SIZE_MB = 2;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ImportDialog (L6) — Import Produk dari Excel.
 * State machine 3 fase: idle → importing → hasil (DESIGN §4 L6).
 * - partial=false (default): atomic — ada error = 0 baris tersimpan (AC-05.2)
 * - partial=true: simpan baris valid, laporkan error (AC-05.3)
 * Hasil gagal ditampilkan dalam dialog (bisa sampai 500 baris), bukan toast.
 */
export function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** dipanggil saat "Selesai" / import sukses → refresh list */
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [partial, setPartial] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [atomicFailed, setAtomicFailed] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setPartial(false);
      setPhase("idle");
      setResult(null);
      setAtomicFailed(false);
      setInlineError(null);
    }
  }, [open]);

  function acceptFile(f?: File | null) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setInlineError("File harus berformat .xlsx (Fase 2 hanya menerima .xlsx).");
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setInlineError("File terlalu besar. Maksimal 2 MB dan 500 baris data.");
      return;
    }
    setInlineError(null);
    setFile(f);
  }

  async function downloadTemplate() {
    try {
      await apiDownload("/products/import/template", "template-produk.xlsx");
      toast.success("Template diunduh");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengunduh template.");
    }
  }

  async function handleImport() {
    if (!file || phase === "importing") return;
    setPhase("importing");
    setInlineError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await api.post<ImportResult>(
        `/products/import?partial=${partial ? "true" : "false"}`,
        fd
      );
      setResult(data);
      setAtomicFailed(false);
      setPhase("result");
      if (data.failed === 0) {
        toast.success(
          `Import selesai: ${data.inserted} baru · ${data.updated} diperbarui · 0 gagal`
        );
      } else {
        toast.warning(
          `Import selesai: ${data.inserted} baru · ${data.updated} diperbarui · ${data.failed} gagal`
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const code = err.code;
        if (code === "IMPORT_EMPTY") {
          setInlineError("File kosong atau tidak berisi sheet 'Produk'.");
        } else if (code === "IMPORT_TOO_LARGE") {
          setInlineError("File terlalu besar. Maksimal 2 MB dan 500 baris data.");
        } else if (code === "IMPORT_INVALID_HEADER") {
          setInlineError(
            "Header kolom tidak cocok dengan template. Unduh template terbaru."
          );
        } else if (code === "IMPORT_VALIDATION_FAILED") {
          // Atomic (partial=false): 0 baris tersimpan, daftar error dari details
          const rows = (err.details as { rows?: ImportResult["rows"] } | undefined)
            ?.rows;
          const failed = rows?.filter((r) => r.status === "error").length ?? 0;
          setResult({ inserted: 0, updated: 0, failed, rows: rows ?? [] });
          setAtomicFailed(true);
          setPhase("result");
        } else {
          toast.error(err.message || "Gagal mengimpor. Coba lagi.");
          setPhase("idle");
        }
      } else {
        toast.error("Gagal mengimpor. Coba lagi.");
        setPhase("idle");
      }
    }
  }

  function resetToIdle() {
    setFile(null);
    setResult(null);
    setAtomicFailed(false);
    setInlineError(null);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  const failedRows = result?.rows.filter((r) => r.status === "error") ?? [];
  const total = result ? result.inserted + result.updated + result.failed : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !(phase === "importing") && onOpenChange(false)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {phase === "result" && result ? (
          <>
            <DialogHeader>
              <DialogTitle
                className={cn(
                  "flex items-center gap-2",
                  atomicFailed ? "text-danger" : ""
                )}
              >
                {atomicFailed ? (
                  <AlertCircle className="size-5" />
                ) : result.failed > 0 ? (
                  <AlertCircle className="size-5 text-warning" />
                ) : (
                  <CheckCircle2 className="size-5 text-success" />
                )}
                {atomicFailed ? "Import Gagal" : "Import Selesai"}
              </DialogTitle>
              <DialogDescription>
                {atomicFailed
                  ? "Tidak ada baris yang tersimpan"
                  : `${formatNumber(total)} baris diproses`}
              </DialogDescription>
            </DialogHeader>

            <div
              role="status"
              className="rounded-lg border border-border bg-surface-sunken/50 px-3 py-2.5 text-sm font-medium"
            >
              {formatNumber(result.inserted)} baru · {formatNumber(result.updated)}{" "}
              diperbarui · {formatNumber(result.failed)} gagal
            </div>

            {failedRows.length > 0 ? (
              <>
                <p className="text-xs font-medium text-text-secondary">
                  Baris gagal ({formatNumber(failedRows.length)})
                </p>
                <ScrollArea className="max-h-64 rounded-lg border border-border">
                  <ul role="list" className="divide-y divide-border">
                    {failedRows.map((r) => (
                      <li key={r.rowNumber} className="flex gap-2 px-3 py-2 text-sm">
                        <span className="shrink-0 font-mono text-xs text-text-muted">
                          Baris {r.rowNumber}
                        </span>
                        <span className="text-text-primary">{r.message}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </>
            ) : (
              <p className="text-sm text-text-secondary">
                Semua baris berhasil diproses.
              </p>
            )}

            {atomicFailed && (
              <p className="text-sm text-text-secondary">
                Perbaiki {formatNumber(failedRows.length)} baris error di file, lalu
                coba lagi.
              </p>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                className="h-12 sm:h-9"
                onClick={resetToIdle}
              >
                Import Lagi
              </Button>
              <Button
                className="h-12 sm:h-9"
                onClick={() => {
                  onOpenChange(false);
                  onImported();
                }}
              >
                Selesai
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import Produk dari Excel</DialogTitle>
              <DialogDescription>
                Isi template lalu unggah. Produk dengan Kode Barang yang sama akan
                diperbarui, bukan dibuat baru.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <Button
                variant="outline"
                className="h-12 w-full sm:h-10"
                onClick={downloadTemplate}
                disabled={phase === "importing"}
              >
                <Download className="size-4" />
                Unduh Template (.xlsx)
              </Button>

              <div
                role="button"
                tabIndex={0}
                aria-label="Pilih file Excel untuk diimpor"
                onClick={() => !(phase === "importing") && inputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (phase !== "importing") inputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (phase !== "importing") setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (phase === "importing") return;
                  acceptFile(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
                  dragging
                    ? "border-accent bg-accent-subtle"
                    : "border-border bg-surface-sunken/30",
                  phase === "importing" && "pointer-events-none opacity-60"
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => acceptFile(e.target.files?.[0])}
                />
                {file ? (
                  <>
                    <FileSpreadsheet className="size-8 text-accent" />
                    <p className="text-sm font-medium text-text-primary">{file.name}</p>
                    <p className="text-xs text-text-secondary">
                      {formatBytes(file.size)} · siap diimpor
                    </p>
                  </>
                ) : (
                  <>
                    <UploadCloud className="size-8 text-text-muted" />
                    <p className="text-sm text-text-primary">
                      Seret file di sini atau{" "}
                      <span className="font-medium text-accent">Pilih File</span>
                    </p>
                    <p className="text-xs text-text-secondary">
                      .xlsx · maks 2 MB · 500 baris data
                    </p>
                  </>
                )}
              </div>

              {inlineError && <InlineError message={inlineError} />}

              <label className="flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={partial}
                  onCheckedChange={(v) => setPartial(v === true)}
                  disabled={phase === "importing"}
                  className="mt-0.5 size-5"
                  aria-label="Lewati baris yang gagal"
                />
                <span className="text-sm text-text-primary">
                  Lewati baris yang gagal (simpan baris valid)
                  <span className="block text-xs text-text-secondary">
                    Mati: ada satu baris error saja = tidak ada yang tersimpan.
                  </span>
                </span>
              </label>

              {phase === "importing" && (
                <div
                  role="progressbar"
                  aria-label="Mengimpor file"
                  className="h-1 w-full overflow-hidden rounded-full bg-accent-subtle"
                >
                  {/* indeterminate shimmer — kelas .skeleton existing */}
                  <div className="skeleton h-full w-full rounded-full" />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="h-12 sm:h-9"
                disabled={phase === "importing"}
                onClick={() => onOpenChange(false)}
              >
                Batal
              </Button>
              <Button
                className="h-12 sm:h-9"
                disabled={!file || phase === "importing"}
                onClick={handleImport}
              >
                {phase === "importing" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UploadCloud className="size-4" />
                )}
                {phase === "importing" ? "Mengimpor…" : "Import Sekarang"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
