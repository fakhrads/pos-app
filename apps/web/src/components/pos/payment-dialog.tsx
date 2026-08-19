"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  QrCode,
  Trash2,
  X,
} from "lucide-react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError } from "@/lib/api";
import { cn, formatIDR, formatNumber, PAYMENT_METHOD_LABEL, uuidv4 } from "@/lib/utils";
import {
  getPracticeMode,
  addPracticeTransaction,
} from "@/lib/phase6-storage";
import { buildPracticeCheckout } from "@/components/pos/practice-checkout";
import { buildOfflineCheckout } from "@/lib/offline-checkout";
import { queueOfflineOrder } from "@/lib/offline-db";
import { emitSyncChange } from "@/lib/sync";
import type {
  CartDiscount,
  CartItem,
  CheckoutPayload,
  CheckoutResult,
  Customer,
  PaymentMethod,
  PreviewResult,
  StoreProfile,
} from "@/lib/types";

interface PaymentLeg {
  id: string;
  method: PaymentMethod;
  /** Nominal yang diaplikasikan ke total transaksi */
  amount: number;
  /** Tunai diterima (hanya leg cash; ≥ amount) */
  cashReceived?: number;
  /** Nomor referensi (transfer, opsional ≤ 100 char) */
  referenceNumber?: string;
  /** Konfirmasi lunas (qris/transfer) */
  paid: boolean;
}

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Total otoritatif (server preview / estimasi lokal sebelum preview) */
  total: number;
  cart: CartItem[];
  customer: Customer | null;
  txDiscount: CartDiscount | null;
  redeemPoints: number;
  storeName: string;
  qrisPayload: string;
  canCheckout: boolean;
  checkoutBlockReason?: string | null;
  onSuccess: (result: CheckoutResult) => void;
  /** Total server berubah → parent update & dialog reset leg */
  onServerTotalChanged: (serverTotal: number) => void;
  /** Nama kasir yang bertugas (untuk Mode Latihan local receipt) */
  operatorName?: string;
  /** Tarif PPN dalam persen (mis. 11). Dipakai untuk hitung Mode Latihan. */
  taxRate?: number;
  /** Saat true → transaksi disimpan ke IndexedDB, bukan POST ke server (offline) */
  offline?: boolean;
  /** Profil toko utk struk sementara offline */
  storeProfile?: Partial<StoreProfile>;
  /** Shift aktif kasir (dipakai utk transaksi offline bila sesi online terakhir) */
  shiftId?: string | null;
  /** Nilai redeem per poin (offline: hitung total konsisten) */
  redeemValuePerPoint?: number;
}

const QUICK_CASH = [50000, 100000, 200000];

function defaultLeg(total: number): PaymentLeg {
  return { id: uuidv4(), method: "cash", amount: total, cashReceived: total, paid: true };
}

