import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatCardVariant = "default" | "accent" | "success" | "warning" | "destructive";

const variantStyles: Record<StatCardVariant, { iconBg: string; iconText: string }> = {
  default: {
    iconBg: "bg-muted",
    iconText: "text-muted-foreground",
  },
  accent: {
    iconBg: "bg-accent-muted",
    iconText: "text-accent",
  },
  success: {
    iconBg: "bg-success-muted",
    iconText: "text-success",
  },
  warning: {
    iconBg: "bg-warning-muted",
    iconText: "text-warning",
  },
  destructive: {
    iconBg: "bg-destructive/10",
    iconText: "text-destructive",
  },
};

export function StatCard({
  title,
  value,
  icon,
  hint,
  variant = "default",
  className,
}: {
  title: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  variant?: StatCardVariant;
  className?: string;
}) {
  const styles = variantStyles[variant];

  return (
    <div
      className={cn(
        "bg-card rounded-xl border border-border p-5 card-hover transition-smooth",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {icon && (
          <div
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
              styles.iconBg
            )}
          >
            <span className={cn("w-4 h-4", styles.iconText)}>{icon}</span>
          </div>
        )}
      </div>
      <p className="text-2xl font-bold stat-number">{value}</p>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
