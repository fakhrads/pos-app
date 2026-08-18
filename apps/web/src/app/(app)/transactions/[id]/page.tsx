"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { ReceiptDialog } from "@/components/receipt";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatIDR, formatNumber, PAYMENT_METHOD_LABEL, TX_STATUS_LABEL } from "@/lib/utils";
import type { ReceiptData, Transaction } from "@/lib/types";

export default function TransactionDetailPage() {
  const params = useParams<{ id: string }>();
  const [tx, setTx] = useState<Transaction | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ transaction: Transaction }>(`/transactions/${params.id}`);
      setTx(data.transaction);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat transaksi");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function openReceipt() {
    setReceiptLoading(true);
    try {
      const data = await api.get<{ receipt: ReceiptData }>(`/transactions/${params.id}/receipt`);
      setReceipt(data.receipt);
      setReceiptOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat struk");
    } finally {
      setReceiptLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!tx) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/transactions"><ArrowLeft className="mr-1 size-4" /> Kembali</Link>
        </Button>
        <p className="text-sm text-muted-foreground">Transaksi tidak ditemukan.</p>
      </div>
    );
  }

  const totalPaid = tx.payments?.filter((p) => p.type === "sale").reduce((s, p) => s + p.amount, 0) ?? 0;
  const cashPayment = tx.payments?.find((p) => p.type === "sale" && p.method === "cash");

  return (
    <>
      <PageHeader
        title={tx.invoiceNumber}
        description={formatDateTime(tx.soldAt)}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/transactions"><ArrowLeft className="mr-1 size-4" /> Riwayat</Link>
            </Button>
            <Button onClick={openReceipt} disabled={receiptLoading}>
              {receiptLoading ? <RefreshCw className="size-4 animate-spin" /> : <Printer className="size-4" />}
              Lihat / Cetak Struk
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Info umum */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Informasi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={tx.status === "completed" ? "default" : tx.status === "cancelled" ? "destructive" : "secondary"}>
                {TX_STATUS_LABEL[tx.status]}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kasir</span>
              <span>{tx.user?.name ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pelanggan</span>
              <span>{tx.customer?.name ?? "Umum"}</span>
            </div>
            {tx.notes && (
              <div className="rounded bg-muted/50 p-2 text-xs">{tx.notes}</div>
            )}
          </CardContent>
        </Card>

        {/* Ringkasan nilai */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ringkasan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatIDR(tx.subtotal)}</span>
            </div>
            {tx.discountTotal > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Diskon{tx.discountName ? ` (${tx.discountName})` : ""}</span>
                <span>-{formatIDR(tx.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-muted-foreground">
              <span>PPN</span>
              <span>{formatIDR(tx.taxTotal)}</span>
            </div>
            {tx.redeemedPointsValue > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>Poin ({formatNumber(tx.pointsRedeemed)})</span>
                <span>-{formatIDR(tx.redeemedPointsValue)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <span>Total</span>
              <span>{formatIDR(tx.total)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Pembayaran */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pembayaran</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {tx.payments?.filter((p) => p.type === "sale").map((p) => (
              <div key={p.id} className="flex justify-between">
                <span className="text-muted-foreground">{PAYMENT_METHOD_LABEL[p.method]}</span>
                <div className="text-right">
                  <p>{formatIDR(p.amount)}</p>
                  {p.referenceNumber && (
                    <p className="font-mono text-[10px] text-muted-foreground">{p.referenceNumber}</p>
                  )}
                </div>
              </div>
            ))}
            {cashPayment?.changeAmount != null && cashPayment.changeAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kembalian</span>
                <span>{formatIDR(cashPayment.changeAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Dibayar</span>
              <span className="font-semibold">{formatIDR(totalPaid)}</span>
            </div>
            {tx.pointsEarned > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Poin didapat</span>
                <span className="font-medium">{formatNumber(tx.pointsEarned)} poin</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Item */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm">Item Transaksi</CardTitle>
          <CardDescription>{formatNumber((tx.items ?? []).length)} item</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Harga Satuan</TableHead>
                <TableHead className="text-right">Diskon</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tx.items?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="font-medium">{item.productName}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{item.productSku}</p>
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(item.quantity)}</TableCell>
                  <TableCell className="text-right">{formatIDR(item.unitPrice)}</TableCell>
                  <TableCell className="text-right text-emerald-600">
                    {item.discountAmount > 0 ? `-${formatIDR(item.discountAmount)}` : "-"}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatIDR(item.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ReceiptDialog
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        receipt={receipt}
        title="Struk Transaksi"
      />
    </>
  );
}
