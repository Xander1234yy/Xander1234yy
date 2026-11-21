"use client";

import { useEffect, useState } from "react";
import { Apple, Play } from "lucide-react";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { api, connectorPath } from "@/lib/api";
import { useLive } from "@/lib/home-context";
import { shortcutUrl, type ShortcutButton } from "@/lib/shortcuts";

/**
 * Knoppen die een Apple-opdracht starten (bijv. "TV aan" via Apple Woning). Werkt alleen op een iPhone, iPad of Mac met
 * de Opdrachten-app; HomeOS ziet niet of het gelukt is. Verborgen als er geen knoppen zijn.
 */
export function ShortcutsCard() {
  const live = useLive();
  const control = useCan("control");
  const [items, setItems] = useState<ShortcutButton[]>([]);
  useEffect(() => {
    if (!live) return;
    api<{ shortcuts?: ShortcutButton[] }>(connectorPath("v1/integrations"))
      .then((r) => setItems(r.shortcuts ?? []))
      .catch(() => undefined);
  }, [live]);
  if (items.length === 0) return null;
  return (
    <SectionCard title="Apple Woning" description="Via Opdrachten op je iPhone, iPad of Mac" icon={Apple} testId="shortcuts-card">
      <div className="grid grid-cols-2 gap-2">
        {items.map((s) => (
          <a
            key={s.id}
            href={control ? shortcutUrl(s.shortcut) : undefined}
            aria-disabled={!control}
            className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.06] px-3 py-3 text-sm transition hover:bg-white/[0.1] aria-disabled:pointer-events-none aria-disabled:opacity-40"
          >
            <Play className="size-4 shrink-0 text-accent" />
            <span className="truncate">{s.label}</span>
          </a>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">Apple voert de opdracht uit; HomeOS kan niet zien of het gelukt is.</p>
    </SectionCard>
  );
}
