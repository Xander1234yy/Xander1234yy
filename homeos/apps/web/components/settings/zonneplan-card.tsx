"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, Unlink } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

interface ZonneplanInfo {
  connected: boolean;
  label?: string;
  addedAt?: string;
  pending?: boolean;
  health?: AdapterHealth | null;
}

/** Zonneplan Connect (P1). NIET-OFFICIEEL: Zonneplan heeft geen openbare API; op verzoek van de gebruiker. */
export function ZonneplanCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [info, setInfo] = useState<ZonneplanInfo | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ zonneplan?: ZonneplanInfo }>(connectorPath("v1/integrations"));
      setInfo(r.zonneplan ?? null);
    } catch {
      /* connector offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const start = async () => {
    setBusy(true);
    try {
      await api(connectorPath("v1/integrations/zonneplan/start"), { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setStep("code");
      setEmail("");
      toast.push({ title: "Code verstuurd", description: "Kijk in je e-mail voor de code van Zonneplan.", tone: "success" });
    } catch (e) {
      toast.push({ title: "Code aanvragen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    setBusy(true);
    try {
      const r = await api<{ label: string }>(connectorPath("v1/integrations/zonneplan/complete"), { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      toast.push({ title: `${r.label} gekoppeld`, description: "Verbruik en teruglevering staan nu bij Energie.", tone: "success" });
      setCode("");
      setStep("email");
      await load();
    } catch (e) {
      toast.push({ title: "Inloggen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Zonneplan ontkoppelen? De aanmelding wordt gewist uit HomeOS.")) return;
    try {
      await api(connectorPath("v1/integrations/zonneplan"), { method: "DELETE" });
      toast.push({ title: "Zonneplan ontkoppeld", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <SectionCard title="Zonneplan Connect" description="Slimme meter (P1) via de Zonneplan-app" icon={Gauge} testId="zonneplan-card">
      <p className="mb-3 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
        Niet-officiële koppeling: Zonneplan heeft geen openbare API. HomeOS gebruikt dezelfde server als de Zonneplan-app, alleen om
        te lezen. Dit kan zonder aankondiging stoppen met werken.
      </p>
      {info?.connected ? (
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{info.label}</p>
            <p className="truncate text-[11px] text-muted">
              gekoppeld {info.addedAt ? formatDateTime(info.addedAt) : ""} · {info.health?.message ?? "—"}
            </p>
          </div>
          <Badge tone={info.health?.status === "ok" ? "success" : info.health?.status === "down" ? "danger" : "warning"}>niet-officieel</Badge>
          {manage && (
            <Button size="icon-sm" variant="ghost" onClick={() => void remove()} aria-label="Zonneplan ontkoppelen">
              <Unlink />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Niet gekoppeld.</p>
      )}
      {manage && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          {step === "email" ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="E-mailadres van je Zonneplan-account" autoComplete="email" maxLength={254} aria-label="E-mailadres Zonneplan" disabled={!live} />
              <Button type="submit" disabled={!live || busy || !email.includes("@")}>
                {busy ? "Bezig…" : info?.connected ? "Opnieuw inloggen" : "Code aanvragen"}
              </Button>
            </form>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void complete();
              }}
            >
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code uit de e-mail" inputMode="numeric" autoComplete="one-time-code" maxLength={12} aria-label="Code uit de e-mail" disabled={!live} />
              <Button type="submit" disabled={!live || busy || code.trim().length < 4}>
                {busy ? "Bezig…" : "Inloggen"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep("email")}>
                Terug
              </Button>
            </form>
          )}
          <p className="text-[11px] text-muted">
            Je e-mailadres wordt niet bewaard. De aanmelding staat versleuteld op je laptop. HomeOS haalt elke 3 minuten de meterstand op en rekent met je
            zonnepanelen je eigen verbruik uit.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
