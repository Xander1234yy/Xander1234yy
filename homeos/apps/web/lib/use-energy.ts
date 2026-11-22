"use client";

import { useEffect, useState } from "react";
import type { EnergyHistory, EnergyRange, EnergySummary } from "@homeos/shared";
import { api, connectorPath } from "./api";
import { useHome } from "./home-context";

export function useEnergySummary(intervalMs = 20_000) {
  const { connector } = useHome();
  const [data, setData] = useState<EnergySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (connector !== "online") return;
    let stop = false;
    const load = () =>
      api<EnergySummary>(connectorPath("v1/energy/summary"))
        .then((d) => !stop && (setData(d), setError(null)))
        .catch((e: Error) => !stop && setError(e.message));
    void load();
    const t = setInterval(load, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [connector, intervalMs]);
  return { data, error, live: connector === "online" && data !== null };
}

export function useEnergyHistory(range: EnergyRange) {
  const { connector } = useHome();
  const [data, setData] = useState<EnergyHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (connector !== "online") return;
    let stop = false;
    const load = () =>
      api<EnergyHistory>(connectorPath(`v1/energy/history?range=${range}`))
        .then((d) => !stop && (setData(d), setError(null)))
        .catch((e: Error) => !stop && setError(e.message));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [connector, range]);
  return { data, error };
}
