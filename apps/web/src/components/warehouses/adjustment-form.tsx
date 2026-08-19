"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardEdit, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineError } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { fetchAllPages, isValidQty, roundQty, stockKey } from "@/lib/warehouse";
import {
  ADJUSTMENT_REASON_LABEL,
  ADJUSTMENT_REASONS,
} from "@/lib/types-warehouse";
import type {
  StockAdjustmentPayload,
  StockAdjustmentResult,
  Warehouse,
  WarehouseStock,
} from "@/lib/types-warehouse";

export interface AdjustmentPreset {
  warehouseId: string;
  productId?: string;
  variantId?: string | null;
  /** Stok saat ini (untuk info & validasi pengurangan) */
  quantity?: number;
  unit?: string;
  name?: string;
}

function stockLabel(s: WarehouseStock): string {
  const variant = s.variantName ? ` · ${s.variantName}` : "";
  return `${s.name}${variant} — stok ${formatNumber(s.quantity)} ${s.unit}`;
}

/**
 * AdjustmentForm (F3-4) — koreksi stok manual ± dengan ALASAN WAJIB dari
 * daftar tetap (rusak, expired, hilang, salah_catat, selisih_supplier, lainnya).
 * POST /stock-adjustments — langsung jadi, immutable; koreksi salah = adjustment baru.
 */
