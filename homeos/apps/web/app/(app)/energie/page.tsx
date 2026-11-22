"use client";

import { useEffect, useState } from "react";
import { Lightbulb, PiggyBank, Sun, Zap } from "lucide-react";
import { Badge, Card, Input, cn } from "@homeos/ui";
import { calculateCost, DEFAULT_TARIFF, type EnergyPeriod, type EnergyRange, type EnergyTariff } from "@homeos/shared";
import { EnergyChart } from "@/components/charts/energy-chart";
import { PageHeader, SectionCard, Stat, EmptyState } from "@/components/section";
import { useEnergyHistory, useEnergySummary } from "@/lib/use-energy";
import { formatEuro, formatKwh, formatTime, formatW } from "@/lib/format";

const RANGES: [EnergyRange, string][] = [
  ["day", "Vandaag"],
  ["week", "Week"],
  ["month", "30 dagen"],
  ["year", "Dit jaar"],
];
const TARIFF_KEY = "homeos:tariff:v1";

function sumPoints(points: { productionKwh: number | null; consumptionKwh: number | null; importKwh: number | null; exportKwh: number | null }[]): EnergyPeriod {
  const s = (k: keyof EnergyPeriod) => points.reduce((a, p) => a + (p[k] ?? 0), 0);
  return { productionKwh: s("productionKwh"), consumptionKwh: s("consumptionKwh"), importKwh: s("importKwh"), exportKwh: s("exportKwh") };
}

