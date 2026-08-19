"use client";

import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { searchGlossary } from "@/data/glossary";

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

/**
 * Cari entri glosarium dan tampilkan tooltip-nya. Fallback bila tidak ditemukan
 * sesuai kasus tepi SPEC §7.5.
 */
export function GlossaryTooltip({
  term,
  className,
}: {
  term: string;
  className?: string;
}) {
  const match = searchGlossary(term)[0];
  const content = match
    ? `${match.term} — ${match.definition} Contoh: ${match.example}`
    : "Istilah ini belum tersedia.";
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium">{term}</span>
      <TooltipHelp content={content} className={className} />
    </span>
  );
}

/**
 * Label form + ikon "?" — taruh di sebelah label yang pakai istilah teknis.
 * Memakai Label dari ui/label dan TooltipHelp inline.
 */
export function LabelWithTooltip({
  label,
  tooltip,
  htmlFor,
}: {
  label: string;
  tooltip: string;
  htmlFor?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
      </Label>
      <TooltipHelp content={tooltip} />
    </span>
  );
}
