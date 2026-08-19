"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { cn, formatDateTime, formatIDR, formatNumber } from "@/lib/utils";
import type { Shift, ShiftDetailResult, ShiftSummary } from "@/lib/types";

interface ShiftManagerProps {
  enforceCheckout: boolean;
  /** Ambang selisih kas yang TIDAK perlu catatan (setting shift.cash_tolerance) */
  cashTolerance?: number;
  /** naikkan untuk me-refresh shift dari server (setelah checkout/hold dsb.) */
  refreshKey: number;
  onShiftChange?: (shift: Shift | null) => void;
}

export function ShiftManager({
  enforceCheckout,
  cashTolerance = 0,
  refreshKey,
  onShiftChange,
}: ShiftManagerProps) {
  const [shift, setShiftState] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openOpen, setOpenOpen] = useState(false);
  const [openClose, setOpenClose] = useState(false);
  const [closeShiftId, setCloseShiftId] = useState<string | null>(null);

  const setShift = useCallback(
    (s: Shift | null) => {
      setShiftState(s);
      onShiftChange?.(s);
    },
    [onShiftChange]
  );

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ shift: Shift | null }>("/shifts/current");
      setShift(data.shift);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat status shift");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCurrent();
  }, [loadCurrent, refreshKey]);

  const blocked = enforceCheckout && !loading && !shift;

  return (
    <>
      {/* ===== Banner status shift ===== */}
      {loading ? (
        <div className="skeleton h-12 w-full rounded-lg" />
      ) : error && !shift ? (
        <div className="flex h-12 items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3">
          <span className="flex min-w-0 items-center gap-2 text-xs text-destructive">
            <ShieldAlert className="size-4 shrink-0" />
            <span className="truncate">{error}</span>
          </span>
          <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={loadCurrent}>
            <Loader2 className={cn("size-3.5", loading && "animate-spin")} />
            Coba lagi
          </Button>
        </div>
      ) : shift ? (
        <div className="flex h-12 items-center justify-between gap-2 rounded-lg border bg-card px-3">
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <CalendarClock className="size-4 shrink-0 text-primary" />
            <span className="truncate font-medium">
              Shift <span className="font-mono">{shift.shiftNumber}</span>
            </span>
            <Badge variant="secondary" className="hidden shrink-0 text-[10px] sm:inline-flex">
              Kas: {formatIDR(shift.expectedCash)}
            </Badge>
            <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
              {formatDateTime(shift.openedAt, { date: false })}
            </span>
          </span>
          <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setOpenClose(true)}>
            Tutup Shift
          </Button>
        </div>
      ) : enforceCheckout ? (
        <div className="flex h-12 items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3">
          <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-amber-600">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="truncate">Shift belum dibuka — checkout diblokir</span>
          </span>
          <Button size="sm" className="h-9 shrink-0" onClick={() => setOpenOpen(true)}>
            Buka Shift
          </Button>
        </div>
      ) : (
        <div className="flex h-12 items-center gap-2 rounded-lg border bg-muted/30 px-3 text-[11px] text-muted-foreground">
          <ShieldAlert className="size-4 shrink-0" />
          Guard shift nonaktif (demo) — transaksi berjalan tanpa shift.
        </div>
      )}

      {/* ===== Modal Buka Shift ===== */}
      <OpenShiftDialog
        open={openOpen || blocked}
        onOpenChange={(o) => {
          if (blocked) return; // non-dismissible saat guard aktif (AC-06.4)
          setOpenOpen(o);
        }}
        onOpened={(s) => {
          setShift(s);
          setOpenOpen(false);
          toast.success(`Shift ${s.shiftNumber} dibuka`);
        }}
        onAlreadyOpen={(existingId) => {
          // 409 SHIFT_ALREADY_OPEN → tawarkan tutup shift lama (edge case §7.5.1)
          setOpenOpen(false);
          toast.warning("Kamu masih punya shift terbuka — tutup dulu sebelum buka yang baru.");
          setCloseShiftId(existingId);
          setOpenClose(true);
        }}
      />

      {/* ===== Modal Tutup Shift ===== */}
      <CloseShiftDialog
        open={openClose}
        onOpenChange={setOpenClose}
        shiftId={closeShiftId ?? shift?.id ?? null}
        cashTolerance={cashTolerance}
        onClosed={() => {
          setShift(null);
          setCloseShiftId(null);
          setOpenClose(false);
        }}
      />
    </>
  );
}

/* ================= Modal Buka Shift ================= */

