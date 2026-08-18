"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime, formatIDR, formatNumber, PAYMENT_METHOD_LABEL } from "@/lib/utils";
import type { ReceiptData } from "@/lib/types";

/**
 * Struk thermal 58mm. Saat tombol "Cetak" ditekan, window.print() dipanggil
 * dan CSS @media print di globals.css hanya menampilkan area .print-receipt.
 */
export function ReceiptView({ receipt }: { receipt: ReceiptData }) {
  const { transaction: tx, items, payments, store } = receipt;

  const cashPayment = payments.find((p) => p.method === "cash" && p.type === "sale");
  const totalPaid = payments
    .filter((p) => p.type === "sale")
    .reduce((sum, p) => sum + p.amount, 0);
  const dpp = tx.subtotal - tx.discountTotal;

  return (
    <div className="print-receipt mx-auto w-[58mm] bg-white p-2 font-mono text-[10px] leading-snug text-black">
      {/* Header toko */}
      <div className="text-center">
        <p className="text-[13px] font-bold uppercase">{store.name || "FakhriPOS"}</p>
        {store.address && <p className="whitespace-pre-line">{store.address}</p>}
        {store.phone && <p>Telp: {store.phone}</p>}
      </div>

      <div className="my-1.5 border-t border-dashed border-black" />

      {/* Info transaksi */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>No</span>
          <span>{tx.invoiceNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>Tanggal</span>
          <span>{formatDateTime(tx.soldAt)}</span>
        </div>
        {tx.user?.name && (
          <div className="flex justify-between">
            <span>Kasir</span>
            <span>{tx.user.name}</span>
          </div>
        )}
        {tx.customer?.name && (
          <div className="flex justify-between">
            <span>Pelanggan</span>
            <span>{tx.customer.name}</span>
          </div>
        )}
      </div>

      <div className="my-1.5 border-t border-dashed border-black" />

      {/* Item */}
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id}>
            <p className="font-semibold">{item.productName}</p>
            <div className="flex justify-between">
              <span>
                {formatNumber(item.quantity)} x {formatIDR(item.unitPrice)}
              </span>
              <span>{formatIDR(item.lineTotal)}</span>
            </div>
            {item.discountAmount > 0 && (
              <div className="flex justify-between text-right">
                <span className="pl-3">Diskon</span>
                <span>-{formatIDR(item.discountAmount)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="my-1.5 border-t border-dashed border-black" />

      {/* Ringkasan */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatIDR(tx.subtotal)}</span>
        </div>
        {tx.discountTotal > 0 && (
          <div className="flex justify-between">
            <span>
              Diskon{txtName(tx.discountName)}
            </span>
            <span>-{formatIDR(tx.discountTotal)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>DPP</span>
          <span>{formatIDR(Math.max(dpp, 0))}</span>
        </div>
        <div className="flex justify-between">
          <span>PPN</span>
          <span>{formatIDR(tx.taxTotal)}</span>
        </div>
        {tx.redeemedPointsValue > 0 && (
          <div className="flex justify-between">
            <span>Poin ({formatNumber(tx.pointsRedeemed)})</span>
            <span>-{formatIDR(tx.redeemedPointsValue)}</span>
          </div>
        )}
        <div className="flex justify-between text-[12px] font-bold">
          <span>TOTAL</span>
          <span>{formatIDR(tx.total)}</span>
        </div>
      </div>

      {/* Pembayaran */}
      <div className="mt-1 space-y-0.5">
        {payments
          .filter((p) => p.type === "sale")
          .map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>Bayar ({PAYMENT_METHOD_LABEL[p.method]})</span>
              <span>{formatIDR(p.amount)}</span>
            </div>
          ))}
        {cashPayment?.changeAmount != null && cashPayment.changeAmount > 0 && (
          <div className="flex justify-between">
            <span>Kembalian</span>
            <span>{formatIDR(cashPayment.changeAmount)}</span>
          </div>
        )}
        {totalPaid === 0 && (
          <div className="flex justify-between">
            <span>Bayar</span>
            <span>{formatIDR(0)}</span>
          </div>
        )}
      </div>

      {/* Poin */}
      {(tx.pointsEarned > 0 || tx.pointsRedeemed > 0) && (
        <div className="mt-1 space-y-0.5">
          {tx.pointsEarned > 0 && (
            <div className="flex justify-between">
              <span>Poin didapat</span>
              <span>{formatNumber(tx.pointsEarned)}</span>
            </div>
          )}
          {tx.pointsRedeemed > 0 && (
            <div className="flex justify-between">
              <span>Poin dipakai</span>
              <span>{formatNumber(tx.pointsRedeemed)}</span>
            </div>
          )}
        </div>
      )}

      {tx.status === "cancelled" && (
        <p className="mt-2 text-center font-bold">** DIBATALKAN **</p>
      )}

      <div className="my-1.5 border-t border-dashed border-black" />

      {/* Footer */}
      {store.footer && (
        <p className="whitespace-pre-line text-center">{store.footer}</p>
      )}
      <p className="mt-1 text-center">Terima kasih 🙏</p>
    </div>
  );
}

function txtName(name?: string | null) {
  return name ? ` (${name})` : "";
}

export function ReceiptDialog({
  open,
  onOpenChange,
  receipt,
  title = "Struk Transaksi",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: ReceiptData | null;
  title?: string;
}) {
  if (!receipt) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 sm:max-w-sm">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center justify-between text-base">
            {title}
            <span className="font-normal text-muted-foreground">
              {receipt.transaction.invoiceNumber}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Preview struk 58mm — cetak via printer thermal / simpan PDF.
          </DialogDescription>
        </DialogHeader>
        <div className="receipt-scroll max-h-[60vh] overflow-y-auto bg-muted/50 px-3 py-4">
          <ReceiptView receipt={receipt} />
        </div>
        <div className="flex items-center justify-between gap-2 border-t p-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Tutup
          </Button>
          <Button className="w-full" onClick={() => window.print()}>
            <Printer className="size-4" />
            Cetak Struk
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
