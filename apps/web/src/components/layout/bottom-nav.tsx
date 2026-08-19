"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShoppingCart,
  Package,
  BarChart3,
  Warehouse,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/pos", label: "Kasir", icon: ShoppingCart },
  { href: "/products", label: "Produk", icon: Package },
  { href: "/reports", label: "Laporan", icon: BarChart3 },
  { href: "/warehouses", label: "Stok", icon: Warehouse },
  { href: "/more", label: "Lainnya", icon: MoreHorizontal },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface-raised md:hidden">
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-w-[48px] min-h-[48px] rounded-lg px-2 py-1 transition-colors",
                isActive
                  ? "text-accent"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              <item.icon
                className={cn(
                  "h-5 w-5",
                  isActive && "fill-current"
                )}
              />
              <span className="text-[10px] font-medium leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
