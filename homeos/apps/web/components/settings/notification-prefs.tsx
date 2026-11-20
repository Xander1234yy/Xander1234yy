"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Switch } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useLive } from "@/lib/home-context";

const LABELS: [string, string, string][] = [
  ["connection", "Verbinding", "Apparaten die offline gaan (via automatiseringen)"],
  ["energy", "Energie", "Opwek- en verbruiksmeldingen"],
  ["maintenance", "Onderhoud", "Herinneringen voor onderhoud en garantie"],
  ["automation", "Automatiseringen", "Meldingen uit automatiseringen en mislukte runs"],
  ["security", "Beveiliging", "Deurbel en beveiliging"],
  ["system", "Systeem", "Overige systeemmeldingen"],
];

export function NotificationPrefsCard() {
  const live = useLive();
  const manage = useCan("manage_household");
  const toast = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (live) api<Record<string, boolean>>(connectorPath("v1/notifications/preferences")).then(setPrefs).catch(() => undefined);
  }, [live]);
  return (
    <SectionCard title="Meldingen" description="Welke categorieën HomeOS meldt (in de app)" icon={Bell} testId="notification-prefs">
      {!prefs ? (
        <p className="text-sm text-muted">Beschikbaar zodra de connector verbonden is.</p>
      ) : (
        <ul className="space-y-3">
          {LABELS.map(([key, label, hint]) => (
            <li key={key} className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm">{label}</p>
                <p className="text-[11px] text-muted">{hint}</p>
              </div>
              <Switch
                checked={prefs[key] !== false}
                disabled={!manage}
                aria-label={`Meldingen ${label}`}
                onCheckedChange={async (v) => {
                  try {
                    setPrefs(await api<Record<string, boolean>>(connectorPath("v1/notifications/preferences"), { method: "PUT", body: JSON.stringify({ [key]: v }) }));
                  } catch (e) {
                    toast.push({ title: "Niet opgeslagen", description: (e as Error).message, tone: "danger" });
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">Pushmeldingen op iPhone/iPad volgen met de installeerbare app (fase 7).</p>
    </SectionCard>
  );
}
