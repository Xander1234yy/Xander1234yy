"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Link2Off, Search, Tv } from "lucide-react";
import type { AdapterHealth } from "@homeos/shared";
import { Badge, Button, Input } from "@homeos/ui";
import { SectionCard } from "@/components/section";
import { useCan } from "@/components/session-context";
import { useToast } from "@/components/toast";
import { api, ApiError, connectorPath } from "@/lib/api";
import { useHome, useLive } from "@/lib/home-context";
import { formatDateTime } from "@/lib/format";

interface PairedTv {
  tvId: string;
  host: string;
  name: string;
  model: string;
  encrypted: boolean;
  wakeOnLan: boolean;
  pairedAt: string;
  health: AdapterHealth | null;
}
interface Found {
  host: string;
  name: string | null;
  paired: boolean;
}

const HEALTH_TONE = { ok: "success", degraded: "warning", down: "danger", not_configured: "neutral" } as const;
const HEALTH_LABEL = { ok: "verbonden", degraded: "uit", down: "fout", not_configured: "niet gekoppeld" } as const;

/** LG webOS-tv koppelen: lokaal via het netwerk, met bevestiging op de tv. */
export function TvCard() {
  const live = useLive();
  const manage = useCan("manage_devices");
  const { snapshot } = useHome();
  const toast = useToast();
  const [paired, setPaired] = useState<PairedTv[]>([]);
  const [found, setFound] = useState<Found[] | null>(null);
  const [host, setHost] = useState("");
  const [mac, setMac] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPaired((await api<{ webos?: PairedTv[] }>(connectorPath("v1/integrations"))).webos ?? []);
    } catch {
      /* connector offline */
    }
  }, []);
  useEffect(() => {
    if (live) void load();
  }, [live, load, snapshot?.connector.adapters.length]);

  const discover = async () => {
    setBusy("discover");
    try {
      const r = await api<{ tvs: Found[]; message: string | null }>(connectorPath("v1/integrations/webos/discover"), { method: "POST" });
      setFound(r.tvs);
      setHint(r.message);
    } catch (e) {
      toast.push({ title: "Zoeken mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const pair = async (ip: string) => {
    setBusy(ip);
    setHint(`Kijk op je tv: er verschijnt een melding van "LG Remote App". Kies Toestaan (binnen een minuut).`);
    try {
      const r = await api<{ tv: { name: string; mac: string | null } }>(connectorPath("v1/integrations/webos/pair"), {
        method: "POST",
        body: JSON.stringify({ host: ip, mac: mac.trim() || null }),
      });
      toast.push({ title: `${r.tv.name} gekoppeld`, description: "De tv staat nu bij Entertainment.", tone: "success" });
      setHint(r.tv.mac ? null : "Gekoppeld, maar het MAC-adres is onbekend: aanzetten via HomeOS kan dan niet. Koppel opnieuw met het MAC-adres (tv: Instellingen → Algemeen → Over deze tv → Netwerk).");
      setFound(null);
      setHost("");
      await load();
    } catch (e) {
      const err = e as ApiError;
      setHint(err.code === "TIMEOUT" ? "Geen bevestiging ontvangen. Probeer opnieuw en kies Toestaan op de tv." : err.code === "REJECTED" ? "De koppeling is geweigerd op de tv." : null);
      toast.push({ title: "Koppelen mislukt", description: err.message, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const unpair = async (t: PairedTv) => {
    if (!confirm(`${t.name} ontkoppelen? De tv wordt uit HomeOS verwijderd en de sleutel wordt gewist.`)) return;
    setBusy(t.tvId);
    try {
      await api(connectorPath(`v1/integrations/webos/${t.tvId}`), { method: "DELETE" });
      toast.push({ title: "Tv ontkoppeld", tone: "success" });
      await load();
    } catch (e) {
      toast.push({ title: "Ontkoppelen mislukt", description: (e as Error).message, tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard title="LG-tv (webOS)" description="Lokaal via je netwerk · met toestemming op de tv" icon={Tv} testId="tv-card">
      {paired.length === 0 && <p className="text-sm text-muted">Nog geen tv gekoppeld.</p>}
      <ul className="space-y-2">
        {paired.map((t) => (
          <li key={t.tvId} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{t.name}</p>
              <p className="truncate text-[11px] text-muted">
                {t.host} · {t.encrypted ? "versleuteld" : "onversleuteld"} · {t.wakeOnLan ? "aanzetten via netwerk" : "aanzetten niet mogelijk"} · gekoppeld {formatDateTime(t.pairedAt)}
              </p>
              {t.health?.status === "down" && <p className="text-[11px] text-danger">{t.health.message}</p>}
            </div>
            <Badge tone={HEALTH_TONE[t.health?.status ?? "not_configured"]}>{HEALTH_LABEL[t.health?.status ?? "not_configured"]}</Badge>
            {manage && (
              <Button size="icon-sm" variant="ghost" disabled={!!busy} onClick={() => void unpair(t)} aria-label={`${t.name} ontkoppelen`}>
                <Link2Off />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {manage && (
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          <p className="text-xs text-muted">Zet de tv aan. Zet op de tv &quot;LG Connect Apps&quot; aan en, om hem via HomeOS aan te kunnen zetten, ook &quot;Inschakelen via Wi-Fi&quot; (Instellingen → Algemeen → Apparaten / Mobiele tv aan).</p>
          <Button variant="secondary" size="sm" disabled={!live || !!busy} onClick={() => void discover()}>
            <Search /> {busy === "discover" ? "Zoeken…" : "Tv zoeken"}
          </Button>
          {found?.filter((t) => !t.paired).map((t) => (
            <div key={t.host} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">
                {t.name ?? "LG-tv"} <span className="text-muted">{t.host}</span>
              </span>
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void pair(t.host)}>
                <Link2 /> {busy === t.host ? "Wacht op tv…" : "Koppelen"}
              </Button>
            </div>
          ))}
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (host.trim()) void pair(host.trim());
            }}
          >
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="IP-adres, bijv. 192.168.68.20" inputMode="decimal" maxLength={15} aria-label="IP-adres van de tv" disabled={!live} />
            <Input value={mac} onChange={(e) => setMac(e.target.value)} placeholder="MAC (optioneel)" maxLength={17} aria-label="MAC-adres van de tv (optioneel)" disabled={!live} />
            <Button type="submit" disabled={!live || !host.trim() || !!busy}>
              {busy === host.trim() ? "Wacht op tv…" : "Koppelen"}
            </Button>
          </form>
          {hint && <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent-soft" role="status">{hint}</p>}
          <p className="text-[11px] text-muted">
            De sleutel van de tv wordt versleuteld op je laptop bewaard en verlaat je netwerk nooit. HomeOS controleert bij iedere verbinding het certificaat van de tv.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
