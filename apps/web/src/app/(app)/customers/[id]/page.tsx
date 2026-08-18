"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, RefreshCw, Star } from "lucide-react";
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
import { EmptyState } from "@/components/empty-state";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatIDR, formatNumber } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Customer, Paginated, PointMovement, Transaction } from "@/lib/types";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const { isManager } = useAuth();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [points, setPoints] = useState<PointMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [makingMember, setMakingMember] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cust, txData] = await Promise.all([
        api.get<{ customer: Customer }>(`/customers/${params.id}`),
        api.get<Paginated<Transaction>>(`/customers/${params.id}/transactions`, { perPage: 10 }),
      ]);
      setCustomer(cust.customer);
      setTxs(txData.items);
      if (cust.customer.membership) {
        const pt = await api.get<Paginated<PointMovement>>(
          `/memberships/${cust.customer.membership.id}/points-history`,
          { perPage: 10 }
        );
        setPoints(pt.items);
      } else {
        setPoints([]);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat pelanggan");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function makeMember() {
    setMakingMember(true);
    try {
      await api.post("/memberships", { customerId: params.id });
      toast.success("Pelanggan sekarang member");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal membuat member");
    } finally {
      setMakingMember(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/customers"><ArrowLeft className="mr-1 size-4" /> Kembali</Link>
        </Button>
        <p className="text-sm text-muted-foreground">Pelanggan tidak ditemukan.</p>
      </div>
    );
  }

  const totalSpent = txs.reduce((s, t) => s + t.total, 0);

  return (
    <>
      <PageHeader
        title={customer.name}
        description={[customer.phone, customer.email, customer.address].filter(Boolean).join(" · ") || "Tanpa kontak"}
        actions={
          <Button variant="outline" asChild>
            <Link href="/customers"><ArrowLeft className="mr-1 size-4" /> Kembali</Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Membership */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Star className="size-4" /> Membership
            </CardTitle>
          </CardHeader>
          <CardContent>
            {customer.membership ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Kode member</span>
                  <Badge variant="secondary" className="font-mono">{customer.membership.memberCode}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Tier</span>
                  <Badge>{customer.membership.tier}</Badge>
                </div>
                <div className="rounded-lg bg-muted/60 p-3 text-center">
                  <p className="text-3xl font-bold">{formatNumber(customer.membership.pointsBalance)}</p>
                  <p className="text-xs text-muted-foreground">Poin tersedia</p>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Poin didapat: {formatNumber(customer.membership.pointsEarnedTotal)}</span>
                  <span>Poin dipakai: {formatNumber(customer.membership.pointsRedeemedTotal)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-center">
                <p className="text-sm text-muted-foreground">Belum menjadi member.</p>
                {isManager && (
                  <Button onClick={makeMember} disabled={makingMember} className="w-full">
                    {makingMember && <Loader2 className="size-4 animate-spin" />}
                    Jadikan Member
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Statistik singkat */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Aktivitas (10 transaksi terakhir)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Jumlah transaksi</span>
              <span className="font-semibold">{formatNumber(txs.length)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total belanja</span>
              <span className="font-semibold">{formatIDR(totalSpent)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Riwayat poin */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Riwayat Poin</CardTitle>
          </CardHeader>
          <CardContent>
            {!customer.membership || points.length === 0 ? (
              <EmptyState title="Belum ada mutasi poin" />
            ) : (
              <div className="space-y-2">
                {points.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="text-xs font-medium capitalize">{p.type}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDateTime(p.createdAt)}</p>
                    </div>
                    <span
                      className={
                        p.type === "redeemed"
                          ? "font-semibold text-destructive"
                          : "font-semibold text-emerald-600"
                      }
                    >
                      {p.type === "redeemed" ? "-" : "+"}{formatNumber(p.points)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Histori transaksi */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">Histori Transaksi</CardTitle>
            <CardDescription>10 transaksi terbaru</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={load} title="Muat ulang">
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {txs.length === 0 ? (
            <EmptyState title="Belum ada transaksi" description="Transaksi atas nama pelanggan ini akan muncul di sini." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor</TableHead>
                  <TableHead className="hidden md:table-cell">Waktu (WIB)</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Poin</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txs.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link href={`/transactions/${t.id}`} className="font-mono text-sm hover:underline">
                        {t.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDateTime(t.soldAt)}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatIDR(t.total)}</TableCell>
                    <TableCell className="text-right">+{formatNumber(t.pointsEarned)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/transactions/${t.id}`}>Lihat</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
