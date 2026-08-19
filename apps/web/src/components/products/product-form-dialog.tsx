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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import {
  VariantFormRows,
  emptyVariant,
} from "@/components/products/variant-form-rows";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  Category,
  Product,
  ProductPayload,
  ProductVariant,
  ProductVariantPayload,
} from "@/lib/types";

const UNITS = ["pcs", "pack", "box", "kg", "gram", "liter", "meter"];

interface ProductFormState {
  name: string;
  categoryId: string;
  unit: string;
  sku: string;
  barcode: string;
  description: string;
  costPrice: string;
  sellingPrice: string;
  stockOnHand: string;
  minStock: string;
  isTaxable: boolean;
  trackStock: boolean;
  expiryDate: string;
}

function initialState(): ProductFormState {
  return {
    name: "",
    categoryId: "",
    unit: "pcs",
    sku: "",
    barcode: "",
    description: "",
    costPrice: "",
    sellingPrice: "",
    stockOnHand: "",
    minStock: "5",
    isTaxable: true,
    trackStock: true,
    expiryDate: "",
  };
}

function fromProduct(p: Product): ProductFormState {
  return {
    name: p.name,
    categoryId: p.categoryId,
    unit: p.unit,
    sku: p.sku ?? "",
    barcode: p.barcode ?? "",
    description: p.description ?? "",
    costPrice: String(p.costPrice ?? 0),
    sellingPrice: String(p.sellingPrice ?? 0),
    stockOnHand: String(p.stockOnHand ?? 0),
    minStock: String(p.minStock ?? 5),
    isTaxable: p.isTaxable,
    trackStock: p.trackStock !== false,
    expiryDate: p.expiryDate ? p.expiryDate.slice(0, 10) : "",
  };
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const fn = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return isMobile;
}

/**
 * ProductFormDialog (L3) — Tambah/Edit Produk.
 * - Mobile: bottom sheet (max-h 90dvh); ≥sm: dialog max-w-2xl (DESIGN §7)
 * - Create: POST /products + variants inline (AC-01.1)
 * - Edit  : PATCH /products/:id (varian & stok dikelola di halaman Detail)
 * - Produk jasa (trackStock=false) → sembunyikan stok & varian (AC-04.4)
 */
