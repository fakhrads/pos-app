"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgePercent,
  BookOpenText,
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
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, ROLE_LABEL } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import type { Role } from "@/lib/types";
import { OnboardingWizard, useOnboardingPending } from "@/components/onboarding/onboarding-wizard";
import { PracticeModeBanner } from "@/components/onboarding/practice-mode-banner";
import { OfflineIndicator } from "@/components/offline-indicator";

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
  { href: "/warehouses", label: "Gudang", icon: Warehouse, roles: ["admin", "manager"] },
  { href: "/transactions", label: "Transaksi", icon: ClipboardList, roles: ["admin", "manager", "kasir"] },
  { href: "/customers", label: "Pelanggan", icon: Users, roles: ["admin", "manager", "kasir"] },
  { href: "/discounts", label: "Diskon", icon: BadgePercent, roles: ["admin", "manager"] },
  { href: "/reports", label: "Laporan", icon: FileBarChart2, roles: ["admin", "manager", "kasir"] },
  { href: "/glossary", label: "Glosarium", icon: BookOpenText, roles: ["admin", "manager", "kasir"] },
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
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-cyan-600">
          <Store className="size-4 text-background" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">FakhriPOS</p>
          <p className="text-[10px] text-muted-foreground">v0.1.0</p>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-smooth",
                  active
                    ? "bg-accent/12 text-accent"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {/* Active indicator bar */}
                {active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-accent" />
                )}
                <item.icon
                  className={cn(
                    "size-4 shrink-0 transition-smooth",
                    active
                      ? "text-accent"
                      : "text-muted-foreground group-hover:text-foreground"
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* User section */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback className="text-xs bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
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
            className="text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-smooth"
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

  // Onboarding wizard — tampil sekali saat pertama kali buka
  const onboardingPending = useOnboardingPending();
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (onboardingPending) setWizardOpen(true);
  }, [onboardingPending]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar md:block">
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
        <SheetContent side="left" className="w-64 p-0 border-border bg-sidebar">
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1">
        {/* Badge status offline (selalu di kanan atas, tersedia di semua halaman) */}
        <div className="pointer-events-none fixed right-3 top-3 z-40 flex items-center gap-2">
          <div className="pointer-events-auto">
            <OfflineIndicator />
          </div>
        </div>
        {/* Banner Mode Latihan (RC-03) */}
        <PracticeModeBanner />
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

      {/* Onboarding Wizard — full-screen, pertama kali */}
      <OnboardingWizard
        open={wizardOpen}
        onComplete={() => setWizardOpen(false)}
      />
    </div>
  );
}
