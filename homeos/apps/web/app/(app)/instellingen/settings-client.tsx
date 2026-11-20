"use client";

import { useEffect, useState } from "react";
import { Bell, Bot, DatabaseBackup, KeyRound, Laptop, OctagonPause, Palette, Plug, ScrollText, Users } from "lucide-react";
import { Badge, Button, Switch } from "@homeos/ui";
import { PageHeader, SectionCard } from "@/components/section";
import { api, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { useCan } from "@/components/session-context";
import { HueCard } from "@/components/settings/hue-card";
import { TvCard } from "@/components/settings/tv-card";
import { TapoCard } from "@/components/settings/tapo-card";
import { ZonneplanCard } from "@/components/settings/zonneplan-card";
import { PushCard } from "@/components/pwa/push-card";
import { NotificationPrefsCard } from "@/components/settings/notification-prefs";
import { DaikinCard, MatterCard, SolarEdgeCard, TuyaCard } from "@/components/settings/cloud-cards";
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

const HEALTH_TONE = { ok: "success", degraded: "warning", down: "danger", not_configured: "neutral" } as const;

function Planned({ phase, children }: { phase: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm text-muted">
      <p>{children}</p>
      <Badge tone="accent">Fase {phase}</Badge>
    </div>
  );
}

export function SettingsClient({ cloudSection }: { cloudSection?: React.ReactNode }) {
  const { snapshot, connector, lastSync, setEmergencyStop } = useHome();
  const live = useLive();
  const mayControl = useCan("control");
  const mayAudit = useCan("view_audit");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const c = snapshot?.connector;

  useEffect(() => {
    if (connector !== "online" || !mayAudit) return;
    api<{ entries: AuditEntry[] }>(connectorPath("v1/audit?limit=30"))
      .then((r) => setAudit(r.entries))
      .catch(() => undefined);
  }, [connector, mayAudit, snapshot?.generatedAt]);

  return (
    <div>
      <PageHeader title="Instellingen" description="Connector, integraties, beveiliging en voorkeuren." />
      {cloudSection && <div className="mb-5 grid gap-5 lg:grid-cols-2">{cloudSection}</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Device Connector" icon={Laptop} testId="connector-settings">
          {c ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Status</dt>
              <dd>{connector === "online" ? <Badge tone="success">Online</Badge> : <Badge tone="danger">Offline</Badge>}</dd>
              <dt className="text-muted">Connector-ID</dt>
              <dd className="truncate font-mono text-xs">{c.connectorId}</dd>
              <dt className="text-muted">Versie</dt>
              <dd>{c.version}</dd>
              <dt className="text-muted">Gestart</dt>
              <dd>{formatDateTime(c.startedAt)}</dd>
              <dt className="text-muted">Laatste sync</dt>
              <dd>{formatDateTime(lastSync)}</dd>
              <dt className="text-muted">Modus</dt>
              <dd>{c.demoMode ? <Badge tone="demo">Demo</Badge> : "Productie"}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">Nog geen verbinding met de connector.</p>
          )}
          <p className="mt-4 text-xs text-muted">
            De connector draait op je laptop en is alleen lokaal bereikbaar. Het toegangstoken staat uitsluitend server-side; de browser praat nooit rechtstreeks met de connector.
          </p>
        </SectionCard>

        <SectionCard title="Noodstop" icon={OctagonPause}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Automatiseringen en Jarvis pauzeren</p>
              <p className="text-xs text-muted">Blokkeert alle opdrachten die niet direct van jou komen. Handmatige bediening blijft werken.</p>
            </div>
            <Switch checked={!!c?.emergencyStop} disabled={!live || !mayControl} onCheckedChange={(v) => void setEmergencyStop(v)} aria-label="Noodstop" />
          </div>
        </SectionCard>

        <HueCard />
        <SolarEdgeCard />
        <ZonneplanCard />
        <DaikinCard />
        <TuyaCard />
        <MatterCard />
        <TvCard />
        <TapoCard />

        <SectionCard title="Integraties" icon={Plug}>
          <ul className="space-y-2">
            {(c?.adapters ?? []).map((a) => (
              <li key={a.adapterId} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {a.displayName} {a.demo && <Badge tone="demo">Demo</Badge>}
                  </p>
                  <p className="truncate text-[11px] text-muted">{a.message ?? a.integration}</p>
                </div>
                <Badge tone={HEALTH_TONE[a.status]}>{a.status}</Badge>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-2">
            <Planned phase={4}>Tapo-deurbel (alleen wat TP-Link officieel ondersteunt)</Planned>
            <Planned phase={4}>Apple TV (onderzoek naar een toegestane route)</Planned>
          </div>
        </SectionCard>

        <PushCard />
        <NotificationPrefsCard />

        <SectionCard title="Auditlog" description={mayAudit ? "Laatste acties via de connector" : "Alleen zichtbaar voor beheerders"} icon={ScrollText}>
          {audit.length === 0 ? (
            <p className="text-sm text-muted">Nog geen acties vastgelegd.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {audit.map((e) => (
                <li key={e.id} className="text-xs">
                  <p className={e.ok ? "text-fg" : "text-danger"}>
                    <span className="font-mono">{e.action}</span> · {e.source} {e.target && <span className="text-muted">· {e.target}</span>}
                  </p>
                  <p className="text-muted">
                    {formatDateTime(e.at)} {e.message && `— ${e.message}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {!cloudSection && (
          <SectionCard title="Gebruikers & beveiliging" icon={Users}>
            <p className="text-sm text-muted">
              HomeOS draait in de <strong className="text-fg">lokale modus</strong>: zonder accounts en alleen bereikbaar op deze laptop (127.0.0.1).
              Koppel Supabase om accounts, huishoudens, rollen en Row Level Security te activeren (zie docs/supabase.md).
            </p>
            <p className="mt-3 flex items-center gap-2 text-xs text-muted">
              <KeyRound className="size-3.5" /> Volledige beveiligingscontrole volgt in fase 8.
            </p>
          </SectionCard>
        )}

        <SectionCard title="Voorkeuren" icon={Palette}>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><Palette className="size-4 text-muted" /> Thema</span>
              <span className="text-muted">Donker (standaard)</span>
            </div>
            <Planned phase={7}><span className="inline-flex items-center gap-2"><Bell className="size-4" /> Pushmeldingen op iPhone/iPad</span></Planned>
            <Planned phase={6}><span className="inline-flex items-center gap-2"><Bot className="size-4" /> AI-provider en Jarvis-instellingen</span></Planned>
            <Planned phase={7}><span className="inline-flex items-center gap-2"><DatabaseBackup className="size-4" /> Back-ups en clouddeployment</span></Planned>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => {
              localStorage.clear();
              location.reload();
            }}
          >
            Lokale cache wissen
          </Button>
        </SectionCard>
      </div>
    </div>
  );
}
