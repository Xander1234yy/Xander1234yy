import { CloudOff } from "lucide-react";
import { Card } from "@homeos/ui";
import { PageHeader } from "./section";

/** Getoond in lokale modus (zonder Supabase) bij onderdelen die een account en database nodig hebben. */
export function NeedsAccount({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:p-8">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
          <CloudOff className="size-6" />
        </div>
        <div>
          <h2 className="font-semibold">Hiervoor zijn HomeOS-accounts nodig</h2>
          <p className="mt-1 text-sm text-muted">
            Deze gegevens worden per huishouden in Supabase opgeslagen en beveiligd. HomeOS draait nu in de lokale modus zonder accounts.
            Koppel Supabase via <code className="text-fg">SUPABASE_URL</code> en <code className="text-fg">SUPABASE_PUBLISHABLE_KEY</code> (zie docs/supabase.md).
          </p>
        </div>
      </Card>
    </div>
  );
}