export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  variants,
  categories,
  loading = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = tambah baru */
  product?: Product | null;
  /** Prefill varian saat edit (dari halaman Detail) */
  variants?: ProductVariant[];
  categories: Category[];
  loading?: boolean;
  onSaved: () => void;
}) {
  const isMobile = useIsMobile();
  const isEdit = !!product;
  const canHaveVariants = !isEdit; // edit: varian dikelola di Detail (L4)

  const [form, setForm] = useState<ProductFormState>(initialState());
  const [variantRows, setVariantRows] = useState<ProductVariantPayload[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [variantErrors, setVariantErrors] = useState<
    (Record<string, string> | undefined)[]
  >([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(product ? fromProduct(product) : initialState());
      setVariantRows(
        product?.hasVariants && variants?.length
          ? variants.map((v) => ({
              name: v.name,
              sku: v.sku ?? "",
              barcode: v.barcode ?? "",
              costPrice: v.costPrice,
              sellingPrice: v.sellingPrice,
              stockOnHand: v.stockOnHand,
              minStock: v.minStock,
              isActive: v.isActive,
            }))
          : []
      );
      setFieldErrors({});
      setVariantErrors([]);
      setFormError(null);
    }
  }, [open, product, variants]);

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
    if (code === "DUPLICATE_VARIANT_SKU" || code === "DUPLICATE_VARIANT_BARCODE") {
      // cari baris varian yang punya SKU/barcode sama
      const msg = errorMap[code];
      const key = code === "DUPLICATE_VARIANT_SKU" ? "sku" : "barcode";
      const idx = variantRows.findIndex(
        (v) => (v[key] ?? "").trim().toLowerCase() === (err.details as { value?: string } | undefined)?.value?.toLowerCase()
      );
      const target = idx >= 0 ? idx : Math.max(0, variantRows.length - 1);
      setVariantErrors((prev) => {
        const next = [...prev];
        next[target] = { ...(next[target] ?? {}), [key]: msg };
        return next;
      });
      return;
    }
    if (code in errorMap) {
      setFormError(errorMap[code]);
      return;
    }
    // 422 VALIDATION_ERROR dengan details.field ("variants[0].stockOnHand", dll)
    const field = (err.details as { field?: string } | undefined)?.field ?? "";
    const m = field.match(/^variants\[(\d+)\]\.(.+)$/);
    if (m) {
      const idx = Number(m[1]);
      setVariantErrors((prev) => {
        const next = [...prev];
        next[idx] = { ...(next[idx] ?? {}), [m[2]]: err.message };
        return next;
      });
      return;
    }
    if (field) setFieldErrors((f) => ({ ...f, [field]: err.message }));
    else setFormError(err.message);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Nama produk wajib diisi.";
    if (!form.categoryId) e.categoryId = "Pilih kategori produk.";
    if (!(Number(form.sellingPrice) > 0)) e.sellingPrice = "Harga jual harus lebih dari 0.";
    if (Number(form.costPrice) < 0) e.costPrice = "Harga modal tidak boleh negatif.";
    if (Number(form.stockOnHand) < 0) e.stockOnHand = "Stok tidak boleh negatif.";
    setFieldErrors(e);

    const ve: (Record<string, string> | undefined)[] = [];
    let variantOk = true;
    variantRows.forEach((v, i) => {
      const ve2: Record<string, string> = {};
      if (!v.name.trim()) {
        ve2.name = "Nama varian wajib diisi.";
        variantOk = false;
      }
      if (!(Number(v.sellingPrice) > 0)) {
        ve2.sellingPrice = "Harga jual harus lebih dari 0.";
        variantOk = false;
      }
      if (Number(v.stockOnHand) < 0) {
        ve2.stockOnHand = "Stok tidak boleh negatif.";
        variantOk = false;
      }
      ve[i] = Object.keys(ve2).length ? ve2 : undefined;
    });
    setVariantErrors(ve);
    return Object.keys(e).length === 0 && variantOk;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    try {
      const withVariants = canHaveVariants && variantRows.length > 0;
      const payload: ProductPayload = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        description: form.description.trim() || undefined,
        unit: form.unit,
        costPrice: Math.round(Number(form.costPrice) || 0),
        sellingPrice: Math.round(Number(form.sellingPrice) || 0),
        minStock: Math.round(Number(form.minStock) || 0),
        isTaxable: form.isTaxable,
        trackStock: form.trackStock,
        expiryDate: form.expiryDate ? `${form.expiryDate}T00:00:00Z` : null,
        ...(isEdit
          ? {}
          : {
              // Invariant SPEC §3.1: induk ber-varian → stok induk 0
              stockOnHand: withVariants
                ? 0
                : Math.max(0, Number(form.stockOnHand) || 0),
              variants: withVariants
                ? variantRows.map((v) => ({
                    name: v.name.trim(),
                    sku: v.sku?.trim() || undefined,
                    barcode: v.barcode?.trim() || undefined,
                    costPrice: Math.round(Number(v.costPrice) || 0),
                    sellingPrice: Math.round(Number(v.sellingPrice) || 0),
                    stockOnHand: Math.max(0, Number(v.stockOnHand) || 0),
                    minStock: Math.round(Number(v.minStock) || 5),
                    isActive: v.isActive,
                  }))
                : undefined,
            }),
      };
      if (isEdit && product) {
        await api.patch(`/products/${product.id}`, payload);
        toast.success("Produk disimpan");
      } else {
        await api.post("/products", payload);
        toast.success("Produk disimpan");
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

  const set = <K extends keyof ProductFormState>(key: K, val: ProductFormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const formBody = (
    <>
      {loading ? (
        <FormSkeleton rows={5} />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">Nama Produk *</Label>
            <Input
              id="pf-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="cth. Indomie Goreng 40g"
              disabled={saving}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? "pf-name-error" : undefined}
              className={cn(fieldErrors.name && "border-danger")}
            />
            {fieldErrors.name && (
              <p id="pf-name-error" role="alert" className="text-xs font-medium text-danger">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-category">Kategori *</Label>
              <Select
                value={form.categoryId || undefined}
                onValueChange={(v) => set("categoryId", v)}
                disabled={saving}
              >
                <SelectTrigger id="pf-category" className="w-full" aria-invalid={!!fieldErrors.categoryId}>
                  <SelectValue placeholder="Pilih kategori…" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.categoryId && (
                <p role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.categoryId}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-unit">Satuan Dasar *</Label>
              <Select
                value={form.unit}
                onValueChange={(v) => set("unit", v)}
                disabled={saving}
              >
                <SelectTrigger id="pf-unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="pf-unit-helper" className="text-xs text-text-secondary">
                Stok dihitung dalam satuan ini.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-sku">Kode Barang (SKU)</Label>
              <Input
                id="pf-sku"
                value={form.sku}
                onChange={(e) => set("sku", e.target.value)}
                placeholder="MIN-001"
                disabled={saving}
                className="font-mono"
              />
              <p id="pf-sku-helper" className="text-xs text-text-secondary">
                Kosongkan bila belum punya kode. Unik, dipakai import.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-barcode">Barcode</Label>
              <Input
                id="pf-barcode"
                value={form.barcode}
                onChange={(e) => set("barcode", e.target.value)}
                placeholder="899xxxxxxxx"
                disabled={saving}
                className="font-mono"
              />
              <p id="pf-barcode-helper" className="text-xs text-text-secondary">
                Isi bila barang punya barcode.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-cost">Harga Modal (Rp)</Label>
              <Input
                id="pf-cost"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.costPrice}
                onChange={(e) => set("costPrice", e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.costPrice}
                className={cn("tabular-nums", fieldErrors.costPrice && "border-danger")}
              />
              {fieldErrors.costPrice ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.costPrice}
                </p>
              ) : (
                <p id="pf-cost-helper" className="text-xs text-text-secondary">
                  Harga beli per satuan dasar. Hanya terlihat manager.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-sell">Harga Jual (Rp) *</Label>
              <Input
                id="pf-sell"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.sellingPrice}
                onChange={(e) => set("sellingPrice", e.target.value)}
                disabled={saving}
                aria-invalid={!!fieldErrors.sellingPrice}
                aria-describedby={fieldErrors.sellingPrice ? "pf-sell-error" : "pf-sell-helper"}
                className={cn("tabular-nums", fieldErrors.sellingPrice && "border-danger")}
              />
              {fieldErrors.sellingPrice ? (
                <p id="pf-sell-error" role="alert" className="text-xs font-medium text-danger">
                  {fieldErrors.sellingPrice}
                </p>
              ) : (
                <p id="pf-sell-helper" className="text-xs text-text-secondary">
                  Harga jual per satuan dasar.
                </p>
              )}
            </div>
          </div>

          {!isEdit && !form.trackStock && (
            <p className="rounded-lg border border-info-subtle bg-info-subtle/50 px-3 py-2 text-sm text-text-secondary">
              Produk jasa tidak memakai stok — kolom stok & varian tidak
              ditampilkan.
            </p>
          )}

          {form.trackStock && !isEdit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pf-stock">Stok Awal</Label>
                <Input
                  id="pf-stock"
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  value={form.stockOnHand}
                  onChange={(e) => set("stockOnHand", e.target.value)}
                  disabled={saving}
                  className="tabular-nums"
                />
                <p id="pf-stock-helper" className="text-xs text-text-secondary">
                  Stok awal (satuan dasar). Ubah stok nanti lewat Koreksi Stok.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-minstock">Stok Minimum</Label>
                <Input
                  id="pf-minstock"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.minStock}
                  onChange={(e) => set("minStock", e.target.value)}
                  disabled={saving}
                  className="tabular-nums"
                />
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="pf-taxable" className="text-sm font-normal">
                  Kena Pajak
                </Label>
                <p id="pf-taxable-helper" className="text-xs text-text-secondary">
                  PPN 11% dihitung otomatis saat transaksi.
                </p>
              </div>
              <Switch
                id="pf-taxable"
                checked={form.isTaxable}
                onCheckedChange={(v) => set("isTaxable", v)}
                disabled={saving}
                aria-describedby="pf-taxable-helper"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="pf-jasa" className="text-sm font-normal">
                  Produk Jasa (Tanpa Stok)
                </Label>
                <p id="pf-jasa-helper" className="text-xs text-text-secondary">
                  Nyalakan untuk jasa (service). Stok tidak dicek saat transaksi.
                </p>
              </div>
              <Switch
                id="pf-jasa"
                checked={!form.trackStock}
                onCheckedChange={(v) => {
                  set("trackStock", !v);
                  if (v) setVariantRows([]);
                }}
                disabled={saving}
                aria-describedby="pf-jasa-helper"
              />
            </div>
          </div>

          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="pf-expiry">Tanggal Kedaluwarsa</Label>
              <Input
                id="pf-expiry"
                type="date"
                value={form.expiryDate}
                onChange={(e) => set("expiryDate", e.target.value)}
                disabled={saving}
              />
              <p id="pf-expiry-helper" className="text-xs text-text-secondary">
                Opsional. Informasi saja.
              </p>
            </div>
          )}

          {canHaveVariants && form.trackStock && (
            <VariantFormRows
              variants={variantRows}
              onChange={setVariantRows}
              errors={variantErrors}
              disabled={saving}
            />
          )}

          {isEdit && product?.hasVariants && (
            <p className="text-sm text-text-secondary">
              Varian & satuan dikelola di halaman detail produk.
            </p>
          )}

          {formError && <InlineError message={formError} />}
        </div>
      )}
    </>
  );

  const footer = (
    <div className="flex items-center justify-end gap-2">
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
    </div>
  );

  const title = isEdit ? "Edit Produk" : "Tambah Produk";

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] overflow-y-auto rounded-t-lg"
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          {formBody}
          {footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Harga dalam rupiah. Produk langsung bisa dijual setelah disimpan.
          </DialogDescription>
        </DialogHeader>
        {formBody}
        <DialogFooter className="sm:justify-end">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
