"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { cn, debounce, formatNumber } from "@/lib/utils";
import type { Customer, Paginated } from "@/lib/types";
import { toast } from "sonner";

interface CustomerPickerProps {
  value: Customer | null;
  onChange: (customer: Customer | null) => void;
  /** Tombol hapus pilihan pelanggan */
  clearable?: boolean;
}

export function CustomerPicker({ value, onChange, clearable = true }: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = debounce(async () => {
      setLoading(true);
      try {
        const data = await api.get<Paginated<Customer>>("/customers", {
          q: query || undefined,
          perPage: 8,
        });
        if (!cancelled) setCustomers(data.items);
      } catch {
        // abaikan
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    load();
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  async function createCustomer() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post<{ customer: Customer }>("/customers", {
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
      });
      onChange(created.customer);
      setCreateOpen(false);
      setNewName("");
      setNewPhone("");
      setOpen(false);
      toast.success("Pelanggan berhasil ditambahkan");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menambah pelanggan");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal"
            >
              {value ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{value.name}</span>
                  {value.membership && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      {formatNumber(value.membership.pointsBalance)} poin
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground">Pilih pelanggan (opsional)…</span>
              )}
              <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="start">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Input
                placeholder="Cari nama / no HP…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 border-0 shadow-none focus-visible:ring-0"
                autoFocus
              />
              {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {!loading && customers.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Pelanggan tidak ditemukan.
                </p>
              )}
              {customers.map((c) => (
                <button
                  key={c.id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                    value?.id === c.id && "bg-accent"
                  )}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  </div>
                  {c.membership && (
                    <span className="text-[10px] text-muted-foreground">
                      {formatNumber(c.membership.pointsBalance)} poin
                    </span>
                  )}
                  {value?.id === c.id && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
            <div className="border-t p-1">
              <Button
                variant="ghost"
                className="w-full justify-start text-sm font-normal"
                onClick={() => setCreateOpen(true)}
              >
                <UserPlus className="size-4" />
                Buat pelanggan baru
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {clearable && value && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => onChange(null)}
            title="Hapus pelanggan"
          >
            <Plus className="size-4 rotate-45" />
          </Button>
        )}
      </div>

      {/* Dialog buat pelanggan baru */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pelanggan Baru</DialogTitle>
            <DialogDescription>
              Pelanggan baru akan tersimpan dan langsung terpilih di transaksi ini.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cust-name">Nama *</Label>
              <Input
                id="cust-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nama pelanggan"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-phone">No. HP (opsional)</Label>
              <Input
                id="cust-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="0812xxxxxxx"
                inputMode="tel"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button onClick={createCustomer} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
