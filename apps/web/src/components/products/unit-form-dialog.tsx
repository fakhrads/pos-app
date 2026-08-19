"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { InlineError } from "@/components/shared/states";
import { FormSkeleton } from "@/components/products/form-skeleton";
import { UnitConversionLabel } from "@/components/products/unit-conversion-label";
import { api, ApiError } from "@/lib/api";
import { cn, debounce } from "@/lib/utils";
import { toast } from "sonner";
import type { Product, ProductUnit, ProductUnitPayload } from "@/lib/types";

/** Satuan umum Indonesia (DESIGN L5) */
export const COMMON_UNITS = [
  "dus",
  "renceng",
  "karton",
  "lusin",
  "kodi",
  "bungkus",
  "ikat",
];

/**
 * UnitFormDialog (L5) — tambah/ubah satuan konversi dari halaman Detail.
 * Create: POST /products/:id/units (AC-03.x)
 * Edit  : PATCH /product-units/:id
 * Helper live "1 dus = 40 pcs" (mono, text-secondary, debounce 150ms).
 */
export function UnitFormDialog({
  open,
  onOpenChange,
  product,
  unit,
  loading = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  /** null = tambah baru */
  unit?: ProductUnit | null;
  loading?: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductUnitPayload>({
    unit: "",
    factor: 1,
    sellPrice: 0,
    isSellable: true,
    isPurchaseUnit: false,
    minQty: 1,
  });
  const [customUnit, setCustomUnit] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!unit;

  useEffect(() => {
    if (open) {
      setForm(
        unit
          ? {
              unit: unit.unit,
              factor: unit.factor,
              sellPrice: unit.sellPrice,
              isSellable: unit.isSellable,
              isPurchaseUnit: unit.isPurchaseUnit,
              minQty: unit.minQty,
            }
          : { unit: "", factor: 1, sellPrice: 0, isSellable: true, isPurchaseUnit: false, minQty: 1 }
      );
      setCustomUnit(false);
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, unit]);

  const errorMap = useMemo<Record<string, string>>(
    () => ({
      DUPLICATE_UNIT: "Satuan ini sudah terdaftar, atau sama dengan satuan dasar.",
      INVALID_FACTOR: "Faktor harus lebih besar dari 0.",
    }),
    []
  );

  function applyServerError(err: ApiError) {
    const code = err.code;
    if (code in errorMap) {
      const msg = errorMap[code];
      if (code === "DUPLICATE_UNIT") setFieldErrors((f) => ({ ...f, unit: msg }));
      else setFieldErrors((f) => ({ ...f, factor: msg }));
      return;
    }
    const field = (err.details as { field?: string } | undefined)?.field ?? "";
    if (field.includes("factor")) setFieldErrors((f) => ({ ...f, factor: err.message }));
    else if (field.includes("unit")) setFieldErrors((f) => ({ ...f, unit: err.message }));
    else setFormError(err.message);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    const u = form.unit.trim().toLowerCase();
    if (!u) e.unit = "Nama satuan wajib diisi.";
    else if (u === product.unit.toLowerCase())
      e.unit = `Tidak boleh sama dengan satuan dasar (${product.unit}).`;
    if (!(Number(form.factor) > 0)) e.factor = "Faktor harus lebih besar dari 0.";
    if (Number(form.sellPrice) < 0) e.sellPrice = "Harga tidak boleh negatif.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    try {
      const payload: ProductUnitPayload = {
        unit: form.unit.trim().toLowerCase(),
        factor: Number(form.factor),
        sellPrice: Math.round(Number(form.sellPrice) || 0),
        isSellable: form.isSellable,
        isPurchaseUnit: form.isPurchaseUnit,
        minQty: Math.max(1, Number(form.minQty) || 1),
      };
      if (isEdit && unit) {
        await api.patch(`/product-units/${unit.id}`, payload);
        toast.success("Satuan disimpan");
      } else {
        await api.post(`/products/${product.id}/units`, payload);
        toast.success("Satuan disimpan");
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        applyServerError(err);
      } else {
        setFormError(
          err instanceof ApiError ? err.message : "Gagal menyimpan. Coba lagi."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  const unitLabel = form.unit.trim() || "satuan";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Satuan" : "Tambah Satuan"}</DialogTitle>
          <DialogDescription>
            {product.name} · satuan dasar {product.unit}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <FormSkeleton />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="u-unit">Nama Satuan *</Label>
              {customUnit ? (
                <Input
                  id="u-unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="cth. slop, ball, karung"
                  disabled={saving}
                  aria-invalid={!!fieldErrors.unit}
                  aria-describedby={fieldErrors.unit ? "u-unit-error" : undefined}
                  className={cn(fieldErrors.unit && "border-danger")}
                />
              ) : (
                <Select
                  value={form.unit || undefined}
                  onValueChange={(v) => {
                    if (v === "__custom__") {
                      setCustomUnit(true);
                      setForm({ ...form, unit: "" });
                    } else {
                      setForm({ ...form, unit: v });
                    }
                  }}
                  disabled={saving}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={!!fieldErrors.unit}
                  >
                    <SelectValue placeholder="Pilih satuan…" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Lainnya…</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {fieldErrors.unit ? (
                <p id="u-unit-error" role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.unit}
                </p>
              ) : (
                <p id="u-unit-helper" className="text-xs text-text-secondary">
                  Tidak boleh sama dengan satuan dasar ({product.unit}).
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="u-factor">Faktor Konversi *</Label>
              <Input
                id="u-factor"
                type="number"
                min={0.001}
                step="0.001"
                inputMode="decimal"
                value={form.factor || ""}
                onChange={(e) => setForm({ ...form, factor: Number(e.target.value) })}
                disabled={saving}
                aria-invalid={!!fieldErrors.factor}
                aria-describedby={
                  fieldErrors.factor ? "u-factor-error" : "u-factor-helper"
                }
                className={cn("tabular-nums", fieldErrors.factor && "border-danger")}
              />
              {fieldErrors.factor ? (
                <p id="u-factor-error" role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.factor}
                </p>
              ) : (
                <p id="u-factor-helper" className="text-xs text-text-secondary">
                  Berapa {product.unit} dalam 1 {unitLabel}?
                </p>
              )}
              {/* Helper live — debounce 150ms */}
              <LiveConversion
                unit={unitLabel}
                factor={Number(form.factor) || 0}
                baseUnit={product.unit}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="u-price">Harga Jual per {unitLabel} (Rp) *</Label>
              <Input
                id="u-price"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.sellPrice || ""}
                onChange={(e) => setForm({ ...form, sellPrice: Number(e.target.value) })}
                disabled={saving}
                aria-invalid={!!fieldErrors.sellPrice}
                className={cn("tabular-nums", fieldErrors.sellPrice && "border-danger")}
              />
              {fieldErrors.sellPrice && (
                <p role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.sellPrice}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="u-sellable" className="text-sm font-normal">
                    Bisa Dijual di Kasir
                  </Label>
                  <p id="u-sellable-helper" className="text-xs text-text-secondary">
                    Matikan bila satuan ini hanya untuk pembelian.
                  </p>
                </div>
                <Switch
                  id="u-sellable"
                  checked={form.isSellable}
                  onCheckedChange={(v) => setForm({ ...form, isSellable: v })}
                  disabled={saving}
                  aria-describedby="u-sellable-helper"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="u-buy" className="text-sm font-normal">
                    Satuan Beli
                  </Label>
                  <p id="u-buy-helper" className="text-xs text-text-secondary">
                    Flag untuk modul pembelian (nanti).
                  </p>
                </div>
                <Switch
                  id="u-buy"
                  checked={form.isPurchaseUnit}
                  onCheckedChange={(v) => setForm({ ...form, isPurchaseUnit: v })}
                  disabled={saving}
                  aria-describedby="u-buy-helper"
                />
              </div>
            </div>

            {formError && <InlineError message={formError} />}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            className="h-12 sm:h-9"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button
            className="h-12 sm:h-9"
            disabled={saving || loading}
            onClick={handleSave}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Helper live "1 dus = 40 pcs" — debounce 150ms (DESIGN §8) */
function LiveConversion({
  unit,
  factor,
  baseUnit,
}: {
  unit: string;
  factor: number;
  baseUnit: string;
}) {
  const [shown, setShown] = useState({ unit, factor });

  useEffect(() => {
    const run = debounce(() => setShown({ unit, factor }), 150);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [unit, factor]);

  if (!shown.unit || !(shown.factor > 0)) return null;
  return (
    <UnitConversionLabel
      unit={shown.unit}
      factor={shown.factor}
      baseUnit={baseUnit}
      className="block pt-1"
    />
  );
}
