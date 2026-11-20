import type { LucideIcon } from "lucide-react";
import { Badge, Card } from "@homeos/ui";
import { PageHeader } from "./section";

/** Eerlijke weergave van onderdelen die in een latere fase gebouwd worden. Geen nep-functionaliteit. */
export function PhasePlaceholder({
  title,
  description,
  phase,
  icon: Icon,
  planned,
  requires,
}: {
  title: string;
  description: string;
  phase: number;
  icon: LucideIcon;
  planned: string[];
  requires?: string;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card className="p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
            <Icon className="size-7" />
          </div>
          <div className="flex-1">
            <Badge tone="accent">Gepland · fase {phase}</Badge>
            <h2 className="mt-3 text-lg font-semibold">Dit onderdeel wordt gebouwd in fase {phase}</h2>
            {requires && <p className="mt-1 text-sm text-muted">{requires}</p>}
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {planned.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-muted">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
