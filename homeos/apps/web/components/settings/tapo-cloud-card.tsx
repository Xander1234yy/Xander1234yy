"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Unlink } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

type Info = { connected: boolean; addedAt?: string; cameras?: string[]; health?: AdapterHealth | null };

/** Tapo-camera's en -deurbel via de TP-Link-cloud. NIET-OFFICIEEL: TP-Link heeft geen openbare camera-API; op verzoek. */
export function TapoCloudCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<null | "app" | "email">(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo((await api<{ tapocloud?: Info }>(connectorPath("v1/integrations"))).tapocloud ?? null);
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const done = async (cameras: string[]) => {
    setPassword("");
    setCode("");
    setMfa(null);
    toast.push({ title: "Tapo gekoppeld", description: `${cameras.join(", ")} · zie Beveiliging.`, tone: "success" });
    await load();
  };

  const connect = async () => {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; mfa?: boolean; via?: "app" | "email"; cameras?: string[] }>(connectorPath("v1/integrations/tapocloud"), {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (r.mfa) setMfa(r.via ?? "app");
      else await done(r.cameras ?? []);
    } catch (e) {
      toast.push({ title: "Koppelen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const r = await api<{ cameras?: string[] }>(connectorPath("v1/integrations/tapocloud/verify"), { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      await done(r.cameras ?? []);
    } catch (e) {
      toast.push({ title: "Verificatie mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Tapo (cloud) ontkoppelen? De camera's verdwijnen uit HomeOS en je inloggegevens worden gewist.")) return;
    try {
      await api(connectorPath("v1/integrations/tapocloud"), { method: "DELETE" });
      toast.push({ title: "Tapo ontkoppeld", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <SectionCard title="Tapo-camera's (cloud)" description="Meldingen, privacymodus en draaien via de TP-Link-cloud" icon={Camera} testId="tapo-cloud-card">
      <p className="mb-3 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
        Niet-officiële koppeling: TP-Link heeft geen openbare camera-API. HomeOS doet hetzelfde als de Tapo-app. Dit kan zonder
        aankondiging stoppen met werken. Live beeld via het videorelais van TP-Link (max. 4 minuten per keer).
      </p>
      {info?.connected ? (
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{(info.cameras ?? []).join(", ") || "Tapo"}</p>
            <p className="truncate text-[11px] text-muted">
              gekoppeld {info.addedAt ? formatDateTime(info.addedAt) : ""} · {info.health?.message ?? "—"}
            </p>
          </div>
          <Badge tone={info.health?.status === "ok" ? "success" : info.health?.status === "down" ? "danger" : "warning"}>{info.health?.status ?? "onbekend"}</Badge>
          {manage && (
            <Button size="icon-sm" variant="ghost" onClick={() => void remove()} aria-label="Tapo ontkoppelen">
              <Unlink />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Niet gekoppeld.</p>
      )}
      {manage && !info?.connected && !mfa && (
        <form
          className="mt-4 grid gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="E-mailadres Tapo-account" maxLength={254} autoComplete="off" aria-label="E-mailadres Tapo" disabled={!live} />
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Wachtwoord Tapo" maxLength={200} autoComplete="off" aria-label="Wachtwoord Tapo" disabled={!live} />
          <Button type="submit" className="sm:col-span-2" disabled={!live || busy || !email.trim() || !password}>
            {busy ? "Camera's zoeken…" : "Tapo koppelen"}
          </Button>
          <p className="text-[11px] text-muted sm:col-span-2">
            Hetzelfde account als in de Tapo-app. Versleuteld bewaard (nodig om opnieuw aan te melden) en alleen naar TP-Link gestuurd. Meldingen komen
            binnen voor alles wat je in de Tapo-app aan hebt staan.
          </p>
        </form>
      )}
      {manage && !info?.connected && mfa && (
        <form
          className="mt-4 space-y-2 border-t border-white/[0.06] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-sm">{mfa === "app" ? "TP-Link heeft een verificatiecode gestuurd naar de Tapo-app op je telefoon." : "TP-Link heeft een verificatiecode per e-mail gestuurd."}</p>
          <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="Verificatiecode" maxLength={12} autoComplete="one-time-code" aria-label="Verificatiecode Tapo" disabled={!live} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!live || busy || !code.trim()}>
              {busy ? "Controleren…" : "Bevestigen"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMfa(null)}>
              Annuleren
            </Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}
