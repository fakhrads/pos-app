"use client";

import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Tooltip help — ikon "?" untuk penjelasan inline
 * 
 * Setiap istilah keuangan/inventori punya ikon "?" kecil
 * → popover 1-2 kalimat + contoh angka
 */
export function TooltipHelp({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded-full p-0.5 text-text-muted hover:text-text-secondary transition-colors",
              "min-w-[20px] min-h-[20px]",
              className
            )}
          >
            <HelpCircle className="size-4" />
            <span className="sr-only">Bantuan</span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs text-sm bg-surface-raised border border-border text-text-primary"
        >
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Term with tooltip — istilah + penjelasan
 * 
 * Contoh:
 * <TermWithTooltip
 *   term="Modal Barang"
 *   technical="COGS"
 *   tooltip="Harga yang kamu bayar ke supplier untuk satu barang. Contoh: Indomie Goreng beli Rp 2.500/bungkus."
 * />
 */
export function TermWithTooltip({
  term,
  technical,
  tooltip,
}: {
  term: string;
  technical?: string;
  tooltip: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium">{term}</span>
      {technical && (
        <span className="text-xs text-text-muted">({technical})</span>
      )}
      <TooltipHelp content={tooltip} />
    </span>
  );
}
