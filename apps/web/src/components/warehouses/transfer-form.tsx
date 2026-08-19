"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, PackagePlus, Plus, Trash2 } from "lucide-react";
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
import type {
  StockTransferPayload,
  StockTransferResult,
  Warehouse,
  WarehouseStock,
} from "@/lib/types-warehouse";

interface ItemDraft {
  id: string;
  stockKey: string; // "productId:variantId" — "" = belum dipilih
  quantity: string;
  notes: string;
}

const MAX_ITEMS = 50; // batas backend (SPEC §4.3)

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function stockLabel(s: WarehouseStock): string {
  const variant = s.variantName ? ` · ${s.variantName}` : "";
  return `${s.name}${variant} — sisa ${formatNumber(s.quantity)} ${s.unit}`;
}

/**
 * TransferForm (F3-3) — transfer stok antar gudang, multi-item (1..50),
 * langsung jadi. Gudang asal→tujuan aktif, qty divalidasi vs stok asal.
 * POST /stock-transfers → 1 dokumen TRF-YYYYMMDD-XXXX (dibuat server).
 */
export function TransferForm({
  open,
  onOpenChange,
  onSaved,
  presetFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dipanggil setelah transfer sukses — parent me-refresh data */
  onSaved: () => void;
  /** Preselect gudang asal (mis. dari halaman detail gudang) */
  presetFrom?: string;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [stocks, setStocks] = useState<WarehouseStock[]>([]);
  const [stocksLoading, setStocksLoading] = useState(false);
  const [stocksError, setStocksError] = useState<string | null>(null);

  const [items, setItems] = useState<ItemDraft[]>([]);
  const [docNotes, setDocNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stockMap = useMemo(() => new Map(stocks.map((s) => [stockKey(s.productId, s.variantId), s])), [stocks]);

  /* ---- muat daftar gudang aktif saat dialog dibuka ---- */
  const loadWarehouses = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ items: Warehouse[] }>("/warehouses", { page: 1, perPage: 100 });
      const active = data.items.filter((w) => w.isActive);
      setWarehouses(active);
      const def = presetFrom ?? active.find((w) => w.isDefault)?.id ?? active[0]?.id ?? "";
      setFromId(def);
      setToId(active.find((w) => w.id !== def)?.id ?? "");
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Gagal memuat daftar gudang");
    } finally {
      setLoading(false);
    }
  }, [presetFrom]);

  /* ---- muat stok gudang asal (semua halaman, untuk pilihan produk) ---- */
  const loadStocks = useCallback(async (warehouseId: string) => {
    setStocksLoading(true);
    setStocksError(null);
    try {
      const all = await fetchAllPages<WarehouseStock>(`/warehouses/${warehouseId}/stocks`, {
        includeInactiveProduct: true,
      });
      setStocks(all);
    } catch (err) {
      setStocksError(err instanceof ApiError ? err.message : "Gagal memuat stok gudang asal");
    } finally {
      setStocksLoading(false);
    }
  }, []);

  // Reset + muat data tiap kali dialog dibuka
  useEffect(() => {
    if (!open) return;
    setItems([]);
    setDocNotes("");
    setFieldErrors({});
    setFormError(null);
    setStocks([]);
    loadWarehouses();
  }, [open, loadWarehouses]);

  // Muat stok saat gudang asal berubah
  useEffect(() => {
    if (!open || !fromId) return;
    setItems([]);
    loadStocks(fromId);
  }, [open, fromId, loadStocks]);

  function handleFromChange(value: string) {
    setFromId(value);
    setToId((prev) => (prev && prev !== value ? prev : warehouses.find((w) => w.id !== value)?.id ?? ""));
  }

  function addItem() {
    setItems((prev) =>
      prev.length >= MAX_ITEMS
        ? prev
        : [...prev, { id: uid(), stockKey: "", quantity: "", notes: "" }]
    );
  }

  function updateItem(id: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  const totalQty = useMemo(
    () => roundQty(items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)),
    [items]
  );

  async function handleSubmit() {
    const e: Record<string, string> = {};
    if (!fromId) e.from = "Pilih gudang asal.";
    if (!toId) e.to = "Pilih gudang tujuan.";
    if (fromId && toId && fromId === toId) e.to = "Gudang asal dan tujuan tidak boleh sama.";
    if (items.length === 0) e.items = "Tambahkan minimal 1 item.";

    const seen = new Set<string>();
    items.forEach((it, i) => {
      if (!it.stockKey) {
        e[`item-${it.id}`] = "Pilih produk.";
        return;
      }
      if (seen.has(it.stockKey)) {
        e[`item-${it.id}`] = "Produk ini sudah ada di daftar — gabungkan qty-nya.";
        return;
      }
      seen.add(it.stockKey);
      if (!isValidQty(it.quantity)) {
        e[`item-${it.id}`] = "Qty wajib angka > 0 (maks 3 desimal).";
        return;
      }
      const row = stockMap.get(it.stockKey);
      if (!row) {
        e[`item-${it.id}`] = "Produk tidak ditemukan di stok gudang asal.";
        return;
      }
      const qty = roundQty(Number(it.quantity));
      if (qty > row.quantity) {
        e[`item-${it.id}`] = `Melebihi stok tersedia (${formatNumber(row.quantity)} ${row.unit}).`;
      }
    });

    setFieldErrors(e);
    if (Object.keys(e).length > 0) return;

    const payload: StockTransferPayload = {
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      items: items.map((it) => {
        const { productId, variantId } = (() => {
          const idx = it.stockKey.indexOf(":");
          return {
            productId: it.stockKey.slice(0, idx),
            variantId: it.stockKey.slice(idx + 1) || null,
          };
        })();
        return {
          productId,
          variantId,
          quantity: roundQty(Number(it.quantity)),
          notes: it.notes.trim() || null,
        };
      }),
      notes: docNotes.trim() || null,
    };

    setSaving(true);
    setFormError(null);
    try {
      const res = await api.post<StockTransferResult>("/stock-transfers", payload);
      toast.success(`Transfer ${res.transferNumber} berhasil — ${res.items.length} item dipindahkan.`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "STOCK_INSUFFICIENT") {
        const d = err.details as
          | { available?: number; requested?: number; productId?: string }
          | undefined;
        const row = d?.productId ? stockMap.get(stockKey(d.productId)) : undefined;
        setFormError(
          `Stok tidak cukup: ${err.message}${row ? ` (${row.name}${row.variantName ? ` · ${row.variantName}` : ""} — tersedia ${formatNumber(d?.available ?? 0)} ${row.unit})` : ""}. Tidak ada item yang tersimpan.`
        );
      } else {
        setFormError(err instanceof ApiError ? err.message : "Gagal membuat transfer. Coba lagi.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="size-4" /> Transfer Stok
          </DialogTitle>
          <DialogDescription>
            Pindahkan stok antar gudang. Langsung jadi — satu nomor dokumen untuk semua item.
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
            Belum ada gudang aktif. Buat gudang dulu sebelum transfer stok.
          </div>
        ) : (
          <>
            {/* Gudang asal → tujuan */}
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="tr-from">Gudang Asal</Label>
                <Select value={fromId} onValueChange={handleFromChange}>
                  <SelectTrigger id="tr-from" className="min-h-11">
                    <SelectValue placeholder="Pilih gudang asal" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.from && <p className="text-xs text-destructive">{fieldErrors.from}</p>}
              </div>
              <ArrowRight className="mx-auto size-5 shrink-0 text-muted-foreground sm:mb-3" />
              <div className="space-y-1.5">
                <Label htmlFor="tr-to">Gudang Tujuan</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger id="tr-to" className="min-h-11">
                    <SelectValue placeholder="Pilih gudang tujuan" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses
                      .filter((w) => w.id !== fromId)
                      .map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name} ({w.code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {fieldErrors.to && <p className="text-xs text-destructive">{fieldErrors.to}</p>}
              </div>
            </div>

            {/* Daftar item */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Item Transfer ({items.length}/{MAX_ITEMS})</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={addItem}
                  disabled={items.length >= MAX_ITEMS || !fromId || stocksLoading}
                >
                  <Plus className="mr-1 size-3.5" /> Tambah Item
                </Button>
              </div>

              {fieldErrors.items && <p className="text-xs text-destructive">{fieldErrors.items}</p>}

              {stocksLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-border py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Memuat stok gudang asal…
                </div>
              ) : stocksError ? (
                <InlineError message={stocksError} onRetry={() => loadStocks(fromId)} />
              ) : items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                  Klik <span className="font-medium">Tambah Item</span> untuk memilih produk yang dipindahkan.
                </p>
              ) : (
                <div className="space-y-2">
                  {items.map((it, i) => {
                    const row = it.stockKey ? stockMap.get(it.stockKey) : undefined;
                    return (
                      <div
                        key={it.id}
                        className="rounded-lg border border-border bg-surface-raised p-3"
                      >
                        <div className="grid gap-2 sm:grid-cols-[1fr_110px_auto] sm:items-end">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Produk #{i + 1}</Label>
                            <Select
                              value={it.stockKey || undefined}
                              onValueChange={(v) => updateItem(it.id, { stockKey: v })}
                            >
                              <SelectTrigger className="min-h-11">
                                <SelectValue placeholder="Pilih produk dari gudang asal" />
                              </SelectTrigger>
                              <SelectContent>
                                {stocks.map((s) => (
                                  <SelectItem
                                    key={stockKey(s.productId, s.variantId)}
                                    value={stockKey(s.productId, s.variantId)}
                                  >
                                    {stockLabel(s)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`qty-${it.id}`} className="text-xs">
                              Jumlah {row ? `(maks ${formatNumber(row.quantity)})` : ""}
                            </Label>
                            <Input
                              id={`qty-${it.id}`}
                              type="number"
                              min="0"
                              step="0.001"
                              inputMode="decimal"
                              placeholder="0"
                              value={it.quantity}
                              onChange={(e) => updateItem(it.id, { quantity: e.target.value })}
                              className="min-h-11 font-mono"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeItem(it.id)}
                            aria-label={`Hapus item ${i + 1}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <Input
                          placeholder={`Catatan item (opsional) — mis. "Restok mingguan"`}
                          value={it.notes}
                          onChange={(e) => updateItem(it.id, { notes: e.target.value })}
                          className="mt-2 min-h-11"
                        />
                        {fieldErrors[`item-${it.id}`] && (
                          <p className="mt-1 text-xs text-destructive">{fieldErrors[`item-${it.id}`]}</p>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-right text-xs text-muted-foreground">
                    Total: <span className="font-mono font-medium text-foreground">{formatNumber(totalQty)}</span> unit
                  </p>
                </div>
              )}
            </div>

            {/* Catatan dokumen */}
            <div className="space-y-1.5">
              <Label htmlFor="tr-notes">Catatan Transfer (opsional)</Label>
              <Textarea
                id="tr-notes"
                placeholder="Catatan untuk seluruh dokumen — disalin ke tiap baris"
                value={docNotes}
                onChange={(e) => setDocNotes(e.target.value)}
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
            disabled={loading || saving || items.length === 0}
            className="min-h-11"
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Transfer Sekarang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
