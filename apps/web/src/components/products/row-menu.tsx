"use client";

import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * RowMenu — menu ⋯ untuk aksi per baris (DESIGN §2: ⋯ = menu aksi).
 * - aria-label wajib: "Aksi {nama}" (a11y §6)
 * - Tombol ikon ≥ 40px di mobile via size-10 (touch target min 48px pada baris)
 */
export function RowMenu({
  label,
  items,
  className,
  align = "end",
}: {
  label: string;
  items: RowMenuItem[];
  className?: string;
  align?: "start" | "end" | "center";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-10", className)}
          aria-label={label}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44">
        {items.map((item, i) =>
          i > 0 && items[i - 1]?.danger !== item.danger && item.danger ? (
            <span key={i}>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={item.disabled}
                onClick={item.onClick}
                className={item.danger ? "text-danger focus:text-danger" : ""}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            </span>
          ) : (
            <DropdownMenuItem
              key={i}
              disabled={item.disabled}
              onClick={item.onClick}
              className={item.danger ? "text-danger focus:text-danger" : ""}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
