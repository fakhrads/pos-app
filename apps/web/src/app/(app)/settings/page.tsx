"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/page-header";
import { AdminOnly } from "@/components/role-guard";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import type { SettingsResponse } from "@/lib/types";

interface TaxRate {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
  isActive: boolean;
}

export default function SettingsPage() {
  const { settings, reload } = useSettings();

  // Profil toko
  const [store, setStore] = useState({
    name: "",
    address: "",
    phone: "",
    footer: "",
    qris: "",
  });
  // Poin & stok & diskon
  const [points, setPoints] = useState({ earnPerIdr: 1000, redeemValue: 10 });
  const [stockThreshold, setStockThreshold] = useState(5);
  const [discount, setDiscount] = useState({ maxPercent: 20, maxAmount: 50000 });
  const [returnMaxDays, setReturnMaxDays] = useState(7);
  // Pajak
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [taxRate, setTaxRate] = useState(11);
  const [taxActive, setTaxActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [savingTax, setSavingTax] = useState(false);

  useEffect(() => {
    if (settings) {
      setStore({
        name: String(settings["store.name"] ?? "FakhriPOS"),
        address: String(settings["store.address"] ?? ""),
        phone: String(settings["store.phone"] ?? ""),
        footer: String(settings["receipt.footer"] ?? ""),
        qris: String(settings["store.qris_payload"] ?? ""),
      });
      setPoints({
        earnPerIdr: Number(settings["points.earn_per_idr"] ?? 1000),
        redeemValue: Number(settings["points.redeem_value"] ?? 10),
      });
      setStockThreshold(Number(settings["low_stock.default_threshold"] ?? 5));
      setDiscount({
        maxPercent: Number(settings["discount.manual_max_percent"] ?? 20),
        maxAmount: Number(settings["discount.manual_max_amount"] ?? 50000),
      });
      setReturnMaxDays(Number(settings["return.max_days"] ?? 7));
    }
  }, [settings]);

  useEffect(() => {
    api
      .get<{ items: TaxRate[] }>("/tax-rates")
      .then((d) => {
        setTaxRates(d.items);
        const def = d.items.find((t) => t.isDefault) ?? d.items[0];
        if (def) {
          setTaxRate(Number(def.rate));
          setTaxActive(def.isActive);
        }
      })
      .catch(() => {
        // endpoint tax-rates mungkin belum tersedia — biarkan default 11%
      });
  }, []);

  async function handleSaveSettings() {
    setSaving(true);
    try {
      const settingsPayload: { key: string; value: string | number }[] = [
        { key: "store.name", value: store.name.trim() },
        { key: "store.address", value: store.address.trim() },
        { key: "store.phone", value: store.phone.trim() },
        { key: "receipt.footer", value: store.footer.trim() },
        { key: "store.qris_payload", value: store.qris.trim() },
        { key: "points.earn_per_idr", value: Math.max(1, points.earnPerIdr) },
        { key: "points.redeem_value", value: Math.max(1, points.redeemValue) },
        { key: "low_stock.default_threshold", value: Math.max(0, stockThreshold) },
        { key: "discount.manual_max_percent", value: Math.max(0, discount.maxPercent) },
        { key: "discount.manual_max_amount", value: Math.max(0, discount.maxAmount) },
        { key: "return.max_days", value: Math.max(1, returnMaxDays) },
      ];
      await api.patch("/settings", { settings: settingsPayload });
      toast.success("Pengaturan disimpan");
      reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTax() {
    const def = taxRates.find((t) => t.isDefault) ?? taxRates[0];
    if (!def) {
      toast.info("Belum ada tax rate. Buat via API /tax-rates.");
      return;
    }
    setSavingTax(true);
    try {
      await api.patch(`/tax-rates/${def.id}`, {
        rate: taxRate,
        isActive: taxActive,
      });
      toast.success("Pengaturan PPN disimpan");
      const updated = await api.get<{ items: TaxRate[] }>("/tax-rates");
      setTaxRates(updated.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan PPN");
    } finally {
      setSavingTax(false);
    }
  }

  return (
    <AdminOnly>
      <PageHeader
        title="Pengaturan Toko"
        description="Profil toko dipakai di struk; aturan poin, pajak, dan stok memengaruhi transaksi."
        actions={
          <Button onClick={handleSaveSettings} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Simpan Pengaturan
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profil toko */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Profil Toko</CardTitle>
            <CardDescription>Tampil di header struk 58mm.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Nama Toko *</Label>
              <Input id="s-name" value={store.name} onChange={(e) => setStore({ ...store, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-address">Alamat</Label>
              <Textarea id="s-address" rows={2} value={store.address} onChange={(e) => setStore({ ...store, address: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-phone">No. HP</Label>
              <Input id="s-phone" value={store.phone} onChange={(e) => setStore({ ...store, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-footer">Footer Struk</Label>
              <Textarea id="s-footer" rows={2} value={store.footer} onChange={(e) => setStore({ ...store, footer: e.target.value })} placeholder="Terima kasih atas kunjungan Anda" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-qris">QRIS Static Payload</Label>
              <Textarea id="s-qris" rows={2} value={store.qris} onChange={(e) => setStore({ ...store, qris: e.target.value })} placeholder="0002010102112662… (isi agar QR tampil di layar kasir)" className="font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">
                Tempel payload EMVCo QRIS statis dari penyedia (QRIS merchant). Kosongkan jika belum punya.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Pajak */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pajak (PPN)</CardTitle>
              <CardDescription>Diterapkan setelah diskon: Total = (Subtotal − Diskon) + PPN.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="s-tax">Rate PPN (%)</Label>
                  <Input id="s-tax" type="number" min={0} max={100} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <Switch id="s-tax-active" checked={taxActive} onCheckedChange={setTaxActive} />
                  <Label htmlFor="s-tax-active" className="text-sm font-normal">PPN aktif</Label>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleSaveTax} disabled={savingTax || taxRates.length === 0}>
                {savingTax && <Loader2 className="size-3.5 animate-spin" />}
                Simpan PPN
              </Button>
            </CardContent>
          </Card>

          {/* Poin */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Program Poin</CardTitle>
              <CardDescription>Poin = floor(total / rate); 1 poin bernilai redeem_value rupiah.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-points-rate">Rate poin (Rp / 1 poin)</Label>
                <Input id="s-points-rate" type="number" min={1} value={points.earnPerIdr} onChange={(e) => setPoints({ ...points, earnPerIdr: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-points-value">Nilai redeem (Rp / poin)</Label>
                <Input id="s-points-value" type="number" min={1} value={points.redeemValue} onChange={(e) => setPoints({ ...points, redeemValue: Number(e.target.value) })} />
              </div>
            </CardContent>
          </Card>

          {/* Stok & diskon */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Aturan Lainnya</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-threshold">Threshold stok menipis (default)</Label>
                <Input id="s-threshold" type="number" min={0} value={stockThreshold} onChange={(e) => setStockThreshold(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-return">Batas return (hari)</Label>
                <Input id="s-return" type="number" min={1} value={returnMaxDays} onChange={(e) => setReturnMaxDays(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-disc-pct">Cap diskon manual (%)</Label>
                <Input id="s-disc-pct" type="number" min={0} value={discount.maxPercent} onChange={(e) => setDiscount({ ...discount, maxPercent: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-disc-amt">Cap diskon manual (Rp)</Label>
                <Input id="s-disc-amt" type="number" min={0} value={discount.maxAmount} onChange={(e) => setDiscount({ ...discount, maxAmount: Number(e.target.value) })} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminOnly>
  );
}
