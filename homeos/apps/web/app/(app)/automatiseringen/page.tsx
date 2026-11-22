"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Pencil, Play, Plus, Sparkles, Trash2, Workflow } from "lucide-react";
import { Badge, Button, Card, Switch, cn } from "@homeos/ui";
import { AutomationEditor } from "@/components/automations/editor";
import { describeAction, describeCondition, describeTrigger, type Automation, type AutomationInput, type AutomationRun } from "@/components/automations/types";
import { EmptyState, PageHeader, SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath, enc } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

const STATUS: Record<AutomationRun["status"], { label: string; tone: "success" | "danger" | "warning" | "neutral" | "accent" }> = {
  succeeded: { label: "Gelukt", tone: "success" },
  failed: { label: "Mislukt", tone: "danger" },
  blocked: { label: "Geblokkeerd", tone: "warning" },
  skipped: { label: "Overgeslagen", tone: "neutral" },
  running: { label: "Bezig", tone: "accent" },
};
const BLANK: AutomationInput = { name: "", enabled: true, trigger: { type: "time", at: "20:00", days: [] }, conditions: [], actions: [{ type: "report", kind: "evening" }], cooldownMinutes: 5, maxRunsPerDay: 20 };

export default function AutomationsPage() {
  const { snapshot, runTick } = useHome();
  const live = useLive();
  const manage = useCan("manage_automations");
  const control = useCan("control");
  const toast = useToast();
  const [list, setList] = useState<Automation[] | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [templates, setTemplates] = useState<Record<string, AutomationInput> | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; value: AutomationInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const devices = snapshot?.devices ?? [];
  const scenes = snapshot?.scenes ?? [];

  const load = useCallback(async () => {
    try {
      const [a, r, t] = await Promise.all([
        api<{ automations: Automation[] }>(connectorPath("v1/automations")),
        api<{ runs: AutomationRun[] }>(connectorPath("v1/automations/runs?limit=40")),
        api<Record<string, AutomationInput>>(connectorPath("v1/automations/templates")),
      ]);
      setList(a.automations);
      setRuns(r.runs);
      setTemplates(t);
    } catch {
      /* connector offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, runTick]);

  const call = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.push({ title: ok, tone: "success" });
      await load();
      return r;
    } catch (e) {
      toast.push({ title: "Niet gelukt", description: (e as Error).message, tone: "danger" });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async (value: AutomationInput) => {
    const ok = await call(
      () => (editing?.id ? api(connectorPath(`v1/automations/${enc(editing.id)}`), { method: "PATCH", body: JSON.stringify(value) }) : api(connectorPath("v1/automations"), { method: "POST", body: JSON.stringify(value) })),
      "Automatisering opgeslagen",
    );
    if (ok) setEditing(null);
  };

  const lastRun = (id: string) => runs.find((r) => r.automationId === id);

  return (
    <div>
      <PageHeader
        title="Automatiseringen"
        description="Eigen regels: trigger → voorwaarden → acties. Draait lokaal in de connector."
        actions={
          manage && !editing ? (
            <Button variant="primary" disabled={!live} onClick={() => setEditing({ id: null, value: BLANK })}>
              <Plus /> Nieuwe automatisering
            </Button>
          ) : undefined
        }
      />

      {!live && <p className="mb-4 rounded-2xl border border-warning/25 bg-warning/[0.06] px-4 py-3 text-sm text-muted">De connector is offline: automatiseringen zijn gepauzeerd en worden later niet alsnog uitgevoerd.</p>}

      {editing && (
        <div className="mb-5">
          <AutomationEditor initial={editing.value} devices={devices} scenes={scenes} onSave={(v) => void save(v)} onCancel={() => setEditing(null)} busy={busy} />
        </div>
      )}

      {manage && !editing && templates && (
        <Card className="mb-5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-accent" /> Snel beginnen met een sjabloon
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(templates).map(([key, t]) => (
              <Button key={key} size="sm" variant="secondary" disabled={!live} onClick={() => setEditing({ id: null, value: t })} data-testid={`template-${key}`}>
                {t.name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          {list && list.length === 0 && (
            <EmptyState icon={Workflow} title="Nog geen automatiseringen">
              Begin met een sjabloon, bijvoorbeeld Avondmodus.
            </EmptyState>
          )}
          {list?.map((a) => {
            const lr = lastRun(a.id);
            return (
              <Card key={a.id} className={cn("p-5", !a.enabled && "opacity-60")} data-testid="automation-card">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{a.name}</h3>
                    <p className="mt-0.5 text-sm text-accent-soft">{describeTrigger(a.trigger, devices)}</p>
                    {a.conditions.length > 0 && <p className="mt-1 text-xs text-muted">Alleen als: {a.conditions.map((c) => describeCondition(c, devices)).join(" · ")}</p>}
                    <p className="mt-1 text-xs text-muted">Dan: {a.actions.map((x) => describeAction(x, devices, scenes)).join(" → ")}</p>
                    {lr && (
                      <p className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                        <Badge tone={STATUS[lr.status].tone}>{STATUS[lr.status].label}</Badge> laatste run {formatDateTime(lr.startedAt)}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={a.enabled}
                    disabled={!manage || !live || busy}
                    onCheckedChange={(enabled) => void call(() => api(connectorPath(`v1/automations/${enc(a.id)}`), { method: "PATCH", body: JSON.stringify({ enabled }) }), enabled ? "Automatisering actief" : "Automatisering gepauzeerd")}
                    aria-label={a.enabled ? `${a.name} pauzeren` : `${a.name} activeren`}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={!control || !live || busy || a.running} onClick={() => void call(() => api(connectorPath(`v1/automations/${enc(a.id)}/run`), { method: "POST" }), "Uitgevoerd")}>
                    <Play /> Nu uitvoeren
                  </Button>
                  {manage && (
                    <>
                      <Button size="sm" variant="ghost" disabled={!live} onClick={() => setEditing({ id: a.id, value: a })}>
                        <Pencil /> Bewerken
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!live || busy} onClick={() => confirm(`"${a.name}" verwijderen?`) && void call(() => api(connectorPath(`v1/automations/${enc(a.id)}`), { method: "DELETE" }), "Verwijderd")}>
                        <Trash2 /> Verwijderen
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <SectionCard title="Uitvoeringsgeschiedenis" description="Laatste runs, nieuwste eerst" icon={History} className="lg:col-span-5" testId="run-history">
          {runs.length === 0 ? (
            <p className="text-sm text-muted">Nog geen runs.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {runs.map((r) => (
                <li key={r.id} className="py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">{r.automationName}</span>
                    <span className="shrink-0 text-[11px] text-muted">{formatDateTime(r.startedAt)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {r.trigger === "manual" ? "Handmatig" : `Trigger: ${r.trigger}`}
                    {r.error ? ` · ${r.error}` : r.steps.length ? ` · ${r.steps.filter((s) => s.ok).length}/${r.steps.length} stappen gelukt` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
