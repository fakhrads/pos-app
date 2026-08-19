"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProductVariantPayload } from "@/lib/types";

export function emptyVariant(): ProductVariantPayload {
  return {
    name: "",
    sku: "",
    barcode: "",
    costPrice: 0,
    sellingPrice: 0,
    stockOnHand: 0,
    minStock: 5,
    isActive: true,
  };
}

/**
 * FieldError — teks error per field (aria-describedby, border danger).
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-danger">
      {message}
    </p>
  );
}

/**
 * VariantFields — satu set field varian (sumber kebenaran tunggal, DESIGN §3).
 * Dipakai oleh:
 * - VariantFormRows (L3: create produk + varian inline, AC-01.1)
 * - VariantFormDialog (L4: PATCH varian standalone, AC-02.1)
 * Set field sama: Nama*, SKU, Barcode, Harga Modal, Harga Jual*, Stok Awal.
 */
export function VariantFields({
  value,
  onChange,
  errors,
  disabled,
  idPrefix,
  showStock = true,
}: {
  value: ProductVariantPayload;
  onChange: (v: ProductVariantPayload) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  idPrefix: string;
  showStock?: boolean;
}) {
  const set = <K extends keyof ProductVariantPayload>(
    key: K,
    val: ProductVariantPayload[K]
  ) => onChange({ ...value, [key]: val });

  const num = (v: string) => {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Nama Varian *</Label>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="cth. Rasa Sapi Panggang, Ukuran 600ml, Warna Hitam"
          disabled={disabled}
          aria-invalid={!!errors?.name}
          aria-describedby={errors?.name ? `${idPrefix}-name-error` : undefined}
          className={cn(errors?.name && "border-danger")}
        />
        <FieldError id={`${idPrefix}-name-error`} message={errors?.name} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-sku`}>Kode (SKU)</Label>
        <Input
          id={`${idPrefix}-sku`}
          value={value.sku ?? ""}
          onChange={(e) => set("sku", e.target.value)}
          placeholder="MIN-001-A"
          disabled={disabled}
          aria-invalid={!!errors?.sku}
          aria-describedby={errors?.sku ? `${idPrefix}-sku-error` : undefined}
          className={cn("font-mono", errors?.sku && "border-danger")}
        />
        <FieldError id={`${idPrefix}-sku-error`} message={errors?.sku} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-barcode`}>Barcode</Label>
        <Input
          id={`${idPrefix}-barcode`}
          value={value.barcode ?? ""}
          onChange={(e) => set("barcode", e.target.value)}
          placeholder="899xxxxxxxx"
          disabled={disabled}
          aria-invalid={!!errors?.barcode}
          aria-describedby={errors?.barcode ? `${idPrefix}-barcode-error` : undefined}
          className={cn("font-mono", errors?.barcode && "border-danger")}
        />
        <FieldError id={`${idPrefix}-barcode-error`} message={errors?.barcode} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-cost`}>Harga Modal (Rp)</Label>
        <Input
          id={`${idPrefix}-cost`}
          type="number"
          min={0}
          inputMode="numeric"
          value={value.costPrice || ""}
          onChange={(e) => set("costPrice", Math.max(0, num(e.target.value)))}
          disabled={disabled}
          className="tabular-nums"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-sell`}>Harga Jual (Rp) *</Label>
        <Input
          id={`${idPrefix}-sell`}
          type="number"
          min={0}
          inputMode="numeric"
          value={value.sellingPrice || ""}
          onChange={(e) => set("sellingPrice", Math.max(0, num(e.target.value)))}
          disabled={disabled}
          aria-invalid={!!errors?.sellingPrice}
          aria-describedby={
            errors?.sellingPrice ? `${idPrefix}-sell-error` : undefined
          }
          className={cn("tabular-nums", errors?.sellingPrice && "border-danger")}
        />
        <FieldError id={`${idPrefix}-sell-error`} message={errors?.sellingPrice} />
      </div>

      {showStock && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-stock`}>Stok Awal</Label>
          <Input
            id={`${idPrefix}-stock`}
            type="number"
            min={0}
            step="0.001"
            inputMode="decimal"
            value={value.stockOnHand ?? ""}
            onChange={(e) => set("stockOnHand", Math.max(0, num(e.target.value)))}
            disabled={disabled}
            className="tabular-nums"
          />
        </div>
      )}
    </div>
  );
}

/**
 * VariantFormRows — baris varian inline untuk Form Produk (L3).
 * Error server per baris dipetakan lewat `errors[i]` (DESIGN §5).
 */
export function VariantFormRows({
  variants,
  onChange,
  errors,
  disabled,
}: {
  variants: ProductVariantPayload[];
  onChange: (v: ProductVariantPayload[]) => void;
  errors?: (Record<string, string> | undefined)[];
  disabled?: boolean;
}) {
  const update = (i: number, v: ProductVariantPayload) => {
    const next = [...variants];
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => {
    const next = [...variants];
    next.splice(i, 1);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-primary">Varian</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10"
          disabled={disabled}
          onClick={() => onChange([...variants, emptyVariant()])}
        >
          <Plus className="size-4" />
          Tambah Varian
        </Button>
      </div>

      {variants.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-text-secondary">
          Belum ada varian. Tambahkan ukuran, rasa, atau warna — stok & harga
          diatur per varian.
        </p>
      ) : (
        variants.map((v, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-surface-sunken/40 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-secondary">
                Varian {i + 1}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 text-danger"
                aria-label={`Hapus varian ${v.name || i + 1}`}
                disabled={disabled}
                onClick={() => remove(i)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <VariantFields
              value={v}
              onChange={(nv) => update(i, nv)}
              errors={errors?.[i]}
              disabled={disabled}
              idPrefix={`pv-${i}`}
            />
          </div>
        ))
      )}
    </div>
  );
}
