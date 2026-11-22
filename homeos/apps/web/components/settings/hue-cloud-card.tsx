"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Lightbulb, Unlink } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

const RESULT: Record<string, { title: string; tone: "success" | "danger" }> = {
  gekoppeld: { title: "Philips Hue gekoppeld via de Hue-cloud", tone: "success" },
  mislukt: { title: "Koppelen met de Hue-cloud mislukt. Probeer het opnieuw.", tone: "danger" },
  geweigerd: { title: "Hue heeft het koppelen niet bevestigd.", tone: "danger" },
  "geen-rechten": { title: "Alleen beheerders kunnen Hue koppelen.", tone: "danger" },
};

/** Philips Hue via de officiële Hue Remote API (werkt zonder laptop of apparaat thuis). */
export function HueCloudCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [info, setInfo] = useState<{ connected: boolean; addedAt?: string; health?: AdapterHealth | null } | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");

  const load = useCallback(async () => {
    try {
      setInfo((await api<{ huecloud?: { connected: boolean; addedAt?: string; health?: AdapterHealth | null } }>(connectorPath("v1/integrations"))).huecloud ?? null);
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/integrations/huecloud/callback`);
    const r = new URLSearchParams(window.location.search).get("hue");
    if (r && RESULT[r]) toast.push({ title: RESULT[r].title, tone: RESULT[r].tone });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- eenmalig bij openen
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api<{ authorizeUrl: string }>(connectorPath("v1/integrations/huecloud/start"), { method: "POST", body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }) });
      window.location.assign(r.authorizeUrl); // naar de inlogpagina van Philips Hue
    } catch (e) {
      toast.push({ title: "Starten mislukt", description: (e as Error).message, tone: "danger" });
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Hue-cloud ontkoppelen? De lampen worden uit HomeOS verwijderd en de aanmelding wordt gewist.")) return;
    try {
      await api(connectorPath("v1/integrations/huecloud"), { method: "DELETE" });
      toast.push({ title: "Hue ontkoppeld", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <SectionCard title="Philips Hue (cloud)" description="Officiële Hue Remote API · zonder laptop thuis" icon={Lightbulb} testId="hue-cloud-card">
      {info?.connected ? (
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">Hue-cloud</p>
            <p className="truncate text-[11px] text-muted">
              gekoppeld {info.addedAt ? formatDateTime(info.addedAt) : ""} · {info.health?.message ?? "—"}
            </p>
          </div>
          <Badge tone={info.health?.status === "ok" ? "success" : info.health?.status === "down" ? "danger" : "warning"}>{info.health?.status ?? "onbekend"}</Badge>
          {manage && (
            <Button size="icon-sm" variant="ghost" onClick={() => void remove()} aria-label="Hue ontkoppelen">
              <Unlink />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Niet gekoppeld.</p>
      )}
      {manage && !info?.connected && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            <li>
              Maak een gratis account op <strong>developers.meethue.com</strong> en kies <strong>Remote Hue API appids → Add new Hue Remote API app</strong>.
            </li>
            <li>
              Vul als <strong>Callback URL</strong> in:{" "}
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-fg"
                onClick={() => void navigator.clipboard?.writeText(callbackUrl).then(() => toast.push({ title: "Gekopieerd", tone: "success" }))}
              >
                {callbackUrl} <Copy className="size-3" />
              </button>
            </li>
            <li>Vul hieronder de <strong>ClientId</strong> en <strong>ClientSecret</strong> van die app in en log in bij Hue.</li>
          </ol>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ClientId" maxLength={100} autoComplete="off" aria-label="Hue ClientId" disabled={!live} />
            <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" placeholder="ClientSecret" maxLength={200} autoComplete="off" aria-label="Hue ClientSecret" disabled={!live} />
            <Button type="submit" className="sm:col-span-2" disabled={!live || busy || !clientId.trim() || !clientSecret.trim()}>
              {busy ? "Doorsturen naar Hue…" : "Inloggen bij Philips Hue"}
            </Button>
          </form>
          <p className="text-[11px] text-muted">Je client secret en de aanmelding worden versleuteld bewaard. Bediening gaat via de officiële Hue-cloud.</p>
        </div>
      )}
    </SectionCard>
  );
}
