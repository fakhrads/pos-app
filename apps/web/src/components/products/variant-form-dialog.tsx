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
import { Switch } from "@/components/ui/switch";
import { InlineError } from "@/components/shared/states";
import { FormSkeleton } from "@/components/products/form-skeleton";
import { VariantFields } from "@/components/products/variant-form-rows";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  Product,
  ProductVariant,
  ProductVariantPayload,
} from "@/lib/types";

/**
 * VariantFormDialog (L4) — tambah/ubah varian standalone dari halaman Detail.
 * Create: POST /products/:id/variants (AC-01.x)
 * Edit  : PATCH /product-variants/:id (AC-02.1)
 * Error server (DUPLICATE_VARIANT_SKU dsb) dipetakan ke field (DESIGN §5).
 */
export function VariantFormDialog({
  open,
  onOpenChange,
  product,
  variant,
  loading = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Produk induk (id + unit dasar + nama) */
  product: Product;
  /** null = tambah baru */
  variant?: ProductVariant | null;
  loading?: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductVariantPayload>({
    name: "",
    sku: "",
    barcode: "",
    costPrice: 0,
    sellingPrice: 0,
    stockOnHand: 0,
    minStock: 5,
    isActive: true,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!variant;

  useEffect(() => {
    if (open) {
      setForm(
        variant
          ? {
              name: variant.name,
              sku: variant.sku ?? "",
              barcode: variant.barcode ?? "",
              costPrice: variant.costPrice,
              sellingPrice: variant.sellingPrice,
              minStock: variant.minStock,
              isActive: variant.isActive,
            }
          : {
              name: "",
              sku: "",
              barcode: "",
              costPrice: 0,
              sellingPrice: 0,
              stockOnHand: 0,
              minStock: 5,
              isActive: true,
            }
      );
      setFieldErrors({});
      setFormError(null);
    }
  }, [open, variant]);

  // Map kode error API → pesan UI (DESIGN §5)
  const errorMap = useMemo<Record<string, string>>(
    () => ({
      DUPLICATE_VARIANT_SKU:
        "Kode Barang (SKU) sudah dipakai produk atau varian lain.",
      DUPLICATE_VARIANT_BARCODE: "Barcode sudah dipakai produk atau varian lain.",
      PARENT_NO_STOCK_TRACKING: "Produk jasa tidak dapat memiliki varian.",
    }),
    []
  );

  function applyServerError(err: ApiError) {
    const code = err.code;
    if (code in errorMap) {
      const msg = errorMap[code];
      if (code === "DUPLICATE_VARIANT_SKU") setFieldErrors((f) => ({ ...f, sku: msg }));
      else if (code === "DUPLICATE_VARIANT_BARCODE")
        setFieldErrors((f) => ({ ...f, barcode: msg }));
      else setFormError(msg);
      return;
    }
    // 422 VALIDATION_ERROR dengan details.field
    const field = (err.details as { field?: string } | undefined)?.field ?? "";
    if (field.includes("sellingPrice") || field.includes("harga"))
      setFieldErrors((f) => ({ ...f, sellingPrice: err.message }));
    else if (field.includes("name")) setFieldErrors((f) => ({ ...f, name: err.message }));
    else setFormError(err.message);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Nama varian wajib diisi.";
    if (!(Number(form.sellingPrice) > 0))
      e.sellingPrice = "Harga jual harus lebih dari 0.";
    if (Number(form.stockOnHand) < 0) e.stockOnHand = "Stok tidak boleh negatif.";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    try {
      const payload: ProductVariantPayload = {
        name: form.name.trim(),
        sku: form.sku?.trim() || undefined,
        barcode: form.barcode?.trim() || undefined,
        costPrice: Math.round(Number(form.costPrice) || 0),
        sellingPrice: Math.round(Number(form.sellingPrice) || 0),
        minStock: Math.round(Number(form.minStock) || 0),
        isActive: form.isActive,
        ...(isEdit ? {} : { stockOnHand: Math.max(0, Number(form.stockOnHand) || 0) }),
      };
      if (isEdit && variant) {
        await api.patch(`/product-variants/${variant.id}`, payload);
        toast.success("Varian disimpan");
      } else {
        await api.post(`/products/${product.id}/variants`, payload);
        toast.success("Varian disimpan");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Varian" : "Tambah Varian"}</DialogTitle>
          <DialogDescription>
            {product.name}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <FormSkeleton />
        ) : (
          <div className="space-y-4">
            <VariantFields
              value={form}
              onChange={setForm}
              errors={fieldErrors}
              disabled={saving}
              idPrefix="v4"
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="v4-minstock">Stok Minimum</Label>
                <Input
                  id="v4-minstock"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.minStock || ""}
                  onChange={(e) =>
                    setForm({ ...form, minStock: Math.max(0, Number(e.target.value) || 0) })
                  }
                  disabled={saving}
                  className="tabular-nums"
                />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch
                  id="v4-active"
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                  disabled={saving}
                />
                <Label htmlFor="v4-active" className="text-sm font-normal">
                  Aktif
                </Label>
              </div>
            </div>

            <p className="text-sm text-text-secondary">
              Varian dijual dalam satuan dasar produk ({product.unit}).
            </p>

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
