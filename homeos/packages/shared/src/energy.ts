import { z } from "zod";

const period = z.object({
  productionKwh: z.number().nullable(),
  consumptionKwh: z.number().nullable(),
  importKwh: z.number().nullable(),
  exportKwh: z.number().nullable(),
});
export type EnergyPeriod = z.infer<typeof period>;

/** null = niet beschikbaar bij deze bron. Nooit gokken. */
export const EnergySummarySchema = z.object({
  sourceId: z.string(),
  demo: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
  currentProductionW: z.number().nullable(),
  currentConsumptionW: z.number().nullable(),
  gridImportW: z.number().nullable(),
  gridExportW: z.number().nullable(),
  today: period,
  month: period,
  year: period,
});
export type EnergySummary = z.infer<typeof EnergySummarySchema>;

export const ENERGY_RANGES = ["day", "week", "month", "year"] as const;
export const EnergyRangeSchema = z.enum(ENERGY_RANGES);
export type EnergyRange = z.infer<typeof EnergyRangeSchema>;

export const EnergyPointSchema = z.object({
  t: z.iso.datetime({ offset: true }),
  productionKwh: z.number().nullable(),
  consumptionKwh: z.number().nullable(),
  importKwh: z.number().nullable(),
  exportKwh: z.number().nullable(),
});
export type EnergyPoint = z.infer<typeof EnergyPointSchema>;

export const EnergyHistorySchema = z.object({
  sourceId: z.string(),
  demo: z.boolean(),
  range: EnergyRangeSchema,
  bucket: z.enum(["15m", "hour", "day", "month"]),
  points: z.array(EnergyPointSchema),
});
export type EnergyHistory = z.infer<typeof EnergyHistorySchema>;

export interface EnergyTariff {
  /** € per kWh afname */
  importPerKwh: number;
  /** € per kWh teruglevering */
  exportPerKwh: number;
}

export const DEFAULT_TARIFF: EnergyTariff = { importPerKwh: 0.27, exportPerKwh: 0.07 };

export interface EnergyCost {
  importCost: number;
  exportCredit: number;
  net: number;
  /** Wat zelf verbruikte zonnestroom bespaarde t.o.v. afname. */
  selfConsumptionSaving: number;
  selfConsumptionKwh: number;
}

export function calculateCost(p: EnergyPeriod, tariff: EnergyTariff = DEFAULT_TARIFF): EnergyCost | null {
  if (p.importKwh == null || p.exportKwh == null) return null;
  const importCost = p.importKwh * tariff.importPerKwh;
  const exportCredit = p.exportKwh * tariff.exportPerKwh;
  const selfConsumptionKwh = p.productionKwh != null ? Math.max(0, p.productionKwh - p.exportKwh) : 0;
  return {
    importCost: round2(importCost),
    exportCredit: round2(exportCredit),
    net: round2(importCost - exportCredit),
    selfConsumptionKwh: round2(selfConsumptionKwh),
    selfConsumptionSaving: round2(selfConsumptionKwh * tariff.importPerKwh),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
