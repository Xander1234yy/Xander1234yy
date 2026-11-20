"use client";

import { ArrowDownLeft, ArrowUpRight, Zap } from "lucide-react";
import { Badge } from "@homeos/ui";
import type { EnergySummary } from "@homeos/shared";
import { EnergyChart } from "@/components/charts/energy-chart";
import { SectionCard, Stat } from "@/components/section";
import { useEnergyHistory } from "@/lib/use-energy";
import { formatKwh, formatTime, formatW } from "@/lib/format";

export function EnergyCard({ energy, live }: { energy: EnergySummary | null; live: boolean }) {
  const { data: history } = useEnergyHistory("day");
  const exporting = (energy?.gridExportW ?? 0) > 0;
  return (
    <SectionCard
      title="Energie"
      description={energy ? `${live ? "Bijgewerkt" : "Laatst bekend"} ${formatTime(energy.updatedAt)}` : "Geen energiebron gekoppeld"}
      icon={Zap}
      href="/energie"
      action={energy?.demo ? <Badge tone="demo">Demo</Badge> : undefined}
      testId="energy-card"
    >
      {!energy ? (
        <p className="text-sm text-muted">Koppel zonnepanelen of een slimme meter om energiegegevens te zien.</p>
      ) : (
        <div className={live ? "" : "opacity-60"}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Opwek nu" value={formatW(energy.currentProductionW)} accent="var(--color-solar)" sub={`Vandaag ${formatKwh(energy.today.productionKwh)}`} />
            <Stat label="Verbruik nu" value={formatW(energy.currentConsumptionW)} sub={energy.currentConsumptionW == null ? "Geen meter gekoppeld" : `Vandaag ${formatKwh(energy.today.consumptionKwh)}`} />
            {energy.gridImportW == null && energy.gridExportW == null ? (
              <Stat label="Net" value="—" sub="Geen meter gekoppeld" />
            ) : (
            <Stat
              label={exporting ? "Teruglevering" : "Netafname"}
              value={
                <span className="inline-flex items-center gap-1">
                  {exporting ? <ArrowUpRight className="size-5 text-success" /> : <ArrowDownLeft className="size-5 text-grid" />}
                  {formatW(exporting ? energy.gridExportW : energy.gridImportW)}
                </span>
              }
              sub={`Vandaag ${formatKwh(exporting ? energy.today.exportKwh : energy.today.importKwh)}`}
            />
            )}
            <Stat label="Deze maand" value={formatKwh(energy.month.productionKwh, 0)} sub="opgewekt" />
          </div>
          {history && (
            <div className="mt-5">
              <EnergyChart history={history} height={180} />
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
