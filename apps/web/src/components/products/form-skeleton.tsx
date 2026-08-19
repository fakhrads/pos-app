import { Skeleton } from "@/components/shared/skeletons";

/**
 * FormSkeleton — 4 baris skeleton field saat form edit dibuka (DESIGN §4 L3/L4/L5).
 * Memakai kelas `.skeleton` (shimmer) dari shared skeletons.
 */
export function FormSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}
