"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineError } from "@/components/shared/states";
import { api, ApiError } from "@/lib/api";
import type { Warehouse, WarehousePayload } from "@/lib/types-warehouse";

/**
 * WarehouseFormDialog (F3-1) — buat gudang baru (manager+).
 * Gudang pertama otomatis menjadi gudang default (backend).
 */
export function WarehouseFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [pic, setPic] = useState("");
  const [capacity, setCapacity] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setName("");
    setAddress("");
    setPic("");
    setCapacity("");
    setIsActive(true);
    setFieldErrors({});
    setFormError(null);
  }, [open]);

  async function handleSubmit() {
    const e: Record<string, string> = {};
    if (!code.trim()) e.code = "Kode gudang wajib diisi.";
    else if (!/^[A-Za-z0-9-]+$/.test(code.trim())) e.code = "Hanya huruf, angka, dan tanda hubung.";
    if (!name.trim()) e.name = "Nama gudang wajib diisi.";
    const cap = Number(capacity);
    if (capacity.trim() !== "" && (!Number.isFinite(cap) || cap < 0)) {
      e.capacity = "Kapasitas harus angka ≥ 0.";
    }
    setFieldErrors(e);
    if (Object.keys(e).length > 0) return;

    const payload: WarehousePayload = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      address: address.trim() || undefined,
      pic: pic.trim() || undefined,
      capacity: capacity.trim() === "" ? undefined : cap,
      isActive,
    };

    setSaving(true);
    setFormError(null);
    try {
      const res = await api.post<{ warehouse: Warehouse }>("/warehouses", payload);
      toast.success(`Gudang ${res.warehouse.name} dibuat.`);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE_WAREHOUSE_CODE") {
        setFieldErrors((prev) => ({ ...prev, code: err.message }));
      } else {
        setFormError(err instanceof ApiError ? err.message : "Gagal membuat gudang. Coba lagi.");
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
            <WarehouseIcon className="size-4" /> Tambah Gudang
          </DialogTitle>
          <DialogDescription>
            Gudang pertama yang dibuat otomatis menjadi gudang penjualan default.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wh-code">Kode Gudang *</Label>
            <Input
              id="wh-code"
              placeholder="GUD-YOGYA"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="min-h-11 font-mono uppercase"
              maxLength={20}
            />
            {fieldErrors.code && <p className="text-xs text-destructive">{fieldErrors.code}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-name">Nama Gudang *</Label>
            <Input
              id="wh-name"
              placeholder="Gudang Yogyakarta"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-h-11"
              maxLength={100}
            />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wh-address">Alamat</Label>
            <Input
              id="wh-address"
              placeholder="Jl. Malioboro No. 12, Yogyakarta"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-pic">PIC (Penanggung Jawab)</Label>
            <Input
              id="wh-pic"
              placeholder="Budi Santoso"
              value={pic}
              onChange={(e) => setPic(e.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-capacity">Kapasitas (unit)</Label>
            <Input
              id="wh-capacity"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="500"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              className="min-h-11 font-mono"
            />
            {fieldErrors.capacity && <p className="text-xs text-destructive">{fieldErrors.capacity}</p>}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
            <div>
              <Label htmlFor="wh-active" className="text-sm font-medium">
                Aktif
              </Label>
              <p className="text-xs text-muted-foreground">
                Gudang nonaktif tidak muncul di pilihan transfer/koreksi.
              </p>
            </div>
            <Switch id="wh-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        {formError && <InlineError message={formError} />}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="min-h-11">
            Batal
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving} className="min-h-11">
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Simpan Gudang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
