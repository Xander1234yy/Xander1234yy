"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, House, Unlink } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

type Info = { connected: boolean; addedAt?: string; devices?: string[]; health?: AdapterHealth | null };

const RESULT: Record<string, { title: string; tone: "success" | "danger" }> = {
  gekoppeld: { title: "Google gekoppeld. Voeg nu je apparaten toe.", tone: "success" },
  mislukt: { title: "Koppelen met Google mislukt. Probeer het opnieuw.", tone: "danger" },
  geweigerd: { title: "Google heeft het koppelen niet bevestigd.", tone: "danger" },
  "geen-rechten": { title: "Alleen beheerders kunnen Google koppelen.", tone: "danger" },
};

/** Apparaten uit Google Home (bijv. IKEA Matter) via de officiële Google Assistant SDK. Alleen opdrachten. */
export function GoogleHomeCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [names, setNames] = useState("");
  const [busy, setBusy] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const g = (await api<{ googlehome?: Info }>(connectorPath("v1/integrations"))).googlehome ?? null;
      setInfo(g);
      if (g?.devices) setNames(g.devices.join("\n"));
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/integrations/googlehome/callback`);
    const r = new URLSearchParams(window.location.search).get("google");
    if (r && RESULT[r]) toast.push({ title: RESULT[r].title, tone: RESULT[r].tone });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- eenmalig bij openen
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast.push({ title: "Gekopieerd", tone: "success" }));

  const start = async () => {
    setBusy(true);
    try {
      const r = await api<{ authorizeUrl: string }>(connectorPath("v1/integrations/googlehome/start"), {
        method: "POST",
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri: callbackUrl }),
      });
      window.location.assign(r.authorizeUrl); // naar de inlogpagina van Google
    } catch (e) {
      toast.push({ title: "Starten mislukt", description: (e as Error).message, tone: "danger" });
      setBusy(false);
    }
  };

  const saveDevices = async () => {
    setBusy(true);
    try {
      const list = names.split(/\n|,/).map((n) => n.trim()).filter(Boolean);
      await api(connectorPath("v1/integrations/googlehome/devices"), { method: "PUT", body: JSON.stringify({ names: list }) });
      toast.push({ title: "Apparaten opgeslagen", description: "Je vindt ze bij Apparaten.", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Opslaan mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Google Home ontkoppelen? De apparaten worden uit HomeOS verwijderd en de aanmelding wordt gewist.")) return;
    try {
      await api(connectorPath("v1/integrations/googlehome"), { method: "DELETE" });
      toast.push({ title: "Google ontkoppeld", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <SectionCard title="Google Home" description="Officiële Google Assistant SDK · bijv. IKEA Matter-stekkers" icon={House} testId="google-home-card">
      {info?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">Google-account</p>
              <p className="truncate text-[11px] text-muted">
                gekoppeld {info.addedAt ? formatDateTime(info.addedAt) : ""} · {info.health?.message ?? "—"}
              </p>
            </div>
            <Badge tone={info.health?.status === "ok" ? "success" : info.health?.status === "down" ? "danger" : "warning"}>{info.health?.status ?? "onbekend"}</Badge>
            {manage && (
              <Button size="icon-sm" variant="ghost" onClick={() => void remove()} aria-label="Google ontkoppelen">
                <Unlink />
              </Button>
            )}
          </div>
          <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
            Alleen aan/uit. HomeOS geeft de opdracht door aan Google Assistent; Google meldt niet terug of het apparaat echt
            schakelde. De status blijft daarom &quot;onbekend&quot;. Controleer bij twijfel in de Google Home-app.
          </p>
          {manage && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveDevices();
              }}
            >
              <label className="text-xs text-muted" htmlFor="google-names">
                Apparaten, precies zoals ze in Google Home heten (één per regel):
              </label>
              <textarea
                id="google-names"
                value={names}
                onChange={(e) => setNames(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder={"GRILLPLATS\nLamp bank"}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm"
                disabled={!live}
              />
              <Button type="submit" disabled={!live || busy}>
                {busy ? "Opslaan…" : "Apparaten opslaan"}
              </Button>
            </form>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Niet gekoppeld.</p>
      )}
      {manage && !info?.connected && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted">
            <li>
              Ga naar <strong>console.cloud.google.com</strong>, maak een project en zet bij <em>APIs &amp; Services → Library</em> de{" "}
              <strong>Google Assistant API</strong> aan.
            </li>
            <li>
              <em>OAuth consent screen</em>: kies <strong>External</strong>, vul je naam/e-mail in en klik daarna op <strong>Publish app</strong> (anders
              verloopt de koppeling na 7 dagen).
            </li>
            <li>
              <em>Credentials → Create credentials → OAuth client ID → Web application</em>, met als <strong>Authorized redirect URI</strong>:{" "}
              <button type="button" className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-fg" onClick={() => copy(callbackUrl)}>
                {callbackUrl} <Copy className="size-3" />
              </button>
            </li>
            <li>Vul hieronder de client-ID en het client secret in en log in met het Google-account van je Google Home.</li>
          </ol>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" maxLength={200} autoComplete="off" aria-label="Google client-ID" disabled={!live} />
            <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" placeholder="Client secret" maxLength={200} autoComplete="off" aria-label="Google client secret" disabled={!live} />
            <Button type="submit" className="sm:col-span-2" disabled={!live || busy || !clientId.trim() || !clientSecret.trim()}>
              {busy ? "Doorsturen naar Google…" : "Inloggen bij Google"}
            </Button>
          </form>
          <p className="text-[11px] text-muted">
            Google toont mogelijk &quot;Google heeft deze app niet geverifieerd&quot;: dat klopt, het is je eigen app. Kies <em>Geavanceerd → Doorgaan</em>. Je
            client secret en de aanmelding worden versleuteld bewaard.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
