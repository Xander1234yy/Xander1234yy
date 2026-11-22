"use client";

import { useEffect, useState } from "react";
import { Bot, Workflow } from "lucide-react";
import { api, connectorPath } from "@/lib/api";
import { SectionCard } from "@/components/section";
import { JarvisChat } from "@/components/jarvis-chat";
import { useHome } from "@/lib/home-context";

export function JarvisCard() {
  return (
    <SectionCard title="Jarvis" description="Lokale assistent · zonder AI-provider" icon={Bot} href="/jarvis" testId="jarvis-card">
      <JarvisChat compact />
    </SectionCard>
  );
}

export function AutomationsCard() {
  const { snapshot, connector, runTick } = useHome();
  const stop = snapshot?.connector.emergencyStop;
  const [data, setData] = useState<{ automations: { id: string; name: string; enabled: boolean; trigger: { type: string; at?: string } }[]; runs: { id: string; automationName: string; status: string; startedAt: string }[] } | null>(null);
  useEffect(() => {
    if (connector !== "online") return;
    Promise.all([api<{ automations: never[] }>(connectorPath("v1/automations")), api<{ runs: never[] }>(connectorPath("v1/automations/runs?limit=3"))])
      .then(([a, r]) => setData({ automations: a.automations, runs: r.runs }))
      .catch(() => undefined);
  }, [connector, runTick]);
  const active = data?.automations.filter((a) => a.enabled) ?? [];
  const next = active
    .filter((a) => a.trigger.type === "time" && a.trigger.at)
    .map((a) => ({ name: a.name, at: a.trigger.at! }))
    .sort((x, y) => {
      const nowHm = new Date().toTimeString().slice(0, 5);
      const k = (t: string) => (t > nowHm ? t : `1${t}`);
      return k(x.at).localeCompare(k(y.at));
    })[0];
  return (
    <SectionCard title="Automatiseringen" description={data ? `${active.length} actief van ${data.automations.length}` : undefined} icon={Workflow} href="/automatiseringen" testId="automations-card">
      {!data ? (
        <p className="text-sm text-muted">{connector === "online" ? "Laden…" : "Gepauzeerd: de connector is offline."}</p>
      ) : data.automations.length === 0 ? (
        <p className="text-sm text-muted">Nog geen automatiseringen. Begin met een sjabloon zoals Avondmodus.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {next && (
            <p>
              <span className="text-muted">Volgende:</span> {next.name} om {next.at}
            </p>
          )}
          <ul className="space-y-1.5">
            {data.runs.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 text-xs">
                <span className="truncate">{r.automationName}</span>
                <span className={r.status === "succeeded" ? "text-success" : r.status === "failed" ? "text-danger" : "text-muted"}>
                  {r.status === "succeeded" ? "gelukt" : r.status === "failed" ? "mislukt" : r.status === "blocked" ? "geblokkeerd" : "overgeslagen"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/[0.03] px-3 py-2.5 text-xs">
        <span className="text-muted">Noodstop</span>
        <span className={stop ? "font-medium text-warning" : "text-success"}>{stop ? "Actief — alles gepauzeerd" : "Niet actief"}</span>
      </div>
    </SectionCard>
  );
}
