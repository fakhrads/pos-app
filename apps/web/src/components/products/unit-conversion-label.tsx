import { cn, formatNumber } from "@/lib/utils";

/**
 * UnitConversionLabel — format "1 dus = 40 pcs" (DESIGN Fase 2 §3).
 * Satu format di semua permukaan: mono + text-secondary (kontras 5.8:1).
 */
export function UnitConversionLabel({
  unit,
  factor,
  baseUnit,
  className,
}: {
  unit: string;
  factor: number;
  baseUnit: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-sm tabular-nums text-text-secondary",
        className
      )}
    >
      1 {unit} = {formatNumber(factor)} {baseUnit}
    </span>
  );
}
