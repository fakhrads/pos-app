"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, Loader2, Pencil, Plus, Search, Star, UserPlus } from "lucide-react";
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
import { debounce, formatNumber } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Customer, Paginated } from "@/lib/types";

export default function CustomersPage() {
  const { isManager } = useAuth();
  const [items, setItems] = useState<Customer[]>([]);
  const [meta, setMeta] = useState<Paginated<Customer>["meta"] | undefined>();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Paginated<Customer>>("/customers", {
        q: q || undefined,
        page,
        perPage: 20,
      });
      setItems(data.items);
      setMeta(data.meta);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memuat pelanggan");
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

  function openCreate() {
    setEditing(null);
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setFormOpen(true);
  }

  function openEdit(c: Customer) {
    setEditing(c);
    setName(c.name);
    setPhone(c.phone ?? "");
    setEmail(c.email ?? "");
    setAddress(c.address ?? "");
    setFormOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Nama pelanggan wajib diisi");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
      };
      if (editing) {
        await api.patch(`/customers/${editing.id}`, payload);
        toast.success("Pelanggan diperbarui");
      } else {
        await api.post("/customers", payload);
        toast.success("Pelanggan ditambahkan");
      }
      setFormOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal menyimpan pelanggan");
    } finally {
      setSaving(false);
    }
  }

  async function makeMember(c: Customer) {
    setMemberBusy(c.id);
    try {
      await api.post("/memberships", { customerId: c.id });
      toast.success(`${c.name} sekarang member`);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal membuat member");
    } finally {
      setMemberBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Pelanggan"
        description="Daftar pelanggan, member, dan saldo poin."
        actions={
          <Button onClick={openCreate}>
            <UserPlus className="size-4" /> Tambah Pelanggan
          </Button>
        }
      />

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nama / no HP…"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Pelanggan tidak ditemukan"
            description="Tambahkan pelanggan baru, atau pelanggan bisa dibuat langsung dari layar kasir."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" /> Tambah Pelanggan
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="hidden md:table-cell">No. HP</TableHead>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Poin</TableHead>
                <TableHead className="w-28 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {c.phone ?? "-"}
                  </TableCell>
                  <TableCell>
                    {c.membership ? (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {c.membership.memberCode} · {c.membership.tier}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Bukan member</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.membership ? formatNumber(c.membership.pointsBalance) : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {isManager && !c.membership && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Jadikan member"
                          disabled={memberBusy === c.id}
                          onClick={() => makeMember(c)}
                        >
                          {memberBusy === c.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Star className="size-4" />
                          )}
                        </Button>
                      )}
                      {isManager && (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(c)}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="size-8" asChild>
                        <Link href={`/customers/${c.id}`} title="Detail">
                          <Eye className="size-4" />
                        </Link>
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

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Pelanggan" : "Tambah Pelanggan"}</DialogTitle>
            <DialogDescription>
              No. HP dipakai untuk pencarian & keunikan member.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Nama *</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="c-phone">No. HP</Label>
                <Input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-address">Alamat</Label>
              <Input id="c-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
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
    </>
  );
}
