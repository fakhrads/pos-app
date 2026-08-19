"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineError } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import type { StockAdjustPayload } from "@/lib/types";

export interface StockTarget {
  id: string;
  name: string;
  unit: string;
  stockOnHand: number;
  kind: "product" | "variant";
}

/**
 * StockAdjustDialog (L7) — Koreksi Stok produk & varian (extend existing).
 * Produk : PATCH /products/:id/stock
 * Varian : PATCH /product-variants/:id/stock (SPEC §4.2)
 * Error STOCK_INSUFFICIENT → InlineError "Stok tidak cukup (tersisa X pcs, diminta Y pcs)".
 */
export function StockAdjustDialog({
  target,
  onClose,
  onSaved,
}: {
  target: StockTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [type, setType] = useState<"purchase_in" | "adjustment">("purchase_in");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setDelta("");
      setType("purchase_in");
      setNote("");
      setFieldErrors({});
      setFormError(null);
    }
  }, [target]);

  const qty = Number(delta) || 0;
  const after = target ? Math.max(0, target.stockOnHand + qty) : 0;

  async function handleSave() {
    if (!target) return;
    const e: Record<string, string> = {};
    if (!delta.trim() || qty === 0) e.delta = "Jumlah wajib diisi dan tidak boleh 0.";
    if (!note.trim()) e.note = "Catatan wajib diisi.";
    setFieldErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    setFormError(null);
    try {
      const payload: StockAdjustPayload = {
        quantityDelta: qty,
        type,
        note: note.trim(),
      };
      const path =
        target.kind === "variant"
          ? `/product-variants/${target.id}/stock`
          : `/products/${target.id}/stock`;
      await api.patch(path, payload);
      toast.success("Stok dikoreksi");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STOCK_INSUFFICIENT") {
        const d = err.details as
          | { available?: number; requested?: number; unit?: string }
          | undefined;
        const unit = d?.unit ?? target.unit;
        setFormError(
          `Stok tidak cukup (tersisa ${formatNumber(d?.available ?? target.stockOnHand)} ${unit}, diminta ${formatNumber(d?.requested ?? Math.abs(qty))} ${unit}).`
        );
      } else if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        const field = (err.details as { field?: string } | undefined)?.field ?? "";
        if (field.includes("note")) setFieldErrors((f) => ({ ...f, note: err.message }));
        else setFormError(err.message);
      } else {
        setFormError(
          err instanceof ApiError ? err.message : "Gagal menyimpan. Coba lagi."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  const isVariant = target?.kind === "variant";

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isVariant ? `Koreksi Stok — Varian ${target?.name ?? ""}` : "Koreksi Stok"}
          </DialogTitle>
          <DialogDescription>{target?.name}</DialogDescription>
        </DialogHeader>

        {target && (
          <div className="space-y-4">
            <div className="rounded-lg border border-info-subtle bg-info-subtle/50 px-3 py-2.5">
              <p className="font-mono text-lg font-semibold tabular-nums text-text-primary">
                {formatNumber(target.stockOnHand)} {target.unit}
              </p>
              <p className="text-xs text-text-secondary">Stok tersedia</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sa-type">Jenis Koreksi</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as "purchase_in" | "adjustment")}
                disabled={saving}
              >
                <SelectTrigger id="sa-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase_in">Pembelian Masuk</SelectItem>
                  <SelectItem value="adjustment">Penyesuaian</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sa-delta">Jumlah</Label>
              <Input
                id="sa-delta"
                type="number"
                step="0.001"
                inputMode="decimal"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="+10 atau -15"
                disabled={saving}
                aria-invalid={!!fieldErrors.delta}
                aria-describedby={fieldErrors.delta ? "sa-delta-error" : "sa-delta-helper"}
                className={cn("tabular-nums", fieldErrors.delta && "border-danger")}
              />
              {fieldErrors.delta ? (
                <p id="sa-delta-error" role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.delta}
                </p>
              ) : (
                <p id="sa-delta-helper" className="text-xs text-text-secondary">
                  Pakai minus untuk mengurangi. Stok setelah:{" "}
                  <strong className="font-mono tabular-nums">
                    {formatNumber(after)} {target.unit}
                  </strong>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sa-note">Catatan *</Label>
              <Input
                id="sa-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="cth. barang hilang, rusak, selisih hitung"
                disabled={saving}
                aria-invalid={!!fieldErrors.note}
                aria-describedby={fieldErrors.note ? "sa-note-error" : "sa-note-helper"}
                className={cn(fieldErrors.note && "border-danger")}
              />
              {fieldErrors.note ? (
                <p id="sa-note-error" role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.note}
                </p>
              ) : (
                <p id="sa-note-helper" className="text-xs text-text-secondary">
                  Catatan wajib diisi dan tercatat di riwayat.
                </p>
              )}
            </div>

            {formError && <InlineError message={formError} />}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            className="h-12 sm:h-9"
            disabled={saving}
            onClick={onClose}
          >
            Batal
          </Button>
          <Button
            className="h-12 sm:h-9"
            disabled={saving || !target}
            onClick={handleSave}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Menyimpan…" : "Simpan Koreksi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
