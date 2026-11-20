"use client";

import { useEffect, useState } from "react";
import { Bot, History, ShieldCheck } from "lucide-react";
import { Badge } from "@homeos/ui";
import { JarvisChat } from "@/components/jarvis-chat";
import { JarvisSettingsCard } from "@/components/jarvis-settings";
import { PageHeader, SectionCard } from "@/components/section";
import { api, connectorPath } from "@/lib/api";
import { useHome } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

interface AuditEntry {
  id: string;
  at: string;
  action: string;
  source: string;
  target: string | null;
  ok: boolean;
  message?: string;
}

export default function JarvisPage() {
  const { connector, snapshot } = useHome();
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [mode, setMode] = useState<"cloud" | "local" | null>(null);
  useEffect(() => {
    api<{ mode: "cloud" | "local" }>("/api/jarvis")
      .then((r) => setMode(r.mode))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (connector !== "online") return;
    const load = () =>
      api<{ entries: AuditEntry[] }>(connectorPath("v1/audit?limit=200"))
        .then((r) => setHistory(r.entries.filter((e) => e.source === "jarvis")))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [connector]);
  const name = (id: string | null) => snapshot?.devices.find((d) => d.id === id)?.name ?? snapshot?.scenes.find((s) => s.id === id)?.name ?? id ?? "—";

  return (
    <div>
      <PageHeader title="Jarvis" description="Je huisassistent. Stelt voor, jij bevestigt, de connector controleert." actions={<Badge tone="accent">Lokale Jarvis · gratis en offline</Badge>} />
      <div className="grid gap-5 lg:grid-cols-12">
        <SectionCard title="Gesprek" icon={Bot} className="lg:col-span-8">
          <JarvisChat />
        </SectionCard>
        <div className="space-y-5 lg:col-span-4">
          <SectionCard title="Hoe Jarvis werkt" icon={ShieldCheck}>
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted">
              <li>Jij geeft een opdracht (typen of spreken).</li>
              <li>Jarvis interpreteert en doet een voorstel.</li>
              <li>Jij bevestigt het voorstel.</li>
              <li>De connector controleert bevoegdheden, noodstop en apparaatfuncties.</li>
              <li>Pas dan wordt de opdracht uitgevoerd en vastgelegd.</li>
            </ol>
            <p className="mt-3 text-xs text-muted">
              Jarvis krijgt nooit directe toegang tot apparaten. Voorstellen uit een eerder gesprek verlopen en kunnen niet meer bevestigd worden.
            </p>
            <p className="mt-2 text-xs text-muted">
              Probeer: &quot;zet de lampen in de woonkamer op 30%&quot;, &quot;maak de plafondlamp blauw&quot;, &quot;welke lampen staan aan?&quot; en daarna &quot;zet ze uit&quot;,
              &quot;airco warmer&quot;, &quot;weekoverzicht energie&quot;, &quot;wat staat er morgen op de agenda?&quot;.
            </p>
          </SectionCard>
          <JarvisSettingsCard mode={mode} />
          <SectionCard title="Opdrachtgeschiedenis" icon={History}>
            {history.length === 0 ? (
              <p className="text-sm text-muted">Nog geen Jarvis-opdrachten uitgevoerd.</p>
            ) : (
              <ul className="space-y-2">
                {history.slice(0, 15).map((h) => (
                  <li key={h.id} className="text-xs">
                    <p className={h.ok ? "text-fg" : "text-danger"}>
                      {h.action === "scene.activate" ? "Scène" : "Opdracht"} · {name(h.target)} {h.ok ? "" : `— ${h.message}`}
                    </p>
                    <p className="text-muted">{formatDateTime(h.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
