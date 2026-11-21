"use client";

import { useCallback, useEffect, useState } from "react";
import { Tv, Unlink } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

type Info = { connected: boolean; addedAt?: string; boxes?: string[]; health?: AdapterHealth | null };

/** Ziggo Mediabox Next / Next Mini. NIET-OFFICIEEL: Ziggo heeft geen openbare API; op uitdrukkelijk verzoek. */
export function ZiggoCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo((await api<{ ziggo?: Info }>(connectorPath("v1/integrations"))).ziggo ?? null);
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const connect = async () => {
    setBusy(true);
    try {
      await api(connectorPath("v1/integrations/ziggo"), { method: "POST", body: JSON.stringify({ username: email.trim(), password }) });
      setPassword("");
      toast.push({ title: "Ziggo-box gekoppeld", description: "Je vindt hem bij Entertainment.", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Koppelen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Ziggo ontkoppelen? De box verdwijnt uit HomeOS en je inloggegevens worden gewist.")) return;
    try {
      await api(connectorPath("v1/integrations/ziggo"), { method: "DELETE" });
      toast.push({ title: "Ziggo ontkoppeld", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <SectionCard title="Ziggo Mediabox" description="Next / Next Mini · zenders, aan/uit, afstandsbediening" icon={Tv} testId="ziggo-card">
      <p className="mb-3 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
        Niet-officiële koppeling: Ziggo heeft geen openbare API. HomeOS doet hetzelfde als de Ziggo GO-webapp. Dit kan zonder
        aankondiging stoppen met werken.
      </p>
      {info?.connected ? (
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{(info.boxes ?? []).join(", ") || "Ziggo-box"}</p>
            <p className="truncate text-[11px] text-muted">
              gekoppeld {info.addedAt ? formatDateTime(info.addedAt) : ""} · {info.health?.message ?? "—"}
            </p>
          </div>
          <Badge tone={info.health?.status === "ok" ? "success" : info.health?.status === "down" ? "danger" : "warning"}>{info.health?.status ?? "onbekend"}</Badge>
          {manage && (
            <Button size="icon-sm" variant="ghost" onClick={() => void remove()} aria-label="Ziggo ontkoppelen">
              <Unlink />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Niet gekoppeld.</p>
      )}
      {manage && !info?.connected && (
        <form
          className="mt-4 grid gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="E-mailadres Ziggo" maxLength={254} autoComplete="off" aria-label="E-mailadres Ziggo" disabled={!live} />
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Wachtwoord Ziggo" maxLength={200} autoComplete="off" aria-label="Wachtwoord Ziggo" disabled={!live} />
          <Button type="submit" className="sm:col-span-2" disabled={!live || busy || !email.trim() || !password}>
            {busy ? "Box zoeken…" : "Ziggo koppelen"}
          </Button>
          <p className="text-[11px] text-muted sm:col-span-2">
            Je inloggegevens van Mijn Ziggo / Ziggo GO. Ze worden versleuteld bewaard (nodig om opnieuw aan te melden) en alleen naar Ziggo gestuurd.
          </p>
        </form>
      )}
    </SectionCard>
  );
}
