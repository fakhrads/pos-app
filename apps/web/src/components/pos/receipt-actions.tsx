"use client";

import { useEffect } from "react";
import { CheckCircle2, MessageCircle, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReceiptView } from "@/components/receipt";
import { API_URL } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { formatIDR, formatNumber } from "@/lib/utils";
import type { CheckoutResult } from "@/lib/types";

interface ReceiptActionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: CheckoutResult | null;
  storeName: string;
  qrisPayload: string;
  printWidthMm: number;
  showVerificationQr: boolean;
  showQrisQr: boolean;
  storeWhatsapp: string;
}

/** Normalisasi nomor HP: 08xx → 628xx; +62… → 62… */
export function normalizeWaPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  return digits;
}

/**
 * Layar sukses setelah checkout: cetak struk, kirim WhatsApp, selesai (AC-05.1).
 * Print via window.print() + CSS @media print (data sudah di tangan — tanpa request).
 * WhatsApp: GET /transactions/:id/receipt?format=text → wa.me (AC-05.4).
 */
export function ReceiptActions({
  open,
  onOpenChange,
  result,
  storeName,
  qrisPayload,
  printWidthMm,
  showVerificationQr,
  showQrisQr,
  storeWhatsapp,
}: ReceiptActionsProps) {
  // @page size mengikuti setting receipt.print_width_mm saat dialog print terbuka
  useEffect(() => {
    if (!open) return;
    const style = document.createElement("style");
    style.dataset.posPrintWidth = "1";
    style.textContent = `@media print { @page { size: ${printWidthMm}mm auto; margin: 0; } }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [open, printWidthMm]);

  if (!result) return null;
  const r = result;
  const { transaction: tx } = r;

  async function fetchReceiptText(): Promise<string | null> {
    try {
      const token = getAccessToken();
      const res = await fetch(
        `${API_URL}/transactions/${tx.id}/receipt?format=text`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async function sendWhatsapp() {
    const phone =
      normalizeWaPhone(tx.customer?.phone) || normalizeWaPhone(storeWhatsapp);
    if (!phone) {
      toast.error("Nomor WhatsApp pelanggan tidak tersedia");
      return;
    }
    let text = await fetchReceiptText();
    if (!text) {
      // Fallback offline: susun teks sederhana dari data struk (print tetap jalan)
      text = buildFallbackText();
      toast.info("Struk disalin ke clipboard — tempel di WhatsApp");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // clipboard ditolak — buka wa.me tetap
      }
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      try {
        await navigator.clipboard.writeText(text);
        toast.info("Popup diblokir — teks struk disalin ke clipboard");
      } catch {
        toast.error("Gagal membuka WhatsApp");
      }
    }
  }

  function buildFallbackText(): string {
    const lines: string[] = [
      storeName || "FakhriPOS",
      `No: ${tx.invoiceNumber}`,
      `Tanggal: ${new Date(tx.soldAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}`,
      "---------------------",
      ...(r.items ?? []).map(
        (i) => `${i.productName}\n  ${formatNumber(i.quantity)} x ${formatIDR(i.unitPrice)}  ${formatIDR(i.lineTotal)}`
      ),
      "---------------------",
      `Subtotal: ${formatIDR(tx.subtotal)}`,
      `Diskon: -${formatIDR(tx.discountTotal)}`,
      `PPN: ${formatIDR(tx.taxTotal)}`,
      `TOTAL: ${formatIDR(tx.total)}`,
    ];
    return lines.join("\n");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 sm:max-w-sm">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Transaksi Berhasil
          </DialogTitle>
          <DialogDescription className="text-xs">
            {tx.invoiceNumber} · {formatIDR(tx.total)}
            {r.pointsEarned > 0 && ` · +${formatNumber(r.pointsEarned)} poin`}
          </DialogDescription>
        </DialogHeader>

        <div className="receipt-scroll max-h-[45vh] overflow-y-auto bg-muted/50 px-3 py-4">
          <ReceiptView
            receipt={r.receipt}
            printWidthMm={printWidthMm}
            showVerificationQr={showVerificationQr}
            showQrisQr={showQrisQr}
            qrisPayload={qrisPayload}
          />
        </div>

        <div className="space-y-2 border-t p-4">
          <Button className="h-12 w-full" onClick={() => window.print()}>
            <Printer className="size-4" />
            Cetak Struk
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-12" onClick={sendWhatsapp}>
              <MessageCircle className="size-4" />
              Kirim WhatsApp
            </Button>
            <Button variant="outline" className="h-12" onClick={() => onOpenChange(false)}>
              <X className="size-4" />
              Selesai
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
