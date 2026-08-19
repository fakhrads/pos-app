import { cn } from "@/lib/utils"

/**
 * Skeleton — pakai class custom `.skeleton` (shimmer, lihat globals.css)
 * supaya konsisten dengan design token --skeleton-base/--skeleton-shine.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton", className)}
      {...props}
    />
  )
}

export { Skeleton }
