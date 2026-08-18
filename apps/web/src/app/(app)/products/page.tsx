"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  Warehouse,
} from "lucide-react";
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
import { api, ApiError } from "@/lib/api";
import { cn, debounce, formatIDR, formatNumber } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type {
  Category,
  Paginated,
  Product,
  ProductPayload,
  StockAdjustPayload,
} from "@/lib/types";

const UNITS = ["pcs", "pack", "box", "kg", "gram", "liter", "meter"];

export default function ProductsPage() {
  const { isManager, isAdmin } = useAuth();
  const canManage = isManager || isAdmin;

  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<Paginated<Product>["meta"] | undefined>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<Product>>("/products", {
        q: search || undefined,
        categoryId: categoryId === "all" ? undefined : categoryId,
        isActive: status === "all" ? undefined : status === "active",
        page,
        perPage: 20,
      });
      setItems(data.items);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat produk");
    } finally {
      setLoading(false);
    }
  }, [search, categoryId, status, page]);

  useEffect(() => {
    api
      .get<{ items: Category[] }>("/categories")
      .then((d) => setCategories(d.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const run = debounce(load, 300);
    run();
    return () => clearTimeout(run as unknown as ReturnType<typeof setTimeout>);
  }, [load]);

  useEffect(() => setPage(1), [search, categoryId, status]);

  async function toggleActive(product: Product) {
    try {
      await api.patch(`/products/${product.id}`, { isActive: !product.isActive });
      toast.success(`${product.name} ${product.isActive ? "dinonaktifkan" : "diaktifkan"}`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengubah status");
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/products/${deleting.id}`);
      toast.success(`Produk "${deleting.name}" dihapus`);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus produk");
    }
  }

  return (
    <>
      <PageHeader
        title="Produk"
        description="Kelola katalog produk, harga, dan stok."
        actions={
          canManage && (
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <PackagePlus className="size-4" />
              Tambah Produk
            </Button>
          )
        }
      />

      {/* Filter */}
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_160px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nama / SKU / barcode…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger>
            <SelectValue placeholder="Semua kategori" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua kategori</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="inactive">Nonaktif</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabel */}
      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Produk tidak ditemukan"
            description="Ubah filter atau tambahkan produk baru."
            action={
              canManage ? (
                <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  <Plus className="size-4" /> Tambah Produk
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="hidden md:table-cell">Kategori</TableHead>
                <TableHead className="hidden lg:table-cell">Harga Beli</TableHead>
                <TableHead className="text-right">Harga Jual</TableHead>
                <TableHead className="text-right">Stok</TableHead>
                <TableHead className="text-right">Status</TableHead>
                {canManage && <TableHead className="w-28 text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => {
                const lowStock = p.stockOnHand <= p.minStock;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className={cn("truncate font-medium", !p.isActive && "text-muted-foreground line-through")}>
                          {p.name}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {[p.sku, p.barcode].filter(Boolean).join(" · ") || "-"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {p.category?.name ?? "-"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {canManage ? formatIDR(p.costPrice) : "•••"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatIDR(p.sellingPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={p.stockOnHand <= 0 ? "destructive" : lowStock ? "secondary" : "outline"}>
                        {formatNumber(p.stockOnHand)} {p.unit}
                      </Badge>
                      {lowStock && (
                        <p className="text-[10px] text-amber-600">menipis (min {formatNumber(p.minStock)})</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={p.isActive ? "default" : "outline"}>
                        {p.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title="Ubah stok"
                            onClick={() => setAdjusting(p)}
                          >
                            <Warehouse className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title="Edit"
                            onClick={() => { setEditing(p); setFormOpen(true); }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive"
                              title="Hapus"
                              onClick={() => setDeleting(p)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title={p.isActive ? "Nonaktifkan" : "Aktifkan"}
                            onClick={() => toggleActive(p)}
                          >
                            <Archive className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <div className="px-4 pb-4">
          <PaginationControl meta={meta} onPageChange={setPage} />
        </div>
      </div>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categories}
        onSaved={() => { setFormOpen(false); load(); }}
      />

      <StockAdjustDialog
        product={adjusting}
        onClose={() => setAdjusting(null)}
        onSaved={() => { setAdjusting(null); load(); }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus produk?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" akan dihapus dari katalog (soft delete). Riwayat transaksi lama tetap utuh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ===================== Form Produk =====================
function ProductFormDialog({
  open,
  onOpenChange,
  product,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  categories: Category[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductPayload>({
    categoryId: "",
    name: "",
    sku: "",
    barcode: "",
    unit: "pcs",
    description: "",
    costPrice: 0,
    sellingPrice: 0,
    minStock: 0,
    isTaxable: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        categoryId: product?.categoryId ?? categories[0]?.id ?? "",
        name: product?.name ?? "",
        sku: product?.sku ?? "",
        barcode: product?.barcode ?? "",
        unit: product?.unit ?? "pcs",
        description: product?.description ?? "",
        costPrice: product?.costPrice ?? 0,
        sellingPrice: product?.sellingPrice ?? 0,
        minStock: product?.minStock ?? 0,
        isTaxable: product?.isTaxable ?? true,
      });
    }
  }, [open, product, categories]);

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Nama produk wajib diisi");
      return;
    }
    if (!form.categoryId) {
      toast.error("Pilih kategori produk");
      return;
    }
    if (form.sellingPrice <= 0) {
      toast.error("Harga jual harus lebih dari 0");
      return;
    }
    setSaving(true);
    try {
      const payload: ProductPayload = {
        ...form,
        name: form.name.trim(),
        sku: form.sku?.trim() || undefined,
        barcode: form.barcode?.trim() || undefined,
        description: form.description?.trim() || undefined,
        costPrice: Math.round(Number(form.costPrice) || 0),
        sellingPrice: Math.round(Number(form.sellingPrice) || 0),
        minStock: Math.round(Number(form.minStock) || 0),
      };
      if (product) {
        await api.patch(`/products/${product.id}`, payload);
        toast.success("Produk diperbarui");
      } else {
        await api.post("/products", payload);
        toast.success("Produk ditambahkan");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan produk");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? "Edit Produk" : "Tambah Produk"}</DialogTitle>
          <DialogDescription>
            Harga dalam rupiah. Produk langsung bisa dijual setelah disimpan.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Nama Produk *</Label>
            <Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Kopi Susu" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kategori *</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Satuan</Label>
              <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-sku">SKU (opsional)</Label>
              <Input id="p-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="SKU-001" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-barcode">Barcode (opsional)</Label>
              <Input id="p-barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="899xxxxxxx" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Deskripsi (opsional)</Label>
            <Input id="p-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-cost">Harga Beli (Rp)</Label>
              <Input id="p-cost" type="number" min={0} value={form.costPrice || ""} onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-price">Harga Jual (Rp) *</Label>
              <Input id="p-price" type="number" min={0} value={form.sellingPrice || ""} onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-minstock">Stok Minimal (menipis)</Label>
              <Input id="p-minstock" type="number" min={0} value={form.minStock || ""} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch
                id="p-taxable"
                checked={form.isTaxable}
                onCheckedChange={(v) => setForm({ ...form, isTaxable: v })}
              />
              <Label htmlFor="p-taxable" className="text-sm font-normal">Kena PPN</Label>
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

// ===================== Stok Adjustment =====================
function StockAdjustDialog({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [delta, setDelta] = useState("0");
  const [type, setType] = useState<"purchase_in" | "adjustment">("purchase_in");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setDelta("0");
      setType("purchase_in");
      setReference("");
      setNote("");
    }
  }, [product]);

  const qty = Number(delta) || 0;
  const after = product ? Math.max(0, product.stockOnHand + qty) : 0;

  async function handleSave() {
    if (!product || qty === 0) {
      toast.error("Jumlah perubahan tidak boleh 0");
      return;
    }
    setSaving(true);
    try {
      const payload: StockAdjustPayload = {
        quantityDelta: qty,
        type,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      };
      await api.patch(`/products/${product.id}/stock`, payload);
      toast.success(`Stok ${product.name} diubah → ${formatNumber(after)} ${product.unit}`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal mengubah stok");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ubah Stok</DialogTitle>
          <DialogDescription>
            {product?.name} — stok saat ini {product ? `${formatNumber(product.stockOnHand)} ${product.unit}` : ""}
          </DialogDescription>
        </DialogHeader>
        {product && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Jenis</Label>
              <Select value={type} onValueChange={(v) => setType(v as "purchase_in" | "adjustment")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase_in">Pembelian (restock)</SelectItem>
                  <SelectItem value="adjustment">Penyesuaian (opname)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-delta">
                Perubahan (pakai minus untuk mengurangi) *
              </Label>
              <Input
                id="s-delta"
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="+10 atau -2"
              />
              <p className="text-xs text-muted-foreground">
                Stok setelah perubahan: <strong>{formatNumber(after)} {product.unit}</strong>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-ref">Referensi (opsional)</Label>
              <Input id="s-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO-001 / OPNAME-1" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-note">Catatan / alasan *</Label>
              <Input id="s-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Restok dari supplier / selisih opname" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleSave} disabled={saving || qty === 0}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
