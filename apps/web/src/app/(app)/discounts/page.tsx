"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BadgePercent, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { ManagerOnly } from "@/components/role-guard";
import { api, ApiError } from "@/lib/api";
import { debounce, formatIDR, formatNumber } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Category, Discount, DiscountPayload, DiscountScope, DiscountType, Paginated, Product } from "@/lib/types";

export default function DiscountsPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<Discount[]>([]);
  const [meta, setMeta] = useState<Paginated<Discount>["meta"] | undefined>();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [deleting, setDeleting] = useState<Discount | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<Discount>>("/discounts", { q: q || undefined, page, perPage: 20 });
      setItems(data.items);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat diskon");
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => {
    const run = debounce(load, 300);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [load]);

  useEffect(() => setPage(1), [q]);

  useEffect(() => {
    api.get<{ items: Category[] }>("/categories").then((d) => setCategories(d.items)).catch(() => {});
    api.get<Paginated<Product>>("/products", { perPage: 50 }).then((d) => setProducts(d.items)).catch(() => {});
  }, []);

  async function toggleActive(d: Discount) {
    try {
      await api.patch(`/discounts/${d.id}`, { isActive: !d.isActive });
      toast.success(`Diskon "${d.name}" ${d.isActive ? "dinonaktifkan" : "diaktifkan"}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengubah status");
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/discounts/${deleting.id}`);
      toast.success("Diskon dihapus");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus diskon");
    }
  }

  return (
    <ManagerOnly>
      <PageHeader
        title="Diskon & Promo"
        description="Promo terstruktur (kode, periode, kuota). Diskon manual kasir diatur langsung saat checkout."
        actions={
          isAdmin && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="size-4" /> Buat Diskon
            </Button>
          )
        }
      />

      <div className="mb-4 max-w-md">
        <Input placeholder="Cari nama / kode diskon…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Belum ada diskon"
            description="Buat promo seperti kode HEMAT10 atau diskon kategori."
            action={
              isAdmin ? (
                <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  <BadgePercent className="size-4" /> Buat Diskon
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Kode</TableHead>
                <TableHead className="hidden md:table-cell">Jenis</TableHead>
                <TableHead className="text-right">Nilai</TableHead>
                <TableHead className="hidden lg:table-cell">Cakupan</TableHead>
                <TableHead className="text-right">Status</TableHead>
                {isAdmin && <TableHead className="w-28 text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>
                    {d.code ? (
                      <Badge variant="secondary" className="font-mono">{d.code}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {d.type === "percentage" ? "Persen" : "Nominal"}
                  </TableCell>
                  <TableCell className="text-right">
                    {d.type === "percentage" ? `${formatNumber(d.value)}%` : formatIDR(d.value)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{d.scope}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={d.isActive ? "default" : "outline"}>
                      {d.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                    {d.usageLimit != null && (
                      <p className="text-[10px] text-muted-foreground">
                        {formatNumber(d.usedCount)}/{formatNumber(d.usageLimit)} dipakai
                      </p>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => { setEditing(d); setFormOpen(true); }}>
                          <Pencil className="size-4" />
                        </Button>
                        <div className="flex h-8 items-center px-1" title={d.isActive ? "Nonaktifkan" : "Aktifkan"}>
                          <Switch checked={d.isActive} onCheckedChange={() => toggleActive(d)} />
                        </div>
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setDeleting(d)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="px-4 pb-4">
          <PaginationControl meta={meta} onPageChange={setPage} />
        </div>
      </div>

      <DiscountFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        discount={editing}
        categories={categories}
        products={products}
        onSaved={() => { setFormOpen(false); load(); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus diskon?</AlertDialogTitle>
            <AlertDialogDescription>"{deleting?.name}" akan dihapus (soft delete).</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ManagerOnly>
  );
}

function DiscountFormDialog({
  open,
  onOpenChange,
  discount,
  categories,
  products,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  discount: Discount | null;
  categories: Category[];
  products: Product[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<DiscountPayload>({
    name: "",
    code: "",
    type: "percentage",
    value: 10,
    scope: "global",
    validFrom: "",
    validTo: "",
    maxDiscountAmount: undefined,
    usageLimit: undefined,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: discount?.name ?? "",
        code: discount?.code ?? "",
        type: discount?.type ?? "percentage",
        value: discount?.value ?? 10,
        scope: discount?.scope ?? "global",
        categoryId: discount?.categoryId ?? undefined,
        productId: discount?.productId ?? undefined,
        validFrom: discount?.validFrom ? discount.validFrom.slice(0, 10) : "",
        validTo: discount?.validTo ? discount.validTo.slice(0, 10) : "",
        maxDiscountAmount: discount?.maxDiscountAmount ?? undefined,
        usageLimit: discount?.usageLimit ?? undefined,
      });
    }
  }, [open, discount]);

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Nama diskon wajib diisi");
      return;
    }
    if (form.value <= 0) {
      toast.error("Nilai diskon harus lebih dari 0");
      return;
    }
    setSaving(true);
    try {
      const payload: DiscountPayload = {
        ...form,
        name: form.name.trim(),
        code: form.code?.trim() || undefined,
        validFrom: form.validFrom ? new Date(form.validFrom + "T00:00:00").toISOString() : undefined,
        validTo: form.validTo ? new Date(form.validTo + "T23:59:59").toISOString() : undefined,
        value: Number(form.value),
        maxDiscountAmount: form.maxDiscountAmount ? Math.round(Number(form.maxDiscountAmount)) : undefined,
        usageLimit: form.usageLimit ? Math.round(Number(form.usageLimit)) : undefined,
      };
      if (discount) {
        await api.patch(`/discounts/${discount.id}`, payload);
        toast.success("Diskon diperbarui");
      } else {
        await api.post("/discounts", payload);
        toast.success("Diskon dibuat");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan diskon");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{discount ? "Edit Diskon" : "Buat Diskon"}</DialogTitle>
          <DialogDescription>Promo terstruktur — dipakai lewat kode atau berlaku otomatis.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-name">Nama *</Label>
            <Input id="d-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Diskon Lebaran" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-code">Kode promo (opsional)</Label>
              <Input id="d-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="HEMAT10" className="font-mono uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label>Jenis</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as DiscountType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Persen (%)</SelectItem>
                  <SelectItem value="fixed">Nominal (Rp)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-value">Nilai *</Label>
              <Input id="d-value" type="number" min={0} value={form.value || ""} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Cakupan</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as DiscountScope })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (semua)</SelectItem>
                  <SelectItem value="category">Per kategori</SelectItem>
                  <SelectItem value="product">Per produk</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.scope === "category" && (
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <Select value={form.categoryId ?? ""} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.scope === "product" && (
            <div className="space-y-1.5">
              <Label>Produk</Label>
              <Select value={form.productId ?? ""} onValueChange={(v) => setForm({ ...form, productId: v })}>
                <SelectTrigger><SelectValue placeholder="Pilih produk" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Berlaku dari</Label>
              <Input type="date" value={form.validFrom ?? ""} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Berlaku sampai</Label>
              <Input type="date" value={form.validTo ?? ""} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="d-max">Maks. diskon (Rp, opsional)</Label>
              <Input id="d-max" type="number" min={0} value={form.maxDiscountAmount ?? ""} onChange={(e) => setForm({ ...form, maxDiscountAmount: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="d-limit">Kuota pemakaian (opsional)</Label>
              <Input id="d-limit" type="number" min={0} value={form.usageLimit ?? ""} onChange={(e) => setForm({ ...form, usageLimit: Number(e.target.value) })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
