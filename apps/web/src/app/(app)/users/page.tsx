"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Pencil, Plus, UserPlus, UserX } from "lucide-react";
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
import { AdminOnly } from "@/components/role-guard";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, ROLE_LABEL } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Paginated, Role, User } from "@/lib/types";

export default function UsersPage() {
  const { user: me } = useAuth();
  const [items, setItems] = useState<User[]>([]);
  const [meta, setMeta] = useState<Paginated<User>["meta"] | undefined>();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState<User | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<User>>("/users", { page, perPage: 20 });
      setItems(data.items);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat pengguna");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await api.delete(`/users/${deactivating.id}`);
      toast.success("Pengguna dinonaktifkan");
      setDeactivating(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menonaktifkan pengguna");
    }
  }

  return (
    <AdminOnly>
      <PageHeader
        title="Pengguna"
        description="Kelola akun & role (admin / manager / kasir)."
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <UserPlus className="size-4" /> Tambah Pengguna
          </Button>
        }
      />

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<UserPlus className="size-7" />}
            title="Belum ada pengguna"
            description="Tambahkan kasir atau manajer untuk mengelola akses aplikasi."
            action={
              <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <UserPlus className="size-4" /> Tambah Pengguna
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden lg:table-cell">Login Terakhir</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="w-32 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.name}
                    {u.id === me?.id && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">Anda</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : u.role === "manager" ? "secondary" : "outline"}>
                      {ROLE_LABEL[u.role]}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Belum pernah"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={u.isActive ? "default" : "destructive"}>
                      {u.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Reset password"
                        disabled={u.id === me?.id}
                        onClick={() => setResetting(u)}
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Edit"
                        onClick={() => { setEditing(u); setFormOpen(true); }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        title="Nonaktifkan"
                        disabled={u.id === me?.id}
                        onClick={() => setDeactivating(u)}
                      >
                        <UserX className="size-4" />
                      </Button>
                    </div>
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

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editing}
        onSaved={() => { setFormOpen(false); load(); }}
      />

      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onDone={() => { setResetting(null); toast.success("Password berhasil di-reset"); }} />

      <AlertDialog open={!!deactivating} onOpenChange={(open) => !open && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan pengguna?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deactivating?.name}" tidak akan bisa login lagi sampai diaktifkan kembali.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="bg-destructive text-destructive-foreground">
              Nonaktifkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminOnly>
  );
}

function UserFormDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("kasir");
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setRole(user?.role ?? "kasir");
      setPassword("");
      setIsActive(user?.isActive ?? true);
    }
  }, [open, user]);

  async function handleSave() {
    if (!name.trim() || !email.trim()) {
      toast.error("Nama dan email wajib diisi");
      return;
    }
    if (!user && password.length < 8) {
      toast.error("Password awal minimal 8 karakter");
      return;
    }
    setSaving(true);
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, {
          name: name.trim(),
          email: email.trim(),
          role,
          isActive,
        });
        toast.success("Pengguna diperbarui");
      } else {
        await api.post("/users", {
          name: name.trim(),
          email: email.trim(),
          role,
          password,
        });
        toast.success("Pengguna dibuat");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan pengguna");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? "Edit Pengguna" : "Tambah Pengguna"}</DialogTitle>
          <DialogDescription>
            {user
              ? "Ubah nama, email, role, atau status."
              : "Pengguna baru langsung bisa login dengan password awal."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Nama *</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email *</Label>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="kasir">Kasir</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {user ? (
              <div className="flex items-end gap-2 pb-1">
                <Switch id="u-active" checked={isActive} onCheckedChange={setIsActive} />
                <Label htmlFor="u-active" className="text-sm font-normal">Aktif</Label>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="u-pass">Password awal *</Label>
                <Input id="u-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 karakter" />
              </div>
            )}
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

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: User | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setPassword("");
  }, [user]);

  async function handleReset() {
    if (!user || password.length < 8) {
      toast.error("Password baru minimal 8 karakter");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { newPassword: password });
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal reset password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            Password baru untuk {user?.name}. Semua sesi pengguna ini akan di-revoke.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rp-pass">Password baru *</Label>
          <Input id="rp-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 karakter" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleReset} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
