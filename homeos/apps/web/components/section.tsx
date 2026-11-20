import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card, cn } from "@homeos/ui";

export function SectionCard({
  title,
  description,
  icon: Icon,
  href,
  action,
  className,
  children,
  testId,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card className={cn("flex h-full animate-fade-up flex-col", className)} data-testid={testId}>
      <div className="flex items-start gap-3 px-5 pt-5 sm:px-6">
        {Icon && (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.04] text-accent">
            <Icon className="size-[18px]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action}
        {href && (
          <Link href={href} className="flex size-8 items-center justify-center rounded-full text-muted transition hover:bg-white/[0.06] hover:text-fg" aria-label={`Naar ${title}`}>
            <ArrowUpRight className="size-4" />
          </Link>
        )}
      </div>
      <div className="flex-1 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">{children}</div>
    </Card>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular tracking-tight sm:text-2xl" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
      <Icon className="size-6 text-muted" />
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-xs text-muted">{children}</div>}
    </div>
  );
}
