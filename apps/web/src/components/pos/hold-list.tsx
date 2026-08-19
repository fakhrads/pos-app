"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ParkingCircle, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InlineError } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/utils";
import type { HeldCart, Paginated } from "@/lib/types";

interface HoldListProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** naikkan untuk me-refresh daftar dari server */
  refreshKey: number;
  onResume: (hold: HeldCart) => void;
  onDiscard: (hold: HeldCart) => void;
  /** item yang masih dimuat (resume) — tampilkan spinner baris */
  resumingId?: string | null;
}

export function HoldList({ open, onOpenChange, refreshKey, onResume, onDiscard, resumingId }: HoldListProps) {
  const [items, setItems] = useState<HeldCart[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<HeldCart | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Paginated<HeldCart>>("/held-carts", { perPage: 50 });
      setItems(data.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat transaksi ditahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, refreshKey, load]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[80vh] gap-0 rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <ParkingCircle className="size-4" />
              Transaksi Ditahan
            </SheetTitle>
            <SheetDescription className="text-xs">
              Hold kadaluarsa otomatis di akhir hari (WIB). Harga dihitung ulang dari server saat
              dilanjutkan.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading ? (
              /* State: loading */
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-24 rounded-lg" />
                ))}
              </div>
            ) : error ? (
              /* State: error */
              <InlineError message={error} onRetry={load} />
            ) : items.length === 0 ? (
              /* State: kosong */
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <ParkingCircle className="size-10 text-muted-foreground/50" />
                <p className="text-sm font-medium">Tidak ada transaksi ditahan</p>
                <p className="text-xs text-muted-foreground">
                  Tahan transaksi dari keranjang untuk melanjutkannya nanti.
                </p>
              </div>
            ) : (
              /* State: data */
              <div className="space-y-2">
                {items.map((hold) => {
                  const totalQty = hold.items.reduce((s, i) => s + i.quantity, 0);
                  const resuming = resumingId === hold.id;
                  return (
                    <div key={hold.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {hold.label || hold.holdNumber}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {hold.holdNumber}
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {hold.items.length} item · {formatNumber(totalQty)} pcs
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          Dibuat {formatDateTime(hold.createdAt ?? hold.expiresAt, { time: false })}
                          {hold.remainingMinutes != null && (
                            <span className="ml-1 text-amber-600">
                              · sisa {formatNumber(Math.max(hold.remainingMinutes, 0))} mnt
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-10 text-destructive"
                            onClick={() => setDiscarding(hold)}
                            disabled={resuming}
                            title="Buang hold"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-10 px-3"
                            onClick={() => onResume(hold)}
                            disabled={resuming}
                          >
                            {resuming ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Play className="size-4" />
                            )}
                            Lanjutkan
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!discarding}
        onOpenChange={(o) => !o && setDiscarding(null)}
        title={`Buang ${discarding?.holdNumber ?? "hold"}?`}
        description="Keranjang yang ditahan akan dibuang permanen. Tidak ada stok atau transaksi yang terpengaruh."
        confirmText="Ya, Buang"
        onConfirm={() => {
          if (discarding) onDiscard(discarding);
          setDiscarding(null);
        }}
      />
    </>
  );
}