export function AdjustmentForm({
  open,
  onOpenChange,
  onSaved,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Preselect (mis. dari baris stok di halaman detail gudang) */
  preset?: AdjustmentPreset | null;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [warehouseId, setWarehouseId] = useState("");
  const [stocks, setStocks] = useState<WarehouseStock[]>([]);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [stocksError, setStocksError] = useState<string | null>(null);

  const [productKey, setProductKey] = useState(""); // "productId:variantId"
  const [direction, setDirection] = useState<"add" | "reduce">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stockMap = useMemo(
    () => new Map(stocks.map((s) => [stockKey(s.productId, s.variantId), s])),
    [stocks]
  );
  const selected = productKey ? stockMap.get(productKey) : undefined;

  /* ---- muat gudang aktif ---- */
  const loadWarehouses = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ items: Warehouse[] }>("/warehouses", { page: 1, perPage: 100 });
      const active = data.items.filter((w) => w.isActive);
      setWarehouses(active);
      setWarehouseId((prev) => {
        const wanted = preset?.warehouseId ?? active.find((w) => w.isDefault)?.id ?? active[0]?.id ?? "";
        // simpan juga preset produk yang diinginkan utk dipakai setelah stok dimuat
        return prev || wanted;
      });
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Gagal memuat daftar gudang");
    } finally {
      setLoading(false);
    }
  }, [preset?.warehouseId]);

  /* ---- muat stok gudang terpilih (semua halaman) ---- */
  const loadStocks = useCallback(
    async (whId: string) => {
      setStocksLoading(true);
      setStocksError(null);
      try {
        const all = await fetchAllPages<WarehouseStock>(`/warehouses/${whId}/stocks`, {
          includeInactiveProduct: true,
        });
        setStocks(all);
        // Preselect produk dari preset (stok gudang preset)
        if (preset?.productId && whId === preset.warehouseId) {
          const want = stockKey(preset.productId, preset.variantId);
          if (all.some((s) => stockKey(s.productId, s.variantId) === want)) {
            setProductKey(want);
          }
        }
      } catch (err) {
        setStocksError(err instanceof ApiError ? err.message : "Gagal memuat stok gudang");
      } finally {
        setStocksLoading(false);
      }
    },
    [preset]
  );

  useEffect(() => {
    if (!open) return;
    setQty("");
    setDirection("add");
    setReason("");
    setNote("");
    setProductKey("");
    setFieldErrors({});
    setFormError(null);
    setStocks([]);
    loadWarehouses();
  }, [open, loadWarehouses]);

  useEffect(() => {
    if (!open || !warehouseId) return;
    loadStocks(warehouseId);
  }, [open, warehouseId, loadStocks]);

  function handleWarehouseChange(value: string) {
    setWarehouseId(value);
    setProductKey("");
  }

  const delta = direction === "add" ? roundQty(Number(qty) || 0) : -roundQty(Number(qty) || 0);
  const afterQty = selected ? roundQty(Math.max(0, selected.quantity + delta)) : null;

  async function handleSubmit() {
    const e: Record<string, string> = {};
    if (!warehouseId) e.warehouse = "Pilih gudang.";
    if (!productKey) e.product = "Pilih produk.";
    if (!isValidQty(qty)) e.qty = "Jumlah wajib angka > 0 (maks 3 desimal).";
    else if (direction === "reduce" && selected && roundQty(Number(qty)) > selected.quantity) {
      e.qty = `Melebihi stok saat ini (${formatNumber(selected.quantity)} ${selected.unit}).`;
    }
    if (!reason) e.reason = "Alasan wajib dipilih.";

    setFieldErrors(e);
    if (Object.keys(e).length > 0) return;

    const idx = productKey.indexOf(":");
    const payload: StockAdjustmentPayload = {
      warehouseId,
      productId: productKey.slice(0, idx),
      variantId: productKey.slice(idx + 1) || null,
      quantityDelta: delta,
      reason,
      note: note.trim() || null,
    };

    setSaving(true);
    setFormError(null);
    try {
      const res = await api.post<StockAdjustmentResult>("/stock-adjustments", payload);
      toast.success(
        `Stok dikoreksi: ${formatNumber(res.beforeQty)} → ${formatNumber(res.afterQty)} (${res.adjustment.reason}).`
      );
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "STOCK_INSUFFICIENT") {
        const d = err.details as { available?: number; requested?: number } | undefined;
        setFormError(
          `Stok tidak cukup: tersedia ${formatNumber(d?.available ?? 0)}, diminta ${formatNumber(d?.requested ?? Math.abs(delta))}. Tidak ada perubahan tersimpan.`
        );
      } else if (err instanceof ApiError && err.code === "ZERO_DELTA") {
        setFormError("Jumlah tidak boleh 0.");
      } else {
        setFormError(err instanceof ApiError ? err.message : "Gagal menyimpan koreksi. Coba lagi.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardEdit className="size-4" /> Koreksi Stok
          </DialogTitle>
          <DialogDescription>
            Sesuaikan stok fisik dengan sistem. Alasan wajib — riwayat tidak bisa diedit.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat data gudang…
          </div>
        ) : loadError ? (
          <InlineError message={loadError} onRetry={loadWarehouses} />
        ) : warehouses.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Belum ada gudang aktif.
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="adj-wh">Gudang</Label>
              <Select value={warehouseId} onValueChange={handleWarehouseChange}>
                <SelectTrigger id="adj-wh" className="min-h-11">
                  <SelectValue placeholder="Pilih gudang" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.warehouse && <p className="text-xs text-destructive">{fieldErrors.warehouse}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adj-product">Produk</Label>
              <Select value={productKey || undefined} onValueChange={setProductKey}>
                <SelectTrigger id="adj-product" className="min-h-11">
                  <SelectValue placeholder="Pilih produk" />
                </SelectTrigger>
                <SelectContent>
                  {stocks.map((s) => (
                    <SelectItem key={stockKey(s.productId, s.variantId)} value={stockKey(s.productId, s.variantId)}>
                      {stockLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {stocksLoading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Memuat stok…
                </p>
              )}
              {stocksError && <InlineError message={stocksError} onRetry={() => loadStocks(warehouseId)} />}
              {fieldErrors.product && <p className="text-xs text-destructive">{fieldErrors.product}</p>}
            </div>

            {selected && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Stok saat ini:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {formatNumber(selected.quantity)} {selected.unit}
                </span>
                {afterQty !== null && delta !== 0 && (
                  <>
                    {" "}
                    → setelah koreksi:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {formatNumber(afterQty)} {selected.unit}
                    </span>
                  </>
                )}
              </p>
            )}

            {/* Arah + jumlah */}
            <div className="space-y-1.5">
              <Label>Arah Koreksi</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={direction === "add" ? "default" : "outline"}
                  className="min-h-11"
                  onClick={() => setDirection("add")}
                >
                  <Plus className="mr-1 size-4" /> Tambah Stok
                </Button>
                <Button
                  type="button"
                  variant={direction === "reduce" ? "destructive" : "outline"}
                  className="min-h-11"
                  onClick={() => setDirection("reduce")}
                >
                  <Minus className="mr-1 size-4" /> Kurangi Stok
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adj-qty">Jumlah</Label>
              <Input
                id="adj-qty"
                type="number"
                min="0"
                step="0.001"
                inputMode="decimal"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="min-h-11 font-mono"
              />
              {fieldErrors.qty && <p className="text-xs text-destructive">{fieldErrors.qty}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adj-reason">Alasan (wajib)</Label>
              <Select value={reason || undefined} onValueChange={setReason}>
                <SelectTrigger id="adj-reason" className="min-h-11">
                  <SelectValue placeholder="Pilih alasan koreksi" />
                </SelectTrigger>
                <SelectContent>
                  {ADJUSTMENT_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ADJUSTMENT_REASON_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.reason && <p className="text-xs text-destructive">{fieldErrors.reason}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adj-note">Catatan (opsional)</Label>
              <Textarea
                id="adj-note"
                placeholder='Mis. "2 dus kemasan penyok saat bongkar"'
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>

            {formError && <InlineError message={formError} />}
          </>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">
            Batal
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={loading || saving || !selected}
            className="min-h-11"
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Simpan Koreksi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