export default function EnergyPage() {
  const { data: summary, live, error } = useEnergySummary(15_000);
  const [range, setRange] = useState<EnergyRange>("day");
  const { data: history } = useEnergyHistory(range);
  const [tariff, setTariff] = useState<EnergyTariff>(DEFAULT_TARIFF);

  useEffect(() => {
    try {
      const t = JSON.parse(localStorage.getItem(TARIFF_KEY) ?? "null") as EnergyTariff | null;
      if (t && typeof t.importPerKwh === "number") setTariff(t);
    } catch {
      /* standaard */
    }
  }, []);
  const updateTariff = (t: EnergyTariff) => {
    setTariff(t);
    localStorage.setItem(TARIFF_KEY, JSON.stringify(t));
  };

  const period = history ? sumPoints(history.points) : null;
  const cost = period ? calculateCost(period, tariff) : null;
  const selfRate = period && period.productionKwh ? Math.max(0, 1 - (period.exportKwh ?? 0) / period.productionKwh) : null;
  const autarky = period && period.consumptionKwh ? Math.max(0, 1 - (period.importKwh ?? 0) / period.consumptionKwh) : null;

  if (!summary && error) {
    return (
      <div>
        <PageHeader title="Energie" />
        <EmptyState icon={Zap} title="Geen energiegegevens">{error}</EmptyState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Energie"
        description={summary ? `${live ? "Live" : "Laatst bekend"} · bijgewerkt ${formatTime(summary.updatedAt)}` : "Gegevens laden…"}
        actions={summary?.demo ? <Badge tone="demo">Demo-gegevens</Badge> : undefined}
      />

      {summary && (
        <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", !live && "opacity-60")}>
          <Card className="p-5">
            <Stat label="Zonne-opwek nu" value={formatW(summary.currentProductionW)} accent="var(--color-solar)" sub={`Vandaag ${formatKwh(summary.today.productionKwh)}`} />
          </Card>
          {summary.gridImportW == null && summary.currentConsumptionW == null ? (
            <Card className="p-5 sm:col-span-2 lg:col-span-3">
              <Stat label="Verbruik en net" value="Niet gemeten" sub="Er is geen meter gekoppeld. Koppel je Zonneplan Connect bij Instellingen om verbruik en teruglevering te zien." />
            </Card>
          ) : (
          <>
          <Card className="p-5">
            <Stat label="Verbruik nu" value={formatW(summary.currentConsumptionW)} sub={`Vandaag ${formatKwh(summary.today.consumptionKwh)}`} />
          </Card>
          <Card className="p-5">
            <Stat label="Netafname nu" value={formatW(summary.gridImportW)} accent="var(--color-grid)" sub={`Vandaag ${formatKwh(summary.today.importKwh)}`} />
          </Card>
          <Card className="p-5">
            <Stat label="Teruglevering nu" value={formatW(summary.gridExportW)} accent="var(--color-success)" sub={`Vandaag ${formatKwh(summary.today.exportKwh)}`} />
          </Card>
          </>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-12">
        <SectionCard
          title="Historie"
          icon={Sun}
          className="lg:col-span-8"
          action={
            <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
              {RANGES.map(([k, l]) => (
                <button key={k} onClick={() => setRange(k)} aria-pressed={range === k} className={cn("rounded-lg px-2.5 py-1 text-xs transition", range === k ? "bg-accent text-white" : "text-muted hover:text-fg")}>
                  {l}
                </button>
              ))}
            </div>
          }
        >
          {history ? (
            <EnergyChart
              history={history}
              height={260}
              series={
                range === "day"
                  ? undefined
                  : [
                      { key: "productionKwh", label: "Opwek", color: "var(--color-solar)" },
                      { key: "consumptionKwh", label: "Verbruik", color: "var(--color-accent)" },
                      { key: "exportKwh", label: "Teruglevering", color: "var(--color-success)" },
                    ]
              }
            />
          ) : (
            <p className="py-16 text-center text-sm text-muted">Laden…</p>
          )}
          {period && (
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/[0.06] pt-4 sm:grid-cols-4">
              <Stat label="Opgewekt" value={formatKwh(period.productionKwh)} />
              <Stat label="Verbruikt" value={formatKwh(period.consumptionKwh)} />
              <Stat label="Afgenomen" value={formatKwh(period.importKwh)} />
              <Stat label="Teruggeleverd" value={formatKwh(period.exportKwh)} />
            </div>
          )}
        </SectionCard>

        <div className="space-y-5 lg:col-span-4">
          <SectionCard title="Kosten" description={`Periode: ${RANGES.find(([k]) => k === range)?.[1]}`} icon={PiggyBank}>
            {cost ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Afname</dt><dd className="tabular">{formatEuro(cost.importCost)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Terugleververgoeding</dt><dd className="tabular text-success">− {formatEuro(cost.exportCredit)}</dd></div>
                <div className="flex justify-between border-t border-white/[0.06] pt-2 font-semibold"><dt>Netto</dt><dd className="tabular">{formatEuro(cost.net)}</dd></div>
                <div className="flex justify-between text-xs"><dt className="text-muted">Bespaard door eigen verbruik</dt><dd className="tabular text-success">{formatEuro(cost.selfConsumptionSaving)}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-muted">
                Voor een kostenberekening zijn netafname en teruglevering nodig. Die meet je met een slimme meter (P1) of een SolarEdge-energiemeter; zonder meter schat HomeOS niets.
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">
                € per kWh afname
                <Input type="number" step="0.01" min="0" max="2" value={tariff.importPerKwh} onChange={(e) => updateTariff({ ...tariff, importPerKwh: Number(e.target.value) || 0 })} className="mt-1" />
              </label>
              <label className="text-[11px] text-muted">
                € per kWh teruglevering
                <Input type="number" step="0.01" min="0" max="2" value={tariff.exportPerKwh} onChange={(e) => updateTariff({ ...tariff, exportPerKwh: Number(e.target.value) || 0 })} className="mt-1" />
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Inzichten" icon={Lightbulb}>
            <ul className="space-y-3 text-sm">
              {selfRate != null && (
                <li>
                  <p className="font-medium">{Math.round(selfRate * 100)}% eigen verbruik</p>
                  <p className="text-xs text-muted">Deel van de opgewekte stroom dat je zelf gebruikte. {selfRate < 0.4 ? "Verschuif apparaten zoals de wasmachine naar zonnige uren om meer zelf te gebruiken." : "Mooi: je benut je zonnestroom goed."}</p>
                </li>
              )}
              {autarky != null && (
                <li>
                  <p className="font-medium">{Math.round(autarky * 100)}% zelfvoorzienend</p>
                  <p className="text-xs text-muted">Deel van je verbruik dat niet van het net kwam.</p>
                </li>
              )}
              {summary && (
                <li>
                  <p className="font-medium">{formatKwh(summary.year.productionKwh, 0)} opgewekt dit jaar</p>
                  <p className="text-xs text-muted">Maand tot nu toe: {formatKwh(summary.month.productionKwh, 0)}.</p>
                </li>
              )}
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
