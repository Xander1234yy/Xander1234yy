"use client";

import { useCallback, useEffect, useState } from "react";
import { Apple, Plus, Trash2 } from "lucide-react";
import { Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useLive } from "@/lib/home-context";
import type { ShortcutButton } from "@/lib/shortcuts";

type Row = { label: string; shortcut: string };

/** Beheer van de knoppen voor Apple-opdrachten (Shortcuts), bijv. tv via Apple Woning. */
export function ShortcutsSettingsCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ shortcuts?: ShortcutButton[] }>(connectorPath("v1/integrations"));
      setRows((r.shortcuts ?? []).map(({ label, shortcut }) => ({ label, shortcut })));
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load]);

  const save = async () => {
    setBusy(true);
    try {
      await api(connectorPath("v1/integrations/shortcuts"), { method: "PUT", body: JSON.stringify({ items: rows }) });
      toast.push({ title: "Knoppen opgeslagen", description: "Je vindt ze op het dashboard (Apple Woning).", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Opslaan mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  return (
    <SectionCard title="Apple Woning (Opdrachten)" description="Knoppen die een opdracht op je iPhone, iPad of Mac starten" icon={Apple} testId="shortcuts-settings-card">
      <ol className="mb-3 list-decimal space-y-1 pl-4 text-xs text-muted">
        <li>
          Maak in de app <strong>Opdrachten</strong> een opdracht, bijv. &quot;TV aan&quot; met de actie <em>Bedien [woning]</em> (tv aan + juiste HDMI-ingang).
        </li>
        <li>Vul hieronder een knopnaam en de naam van die opdracht in, precies zoals in de Opdrachten-app.</li>
        <li>Werkt op een Apple-apparaat met jouw Apple ID. Buiten de deur alleen met een woningshub (Apple TV of HomePod).</li>
      </ol>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Knop, bijv. TV aan" maxLength={40} aria-label={`Knopnaam ${i + 1}`} disabled={!manage || !live} />
            <Input value={r.shortcut} onChange={(e) => set(i, { shortcut: e.target.value })} placeholder="Naam van de opdracht" maxLength={100} aria-label={`Opdracht ${i + 1}`} disabled={!manage || !live} />
            {manage && (
              <Button size="icon" variant="ghost" onClick={() => setRows((x) => x.filter((_, n) => n !== i))} aria-label={`Knop ${i + 1} verwijderen`}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted">Nog geen knoppen.</p>}
      </div>
      {manage && (
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" disabled={!live || rows.length >= 30} onClick={() => setRows((x) => [...x, { label: "", shortcut: "" }])}>
            <Plus /> Knop toevoegen
          </Button>
          <Button variant="primary" disabled={!live || busy} onClick={() => void save()}>
            {busy ? "Opslaan…" : "Opslaan"}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