export function PaymentDialog({
  open,
  onOpenChange,
  total,
  cart,
  customer,
  txDiscount,
  redeemPoints,
  storeName,
  qrisPayload,
  canCheckout,
  checkoutBlockReason,
  onSuccess,
  onServerTotalChanged,
  operatorName = "Kasir",
  taxRate = 11,
  offline = false,
  storeProfile,
  shiftId,
  redeemValuePerPoint = 0,
}: PaymentDialogProps) {
  const [legs, setLegs] = useState<PaymentLeg[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ke 1 leg tunai (uang pas) setiap dialog dibuka / total berubah
  useEffect(() => {
    if (!open) return;
    setLegs((prev) => {
      const sum = prev.reduce((s, l) => s + l.amount, 0);
      if (prev.length === 0 || sum !== total) return [defaultLeg(total)];
      return prev;
    });
    setError(null);
  }, [open, total]);

  const paidTotal = useMemo(() => legs.reduce((s, l) => s + l.amount, 0), [legs]);
  const remaining = total - paidTotal;
  const changeTotal = useMemo(
    () =>
      legs.reduce(
        (s, l) => (l.method === "cash" && l.cashReceived ? s + (l.cashReceived - l.amount) : s),
        0
      ),
    [legs]
  );

  function addLeg(method: PaymentMethod) {
    if (remaining <= 0) return;
    const leg: PaymentLeg =
      method === "cash"
        ? { id: uuidv4(), method, amount: remaining, cashReceived: remaining, paid: true }
        : { id: uuidv4(), method, amount: remaining, paid: false };
    setLegs((prev) => [...prev, leg]);
    setError(null);
  }

  function updateLeg(id: string, patch: Partial<PaymentLeg>) {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLeg(id: string) {
    setLegs((prev) => prev.filter((l) => l.id !== id));
  }

  const allLegsValid = legs.every((l) => {
    if (l.amount <= 0) return false;
    if (l.method === "cash") return l.cashReceived != null && l.cashReceived >= l.amount;
    return l.paid;
  });
  const canProcess =
    canCheckout && cart.length > 0 && remaining === 0 && allLegsValid && !submitting;

  async function processPayment() {
    if (!canProcess) return;
    setSubmitting(true);
    setError(null);

    const payload: CheckoutPayload = {
      customerId: customer?.id,
      items: cart.map((i) => ({
        productId: i.productId,
        variantId: i.variantId ?? undefined,
        unit: i.unit ?? undefined,
        quantity: i.quantity,
        discount: i.discount ?? undefined,
      })),
      manualDiscount: txDiscount ?? undefined,
      redeemPoints: redeemPoints > 0 ? redeemPoints : undefined,
      payments: legs.map((l) => ({
        method: l.method,
        amount: l.amount,
        cashReceived: l.method === "cash" ? l.cashReceived : undefined,
        referenceNumber:
          l.method === "transfer" && l.referenceNumber?.trim()
            ? l.referenceNumber.trim()
            : undefined,
      })),
    };

    try {
      // Mode Latihan — transaksi hanya ke localStorage, tidak ke server (RC-03)
      if (getPracticeMode()) {
        // Rekonstruksi ringkasan pembayaran secara lokal (tanpa server preview)
        const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        const itemDiscounts = cart.reduce(
          (s, i) =>
            s +
            (i.discount
              ? i.discount.type === "percentage"
                ? Math.round((i.unitPrice * i.quantity * i.discount.value) / 100)
                : Math.min(i.discount.value, i.unitPrice * i.quantity)
              : 0),
          0
        );
        const txDiscountAmount = txDiscount
          ? txDiscount.type === "percentage"
            ? Math.round((subtotal * txDiscount.value) / 100)
            : Math.min(txDiscount.value, subtotal)
          : 0;
        const discountTotal = Math.min(subtotal, itemDiscounts + txDiscountAmount);
        const dpp = subtotal - discountTotal;
        const taxTotal = Math.round((dpp * taxRate) / 100);
        const finalTotal = dpp + taxTotal;

        const practiceResult = buildPracticeCheckout({
          cart,
          legs,
          customer,
          storeName,
          total: finalTotal,
          subtotal,
          discountTotal,
          taxTotal,
          operatorName,
          manualDiscountName: txDiscount?.reason ?? null,
          redeemPoints,
          taxRate,
        });
        addPracticeTransaction(practiceResult);
        toast.success(
          `Mode Latihan: transaksi ${practiceResult.transaction.invoiceNumber} dicatat local`
        );
        onSuccess(practiceResult);
        return;
      }

      // 0) Offline → simpan ke IndexedDB, jangan POST ke server (AC-04.1)
      if (offline) {
        const { order, result } = buildOfflineCheckout({
          cart,
          legs,
          customer,
          txDiscount,
          redeemPoints,
          taxRate,
          redeemValuePerPoint,
          total,
          storeName,
          storeProfile,
          shiftId,
          operatorName,
        });
        try {
          await queueOfflineOrder(order);
          emitSyncChange();
          toast.success(
            `Offline: transaksi ${result.transaction.invoiceNumber} disimpan — akan disinkronkan otomatis`
          );
          onSuccess(result);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Gagal menyimpan transaksi offline."
          );
        }
        return;
      }

      // 1) Pra-hitung (server = sumber kebenaran harga & stok)
      const pv = await api.post<PreviewResult>("/transactions/preview", payload);
      if (pv.total !== total) {
        onServerTotalChanged(pv.total);
        toast.info(`Harga berubah — total baru ${formatIDR(pv.total)}`);
        return;
      }

      // 2) Commit — Idempotency-Key anti double-submit
      const result = await api.post<CheckoutResult>(
        "/transactions",
        payload,
        { headers: { "Idempotency-Key": uuidv4() } }
      );
      toast.success(`Transaksi ${result.transaction.invoiceNumber} berhasil`);
      onSuccess(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PAYMENT_MISMATCH") {
        // Total berubah di antara preview & commit → ambil total server terbaru
        try {
          const pv2 = await api.post<PreviewResult>("/transactions/preview", payload);
          onServerTotalChanged(pv2.total);
          setError(`Total berubah menjadi ${formatIDR(pv2.total)} — sesuaikan pembayaran.`);
        } catch {
          setError(
            err instanceof ApiError ? err.message : "Gagal memproses pembayaran, coba lagi."
          );
        }
      } else {
        setError(err instanceof ApiError ? err.message : "Gagal memproses pembayaran, coba lagi.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && !submitting && onOpenChange(false)}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[90vh] gap-0 overflow-y-auto rounded-t-2xl p-0"
      >
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Pembayaran</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              <X className="size-5" />
            </Button>
          </div>
          <SheetDescription className="flex items-center justify-between">
            <span>Total tagihan</span>
            <span className="text-lg font-bold text-foreground tabular-nums">
              {formatIDR(total)}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {/* Sisa yang harus dibayar (live) */}
          <div
            className={cn(
              "flex items-center justify-between rounded-lg border p-3",
              remaining === 0 ? "border-emerald-600/40 bg-emerald-600/5" : "border-destructive/40 bg-destructive/5"
            )}
          >
            <span className="text-sm font-medium">
              {remaining === 0 ? "Lunas ✓" : "Sisa yang harus dibayar"}
            </span>
            <span
              className={cn(
                "text-xl font-bold tabular-nums",
                remaining === 0 ? "text-emerald-600" : "text-destructive"
              )}
            >
              {formatIDR(Math.max(remaining, 0))}
            </span>
          </div>

          {/* Daftar leg pembayaran */}
          {legs.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Pilih metode pembayaran di bawah.
            </p>
          )}
          {legs.map((leg, idx) => (
            <div key={leg.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {leg.method === "cash" ? (
                      <Banknote className="size-4" />
                    ) : leg.method === "qris" ? (
                      <QrCode className="size-4" />
                    ) : (
                      <CreditCard className="size-4" />
                    )}
                    {PAYMENT_METHOD_LABEL[leg.method]}
                  </span>
                  {leg.method === "cash" && leg.cashReceived != null && (
                    <Badge variant="outline" className="text-[10px]">
                      Kembalian {formatIDR(Math.max(leg.cashReceived - leg.amount, 0))}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatIDR(leg.amount)}
                  </span>
                  {legs.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-destructive"
                      onClick={() => removeLeg(leg.id)}
                      title="Hapus metode ini"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Editor per metode */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Diaplikasikan (Rp)</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={total}
                      className="h-11 tabular-nums"
                      value={leg.amount || ""}
                      onChange={(e) =>
                        updateLeg(leg.id, {
                          amount: Math.min(Math.max(0, Number(e.target.value) || 0), total),
                        })
                      }
                    />
                  </div>
                  {leg.method === "cash" ? (
                    <div>
                      <Label className="text-[11px]">Tunai diterima (Rp)</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        className="h-11 tabular-nums"
                        value={leg.cashReceived ?? ""}
                        onChange={(e) =>
                          updateLeg(leg.id, { cashReceived: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </div>
                  ) : (
                    <div>
                      <Label className="text-[11px]">
                        {leg.method === "transfer" ? "No. referensi (opsional)" : "Nominal QRIS"}
                      </Label>
                      {leg.method === "transfer" ? (
                        <Input
                          className="h-11"
                          maxLength={100}
                          placeholder="REF-…"
                          value={leg.referenceNumber ?? ""}
                          onChange={(e) => updateLeg(leg.id, { referenceNumber: e.target.value })}
                        />
                      ) : (
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          className="h-11 tabular-nums"
                          value={leg.amount || ""}
                          disabled
                        />
                      )}
                    </div>
                  )}
                </div>

                {leg.method === "cash" && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 px-3"
                      onClick={() =>
                        updateLeg(leg.id, { cashReceived: leg.amount, amount: leg.amount })
                      }
                    >
                      Uang Pas
                    </Button>
                    {QUICK_CASH.filter((q) => q >= leg.amount).map((q) => (
                      <Button
                        key={q}
                        variant="ghost"
                        size="sm"
                        className="h-11 px-3 tabular-nums"
                        onClick={() =>
                          updateLeg(leg.id, { cashReceived: q })
                        }
                      >
                        {formatIDR(q)}
                      </Button>
                    ))}
                  </div>
                )}

                {leg.method === "qris" && (
                  <div className="space-y-2 text-center">
                    <div className="mx-auto w-fit rounded-lg bg-white p-2">
                      {qrisPayload ? (
                        <QRCode value={qrisPayload} size={132} />
                      ) : (
                        <div className="flex size-32 items-center justify-center rounded-lg border-2 border-dashed text-[10px] text-muted-foreground">
                          QRIS statis
                          <br />
                          belum diatur
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Minta pelanggan scan QR {storeName} — nominal{" "}
                      <span className="font-semibold tabular-nums">{formatIDR(leg.amount)}</span>
                    </p>
                    <Button
                      variant={leg.paid ? "default" : "outline"}
                      className="h-12 w-full"
                      onClick={() => updateLeg(leg.id, { paid: !leg.paid })}
                    >
                      {leg.paid ? (
                        <>
                          <CheckCircle2 className="size-4" /> Sudah Dibayar
                        </>
                      ) : (
                        "Tandai Sudah Dibayar"
                      )}
                    </Button>
                  </div>
                )}

                {leg.method === "transfer" && (
                  <Button
                    variant={leg.paid ? "default" : "outline"}
                    className="h-12 w-full"
                    onClick={() => updateLeg(leg.id, { paid: !leg.paid })}
                  >
                    {leg.paid ? (
                      <>
                        <CheckCircle2 className="size-4" /> Lunas
                      </>
                    ) : (
                      "Tandai Lunas"
                    )}
                  </Button>
                )}
              </div>
            </div>
          ))}

          {/* Tambah metode (split payment) */}
          <div className="grid grid-cols-3 gap-2">
            {(["cash", "qris", "transfer"] as PaymentMethod[]).map((m) => (
              <Button
                key={m}
                variant="outline"
                className="h-12"
                disabled={remaining <= 0}
                onClick={() => addLeg(m)}
              >
                {m === "cash" ? (
                  <Banknote className="size-4" />
                ) : m === "qris" ? (
                  <QrCode className="size-4" />
                ) : (
                  <CreditCard className="size-4" />
                )}
                + {PAYMENT_METHOD_LABEL[m]}
              </Button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Ringkasan + proses */}
          <Separator />
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Total</span>
              <span className="tabular-nums">{formatIDR(total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Terbayar</span>
              <span className="tabular-nums">{formatIDR(paidTotal)}</span>
            </div>
            <div
              className={cn(
                "flex justify-between font-semibold",
                remaining === 0 ? "text-emerald-600" : "text-destructive"
              )}
            >
              <span>Sisa</span>
              <span className="tabular-nums">{formatIDR(Math.max(remaining, 0))}</span>
            </div>
            {changeTotal > 0 && (
              <div className="flex justify-between font-semibold text-emerald-600">
                <span>Kembalian</span>
                <span className="tabular-nums">{formatIDR(changeTotal)}</span>
              </div>
            )}
          </div>

          <Button
            className="h-14 w-full text-base"
            disabled={!canProcess}
            onClick={processPayment}
          >
            {submitting ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Memproses…
              </>
            ) : (
              <>Selesai &amp; Proses {formatIDR(total)}</>
            )}
          </Button>
          {checkoutBlockReason && (
            <p className="text-center text-[11px] text-destructive">{checkoutBlockReason}</p>
          )}
          <p className="text-center text-[10px] text-muted-foreground">
            {formatNumber(legs.length)} metode · kembalian hanya dihitung dari leg tunai
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
