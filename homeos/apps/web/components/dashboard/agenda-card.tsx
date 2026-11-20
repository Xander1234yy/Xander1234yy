"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarDays, ListTodo, ShoppingCart, Wrench } from "lucide-react";
import { SectionCard } from "@/components/section";
import { useSession } from "@/components/session-context";
import { getFamilySummary, type FamilySummary } from "@/lib/actions/summary";

export function AgendaCard() {
  const session = useSession();
  const [data, setData] = useState<FamilySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (session.mode !== "cloud") return;
    let stop = false;
    const load = () =>
      getFamilySummary().then((r) => {
        if (stop) return;
        if (r.ok && r.value) setData(r.value);
        else if (!r.ok) setError(r.error);
      });
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [session.mode]);

  if (session.mode !== "cloud") {
    return (
      <SectionCard title="Agenda" icon={CalendarDays} href="/familie" testId="agenda-card">
        <p className="text-sm text-muted">Agenda, taken en boodschappen zijn beschikbaar met een HomeOS-account (Supabase). HomeOS draait nu in de lokale modus.</p>
      </SectionCard>
    );
  }

  const stat = (icon: typeof ListTodo, label: string, value: number, href: string) => {
    const Icon = icon;
    return (
      <Link href={href} className="rounded-2xl bg-white/[0.03] p-3 text-center transition hover:bg-white/[0.06]">
        <Icon className="mx-auto size-4 text-accent" />
        <p className="mt-1 text-lg font-semibold tabular">{value}</p>
        <p className="text-[10px] text-muted">{label}</p>
      </Link>
    );
  };

  return (
    <SectionCard title="Agenda" description="Komende 7 dagen" icon={CalendarDays} href="/familie" testId="agenda-card">
      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Laden…</p>}
      {data && (
        <>
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-muted">Geen afspraken de komende week.</p>
          ) : (
            <ul className="space-y-2">
              {data.upcoming.map((e) => (
                <li key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-xs tabular text-muted">
                    {new Date(e.starts_at).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" })}
                    {!e.all_day && ` ${new Date(e.starts_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`}
                  </span>
                  <span className="truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {stat(ListTodo, "Open taken", data.openTasks, "/familie")}
            {stat(ShoppingCart, "Boodschappen", data.shopping.length, "/familie")}
            {stat(Wrench, "Onderhoud", data.maintenanceDue, "/onderhoud")}
          </div>
        </>
      )}
    </SectionCard>
  );
}
