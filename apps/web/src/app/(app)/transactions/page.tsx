"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, Receipt, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { PaginationControl } from "@/components/pagination-control";
import { EmptyState } from "@/components/empty-state";
import { api, ApiError } from "@/lib/api";
import {
  debounce,
  formatDateTime,
  formatIDR,
  formatNumber,
  PAYMENT_METHOD_LABEL,
  TX_STATUS_LABEL,
} from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Paginated, Transaction } from "@/lib/types";

export default function TransactionsPage() {
  const { isKasir } = useAuth();
  const [items, setItems] = useState<Transaction[]>([]);
  const [meta, setMeta] = useState<Paginated<Transaction>["meta"] | undefined>();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<Transaction>>("/transactions", {
        q: q || undefined,
        status: status === "all" ? undefined : status,
        page,
        perPage: 20,
      });
      setItems(data.items);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat transaksi");
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    const run = debounce(load, 300);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [load]);

  useEffect(() => setPage(1), [q, status]);

  return (
    <>
      <PageHeader
        title="Transaksi"
        description={isKasir ? "Riwayat transaksi hari ini (kasir)." : "Riwayat seluruh transaksi."}
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nomor transaksi (TRX-…)…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            <SelectItem value="completed">Selesai</SelectItem>
            <SelectItem value="cancelled">Dibatalkan</SelectItem>
            <SelectItem value="pending">Tertunda</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-7" />}
            title="Transaksi tidak ditemukan"
            description="Transaksi baru akan muncul di sini setelah checkout di layar kasir."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/pos">Buka Kasir</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead className="hidden md:table-cell">Waktu (WIB)</TableHead>
                <TableHead className="hidden md:table-cell">Kasir</TableHead>
                <TableHead className="hidden lg:table-cell">Pelanggan</TableHead>
                <TableHead className="hidden lg:table-cell">Metode</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="w-16 text-right">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>
                    <Link href={`/transactions/${tx.id}`} className="font-mono text-sm font-medium hover:underline">
                      {tx.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {formatDateTime(tx.soldAt)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{tx.user?.name ?? "-"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{tx.customer?.name ?? "-"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {tx.payments
                        ?.filter((p) => p.type === "sale")
                        .map((p) => (
                          <Badge key={p.id} variant="outline" className="text-[10px]">
                            {PAYMENT_METHOD_LABEL[p.method]}
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatIDR(tx.total)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={tx.status === "completed" ? "default" : tx.status === "cancelled" ? "destructive" : "secondary"}>
                      {TX_STATUS_LABEL[tx.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="size-8" asChild>
                      <Link href={`/transactions/${tx.id}`} title="Lihat detail">
                        <Eye className="size-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="px-4 pb-4">
          <PaginationControl meta={meta} onPageChange={setPage} />
        </div>
      </div>
    </>
  );
}