function OpenShiftDialog({
  open,
  onOpenChange,
  onOpened,
  onAlreadyOpen,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpened: (shift: Shift) => void;
  onAlreadyOpen: (existingShiftId: string) => void;
}) {
  const [openingCash, setOpeningCash] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setOpeningCash("");
  }, [open]);

  async function submit() {
    setSubmitting(true);
    try {
      const data = await api.post<{ shift: Shift }>("/shifts", {
        openingCash: Math.max(0, Number(openingCash) || 0),
      });
      onOpened(data.shift);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SHIFT_ALREADY_OPEN") {
        const id = (err.details as { shiftId?: string } | undefined)?.shiftId;
        onAlreadyOpen(id ?? "");
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Gagal membuka shift");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-4" /> Buka Shift
          </DialogTitle>
          <DialogDescription>
            Isi modal kas awal di laci. Minimal Rp 0. Transaksi baru bisa diproses setelah shift
            terbuka.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="opening-cash">Modal kas awal (Rp)</Label>
          <Input
            id="opening-cash"
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            className="h-12 text-lg tabular-nums"
            placeholder="0"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <DialogFooter>
          <Button className="h-12 w-full" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Buka Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================= Modal Tutup Shift ================= */

function CloseShiftDialog({
  open,
  onOpenChange,
  shiftId,
  cashTolerance,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  shiftId: string | null;
  cashTolerance: number;
  onClosed: () => void;
}) {
  const [detail, setDetail] = useState<ShiftDetailResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);

  useEffect(() => {
    if (!open || !shiftId) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setActualCash("");
    setNotes("");
    setNoteError(false);
    api
      .get<ShiftDetailResult>(`/shifts/${shiftId}`)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setActualCash(String(d.summary.expectedCash));
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof ApiError ? err.message : "Gagal memuat ringkasan shift");
          onOpenChange(false);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, shiftId, onOpenChange]);

  const summary: ShiftSummary | null = detail?.summary ?? null;
  const actual = Number(actualCash);
  const disc = Number.isFinite(actual) ? actual - (summary?.expectedCash ?? 0) : 0;
  const notesRequired = Math.abs(disc) > cashTolerance;

  async function submit() {
    if (!shiftId || submitting) return;
    if (notesRequired && !notes.trim()) {
      setNoteError(true);
      return;
    }
    setSubmitting(true);
    setNoteError(false);
    try {
      await api.post<{ shift: Shift }>(`/shifts/${shiftId}/close`, {
        actualCash: Math.max(0, Number(actualCash) || 0),
        notes: notes.trim() || undefined,
      });
      toast.success("Shift ditutup — laporan tersimpan");
      onClosed();
    } catch (err) {
      if (err instanceof ApiError && err.code === "SHIFT_DISCREPANCY_NOTE_REQUIRED") {
        setNoteError(true);
        toast.error("Selisih kas perlu catatan — isi alasan selisih dulu.");
      } else {
        toast.error(err instanceof ApiError ? err.message : "Gagal menutup shift");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" /> Tutup Shift
          </DialogTitle>
          <DialogDescription>
            {detail?.shift.shiftNumber} · dibuka{" "}
            {formatDateTime(detail?.shift.openedAt)}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-2">
            <div className="skeleton h-10 rounded-lg" />
            <div className="skeleton h-10 rounded-lg" />
            <div className="skeleton h-24 rounded-lg" />
          </div>
        )}

        {!loading && summary && (
          <div className="space-y-4">
            {/* Ringkasan shift */}
            <div className="space-y-1 rounded-lg border p-3 text-sm">
              <Row label="Modal awal" value={formatIDR(summary.openingCash)} />
              <Row label="Penjualan tunai" value={formatIDR(summary.cashSales)} className="text-emerald-600" />
              <Row label="Penjualan QRIS" value={formatIDR(summary.qrisSales)} />
              <Row label="Penjualan transfer" value={formatIDR(summary.transferSales)} />
              <Row label="Retur" value={`-${formatIDR(summary.refunds)}`} className="text-destructive" />
              <Separator className="my-1" />
              <Row
                label={`Kas expected (${formatNumber(summary.transactionCount)} trx)`}
                value={formatIDR(summary.expectedCash)}
                className="font-semibold"
              />
            </div>

            {/* Input kas akhir */}
            <div className="space-y-1.5">
              <Label htmlFor="actual-cash">Kas akhir di laci (Rp)</Label>
              <Input
                id="actual-cash"
                type="number"
                inputMode="numeric"
                min={0}
                className="h-12 text-lg tabular-nums"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
              />
              <p
                className={cn(
                  "text-xs font-medium",
                  disc === 0 ? "text-muted-foreground" : disc < 0 ? "text-destructive" : "text-emerald-600"
                )}
              >
                Selisih: {disc < 0 ? "-" : "+"}
                {formatIDR(Math.abs(disc))} {disc === 0 ? "(pas)" : disc < 0 ? "(kurang)" : "(lebih)"}
              </p>
            </div>

            {/* Catatan wajib saat selisih > tolerance */}
            {notesRequired && (
              <div className="space-y-1.5">
                <Label htmlFor="shift-notes">
                  Catatan selisih <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="shift-notes"
                  className={cn(noteError && "border-destructive")}
                  placeholder="Contoh: uang kembalian lebih/kurang Rp … karena …"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
                {noteError && (
                  <p className="text-xs text-destructive">Catatan wajib diisi karena ada selisih.</p>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" className="h-12 flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
                Batal
              </Button>
              <Button className="h-12 flex-1" onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Tutup Shift
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", className)}>{value}</span>
    </div>
  );
}
