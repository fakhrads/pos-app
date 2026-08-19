"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * StockBadge — semantik stok konsisten (DESIGN Fase 2 §3).
 * - Habis (danger)          : stockOnHand <= 0
 * - Stok Menipis (warning)  : stockOnHand <= minStock
 * - Aman (success)          : di atas ambang
 * - Jasa · Tanpa Stok (info): trackStock=false (tidak pernah dihitung menipis, REP-03)
 *
 * Badge TIDAK mengandalkan warna saja — selalu ada teks.
 * Variant badge memakai override token (tidak menambah token baru, tidak ubah design system).
 */
export function StockBadge({
  stockOnHand,
  minStock,
  trackStock,
  className,
}: {
  stockOnHand: number;
  minStock: number;
  trackStock?: boolean;
  className?: string;
}) {
  // Produk jasa: tanpa stok, tanpa cek menipis
  if (trackStock === false) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-info-subtle bg-info-subtle text-info",
          className
        )}
      >
        Jasa · Tanpa Stok
      </Badge>
    );
  }

  const stock = Number(stockOnHand) || 0;
  if (stock <= 0) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-danger-subtle bg-danger-subtle text-danger",
          className
        )}
      >
        Habis
      </Badge>
    );
  }
  if (stock <= Number(minStock) || 0) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "border-warning-subtle bg-warning-subtle text-warning",
          className
        )}
      >
        Stok Menipis
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-success-subtle bg-success-subtle text-success",
        className
      )}
    >
      Aman
    </Badge>
  );
}
