"use client";

import { useCallback, useEffect, useState } from "react";
import { AirVent, ExternalLink, Network, Plug, Sun, Trash2 } from "lucide-react";
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
  tuya: { region: string; uid: string; addedAt: string; health: AdapterHealth | null } | null;
  matter: { enabledAt: string; health: AdapterHealth | null; nodes: { nodeId: string; vendorName: string; productName: string; online: boolean; endpoints: number }[] } | null;
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

const TUYA_REGIONS: [string, string][] = [
  ["eu", "Centraal-Europa (meestal voor Nederland)"],
  ["eu-west", "West-Europa"],
  ["us", "Westelijk Amerika"],
  ["us-east", "Oostelijk Amerika"],
  ["cn", "China"],
  ["in", "India"],
];

export function TuyaCard() {
  const { data, load, live } = useIntegrations();
  const manage = useCan("manage_devices");
  const toast = useToast();
  const [region, setRegion] = useState("eu");
  const [accessId, setAccessId] = useState("");
  const [accessSecret, setAccessSecret] = useState("");
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ devicesFound: number }>(connectorPath("v1/integrations/tuya"), { method: "POST", body: JSON.stringify({ region, accessId, accessSecret, uid }) });
      toast.push({ title: "Smart Life gekoppeld", description: `${r.devicesFound} apparaat/apparaten gevonden; ondersteunde stekkers zijn toegevoegd.`, tone: "success" });
      setAccessSecret("");
      await load();
    } catch (e) {
      toast.push({ title: "Koppelen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Smart Life / Tuya" description="Officiële Tuya Cloud OpenAPI · stekkers en schakelaars" icon={Plug} testId="tuya-card">
      {data?.tuya ? (
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm">Gekoppeld sinds {formatDateTime(data.tuya.addedAt)}</p>
            <p className="truncate text-[11px] text-muted">{data.tuya.health?.message}</p>
          </div>
          <Health h={data.tuya.health} />
          {manage && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Ontkoppelen"
              onClick={async () => {
                if (!confirm("Smart Life ontkoppelen? De stekkers worden uit HomeOS verwijderd.")) return;
                try {
                  await api(connectorPath("v1/integrations/tuya"), { method: "DELETE" });
                  await load();
                } catch (e) {
                  toast.push({ title: "Niet gelukt", description: (e as Error).message, tone: "danger" });
                }
              }}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">Nog niet gekoppeld.</p>
      )}
      {manage && !data?.tuya && (
        <form
          className="mt-4 space-y-2 border-t border-white/[0.06] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <ol className="list-decimal space-y-1 pl-4 text-[11px] text-muted">
            <li>
              Maak een gratis account op{" "}
              <a href="https://platform.tuya.com" target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                platform.tuya.com
              </a>{" "}
              en maak een Cloud-project (type Smart Home, datacenter Central Europe).
            </li>
            <li>Kopieer onder Overview de Access ID en Access Secret.</li>
            <li>Ga naar Devices → Link App Account, scan de QR-code met de Smart Life-app (Ik → scan-icoon) en kopieer de UID van het gekoppelde account.</li>
          </ol>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="h-10 w-full rounded-xl border border-white/[0.08] bg-navy-850 px-3 text-sm" aria-label="Datacenter" disabled={!live}>
            {TUYA_REGIONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={accessId} onChange={(e) => setAccessId(e.target.value.trim())} placeholder="Access ID" aria-label="Access ID" autoComplete="off" disabled={!live} />
            <Input value={accessSecret} onChange={(e) => setAccessSecret(e.target.value.trim())} placeholder="Access Secret" type="password" aria-label="Access Secret" autoComplete="off" disabled={!live} />
          </div>
          <Input value={uid} onChange={(e) => setUid(e.target.value.trim())} placeholder="UID van het gekoppelde Smart Life-account" aria-label="UID" autoComplete="off" disabled={!live} />
          <Button type="submit" variant="primary" disabled={!live || busy || !accessId || !accessSecret || !uid}>
            {busy ? "Koppelen…" : "Koppelen"}
          </Button>
          <p className="text-[11px] text-muted">
            Opdrachten lopen via de Tuya-cloud. Het gratis IoT Core-abonnement moet je soms verlengen in de Tuya-console; als het verloopt, meldt HomeOS dat. De secret blijft versleuteld op je laptop.
          </p>
        </form>
      )}
    </SectionCard>
  );
}

export function MatterCard() {
  const { data, load, live } = useIntegrations();
  const manage = useCan("manage_devices");
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const commission = async () => {
    setBusy(true);
    try {
      const r = await api<{ devicesAdded: number }>(connectorPath("v1/integrations/matter/commission"), { method: "POST", body: JSON.stringify({ pairingCode: code }) });
      toast.push({ title: "Matter-apparaat gekoppeld", description: `${r.devicesAdded} apparaat/apparaten toegevoegd.`, tone: "success" });
      setCode("");
    } catch (e) {
      toast.push({ title: "Koppelen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <SectionCard title="Matter (o.a. IKEA)" description="Open standaard · lokaal, via je eigen netwerk · experimenteel" icon={Network} testId="matter-card">
      {data?.matter?.health?.status === "down" && <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{data.matter.health.message}</p>}
      {!data?.matter?.nodes.length ? (
        <p className="text-sm text-muted">Nog geen Matter-apparaten gekoppeld.</p>
      ) : (
        <ul className="space-y-2">
          {data.matter.nodes.map((n) => (
            <li key={n.nodeId} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{n.productName || "Matter-apparaat"}</p>
                <p className="truncate text-[11px] text-muted">
                  {n.vendorName} · node {n.nodeId} · {n.endpoints} onderdeel/onderdelen
                </p>
              </div>
              <Badge tone={n.online ? "success" : "danger"}>{n.online ? "online" : "offline"}</Badge>
              {manage && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Ontkoppelen van HomeOS"
                  onClick={async () => {
                    if (!confirm("Dit apparaat uit HomeOS verwijderen? De koppeling met de IKEA-app blijft gewoon bestaan.")) return;
                    try {
                      await api(connectorPath(`v1/integrations/matter/nodes/${n.nodeId}`), { method: "DELETE" });
                      await load();
                    } catch (e) {
                      toast.push({ title: "Niet gelukt", description: (e as Error).message, tone: "danger" });
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <form
          className="mt-4 space-y-2 border-t border-white/[0.06] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void commission();
          }}
        >
          <ol className="list-decimal space-y-1 pl-4 text-[11px] text-muted">
            <li>Open in de IKEA Home smart-app het apparaat (bijv. GRILLPLATS) → instellingen → <strong>Bediening in andere systemen</strong> (Matter).</li>
            <li>Kopieer de koppelcode die de app toont (11 cijfers). Een code werkt maar één keer en verloopt na enkele minuten.</li>
            <li>Plak hem hieronder. Koppelen kan tot een paar minuten duren; je Mac moet op hetzelfde netwerk zitten als de DIRIGERA.</li>
          </ol>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Koppelcode, bijv. 3497-011-2332" inputMode="numeric" aria-label="Matter-koppelcode" autoComplete="off" disabled={!live || busy} />
            <Button type="submit" variant="primary" disabled={!live || busy || code.replace(/\D/g, "").length < 11}>
              {busy ? "Koppelen… (even geduld)" : "Koppelen"}
            </Button>
          </div>
          <p className="text-[11px] text-muted">
            HomeOS wordt een extra Matter-controller naast de DIRIGERA; de IKEA-app blijft werken. Experimenteel: gebruikers melden dat IKEA-deelcodes niet altijd direct werken; probeer dan een nieuwe code.
          </p>
        </form>
      )}
    </SectionCard>
  );
}
