"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgePercent,
  Boxes,
  ClipboardList,
  FileBarChart2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShoppingCart,
  Store,
  Tags,
  UserCircle2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, ROLE_LABEL } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/pos", label: "Kasir", icon: ShoppingCart, roles: ["admin", "manager", "kasir"] },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "manager"] },
  { href: "/products", label: "Produk", icon: Boxes, roles: ["admin", "manager", "kasir"] },
  { href: "/categories", label: "Kategori", icon: Tags, roles: ["admin", "manager"] },
  { href: "/transactions", label: "Transaksi", icon: ClipboardList, roles: ["admin", "manager", "kasir"] },
  { href: "/customers", label: "Pelanggan", icon: Users, roles: ["admin", "manager", "kasir"] },
  { href: "/discounts", label: "Diskon", icon: BadgePercent, roles: ["admin", "manager"] },
  { href: "/reports", label: "Laporan", icon: FileBarChart2, roles: ["admin", "manager", "kasir"] },
  { href: "/profile", label: "Profil", icon: UserCircle2, roles: ["admin", "manager", "kasir"] },
  { href: "/users", label: "Pengguna", icon: UserCircle2, roles: ["admin"] },
  { href: "/settings", label: "Pengaturan", icon: Settings, roles: ["admin"] },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();

  const items = NAV_ITEMS.filter((i) => user && i.roles.includes(user.role));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Store className="size-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">FakhriPOS</p>
          <p className="text-[11px] text-muted-foreground">Point of Sales</p>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3">
        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
                )}
              >
                <item.icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="border-t px-3 py-3">
        <div className="flex items-center gap-3 px-1 py-1">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs">
              {user?.name?.slice(0, 2).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {user ? ROLE_LABEL[user.role] : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="Keluar"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { logout } = useAuth();
  const router = useRouter();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar desktop */}
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar md:block">
        <SidebarContent />
      </aside>

      {/* Sidebar mobile */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="fixed left-3 top-3 z-40 md:hidden"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1">
        <div className="p-4 md:p-6">
          <div className="mb-4 flex items-center justify-between md:hidden">
            <span className="text-sm font-semibold">FakhriPOS</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
            >
              Keluar
            </Button>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
