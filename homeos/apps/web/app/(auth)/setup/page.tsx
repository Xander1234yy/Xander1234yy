import type { Metadata } from "next";
import { Card } from "@homeos/ui";

export const metadata: Metadata = { title: "Configuratie vereist" };

export default function SetupPage() {
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Configuratie vereist</h1>
      <p className="mt-2 text-sm text-muted">
        Deze productie-installatie van HomeOS heeft nog geen Supabase-koppeling. Zonder accounts wordt de app uit veiligheidsoverwegingen niet geopend.
      </p>
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted">
        <li>Maak een Supabase-project aan.</li>
        <li>Voer de migraties uit: <code className="text-fg">npm run db:migrate</code>.</li>
        <li>Zet <code className="text-fg">SUPABASE_URL</code> en <code className="text-fg">SUPABASE_PUBLISHABLE_KEY</code> als server-side omgevingsvariabelen.</li>
      </ol>
      <p className="mt-4 text-xs text-muted">Zie docs/supabase.md voor de volledige instructies.</p>
    </Card>
  );
}
