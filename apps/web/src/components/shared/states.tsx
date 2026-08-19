import type { ReactNode } from "react";
import { Inbox, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Empty state — tampilan saat tidak ada data
 * Ikonselalu disertai label teks (P2)
 */
export function EmptyState({
  icon,
  title = "Belum ada data",
  description,
  action,
}: {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon ? (
        <div className="mb-4 text-text-muted">{icon}</div>
      ) : (
        <Inbox className="mb-4 size-12 text-text-muted" />
      )}
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-text-secondary">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Error state — tampilan saat error
 * Jangan tulis "Something went wrong"
 * Tulis apa yang terjadi dan apa yang harus dilakukan
 */
export function ErrorState({
  title = "Gagal memuat data",
  description = "Cek koneksi internetmu, lalu coba lagi.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <AlertTriangle className="mb-4 size-12 text-warning" />
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-text-secondary">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          <RefreshCw className="mr-2 size-3.5" />
          Coba Lagi
        </Button>
      )}
    </div>
  );
}

/**
 * Inline error — untuk error di dalam tabel/card
 */
export function InlineError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-danger-subtle bg-danger-subtle/50 p-3 text-sm">
      <AlertTriangle className="size-4 text-danger shrink-0" />
      <p className="text-text-primary flex-1">{message || "Terjadi kesalahan"}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-8 px-2">
          <RefreshCw className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
