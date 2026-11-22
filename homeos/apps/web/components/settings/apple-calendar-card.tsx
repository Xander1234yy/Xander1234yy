"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Unlink } from "lucide-react";
import { Badge, Button, Input, Switch } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

type Cal = { href: string; name: string; color: string | null; enabled: boolean };
type Info = { connected: boolean; addedAt?: string; calendars?: Cal[]; fetchedAt?: string | null; error?: string | null };

/** Apple iCloud-agenda (alleen-lezen) via CalDAV met een app-specifiek wachtwoord. */
export function AppleCalendarCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo((await api<{ icloud?: Info }>(connectorPath("v1/integrations"))).icloud ?? null);
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load]);

  const connect = async () => {
    setBusy(true);
    try {
      await api(connectorPath("v1/integrations/icloud"), { method: "POST", body: JSON.stringify({ appleId: appleId.trim(), appPassword: password.trim() }) });
      setPassword("");
      toast.push({ title: "Apple-agenda gekoppeld", description: "Je afspraken staan bij Familie → Agenda.", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Koppelen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (href: string, on: boolean) => {
    const enabled = (info?.calendars ?? []).filter((c) => (c.href === href ? on : c.enabled)).map((c) => c.href);
    try {
      await api(connectorPath("v1/integrations/icloud/calendars"), { method: "PUT", body: JSON.stringify({ enabled }) });
      await load();
    } catch (e) {
      toast.push({ title: "Opslaan mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  const remove = async () => {
    if (!confirm("Apple-agenda ontkoppelen? Je Apple ID en het app-specifieke wachtwoord worden uit HomeOS gewist.")) return;
    try {
      await api(connectorPath("v1/integrations/icloud"), { method: "DELETE" });
      toast.push({ title: "Apple-agenda ontkoppeld", description: "Trek het wachtwoord ook in op appleid.apple.com.", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <SectionCard title="Apple-agenda" description="iCloud via CalDAV · alleen-lezen" icon={CalendarDays} testId="apple-calendar-card">
      {info?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">iCloud-agenda</p>
              <p className="truncate text-[11px] text-muted">
                gekoppeld {info.addedAt ? formatDateTime(info.addedAt) : ""}
                {info.fetchedAt ? ` · bijgewerkt ${formatDateTime(info.fetchedAt)}` : ""}
                {info.error ? ` · ${info.error}` : ""}
              </p>
            </div>
            <Badge tone={info.error ? "warning" : "success"}>{info.error ? "fout" : "ok"}</Badge>
            {manage && (
              <Button size="icon-sm" variant="ghost" onClick={() => void remove()} aria-label="Apple-agenda ontkoppelen">
                <Unlink />
              </Button>
            )}
          </div>
          <ul className="space-y-1.5">
            {(info.calendars ?? []).map((c) => (
              <li key={c.href} className="flex items-center gap-3 rounded-xl bg-white/[0.02] px-3 py-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? "#64748b" }} />
                <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                <Switch checked={c.enabled} disabled={!live || !manage} onCheckedChange={(v) => void toggle(c.href, v)} aria-label={`Agenda ${c.name} tonen`} />
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted">Afspraken zijn zichtbaar voor iedereen in je huishouden (Familie → Agenda) en worden elke 10 minuten bijgewerkt.</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Niet gekoppeld.</p>
      )}
      {manage && !info?.connected && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            <li>
              Ga naar <strong>appleid.apple.com</strong> → <em>Inloggen en beveiliging</em> → <strong>App-specifieke wachtwoorden</strong> en maak er een met de
              naam &quot;HomeOS&quot;.
            </li>
            <li>Vul hieronder je Apple ID en dat wachtwoord (xxxx-xxxx-xxxx-xxxx) in. Nooit je gewone Apple-wachtwoord.</li>
          </ol>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <Input value={appleId} onChange={(e) => setAppleId(e.target.value)} type="email" placeholder="Apple ID (e-mail)" maxLength={254} autoComplete="off" aria-label="Apple ID" disabled={!live} />
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="xxxx-xxxx-xxxx-xxxx" maxLength={40} autoComplete="off" aria-label="App-specifiek wachtwoord" disabled={!live} />
            <Button type="submit" className="sm:col-span-2" disabled={!live || busy || !appleId.trim() || !password.trim()}>
              {busy ? "Agenda's zoeken…" : "Apple-agenda koppelen"}
            </Button>
          </form>
          <p className="text-[11px] text-muted">Alleen-lezen. Je Apple ID en wachtwoord worden versleuteld bewaard en alleen naar iCloud gestuurd.</p>
        </div>
      )}
    </SectionCard>
  );
}
