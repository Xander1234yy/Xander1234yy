"use client";

import { useCallback, useEffect, useState } from "react";
import { AirVent, ExternalLink, Sun, Trash2 } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, connectorPath } from "@/lib/api";
import { useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

interface Integrations {
  solaredge: { siteId: string; name: string; peakPowerKw: number | null; addedAt: string; health: AdapterHealth | null }[];
  daikin: { clientId: string; redirectUri: string; connectedAt: string; health: AdapterHealth | null } | null;
}
const TONE = { ok: "success", degraded: "warning", down: "danger", not_configured: "neutral" } as const;

function useIntegrations() {
  const live = useLive();
  const [data, setData] = useState<Integrations | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<Integrations>(connectorPath("v1/integrations")));
    } catch {
      /* connector offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load]);
  return { data, load, live };
}

function Health({ h }: { h: AdapterHealth | null | undefined }) {
  return <Badge tone={TONE[h?.status ?? "not_configured"]}>{h?.status ?? "onbekend"}</Badge>;
}

export function SolarEdgeCard() {
  const { data, load, live } = useIntegrations();
  const manage = useCan("manage_devices");
  const toast = useToast();
  const [siteId, setSiteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.push({ title: ok, tone: "success" });
      await load();
      return true;
    } catch (e) {
      toast.push({ title: "Niet gelukt", description: (e as Error).message, tone: "danger" });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <SectionCard title="SolarEdge" description="Officiële Monitoring API · max. 300 verzoeken per dag" icon={Sun} testId="solaredge-card">
      {data?.solaredge.length === 0 && <p className="text-sm text-muted">Nog geen installatie gekoppeld.</p>}
      <ul className="space-y-2">
        {data?.solaredge.map((s) => (
          <li key={s.siteId} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {s.name} {s.peakPowerKw ? <span className="text-muted">· {s.peakPowerKw} kWp</span> : null}
              </p>
              <p className="truncate text-[11px] text-muted">{s.health?.message ?? `Site ${s.siteId}`}</p>
            </div>
            <Health h={s.health} />
            {manage && (
              <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="Verwijderen" onClick={() => confirm(`${s.name} ontkoppelen?`) && void run(() => api(connectorPath(`v1/integrations/solaredge/${s.siteId}`), { method: "DELETE" }), "SolarEdge ontkoppeld")}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {manage && (
        <form
          className="mt-4 space-y-2 border-t border-white/[0.06] pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => api(connectorPath("v1/integrations/solaredge"), { method: "POST", body: JSON.stringify({ siteId, apiKey }) }), "SolarEdge gekoppeld")) {
              setSiteId("");
              setApiKey("");
            }
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
            <Input value={siteId} onChange={(e) => setSiteId(e.target.value.replace(/\D/g, ""))} placeholder="Site-ID" inputMode="numeric" maxLength={12} aria-label="Site-ID" disabled={!live} />
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} placeholder="API-key" type="password" autoComplete="off" maxLength={64} aria-label="API-key" disabled={!live} />
            <Button type="submit" disabled={!live || busy || !siteId || apiKey.length < 16}>
              Koppelen
            </Button>
          </div>
          <p className="text-[11px] text-muted">
            In de SolarEdge Monitoring-portal: <strong>Admin → Site Access → API Access</strong> (soms activeert je installateur dit). Het site-ID staat in de adresbalk van het portal.
            Zonder SolarEdge-energiemeter toont HomeOS alleen opwek; verbruik en net worden niet geschat. De key blijft versleuteld op je laptop.
          </p>
        </form>
      )}
    </SectionCard>
  );
}

const DEFAULT_REDIRECT = "https://homeos.invalid/daikin-callback";

export function DaikinCard() {
  const { data, load, live } = useIntegrations();
  const manage = useCan("manage_devices");
  const toast = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState(DEFAULT_REDIRECT);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [callback, setCallback] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Draait HomeOS op een https-adres (bijv. later op Vercel), dan kan Daikin direct terugsturen.
    if (location.protocol === "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) setRedirectUri(`${location.origin}/integraties/daikin`);
  }, []);

  const call = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.push({ title: ok, tone: "success" });
      return r;
    } catch (e) {
      toast.push({ title: "Niet gelukt", description: (e as Error).message, tone: "danger" });
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Daikin Onecta" description="Officiële Onecta Cloud API · max. 200 verzoeken per dag" icon={AirVent} testId="daikin-card">
      {data?.daikin ? (
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm">Gekoppeld sinds {formatDateTime(data.daikin.connectedAt)}</p>
            <p className="truncate text-[11px] text-muted">{data.daikin.health?.message}</p>
          </div>
          <Health h={data.daikin.health} />
          {manage && (
            <Button size="icon-sm" variant="ghost" disabled={busy} aria-label="Ontkoppelen" onClick={async () => confirm("Daikin ontkoppelen? Tokens worden gewist.") && (await call(() => api(connectorPath("v1/integrations/daikin"), { method: "DELETE" }), "Daikin ontkoppeld")) && load()}>
              <Trash2 />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Nog niet gekoppeld.</p>
      )}

      {manage && !data?.daikin && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <ol className="list-decimal space-y-1 pl-4 text-[11px] text-muted">
            <li>
              Maak een app aan in het{" "}
              <a href="https://developer.cloud.daikineurope.com" target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                Daikin Developer Portal
              </a>{" "}
              en vul daar exact deze redirect-URI in.
            </li>
            <li>Vul hieronder de client-ID en client secret in en klik op “Inloggen bij Daikin”.</li>
            <li>Na het inloggen stuurt Daikin je browser naar de redirect-URI. Bij <code>homeos.invalid</code> laadt die pagina bewust niet (de code verlaat je browser dan nergens heen): kopieer de volledige adresregel en plak die hieronder.</li>
          </ol>
          <Input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} aria-label="Redirect-URI" maxLength={500} disabled={!live} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client-ID" aria-label="Client-ID" autoComplete="off" disabled={!live} />
            <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Client secret" type="password" aria-label="Client secret" autoComplete="off" disabled={!live} />
          </div>
          <Button
            variant="primary"
            disabled={!live || busy || !clientId || !clientSecret}
            onClick={async () => {
              const r = await call(() => api<{ authorizeUrl: string }>(connectorPath("v1/integrations/daikin/start"), { method: "POST", body: JSON.stringify({ clientId, clientSecret, redirectUri }) }));
              if (r) {
                setAuthUrl(r.authorizeUrl);
                window.open(r.authorizeUrl, "_blank", "noopener,noreferrer");
              }
            }}
          >
            <ExternalLink /> Inloggen bij Daikin
          </Button>
          {authUrl && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await call(() => api(connectorPath("v1/integrations/daikin/complete"), { method: "POST", body: JSON.stringify({ callbackUrl: callback }) }), "Daikin gekoppeld")) {
                  setAuthUrl(null);
                  setClientSecret("");
                  setCallback("");
                  await load();
                }
              }}
            >
              <Input value={callback} onChange={(e) => setCallback(e.target.value)} placeholder="Plak hier de adresregel na het inloggen" aria-label="Adresregel na inloggen" />
              <Button type="submit" disabled={busy || !callback.includes("code=")}>
                Afronden
              </Button>
            </form>
          )}
        </div>
      )}
    </SectionCard>
  );
}
