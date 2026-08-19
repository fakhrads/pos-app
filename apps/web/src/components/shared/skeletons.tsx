import { cn } from "@/lib/utils";

/**
 * Base skeleton — uses CSS variables for theme-aware colors
 * Light: skeleton-base darker than surface
 * Dark: skeleton-base lighter than surface
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-skeleton-base",
        className
      )}
      {...props}
    />
  );
}

/**
 * Card skeleton — meniru bentuk kartu
 */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface-raised p-4", className)}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}

/**
 * Table skeleton — meniru tabel dengan baris
 */
export function TableSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex gap-4 pb-2 border-b border-border">
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-1/4" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      ))}
    </div>
  );
}

/**
 * Product grid skeleton — meniru grid produk di kasir
 */
export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface-raised p-3">
          <Skeleton className="aspect-square w-full rounded-md mb-2" />
          <Skeleton className="h-4 w-3/4 mb-1" />
          <Skeleton className="h-3 w-1/2 mb-2" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Dashboard stat skeleton — meniru kartu statistik
 */
export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-5">
      <div className="flex items-start justify-between mb-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

/**
 * Chart skeleton — meniru area chart
 */
export function ChartSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-5">
      <Skeleton className="h-4 w-32 mb-4" />
      <div className="flex items-end gap-2 h-40">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2">
            <Skeleton
              className="w-full rounded-t"
              style={{ height: `${30 + Math.random() * 70}%` }}
            />
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Product card skeleton — untuk list produk
 */
export function ProductCardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-3">
      <Skeleton className="h-12 w-12 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0">
        <Skeleton className="h-4 w-3/4 mb-1" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="text-right">
        <Skeleton className="h-4 w-16 mb-1" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

/**
 * Transaction list skeleton
 */
export function TransactionListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-surface-raised p-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div>
              <Skeleton className="h-4 w-24 mb-1" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="text-right">
            <Skeleton className="h-4 w-20 mb-1" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Warehouse detail skeleton
 */
export function WarehouseDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface-raised p-5">
        <Skeleton className="h-4 w-32 mb-4" />
        <TableSkeleton rows={5} />
      </div>
    </div>
  );
}

export { Skeleton };
