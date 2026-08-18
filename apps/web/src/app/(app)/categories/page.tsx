"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { ManagerOnly } from "@/components/role-guard";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import type { Category } from "@/lib/types";

export default function CategoriesPage() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: Category[] }>("/categories");
      setItems(data.items);
    } catch {
      toast.error("Gagal memuat kategori");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setName("");
    setFormOpen(true);
  }

  function openEdit(c: Category) {
    setEditing(c);
    setName(c.name);
    setFormOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Nama kategori wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/categories/${editing.id}`, { name: name.trim() });
        toast.success("Kategori diperbarui");
      } else {
        await api.post("/categories", { name: name.trim() });
        toast.success("Kategori ditambahkan");
      }
      setFormOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan kategori");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/categories/${deleting.id}`);
      toast.success("Kategori dihapus");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menghapus kategori");
    }
  }

  return (
    <ManagerOnly>
      <PageHeader
        title="Kategori"
        description="Kategori 1 level — setiap produk wajib memiliki kategori."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Tambah Kategori
          </Button>
        }
      />

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Belum ada kategori"
            description="Buat kategori pertama, misalnya Makanan, Minuman, Snack."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" /> Tambah Kategori
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="hidden md:table-cell">Slug</TableHead>
                <TableHead className="hidden md:table-cell">Urutan</TableHead>
                <TableHead className="w-28 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell">
                    {c.slug}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.sortOrder}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(c)}>
                        <Pencil className="size-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Kategori" : "Tambah Kategori"}</DialogTitle>
            <DialogDescription>Nama kategori baru akan langsung tersedia saat menambah produk.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Nama Kategori *</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Makanan" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Batal</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus kategori?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.name}" akan dinonaktifkan. Produk di dalamnya tetap utuh.
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
    </ManagerOnly>
  );
}
