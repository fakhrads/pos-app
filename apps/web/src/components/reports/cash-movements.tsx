"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatIDR, formatNumber, PAYMENT_METHOD_LABEL, todayWIB } from "@/lib/utils";
import { CASH_DIRECTION_LABEL, type CashDirection, type CashMovement, type CashMovementListResult, type PaymentMethod } from "@/lib/types";
import { MiniStat, ReportCard } from "./report-ui";

const CATEGORY_OPTIONS = [
  "setoran",
  "prive",
  "operasional",
  "modal",
  "lainnya",
];

export function CashMovementsReport() {
  const [items, setItems] = useState<CashMovement[]>([]);
  const [summary, setSummary] = useState<CashMovementListResult["summary"] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<CashMovementListResult>("/cash-movements", {
        page,
        perPage,
      });
      setItems(data.items ?? []);
      setSummary(data.summary);
      setTotal(data.meta?.total ?? 0);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat mutasi kas");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, perPage]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <ReportCard
      title="Kas Masuk / Kas Keluar"
      description="Catat setoran, prive, dan pengeluaran operasional manual di luar transaksi penjualan."
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              Catat Mutasi
            </Button>
          </DialogTrigger>
          <CashMovementForm onDone={() => { setOpen(false); setPage(1); load(); }} />
        </Dialog>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniStat label="Kas Masuk" value={formatIDR(summary?.in.total ?? 0)} className="text-emerald-600" />
        <MiniStat label="Kas Keluar" value={formatIDR(summary?.out.total ?? 0)} className="text-destructive" />
        <MiniStat
          label="Selisih"
          value={formatIDR((summary?.in.total ?? 0) - (summary?.out.total ?? 0))}
          className={(summary?.in.total ?? 0) - (summary?.out.total ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}
        />
        <MiniStat label="Total Catatan" value={formatNumber(total)} />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Belum ada mutasi kas"
          description="Catat kas masuk (setoran) atau kas keluar (pengeluaran) manual lewat tombol di atas."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipe</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead>Keterangan</TableHead>
              <TableHead className="text-right">Nominal</TableHead>
              <TableHead>Metode</TableHead>
              <TableHead>Waktu</TableHead>
              <TableHead>Oleh</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {m.direction === "in" ? (
                      <ArrowUpCircle className="size-4 text-emerald-600" />
                    ) : (
                      <ArrowDownCircle className="size-4 text-destructive" />
                    )}
                    <Badge variant={m.direction === "in" ? "secondary" : "destructive"}>
                      {CASH_DIRECTION_LABEL[m.direction]}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>{m.category ?? "—"}</TableCell>
                <TableCell>
                  {m.note ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {m.reference && (
                    <p className="font-mono text-[11px] text-muted-foreground">{m.reference}</p>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right font-mono font-semibold ${
                    m.direction === "in" ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {m.direction === "in" ? "+" : "−"}
                  {formatIDR(m.amount)}
                </TableCell>
                <TableCell>{PAYMENT_METHOD_LABEL[m.method] ?? m.method}</TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(m.movementAt)}</TableCell>
                <TableCell className="text-muted-foreground">{m.createdBy?.name ?? "—"}</TableCell>
                <TableCell>
                  <DeleteCashMovement id={m.id} onDeleted={() => load()} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Halaman {page} dari {totalPages} · {formatNumber(total)} catatan
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}
    </ReportCard>
  );
}

function CashMovementForm({ onDone }: { onDone: () => void }) {
  const [direction, setDirection] = useState<CashDirection>("in");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Masukkan nominal yang valid (> 0)");
      return;
    }
    setSaving(true);
    try {
      await api.post("/cash-movements", {
        direction,
        amount: Math.round(parsed),
        method,
        category: category || null,
        note: note || null,
        reference: reference || null,
        movementAt: `${todayWIB()}T${new Date().toTimeString().slice(0, 8)}+07:00`,
      });
      toast.success("Mutasi kas berhasil dicatat");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan mutasi kas");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Catat Mutasi Kas</DialogTitle>
        <DialogDescription>
          Kas masuk (setoran/modal) atau kas keluar (prive/pengeluaran operasional).
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Tipe</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as CashDirection)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Kas Masuk</SelectItem>
                <SelectItem value="out">Kas Keluar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Metode</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["cash", "qris", "transfer"] as PaymentMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Nominal (Rp)</Label>
          <Input
            type="number"
            min={1}
            placeholder="100000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Kategori</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih kategori (opsional)" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Referensi (opsional)</Label>
          <Input
            placeholder="Nomor bukti / invoice"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Keterangan</Label>
          <Textarea
            rows={2}
            placeholder="Contoh: setoran kasir shift pagi, belanja ATK, dsb."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={saving}>
          Batal
        </Button>
        <Button onClick={submit} disabled={saving || !amount}>
          {saving ? "Menyimpan…" : "Simpan"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DeleteCashMovement({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!window.confirm("Hapus catatan mutasi kas ini?")) return;
    setBusy(true);
    try {
      await api.delete(`/cash-movements/${id}`);
      toast.success("Mutasi kas dihapus");
      onDeleted();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus mutasi kas");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-destructive"
      onClick={del}
      disabled={busy}
      title="Hapus"
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
