import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  icon,
  hint,
  className,
}: {
  title: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight">
              {value}
            </p>
            {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
          </div>
          {icon && (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
