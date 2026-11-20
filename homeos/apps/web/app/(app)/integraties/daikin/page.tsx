import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Card } from "@homeos/ui";
import { connectorFetch } from "@/lib/server/connector-client";
import { assertConnectorLinked, authorize, writeAudit } from "@/lib/server/authz";

export const metadata: Metadata = { title: "Daikin koppelen" };
export const dynamic = "force-dynamic";

/**
 * Terugkeerpagina voor de Daikin-aanmelding als HomeOS op een https-adres draait.
 * Rondt de koppeling server-side af in de connector (state-controle gebeurt daar).
 */
export default async function DaikinCallback({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let message = "Geen autorisatiecode ontvangen.";
  let ok = false;
  const auth = await authorize("manage_devices");
  if (!auth.ok) message = "Alleen beheerders kunnen Daikin koppelen.";
  else if (await assertConnectorLinked(auth.ctx)) message = "De connector is niet bereikbaar of niet gekoppeld.";
  else if (sp.code && sp.state) {
    const h = await headers();
    const base = process.env.HOMEOS_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const callbackUrl = `${base.replace(/\/$/, "")}/integraties/daikin?${new URLSearchParams({ code: sp.code, state: sp.state }).toString()}`;
    try {
      const res = await connectorFetch("/v1/integrations/daikin/complete", { method: "POST", body: JSON.stringify({ callbackUrl }) });
      ok = res.ok;
      message = ok ? "Daikin is gekoppeld. Je airco's verschijnen bij Apparaten." : ((await res.json()) as { error: { message: string } }).error.message;
    } catch {
      message = "De connector is niet bereikbaar.";
    }
    await writeAudit(auth.ctx, { action: "integration.daikin.complete", ok });
  } else if (sp.error) message = `Daikin meldde: ${sp.error_description ?? sp.error}`;
  return (
    <Card className="mx-auto max-w-lg p-6">
      <h1 className="text-lg font-semibold">{ok ? "Gelukt" : "Koppelen niet gelukt"}</h1>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <Link href="/instellingen" className="mt-4 inline-block text-sm text-accent hover:underline">
        Naar instellingen
      </Link>
    </Card>
  );
}
