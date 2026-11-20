"use client";

import { FlaskConical, OctagonPause, PlugZap, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@homeos/ui";
import { useHome } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

const REASONS: Record<string, string> = {
  no_token: "De webapp heeft geen connector-token. Start de connector (npm run dev) of stel HOMEOS_CONNECTOR_TOKEN in.",
  unreachable: "De HomeOS Device Connector is niet bereikbaar. Staat de laptop aan en draait de connector?",
  closed: "De verbinding met de connector is verbroken.",
  connector_not_linked: "Er is nog geen connector aan dit huishouden gekoppeld. Een beheerder kan dat doen via Instellingen.",
  connector_mismatch: "De bereikbare connector hoort niet bij dit huishouden. Controleer de koppeling in Instellingen.",
  forbidden: "Je rol heeft geen toegang tot de apparaten.",
};

/** Systeembrede meldingen: connector offline, noodstop, demo-modus. */
export function StatusBanner() {
  const { connector, connectorReason, lastSync, snapshot, fromCache, setEmergencyStop } = useHome();
  const offline = connector === "offline";
  return (
    <div className="space-y-2">
      {offline && (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-danger/30 bg-danger/[0.08] px-4 py-3 text-sm sm:flex-row sm:items-center" data-testid="connector-offline">
          <PlugZap className="size-5 shrink-0 text-danger" />
          <div className="flex-1">
            <p className="font-medium text-fg">
              {connectorReason?.startsWith("connector_") ? "Connector niet gekoppeld" : "Connector offline — lokale bediening en automatiseringen zijn gepauzeerd"}
            </p>
            <p className="text-xs text-muted">
              {REASONS[connectorReason ?? "unreachable"] ?? REASONS.unreachable} Laatste synchronisatie: {formatDateTime(lastSync)}. Getoonde gegevens zijn niet live.
            </p>
          </div>
          {connectorReason?.startsWith("connector_") ? (
            <Button size="sm" variant="secondary" asChild>
              <Link href="/instellingen">Naar instellingen</Link>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => location.reload()}>
              <RefreshCw /> Opnieuw proberen
            </Button>
          )}
        </div>
      )}
      {!offline && fromCache && (
        <div className="flex items-center gap-2 rounded-2xl border border-warning/25 bg-warning/[0.06] px-4 py-2.5 text-xs text-muted">
          <RefreshCw className="size-4 animate-spin text-warning" /> Verbinden met connector… Je ziet de laatst bekende gegevens van {formatDateTime(lastSync)}.
        </div>
      )}
      {snapshot?.connector.emergencyStop && (
        <div className="flex flex-col gap-2 rounded-2xl border border-warning/30 bg-warning/[0.08] px-4 py-3 text-sm sm:flex-row sm:items-center">
          <OctagonPause className="size-5 shrink-0 text-warning" />
          <p className="flex-1 text-fg">
            Noodstop actief: automatiseringen en Jarvis-opdrachten zijn gepauzeerd. Handmatige bediening werkt wel.
          </p>
          <Button size="sm" variant="secondary" onClick={() => void setEmergencyStop(false)}>
            Noodstop opheffen
          </Button>
        </div>
      )}
      {snapshot?.connector.demoMode && (
        <div className="flex items-center gap-2 rounded-2xl border border-demo/25 bg-demo/[0.06] px-4 py-2 text-xs text-muted" data-testid="demo-banner">
          <FlaskConical className="size-4 text-demo" />
          <span>
            <strong className="font-semibold text-demo">DEMO-modus</strong> — alle apparaten en gegevens zijn gesimuleerd. Er worden geen echte apparaten bediend.
          </span>
        </div>
      )}
    </div>
  );
}
